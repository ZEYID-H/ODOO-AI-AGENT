/**
 * The single piece of actual credential-checking logic, kept as a pure,
 * directly testable function so it isn't buried inside Auth.js's
 * `authorize()` callback (which needs a running Next.js/Auth.js context to
 * invoke at all).
 *
 * Deliberately minimal: one shared password from an environment variable —
 * no username, no user table, no database. This is the "Option A" gate for
 * personal/internal use. Swapping this out for a real user lookup (a
 * database, an external identity provider, roles, per-tenant Odoo
 * connections, etc.) later means replacing only this function's body; the
 * Auth.js wiring in auth.ts, the login form, and the /dashboard guard do not
 * need to change.
 */

export interface AppUser {
  id: string;
  name: string;
}

export function verifyAppPassword(password: unknown): AppUser | null {
  const expected = process.env.APP_ACCESS_PASSWORD;

  // Fail closed: if the operator hasn't configured a password, nobody can
  // log in rather than silently accepting anything.
  if (!expected) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  if (password !== expected) return null;

  return { id: "personal-user", name: "Personal Access" };
}
