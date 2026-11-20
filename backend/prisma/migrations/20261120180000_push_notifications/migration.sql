-- Push notifications: devices, read state separate from delivery, more types.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_TRIP';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_STARTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DRIVER_ARRIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_REVIEWED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WAITLIST_AVAILABLE';

CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- "Read" used to be stored as status SENT; it is now its own column.
ALTER TABLE "ScheduledNotifications" ADD COLUMN "readAt" TIMESTAMP(3);
UPDATE "ScheduledNotifications" SET "readAt" = COALESCE("sentAt", "updatedAt") WHERE "status" = 'SENT';
-- Old notifications never pushed and already due: delivered to the inbox as they are.
UPDATE "ScheduledNotifications" SET "status" = 'SENT', "sentAt" = COALESCE("sentAt", "scheduledAt") WHERE "status" = 'SCHEDULED' AND "scheduledAt" <= NOW();

CREATE INDEX "ScheduledNotifications_recipientId_scheduledAt_idx" ON "ScheduledNotifications"("recipientId", "scheduledAt");
CREATE INDEX "ScheduledNotifications_status_scheduledAt_idx" ON "ScheduledNotifications"("status", "scheduledAt");

CREATE TABLE "DeviceTokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceTokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceTokens_token_key" ON "DeviceTokens"("token");
CREATE INDEX "DeviceTokens_userId_idx" ON "DeviceTokens"("userId");
ALTER TABLE "DeviceTokens" ADD CONSTRAINT "DeviceTokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
