ALTER TABLE "ProxyRequestLog"
  ADD COLUMN "model" TEXT;

CREATE INDEX "ProxyRequestLog_model_createdAt_idx"
  ON "ProxyRequestLog"("model", "createdAt");
