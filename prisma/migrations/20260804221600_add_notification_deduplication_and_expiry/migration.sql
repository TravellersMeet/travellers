-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "dedupeKey" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_expiresAt_idx"
ON "Notification"("expiresAt");
