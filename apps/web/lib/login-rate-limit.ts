/**
 * Brute-force protection for login (Phase 9 audit finding, reworked for
 * Delivery Management D1's individual accounts — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §2).
 *
 * Keyed per-username, no longer global: with multiple real accounts a
 * global counter would let one driver's typos lock out everyone including
 * the owner, and per-IP keying would depend on trusting a spoofable
 * X-Forwarded-For header. Keying by the *attempted* username means an
 * attacker hammering one account can't deny service to the others, while
 * still blocking distributed guessing against any single account. Kept as
 * pure, directly-testable functions — same pattern as before.
 *
 * Known limitation, stated plainly rather than glossed over: this state is
 * in-memory and per-process. It resets on every restart/redeploy and does
 * not coordinate across multiple instances. That matches this app's
 * current single-instance deployment model (see docs/DOCKER_SAAS_STACK.md,
 * docs/AUTH_AND_PERSISTENCE.md) — it is not a substitute for a real
 * distributed rate limiter if this is ever horizontally scaled. Memory is
 * bounded by pruning: a key with no failures inside the window is removed
 * entirely on the next touch, and expired entries are swept opportunistically.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

const failedByKey = new Map<string, number[]>();

function recentAttempts(key: string, now: number): number[] {
  const kept = (failedByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (kept.length === 0) {
    failedByKey.delete(key);
  } else {
    failedByKey.set(key, kept);
  }
  return kept;
}

/** Call before attempting to verify credentials for this username. */
export function isLoginRateLimited(username: string, now: number = Date.now()): boolean {
  return recentAttempts(username, now).length >= MAX_ATTEMPTS;
}

/** Call after a failed credential check for this username. */
export function registerFailedLogin(username: string, now: number = Date.now()): void {
  const kept = recentAttempts(username, now);
  kept.push(now);
  failedByKey.set(username, kept);
}

/**
 * Call after a successful login — a legitimate user who mistyped a few
 * times shouldn't stay penalized once they get it right. With no argument,
 * clears all state (used by tests).
 */
export function resetLoginRateLimit(username?: string): void {
  if (username === undefined) {
    failedByKey.clear();
  } else {
    failedByKey.delete(username);
  }
}
