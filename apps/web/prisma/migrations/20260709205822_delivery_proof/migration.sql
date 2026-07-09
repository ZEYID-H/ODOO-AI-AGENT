-- CreateTable
CREATE TABLE "DeliveryProof" (
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
    "driverId" TEXT NOT NULL,
    "verifiedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryProof_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeliveryProof_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeliveryProof_driverId_uploadedAt_idx" ON "DeliveryProof"("driverId", "uploadedAt");

-- CreateIndex
CREATE INDEX "DeliveryProof_status_uploadedAt_idx" ON "DeliveryProof"("status", "uploadedAt");

-- CreateIndex
CREATE INDEX "DeliveryProof_invoiceNumber_idx" ON "DeliveryProof"("invoiceNumber");

-- CreateIndex
CREATE INDEX "DeliveryProof_uploadedAt_idx" ON "DeliveryProof"("uploadedAt");
