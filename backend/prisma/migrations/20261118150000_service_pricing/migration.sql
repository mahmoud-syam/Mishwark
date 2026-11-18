-- Pricing by service type: wedding (fixed per car), private trip (fixed per
-- destination and car category, km beyond the included ones extra) and VIP.

CREATE TYPE "ServiceType" AS ENUM ('WEDDING', 'TRIP', 'VIP');

CREATE TABLE "Destinations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "includedKm" INTEGER,
    "prices" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Destinations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Bookings"
  ADD COLUMN "serviceType" "ServiceType",
  ADD COLUMN "destinationId" TEXT,
  ADD COLUMN "priceLines" JSONB;
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_destinationId_fkey"
  FOREIGN KEY ("destinationId") REFERENCES "Destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Vehicles"
  ADD COLUMN "weddingPrice" DOUBLE PRECISION,
  ADD COLUMN "vipPrice" DOUBLE PRECISION;

ALTER TABLE "SystemSettings"
  ADD COLUMN "weddingDefaultPrice" DOUBLE PRECISION NOT NULL DEFAULT 1500,
  ADD COLUMN "weddingIncludedHours" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "weddingIncludedKm" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "weddingExtraHourPrice" DOUBLE PRECISION NOT NULL DEFAULT 300,
  ADD COLUMN "weddingExtraKmPrice" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "vipDefaultPrice" DOUBLE PRECISION NOT NULL DEFAULT 3000,
  ADD COLUMN "vipIncludedHours" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "vipIncludedKm" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "vipExtraHourPrice" DOUBLE PRECISION NOT NULL DEFAULT 500,
  ADD COLUMN "vipExtraKmPrice" DOUBLE PRECISION NOT NULL DEFAULT 75,
  ADD COLUMN "tripIncludedKm" INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN "tripExtraKmPrice" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "tripOtherPrices" JSONB,
  ADD COLUMN "originLabel" TEXT NOT NULL DEFAULT 'الزقازيق، الشرقية',
  ADD COLUMN "originLat" DOUBLE PRECISION NOT NULL DEFAULT 30.5877,
  ADD COLUMN "originLng" DOUBLE PRECISION NOT NULL DEFAULT 31.502;
