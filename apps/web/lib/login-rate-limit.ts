/**
 * Brute-force protection for the single shared password (Phase 9 audit
 * finding: nothing previously stopped unlimited automated password
 * guessing against the ONLY auth boundary protecting all of this app's
 * data — see docs/AUTH_AND_PERSISTENCE.md).
 *
 * Deliberately global, not per-IP: there is exactly one account and one
 * password (lib/auth-credentials.ts), so a global limiter also blocks
 * distributed brute force, and doesn't depend on trusting a spoofable
 * X-Forwarded-For header. Kept as pure, directly-testable functions —
 * same pattern as verifyAppPassword — so app/actions/auth.ts (the actual
 * Server Action) stays a thin wrapper.
 *
 * Known limitation, stated plainly rather than glossed over: this state is
 * in-memory and per-process. It resets on every restart/redeploy and does
 * not coordinate across multiple instances. That matches this app's
 * current single-instance deployment model (see docs/DOCKER_SAAS_STACK.md,
 * docs/AUTH_AND_PERSISTENCE.md) — it is not a substitute for a real
 * distributed rate limiter if this is ever horizontally scaled.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

let failedAttempts: number[] = [];

function pruneOldAttempts(now: number): void {
  failedAttempts = failedAttempts.filter((t) => now - t < WINDOW_MS);
}

/** Call before attempting to verify a password. */
export function isLoginRateLimited(now: number = Date.now()): boolean {
  pruneOldAttempts(now);
  return failedAttempts.length >= MAX_ATTEMPTS;
}

/** Call after a failed password check. */
export function registerFailedLogin(now: number = Date.now()): void {
  pruneOldAttempts(now);
  failedAttempts.push(now);
}

/** Call after a successful login — a legitimate user who mistyped a few
 * times shouldn't stay penalized once they get it right. */
export function resetLoginRateLimit(): void {
  failedAttempts = [];
}
