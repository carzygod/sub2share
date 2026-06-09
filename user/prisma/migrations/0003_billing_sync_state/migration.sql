CREATE TABLE "BillingSyncState" (
  "id" TEXT NOT NULL,
  "cursor" TEXT,
  "lastStatus" TEXT,
  "lastError" TEXT,
  "lastImported" INTEGER NOT NULL DEFAULT 0,
  "lastSkipped" INTEGER NOT NULL DEFAULT 0,
  "lastUnmatched" INTEGER NOT NULL DEFAULT 0,
  "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillingSyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingSyncRun" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "cursorIn" TEXT,
  "cursorOut" TEXT,
  "status" TEXT NOT NULL,
  "imported" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "unmatched" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingSyncRun_source_startedAt_idx" ON "BillingSyncRun"("source", "startedAt");
CREATE INDEX "BillingSyncRun_status_startedAt_idx" ON "BillingSyncRun"("status", "startedAt");
