-- Admin web dashboard support.
--
-- * AuditLogs: append-only trail of sensitive admin actions (audit log screen).
-- * Drivers.commissionRate: company share per driver, editable from driver analytics.
-- * Bookings.tripStartedAt / tripCompletedAt: real trip timestamps for the
--   live-operations screen (elapsed / remaining / delayed).
--
-- All changes are additive; existing rows get NULL or the constant default.

CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

CREATE TABLE "AuditLogs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL DEFAULT '',
    "entityLabel" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLogs_createdAt_idx" ON "AuditLogs"("createdAt");
CREATE INDEX "AuditLogs_action_createdAt_idx" ON "AuditLogs"("action", "createdAt");

ALTER TABLE "AuditLogs" ADD CONSTRAINT "AuditLogs_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Drivers" ADD COLUMN "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 20;

ALTER TABLE "Bookings"
  ADD COLUMN "tripStartedAt" TIMESTAMP(3),
  ADD COLUMN "tripCompletedAt" TIMESTAMP(3);
