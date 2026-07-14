import { requireRole } from "@/lib/session-guard";
import {
  listMyDeliveryNotifications,
  markMyDeliveryNotificationsRead,
} from "@/app/actions/delivery-notifications";
import NotificationCard from "@/components/NotificationCard";

/**
 * Driver notification inbox (D8). requireRole is the page gate, same as
 * every other driver page; listMyDeliveryNotifications and
 * markMyDeliveryNotificationsRead independently re-check
 * requireActionRole("DRIVER") regardless of how they're called (D5/D7's
 * established finding: every export of a UI-referenced "use server" file
 * is a registered endpoint, so the guard inside each function is the real
 * boundary, not the call site).
 *
 * Ordering matters here: list() is called and its `read` flags captured
 * BEFORE markMyDeliveryNotificationsRead() runs, so what's rendered
 * reflects "what was unread when you opened this," not "everything
 * already marked read by the time you see it" — see
 * markMyDeliveryNotificationsRead's own comment for why mark-read is a
 * separate, later call rather than folded into the same query.
 */
export default async function DriverNotificationsPage() {
  await requireRole("DRIVER");
  const notifications = await listMyDeliveryNotifications();
  await markMyDeliveryNotificationsRead();

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <h1 className="text-lg font-semibold text-ink">Notifications</h1>

      {notifications.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
          No delivery events yet — you&apos;ll see updates here when the office
          reviews one of your proofs.
        </p>
      ) : (
        <ul className="space-y-3">
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationCard notification={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
