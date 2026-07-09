"use server";

/**
 * D1.1 audit note: these two actions are the ONLY Server Actions exempt
 * from the requireSession()/requireRole() rule
 * (docs/PROJECT_DEVELOPMENT_GUIDE.md §4) — they are the authentication
 * boundary itself. loginAction cannot require the session it exists to
 * establish; logoutAction destroys whatever session exists and is a
 * harmless no-op without one. Neither touches business data.
 */

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { isLoginRateLimited } from "@/lib/login-rate-limit";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  const username = formData.get("username");

  // Phase 9 audit fix, per-username since D1: the actual enforcement
  // (registering failures, resetting on success) lives in auth.ts's
  // authorize() callback — the one chokepoint every sign-in attempt
  // funnels through, including Auth.js's own raw
  // /api/auth/callback/credentials route, which bypasses this Server
  // Action entirely. This check here is a UX nicety only: it skips calling
  // signIn() at all once already locked out, so the form can show the
  // specific "too many attempts" message instead of a generic
  // "invalid credentials" (which is what authorize() returning null
  // produces either way — callers of the raw endpoint never see this
  // message, by design, since it would reveal rate-limit state).
  if (isLoginRateLimited(typeof username === "string" ? username : "")) {
    return { error: "Too many attempts. Please wait a minute and try again." };
  }

  try {
    // redirectTo is deliberately /dashboard for every role: the dashboard's
    // own requireRole("OWNER") guard immediately forwards a DRIVER to
    // /driver server-side, so a driver never sees dashboard content — this
    // keeps the action role-agnostic instead of duplicating role-routing
    // knowledge that already lives in lib/session-guard.ts.
    await signIn("credentials", {
      username,
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    // signIn() throws Next's redirect signal on success — only AuthError
    // (wrong/missing credentials) should be turned into a form error;
    // anything else (including the redirect) must be rethrown, never
    // swallowed.
    if (error instanceof AuthError) {
      return { error: "Invalid username or password. Please try again." };
    }
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
