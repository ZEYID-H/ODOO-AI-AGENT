import { logoutAction } from "@/app/actions/auth";

/**
 * Driver portal chrome (Delivery D1) — deliberately its own minimal layout,
 * NOT the dashboard shell: drivers never receive the sidebar, AI assistant,
 * or any business-data markup. Authorization does not live here — layouts
 * are chrome; the requireRole("DRIVER") guarantee runs inside each page
 * (same philosophy as lib/session-guard.ts documents for /dashboard).
 */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-ink">Delivery Proof</h1>
          <p className="text-xs text-ink-dim">Driver portal</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-dim hover:text-ink hover:border-accent transition"
          >
            Log out
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
