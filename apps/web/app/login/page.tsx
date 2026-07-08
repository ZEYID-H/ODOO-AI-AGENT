import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_HOME } from "@/lib/session-guard";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  // Already signed in — straight to the role's own home, no form. A session
  // without a role claim (pre-D1 cookie) falls through to the form so
  // signing in again reissues a token that carries one.
  const session = await auth();
  const role = session?.user?.role;
  if (role === "OWNER" || role === "DRIVER") {
    redirect(ROLE_HOME[role]);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Sign In</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Odoo Business Intelligence Assistant
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
