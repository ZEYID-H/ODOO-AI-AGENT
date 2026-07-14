/**
 * Authenticated delivery-proof image serving (Delivery Management D3).
 * Files live OUTSIDE the web root on the persistent volume — this route is
 * the only way an image ever reaches a browser, and it authorizes every
 * request:
 *
 *   no session                        → 401
 *   session without a recognized role → 403 (pre-D1 cookie, fails closed)
 *   DRIVER, someone else's proof      → 404 (indistinguishable from a
 *                                        missing proof — a proof id must
 *                                        not become an existence probe)
 *   OWNER                             → any proof
 *
 * The response streams bytes with the stored MIME type and no-store
 * caching; the filesystem location never appears anywhere. Path
 * containment is re-verified at read time (lib/file-storage.ts), so even
 * a tampered imagePath value cannot escape the storage directory.
 */

import { prisma } from "@/lib/db";
import { readProofImage } from "@/lib/file-storage";
import { authorizeImageViewer } from "@/lib/image-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const viewer = await authorizeImageViewer();
  if (viewer instanceof Response) return viewer;

  const { id } = await params;
  const proof = await prisma.deliveryProof.findUnique({
    where: { id },
    select: { imagePath: true, mimeType: true, driverId: true },
  });

  const notFound = () => new Response("Not found.", { status: 404 });

  if (!proof || !proof.imagePath) {
    return notFound();
  }
  if (viewer.role === "DRIVER" && proof.driverId !== viewer.userId) {
    return notFound();
  }

  const bytes = await readProofImage(proof.imagePath);
  if (!bytes) {
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": proof.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      // Belt and braces alongside the detected MIME type: never let a
      // browser interpret an uploaded file as anything but an image/file.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
