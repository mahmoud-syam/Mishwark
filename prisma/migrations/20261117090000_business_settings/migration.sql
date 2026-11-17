-- Business settings editable from the admin dashboard's Settings page.
-- These values used to be fixed in code (deposit 20%, VIP 15,000, referral 25,
-- category prices...) or in env (BOOKING_BUFFER_MINUTES, TRIP_EARLY_START_MINUTES).
-- Defaults match the old hard-coded values, so behaviour is unchanged until an
-- admin edits them.

ALTER TABLE "SystemSettings"
  ADD COLUMN "depositRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  ADD COLUMN "bookingBufferMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "tripEarlyStartMinutes" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "defaultCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  ADD COLUMN "referralRewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 25,
  ADD COLUMN "peakSurgeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.25,
  ADD COLUMN "vipSpendThreshold" DOUBLE PRECISION NOT NULL DEFAULT 15000,
  ADD COLUMN "delayAlertMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "punctualityGraceMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "complaintMaxRating" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "maintenanceAlertDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "categoryRates" JSONB;
