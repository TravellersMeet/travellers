-- CreateTable
CREATE TABLE "AssetCleanupJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCleanupJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetCleanupJob_ownerId_publicId_key"
ON "AssetCleanupJob"("ownerId", "publicId");

-- CreateIndex
CREATE INDEX "AssetCleanupJob_ownerId_completedAt_idx"
ON "AssetCleanupJob"("ownerId", "completedAt");

-- CreateIndex
CREATE INDEX "AssetCleanupJob_completedAt_nextAttemptAt_idx"
ON "AssetCleanupJob"("completedAt", "nextAttemptAt");
