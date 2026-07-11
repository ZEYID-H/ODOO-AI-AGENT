-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeliveryProof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT,
    "customerName" TEXT,
    "notes" TEXT,
    "imagePath" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "ocrStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ocrText" TEXT,
    "ocrInvoiceNumber" TEXT,
    "ocrCustomerName" TEXT,
    "ocrConfidence" REAL,
    "ocrProcessedAt" DATETIME,
    "ocrError" TEXT,
    "driverId" TEXT NOT NULL,
    "verifiedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryProof_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeliveryProof_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DeliveryProof" ("createdAt", "customerName", "driverId", "id", "imagePath", "invoiceNumber", "mimeType", "notes", "rejectionReason", "sizeBytes", "status", "updatedAt", "uploadedAt", "verifiedAt", "verifiedById") SELECT "createdAt", "customerName", "driverId", "id", "imagePath", "invoiceNumber", "mimeType", "notes", "rejectionReason", "sizeBytes", "status", "updatedAt", "uploadedAt", "verifiedAt", "verifiedById" FROM "DeliveryProof";
DROP TABLE "DeliveryProof";
ALTER TABLE "new_DeliveryProof" RENAME TO "DeliveryProof";
CREATE INDEX "DeliveryProof_driverId_uploadedAt_idx" ON "DeliveryProof"("driverId", "uploadedAt");
CREATE INDEX "DeliveryProof_status_uploadedAt_idx" ON "DeliveryProof"("status", "uploadedAt");
CREATE INDEX "DeliveryProof_invoiceNumber_idx" ON "DeliveryProof"("invoiceNumber");
CREATE INDEX "DeliveryProof_uploadedAt_idx" ON "DeliveryProof"("uploadedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
