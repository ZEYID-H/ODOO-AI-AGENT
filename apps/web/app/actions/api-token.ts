"use server";

/**
 * Issues the short-lived token lib/api.ts attaches to every apps/api
 * call (Phase 10 trust boundary — see docs/API_AUTHENTICATION.md).
 *
 * This is the ONLY place a token is minted: it re-derives the user id
 * from the server-side Auth.js session (never trusts a client-supplied
 * id, same principle as app/actions/conversations.ts's requireUserId())
 * and signs a token asserting exactly that id. A Client Component can
 * call this (it's a Server Action, so the RPC boundary is enforced by
 * Next.js itself) but can never see or influence the signing secret.
 */

import { requireActionRole } from "@/lib/session-guard";
import { mintApiToken } from "@/lib/api-token";

export async function getApiToken(): Promise<string> {
  // Delivery D1/D1.1: the AI endpoints are owner-only. A DRIVER session
  // never renders the chat UI, but Server Actions are directly invokable
  // endpoints — so the role is enforced here, not just by page routing.
  // Fails closed for pre-D1 sessions with no role claim.
  const session = await requireActionRole("OWNER");
  return mintApiToken(session.user.id);
}
