-- Server-computed route metrics for bookings.
--
-- distanceKm already existed but was whatever the client claimed, and
-- durationMinutes had no column at all: it was accepted, priced with, and then
-- discarded. Both are now resolved by the server so booking confirmation can be
-- enabled against a trusted figure.
--
-- Every column is additive with a constant default, so this is non-blocking on
-- PostgreSQL 11+ (no table rewrite).

ALTER TABLE "Bookings"
  ADD COLUMN "durationMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "startLat" DOUBLE PRECISION,
  ADD COLUMN "startLng" DOUBLE PRECISION,
  ADD COLUMN "endLat" DOUBLE PRECISION,
  ADD COLUMN "endLng" DOUBLE PRECISION,
  ADD COLUMN "distanceSource" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "claimedDistanceKm" DOUBLE PRECISION,
  ADD COLUMN "claimedDurationMinutes" DOUBLE PRECISION;

COMMENT ON COLUMN "Bookings"."durationMinutes" IS 'Server-computed travel time in minutes. Feeds the time component of the price.';
COMMENT ON COLUMN "Bookings"."startLat" IS 'Resolved start latitude. Null when the endpoint could not be geocoded.';
COMMENT ON COLUMN "Bookings"."endLng" IS 'Resolved end longitude. Null when the endpoint could not be geocoded.';
COMMENT ON COLUMN "Bookings"."distanceSource" IS 'How distanceKm was obtained: openrouteservice | haversine | client.';
COMMENT ON COLUMN "Bookings"."claimedDistanceKm" IS 'What the client declared, retained only to audit mismatches. Never used for pricing.';
COMMENT ON COLUMN "Bookings"."claimedDurationMinutes" IS 'What the client declared, retained only to audit mismatches. Never used for pricing.';

-- Reporting needs "which route source produced these bookings" far more often
-- than "every single booking", so this is a partial index.
CREATE INDEX "Bookings_distanceSource_idx" ON "Bookings" ("distanceSource")
  WHERE "distanceSource" <> '';
