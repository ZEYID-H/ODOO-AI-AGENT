/**
 * Delivery-proof image storage (Delivery Management D3 — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §6/§7). Files live on the persistent
 * volume (UPLOAD_DIR, /data/delivery-proofs in Docker — beside the SQLite
 * file, so one volume carries both), never under public/ or the repo.
 *
 * Security posture, in order of the checks below:
 * - Size is capped before anything else looks at the bytes.
 * - The content type is decided by MAGIC BYTES, never by the client's
 *   declared MIME type or filename — a .jpg that doesn't start with a JPEG
 *   signature is rejected, whatever the browser claimed.
 * - Filenames are generated server-side (crypto.randomUUID + extension
 *   derived from the detected type). The client's original filename is
 *   never used for anything, so path traversal via filename is impossible
 *   by construction.
 * - Reads re-verify containment anyway (defense in depth): the stored name
 *   must resolve to a path inside UPLOAD_DIR, so even a tampered database
 *   value cannot reach outside the storage directory.
 */

import "server-only";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // phone photos run 3–12MB

export interface DetectedImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./.uploads");
}

/** Magic-byte sniffing for exactly the three allowed formats. */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return { mimeType: "image/png", extension: "png" };
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * Resolves a stored image name to its on-disk path, refusing anything that
 * escapes the storage directory. The stored value is expected to be a bare
 * generated filename; anything with separators, drive letters, or dot
 * segments fails the containment check.
 */
export function resolveContainedPath(storedName: string): string | null {
  if (typeof storedName !== "string" || storedName.length === 0) return null;
  const root = uploadRoot();
  const resolved = path.resolve(root, storedName);
  if (resolved !== path.join(root, path.basename(resolved)) || !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Validates and persists an uploaded image. Returns the generated filename
 * (what goes in DeliveryProof.imagePath) plus the detected type/size.
 * Throws with a user-facing message on any validation failure.
 */
/**
 * Structural check instead of `instanceof File`: the File that comes out of
 * Next's server-side multipart decoding is constructed in a different
 * module realm than the global File, so instanceof is false for real
 * browser uploads even though the object is a perfectly good file. (Found
 * by D3's wire-level verification — unit tests construct same-realm Files
 * and can't catch this.) FormData.get() returns string | File, so
 * "non-string with Blob's methods" is exactly a file part.
 */
function isFileLike(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number"
  );
}

export async function saveProofImage(file: unknown): Promise<{
  storedName: string;
  mimeType: DetectedImage["mimeType"];
  sizeBytes: number;
}> {
  if (!isFileLike(file) || file.size === 0) {
    throw new Error("An image file is required.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is too large (maximum 10 MB).");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Image is too large (maximum 10 MB).");
  }

  const detected = detectImageType(bytes);
  if (!detected) {
    throw new Error("Only JPEG, PNG, or WebP images are accepted.");
  }

  const storedName = `${randomUUID()}.${detected.extension}`;
  const target = resolveContainedPath(storedName);
  if (!target) {
    throw new Error("Could not store the image.");
  }

  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" }); // never overwrite
  return { storedName, mimeType: detected.mimeType, sizeBytes: bytes.byteLength };
}

/** Reads a stored image; null when the name is invalid, escapes the
 * storage directory, or the file no longer exists. */
export async function readProofImage(storedName: string): Promise<Buffer | null> {
  const target = resolveContainedPath(storedName);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

/** Best-effort cleanup for a file whose DB row failed to materialize. */
export async function deleteProofImage(storedName: string): Promise<void> {
  const target = resolveContainedPath(storedName);
  if (!target) return;
  try {
    await unlink(target);
  } catch {
    // Already gone — nothing to clean.
  }
}
