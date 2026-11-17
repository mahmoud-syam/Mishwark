-- Fleet management from the dashboard: add / edit / retire cars, photos and
-- app details, admin-assigned drivers, and a maintenance schedule that blocks
-- the car on its days.

ALTER TABLE "Vehicles"
  ADD COLUMN "luggage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "retiredReason" TEXT;

ALTER TABLE "VehicleImages"
  ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "VehicleMaintenance"
  ADD COLUMN "endDate" TIMESTAMP(3);

-- Existing records were single-day.
UPDATE "VehicleMaintenance" SET "endDate" = "scheduledDate" WHERE "endDate" IS NULL;

-- Car status is now derived from the maintenance schedule. A car that was set
-- to MAINTENANCE by hand gets an open one-day maintenance record for today, so
-- it shows as in maintenance until an admin marks it done.
INSERT INTO "VehicleMaintenance" ("id", "vehicleId", "maintenanceType", "cost", "scheduledDate", "endDate", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v."id", 'صيانة', 0, date_trunc('day', now()), date_trunc('day', now()),
       'Converted from the manual MAINTENANCE status', now(), now()
FROM "Vehicles" v
WHERE v."status" = 'MAINTENANCE'
  AND NOT EXISTS (
    SELECT 1 FROM "VehicleMaintenance" m
    WHERE m."vehicleId" = v."id" AND m."completedDate" IS NULL
      AND date_trunc('day', now()) BETWEEN m."scheduledDate" AND COALESCE(m."endDate", m."scheduledDate")
  );
UPDATE "Vehicles" SET "status" = 'AVAILABLE' WHERE "status" = 'MAINTENANCE';

-- Block today for the converted records, so the app's availability calendar
-- shows the car as unavailable (a day that already has a booking keeps it).
INSERT INTO "VehicleAvailability" ("id", "vehicleId", "date", "status", "reason", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."vehicleId", m."scheduledDate", 'BLOCKED', 'صيانة (' || m."maintenanceType" || ') #' || m."id", now(), now()
FROM "VehicleMaintenance" m
WHERE m."notes" = 'Converted from the manual MAINTENANCE status'
ON CONFLICT ("vehicleId", "date") DO NOTHING;

CREATE INDEX "VehicleMaintenance_vehicleId_scheduledDate_idx" ON "VehicleMaintenance"("vehicleId", "scheduledDate");
