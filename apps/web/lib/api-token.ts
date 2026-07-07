/**
 * Signs the short-lived JWT apps/web uses to prove a request to apps/api
 * genuinely comes from an authenticated session (Phase 10) — the other
 * half of the trust boundary apps/api/auth.py verifies. See
 * docs/API_AUTHENTICATION.md for the full design (algorithm, lifetime,
 * key management, rotation).
 *
 * server-only: the signing secret (API_AUTH_SECRET) must never reach the
 * browser bundle. Only app/actions/api-token.ts (a Server Action) calls
 * this — never a Client Component directly.
 */

import "server-only";
import { SignJWT } from "jose";

const ALGORITHM = "HS256";
const ISSUER = "odoo-ai-agent-web";
const AUDIENCE = "odoo-ai-agent-api";
// Short on purpose: limits the window a token is useful for if it were
// ever intercepted (it does transit through the browser — lib/api.ts
// attaches it to a client-side fetch call to apps/api, which is why this
// is short-lived rather than a long-lived static secret). A fresh token
// is minted per request (see app/actions/api-token.ts), not cached, so
// there's no session-length UX tradeoff to a short lifetime here.
const TOKEN_LIFETIME = "5m";

function getSecretKey(): Uint8Array {
  const secret = process.env.API_AUTH_SECRET;
  if (!secret) {
    // Fails closed: no silent "skip signing" fallback. Matches
    // verifyAppPassword's fail-closed behavior — an unconfigured secret
    // must never be treated as "auth not required."
    throw new Error(
      "API_AUTH_SECRET is not configured — cannot mint a backend API token."
    );
  }
  return new TextEncoder().encode(secret);
}

/** Mints a fresh, short-lived token asserting `userId` as the subject.
 * Callers must have already verified the caller's Auth.js session
 * themselves (see app/actions/api-token.ts) — this function signs
 * whatever subject it's given and does not re-check identity itself. */
export async function mintApiToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(getSecretKey());
}
