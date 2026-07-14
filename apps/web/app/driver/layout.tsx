import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getMyUnreadDeliveryNotificationCount } from "@/app/actions/delivery-notifications";

/**
 * Driver portal chrome (Delivery D1, notification bell added in D8) —
 * deliberately its own minimal layout, NOT the dashboard shell: drivers
 * never receive the sidebar, AI assistant, or any business-data markup.
 * Authorization does not live here — layouts are chrome; the
 * requireRole("DRIVER") guarantee runs inside each page (same philosophy
 * as lib/session-guard.ts documents for /dashboard).
 *
 * The badge fetch is wrapped in try/catch deliberately: Next.js does not
 * guarantee a layout's own render runs strictly after its child page's
 * requireRole() redirect has resolved, so a non-driver request could reach
 * this code path before the page-level guard takes effect. That is NOT a
 * security gap — getMyUnreadDeliveryNotificationCount() enforces its own
 * requireActionRole("DRIVER") independently and refuses to return any
 * count either way — it just means an uncaught throw here would render
 * Next's generic error screen instead of the clean redirect the page guard
 * already produces. The badge is decorative; if it can't be fetched for
 * any reason, it simply doesn't render.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  let unreadCount = 0;
  try {
    unreadCount = await getMyUnreadDeliveryNotificationCount();
  } catch {
    // See the comment above — the real gate is inside the action itself.
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-ink">Delivery Proof</h1>
          <p className="text-xs text-ink-dim">Driver portal</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/driver/notifications"
            className="relative rounded-lg border border-line px-4 py-2 text-sm text-ink-dim hover:text-ink hover:border-accent transition"
          >
            🔔 Notifications
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 rounded-full bg-danger text-surface text-[11px] font-medium grid place-items-center px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-dim hover:text-ink hover:border-accent transition"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
