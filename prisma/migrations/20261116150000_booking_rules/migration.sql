-- Booking & payment rules agreed after the QA cycle (see api-docs/QA_REPORT.md).
--
-- 1. Split "deposit required" from "deposit paid". depositPaid used to be set
--    to 20% of the price at booking time even though nothing was paid; it now
--    holds the sum of SUCCESS payments, and depositRequired holds the 20%.
-- 2. Drivers.statusSetByAdmin: an OFF/ONLEAVE status set by an admin can't be
--    lifted from the driver app.
-- 3. OTP hardening for real SMS: codes expire, wrong guesses are capped and
--    resends are throttled (a 4-digit code with no limits is brute-forceable).

ALTER TABLE "Bookings" ADD COLUMN "depositRequired" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Bookings" SET "depositRequired" = "depositPaid";

UPDATE "Bookings" b
SET "depositPaid" = COALESCE((
  SELECT SUM(p."amount") FROM "Payments" p
  WHERE p."bookingId" = b."id" AND p."status" = 'SUCCESS'
), 0);

ALTER TABLE "Drivers" ADD COLUMN "statusSetByAdmin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Users"
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otpSentAt" TIMESTAMP(3);
