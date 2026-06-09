-- CreateTable
CREATE TABLE "SystemHealthSnapshot" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "summary" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemHealthSnapshot_createdAt_idx" ON "SystemHealthSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "SystemHealthSnapshot_status_createdAt_idx" ON "SystemHealthSnapshot"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SystemHealthSnapshot_source_createdAt_idx" ON "SystemHealthSnapshot"("source", "createdAt");

-- CreateIndex
CREATE INDEX "SystemHealthSnapshot_actorUserId_createdAt_idx" ON "SystemHealthSnapshot"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "SystemHealthSnapshot" ADD CONSTRAINT "SystemHealthSnapshot_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
