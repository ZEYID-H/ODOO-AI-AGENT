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

export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  return session;
}
