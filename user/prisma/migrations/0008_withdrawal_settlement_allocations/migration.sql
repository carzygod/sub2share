ALTER TABLE "SettlementRecord"
  ADD COLUMN "reservedAmount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "withdrawnAmount" DECIMAL(18, 6) NOT NULL DEFAULT 0;

CREATE TABLE "WithdrawalSettlement" (
  "id" TEXT NOT NULL,
  "withdrawalId" TEXT NOT NULL,
  "settlementRecordId" TEXT NOT NULL,
  "amount" DECIMAL(18, 6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WithdrawalSettlement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WithdrawalSettlement"
  ADD CONSTRAINT "WithdrawalSettlement_withdrawalId_fkey"
  FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WithdrawalSettlement"
  ADD CONSTRAINT "WithdrawalSettlement_settlementRecordId_fkey"
  FOREIGN KEY ("settlementRecordId") REFERENCES "SettlementRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WithdrawalSettlement_withdrawalId_idx" ON "WithdrawalSettlement"("withdrawalId");
CREATE INDEX "WithdrawalSettlement_settlementRecordId_idx" ON "WithdrawalSettlement"("settlementRecordId");
CREATE INDEX "WithdrawalSettlement_status_idx" ON "WithdrawalSettlement"("status");
