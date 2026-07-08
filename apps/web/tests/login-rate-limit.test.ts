import { beforeEach, describe, expect, it } from "vitest";
import {
  isLoginRateLimited,
  registerFailedLogin,
  resetLoginRateLimit,
} from "../lib/login-rate-limit";

// Explicit timestamps throughout — never relies on real wall-clock timing,
// so this suite can't flake under CI scheduling variance.
const T0 = 1_000_000;
const USER = "driver_ahmed";
const OTHER = "admin";

beforeEach(() => {
  resetLoginRateLimit();
});

describe("login rate limiting (per-username since Delivery D1)", () => {
  it("is not rate-limited with no failures", () => {
    expect(isLoginRateLimited(USER, T0)).toBe(false);
  });

  it("is not rate-limited below the threshold", () => {
    for (let i = 0; i < 4; i++) registerFailedLogin(USER, T0 + i);
    expect(isLoginRateLimited(USER, T0 + 4)).toBe(false);
  });

  it("rate-limits once the threshold is reached within the window", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(USER, T0 + i);
    expect(isLoginRateLimited(USER, T0 + 5)).toBe(true);
  });

  it("keys strictly per-username: one account's failures never affect another", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(USER, T0 + i);
    expect(isLoginRateLimited(USER, T0 + 5)).toBe(true);
    expect(isLoginRateLimited(OTHER, T0 + 5)).toBe(false);
  });

  it("stops counting attempts once the window has fully elapsed", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(USER, T0 + i);
    expect(isLoginRateLimited(USER, T0 + 5)).toBe(true);
    // 61 seconds after the first failure — outside the 60s window.
    expect(isLoginRateLimited(USER, T0 + 61_000)).toBe(false);
  });

  it("resets a single username cleanly on successful login, leaving others locked", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(USER, T0 + i);
    for (let i = 0; i < 5; i++) registerFailedLogin(OTHER, T0 + i);
    resetLoginRateLimit(USER);
    expect(isLoginRateLimited(USER, T0 + 5)).toBe(false);
    expect(isLoginRateLimited(OTHER, T0 + 5)).toBe(true);
  });

  it("clears all state when called with no username (test hook)", () => {
    for (let i = 0; i < 5; i++) registerFailedLogin(USER, T0 + i);
    resetLoginRateLimit();
    expect(isLoginRateLimited(USER, T0 + 5)).toBe(false);
  });
});
