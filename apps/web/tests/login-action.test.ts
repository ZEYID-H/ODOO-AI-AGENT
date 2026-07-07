import { afterEach, describe, expect, it, vi } from "vitest";

// Importing the real "next-auth" package root (even just for the AuthError
// class) transitively pulls in next-auth/lib/env.js -> "next/server", which
// Node's plain ESM resolver (unlike Next's own bundler) can't resolve —
// same category of issue as mocking "server-only" in session-guard.test.ts.
// A minimal same-shape AuthError stand-in avoids the real module graph
// entirely while keeping `instanceof AuthError` checks meaningful. Defined
// inline (not referencing an outer binding) because vi.mock factories are
// hoisted above the rest of the module.
vi.mock("next-auth", () => ({
  AuthError: class FakeAuthError extends Error {},
}));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/login-rate-limit", () => ({ isLoginRateLimited: vi.fn() }));

import { AuthError as FakeAuthError } from "next-auth";
import { signIn } from "@/auth";
import { isLoginRateLimited } from "@/lib/login-rate-limit";
import { loginAction } from "../app/actions/auth";

const mockedSignIn = vi.mocked(signIn);
const mockedIsLoginRateLimited = vi.mocked(isLoginRateLimited);

function formDataWith(password: string): FormData {
  const fd = new FormData();
  fd.set("password", password);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

// The *actual* rate-limit enforcement (registering failures, resetting on
// success) lives in auth.ts's authorize() callback, not here — see the
// comment in app/actions/auth.ts for why, and lib/login-rate-limit.ts's own
// test file for that counter's behavior. loginAction only consults
// isLoginRateLimited() as a UX short-circuit, which is what these tests
// cover in isolation.
describe("loginAction (Phase 9 audit fix: rate-limit short-circuit)", () => {
  it("returns a generic invalid-password error on a wrong password", async () => {
    mockedIsLoginRateLimited.mockReturnValue(false);
    mockedSignIn.mockRejectedValue(new FakeAuthError("CredentialsSignin"));

    const state = await loginAction(undefined, formDataWith("wrong"));

    expect(state.error).toBe("Invalid password. Please try again.");
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("short-circuits with a specific message and never calls signIn() when already rate-limited", async () => {
    mockedIsLoginRateLimited.mockReturnValue(true);

    const state = await loginAction(undefined, formDataWith("wrong"));

    expect(state.error).toBe("Too many attempts. Please wait a minute and try again.");
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("rethrows a non-AuthError (signIn()'s success-redirect signal) rather than swallowing it", async () => {
    mockedIsLoginRateLimited.mockReturnValue(false);
    mockedSignIn.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(loginAction(undefined, formDataWith("correct"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
  });
});
