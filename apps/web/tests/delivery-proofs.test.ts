import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
// Same stubbing rationale as conversations.test.ts: the actions gate
// through lib/session-guard.ts, which imports server-only/next-navigation.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { auth } from "@/auth";
import {
  createDeliveryProofMetadata,
  listMyDeliveryProofs,
  listAllDeliveryProofsForOwner,
  getDeliveryProofForOwner,
  verifyDeliveryProof,
  rejectDeliveryProof,
} from "@/app/actions/delivery-proofs";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

// Real DB-backed tests against prisma/test.db (same pattern as
// conversations.test.ts) — FK constraints require real User rows, so the
// principals are created up front and cascade-deleted afterwards.
const RUN = Date.now();
const OWNER_ID = `dp-owner-${RUN}`;
const DRIVER_A = `dp-driver-a-${RUN}`;
const DRIVER_B = `dp-driver-b-${RUN}`;

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
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
  // Cascades to each driver's proofs via onDelete: Cascade.
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_A, DRIVER_B] } } });
});

describe("createDeliveryProofMetadata (DRIVER)", () => {
  it("creates a PENDING proof owned by the session's driver — id never comes from the client", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await createDeliveryProofMetadata({
      invoiceNumber: "  INV-1001  ",
      customerName: "APPLE MART",
      notes: "Left at reception",
    });

    expect(proof.status).toBe("PENDING");
    expect(proof.invoiceNumber).toBe("INV-1001"); // trimmed
    expect(proof.customerName).toBe("APPLE MART");
    expect(proof.imagePath).toBeNull(); // D2: metadata only
    expect(proof.verifiedAt).toBeNull();

    const row = await prisma.deliveryProof.findUnique({ where: { id: proof.id } });
    expect(row?.driverId).toBe(DRIVER_A);
  });

  it("treats absent/empty optional fields as null", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await createDeliveryProofMetadata({ invoiceNumber: "   " });
    expect(proof.invoiceNumber).toBeNull();
    expect(proof.customerName).toBeNull();
    expect(proof.notes).toBeNull();
  });

  it("rejects invalid metadata loudly (over-length and non-string) — never truncates", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await expect(
      createDeliveryProofMetadata({ invoiceNumber: "x".repeat(65) })
    ).rejects.toThrow(/64/);
    await expect(
      createDeliveryProofMetadata({ customerName: "x".repeat(129) })
    ).rejects.toThrow(/128/);
    await expect(
      createDeliveryProofMetadata({ notes: "x".repeat(1001) })
    ).rejects.toThrow(/1000/);
    await expect(createDeliveryProofMetadata({ notes: 123 })).rejects.toThrow(/text/i);
  });

  it("is refused for OWNER, role-less, and unauthenticated sessions", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(createDeliveryProofMetadata({})).rejects.toThrow(/not authorized/i);

    mockSessionFor(DRIVER_A);
    await expect(createDeliveryProofMetadata({})).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(createDeliveryProofMetadata({})).rejects.toThrow(/not authenticated/i);
  });
});

describe("listMyDeliveryProofs (DRIVER) — strict per-driver isolation", () => {
  it("returns only the session driver's proofs, newest first", async () => {
    mockSessionFor(DRIVER_B, "DRIVER");
    await createDeliveryProofMetadata({ invoiceNumber: "B-ONLY-1" });

    mockSessionFor(DRIVER_A, "DRIVER");
    const listA = await listMyDeliveryProofs();
    expect(listA.length).toBeGreaterThan(0);
    expect(listA.some((p) => p.invoiceNumber === "B-ONLY-1")).toBe(false);

    mockSessionFor(DRIVER_B, "DRIVER");
    const listB = await listMyDeliveryProofs();
    expect(listB.some((p) => p.invoiceNumber === "B-ONLY-1")).toBe(true);
    expect(listB.some((p) => p.invoiceNumber === "INV-1001")).toBe(false);
  });

  it("is refused for OWNER and unauthenticated sessions", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(listMyDeliveryProofs()).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(listMyDeliveryProofs()).rejects.toThrow(/not authenticated/i);
  });
});

describe("owner listing and detail views", () => {
  it("OWNER sees all drivers' proofs with usernames — and no credential fields", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    const all = await listAllDeliveryProofsForOwner();

    const invoices = all.map((p) => p.invoiceNumber);
    expect(invoices).toContain("INV-1001");
    expect(invoices).toContain("B-ONLY-1");

    const mine = all.find((p) => p.invoiceNumber === "INV-1001")!;
    expect(mine.driverUsername).toBe(DRIVER_A);
    // The view must never carry sensitive user fields.
    for (const proof of all) {
      expect(proof).not.toHaveProperty("passwordHash");
      expect(proof).not.toHaveProperty("driver");
      expect(proof).not.toHaveProperty("verifiedBy");
    }
  });

  it("DRIVER cannot list all proofs", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await expect(listAllDeliveryProofsForOwner()).rejects.toThrow(/not authorized/i);
  });

  it("getDeliveryProofForOwner returns the proof for OWNER, null for unknown ids", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    const all = await listAllDeliveryProofsForOwner();
    const one = await getDeliveryProofForOwner(all[0].id);
    expect(one?.id).toBe(all[0].id);

    expect(await getDeliveryProofForOwner("no-such-proof")).toBeNull();
    expect(await getDeliveryProofForOwner("")).toBeNull();
  });

  it("DRIVER cannot fetch the owner detail view — even for their own proof", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const own = (await listMyDeliveryProofs())[0];
    await expect(getDeliveryProofForOwner(own.id)).rejects.toThrow(/not authorized/i);
  });
});

describe("verify / reject (OWNER only, PENDING only, exactly once)", () => {
  async function freshProof(driverId: string): Promise<string> {
    mockSessionFor(driverId, "DRIVER");
    const proof = await createDeliveryProofMetadata({ invoiceNumber: `REV-${Math.random()}` });
    return proof.id;
  }

  it("OWNER can verify a pending proof — sets verifiedAt/reviewer, clears any reason", async () => {
    const id = await freshProof(DRIVER_A);

    mockSessionFor(OWNER_ID, "OWNER");
    const verified = await verifyDeliveryProof(id);

    expect(verified.status).toBe("VERIFIED");
    expect(verified.rejectionReason).toBeNull();
    expect(verified.verifiedAt).not.toBeNull();
    expect(verified.verifiedByUsername).toBe(OWNER_ID);
  });

  it("OWNER can reject a pending proof with a reason — verifiedAt records the review time", async () => {
    const id = await freshProof(DRIVER_A);

    mockSessionFor(OWNER_ID, "OWNER");
    const rejected = await rejectDeliveryProof(id, "  Photo does not match invoice  ");

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Photo does not match invoice"); // trimmed
    expect(rejected.verifiedAt).not.toBeNull();
    expect(rejected.verifiedByUsername).toBe(OWNER_ID);
  });

  it("rejection requires a non-empty reason, capped at 500 chars", async () => {
    const id = await freshProof(DRIVER_A);

    mockSessionFor(OWNER_ID, "OWNER");
    await expect(rejectDeliveryProof(id, "")).rejects.toThrow(/reason is required/i);
    await expect(rejectDeliveryProof(id, "   ")).rejects.toThrow(/reason is required/i);
    await expect(rejectDeliveryProof(id, "x".repeat(501))).rejects.toThrow(/500/);

    // Still pending — the failed rejections changed nothing.
    const proof = await getDeliveryProofForOwner(id);
    expect(proof?.status).toBe("PENDING");
  });

  it("a decided proof cannot be re-reviewed (either direction)", async () => {
    const id = await freshProof(DRIVER_B);

    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(id);

    await expect(verifyDeliveryProof(id)).rejects.toThrow(/not found or already reviewed/i);
    await expect(rejectDeliveryProof(id, "changed my mind")).rejects.toThrow(
      /not found or already reviewed/i
    );

    const proof = await getDeliveryProofForOwner(id);
    expect(proof?.status).toBe("VERIFIED");
  });

  it("unknown/deleted proof ids are handled safely and indistinguishably", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(verifyDeliveryProof("no-such-id")).rejects.toThrow(
      /not found or already reviewed/i
    );
    await expect(rejectDeliveryProof("no-such-id", "reason")).rejects.toThrow(
      /not found or already reviewed/i
    );
  });

  it("DRIVER cannot verify or reject — not even their own proof", async () => {
    const id = await freshProof(DRIVER_A);

    mockSessionFor(DRIVER_A, "DRIVER");
    await expect(verifyDeliveryProof(id)).rejects.toThrow(/not authorized/i);
    await expect(rejectDeliveryProof(id, "self-serve")).rejects.toThrow(/not authorized/i);

    mockSessionFor(OWNER_ID, "OWNER");
    const proof = await getDeliveryProofForOwner(id);
    expect(proof?.status).toBe("PENDING");
  });

  it("role-less sessions (pre-D1 cookies) fail closed on every proof action", async () => {
    mockSessionFor(OWNER_ID);
    await expect(listAllDeliveryProofsForOwner()).rejects.toThrow(/not authorized/i);
    await expect(verifyDeliveryProof("any")).rejects.toThrow(/not authorized/i);
    await expect(rejectDeliveryProof("any", "r")).rejects.toThrow(/not authorized/i);
    await expect(listMyDeliveryProofs()).rejects.toThrow(/not authorized/i);
  });
});
