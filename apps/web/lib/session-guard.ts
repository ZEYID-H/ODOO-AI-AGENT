/**
 * The real protection for /dashboard. Per Next.js's own authentication
 * guidance, Proxy (formerly Middleware) is explicitly documented as
 * insufficient as the sole authorization layer — it's only recommended for
 * fast "optimistic" redirects. The actual guarantee has to live as close to
 * the protected content as possible: a server-side check in the page
 * component itself, which is what this function is called from.
 *
 * This project deliberately does not add a proxy.ts for /dashboard: it
 * would only offer a marginal UX nicety (skip a render before redirecting)
 * at the cost of coupling to Next.js 16's very new Proxy convention, for no
 * additional security — requireSession() below is the actual guarantee,
 * and it runs on every request to the page regardless of Proxy.
 */

import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";
import type { Role } from "@/lib/auth-credentials";

export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** Where each role belongs — the redirect target when a page isn't theirs. */
export const ROLE_HOME: Record<Role, string> = {
  OWNER: "/dashboard",
  DRIVER: "/driver",
};

/**
 * Role-gated variant of requireSession() (Delivery D1). Same philosophy as
 * above: this runs server-side inside the page component itself, so a
 * request from the wrong role never receives the page's markup at all —
 * hiding navigation client-side is UX, never authorization.
 *
 * A session with no role claim (a cookie minted before D1) or an
 * unrecognized one fails closed to /login, where signing in again issues
 * a token that carries a role.
 */
export async function requireRole(role: Role): Promise<Session> {
  const session = await requireSession();
  const actual = session.user.role;
  if (actual !== role) {
    redirect(actual === "OWNER" || actual === "DRIVER" ? ROLE_HOME[actual] : "/login");
  }
  return session;
}

/**
 * Server Action variants (D1.1 security closure). Pages redirect; actions
 * must THROW instead — a Server Action is a directly invokable RPC
 * endpoint, and its failure mode has to be a refused call, not a
 * navigation hint. Every Server Action starts with one of these before any
 * business logic (permanent rule — see docs/PROJECT_DEVELOPMENT_GUIDE.md);
 * the only exempt actions are the authentication entry/exit points
 * themselves (loginAction/logoutAction), which cannot require the session
 * they exist to establish/destroy.
 *
 * Error messages are deliberately generic: they reveal that access was
 * refused, never why or what exists.
 */
export async function requireActionSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated.");
  }
  return session;
}

export async function requireActionRole(role: Role): Promise<Session> {
  const session = await requireActionSession();
  if (session.user.role !== role) {
    throw new Error("Not authorized.");
  }
  return session;
}
