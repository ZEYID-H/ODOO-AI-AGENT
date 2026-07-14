"use server";

/**
 * Driver notification inbox (Delivery Management D8 — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §9 D8). Deliberately Delivery-specific,
 * not a generic platform notification framework: there is no Notification
 * table. Events are DERIVED, on every read, from the already-immutable
 * DeliveryProofAttempt history (D7) — a resubmission or a review is a
 * durable fact recorded there the moment its transaction commits, so a
 * derived feed can never show a notification for something that didn't
 * really happen, and can never lose one for something that did, without
 * any duplicated business logic here (see deriveMyDeliveryEvents below).
 *
 * Authorization (docs/PROJECT_DEVELOPMENT_GUIDE.md §4, permanent rule):
 * every export starts with requireActionRole("DRIVER"). Identity always
 * comes from the session; every query is scoped through
 * `deliveryProof: { driverId: session.user.id }`, so another driver's
 * attempts are never visible, exactly like every other driver-scoped query
 * in app/actions/delivery-proofs.ts.
 */

import { requireActionRole } from "@/lib/session-guard";
import { prisma } from "@/lib/db";

export type DeliveryNotificationType = "VERIFIED" | "REJECTED" | "RESUBMITTED_PENDING";

/**
 * Exactly what a driver needs to act on an event — nothing internal.
 * Deliberately excludes: imagePath (no filesystem details), every OCR
 * field, owner/reviewer user ids (D8 doesn't need "who reviewed it," only
 * "what happened and when" — see docs/DELIVERY_MANAGEMENT_PLAN.md's D8
 * write-up for why reviewer identity was intentionally left out), and any
 * database-only metadata (row ids other than the stable synthetic event id
 * and the proof id needed to link to it).
 */
export interface DeliveryNotification {
  id: string;
  type: DeliveryNotificationType;
  deliveryProofId: string;
  attemptNumber: number;
  invoiceNumber: string | null;
  customerName: string | null;
  eventAt: string;
  rejectionReason: string | null;
  read: boolean;
}

/**
 * Hard cap on how many events a single list call returns — newest first,
 * so this is "the 50 most recent things that happened," not a sample. The
 * unread COUNT (getMyUnreadDeliveryNotificationCount) is not capped by
 * this — a badge must report the true number outstanding even if a driver
 * hasn't opened the app in a long time; only the rendered list is bounded.
 *
 * NOT exported: a "use server" file's export table must be entirely async
 * function references (Next.js rewrites every export into a server-action
 * token) — a plain runtime value export here breaks that transform and
 * silently drops the WHOLE module's exports (discovered empirically: the
 * build failed with "the module has no exports at all" until this lost
 * its `export`). `delivery-proofs.ts` has the same constraint — every one
 * of its non-function exports is a `type`/`interface` (erased at compile
 * time, not a real export), never a plain `const`.
 */
const MAX_NOTIFICATIONS = 50;

interface RawEvent {
  id: string;
  type: DeliveryNotificationType;
  deliveryProofId: string;
  attemptNumber: number;
  invoiceNumber: string | null;
  customerName: string | null;
  eventAt: Date;
  rejectionReason: string | null;
}

/**
 * The one place event derivation happens — list, count, and (indirectly,
 * by not needing its own copy of this logic) mark-read all go through it,
 * so the three actions can never disagree about what counts as an event.
 *
 * Scope: every DeliveryProofAttempt belonging to a proof this driver owns.
 * Not capped at the database level (matches listMyDeliveryProofs' own
 * unbounded findMany — see its comment; the codebase's established stance
 * is "no pagination yet" at this project's scale — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §3 Pending Filters note). Only the
 * derived, sorted, EVENT list is capped, in listMyDeliveryNotifications.
 *
 * Per attempt, up to two events:
 *  - RESUBMITTED_PENDING at submittedAt, only when attemptNumber > 1 (a
 *    driver doesn't need to be notified about their own initial upload —
 *    they just did it. Only a RESUBMISSION is a "delivery event" worth
 *    surfacing here; see the D8 requirement this mirrors exactly.)
 *  - VERIFIED or REJECTED at reviewedAt, only once that attempt has
 *    actually been reviewed (reviewedAt set) — a still-PENDING attempt
 *    (including a fresh attempt 1) produces no review event, by
 *    construction, not a filtered-out special case.
 * A resubmitted-then-reviewed attempt produces BOTH events, independently
 * timestamped — the resubmission event is never lost when its attempt is
 * later reviewed, because it isn't derived FROM the review; it's derived
 * from attemptNumber alone.
 */
async function deriveMyDeliveryEvents(driverId: string): Promise<RawEvent[]> {
  const attempts = await prisma.deliveryProofAttempt.findMany({
    where: { deliveryProof: { driverId } },
    select: {
      id: true,
      attemptNumber: true,
      submittedAt: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      deliveryProofId: true,
      deliveryProof: { select: { invoiceNumber: true, customerName: true } },
    },
  });

  const events: RawEvent[] = [];
  for (const a of attempts) {
    const base = {
      deliveryProofId: a.deliveryProofId,
      attemptNumber: a.attemptNumber,
      invoiceNumber: a.deliveryProof.invoiceNumber,
      customerName: a.deliveryProof.customerName,
    };

    if (a.attemptNumber > 1) {
      events.push({
        id: `attempt:${a.id}:submitted`,
        type: "RESUBMITTED_PENDING",
        eventAt: a.submittedAt,
        rejectionReason: null,
        ...base,
      });
    }

    if (a.reviewedAt && (a.status === "VERIFIED" || a.status === "REJECTED")) {
      events.push({
        id: `attempt:${a.id}:reviewed`,
        type: a.status,
        eventAt: a.reviewedAt,
        rejectionReason: a.status === "REJECTED" ? a.rejectionReason : null,
        ...base,
      });
    }
  }

  events.sort((x, y) => y.eventAt.getTime() - x.eventAt.getTime());
  return events;
}

/**
 * DRIVER: the notification inbox, newest first, capped at
 * MAX_NOTIFICATIONS. `read` is computed against the driver's CURRENT
 * stored cursor (deliveryNotificationsSeenAt) — this function never
 * mutates it. The driver notifications page calls this BEFORE calling
 * markMyDeliveryNotificationsRead(), specifically so the returned `read`
 * flags reflect what was true when the driver opened the page, not
 * "already read" for items they're seeing for the first time.
 */
export async function listMyDeliveryNotifications(): Promise<DeliveryNotification[]> {
  const session = await requireActionRole("DRIVER");
  const [user, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { deliveryNotificationsSeenAt: true },
    }),
    deriveMyDeliveryEvents(session.user.id),
  ]);
  const cursor = user.deliveryNotificationsSeenAt;

  return events.slice(0, MAX_NOTIFICATIONS).map((e) => ({
    id: e.id,
    type: e.type,
    deliveryProofId: e.deliveryProofId,
    attemptNumber: e.attemptNumber,
    invoiceNumber: e.invoiceNumber,
    customerName: e.customerName,
    eventAt: e.eventAt.toISOString(),
    rejectionReason: e.rejectionReason,
    read: cursor !== null && e.eventAt.getTime() <= cursor.getTime(),
  }));
}

/**
 * DRIVER: the true unread count, over ALL derived events (not capped at
 * MAX_NOTIFICATIONS) — a badge must be honest even if a driver has more
 * unread items than the list renders. Read only; never mutates the cursor
 * — rendering this badge (e.g. in the driver chrome on every /driver page)
 * must never itself mark anything read.
 */
export async function getMyUnreadDeliveryNotificationCount(): Promise<number> {
  const session = await requireActionRole("DRIVER");
  const [user, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { deliveryNotificationsSeenAt: true },
    }),
    deriveMyDeliveryEvents(session.user.id),
  ]);
  const cursor = user.deliveryNotificationsSeenAt;

  if (cursor === null) return events.length; // never opened the inbox — everything unread
  return events.filter((e) => e.eventAt.getTime() > cursor.getTime()).length;
}

/**
 * DRIVER: advances the read cursor to the server's current time. Called
 * directly (awaited) from the notifications page's own Server Component
 * body, AFTER listMyDeliveryNotifications() — the same pattern
 * app/dashboard/page.tsx already uses for ensureInitialConversation()
 * (a plain data mutation during render is fine in this Next version; only
 * calling revalidatePath() on the currently-rendering route during its own
 * render is forbidden, and this function never calls revalidatePath at
 * all — the same request's fresh render already reflects the new cursor).
 *
 * Timestamp source, and an honestly-documented edge case: the cursor is
 * set to `new Date()` captured at THIS call — not to "the newest event's
 * own timestamp" recomputed from a fresh query. That would reopen the
 * exact race being avoided: a review committing in the split-second
 * between listMyDeliveryNotifications() and this call would then already
 * be included in a fresh re-derivation and get marked read despite never
 * appearing in what the driver was actually shown. Using `new Date()`
 * captured here bounds the window to "between this call starting and its
 * write landing" — a few milliseconds — which is negligible for a
 * manual, human-paced review workflow (not a high-frequency system) and
 * is the smallest safe design: a monotonic per-event sequence number would
 * close this fully, but is not justified at this app's scale — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md's D8 write-up for the full reasoning
 * this comment summarizes.
 */
export async function markMyDeliveryNotificationsRead(): Promise<void> {
  const session = await requireActionRole("DRIVER");
  await prisma.user.update({
    where: { id: session.user.id },
    data: { deliveryNotificationsSeenAt: new Date() },
  });
}
