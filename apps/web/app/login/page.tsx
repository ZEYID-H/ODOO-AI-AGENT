import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  // Already signed in — no need to show the form again.
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Sign In</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Odoo Business Intelligence Assistant — personal access
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
