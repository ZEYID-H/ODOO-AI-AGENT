import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import {
  uploadDeliveryProof,
  resubmitRejectedDeliveryProof,
  verifyDeliveryProof,
  rejectDeliveryProof,
} from "@/app/actions/delivery-proofs";
import {
  listMyDeliveryNotifications,
  getMyUnreadDeliveryNotificationCount,
  markMyDeliveryNotificationsRead,
} from "@/app/actions/delivery-notifications";
import { deleteProofImage } from "@/lib/file-storage";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

const RUN = Date.now();
const OWNER_ID = `dn-owner-${RUN}`;
const DRIVER_A = `dn-driver-a-${RUN}`;
const DRIVER_B = `dn-driver-b-${RUN}`;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function mockSessionFor(userId: string, role?: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: userId, ...(role ? { role } : {}) },
    expires: "2099-01-01",
  } as never);
}

function jpegFile(name = "photo.jpg"): File {
  return new File([JPEG_BYTES], name, { type: "image/jpeg" });
}

function uploadForm(fields: Record<string, string>, image?: File): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (image) fd.set("image", image);
  return fd;
}

function resubmitForm(proofId: string, image?: File): FormData {
  const fd = new FormData();
  fd.set("proofId", proofId);
  if (image) fd.set("image", image);
  return fd;
}

/** Uploads a proof (real action) and returns its id. */
async function freshProof(driverId: string, invoiceNumber: string): Promise<string> {
  mockSessionFor(driverId, "DRIVER");
  const state = await uploadDeliveryProof(undefined, uploadForm({ invoiceNumber }, jpegFile()));
  expect(state.error).toBeUndefined();
  const proof = await prisma.deliveryProof.findFirstOrThrow({
    where: { driverId, invoiceNumber },
  });
  return proof.id;
}

/** Uploads, then rejects (real actions both), returning the proof id. */
async function freshRejectedProof(
  driverId: string,
  invoiceNumber: string,
  reason = "photo unreadable"
): Promise<string> {
  const id = await freshProof(driverId, invoiceNumber);
  mockSessionFor(OWNER_ID, "OWNER");
  await rejectDeliveryProof(id, reason);
  return id;
}

/** Directly seeds a parent proof + one controlled attempt with an explicit
 * timestamp, for deterministic ordering/unread tests where the real action
 * flow's "now"-based timestamps would be too close together to assert
 * ordering reliably (same technique already used in
 * tests/delivery-proof-resubmission.test.ts and
 * tests/driver-dashboard.test.ts for the same reason). */
async function seedControlledEvent(
  driverId: string,
  invoiceNumber: string,
  opts: {
    attemptNumber?: number;
    status?: "PENDING" | "VERIFIED" | "REJECTED";
    submittedAt: Date;
    reviewedAt?: Date;
    rejectionReason?: string;
  }
): Promise<{ proofId: string; attemptId: string }> {
  const proof = await prisma.deliveryProof.create({
    data: { driverId, invoiceNumber, status: opts.status ?? "PENDING" },
  });
  const attempt = await prisma.deliveryProofAttempt.create({
    data: {
      deliveryProofId: proof.id,
      attemptNumber: opts.attemptNumber ?? 1,
      submittedAt: opts.submittedAt,
      submittedById: driverId,
      status: opts.status ?? "PENDING",
      reviewedAt: opts.reviewedAt,
      reviewedById: opts.reviewedAt ? OWNER_ID : undefined,
      rejectionReason: opts.rejectionReason,
    },
  });
  return { proofId: proof.id, attemptId: attempt.id };
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
  const attempts = await prisma.deliveryProofAttempt.findMany({
    where: { submittedById: { in: [DRIVER_A, DRIVER_B] } },
    select: { imagePath: true },
  });
  for (const a of attempts) {
    if (a.imagePath) await deleteProofImage(a.imagePath);
  }
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, DRIVER_A, DRIVER_B] } } });
});

describe("Event derivation (D8)", () => {
  it("a verified attempt produces a VERIFIED event", async () => {
    const id = await freshProof(DRIVER_A, `EVT-VERIFIED-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(id);

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const event = events.find((e) => e.deliveryProofId === id);
    expect(event).toMatchObject({ type: "VERIFIED", attemptNumber: 1 });
    expect(event!.rejectionReason).toBeNull();
  });

  it("a rejected attempt produces a REJECTED event carrying the immutable reason", async () => {
    const id = await freshRejectedProof(DRIVER_A, `EVT-REJECTED-${RUN}`, "smudged text");

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const event = events.find((e) => e.deliveryProofId === id);
    expect(event).toMatchObject({ type: "REJECTED", rejectionReason: "smudged text" });
  });

  it("attemptNumber > 1 produces a RESUBMITTED_PENDING event at submittedAt", async () => {
    const id = await freshRejectedProof(DRIVER_A, `EVT-RESUBMIT-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));

    const events = await listMyDeliveryNotifications();
    const event = events.find(
      (e) => e.deliveryProofId === id && e.type === "RESUBMITTED_PENDING"
    );
    expect(event).toBeDefined();
    expect(event!.attemptNumber).toBe(2);

    const attempt2 = await prisma.deliveryProofAttempt.findFirstOrThrow({
      where: { deliveryProofId: id, attemptNumber: 2 },
    });
    expect(new Date(event!.eventAt).getTime()).toBe(attempt2.submittedAt.getTime());
  });

  it("a resubmitted attempt (attempt 2) later REJECTED produces both its RESUBMITTED_PENDING and its own REJECTED event — while attempt 1's original REJECTED event is untouched", async () => {
    const id = await freshRejectedProof(DRIVER_A, `EVT-RESUB-REJ-${RUN}`, "first reason");
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    mockSessionFor(OWNER_ID, "OWNER");
    await rejectDeliveryProof(id, "second reason");

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const forProof = events.filter((e) => e.deliveryProofId === id);
    // Three events total: attempt 1's original rejection is never lost or
    // rewritten (D7's immutability guarantee, carried into D8's feed),
    // plus attempt 2's own resubmission and its own rejection.
    expect(forProof.map((e) => e.type).sort()).toEqual([
      "REJECTED",
      "REJECTED",
      "RESUBMITTED_PENDING",
    ]);

    const attempt1Event = forProof.find((e) => e.type === "REJECTED" && e.attemptNumber === 1)!;
    expect(attempt1Event.rejectionReason).toBe("first reason");
    const attempt2Event = forProof.find((e) => e.type === "REJECTED" && e.attemptNumber === 2)!;
    expect(attempt2Event.rejectionReason).toBe("second reason");
    const resubmitted = forProof.find((e) => e.type === "RESUBMITTED_PENDING")!;
    expect(resubmitted.attemptNumber).toBe(2);
  });

  it("a resubmitted attempt (attempt 2) later VERIFIED produces both its RESUBMITTED_PENDING and a VERIFIED event", async () => {
    const id = await freshRejectedProof(DRIVER_A, `EVT-RESUB-VER-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(id);

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const forProof = events.filter((e) => e.deliveryProofId === id);
    // Attempt 1's original rejection persists alongside attempt 2's
    // resubmission-then-verification — three events, not two.
    expect(forProof.map((e) => e.type).sort()).toEqual([
      "REJECTED",
      "RESUBMITTED_PENDING",
      "VERIFIED",
    ]);
    const verified = forProof.find((e) => e.type === "VERIFIED")!;
    expect(verified.attemptNumber).toBe(2);
  });

  it("a pending initial attempt (attempt 1, never reviewed) produces no notification", async () => {
    const id = await freshProof(DRIVER_A, `EVT-PENDING-NONE-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    expect(events.some((e) => e.deliveryProofId === id)).toBe(false);
  });

  it("a failed review produces no event (rejects an already-decided proof)", async () => {
    const id = await freshProof(DRIVER_A, `EVT-FAILED-REVIEW-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(id);
    await expect(rejectDeliveryProof(id, "too late")).rejects.toThrow();

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = (await listMyDeliveryNotifications()).filter((e) => e.deliveryProofId === id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("VERIFIED"); // not REJECTED — the failed call never committed
  });

  it("a failed resubmission (still-pending proof) produces no RESUBMITTED_PENDING event", async () => {
    const id = await freshProof(DRIVER_A, `EVT-FAILED-RESUBMIT-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const state = await resubmitRejectedDeliveryProof(undefined, resubmitForm(id, jpegFile()));
    expect(state.error).toMatch(/only rejected proofs/i);

    const events = (await listMyDeliveryNotifications()).filter((e) => e.deliveryProofId === id);
    expect(events).toHaveLength(0);
  });
});

describe("Ordering (D8)", () => {
  it("events are newest-first", async () => {
    const t1 = new Date("2026-03-01T09:00:00.000Z");
    const t2 = new Date("2026-03-02T09:00:00.000Z");
    const t3 = new Date("2026-03-03T09:00:00.000Z");
    await seedControlledEvent(DRIVER_A, `ORD-A-${RUN}`, {
      status: "VERIFIED",
      submittedAt: t1,
      reviewedAt: t1,
    });
    await seedControlledEvent(DRIVER_A, `ORD-B-${RUN}`, {
      status: "VERIFIED",
      submittedAt: t2,
      reviewedAt: t3,
    });
    await seedControlledEvent(DRIVER_A, `ORD-C-${RUN}`, {
      status: "VERIFIED",
      submittedAt: t2,
      reviewedAt: t2,
    });

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    // Global monotonic check across the whole returned list — newest first,
    // never out of order, regardless of how many other tests' events share
    // this driver's inbox by the time this runs.
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i - 1].eventAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i].eventAt).getTime()
      );
    }
    // And specifically: the three seeded events above (t3 > t2 == t2 > t1)
    // appear in the right relative order among themselves.
    const seeded = events.filter((e) =>
      [`ORD-A-${RUN}`, `ORD-B-${RUN}`, `ORD-C-${RUN}`].includes(e.invoiceNumber ?? "")
    );
    expect(seeded.map((e) => e.invoiceNumber)).toEqual([
      `ORD-B-${RUN}`, // t3 (reviewedAt) — newest
      `ORD-C-${RUN}`, // t2
      `ORD-A-${RUN}`, // t1 — oldest
    ]);
  });

  it("submitted and reviewed timestamps of the SAME attempt are ordered correctly relative to each other", async () => {
    const submittedAt = new Date("2026-04-01T08:00:00.000Z");
    const reviewedAt = new Date("2026-04-05T08:00:00.000Z"); // reviewed days later
    const { proofId } = await seedControlledEvent(DRIVER_A, `ORD-GAP-${RUN}`, {
      attemptNumber: 2, // >1 so it also produces a RESUBMITTED_PENDING event
      status: "VERIFIED",
      submittedAt,
      reviewedAt,
    });

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = (await listMyDeliveryNotifications()).filter(
      (e) => e.deliveryProofId === proofId
    );
    const resubmitted = events.find((e) => e.type === "RESUBMITTED_PENDING")!;
    const verified = events.find((e) => e.type === "VERIFIED")!;
    expect(new Date(resubmitted.eventAt).getTime()).toBe(submittedAt.getTime());
    expect(new Date(verified.eventAt).getTime()).toBe(reviewedAt.getTime());
    // Newest-first: the review (later) must precede the submission (earlier)
    // in the returned array.
    const indexOfReviewed = events.findIndex((e) => e.type === "VERIFIED");
    const indexOfSubmitted = events.findIndex((e) => e.type === "RESUBMITTED_PENDING");
    expect(indexOfReviewed).toBeLessThan(indexOfSubmitted);
  });

  it("stable event IDs are deterministic across repeated calls", async () => {
    const id = await freshRejectedProof(DRIVER_A, `ORD-STABLE-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const first = await listMyDeliveryNotifications();
    const second = await listMyDeliveryNotifications();
    const a = first.find((e) => e.deliveryProofId === id)!;
    const b = second.find((e) => e.deliveryProofId === id)!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^attempt:.+:reviewed$/);
  });

  it("the result limit is enforced (bounded even with many events)", async () => {
    const driver = `dn-driver-limit-${RUN}`;
    await prisma.user.create({ data: { id: driver, username: driver, passwordHash: "", role: "DRIVER" } });

    const base = new Date("2026-05-01T00:00:00.000Z");
    for (let i = 0; i < 60; i++) {
      await seedControlledEvent(driver, `LIMIT-${i}-${RUN}`, {
        status: "VERIFIED",
        submittedAt: new Date(base.getTime() + i * 1000),
        reviewedAt: new Date(base.getTime() + i * 1000 + 500),
      });
    }

    mockSessionFor(driver, "DRIVER");
    const events = await listMyDeliveryNotifications();
    expect(events.length).toBe(50); // 60 VERIFIED events exist; list caps at 50
    const count = await getMyUnreadDeliveryNotificationCount();
    expect(count).toBeGreaterThanOrEqual(60); // the count is NOT capped

    await prisma.user.delete({ where: { id: driver } });
  });
});

describe("Unread behavior (D8)", () => {
  it("an event newer than the cursor is unread; an event at/older than the cursor is read", async () => {
    const driver = `dn-driver-unread-${RUN}`;
    const cursor = new Date("2026-06-10T00:00:00.000Z");
    await prisma.user.create({
      data: { id: driver, username: driver, passwordHash: "", role: "DRIVER", deliveryNotificationsSeenAt: cursor },
    });

    await seedControlledEvent(driver, `UNREAD-OLD-${RUN}`, {
      status: "VERIFIED",
      submittedAt: new Date("2026-06-05T00:00:00.000Z"),
      reviewedAt: new Date("2026-06-05T00:00:00.000Z"), // before cursor
    });
    await seedControlledEvent(driver, `UNREAD-NEW-${RUN}`, {
      status: "VERIFIED",
      submittedAt: new Date("2026-06-15T00:00:00.000Z"),
      reviewedAt: new Date("2026-06-15T00:00:00.000Z"), // after cursor
    });

    mockSessionFor(driver, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const oldEvent = events.find((e) => e.invoiceNumber === `UNREAD-OLD-${RUN}`)!;
    const newEvent = events.find((e) => e.invoiceNumber === `UNREAD-NEW-${RUN}`)!;
    expect(oldEvent.read).toBe(true);
    expect(newEvent.read).toBe(false);

    const count = await getMyUnreadDeliveryNotificationCount();
    expect(count).toBe(1);

    await prisma.user.delete({ where: { id: driver } });
  });

  it("a NULL cursor (never opened the inbox) treats every event as unread", async () => {
    const driver = `dn-driver-nullcursor-${RUN}`;
    await prisma.user.create({
      data: { id: driver, username: driver, passwordHash: "", role: "DRIVER", deliveryNotificationsSeenAt: null },
    });
    await seedControlledEvent(driver, `NULLCURSOR-${RUN}`, {
      status: "VERIFIED",
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
      reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mockSessionFor(driver, "DRIVER");
    const events = await listMyDeliveryNotifications();
    expect(events[0].read).toBe(false);
    expect(await getMyUnreadDeliveryNotificationCount()).toBe(1);

    await prisma.user.delete({ where: { id: driver } });
  });

  it("marking read advances the server-side cursor, computed from server time, no client input", async () => {
    const id = await freshRejectedProof(DRIVER_A, `UNREAD-MARK-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");

    const before = Date.now();
    await markMyDeliveryNotificationsRead();
    const after = Date.now();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: DRIVER_A } });
    expect(user.deliveryNotificationsSeenAt).not.toBeNull();
    const cursorMs = user.deliveryNotificationsSeenAt!.getTime();
    expect(cursorMs).toBeGreaterThanOrEqual(before - 1000);
    expect(cursorMs).toBeLessThanOrEqual(after + 1000);

    const events = (await listMyDeliveryNotifications()).filter((e) => e.deliveryProofId === id);
    expect(events[0].read).toBe(true);
  });

  it("an event created AFTER the cursor was advanced remains unread", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await markMyDeliveryNotificationsRead(); // clean slate for driver A

    const id = await freshRejectedProof(DRIVER_A, `UNREAD-AFTER-MARK-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const events = (await listMyDeliveryNotifications()).filter((e) => e.deliveryProofId === id);
    expect(events[0].read).toBe(false);
  });

  it("calling list or the unread count never itself advances the cursor", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await markMyDeliveryNotificationsRead();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: DRIVER_A } });

    await listMyDeliveryNotifications();
    await listMyDeliveryNotifications();
    await getMyUnreadDeliveryNotificationCount();
    await getMyUnreadDeliveryNotificationCount();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: DRIVER_A } });
    expect(after.deliveryNotificationsSeenAt?.getTime()).toBe(
      before.deliveryNotificationsSeenAt?.getTime()
    );
  });

  it("an unrelated action (e.g. listing proofs) never advances the notification cursor", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    await markMyDeliveryNotificationsRead();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: DRIVER_A } });

    await freshProof(DRIVER_A, `UNRELATED-ACTION-${RUN}`);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: DRIVER_A } });
    expect(after.deliveryNotificationsSeenAt?.getTime()).toBe(
      before.deliveryNotificationsSeenAt?.getTime()
    );
  });

  it("another driver's events never affect this driver's unread count", async () => {
    const idA = await freshRejectedProof(DRIVER_A, `CROSS-COUNT-A-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    await markMyDeliveryNotificationsRead();

    // Driver B gets a fresh unread event; must not affect A's count.
    await freshRejectedProof(DRIVER_B, `CROSS-COUNT-B-${RUN}`);

    mockSessionFor(DRIVER_A, "DRIVER");
    const countA = await getMyUnreadDeliveryNotificationCount();
    expect(countA).toBe(0);

    mockSessionFor(DRIVER_B, "DRIVER");
    const countB = await getMyUnreadDeliveryNotificationCount();
    expect(countB).toBeGreaterThan(0);

    void idA;
  });
});

describe("Authorization (D8)", () => {
  it("DRIVER sees only their own events — cross-driver events never leak", async () => {
    await freshRejectedProof(DRIVER_A, `AUTH-A-${RUN}`);
    await freshRejectedProof(DRIVER_B, `AUTH-B-${RUN}`);

    mockSessionFor(DRIVER_A, "DRIVER");
    const eventsA = await listMyDeliveryNotifications();
    expect(eventsA.some((e) => e.invoiceNumber === `AUTH-B-${RUN}`)).toBe(false);

    mockSessionFor(DRIVER_B, "DRIVER");
    const eventsB = await listMyDeliveryNotifications();
    expect(eventsB.some((e) => e.invoiceNumber === `AUTH-A-${RUN}`)).toBe(false);
  });

  it("OWNER cannot call any driver notification action", async () => {
    mockSessionFor(OWNER_ID, "OWNER");
    await expect(listMyDeliveryNotifications()).rejects.toThrow(/not authorized/i);
    await expect(getMyUnreadDeliveryNotificationCount()).rejects.toThrow(/not authorized/i);
    await expect(markMyDeliveryNotificationsRead()).rejects.toThrow(/not authorized/i);
  });

  it("role-less sessions fail closed", async () => {
    mockSessionFor(DRIVER_A);
    await expect(listMyDeliveryNotifications()).rejects.toThrow(/not authorized/i);
    await expect(getMyUnreadDeliveryNotificationCount()).rejects.toThrow(/not authorized/i);
    await expect(markMyDeliveryNotificationsRead()).rejects.toThrow(/not authorized/i);
  });

  it("unauthenticated sessions fail closed", async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(listMyDeliveryNotifications()).rejects.toThrow(/not authenticated/i);
    await expect(getMyUnreadDeliveryNotificationCount()).rejects.toThrow(/not authenticated/i);
    await expect(markMyDeliveryNotificationsRead()).rejects.toThrow(/not authenticated/i);
  });

  it("no action accepts any parameter — client-supplied identity cannot change query scope", async () => {
    mockSessionFor(DRIVER_A, "DRIVER");
    expect(listMyDeliveryNotifications.length).toBe(0);
    expect(getMyUnreadDeliveryNotificationCount.length).toBe(0);
    expect(markMyDeliveryNotificationsRead.length).toBe(0);
  });
});

describe("DTO / security (D8)", () => {
  it("no OCR fields, reviewer ids, internal image paths, or unrelated metadata are exposed", async () => {
    const id = await freshRejectedProof(DRIVER_A, `DTO-SAFE-${RUN}`);
    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const event = events.find((e) => e.deliveryProofId === id)!;

    for (const key of Object.keys(event)) {
      expect(key.toLowerCase()).not.toContain("ocr");
    }
    expect(event).not.toHaveProperty("imagePath");
    expect(event).not.toHaveProperty("reviewedById");
    expect(event).not.toHaveProperty("verifiedById");
    expect(event).not.toHaveProperty("submittedById");
    expect(event).not.toHaveProperty("driverId");
    expect(Object.keys(event).sort()).toEqual(
      [
        "attemptNumber",
        "customerName",
        "deliveryProofId",
        "eventAt",
        "id",
        "invoiceNumber",
        "read",
        "rejectionReason",
        "type",
      ].sort()
    );
  });

  it("rejectionReason is populated ONLY on REJECTED events", async () => {
    const rejectedId = await freshRejectedProof(DRIVER_A, `DTO-REJ-${RUN}`, "bad photo");
    const verifiedId = await freshProof(DRIVER_A, `DTO-VER-${RUN}`);
    mockSessionFor(OWNER_ID, "OWNER");
    await verifyDeliveryProof(verifiedId);

    mockSessionFor(DRIVER_A, "DRIVER");
    const events = await listMyDeliveryNotifications();
    const rejected = events.find((e) => e.deliveryProofId === rejectedId)!;
    const verified = events.find((e) => e.deliveryProofId === verifiedId)!;
    expect(rejected.rejectionReason).toBe("bad photo");
    expect(verified.rejectionReason).toBeNull();

    const resubmitId = await freshRejectedProof(DRIVER_A, `DTO-RESUB-${RUN}`, "reason");
    mockSessionFor(DRIVER_A, "DRIVER");
    await resubmitRejectedDeliveryProof(undefined, resubmitForm(resubmitId, jpegFile()));
    const afterResubmit = (await listMyDeliveryNotifications()).find(
      (e) => e.deliveryProofId === resubmitId && e.type === "RESUBMITTED_PENDING"
    )!;
    expect(afterResubmit.rejectionReason).toBeNull();
  });
});
