"use server";

/**
 * Delivery proof persistence actions (Delivery Management D2 — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §9). Metadata only: no file handling,
 * no uploads — imagePath/mimeType/sizeBytes stay null until D3.
 *
 * Authorization (docs/PROJECT_DEVELOPMENT_GUIDE.md §4, permanent rule):
 * every action starts with requireActionRole() before any business logic.
 * Drivers create and see exclusively their own proofs — the driver id
 * always comes from the server session, never from the client. Owners see
 * everything and are the only role that can verify/reject. Error messages
 * stay generic; owner views expose the driver's username only, never
 * credential fields.
 */

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/session-guard";
import { prisma } from "@/lib/db";
import { saveProofImage, deleteProofImage } from "@/lib/file-storage";
import { businessDayRangeUtc } from "@/lib/business-time";

/**
 * D7 note on file scope: this file grew a second responsibility area
 * (immutable attempt history) alongside D2–D6's proof/summary actions. It
 * stays one file rather than splitting, because every attempt-related
 * action shares the same guards, view helpers (toView/toOwnerView/
 * isStatus), and — most importantly — the same transactional invariant
 * with the proof-review actions (D4's reviewDeliveryProof) that a review
 * MUST update the parent and the latest attempt together. Splitting would
 * either duplicate that invariant across files or force an import cycle.
 */

export type DeliveryProofStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type OcrStatus = "NOT_STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface DeliveryProofView {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  notes: string | null;
  imagePath: string | null;
  status: DeliveryProofStatus;
  rejectionReason: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Owner-facing view: adds who uploaded and who reviewed (usernames only)
 * plus the OCR-readiness fields (D5). OCR data lives ONLY here by design —
 * DeliveryProofView, which is what drivers receive, never carries it.
 */
export interface OwnerDeliveryProofView extends DeliveryProofView {
  driverId: string;
  driverUsername: string;
  verifiedByUsername: string | null;
  ocrStatus: OcrStatus;
  ocrText: string | null;
  ocrInvoiceNumber: string | null;
  ocrCustomerName: string | null;
  ocrConfidence: number | null;
  ocrProcessedAt: string | null;
  ocrError: string | null;
}

export interface CreateDeliveryProofInput {
  invoiceNumber?: unknown;
  customerName?: unknown;
  notes?: unknown;
}

const MAX_INVOICE_NUMBER = 64;
const MAX_CUSTOMER_NAME = 128;
const MAX_NOTES = 1000;
const MAX_REJECTION_REASON = 500;

/**
 * Optional free-text field: trims, treats empty/absent as null, rejects
 * non-strings and over-length input loudly (never silently truncates —
 * what the driver typed is evidence, so it must be stored exactly or not
 * at all).
 */
function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function isStatus(value: string): value is DeliveryProofStatus {
  return value === "PENDING" || value === "VERIFIED" || value === "REJECTED";
}

function toView(p: {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  notes: string | null;
  imagePath: string | null;
  status: string;
  rejectionReason: string | null;
  uploadedAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryProofView {
  return {
    id: p.id,
    invoiceNumber: p.invoiceNumber,
    customerName: p.customerName,
    notes: p.notes,
    imagePath: p.imagePath,
    status: isStatus(p.status) ? p.status : "PENDING",
    rejectionReason: p.rejectionReason,
    uploadedAt: p.uploadedAt.toISOString(),
    verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// Owner queries select the related usernames explicitly — never the full
// User rows, which carry passwordHash.
const ownerInclude = {
  driver: { select: { username: true } },
  verifiedBy: { select: { username: true } },
} as const;

function isOcrStatus(value: string): value is OcrStatus {
  return (
    value === "NOT_STARTED" ||
    value === "PROCESSING" ||
    value === "COMPLETED" ||
    value === "FAILED"
  );
}

function toOwnerView(
  p: Parameters<typeof toView>[0] & {
    driverId: string;
    driver: { username: string };
    verifiedBy: { username: string } | null;
    ocrStatus: string;
    ocrText: string | null;
    ocrInvoiceNumber: string | null;
    ocrCustomerName: string | null;
    ocrConfidence: number | null;
    ocrProcessedAt: Date | null;
    ocrError: string | null;
  }
): OwnerDeliveryProofView {
  return {
    ...toView(p),
    driverId: p.driverId,
    driverUsername: p.driver.username,
    verifiedByUsername: p.verifiedBy ? p.verifiedBy.username : null,
    ocrStatus: isOcrStatus(p.ocrStatus) ? p.ocrStatus : "NOT_STARTED",
    ocrText: p.ocrText,
    ocrInvoiceNumber: p.ocrInvoiceNumber,
    ocrCustomerName: p.ocrCustomerName,
    ocrConfidence: p.ocrConfidence,
    ocrProcessedAt: p.ocrProcessedAt ? p.ocrProcessedAt.toISOString() : null,
    ocrError: p.ocrError,
  };
}

/**
 * One immutable submission's evidence + review record, as shown to OWNER
 * (D7). Never returned to a DRIVER — attempt history (in particular, who
 * reviewed a past attempt and when) is an owner-only surface, same
 * boundary as OwnerDeliveryProofView's OCR/reviewer fields.
 */
export interface AttemptView {
  id: string;
  attemptNumber: number;
  imagePath: string | null;
  submittedAt: string;
  submittedByUsername: string;
  status: DeliveryProofStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  reviewedByUsername: string | null;
}

/** getDeliveryProofForOwner's return shape: the standard owner view plus
 * the full attempt history, newest first (see getDeliveryProofForOwner's
 * comment for why). A distinct type from OwnerDeliveryProofView rather
 * than adding `attempts` to that shared interface — every OTHER function
 * returning OwnerDeliveryProofView (the queue list, verify/reject,
 * recordOcrResult) does not fetch attempts, and giving them an `attempts:
 * []` field would misleadingly read as "this proof has no attempts" rather
 * than "attempts weren't queried here." */
export interface OwnerDeliveryProofDetailView extends OwnerDeliveryProofView {
  attempts: AttemptView[];
}

function toAttemptView(a: {
  id: string;
  attemptNumber: number;
  imagePath: string | null;
  submittedAt: Date;
  submittedBy: { username: string };
  status: string;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: { username: string } | null;
}): AttemptView {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    imagePath: a.imagePath,
    submittedAt: a.submittedAt.toISOString(),
    submittedByUsername: a.submittedBy.username,
    status: isStatus(a.status) ? a.status : "PENDING",
    rejectionReason: a.rejectionReason,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    reviewedByUsername: a.reviewedBy ? a.reviewedBy.username : null,
  };
}

/**
 * Creates a DeliveryProof together with its mandatory attempt 1, in one
 * transaction (D7): a parent proof must never exist without at least one
 * attempt describing it, matching the invariant reviewDeliveryProof relies
 * on ("every proof has a latest attempt"). `now` is computed once and used
 * for both DeliveryProof.uploadedAt and the attempt's submittedAt so they
 * match exactly, not just approximately (two separate `@default(now())`
 * evaluations could differ by microseconds).
 */
async function createProofWithInitialAttempt(
  driverId: string,
  data: { invoiceNumber: string | null; customerName: string | null; notes: string | null },
  image: { storedName: string; mimeType: string; sizeBytes: number } | null
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const proof = await tx.deliveryProof.create({
      data: {
        ...data,
        imagePath: image?.storedName ?? null,
        mimeType: image?.mimeType ?? null,
        sizeBytes: image?.sizeBytes ?? null,
        driverId,
        uploadedAt: now,
      },
    });
    await tx.deliveryProofAttempt.create({
      data: {
        deliveryProofId: proof.id,
        attemptNumber: 1,
        imagePath: image?.storedName ?? null,
        mimeType: image?.mimeType ?? null,
        sizeBytes: image?.sizeBytes ?? null,
        submittedAt: now,
        submittedById: driverId,
        status: "PENDING",
      },
    });
    return proof;
  });
}

/** DRIVER: record a delivery proof (metadata only in D2 — the photo itself
 * arrives in D3). The proof always belongs to the session's driver.
 * Creates attempt 1 atomically alongside it (D7). */
export async function createDeliveryProofMetadata(
  input: CreateDeliveryProofInput
): Promise<DeliveryProofView> {
  const session = await requireActionRole("DRIVER");

  const data = {
    invoiceNumber: normalizeOptionalText(input?.invoiceNumber, "Invoice number", MAX_INVOICE_NUMBER),
    customerName: normalizeOptionalText(input?.customerName, "Customer name", MAX_CUSTOMER_NAME),
    notes: normalizeOptionalText(input?.notes, "Notes", MAX_NOTES),
  };

  const proof = await createProofWithInitialAttempt(session.user.id, data, null);
  return toView(proof);
}

/** DRIVER: own proofs only, newest first. */
export async function listMyDeliveryProofs(): Promise<DeliveryProofView[]> {
  const session = await requireActionRole("DRIVER");
  const proofs = await prisma.deliveryProof.findMany({
    where: { driverId: session.user.id },
    orderBy: { uploadedAt: "desc" },
  });
  return proofs.map(toView);
}

export interface DriverProofSummary {
  uploadedToday: number;
  pending: number;
  verified: number;
  rejected: number;
  total: number;
}

/**
 * DRIVER dashboard summary (D6, timezone-corrected in D6.1, made fully
 * day-scoped in D6.2): "Today's Summary" now means exactly that for all
 * four cards. Each is a proof UPLOADED today (BUSINESS_TIMEZONE calendar
 * day, half-open UTC range [startUtc, endUtc) from lib/business-time.ts)
 * whose CURRENT status is the given one — grouped by upload day, not by
 * when it was reviewed (verifiedAt is deliberately not the date basis
 * here: a proof uploaded yesterday and verified today still is not part of
 * today's uploads). Scoped to the session's own proofs — never a
 * client-supplied driver id or timezone.
 *
 * Query shape: one groupBy (status counts among today's uploads) instead
 * of three separate status-filtered counts — same round-trip whether the
 * driver has zero or a thousand proofs today, no full rows fetched just to
 * count them. uploadedToday is the sum of that grouped result (every
 * status that exists is already in the groupBy — a proof always has a
 * status), so it needs no separate query. `total` keeps its original
 * all-time meaning (unrelated to the four day-scoped cards; not shown in
 * the current UI) and stays a single plain count, as before.
 */
export async function getMyDeliveryProofSummary(): Promise<DriverProofSummary> {
  const session = await requireActionRole("DRIVER");
  const driverId = session.user.id;

  const { startUtc, endUtc } = businessDayRangeUtc();

  const [total, todayByStatus] = await Promise.all([
    prisma.deliveryProof.count({ where: { driverId } }),
    prisma.deliveryProof.groupBy({
      by: ["status"],
      where: { driverId, uploadedAt: { gte: startUtc, lt: endUtc } },
      _count: { _all: true },
    }),
  ]);

  let pending = 0;
  let verified = 0;
  let rejected = 0;
  let uploadedToday = 0;
  for (const row of todayByStatus) {
    const count = row._count._all;
    uploadedToday += count;
    if (row.status === "PENDING") pending = count;
    else if (row.status === "VERIFIED") verified = count;
    else if (row.status === "REJECTED") rejected = count;
  }

  return { uploadedToday, pending, verified, rejected, total };
}

/**
 * DRIVER: one of their OWN proofs by id (D6 detail view). Scoped to the
 * session driver in the WHERE clause, so another driver's id — or an
 * unknown id — is indistinguishable (both null), exactly like the image
 * route. Returns the driver-safe DeliveryProofView, which by construction
 * carries no OCR or reviewer-identity fields.
 */
export async function getMyDeliveryProof(
  proofId: string
): Promise<DeliveryProofView | null> {
  const session = await requireActionRole("DRIVER");
  if (typeof proofId !== "string" || proofId.length === 0) {
    return null;
  }
  const proof = await prisma.deliveryProof.findFirst({
    where: { id: proofId, driverId: session.user.id },
  });
  return proof ? toView(proof) : null;
}

/** Review-queue precedence (D4): work that needs attention comes first;
 * decided proofs follow, grouped by outcome, newest first within each. */
const STATUS_QUEUE_RANK: Record<DeliveryProofStatus, number> = {
  PENDING: 0,
  VERIFIED: 1,
  REJECTED: 2,
};

/**
 * OWNER: the review queue (D4). With no filter: every proof, PENDING first,
 * newest first within each status. With a filter: that status only, newest
 * first. The filter is strictly validated — anything but the three known
 * statuses reads as "no filter" rather than an error, so a mistyped URL
 * degrades to the full queue instead of breaking it.
 */
export async function listAllDeliveryProofsForOwner(
  statusFilter?: string
): Promise<OwnerDeliveryProofView[]> {
  await requireActionRole("OWNER");

  const filter =
    typeof statusFilter === "string" && isStatus(statusFilter) ? statusFilter : undefined;

  const proofs = await prisma.deliveryProof.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { uploadedAt: "desc" },
    include: ownerInclude,
  });

  const views = proofs.map(toOwnerView);
  if (!filter) {
    // Stable sort: equal ranks keep the query's newest-first order.
    views.sort((a, b) => STATUS_QUEUE_RANK[a.status] - STATUS_QUEUE_RANK[b.status]);
  }
  return views;
}

/**
 * OWNER: one proof by id, including its full attempt history (D7); null
 * for unknown ids (no existence probing to defend against here — owners
 * can already list everything). Attempts are ordered NEWEST FIRST — the
 * decision, documented here per the D7 spec's requirement to state it
 * explicitly: this page reads top-to-bottom as "current state, then how
 * it got here," matching the review queue's own newest-first convention
 * (§9 D4) rather than a chronological "attempt 1 first" reading order.
 */
export async function getDeliveryProofForOwner(
  proofId: string
): Promise<OwnerDeliveryProofDetailView | null> {
  await requireActionRole("OWNER");
  if (typeof proofId !== "string" || proofId.length === 0) {
    return null;
  }
  const proof = await prisma.deliveryProof.findUnique({
    where: { id: proofId },
    include: {
      ...ownerInclude,
      attempts: {
        orderBy: { attemptNumber: "desc" },
        include: {
          submittedBy: { select: { username: true } },
          reviewedBy: { select: { username: true } },
        },
      },
    },
  });
  if (!proof) return null;
  return { ...toOwnerView(proof), attempts: proof.attempts.map(toAttemptView) };
}

/**
 * The single review chokepoint for both decisions. A proof can be reviewed
 * exactly once, and only from PENDING — enforced atomically (updateMany
 * with the status in the WHERE clause), so two concurrent reviews can't
 * both win. Re-reviewing a decided proof is deliberately not supported;
 * that remains true after D7 — reviewing again after a resubmission means
 * reviewing the NEW (again-PENDING) latest attempt, not re-deciding an old
 * one. verifiedAt records when the review happened — on rejection too.
 *
 * D7 addition: every review updates the parent DeliveryProof's
 * current-state fields AND the LATEST DeliveryProofAttempt's review
 * fields, in the same transaction, with the same server timestamp — never
 * an older historical attempt. The parent updateMany's WHERE clause
 * (status: "PENDING") is still the sole authoritative gate on whether the
 * review is allowed to happen at all; the attempt update inside the same
 * transaction only runs once that gate has already succeeded, so it never
 * fires without a corresponding parent change.
 */
async function reviewDeliveryProof(
  proofId: unknown,
  decision: { status: "VERIFIED" | "REJECTED"; rejectionReason: string | null },
  reviewerId: string
): Promise<OwnerDeliveryProofView> {
  if (typeof proofId !== "string" || proofId.length === 0) {
    throw new Error("Delivery proof not found or already reviewed.");
  }
  const now = new Date();

  const proof = await prisma.$transaction(async (tx) => {
    const updated = await tx.deliveryProof.updateMany({
      where: { id: proofId, status: "PENDING" },
      data: {
        status: decision.status,
        rejectionReason: decision.rejectionReason,
        verifiedAt: now,
        verifiedById: reviewerId,
      },
    });
    if (updated.count === 0) {
      // Unknown id and already-reviewed look identical on purpose — the
      // caller learns the review didn't happen, nothing more.
      throw new Error("Delivery proof not found or already reviewed.");
    }

    // Every proof has a latest attempt by construction (D7: initial
    // creation and every resubmission are atomic with their attempt row).
    // A missing one here would mean that invariant broke, not a normal
    // "nothing to review" case — fail loudly rather than silently
    // reviewing the parent without a matching attempt record.
    const latest = await tx.deliveryProofAttempt.findFirst({
      where: { deliveryProofId: proofId },
      orderBy: { attemptNumber: "desc" },
    });
    if (!latest) {
      throw new Error("Delivery proof has no attempt history.");
    }
    await tx.deliveryProofAttempt.update({
      where: { id: latest.id },
      data: {
        status: decision.status,
        rejectionReason: decision.rejectionReason,
        reviewedAt: now,
        reviewedById: reviewerId,
      },
    });

    return tx.deliveryProof.findUniqueOrThrow({
      where: { id: proofId },
      include: ownerInclude,
    });
  });
  return toOwnerView(proof);
}

/** OWNER: verify a pending proof. Clears any rejection reason by design. */
export async function verifyDeliveryProof(
  proofId: string
): Promise<OwnerDeliveryProofView> {
  const session = await requireActionRole("OWNER");
  return reviewDeliveryProof(
    proofId,
    { status: "VERIFIED", rejectionReason: null },
    session.user.id
  );
}

/** OWNER: reject a pending proof. A non-empty reason is required — a
 * rejection the driver can't understand is a WhatsApp argument, which is
 * exactly what this module exists to replace. */
export async function rejectDeliveryProof(
  proofId: string,
  rejectionReason: string
): Promise<OwnerDeliveryProofView> {
  const session = await requireActionRole("OWNER");

  if (typeof rejectionReason !== "string" || rejectionReason.trim().length === 0) {
    throw new Error("A rejection reason is required.");
  }
  const reason = rejectionReason.trim();
  if (reason.length > MAX_REJECTION_REASON) {
    throw new Error(`Rejection reason must be at most ${MAX_REJECTION_REASON} characters.`);
  }

  return reviewDeliveryProof(
    proofId,
    { status: "REJECTED", rejectionReason: reason },
    session.user.id
  );
}

export interface ReviewFormState {
  error?: string;
}

/**
 * Form-shaped wrappers around the D2 review actions (D4 review UI). The
 * D2 actions stay the single source of truth for transitions, atomicity,
 * and immutability — these only adapt them to useActionState: validation
 * and already-reviewed failures come back as form state; the guard runs
 * here FIRST (permanent rule) so an unauthorized caller is thrown out
 * before any form parsing, exactly like every other action.
 *
 * The proof id arrives as a hidden form field — that's resource
 * addressing, not identity: who is acting always comes from the session,
 * and the underlying action re-checks both role and state atomically.
 */
export async function verifyDeliveryProofForm(
  _prevState: ReviewFormState | undefined,
  formData: FormData
): Promise<ReviewFormState> {
  await requireActionRole("OWNER");
  try {
    await verifyDeliveryProof(String(formData.get("proofId") ?? ""));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Review failed. Please try again.",
    };
  }
  revalidatePath("/dashboard/delivery-proof");
  return {};
}

export async function rejectDeliveryProofForm(
  _prevState: ReviewFormState | undefined,
  formData: FormData
): Promise<ReviewFormState> {
  await requireActionRole("OWNER");
  try {
    await rejectDeliveryProof(
      String(formData.get("proofId") ?? ""),
      String(formData.get("rejectionReason") ?? "")
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Review failed. Please try again.",
    };
  }
  revalidatePath("/dashboard/delivery-proof");
  return {};
}

export interface OcrResultInput {
  ocrStatus: unknown;
  ocrText?: unknown;
  ocrInvoiceNumber?: unknown;
  ocrCustomerName?: unknown;
  ocrConfidence?: unknown;
  ocrError?: unknown;
}

/**
 * OCR-readiness recorder (D5). No OCR engine exists yet — this is the one
 * internal, guarded write path future extraction (D6) will call, so the
 * write rules live here from day one instead of appearing with the engine:
 * strict status vocabulary, confidence clamped to [0..1], length-capped
 * text, ocrProcessedAt set server-side only for terminal states.
 *
 * OWNER-only, enforced by the guard on the first line — which is the real
 * boundary: this file is in the UI build graph, so like every exported
 * action here this one IS a registered HTTP endpoint (D5 finding: the D2
 * "unreferenced actions aren't reachable" behavior applies to whole
 * unreferenced files, not to individual unreferenced exports). No UI
 * imports or renders it; DRIVER and anonymous callers are refused before
 * any parsing, verified over the wire in D5's runtime validation.
 * DRIVER can never mutate OCR fields: there is no other write path.
 * (D6 design note: a background worker would have no session — it must
 * either mint a system identity or call the underlying logic behind its
 * own boundary. That decision belongs to D6's planning gate, not here.)
 */
export async function recordOcrResult(
  proofId: string,
  input: OcrResultInput
): Promise<OwnerDeliveryProofView> {
  await requireActionRole("OWNER");

  if (typeof proofId !== "string" || proofId.length === 0) {
    throw new Error("Delivery proof not found.");
  }
  if (typeof input?.ocrStatus !== "string" || !isOcrStatus(input.ocrStatus)) {
    throw new Error("Invalid OCR status.");
  }
  const status = input.ocrStatus;

  let confidence: number | null = null;
  if (input.ocrConfidence !== undefined && input.ocrConfidence !== null) {
    if (
      typeof input.ocrConfidence !== "number" ||
      Number.isNaN(input.ocrConfidence) ||
      input.ocrConfidence < 0 ||
      input.ocrConfidence > 1
    ) {
      throw new Error("OCR confidence must be a number between 0 and 1.");
    }
    confidence = input.ocrConfidence;
  }

  const isTerminal = status === "COMPLETED" || status === "FAILED";
  const updated = await prisma.deliveryProof.updateMany({
    where: { id: proofId },
    data: {
      ocrStatus: status,
      ocrText: normalizeOptionalText(input.ocrText, "OCR text", 20000),
      ocrInvoiceNumber: normalizeOptionalText(input.ocrInvoiceNumber, "OCR invoice number", MAX_INVOICE_NUMBER),
      ocrCustomerName: normalizeOptionalText(input.ocrCustomerName, "OCR customer name", MAX_CUSTOMER_NAME),
      ocrConfidence: confidence,
      ocrError: normalizeOptionalText(input.ocrError, "OCR error", 1000),
      ocrProcessedAt: isTerminal ? new Date() : null,
    },
  });
  if (updated.count === 0) {
    throw new Error("Delivery proof not found.");
  }

  const proof = await prisma.deliveryProof.findUniqueOrThrow({
    where: { id: proofId },
    include: ownerInclude,
  });
  return toOwnerView(proof);
}

export interface UploadDeliveryProofState {
  error?: string;
}

/**
 * DRIVER (D3): the driver portal's upload — one required image plus the
 * D2 metadata fields, in a single submission so a proof-with-photo is
 * created atomically (exactly one image per proof; there is deliberately
 * no attach-image-later or replace-image action — that's what D7's
 * resubmission action is for, and only after a rejection). Creates attempt
 * 1 alongside the parent in the same transaction (D7). useActionState-
 * shaped: validation failures come back as form state, never as thrown
 * errors. The image is validated (size cap, magic-byte type sniffing) and
 * stored under a server-generated name before the row is created; if the
 * transaction fails, the file is cleaned up rather than orphaned.
 */
export async function uploadDeliveryProof(
  _prevState: UploadDeliveryProofState | undefined,
  formData: FormData
): Promise<UploadDeliveryProofState> {
  const session = await requireActionRole("DRIVER");

  // Validation failures carry user-facing messages by construction
  // (normalizeOptionalText / saveProofImage throw them deliberately).
  let data;
  let stored;
  try {
    data = {
      invoiceNumber: normalizeOptionalText(formData.get("invoiceNumber"), "Invoice number", MAX_INVOICE_NUMBER),
      customerName: normalizeOptionalText(formData.get("customerName"), "Customer name", MAX_CUSTOMER_NAME),
      notes: normalizeOptionalText(formData.get("notes"), "Notes", MAX_NOTES),
    };
    stored = await saveProofImage(formData.get("image"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Upload failed. Please try again.",
    };
  }

  try {
    await createProofWithInitialAttempt(session.user.id, data, stored);
  } catch {
    // Database errors are never surfaced verbatim — no internals in form
    // state. The stored file is cleaned up rather than orphaned.
    await deleteProofImage(stored.storedName);
    return { error: "Upload failed. Please try again." };
  }

  revalidatePath("/driver");
  return {};
}

export interface ResubmitProofState {
  error?: string;
}

/**
 * DRIVER (D7): resubmit a REJECTED proof with a newly captured image.
 * Reuses D3's exact upload validation (lib/file-storage.ts's magic-byte
 * type check, size cap, server-generated filename) — no separate
 * validation regime. This is deliberately NOT a general proof-edit action:
 * it changes exactly the image and the fields that follow from a fresh
 * submission (status, review fields, OCR fields); invoiceNumber,
 * customerName, and notes are untouched.
 *
 * Required flow (in order, matching docs/DELIVERY_MANAGEMENT_PLAN.md's D7
 * spec exactly):
 *   1. requireActionRole("DRIVER") — session + role, before anything else.
 *   2. Ownership + REJECTED-status check (this produces the honest,
 *      specific error message the driver sees; see the note below on why
 *      it is not the actual security boundary by itself).
 *   3–4. saveProofImage validates MIME/size and writes the new file under
 *      a server-generated name, in one call (same as D3's upload path).
 *   5. The database transaction: an atomic updateMany with `status:
 *      "REJECTED"` in its WHERE clause is the REAL authoritative gate —
 *      re-checked at write time, not just trusted from step 2's earlier
 *      read. Only once that succeeds does the new DeliveryProofAttempt row
 *      get created, so a proof can never end up with a new attempt but an
 *      unchanged (still-REJECTED) parent, or vice versa.
 *   6. On any failure after the file was written, the new file is deleted.
 *   7. The OLD attempt's file is never touched by any code path here.
 *
 * SQLite concurrency note (documented honestly, not assumed): this app's
 * SQLite database allows exactly one writer at a time, so two resubmit
 * calls for the same proof are already serialized by the database file
 * itself before either transaction's logic runs. The WHERE-clause guard
 * and the (deliveryProofId, attemptNumber) unique constraint are
 * defense-in-depth for correctness under that single-writer model — they
 * are not a substitute for the row-level locking a multi-writer database
 * (e.g. a future Postgres migration) would need to give the same guarantee.
 */
export async function resubmitRejectedDeliveryProof(
  _prevState: ResubmitProofState | undefined,
  formData: FormData
): Promise<ResubmitProofState> {
  const session = await requireActionRole("DRIVER");
  const proofId = String(formData.get("proofId") ?? "");

  // Ownership + existence combined into one query, matching every other
  // driver-scoped lookup in this file: an unknown id and another driver's
  // id must be indistinguishable, so both produce the same generic
  // failure. Only once ownership is established does the more specific
  // "wrong status" message become safe to reveal (the driver already
  // legitimately knows their own proof's real status).
  const existing = await prisma.deliveryProof.findFirst({
    where: { id: proofId, driverId: session.user.id },
    select: { status: true },
  });
  if (!existing) {
    return { error: "Delivery proof not found." };
  }
  if (existing.status !== "REJECTED") {
    return { error: "Only rejected proofs can be resubmitted." };
  }

  let stored;
  try {
    stored = await saveProofImage(formData.get("image"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Resubmission failed. Please try again.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.deliveryProofAttempt.findFirst({
        where: { deliveryProofId: proofId },
        orderBy: { attemptNumber: "desc" },
      });
      const nextAttemptNumber = (latest?.attemptNumber ?? 0) + 1;
      const now = new Date();

      const updated = await tx.deliveryProof.updateMany({
        where: { id: proofId, driverId: session.user.id, status: "REJECTED" },
        data: {
          imagePath: stored.storedName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          status: "PENDING",
          rejectionReason: null,
          verifiedAt: null,
          verifiedById: null,
          // OCR reset (D7 requirement): a new image means any prior
          // extraction is meaningless. No OCR run is triggered here or
          // anywhere in D7 — this only clears the D5 fields back to their
          // untouched default shape.
          ocrStatus: "NOT_STARTED",
          ocrText: null,
          ocrInvoiceNumber: null,
          ocrCustomerName: null,
          ocrConfidence: null,
          ocrProcessedAt: null,
          ocrError: null,
        },
      });
      if (updated.count === 0) {
        // Re-checked at write time (see the function comment) — the proof
        // stopped being REJECTED between the read above and this write.
        throw new Error("Only rejected proofs can be resubmitted.");
      }

      await tx.deliveryProofAttempt.create({
        data: {
          deliveryProofId: proofId,
          attemptNumber: nextAttemptNumber,
          imagePath: stored.storedName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          submittedAt: now,
          submittedById: session.user.id,
          status: "PENDING",
        },
      });
    });
  } catch (error) {
    // The new file was already written before the transaction ran — clean
    // it up rather than orphaning it. The OLD attempt's file is never
    // touched by this function.
    await deleteProofImage(stored.storedName);
    return {
      error: error instanceof Error ? error.message : "Resubmission failed. Please try again.",
    };
  }

  revalidatePath("/driver");
  revalidatePath(`/driver/${proofId}`);
  return {};
}
