import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import path from "path";
import { rm, writeFile } from "fs/promises";
import { auth } from "@/auth";
import { uploadDeliveryProof, listMyDeliveryProofs } from "@/app/actions/delivery-proofs";
import { GET as getProofImage } from "@/app/api/proofs/[id]/image/route";
import { deleteProofImage } from "@/lib/file-storage";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `up-owner-${RUN}`;
const DRIVER_A = `up-driver-a-${RUN}`;
const DRIVER_B = `up-driver-b-${RUN}`;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

function uploadForm(fields: Record<string, string>, image?: File): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (image) fd.set("image", image);
  return fd;
}

function jpegFile(): File {
  return new File([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" });
}

function imageRequest(proofId: string) {
  return getProofImage(new Request(`http://localhost/api/proofs/${proofId}/image`), {
    params: Promise.resolve({ id: proofId }),
  });
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: OWNER_ID, username: OWNER_ID, passwordHash: "", role: "OWNER" },
      { id: DRIVER_A, username: DRIVER_A, passwordHash: "", role: "DRIVER" },
      { id: DRIVER_B, username: DRIVER_B, passwordHash: "", role: "DRIVER" },
    ],
  });
});

afterAll(async () => {
  const proofs = await prisma.deliveryProof.findMany({
    where: { driverId: { in: [DRIVER_A, DRIVER_B] } },
    select: { imagePath: true },
  });
  for (const p of proofs) {
    if (p.imagePath) await deleteProofImage(p.imagePath);
  }
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_A, DRIVER_B] } } });
  await rm(path.resolve(process.env.UPLOAD_DIR!, "../escape-target.txt"), { force: true });
});

describe("uploadDeliveryProof (D3) — driver uploads an image", () => {
  it("stores the image and creates the proof row atomically for the session driver", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const state = await uploadDeliveryProof(undefined, uploadForm(
      { invoiceNumber: " INV-3001 ", customerName: "APPLE MART", notes: "front door" },
      jpegFile()
    ));

    expect(state.error).toBeUndefined();

    const row = await prisma.deliveryProof.findFirst({
      where: { driverId: DRIVER_A, invoiceNumber: "INV-3001" },
    });
    expect(row).not.toBeNull();
    expect(row!.mimeType).toBe("image/jpeg");
    expect(row!.sizeBytes).toBe(JPEG_BYTES.byteLength);
    expect(row!.status).toBe("PENDING");
    // Server-generated name only — never the client's "photo.jpg".
    expect(row!.imagePath).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it("appears in the driver's own uploads list", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const mine = await listMyDeliveryProofs();
    expect(mine.some((p) => p.invoiceNumber === "INV-3001" && p.imagePath)).toBe(true);
  });

  it("returns form-state errors for invalid images (spoofed MIME, missing, oversized)", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");

    const spoofed = new File([GIF_BYTES], "fake.jpg", { type: "image/jpeg" });
    expect((await uploadDeliveryProof(undefined, uploadForm({}, spoofed))).error).toMatch(
      /JPEG, PNG, or WebP/
    );

    expect((await uploadDeliveryProof(undefined, uploadForm({}))).error).toMatch(
      /image file is required/i
    );

    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(JPEG_BYTES, 0);
    const bigFile = new File([big], "big.jpg", { type: "image/jpeg" });
    expect((await uploadDeliveryProof(undefined, uploadForm({}, bigFile))).error).toMatch(
      /too large/i
    );
  });

  it("rejects invalid metadata without leaving a stored file behind", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const before = await prisma.deliveryProof.count({ where: { driverId: DRIVER_A } });

    const state = await uploadDeliveryProof(undefined, uploadForm(
      { invoiceNumber: "x".repeat(65) },
      jpegFile()
    ));

    expect(state.error).toMatch(/64/);
    expect(await prisma.deliveryProof.count({ where: { driverId: DRIVER_A } })).toBe(before);
  });

  it("is refused for OWNER, role-less, and unauthenticated sessions", async () => {
    const form = () => uploadForm({}, jpegFile());

    mockSessionFor(OWNER_ID, "OWNER");
    await expect(uploadDeliveryProof(undefined, form())).rejects.toThrow(/not authorized/i);

    mockSessionFor(DRIVER_A);
    await expect(uploadDeliveryProof(undefined, form())).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(uploadDeliveryProof(undefined, form())).rejects.toThrow(/not authenticated/i);
  });
});

describe("GET /api/proofs/[id]/image (D3) — authenticated image serving", () => {
  let proofIdA: string;

  beforeAll(async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber: "IMG-A" }, jpegFile()));
    const row = await prisma.deliveryProof.findFirst({
      where: { driverId: DRIVER_A, invoiceNumber: "IMG-A" },
    });
    proofIdA = row!.id;
  });

  it("serves the image to its own driver with the stored MIME type", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const res = await imageRequest(proofIdA);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  it("serves any image to the OWNER", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    const res = await imageRequest(proofIdA);
    expect(res.status).toBe(200);
  });

  it("404s for another driver — indistinguishable from a missing proof", async () => {
    mockSessionFor(DRIVER_B, "DRIVER");
    const res = await imageRequest(proofIdA);
    expect(res.status).toBe(404);

    const missing = await imageRequest("no-such-proof");
    expect(missing.status).toBe(404);
    expect(await res.text()).toBe(await missing.text());
  });

  it("401s unauthenticated and 403s role-less sessions", async () => {
    mockedAuth.mockResolvedValue(null);
    expect((await imageRequest(proofIdA)).status).toBe(401);

    mockSessionFor(DRIVER_A);
    expect((await imageRequest(proofIdA)).status).toBe(403);
  });

  it("404s a metadata-only proof (no image attached)", async () => {
    const bare = await prisma.deliveryProof.create({
      data: { driverId: DRIVER_A, invoiceNumber: "NO-IMG" },
    });
    mockSessionFor(DRIVER_A, "DRIVER");
    expect((await imageRequest(bare.id)).status).toBe(404);
  });

  it("404s a tampered imagePath that tries to escape the storage directory", async () => {
    // Plant a real, readable file OUTSIDE the upload root, then point a DB
    // row at it via traversal — the containment check must refuse to serve it.
    const outside = path.resolve(process.env.UPLOAD_DIR!, "../escape-target.txt");
    await writeFile(outside, "must never be served");

    const tampered = await prisma.deliveryProof.create({
      data: {
        driverId: DRIVER_A,
        imagePath: "../escape-target.txt",
        mimeType: "image/jpeg",
      },
    });

    mockSessionFor(DRIVER_A, "DRIVER");
    expect((await imageRequest(tampered.id)).status).toBe(404);

    mockSessionFor(OWNER_ID, "OWNER");
    expect((await imageRequest(tampered.id)).status).toBe(404);
  });
});
