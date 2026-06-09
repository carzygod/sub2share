CREATE UNIQUE INDEX "WalletTransaction_order_refund_unique"
  ON "WalletTransaction"("refType", "refId", "type")
  WHERE "refType" = 'order' AND "type" = 'refund';
