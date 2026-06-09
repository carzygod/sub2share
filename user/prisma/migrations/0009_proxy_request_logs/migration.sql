CREATE TABLE "ProxyRequestLog" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT,
  "rentalId" TEXT,
  "apiKeyId" TEXT,
  "apiKeyPrefix" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "statusCode" INTEGER,
  "upstreamStatusCode" INTEGER,
  "errorCode" TEXT,
  "durationMs" INTEGER NOT NULL,
  "requestBytes" INTEGER NOT NULL DEFAULT 0,
  "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProxyRequestLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProxyRequestLog"
  ADD CONSTRAINT "ProxyRequestLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProxyRequestLog"
  ADD CONSTRAINT "ProxyRequestLog_rentalId_fkey"
  FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProxyRequestLog"
  ADD CONSTRAINT "ProxyRequestLog_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProxyRequestLog_requestId_key" ON "ProxyRequestLog"("requestId");
CREATE INDEX "ProxyRequestLog_createdAt_idx" ON "ProxyRequestLog"("createdAt");
CREATE INDEX "ProxyRequestLog_userId_createdAt_idx" ON "ProxyRequestLog"("userId", "createdAt");
CREATE INDEX "ProxyRequestLog_rentalId_createdAt_idx" ON "ProxyRequestLog"("rentalId", "createdAt");
CREATE INDEX "ProxyRequestLog_apiKeyId_createdAt_idx" ON "ProxyRequestLog"("apiKeyId", "createdAt");
CREATE INDEX "ProxyRequestLog_statusCode_createdAt_idx" ON "ProxyRequestLog"("statusCode", "createdAt");
CREATE INDEX "ProxyRequestLog_errorCode_createdAt_idx" ON "ProxyRequestLog"("errorCode", "createdAt");
