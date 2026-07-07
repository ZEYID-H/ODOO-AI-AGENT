import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAppPassword } from "../lib/auth-credentials";

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
