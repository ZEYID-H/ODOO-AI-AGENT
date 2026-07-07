"use server";

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
  // Phase 9 audit fix: brute-force protection on the single shared
  // password. The actual enforcement (registering failures, resetting on
  // success) lives in auth.ts's authorize() callback — the one chokepoint
  // every sign-in attempt funnels through, including Auth.js's own raw
  // /api/auth/callback/credentials route, which bypasses this Server
  // Action entirely. This check here is a UX nicety only: it skips calling
  // signIn() at all once already locked out, so the form can show the
  // specific "too many attempts" message instead of a generic
  // "invalid password" (which is what authorize() returning null produces
  // either way — callers of the raw endpoint never see this message, by
  // design, since it would reveal rate-limit state).
  if (isLoginRateLimited()) {
    return { error: "Too many attempts. Please wait a minute and try again." };
  }

  try {
    await signIn("credentials", {
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    // signIn() throws Next's redirect signal on success — only AuthError
    // (wrong/missing password) should be turned into a form error; anything
    // else (including the redirect) must be rethrown, never swallowed.
    if (error instanceof AuthError) {
      return { error: "Invalid password. Please try again." };
    }
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
