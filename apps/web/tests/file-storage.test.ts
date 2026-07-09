import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import {
  MAX_UPLOAD_BYTES,
  detectImageType,
  resolveContainedPath,
  saveProofImage,
  readProofImage,
  deleteProofImage,
} from "../lib/file-storage";

// UPLOAD_DIR is set to ./prisma/test-uploads by vitest.config.ts.
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR!);

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

function fileOf(bytes: Uint8Array, name: string, declaredType: string): File {
  return new File([bytes], name, { type: declaredType });
}

const savedNames: string[] = [];

afterAll(async () => {
  for (const name of savedNames) {
    await deleteProofImage(name);
  }
});

describe("detectImageType — magic bytes decide, never the declared type", () => {
  it("recognizes exactly JPEG, PNG, and WebP", () => {
    expect(detectImageType(JPEG_BYTES)?.mimeType).toBe("image/jpeg");
    expect(detectImageType(PNG_BYTES)?.mimeType).toBe("image/png");
    expect(detectImageType(WEBP_BYTES)?.mimeType).toBe("image/webp");
  });

  it("rejects everything else (GIF, text, empty, truncated signatures)", () => {
    expect(detectImageType(GIF_BYTES)).toBeNull();
    expect(detectImageType(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
    expect(detectImageType(new Uint8Array([]))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    // RIFF container that is NOT WebP (e.g. WAV) must not pass.
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(detectImageType(wav)).toBeNull();
  });
});

describe("resolveContainedPath — generated names only, nothing escapes the root", () => {
  it("accepts a bare generated-style filename", () => {
    const resolved = resolveContainedPath("0d9c8a7b-1111-2222-3333-444455556666.jpg");
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(UPLOAD_ROOT + path.sep)).toBe(true);
  });

  it("rejects traversal, separators, absolute paths, and empties", () => {
    expect(resolveContainedPath("../secret.txt")).toBeNull();
    expect(resolveContainedPath("..\\secret.txt")).toBeNull();
    expect(resolveContainedPath("../../etc/passwd")).toBeNull();
    expect(resolveContainedPath("sub/dir.jpg")).toBeNull();
    expect(resolveContainedPath("sub\\dir.jpg")).toBeNull();
    expect(resolveContainedPath("/etc/passwd")).toBeNull();
    expect(resolveContainedPath("C:\\Windows\\system32\\x")).toBeNull();
    expect(resolveContainedPath("")).toBeNull();
    expect(resolveContainedPath("..")).toBeNull();
  });
});

describe("saveProofImage — validation order and safe persistence", () => {
  it("stores a valid image under a server-generated name and reads it back", async () => {
    const saved = await saveProofImage(fileOf(JPEG_BYTES, "IGNORED ../..name.php", "image/jpeg"));
    savedNames.push(saved.storedName);

    // Generated name: uuid.ext — nothing of the client filename survives.
    expect(saved.storedName).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(saved.mimeType).toBe("image/jpeg");
    expect(saved.sizeBytes).toBe(JPEG_BYTES.byteLength);

    const roundTrip = await readProofImage(saved.storedName);
    expect(roundTrip).not.toBeNull();
    expect(new Uint8Array(roundTrip!)).toEqual(JPEG_BYTES);
  });

  it("rejects a spoofed MIME type — GIF bytes declared as image/jpeg", async () => {
    await expect(
      saveProofImage(fileOf(GIF_BYTES, "fake.jpg", "image/jpeg"))
    ).rejects.toThrow(/JPEG, PNG, or WebP/);
  });

  it("rejects oversized uploads before touching content", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(JPEG_BYTES, 0);
    await expect(saveProofImage(fileOf(big, "big.jpg", "image/jpeg"))).rejects.toThrow(/too large/i);
  });

  it("rejects a missing or empty file", async () => {
    await expect(saveProofImage(null)).rejects.toThrow(/image file is required/i);
    await expect(saveProofImage("not-a-file")).rejects.toThrow(/image file is required/i);
    await expect(
      saveProofImage(fileOf(new Uint8Array([]), "empty.jpg", "image/jpeg"))
    ).rejects.toThrow(/image file is required/i);
  });
});

describe("readProofImage — containment enforced on the read path too", () => {
  it("returns null for traversal names even if the target file exists", async () => {
    // A real file one level above the upload root (the test DB) — a
    // tampered imagePath must not be able to read it.
    const dbPath = path.resolve(UPLOAD_ROOT, "../test.db");
    expect(existsSync(dbPath)).toBe(true);
    expect(await readFile(dbPath)).toBeTruthy(); // readable in general…
    expect(await readProofImage("../test.db")).toBeNull(); // …but not through here
  });

  it("returns null for unknown names", async () => {
    expect(await readProofImage("00000000-0000-0000-0000-000000000000.jpg")).toBeNull();
  });
});
