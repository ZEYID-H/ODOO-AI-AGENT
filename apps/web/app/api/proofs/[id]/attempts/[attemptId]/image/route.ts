/**
 * Authenticated attempt-history image serving (D7). Sibling of
 * app/api/proofs/[id]/image/route.ts (the CURRENT-image route, untouched
 * by D7) — this route serves a specific historical DeliveryProofAttempt's
 * image, so previous evidence stays viewable after a resubmission without
 * ever being publicly exposed. Shares its authorization boundary with the
 * current-image route via lib/image-auth.ts, so the two routes cannot
 * silently diverge on who's allowed to see what.
 *
 * Authorization (identical semantics to the current-image route):
 *   no session                        -> 401
 *   session without a recognized role -> 403 (pre-D1 cookie, fails closed)
 *   DRIVER, someone else's proof      -> 404 (indistinguishable from a
 *                                        missing attempt/proof)
 *   OWNER                             -> any attempt
 *
 * Both [id] (the parent proof) and [attemptId] are required and
 * cross-checked (`deliveryProofId: id` in the WHERE clause) — an attempt id
 * alone is never sufficient, so a client cannot address an attempt without
 * also asserting which proof it belongs to.
 */

import { prisma } from "@/lib/db";
import { readProofImage } from "@/lib/file-storage";
import { authorizeImageViewer } from "@/lib/image-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attemptId: string }> }
): Promise<Response> {
  const viewer = await authorizeImageViewer();
  if (viewer instanceof Response) return viewer;

  const { id, attemptId } = await params;
  const attempt = await prisma.deliveryProofAttempt.findFirst({
    where: { id: attemptId, deliveryProofId: id },
    select: {
      imagePath: true,
      mimeType: true,
      deliveryProof: { select: { driverId: true } },
    },
  });

  const notFound = () => new Response("Not found.", { status: 404 });

  if (!attempt || !attempt.imagePath) {
    return notFound();
  }
  if (viewer.role === "DRIVER" && attempt.deliveryProof.driverId !== viewer.userId) {
    return notFound();
  }

  const bytes = await readProofImage(attempt.imagePath);
  if (!bytes) {
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": attempt.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
