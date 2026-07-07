import { beforeEach, describe, expect, it } from "vitest";
import {
  isLoginRateLimited,
  registerFailedLogin,
  resetLoginRateLimit,
} from "../lib/login-rate-limit";

// Explicit timestamps throughout — never relies on real wall-clock timing,
// so this suite can't flake under CI scheduling variance.
const T0 = 1_000_000;

beforeEach(() => {
  resetLoginRateLimit();
});

describe("login rate limiting (Phase 9 audit fix)", () => {
  it("is not rate-limited with no failures", () => {
    expect(isLoginRateLimited(T0)).toBe(false);
  });

  it("is not rate-limited below the threshold", () => {
    for (let i = 0; i < 4; i++) registerFailedLogin(T0 + i);
    expect(isLoginRateLimited(T0 + 4)).toBe(false);
  });

  it("rate-limits once the threshold is reached within the window", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(T0 + i);
    expect(isLoginRateLimited(T0 + 5)).toBe(true);
  });

  it("stops counting attempts once the window has fully elapsed", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(T0 + i);
    expect(isLoginRateLimited(T0 + 5)).toBe(true);
    // 61 seconds after the first failure — outside the 60s window.
    expect(isLoginRateLimited(T0 + 61_000)).toBe(false);
  });

  it("resets cleanly on a successful login", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(T0 + i);
    expect(isLoginRateLimited(T0 + 5)).toBe(true);
    resetLoginRateLimit();
    expect(isLoginRateLimited(T0 + 5)).toBe(false);
  });
});
