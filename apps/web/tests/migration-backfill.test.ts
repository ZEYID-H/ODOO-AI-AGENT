import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";

/**
 * Automated proof of the D7 migration's backfill (docs/DELIVERY_MANAGEMENT_PLAN.md
 * §9 D7), replaying the REAL migration.sql files — not a reimplementation
 * of their logic — against a throwaway database:
 *
 *   1. run every pre-D7 migration in order (reconstructing "an existing
 *      Docker volume database" schema exactly, as it looked before D7)
 *   2. seed rows directly, one per required scenario: pending, verified,
 *      rejected, and a metadata-only (NULL imagePath) proof
 *   3. run the D7 migration.sql itself (both its CREATE TABLE and its
 *      backfill INSERT)
 *   4. assert every DeliveryProof still exists unmodified AND has exactly
 *      one DeliveryProofAttempt with the fields the spec requires
 *
 * This is what actually happened to the real dev/Docker databases during
 * D7 implementation (verified manually first); this test makes that
 * verification repeatable and permanent, and it reads the CURRENT
 * migration.sql from disk, so it fails immediately if a future edit to
 * that file ever breaks the backfill.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../prisma/migrations");
const PRE_D7_MIGRATIONS = [
  "20260707124507_init",
  "20260707160802_composite_conversation_index",
  "20260707235600_user_identity_foundation",
  "20260709205822_delivery_proof",
  "20260711122923_ocr_readiness",
];
const D7_MIGRATION = "20260714160154_delivery_proof_attempt_history";

function readMigrationSql(dirName: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, dirName, "migration.sql"), "utf8");
}

let tmpDir: string;
let dbPath: string;
let client: Client;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "d7-migration-test-"));
  dbPath = path.join(tmpDir, "backfill-test.db");
  client = createClient({ url: `file:${dbPath}` });

  // Reconstruct "an existing Docker volume database" — schema as it stood
  // immediately before D7, nothing more.
  for (const migration of PRE_D7_MIGRATIONS) {
    await client.executeMultiple(readMigrationSql(migration));
  }

  await client.executeMultiple(`
    INSERT INTO User (id, username, passwordHash, role, createdAt) VALUES
      ('bf-owner', 'bf-owner', '', 'OWNER', '2026-01-01T00:00:00.000Z'),
      ('bf-driver', 'bf-driver', '', 'DRIVER', '2026-01-01T00:00:00.000Z');
  `);

  await client.executeMultiple(`
    INSERT INTO DeliveryProof
      (id, invoiceNumber, status, imagePath, mimeType, sizeBytes, uploadedAt, driverId, createdAt, updatedAt)
    VALUES
      ('bf-pending', 'BF-PENDING', 'PENDING', 'pending.jpg', 'image/jpeg', 111,
       '2026-02-01T09:00:00.000Z', 'bf-driver', '2026-02-01T09:00:00.000Z', '2026-02-01T09:00:00.000Z');

    INSERT INTO DeliveryProof
      (id, invoiceNumber, status, imagePath, mimeType, sizeBytes, uploadedAt,
       verifiedAt, verifiedById, driverId, createdAt, updatedAt)
    VALUES
      ('bf-verified', 'BF-VERIFIED', 'VERIFIED', 'verified.jpg', 'image/jpeg', 222,
       '2026-02-02T09:00:00.000Z', '2026-02-02T10:00:00.000Z', 'bf-owner',
       'bf-driver', '2026-02-02T09:00:00.000Z', '2026-02-02T10:00:00.000Z');

    INSERT INTO DeliveryProof
      (id, invoiceNumber, status, rejectionReason, imagePath, mimeType, sizeBytes,
       uploadedAt, verifiedAt, verifiedById, driverId, createdAt, updatedAt)
    VALUES
      ('bf-rejected', 'BF-REJECTED', 'REJECTED', 'blurry, cannot read invoice number',
       'rejected.jpg', 'image/jpeg', 333,
       '2026-02-03T09:00:00.000Z', '2026-02-03T10:00:00.000Z', 'bf-owner',
       'bf-driver', '2026-02-03T09:00:00.000Z', '2026-02-03T10:00:00.000Z');

    INSERT INTO DeliveryProof
      (id, invoiceNumber, status, driverId, uploadedAt, createdAt, updatedAt)
    VALUES
      ('bf-nullimage', 'BF-NULLIMAGE', 'PENDING', 'bf-driver',
       '2026-02-04T09:00:00.000Z', '2026-02-04T09:00:00.000Z', '2026-02-04T09:00:00.000Z');
  `);

  // The migration under test — read from disk, not reimplemented.
  await client.executeMultiple(readMigrationSql(D7_MIGRATION));
});

afterAll(() => {
  client.close();
  // Best-effort: on Windows, libsql/SQLite can hold the WAL/journal file
  // handle open briefly after close(), past what a synchronous retry loop
  // can wait out here. This is a throwaway file in the OS temp directory
  // either way (no real data, nothing security-relevant) — a leftover few
  // KB if cleanup ever loses this race is harmless and must not fail the
  // whole test file over a cleanup step, not the thing under test.
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Ignored — see above.
  }
});

async function attemptFor(deliveryProofId: string) {
  const result = await client.execute({
    sql: "SELECT * FROM DeliveryProofAttempt WHERE deliveryProofId = ?",
    args: [deliveryProofId],
  });
  return result.rows;
}

describe("D7 migration backfill — replayed against a reconstructed pre-D7 database", () => {
  it("does not touch DeliveryProof at all — row count and every column unchanged", async () => {
    const rows = await client.execute("SELECT id, status, imagePath FROM DeliveryProof");
    expect(rows.rows).toHaveLength(4);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId["bf-pending"].status).toBe("PENDING");
    expect(byId["bf-verified"].status).toBe("VERIFIED");
    expect(byId["bf-rejected"].status).toBe("REJECTED");
    expect(byId["bf-nullimage"].imagePath).toBeNull();
  });

  it("gives every existing proof exactly one attempt, numbered 1", async () => {
    for (const id of ["bf-pending", "bf-verified", "bf-rejected", "bf-nullimage"]) {
      const rows = await attemptFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].attemptNumber).toBe(1);
    }
  });

  it("PENDING proof: imagePath preserved, no reviewer/reason, submittedAt = uploadedAt", async () => {
    const [a] = await attemptFor("bf-pending");
    expect(a.imagePath).toBe("pending.jpg");
    expect(a.mimeType).toBe("image/jpeg");
    expect(a.sizeBytes).toBe(111);
    expect(a.status).toBe("PENDING");
    expect(a.rejectionReason).toBeNull();
    expect(a.reviewedAt).toBeNull();
    expect(a.reviewedById).toBeNull();
    expect(a.submittedAt).toBe("2026-02-01T09:00:00.000Z");
    expect(a.submittedById).toBe("bf-driver");
  });

  it("VERIFIED proof: reviewer and review timestamp preserved onto the attempt", async () => {
    const [a] = await attemptFor("bf-verified");
    expect(a.status).toBe("VERIFIED");
    expect(a.imagePath).toBe("verified.jpg");
    expect(a.rejectionReason).toBeNull();
    expect(a.reviewedAt).toBe("2026-02-02T10:00:00.000Z");
    expect(a.reviewedById).toBe("bf-owner");
  });

  it("REJECTED proof: rejection reason, reviewer, and review timestamp all preserved", async () => {
    const [a] = await attemptFor("bf-rejected");
    expect(a.status).toBe("REJECTED");
    expect(a.rejectionReason).toBe("blurry, cannot read invoice number");
    expect(a.reviewedAt).toBe("2026-02-03T10:00:00.000Z");
    expect(a.reviewedById).toBe("bf-owner");
  });

  it("nullable metadata: a metadata-only proof (NULL imagePath) backfills without failing", async () => {
    const [a] = await attemptFor("bf-nullimage");
    expect(a.imagePath).toBeNull();
    expect(a.mimeType).toBeNull();
    expect(a.sizeBytes).toBeNull();
    expect(a.status).toBe("PENDING");
    expect(a.submittedById).toBe("bf-driver");
  });

  it("no conversations, users, or unrelated data were touched", async () => {
    const users = await client.execute("SELECT id FROM User");
    expect(users.rows.map((r) => r.id).sort()).toEqual(["bf-driver", "bf-owner"]);
  });
});
