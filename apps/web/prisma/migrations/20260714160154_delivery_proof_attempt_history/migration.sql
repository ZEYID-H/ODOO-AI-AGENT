-- CreateTable
CREATE TABLE "DeliveryProofAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryProofId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "imagePath" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryProofAttempt_deliveryProofId_fkey" FOREIGN KEY ("deliveryProofId") REFERENCES "DeliveryProof" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeliveryProofAttempt_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeliveryProofAttempt_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeliveryProofAttempt_submittedById_submittedAt_idx" ON "DeliveryProofAttempt"("submittedById", "submittedAt");

-- CreateIndex
CREATE INDEX "DeliveryProofAttempt_status_submittedAt_idx" ON "DeliveryProofAttempt"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProofAttempt_deliveryProofId_attemptNumber_key" ON "DeliveryProofAttempt"("deliveryProofId", "attemptNumber");

-- Backfill (D7): every DeliveryProof that existed before this migration
-- gets exactly one attempt — attemptNumber 1 — reconstructed from that
-- proof's own current-state columns. This is purely additive (no existing
-- table is redefined, no existing row is touched, nothing can be lost):
-- DeliveryProof itself is not modified by this migration at all.
--
-- Column mapping is a direct copy of "what the proof's current state
-- already says its one submission was":
--   uploadedAt   -> submittedAt   (when the (only) image was submitted)
--   driverId     -> submittedById (who submitted it)
--   status, rejectionReason, verifiedAt -> reviewedAt, verifiedById -> reviewedById
--     (the proof's current review outcome IS attempt 1's review outcome,
--      since there was only ever one attempt before D7)
--   imagePath, mimeType, sizeBytes -> copied as-is, including NULL for any
--     hypothetical metadata-only proof — DeliveryProofAttempt.imagePath is
--     nullable for exactly this reason (see the schema comment), so this
--     INSERT cannot fail on a NULL-image row, verified/rejected or pending.
--
-- id is synthesized with SQLite's own randomblob/hex (32 lowercase hex
-- chars) rather than an application cuid — safe because `id` is an opaque
-- unique String column with no format constraint anywhere it's read.
INSERT INTO "DeliveryProofAttempt" (
    "id",
    "deliveryProofId",
    "attemptNumber",
    "imagePath",
    "mimeType",
    "sizeBytes",
    "submittedAt",
    "submittedById",
    "status",
    "rejectionReason",
    "reviewedAt",
    "reviewedById",
    "createdAt",
    "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "id",
    1,
    "imagePath",
    "mimeType",
    "sizeBytes",
    "uploadedAt",
    "driverId",
    "status",
    "rejectionReason",
    "verifiedAt",
    "verifiedById",
    "createdAt",
    "updatedAt"
FROM "DeliveryProof";
