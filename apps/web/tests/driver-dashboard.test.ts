import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import {
  createDeliveryProofMetadata,
  verifyDeliveryProof,
  rejectDeliveryProof,
  getMyDeliveryProofSummary,
  getMyDeliveryProof,
} from "@/app/actions/delivery-proofs";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `dd-owner-${RUN}`;
const DRIVER_A = `dd-driver-a-${RUN}`;
const DRIVER_B = `dd-driver-b-${RUN}`;

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

async function driverCreates(driverId: string, invoiceNumber: string): Promise<string> {
  mockSessionFor(driverId, "DRIVER");
  const proof = await createDeliveryProofMetadata({ invoiceNumber });
  return proof.id;
}

// Driver A: one of each status. Driver B: one pending (isolation control).
let a_pending: string;
let a_verified: string;
let a_rejected: string;
let b_pending: string;

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: OWNER_ID, username: OWNER_ID, passwordHash: "", role: "OWNER" },
      { id: DRIVER_A, username: DRIVER_A, passwordHash: "", role: "DRIVER" },
      { id: DRIVER_B, username: DRIVER_B, passwordHash: "", role: "DRIVER" },
    ],
  });

  a_pending = await driverCreates(DRIVER_A, `DD-A-PEND-${RUN}`);
  a_verified = await driverCreates(DRIVER_A, `DD-A-VER-${RUN}`);
  a_rejected = await driverCreates(DRIVER_A, `DD-A-REJ-${RUN}`);
  b_pending = await driverCreates(DRIVER_B, `DD-B-PEND-${RUN}`);

  mockSessionFor(OWNER_ID, "OWNER");
  await verifyDeliveryProof(a_verified);
  await rejectDeliveryProof(a_rejected, "photo unreadable");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_A, DRIVER_B] } } });
});

describe("getMyDeliveryProofSummary (D6) — counts are correct and driver-scoped", () => {
  it("counts only the session driver's proofs, by status", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const summary = await getMyDeliveryProofSummary();

    expect(summary.total).toBe(3);
    expect(summary.pending).toBe(1);
    expect(summary.verified).toBe(1);
    expect(summary.rejected).toBe(1);
    // All three were created during this test run → all "today".
    expect(summary.uploadedToday).toBe(3);
  });

  it("another driver's proofs never bleed into the count", async () => {
    mockSessionFor(DRIVER_B, "DRIVER");
    const summary = await getMyDeliveryProofSummary();
    expect(summary.total).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.verified).toBe(0);
    expect(summary.rejected).toBe(0);
  });

  it("is refused for OWNER, role-less, and unauthenticated sessions", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(getMyDeliveryProofSummary()).rejects.toThrow(/not authorized/i);

    mockSessionFor(DRIVER_A);
    await expect(getMyDeliveryProofSummary()).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(getMyDeliveryProofSummary()).rejects.toThrow(/not authenticated/i);
  });
});

describe("getMyDeliveryProof (D6) — own detail only, no owner-only fields", () => {
  it("returns the driver's own proof", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await getMyDeliveryProof(a_pending);
    expect(proof?.id).toBe(a_pending);
    expect(proof?.invoiceNumber).toBe(`DD-A-PEND-${RUN}`);
    expect(proof?.status).toBe("PENDING");
  });

  it("shows the rejection reason on the driver's own rejected proof", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await getMyDeliveryProof(a_rejected);
    expect(proof?.status).toBe("REJECTED");
    expect(proof?.rejectionReason).toBe("photo unreadable");
  });

  it("never carries OCR or reviewer-identity fields (owner-only)", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    const proof = await getMyDeliveryProof(a_verified);
    expect(proof).not.toBeNull();
    for (const key of Object.keys(proof!)) {
      expect(key.toLowerCase()).not.toContain("ocr");
    }
    expect(proof).not.toHaveProperty("verifiedByUsername");
    expect(proof).not.toHaveProperty("driverUsername");
    expect(proof).not.toHaveProperty("driverId");
  });

  it("cannot open another driver's proof — null, indistinguishable from unknown", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    expect(await getMyDeliveryProof(b_pending)).toBeNull();
    expect(await getMyDeliveryProof("no-such-proof")).toBeNull();
    expect(await getMyDeliveryProof("")).toBeNull();

    // And symmetrically: B cannot open A's.
    mockSessionFor(DRIVER_B, "DRIVER");
    expect(await getMyDeliveryProof(a_pending)).toBeNull();
  });

  it("is refused for OWNER, role-less, and unauthenticated sessions", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(getMyDeliveryProof(a_pending)).rejects.toThrow(/not authorized/i);

    mockSessionFor(DRIVER_A);
    await expect(getMyDeliveryProof(a_pending)).rejects.toThrow(/not authorized/i);

    mockedAuth.mockResolvedValue(null);
    await expect(getMyDeliveryProof(a_pending)).rejects.toThrow(/not authenticated/i);
  });
});
