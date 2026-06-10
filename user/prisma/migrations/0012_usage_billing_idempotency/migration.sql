CREATE UNIQUE INDEX "WalletTransaction_usage_consume_unique"
  ON "WalletTransaction"("refType", "refId", "type")
  WHERE "refType" = 'usage' AND "type" = 'consume';

CREATE UNIQUE INDEX "SettlementRecord_usage_unique"
  ON "SettlementRecord"("usageRecordId")
  WHERE "usageRecordId" IS NOT NULL;
