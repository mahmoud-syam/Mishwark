# Scope: Milestone M1 — Prisma Models & DB Layer

## Objectives
1. Implement all missing Prisma models, enums, and fields in `prisma/models/`:
   - Enums: `AvailabilityStatus`, `PackageType`, `PackageStatus`, `PaymentMethod`, `PaymentRecordStatus`, `ReviewerType`, `WaitlistStatus`, `ConversationStatus`, `SenderType`, `MessageType`, `NotificationRecipientType`, `NotificationType`, `NotificationChannel`, `NotificationStatus`, `ReferralStatus`, `WalletTransactionType`. Update `VehicleCategory` enum.
   - Models:
     - `Packages` (`prisma/models/packages.prisma`)
     - `Payments` (`prisma/models/payments.prisma`)
     - `Reviews` (`prisma/models/reviews.prisma`)
     - `Waitlist` (`prisma/models/waitlist.prisma`)
     - `Conversations` & `Messages` (`prisma/models/chat.prisma`)
     - `ScheduledNotifications` (`prisma/models/notifications.prisma`)
     - `Referrals` (`prisma/models/referrals.prisma`)
     - `WalletTransactions` (`prisma/models/wallet.prisma`)
   - Fix existing model inconsistencies:
     - Fix `Bookings.tripeStatus` typo to `tripStatus`.
     - Add missing FK fields and relations in `Bookings` (`packageId`, `routeWaypoints`, `payments`, `reviews`, `conversation`, `waitlists`, `scheduledNotifications`, `referrals`).
     - Fix `VehicleAvailability` model: add `bookingId` FK and relation to `Bookings`, add unique constraint `@@unique([vehicleId, date])`.
     - Fix `Users` model: make `email` optional (`String? @unique`), default `preferredLanguage` to `"ar"`, default `customerRating` to `5.0`.
     - Fix `Drivers` model: `licenseExpiry` type to `DateTime?`.
     - Fix `Vehicles` model: `year` to `Int @default(2024)`.
2. Generate Prisma Client and Zod schemas:
   - Run `npx prisma generate`
   - Run `npx tsc --noEmit` to verify type safety across the project.
3. Database Seeds & Migrations:
   - Ensure migration scripts / `npx prisma db push` / `npx prisma migrate dev` work cleanly.
   - Create TypeScript seed scripts in `prisma/seed/` (`seed.ts` and `api_seed_roles.ts`) populating default roles, admin user, test drivers, test vehicles, and system settings.

## Status
Milestone M1 Status: **DONE** (All models, enums, client/zod generators, TS compilation, seeds, and forensic audit passed).

