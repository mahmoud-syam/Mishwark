-- Package and referral discounts are now applied to the booking itself.
--
-- Before: the estimate showed a package / referral discount but POST /bookings
-- ignored it, so the customer was charged the full price. A customer could also
-- choose their own package discount (up to 100%), and any referral code took
-- 25 EGP off any estimate.
--
-- Now: an admin sets each package's discount %, the referred customer gets a
-- fixed discount (Settings) on their first booking, and both amounts are stored
-- on the booking.

ALTER TABLE "Bookings"
  ADD COLUMN "packageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "referralDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "SystemSettings"
  ADD COLUMN "referredDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 25;

-- Packages created by customers carried a discount they picked themselves and
-- that was never charged. Reset them so an admin sets the real one.
UPDATE "Packages" SET "discountPercentage" = 0;
