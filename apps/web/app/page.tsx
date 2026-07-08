import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_HOME } from "@/lib/session-guard";

const BADGES = ["Read Only", "Secure", "Odoo Connected", "GPT Powered"];

export default async function Home() {
  // Signed-in users land straight on their role's home (Delivery D1) —
  // a DRIVER never needs the marketing page's "Enter Dashboard" path.
  const session = await auth();
  const role = session?.user?.role;
  if (role === "OWNER" || role === "DRIVER") {
    redirect(ROLE_HOME[role]);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-xl w-full text-center space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">
            Odoo Business Intelligence Assistant
          </h1>
          <p className="mt-2 text-ink-dim">
            Read-only AI assistant for business analytics and reporting
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {BADGES.map((b) => (
            <span
              key={b}
              className="text-xs px-3 py-1 rounded-full border border-line bg-surface-2 text-ink-dim"
            >
              ✅ {b}
            </span>
          ))}
        </div>

        {/*
          /dashboard is server-side gated (lib/session-guard.ts) — an
          unauthenticated click here lands on /login, not the dashboard.
        */}
        <Link
          href="/dashboard"
          className="inline-block mt-4 px-6 py-3 rounded-lg bg-accent text-surface font-medium hover:opacity-90 transition"
        >
          Enter Dashboard →
        </Link>

        <p className="text-xs text-ink-dim pt-4">
          Internal use — accounts are provisioned by the administrator.
        </p>
      </div>
    </main>
  );
}
