-- CreateTable
CREATE TABLE "TicketAuditLog" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "previousStatus" "TicketStatus" NOT NULL,
    "newStatus" "TicketStatus" NOT NULL,
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketAuditLog_ticketId_createdAt_id_idx"
ON "TicketAuditLog"("ticketId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TicketAuditLog_adminId_createdAt_idx"
ON "TicketAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketAuditLog_requestId_idx"
ON "TicketAuditLog"("requestId");

-- AddForeignKey
ALTER TABLE "TicketAuditLog"
ADD CONSTRAINT "TicketAuditLog_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAuditLog"
ADD CONSTRAINT "TicketAuditLog_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce immutability at the database layer.
CREATE OR REPLACE FUNCTION prevent_ticket_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TicketAuditLog records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TicketAuditLog_prevent_update"
BEFORE UPDATE ON "TicketAuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_ticket_audit_log_mutation();

CREATE TRIGGER "TicketAuditLog_prevent_delete"
BEFORE DELETE ON "TicketAuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_ticket_audit_log_mutation();
