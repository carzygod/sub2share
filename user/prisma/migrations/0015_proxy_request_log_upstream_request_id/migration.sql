ALTER TABLE "ProxyRequestLog"
  ADD COLUMN "upstreamRequestId" TEXT;

CREATE INDEX "ProxyRequestLog_upstreamRequestId_createdAt_idx"
  ON "ProxyRequestLog"("upstreamRequestId", "createdAt");
