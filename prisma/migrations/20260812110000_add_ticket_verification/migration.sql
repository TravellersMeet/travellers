CREATE TYPE "TicketVerificationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PASSED',
  'SUSPICIOUS',
  'FAILED'
);

ALTER TABLE "Ticket"
ADD COLUMN "verificationStatus" "TicketVerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "verificationScore" DOUBLE PRECISION,
ADD COLUMN "verificationReason" TEXT,
ADD COLUMN "aiDetectionScore" DOUBLE PRECISION,
ADD COLUMN "ocrExtractedText" TEXT,
ADD COLUMN "metadataHash" TEXT,
ADD COLUMN "verificationCheckedAt" TIMESTAMP(3);

CREATE INDEX "Ticket_verificationStatus_idx"
ON "Ticket"("verificationStatus");

CREATE INDEX "Ticket_metadataHash_idx"
ON "Ticket"("metadataHash");
