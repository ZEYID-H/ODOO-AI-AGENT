import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import {
  createDeliveryProofMetadata,
  listMyDeliveryProofs,
  getDeliveryProofForOwner,
  listAllDeliveryProofsForOwner,
  recordOcrResult,
} from "@/app/actions/delivery-proofs";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `ocr-owner-${RUN}`;
const DRIVER_ID = `ocr-driver-${RUN}`;

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

async function freshProof(invoiceNumber: string): Promise<string> {
  mockSessionFor(DRIVER_ID, "DRIVER");
  const proof = await createDeliveryProofMetadata({ invoiceNumber });
  return proof.id;
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: OWNER_ID, username: OWNER_ID, passwordHash: "", role: "OWNER" },
      { id: DRIVER_ID, username: DRIVER_ID, passwordHash: "", role: "DRIVER" },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_ID] } } });
});

describe("OCR readiness defaults (D5) — data foundation only", () => {
  it("every new proof starts NOT_STARTED with all extraction fields null", async () => {
    const id = await freshProof(`OCR-DEF-${RUN}`);

    mockSessionFor(OWNER_ID, "OWNER");
    const view = await getDeliveryProofForOwner(id);
    expect(view?.ocrStatus).toBe("NOT_STARTED");
    expect(view?.ocrText).toBeNull();
    expect(view?.ocrInvoiceNumber).toBeNull();
    expect(view?.ocrCustomerName).toBeNull();
    expect(view?.ocrConfidence).toBeNull();
    expect(view?.ocrProcessedAt).toBeNull();
    expect(view?.ocrError).toBeNull();
  });

  it("owner queue rows carry the OCR fields too", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    const queue = await listAllDeliveryProofsForOwner();
    const row = queue.find((p) => p.invoiceNumber === `OCR-DEF-${RUN}`)!;
    expect(row.ocrStatus).toBe("NOT_STARTED");
    expect(row).toHaveProperty("ocrConfidence");
  });

  it("driver views never contain OCR fields — no leakage to the driver portal", async () => {
    mockSessionFor(DRIVER_ID, "DRIVER");
    const mine = await listMyDeliveryProofs();
    const row = mine.find((p) => p.invoiceNumber === `OCR-DEF-${RUN}`)!;

    for (const key of Object.keys(row)) {
      expect(key.toLowerCase()).not.toContain("ocr");
    }
  });
});

describe("recordOcrResult (D5) — the one guarded write path", () => {
  it("OWNER can record a completed extraction; processed timestamp is server-set", async () => {
    const id = await freshProof(`OCR-REC-${RUN}`);

    mockSessionFor(OWNER_ID, "OWNER");
    const before = Date.now();
    const view = await recordOcrResult(id, {
      ocrStatus: "COMPLETED",
      ocrText: "  INVOICE INV-9 APPLE MART TOTAL 120.00  ",
      ocrInvoiceNumber: " INV-9 ",
      ocrCustomerName: "APPLE MART",
      ocrConfidence: 0.87,
    });

    expect(view.ocrStatus).toBe("COMPLETED");
    expect(view.ocrInvoiceNumber).toBe("INV-9"); // trimmed
    expect(view.ocrCustomerName).toBe("APPLE MART");
    expect(view.ocrConfidence).toBe(0.87);
    expect(new Date(view.ocrProcessedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Persisted, not just returned.
    const refetched = await getDeliveryProofForOwner(id);
    expect(refetched?.ocrStatus).toBe("COMPLETED");
    expect(refetched?.ocrText).toContain("INV-9");
  });

  it("FAILED records an error and a processed timestamp; PROCESSING records neither", async () => {
    const id = await freshProof(`OCR-FAIL-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");

    const processing = await recordOcrResult(id, { ocrStatus: "PROCESSING" });
    expect(processing.ocrProcessedAt).toBeNull();

    const failed = await recordOcrResult(id, {
      ocrStatus: "FAILED",
      ocrError: "image unreadable",
    });
    expect(failed.ocrStatus).toBe("FAILED");
    expect(failed.ocrError).toBe("image unreadable");
    expect(failed.ocrProcessedAt).not.toBeNull();
  });

  it("validates strictly: unknown status, out-of-range confidence, unknown proof", async () => {
    const id = await freshProof(`OCR-VAL-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");

    await expect(recordOcrResult(id, { ocrStatus: "DONE" })).rejects.toThrow(/invalid ocr status/i);
    await expect(recordOcrResult(id, { ocrStatus: "" })).rejects.toThrow(/invalid ocr status/i);
    await expect(
      recordOcrResult(id, { ocrStatus: "COMPLETED", ocrConfidence: 1.5 })
    ).rejects.toThrow(/between 0 and 1/);
    await expect(
      recordOcrResult(id, { ocrStatus: "COMPLETED", ocrConfidence: -0.1 })
    ).rejects.toThrow(/between 0 and 1/);
    await expect(
      recordOcrResult(id, { ocrStatus: "COMPLETED", ocrConfidence: NaN })
    ).rejects.toThrow(/between 0 and 1/);
    await expect(
      recordOcrResult("no-such-proof", { ocrStatus: "COMPLETED" })
    ).rejects.toThrow(/not found/i);

    // Nothing stuck: the proof is untouched after the failed writes.
    expect((await getDeliveryProofForOwner(id))?.ocrStatus).toBe("NOT_STARTED");
  });

  it("DRIVER can never mutate OCR fields — not even on their own proof", async () => {
    const id = await freshProof(`OCR-SEC-${RUN}`);

    mockSessionFor(DRIVER_ID, "DRIVER");
    await expect(recordOcrResult(id, { ocrStatus: "COMPLETED" })).rejects.toThrow(
      /not authorized/i
    );

    mockSessionFor(DRIVER_ID);
    await expect(recordOcrResult(id, { ocrStatus: "COMPLETED" })).rejects.toThrow(
      /not authorized/i
    );

    mockedAuth.mockResolvedValue(null);
    await expect(recordOcrResult(id, { ocrStatus: "COMPLETED" })).rejects.toThrow(
      /not authenticated/i
    );

    mockSessionFor(OWNER_ID, "OWNER");
    expect((await getDeliveryProofForOwner(id))?.ocrStatus).toBe("NOT_STARTED");
  });
});
