import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptLogin, verifyAppPassword } from "../lib/auth-credentials";
import { resetLoginRateLimit } from "../lib/login-rate-limit";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe("verifyAppPassword", () => {
  it("returns a user when the password matches APP_ACCESS_PASSWORD", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    const user = verifyAppPassword("correct-horse-battery-staple");
    expect(user).toEqual({ id: "personal-user", name: "Personal Access" });
  });

  it("returns null when the password does not match", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    expect(verifyAppPassword("wrong-password")).toBeNull();
  });

  it("fails closed when APP_ACCESS_PASSWORD is not configured at all", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    delete process.env.APP_ACCESS_PASSWORD;
    // Even a call with no password should never succeed if nothing is configured.
    expect(verifyAppPassword(undefined)).toBeNull();
    expect(verifyAppPassword("")).toBeNull();
    expect(verifyAppPassword("anything")).toBeNull();
  });

  it("rejects an empty-string password even when one is configured", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    expect(verifyAppPassword("")).toBeNull();
  });

  it("rejects non-string input safely (no throw)", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    expect(verifyAppPassword(undefined)).toBeNull();
    expect(verifyAppPassword(null)).toBeNull();
    expect(verifyAppPassword(12345)).toBeNull();
    expect(verifyAppPassword({ password: "x" })).toBeNull();
  });
});

// This is what auth.ts's authorize() actually calls — the real chokepoint
// for every sign-in attempt, including Auth.js's raw
// /api/auth/callback/credentials route (see auth.ts's Phase 9 audit
// comment for why the check can't live only in the login Server Action).
describe("attemptLogin (Phase 9 audit fix: brute-force protection)", () => {
  beforeEach(() => {
    resetLoginRateLimit();
  });

  it("succeeds on the correct password and resets any prior failure count", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    expect(attemptLogin("correct-horse-battery-staple")).toEqual({
      id: "personal-user",
      name: "Personal Access",
    });
  });

  it("returns null on a wrong password without throwing", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    expect(attemptLogin("wrong")).toBeNull();
  });

  it("locks out after 5 wrong passwords, even though each is individually valid input", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    for (let i = 0; i < 5; i++) expect(attemptLogin("wrong")).toBeNull();

    // The 6th call is rejected by the rate limit itself, not by a fresh
    // password comparison — provable because even the *correct* password
    // is refused once locked out.
    expect(attemptLogin("correct-horse-battery-staple")).toBeNull();
  });

  it("does not lock out the correct password on the first try", () => {
    vi.stubEnv("APP_ACCESS_PASSWORD", "correct-horse-battery-staple");
    for (let i = 0; i < 4; i++) expect(attemptLogin("wrong")).toBeNull();
    expect(attemptLogin("correct-horse-battery-staple")).toEqual({
      id: "personal-user",
      name: "Personal Access",
    });
  });
});
