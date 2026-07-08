/**
 * Credential checking for the minimal identity foundation (Delivery
 * Management D1 — see docs/DELIVERY_MANAGEMENT_PLAN.md §2): individual
 * username/password accounts on the User table, exactly two roles, no
 * user-management system. This replaces the pre-D1 single shared
 * APP_ACCESS_PASSWORD check; the file keeps its original shape — pure(ish),
 * directly testable functions that auth.ts's authorize() stays a thin
 * wrapper around — because auth.ts itself can't be unit-tested outside a
 * real Next.js runtime.
 *
 * Accounts are created only by scripts/seed-users.ts. Rows backfilled by
 * the D1 migration carry an empty passwordHash, which can never match —
 * unseeded accounts fail closed.
 */

import { compare } from "bcryptjs";
import { prisma } from "./db";
import { isLoginRateLimited, registerFailedLogin, resetLoginRateLimit } from "./login-rate-limit";

export type Role = "OWNER" | "DRIVER";

export interface AppUser {
  id: string;
  name: string;
  role: Role;
}

/**
 * Real bcrypt hash of a fixed non-account string. When the username doesn't
 * exist (or the row has no usable hash), we still run one compare against
 * this so the response time doesn't reveal whether a username exists —
 * otherwise "unknown user" returns in microseconds and "known user, wrong
 * password" takes a full bcrypt verification, a classic enumeration oracle.
 */
const DUMMY_HASH = "$2b$10$wyHqkTlJKtJrlJSFsKoSjOiqgFAIixB7744Xgru5SLwISxmKnStTG";

function parseRole(value: string): Role | null {
  return value === "OWNER" || value === "DRIVER" ? value : null;
}

export async function verifyCredentials(
  username: unknown,
  password: unknown
): Promise<AppUser | null> {
  if (typeof username !== "string" || username.length === 0) return null;
  if (typeof password !== "string" || password.length === 0) return null;

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || user.passwordHash.length === 0) {
    await compare(password, DUMMY_HASH);
    return null;
  }

  const ok = await compare(password, user.passwordHash);
  if (!ok) return null;

  // A row whose role column holds anything but the two known values (only
  // possible through manual DB edits) must not produce a session at all.
  const role = parseRole(user.role);
  if (!role) return null;

  return { id: user.id, name: user.username, role };
}

/**
 * The full login decision, including per-username brute-force protection —
 * this is what auth.ts's authorize() calls directly, so it's the one
 * chokepoint every sign-in attempt funnels through (the Server Action
 * login form AND Auth.js's own raw /api/auth/callback/credentials route,
 * which bypasses the form entirely).
 */
export async function attemptLogin(
  username: unknown,
  password: unknown
): Promise<AppUser | null> {
  const key = typeof username === "string" ? username : "";
  if (isLoginRateLimited(key)) {
    return null;
  }
  const user = await verifyCredentials(username, password);
  if (!user) {
    registerFailedLogin(key);
    return null;
  }
  resetLoginRateLimit(key);
  return user;
}
