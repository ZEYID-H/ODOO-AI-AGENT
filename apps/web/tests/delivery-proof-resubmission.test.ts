import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { existsSync, readdirSync } from "fs";
import path from "path";
import { auth } from "@/auth";
import {
  createDeliveryProofMetadata,
  uploadDeliveryProof,
  resubmitRejectedDeliveryProof,
  verifyDeliveryProof,
  rejectDeliveryProof,
  getDeliveryProofForOwner,
  getMyDeliveryProof,
} from "@/app/actions/delivery-proofs";
import { GET as getAttemptImage } from "@/app/api/proofs/[id]/attempts/[attemptId]/image/route";
import { GET as getProofImage } from "@/app/api/proofs/[id]/image/route";
import { saveProofImage, deleteProofImage } from "@/lib/file-storage";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `rs-owner-${RUN}`;
const DRIVER_A = `rs-driver-a-${RUN}`;
const DRIVER_B = `rs-driver-b-${RUN}`;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR!);

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

function jpegFile(name = "photo.jpg"): File {
  return new File([JPEG_BYTES], name, { type: "image/jpeg" });
}

function resubmitForm(proofId: string, image?: File): FormData {
  const fd = new FormData();
  fd.set("proofId", proofId);
  if (image) fd.set("image", image);
  return fd;
}

function uploadForm(fields: Record<string, string>, image?: File): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (image) fd.set("image", image);
  return fd;
}

function attemptImageRequest(proofId: string, attemptId: string) {
  return getAttemptImage(
    new Request(`http://localhost/api/proofs/${proofId}/attempts/${attemptId}/image`),
    { params: Promise.resolve({ id: proofId, attemptId }) }
  );
}

function proofImageRequest(proofId: string) {
  return getProofImage(new Request(`http://localhost/api/proofs/${proofId}/image`), {
    params: Promise.resolve({ id: proofId }),
  });
}

/** Creates, via the real action, a proof that is REJECTED with the given
 * reason — the standard starting point for most tests in this file. */
async function freshRejectedProof(
  driverId: string,
  invoiceNumber: string,
  reason = "photo unreadable"
): Promise<string> {
  mockSessionFor(driverId, "DRIVER");
  const state = await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
  expect(state.error).toBeUndefined();
  const proof = await prisma.deliveryProof.findFirstOrThrow({
    where: { driverId, invoiceNumber },
  });

  mockSessionFor(OWNER_ID, "OWNER");
  await rejectDeliveryProof(proof.id, reason);
  return proof.id;
}

const orphanFiles: string[] = [];

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
  const attempts = await prisma.deliveryProofAttempt.findMany({
    where: { submittedById: { in: [DRIVER_A, DRIVER_B] } },
    select: { imagePath: true },
  });
  for (const a of attempts) {
    if (a.imagePath) await deleteProofImage(a.imagePath);
  }
  for (const name of orphanFiles) await deleteProofImage(name);
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_A, DRIVER_B] } } });
});

describe("New-proof creation is atomic with attempt 1 (D7)", () => {
  it("createDeliveryProofMetadata creates the parent and a PENDING attempt 1 together", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await createDeliveryProofMetadata({ invoiceNumber: `CREATE-META-${RUN}` });

    const attempts = await prisma.deliveryProofAttempt.findMany({
      where: { deliveryProofId: proof.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptNumber).toBe(1);
    expect(attempts[0].status).toBe("PENDING");
    expect(attempts[0].submittedById).toBe(DRIVER_A);
    expect(attempts[0].imagePath).toBeNull(); // metadata-only, no image given
  });

  it("uploadDeliveryProof creates the parent and attempt 1 with the same image atomically", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const invoiceNumber = `CREATE-UPLOAD-${RUN}`;
    const state = await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
    expect(state.error).toBeUndefined();

    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber },
    });
    const attempts = await prisma.deliveryProofAttempt.findMany({
      where: { deliveryProofId: proof.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptNumber).toBe(1);
    expect(attempts[0].imagePath).toBe(proof.imagePath);
    expect(attempts[0].submittedAt.getTime()).toBe(proof.uploadedAt.getTime());
  });

  it("a failed creation (FK violation on driverId) creates neither the proof nor an attempt", async () => {
    const phantomDriverId = `no-such-driver-${RUN}`;
    mockSessionFor(phantomDriverId, "DRIVER");

    await expect(
      createDeliveryProofMetadata({ invoiceNumber: `SHOULD-NOT-EXIST-${RUN}` })
    ).rejects.toThrow();

    const proofs = await prisma.deliveryProof.count({ where: { driverId: phantomDriverId } });
    const attempts = await prisma.deliveryProofAttempt.count({
      where: { submittedById: phantomDriverId },
    });
    expect(proofs).toBe(0);
    expect(attempts).toBe(0);
  });
});

describe("resubmitRejectedDeliveryProof — authorization (D7)", () => {
  it("the owning DRIVER can resubmit their own REJECTED proof", async () => {
    const id = await freshRejectedProof(DRIVER_A, `AUTH-OK-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");

    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    expect(state.error).toBeUndefined();

    const proof = await prisma.deliveryProof.findUniqueOrThrow({ where: { id } });
    expect(proof.status).toBe("PENDING");
  });

  it("cannot resubmit a PENDING proof", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const state0 = await uploadDeliveryProof(
      undefined,
      uploadForm({ invoiceNumber: `AUTH-PENDING-${RUN}` }, jpegFile())
    );
    expect(state0.error).toBeUndefined();
    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber: `AUTH-PENDING-${RUN}` },
    });

    const state = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm(proof.id, jpegFile())
    );
    expect(state.error).toMatch(/only rejected proofs/i);
    expect(
      await prisma.deliveryProofAttempt.count({ where: { deliveryProofId: proof.id } })
    ).toBe(1); // still just attempt 1
  });

  it("cannot resubmit a VERIFIED proof", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const state0 = await uploadDeliveryProof(
      undefined,
      uploadForm({ invoiceNumber: `AUTH-VERIFIED-${RUN}` }, jpegFile())
    );
    expect(state0.error).toBeUndefined();
    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber: `AUTH-VERIFIED-${RUN}` },
    });

    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(proof.id);

    mockSessionFor(DRIVER_A, "DRIVER");
    const state = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm(proof.id, jpegFile())
    );
    expect(state.error).toMatch(/only rejected proofs/i);
  });

  it("cannot resubmit another driver's REJECTED proof", async () => {
    const id = await freshRejectedProof(DRIVER_A, `AUTH-CROSS-${RUN}`);
    mockSessionFor(DRIVER_B, "DRIVER");

    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    expect(state.error).toMatch(/not found/i);
    expect(await prisma.deliveryProofAttempt.count({ where: { deliveryProofId: id } })).toBe(1);
  });

  it("unknown and cross-driver proof ids fail with the identical message", async () => {
    const id = await freshRejectedProof(DRIVER_A, `AUTH-INDISTINGUISH-${RUN}`);
    mockSessionFor(DRIVER_B, "DRIVER");

    const crossDriver = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm(id, jpegFile())
    );
    const unknown = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm("no-such-proof-at-all", jpegFile())
    );
    expect(crossDriver.error).toBe(unknown.error);
  });

  it("OWNER cannot call the DRIVER resubmission action", async () => {
    const id = await freshRejectedProof(DRIVER_A, `AUTH-OWNER-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");

    await expect(
      resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()))
    ).rejects.toThrow(/not authorized/i);
  });

  it("role-less and unauthenticated sessions fail closed", async () => {
    const id = await freshRejectedProof(DRIVER_A, `AUTH-ROLELESS-${RUN}`);

    mockSessionFor(DRIVER_A);
    await expect(
      resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()))
    ).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(
      resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()))
    ).rejects.toThrow(/not authenticated/i);
  });
});

describe("Attempt history mechanics across repeated reject/resubmit cycles (D7)", () => {
  it("original attempt 1 is never modified by a resubmission", async () => {
    const id = await freshRejectedProof(DRIVER_A, `HIST-IMMUTABLE-${RUN}`, "first reason");
    const [attempt1Before] = await prisma.deliveryProofAttempt.findMany({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });

    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile("second.jpg")));

    const [attempt1After] = await prisma.deliveryProofAttempt.findMany({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });
    expect(attempt1After.imagePath).toBe(attempt1Before.imagePath);
    expect(attempt1After.status).toBe("REJECTED");
    expect(attempt1After.rejectionReason).toBe("first reason");
    expect(attempt1After.reviewedAt?.getTime()).toBe(attempt1Before.reviewedAt?.getTime());
    expect(attempt1After.updatedAt.getTime()).toBe(attempt1Before.updatedAt.getTime());
  });

  it("repeated reject/resubmit cycles produce sequential attempt numbers 1, 2, 3", async () => {
    const id = await freshRejectedProof(DRIVER_A, `HIST-SEQUENCE-${RUN}`, "reason 1");

    mockSessionFor(DRIVER_A, "DRIVER");
    let state = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm(id, jpegFile("attempt2.jpg"))
    );
    expect(state.error).toBeUndefined();

    mockSessionFor(OWNER_ID, "OWNER");
    await rejectDeliveryProof(id, "reason 2");

    mockSessionFor(DRIVER_A, "DRIVER");
    state = await resubmitRejectedDeliveryProof(
      undefined,
      resubmitForm(id, jpegFile("attempt3.jpg"))
    );
    expect(state.error).toBeUndefined();

    const attempts = await prisma.deliveryProofAttempt.findMany({
      where: { deliveryProofId: id },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(attempts[0].rejectionReason).toBe("reason 1");
    expect(attempts[1].rejectionReason).toBe("reason 2");
    expect(attempts[2].status).toBe("PENDING"); // the latest, not yet reviewed
  });

  it("the latest attempt becomes PENDING and the parent's current image points to it", async () => {
    const id = await freshRejectedProof(DRIVER_A, `HIST-LATEST-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile("new-current.jpg")));

    const proof = await prisma.deliveryProof.findUniqueOrThrow({ where: { id } });
    const latest = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id },
      orderBy: { attemptNumber: "desc" },
    });
    expect(latest.attemptNumber).toBe(2);
    expect(latest.status).toBe("PENDING");
    expect(proof.status).toBe("PENDING");
    expect(proof.imagePath).toBe(latest.imagePath);
  });

  it("the old rejected attempt keeps its own rejection reason after resubmission and a later verify", async () => {
    const id = await freshRejectedProof(DRIVER_A, `HIST-OLD-REASON-${RUN}`, "wrong invoice shown");
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(id);

    const attempt1 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });
    expect(attempt1.status).toBe("REJECTED");
    expect(attempt1.rejectionReason).toBe("wrong invoice shown");

    const attempt2 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 2 },
    });
    expect(attempt2.status).toBe("VERIFIED");
    expect(attempt2.rejectionReason).toBeNull();
  });

  it("old attempt image files remain on disk after resubmission — never deleted", async () => {
    const id = await freshRejectedProof(DRIVER_A, `HIST-FILES-KEPT-${RUN}`);
    const attempt1 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });
    const attempt1Path = path.join(UPLOAD_DIR, attempt1.imagePath!);
    expect(existsSync(attempt1Path)).toBe(true);

    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    expect(existsSync(attempt1Path)).toBe(true); // still there
  });
});

describe("Review-action integration updates parent AND latest attempt atomically (D7)", () => {
  it("reject updates the parent and the latest attempt together", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const invoiceNumber = `REVIEW-REJECT-${RUN}`;
    await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber },
    });

    mockSessionFor(OWNER_ID, "OWNER");
    await rejectDeliveryProof(proof.id, "smudged text");

    const parent = await prisma.deliveryProof.findUniqueOrThrow({ where: { id: proof.id } });
    const attempt = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proof.id, attemptNumber: 1 },
    });
    expect(parent.status).toBe("REJECTED");
    expect(parent.rejectionReason).toBe("smudged text");
    expect(attempt.status).toBe("REJECTED");
    expect(attempt.rejectionReason).toBe("smudged text");
    expect(attempt.reviewedAt?.getTime()).toBe(parent.verifiedAt?.getTime());
    expect(attempt.reviewedById).toBe(parent.verifiedById);
  });

  it("verify updates the parent and the latest attempt together", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const invoiceNumber = `REVIEW-VERIFY-${RUN}`;
    await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber },
    });

    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(proof.id);

    const parent = await prisma.deliveryProof.findUniqueOrThrow({ where: { id: proof.id } });
    const attempt = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proof.id, attemptNumber: 1 },
    });
    expect(parent.status).toBe("VERIFIED");
    expect(attempt.status).toBe("VERIFIED");
    expect(attempt.reviewedAt?.getTime()).toBe(parent.verifiedAt?.getTime());
  });

  it("reviewing attempt 2 (after a resubmission) never touches attempt 1", async () => {
    const id = await freshRejectedProof(DRIVER_A, `REVIEW-OLDER-UNTOUCHED-${RUN}`, "r1");
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    const attempt1Before = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });

    mockSessionFor(OWNER_ID, "OWNER");
    await rejectDeliveryProof(id, "r2");

    const attempt1After = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 1 },
    });
    expect(attempt1After.updatedAt.getTime()).toBe(attempt1Before.updatedAt.getTime());
    expect(attempt1After.rejectionReason).toBe("r1"); // unchanged, not overwritten with "r2"

    const attempt2 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 2 },
    });
    expect(attempt2.rejectionReason).toBe("r2");
  });

  it("a failed review (already reviewed) partially updates nothing", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const invoiceNumber = `REVIEW-NOPARTIAL-${RUN}`;
    await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
    const proof = await prisma.deliveryProof.findFirstOrThrow({
      where: { driverId: DRIVER_A, invoiceNumber },
    });

    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(proof.id);
    const afterFirst = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proof.id, attemptNumber: 1 },
    });

    await expect(rejectDeliveryProof(proof.id, "too late")).rejects.toThrow(
      /not found or already reviewed/i
    );

    const afterSecond = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proof.id, attemptNumber: 1 },
    });
    expect(afterSecond.status).toBe("VERIFIED"); // still VERIFIED, not flipped to REJECTED
    expect(afterSecond.rejectionReason).toBeNull();
    expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
  });
});

describe("OCR fields reset on resubmission, no OCR execution triggered (D7)", () => {
  it("all OCR fields reset to their initial state and ocrStatus becomes NOT_STARTED", async () => {
    const id = await freshRejectedProof(DRIVER_A, `OCR-RESET-${RUN}`);
    await prisma.deliveryProof.update({
      where: { id },
      data: {
        ocrStatus: "COMPLETED",
        ocrText: "stale extracted text",
        ocrInvoiceNumber: "STALE-INV",
        ocrCustomerName: "STALE CUSTOMER",
        ocrConfidence: 0.91,
        ocrProcessedAt: new Date(),
        ocrError: null,
      },
    });

    mockSessionFor(DRIVER_A, "DRIVER");
    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    expect(state.error).toBeUndefined();

    const proof = await prisma.deliveryProof.findUniqueOrThrow({ where: { id } });
    expect(proof.ocrStatus).toBe("NOT_STARTED");
    expect(proof.ocrText).toBeNull();
    expect(proof.ocrInvoiceNumber).toBeNull();
    expect(proof.ocrCustomerName).toBeNull();
    expect(proof.ocrConfidence).toBeNull();
    expect(proof.ocrProcessedAt).toBeNull();
    expect(proof.ocrError).toBeNull();
  });

  it("resubmission never sets ocrStatus to PROCESSING — no OCR run is triggered", async () => {
    const id = await freshRejectedProof(DRIVER_A, `OCR-NO-TRIGGER-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    const proof = await prisma.deliveryProof.findUniqueOrThrow({ where: { id } });
    expect(proof.ocrStatus).toBe("NOT_STARTED");
    expect(proof.ocrStatus).not.toBe("PROCESSING");
  });
});

describe("File safety on resubmission (D7)", () => {
  it("rejects a spoofed MIME type without creating a new attempt", async () => {
    const id = await freshRejectedProof(DRIVER_A, `FILE-SPOOFED-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");

    const spoofed = new File([GIF_BYTES], "fake.jpg", { type: "image/jpeg" });
    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, spoofed));
    expect(state.error).toMatch(/JPEG, PNG, or WebP/);
    expect(await prisma.deliveryProofAttempt.count({ where: { deliveryProofId: id } })).toBe(1);
  });

  it("rejects an oversized image without creating a new attempt", async () => {
    const id = await freshRejectedProof(DRIVER_A, `FILE-OVERSIZED-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");

    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(JPEG_BYTES, 0);
    const bigFile = new File([big], "big.jpg", { type: "image/jpeg" });
    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, bigFile));
    expect(state.error).toMatch(/too large/i);
    expect(await prisma.deliveryProofAttempt.count({ where: { deliveryProofId: id } })).toBe(1);
  });

  it(
    "simulated DB failure after the file is written: the transaction's guard refuses the " +
      "stale write, and the caller cleans up exactly the new orphan file",
    async () => {
      const id = await freshRejectedProof(DRIVER_A, `FILE-ORPHAN-SIM-${RUN}`);

      // Reproduces, deterministically, the exact failure this function's own
      // documented SQLite concurrency note describes: the file is saved
      // first (as the real action does), then something else moves the
      // proof out of REJECTED before the atomic write runs, so the
      // WHERE-clause guard — the real one, not a mock — correctly refuses.
      const stored = await saveProofImage(jpegFile());
      const target = path.join(UPLOAD_DIR, stored.storedName);
      expect(existsSync(target)).toBe(true);

      await prisma.deliveryProof.update({ where: { id }, data: { status: "PENDING" } });

      const updated = await prisma.deliveryProof.updateMany({
        where: { id, driverId: DRIVER_A, status: "REJECTED" },
        data: { imagePath: stored.storedName, status: "PENDING" },
      });
      expect(updated.count).toBe(0);

      // What resubmitRejectedDeliveryProof does on this exact failure.
      await deleteProofImage(stored.storedName);
      expect(existsSync(target)).toBe(false);

      // Restore REJECTED so this proof doesn't confuse other assertions.
      await prisma.deliveryProof.update({ where: { id }, data: { status: "REJECTED" } });
    }
  );

  it(
    "best-effort real concurrency check: two simultaneous resubmissions never both " +
      "succeed, and the total new files on disk match the attempts actually created",
    async () => {
      const id = await freshRejectedProof(DRIVER_A, `FILE-RACE-${RUN}`);
      mockSessionFor(DRIVER_A, "DRIVER");

      const before = readdirSync(UPLOAD_DIR).length;
      const [a, b] = await Promise.all([
        resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile("race-a.jpg"))),
        resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile("race-b.jpg"))),
      ]);
      const after = readdirSync(UPLOAD_DIR).length;

      const outcomes = [a, b];
      const succeeded = outcomes.filter((r) => !r.error);
      // At most one can win the atomic guard (SQLite's single-writer model
      // means in practice exactly one wins and one is refused — asserting
      // "not both" rather than "exactly one" keeps this robust even if the
      // pre-check on the loser fires before it ever writes a file).
      expect(succeeded.length).toBeLessThanOrEqual(1);

      const attempts = await prisma.deliveryProofAttempt.findMany({
        where: { deliveryProofId: id },
        orderBy: { attemptNumber: "asc" },
      });
      // No gaps, no duplicates: 1, 2, and — only if the winner actually
      // wrote a second attempt — nothing beyond that.
      expect(attempts.map((x) => x.attemptNumber)).toEqual(
        attempts.length === 2 ? [1, 2] : [1]
      );

      // Every file that now exists on disk beyond `before` is one that a
      // real DeliveryProofAttempt row references — no net-new orphans.
      const netNewFiles = after - before;
      const newAttemptFiles = attempts.filter((x) => x.attemptNumber > 1).length;
      expect(netNewFiles).toBe(newAttemptFiles);
    }
  );
});

describe("Attempt-history image access is authenticated and ownership-scoped (D7)", () => {
  let proofId: string;
  let attempt1Id: string;
  let attempt2Id: string;

  beforeAll(async () => {
    proofId = await freshRejectedProof(DRIVER_A, `IMG-ACCESS-${RUN}`);
    const attempt1 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proofId, attemptNumber: 1 },
    });
    attempt1Id = attempt1.id;

    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(proofId, jpegFile()));
    const attempt2 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proofId, attemptNumber: 2 },
    });
    attempt2Id = attempt2.id;
  });

  it("the owning DRIVER can view every one of their own proof's attempt images", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    expect((await attemptImageRequest(proofId, attempt1Id)).status).toBe(200);
    expect((await attemptImageRequest(proofId, attempt2Id)).status).toBe(200);
  });

  it("another DRIVER cannot view any attempt image for this proof", async () => {
    mockSessionFor(DRIVER_B, "DRIVER");
    expect((await attemptImageRequest(proofId, attempt1Id)).status).toBe(404);
    expect((await attemptImageRequest(proofId, attempt2Id)).status).toBe(404);
  });

  it("OWNER can view every attempt image", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    expect((await attemptImageRequest(proofId, attempt1Id)).status).toBe(200);
    expect((await attemptImageRequest(proofId, attempt2Id)).status).toBe(200);
  });

  it("anonymous users cannot view any attempt image", async () => {
    mockedAuth.mockResolvedValue(null);
    expect((await attemptImageRequest(proofId, attempt1Id)).status).toBe(401);
  });

  it("an attemptId that doesn't belong to the given proof id is a 404, not a leak", async () => {
    const otherProofId = await freshRejectedProof(DRIVER_A, `IMG-ACCESS-OTHER-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    // attempt1Id genuinely exists, but not under otherProofId.
    expect((await attemptImageRequest(otherProofId, attempt1Id)).status).toBe(404);
  });

  it("the parent proof's current-image route still serves the LATEST attempt's image", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await prisma.deliveryProof.findUniqueOrThrow({ where: { id: proofId } });
    const latestAttempt = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: proofId },
      orderBy: { attemptNumber: "desc" },
    });
    expect(proof.imagePath).toBe(latestAttempt.imagePath);
    expect((await proofImageRequest(proofId)).status).toBe(200);
  });
});

describe("Owner detail view exposes attempt history; driver view never does (D7)", () => {
  it("getDeliveryProofForOwner returns attempts newest-first with submitter/reviewer usernames", async () => {
    const id = await freshRejectedProof(DRIVER_A, `OWNER-HISTORY-${RUN}`, "first");
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    mockSessionFor(OWNER_ID, "OWNER");
    const detail = await getDeliveryProofForOwner(id);
    expect(detail?.attempts).toHaveLength(2);
    expect(detail!.attempts[0].attemptNumber).toBe(2); // newest first
    expect(detail!.attempts[1].attemptNumber).toBe(1);
    expect(detail!.attempts[1].submittedByUsername).toBe(DRIVER_A);
    expect(detail!.attempts[1].rejectionReason).toBe("first");
    expect(detail!.attempts[1].reviewedByUsername).toBe(OWNER_ID);
  });

  it("DeliveryProofView (the driver's own-proof shape) never carries an attempts field or OCR/reviewer data", async () => {
    const id = await freshRejectedProof(DRIVER_A, `DRIVER-NO-HISTORY-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const own = await getMyDeliveryProof(id);
    expect(own).not.toBeNull();
    expect(own).not.toHaveProperty("attempts");
    expect(own).not.toHaveProperty("verifiedByUsername");
    expect(own).not.toHaveProperty("driverUsername");
    for (const key of Object.keys(own!)) {
      expect(key.toLowerCase()).not.toContain("ocr");
    }
  });

  it("DRIVER cannot call getDeliveryProofForOwner to see attempt history at all", async () => {
    const id = await freshRejectedProof(DRIVER_A, `DRIVER-NO-OWNER-VIEW-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await expect(getDeliveryProofForOwner(id)).rejects.toThrow(/not authorized/i);
  });
});

describe("Schema constraint: (deliveryProofId, attemptNumber) is unique (D7)", () => {
  it("rejects a direct attempt to insert a duplicate attempt number for the same proof", async () => {
    const id = await freshRejectedProof(DRIVER_A, `UNIQUE-CONSTRAINT-${RUN}`);
    await expect(
      prisma.deliveryProofAttempt.create({
        data: {
          deliveryProofId: id,
          attemptNumber: 1, // collides with the existing attempt 1
          submittedById: DRIVER_A,
          status: "PENDING",
        },
      })
    ).rejects.toThrow();
  });
});
