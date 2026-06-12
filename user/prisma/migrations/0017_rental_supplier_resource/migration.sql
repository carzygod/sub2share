ALTER TABLE "Rental"
  ADD COLUMN "supplierResourceId" TEXT;

UPDATE "Rental" AS rental
SET "supplierResourceId" = history."supplierResourceId"
FROM (
  SELECT DISTINCT ON ("orderId")
    "orderId",
    "meta"->>'supplierResourceId' AS "supplierResourceId"
  FROM "OrderStatusHistory"
  WHERE "meta" IS NOT NULL
    AND "meta"->>'supplierResourceId' IS NOT NULL
  ORDER BY "orderId", "createdAt" DESC
) AS history
WHERE rental."orderId" = history."orderId"
  AND rental."supplierResourceId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "SupplierResource" AS resource
    WHERE resource."id" = history."supplierResourceId"
  );

CREATE INDEX "Rental_supplierResourceId_createdAt_idx"
  ON "Rental"("supplierResourceId", "createdAt");

ALTER TABLE "Rental"
  ADD CONSTRAINT "Rental_supplierResourceId_fkey"
  FOREIGN KEY ("supplierResourceId")
  REFERENCES "SupplierResource"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
