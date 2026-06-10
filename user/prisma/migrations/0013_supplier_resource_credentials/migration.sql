CREATE TABLE "SupplierResourceCredential" (
  "id" TEXT NOT NULL,
  "supplierResourceId" TEXT NOT NULL,
  "credentialType" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "encryptionVersion" TEXT NOT NULL DEFAULT 'aes-256-gcm:v1',
  "keyFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierResourceCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierResourceCredential_supplierResourceId_key"
  ON "SupplierResourceCredential"("supplierResourceId");

ALTER TABLE "SupplierResourceCredential"
  ADD CONSTRAINT "SupplierResourceCredential_supplierResourceId_fkey"
  FOREIGN KEY ("supplierResourceId") REFERENCES "SupplierResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
