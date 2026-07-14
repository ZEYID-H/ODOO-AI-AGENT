/**
 * Shared authorization boundary for delivery-proof image routes (D3's
 * current-image route and D7's attempt-history-image route). Factored out
 * so the 401/403 boundary can't drift between the two routes — a security
 * check duplicated in two files is a check that can silently diverge when
 * only one copy gets updated.
 */

import "server-only";
import { auth } from "@/auth";

export type ImageViewerRole = "OWNER" | "DRIVER";

/**
 * Returns the caller's role and id when they're allowed to request ANY
 * protected delivery-proof image, or a ready-to-return Response for the
 * standard refusal otherwise:
 *   no session                        -> 401
 *   session without a recognized role -> 403 (pre-D1 cookie, fails closed)
 * Callers still enforce ownership themselves (DRIVER: own proofs only,
 * OWNER: any) — this only establishes "is this caller allowed in the door
 * at all."
 */
export async function authorizeImageViewer(): Promise<
  { role: ImageViewerRole; userId: string } | Response
> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Not authenticated.", { status: 401 });
  }
  const role = session.user.role;
  if (role !== "OWNER" && role !== "DRIVER") {
    return new Response("Not authorized.", { status: 403 });
  }
  return { role, userId: session.user.id };
}
