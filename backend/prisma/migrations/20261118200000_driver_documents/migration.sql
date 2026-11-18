-- Driver documents (ID, licence, criminal record), stored privately and reviewed
-- from the dashboard. They used to be uploaded with signup and then dropped.

CREATE TYPE "DriverDocumentType" AS ENUM ('NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'LICENSE_FRONT', 'LICENSE_BACK', 'CRIMINAL_RECORD');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "DriverDocuments" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverDocuments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverDocuments_driverId_type_key" ON "DriverDocuments"("driverId", "type");
ALTER TABLE "DriverDocuments" ADD CONSTRAINT "DriverDocuments_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
