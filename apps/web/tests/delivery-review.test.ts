import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import {
  createDeliveryProofMetadata,
  listMyDeliveryProofs,
  listAllDeliveryProofsForOwner,
  getDeliveryProofForOwner,
  verifyDeliveryProofForm,
  rejectDeliveryProofForm,
} from "@/app/actions/delivery-proofs";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `rv-owner-${RUN}`;
const DRIVER_ID = `rv-driver-${RUN}`;

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

function reviewForm(proofId: string, rejectionReason?: string): FormData {
  const fd = new FormData();
  fd.set("proofId", proofId);
  if (rejectionReason !== undefined) fd.set("rejectionReason", rejectionReason);
  return fd;
}

async function freshProof(invoiceNumber: string): Promise<string> {
  mockSessionFor(DRIVER_ID, "DRIVER");
  const proof = await createDeliveryProofMetadata({ invoiceNumber });
  return proof.id;
}

// Only this suite's proofs — the shared test.db may hold rows from other
// suites running in the same file-sequential pass.
function mine<T extends { invoiceNumber: string | null }>(proofs: T[]): T[] {
  return proofs.filter((p) => p.invoiceNumber?.includes(`-${RUN}`));
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

describe("review queue ordering and filtering (D4)", () => {
  beforeAll(async () => {
    // Three proofs, created oldest→newest, then decide the middle two so
    // the queue has one of each status.
    const oldVerified = await freshProof(`Q-VER-${RUN}`);
    await new Promise((r) => setTimeout(r, 5));
    const midRejected = await freshProof(`Q-REJ-${RUN}`);
    await new Promise((r) => setTimeout(r, 5));
    await freshProof(`Q-PEND-OLD-${RUN}`);
    await new Promise((r) => setTimeout(r, 5));
    await freshProof(`Q-PEND-NEW-${RUN}`);

    mockSessionFor(OWNER_ID, "OWNER");
    expect((await verifyDeliveryProofForm(undefined, reviewForm(oldVerified))).error).toBeUndefined();
    expect(
      (await rejectDeliveryProofForm(undefined, reviewForm(midRejected, "blurry photo"))).error
    ).toBeUndefined();
  });

  it("default queue: PENDING first, newest first within each status", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    const queue = mine(await listAllDeliveryProofsForOwner());
    const invoices = queue.map((p) => p.invoiceNumber);

    expect(invoices).toEqual([
      `Q-PEND-NEW-${RUN}`, // pending block, newest first
      `Q-PEND-OLD-${RUN}`,
      `Q-VER-${RUN}`, // then decided proofs, grouped by outcome
      `Q-REJ-${RUN}`,
    ]);
  });

  it("status filters return exactly that status, and junk filters degrade to the full queue", async () => {
    mockSessionFor(OWNER_ID, "OWNER");

    const pending = mine(await listAllDeliveryProofsForOwner("PENDING"));
    expect(pending.every((p) => p.status === "PENDING")).toBe(true);
    expect(pending).toHaveLength(2);

    const verified = mine(await listAllDeliveryProofsForOwner("VERIFIED"));
    expect(verified.map((p) => p.invoiceNumber)).toEqual([`Q-VER-${RUN}`]);

    const rejected = mine(await listAllDeliveryProofsForOwner("REJECTED"));
    expect(rejected.map((p) => p.invoiceNumber)).toEqual([`Q-REJ-${RUN}`]);

    const junk = mine(await listAllDeliveryProofsForOwner("'; DROP TABLE --"));
    expect(junk).toHaveLength(4);
  });
});

describe("review form actions (D4) — thin adapters over the D2 guarantees", () => {
  it("verify: persists status, reviewer, and timestamp — visible on re-fetch", async () => {
    const id = await freshProof(`F-VER-${RUN}`);

    mockSessionFor(OWNER_ID, "OWNER");
    const before = Date.now();
    expect((await verifyDeliveryProofForm(undefined, reviewForm(id))).error).toBeUndefined();

    const persisted = await getDeliveryProofForOwner(id);
    expect(persisted?.status).toBe("VERIFIED");
    expect(persisted?.verifiedByUsername).toBe(OWNER_ID);
    expect(persisted?.rejectionReason).toBeNull();
    expect(new Date(persisted!.verifiedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("reject: requires a reason, trims it, enforces max length", async () => {
    const id = await freshProof(`F-REJ-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");

    expect((await rejectDeliveryProofForm(undefined, reviewForm(id))).error).toMatch(
      /reason is required/i
    );
    expect((await rejectDeliveryProofForm(undefined, reviewForm(id, "   "))).error).toMatch(
      /reason is required/i
    );
    expect(
      (await rejectDeliveryProofForm(undefined, reviewForm(id, "x".repeat(501)))).error
    ).toMatch(/500/);

    // Failed attempts changed nothing.
    expect((await getDeliveryProofForOwner(id))?.status).toBe("PENDING");

    expect(
      (await rejectDeliveryProofForm(undefined, reviewForm(id, "  wrong customer  "))).error
    ).toBeUndefined();
    const persisted = await getDeliveryProofForOwner(id);
    expect(persisted?.status).toBe("REJECTED");
    expect(persisted?.rejectionReason).toBe("wrong customer");
    expect(persisted?.verifiedByUsername).toBe(OWNER_ID);
    expect(persisted?.verifiedAt).not.toBeNull();
  });

  it("a decided proof is immutable through the forms — no verify-after-reject, no reject-after-verify", async () => {
    const id = await freshProof(`F-IMM-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");
    expect((await verifyDeliveryProofForm(undefined, reviewForm(id))).error).toBeUndefined();

    expect((await rejectDeliveryProofForm(undefined, reviewForm(id, "changed my mind"))).error).toMatch(
      /not found or already reviewed/i
    );
    expect((await verifyDeliveryProofForm(undefined, reviewForm(id))).error).toMatch(
      /not found or already reviewed/i
    );
    expect((await getDeliveryProofForOwner(id))?.status).toBe("VERIFIED");
  });

  it("unknown proof ids come back as the same generic form error", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    expect((await verifyDeliveryProofForm(undefined, reviewForm("no-such-id"))).error).toMatch(
      /not found or already reviewed/i
    );
  });

  it("DRIVER and anonymous callers are refused before any form parsing", async () => {
    const id = await freshProof(`F-SEC-${RUN}`);

    mockSessionFor(DRIVER_ID, "DRIVER");
    await expect(verifyDeliveryProofForm(undefined, reviewForm(id))).rejects.toThrow(
      /not authorized/i
    );
    await expect(rejectDeliveryProofForm(undefined, reviewForm(id, "self"))).rejects.toThrow(
      /not authorized/i
    );

    mockedAuth.mockResolvedValue(null);
    await expect(verifyDeliveryProofForm(undefined, reviewForm(id))).rejects.toThrow(
      /not authenticated/i
    );

    mockSessionFor(OWNER_ID, "OWNER");
    expect((await getDeliveryProofForOwner(id))?.status).toBe("PENDING");
  });

  it("driver sees the decision and rejection reason on their own list", async () => {
    const id = await freshProof(`F-VIS-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");
    expect(
      (await rejectDeliveryProofForm(undefined, reviewForm(id, "not our invoice"))).error
    ).toBeUndefined();

    mockSessionFor(DRIVER_ID, "DRIVER");
    const mineList = await listMyDeliveryProofs();
    const rejected = mineList.find((p) => p.invoiceNumber === `F-VIS-${RUN}`);
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.rejectionReason).toBe("not our invoice");
    expect(rejected?.verifiedAt).not.toBeNull();
  });
});
