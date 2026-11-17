-- Booking rules, deposit-on-cancellation policy and temporary password expiry.

ALTER TABLE "SystemSettings"
  ADD COLUMN "maxAdvanceBookingDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "minTripMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "overnightLatestEndHour" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "freeCancellationHours" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN "tempPasswordDays" INTEGER NOT NULL DEFAULT 7;

CREATE TYPE "DepositOutcome" AS ENUM ('REFUNDED', 'KEPT');

ALTER TABLE "Bookings"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "depositOutcome" "DepositOutcome",
  ADD COLUMN "depositRefunded" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "Users" ADD COLUMN "tempPasswordExpiresAt" TIMESTAMP(3);

-- Temporary passwords handed out before this change get a week from now.
UPDATE "Users" SET "tempPasswordExpiresAt" = NOW() + INTERVAL '7 days' WHERE "mustChangePassword" = true;

-- A cancelled booking kept its slot: the same car couldn't be booked again on
-- that day at the same start time. Only active bookings are unique now.
DROP INDEX IF EXISTS "Bookings_vehicleId_bookingDate_startTime_key";
CREATE UNIQUE INDEX "Bookings_active_slot_key" ON "Bookings"("vehicleId", "bookingDate", "startTime") WHERE "status" <> 'CANCELLED';
CREATE INDEX "Bookings_vehicleId_bookingDate_idx" ON "Bookings"("vehicleId", "bookingDate");
