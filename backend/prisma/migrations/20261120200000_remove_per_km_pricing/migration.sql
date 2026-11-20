-- The per-km pricing (a price to open the trip, per km and per hour, per car or
-- per car type, with a peak-hour multiplier) is gone: every booking is priced by
-- its service (wedding, private trip, VIP) from the Pricing page.
ALTER TABLE "Vehicles" DROP COLUMN IF EXISTS "basePrice";
ALTER TABLE "Vehicles" DROP COLUMN IF EXISTS "pricePerKm";
ALTER TABLE "Vehicles" DROP COLUMN IF EXISTS "pricePerHour";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "categoryRates";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "peakSurgeMultiplier";
