# Explorer 1 Handoff Report: Data Model & Requirements Analysis

## 1. Observation

Direct observations from codebase inspection, `ORIGINAL_REQUEST.md`, and `Mishwark-Data-Model.docx`:

### Codebase Structure & Existing Configurations
- **Prisma Configuration**: `prisma.config.ts` defines `schema: "prisma"` and migrations path `prisma/migrations`.
- **Prisma Client Output**: `prisma/schema.prisma` generates client to `../generated/prisma`. `src/v1/utils/prismaClientHelper.ts` initializes `PrismaClient` using `@prisma/adapter-pg`.
- **Zod Generator**: `prisma/zod.prisma` generates Zod types to `../src/v1/schemas/zod` using `zod-prisma-types`.
- **Existing Prisma Models**: Located in `prisma/models/`:
  - `enums.prisma`: Contains `DriverStatus`, `VehicleCategory`, `VehicleStatus`, `BookingStatus`, `TripStatus`, `PaymentStatus`.
  - `roles.prisma`: Contains `Role`, `Permission`.
  - `settings.prisma`: Contains `SystemSettings`.
  - `users.prisma`: Contains `Users`, `PhoneNumbers`, `Drivers`.
  - `vehicles.prisma`: Contains `Vehicles`, `VehicleImages`, `VehicleDrivers`, `VehicleAvailability`, `Bookings`.
- **Migrations & Seeds**:
  - `prisma/migrations`: Directory does not exist (no existing database migrations created).
  - `prisma/seed`: Directory exists but is empty. `package.json` specifies `"seed": "npx ts-node prisma/seed/seed.ts"` and `"seed:api": "npx tsx prisma/seed/api_seed_roles.ts"`.
- **Existing Code Verification**:
  - Command `npx prisma generate` executed successfully, generating client (v7.8.0) and Zod types.

### Requirement Source Comparison
From `ORIGINAL_REQUEST.md` (R1-R4) and `Mishwark-Data-Model.docx` (Section 1.1 - 1.15):
- **Requirement R1**: "Add all missing models from the docx (Waitlist, Conversations, Messages, ScheduledNotifications, Referrals, WalletTransactions, Payments, Reviews, Packages) to the `prisma/models` directory, update enums, and successfully generate the Prisma client."
- **Document Entities (1.1 - 1.15)**: `users`, `drivers`, `vehicles`, `vehicle_drivers`, `vehicle_availability`, `bookings`, `packages`, `payments`, `reviews`, `waitlist`, `conversations`, `messages`, `scheduled_notifications`, `referrals`, `wallet_transactions`, `trip_locations`, `vehicle_maintenance`.

---

## 2. Logic Chain

1. **Comparison of Entities**:
   - Existing codebase contains models for `Users`, `PhoneNumbers`, `Drivers`, `Role`, `Permission`, `SystemSettings`, `Vehicles`, `VehicleImages`, `VehicleDrivers`, `VehicleAvailability`, and `Bookings`.
   - Missing 9 primary business models explicitly required by R1 and docx: `Packages`, `Payments`, `Reviews`, `Waitlist`, `Conversations`, `Messages`, `ScheduledNotifications`, `Referrals`, and `WalletTransactions`.
   - Missing 2 auxiliary/future models mentioned in docx (1.14 & 1.15): `TripLocations` (live tracking) and `VehicleMaintenance` (fleet management).

2. **Inconsistencies & Gaps Identified**:
   - **`Bookings` Model Field Typo**: Existing schema has `tripeStatus TripStatus` (typo: extra 'e'). Docx specifies `trip_status` / `tripStatus`.
   - **`Bookings` Missing Relations & Fields**:
     - Missing `packageId` (FK to `Packages`, nullable).
     - Missing `routeWaypoints` (JSON field for intermediate route stops).
     - Missing inverse relation fields: `payments Payments[]`, `reviews Reviews[]`, `conversation Conversations?`, `waitlist Waitlist[]`, `scheduledNotifications ScheduledNotifications[]`, `referrals Referrals[]`.
   - **`VehicleAvailability` Inconsistencies**:
     - Docx specifies availability statuses: `available`, `booked`, `blocked`. Existing enum `VehicleStatus` in `enums.prisma` has `AVAILABLE`, `BOOKED`, `MAINTENANCE`.
     - Docx specifies `booking_id` (UUID FK, nullable, set when status = booked). Existing model lacks `bookingId` and `booking Bookings?` relation.
     - Missing unique constraint `@@unique([vehicleId, date])`.
   - **`Users` Model Gaps**:
     - In `users.prisma`, `email` is `String @unique` (required). Docx notes `email` is optional, with `phone_number` as primary login identifier. `email` should be `String? @unique`.
     - Docx specifies `preferred_language` default `ar`. Existing schema defaults to `en`.
     - Docx specifies `customer_rating` default `5.0`. Existing schema has `rating_avg Float? @default(0)`.
     - Missing relations to `walletTransactions WalletTransactions[]`, `packages Packages[]`, `waitlist Waitlist[]`, `reviews Reviews[]`, `scheduledNotifications ScheduledNotifications[]`, `sentMessages Messages[]`, `conversationsAsCustomer Conversations[]`, `conversationsAsDriver Conversations[]`.
   - **`Drivers` Model Gaps**:
     - `licenseExpiry`: Currently `String @default("")`. Docx specifies `DATE` (`DateTime`).
     - `rating_avg`: Currently `Float? @default(5.0)`. Docx specifies default 5.0.
   - **`Vehicles` Model Gaps**:
     - `category`: Existing enum `VehicleCategory` has `CAR`, `VAN`, `BUS`, `TRUCK`. Docx specifies `CLASSIC`, `LUXURY`, `VAN`. Enum needs expansion: `CLASSIC`, `LUXURY`, `VAN`, `CAR`, `BUS`, `TRUCK`.
     - `year`: Existing schema uses `String @default("")`. Docx specifies `INT` (`Int @default(2024)`).
   - **Enums Expansion**:
     - Needs 17 enums covering status and types for packages, payments, reviews, waitlist, chat, notifications, referrals, and wallet transactions.

3. **Database Migration & Seeding Needs**:
   - `prisma/migrations` is absent. Schema update must be followed by `npx prisma migrate dev --name init_full_mishwarak_schema` or `npx prisma db push` to generate initial migration.
   - `prisma/seed` is empty. A comprehensive TypeScript seed script (`prisma/seed/seed.ts` & `api_seed_roles.ts`) is required to populate initial Roles, Admin user, Customer, Driver, Vehicles, Vehicle Availability, and System Settings.

---

## 3. Caveats

- `TripLocations` (1.14) is designated in docx as "live tracking — future phase". It should be defined in Prisma schema for schema completeness, but may be optional for initial controller wiring.
- `VehicleMaintenance` (1.15) is listed in section 1.15 of docx; adding it ensures complete alignment with section 1 of docx.
- Decimal fields in docx (e.g., `DECIMAL(10,2)`) map cleanly to Prisma `Float` or `Decimal`. Standardizing on `Float` or `Decimal` consistent with existing codebase (`Float`) ensures compatibility with existing controllers.

---

## 4. Conclusion & Data Model Specification

### Complete Data Model Specification

#### Missing Enums (`prisma/models/enums.prisma`)
```prisma
enum DriverStatus {
  ACTIVE
  OFF
  ONTRIP
  ONLEAVE
}

enum VehicleCategory {
  CLASSIC
  LUXURY
  VAN
  CAR
  BUS
  TRUCK
}

enum VehicleStatus {
  AVAILABLE
  BOOKED
  MAINTENANCE
}

enum AvailabilityStatus {
  AVAILABLE
  BOOKED
  BLOCKED
}

enum BookingStatus {
  PENDING
  CONFIRMED
  COMPLETED
  CANCELLED
}

enum TripStatus {
  NOTSTARTED
  EN_ROUTE
  ARRIVED
  COMPLETED
}

enum PaymentStatus {
  UNPAID
  PARTIAL
  PAID
}

enum PackageType {
  MULTI_CAR
  MULTI_EVENT
}

enum PackageStatus {
  ACTIVE
  COMPLETED
  CANCELLED
}

enum PaymentMethod {
  PAYMOB
  FAWRY
  CASH
}

enum PaymentRecordStatus {
  PENDING
  SUCCESS
  FAILED
  REFUNDED
}

enum ReviewerType {
  CUSTOMER_TO_DRIVER
  DRIVER_TO_CUSTOMER
}

enum WaitlistStatus {
  WAITING
  NOTIFIED
  CONVERTED
  EXPIRED
}

enum ConversationStatus {
  OPEN
  CLOSED
}

enum SenderType {
  CUSTOMER
  DRIVER
  SYSTEM
}

enum MessageType {
  TEXT
  QUICK_REPLY
}

enum NotificationRecipientType {
  CUSTOMER
  DRIVER
}

enum NotificationType {
  REMINDER_24H
  REMINDER_2H
  REMINDER_30M
  RATE_TRIP
}

enum NotificationChannel {
  PUSH
  SMS
  WHATSAPP
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}

enum ReferralStatus {
  PENDING
  COMPLETED
  EXPIRED
}

enum WalletTransactionType {
  REFERRAL_REWARD
  REFUND
  MANUAL_ADJUSTMENT
}
```

#### Detailed Model Specifications & File Target Mapping

1. **`Users` (`prisma/models/users.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `code`: `String @default("")`
   - `name`: `String`
   - `email`: `String? @unique` (Optional as per docx)
   - `pic`: `String @default("")`
   - `password`: `String @default("")`
   - `preferredLanguage`: `String @default("ar")`
   - `isDeleted`: `Boolean @default(false)`
   - `twoFactorEnabled`: `Boolean @default(false)`
   - `twoFactorSecret`: `String? @default("")`
   - `tokenVersion`: `Int @default(0)`
   - `phoneNumber`: `String? @unique`
   - `otpVerified`: `Boolean @default(false)`
   - `otpCode`: `String?`
   - `referralCode`: `String? @unique`
   - `referredById`: `String?`
   - `referredBy`: `Users? @relation("Referrals", fields: [referredById], references: [id])`
   - `referrals`: `Users[] @relation("Referrals")`
   - `phoneNumbers`: `PhoneNumbers[]`
   - `customerRating`: `Float? @default(5.0)`
   - `role`: `Role? @relation("UserRoles", fields: [roleId], references: [id])`
   - `roleId`: `String?`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `drivers`: `Drivers?`
   - `bookings`: `Bookings[]`
   - `packages`: `Packages[]`
   - `waitlists`: `Waitlist[]`
   - `walletTransactions`: `WalletTransactions[]`
   - `sentMessages`: `Messages[]`
   - `conversationsAsCustomer`: `Conversations[] @relation("CustomerConversations")`
   - `conversationsAsDriver`: `Conversations[] @relation("DriverConversations")`
   - `scheduledNotifications`: `ScheduledNotifications[]`
   - `referralsSent`: `Referrals[] @relation("Referrer")`
   - `referralsReceived`: `Referrals[] @relation("Referred")`

2. **`Drivers` (`prisma/models/users.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `user`: `Users @relation(fields: [userId], references: [id])`
   - `userId`: `String @unique`
   - `fullName`: `String @default("")`
   - `phoneNumbers`: `PhoneNumbers[]`
   - `licenseNumber`: `String @default("")`
   - `licenseExpiry`: `DateTime?`
   - `photoUrl`: `String @default("")`
   - `rating`: `Float? @default(5.0)`
   - `status`: `DriverStatus @default(ACTIVE)`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `vehicleDrivers`: `VehicleDrivers[]`
   - `bookings`: `Bookings[]`
   - `conversations`: `Conversations[]`

3. **`Vehicles` (`prisma/models/vehicles.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `make`: `String @default("")`
   - `model`: `String @default("")`
   - `year`: `Int @default(2024)`
   - `plateNumber`: `String @unique @default("")`
   - `color`: `String @default("")`
   - `capacity`: `Int @default(0)`
   - `category`: `VehicleCategory @default(CAR)`
   - `status`: `VehicleStatus @default(AVAILABLE)`
   - `basePrice`: `Float @default(0)`
   - `pricePerKm`: `Float @default(0)`
   - `pricePerHour`: `Float @default(0)`
   - `images`: `VehicleImages[]`
   - `description`: `String @default("")`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `vehicleDrivers`: `VehicleDrivers[]`
   - `vehicleAvailabilities`: `VehicleAvailability[]`
   - `bookings`: `Bookings[]`
   - `waitlists`: `Waitlist[]`

4. **`VehicleAvailability` (`prisma/models/vehicles.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `vehicle`: `Vehicles @relation(fields: [vehicleId], references: [id])`
   - `vehicleId`: `String`
   - `date`: `DateTime`
   - `status`: `AvailabilityStatus @default(AVAILABLE)`
   - `bookingId`: `String?`
   - `booking`: `Bookings? @relation(fields: [bookingId], references: [id])`
   - `reason`: `String @default("")`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `@@unique([vehicleId, date])`

5. **`Bookings` (`prisma/models/bookings.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `customer`: `Users @relation(fields: [customerId], references: [id])`
   - `customerId`: `String`
   - `vehicle`: `Vehicles @relation(fields: [vehicleId], references: [id])`
   - `vehicleId`: `String`
   - `driver`: `Drivers @relation(fields: [driverId], references: [id])`
   - `driverId`: `String`
   - `packageId`: `String?`
   - `package`: `Packages? @relation(fields: [packageId], references: [id])`
   - `eventType`: `String @default("")`
   - `startPoint`: `String @default("")`
   - `endPoint`: `String @default("")`
   - `routeWaypoints`: `Json?`
   - `distanceKm`: `Float @default(0)`
   - `bookingDate`: `String @default("")`
   - `startTime`: `String @default("")`
   - `endTime`: `String @default("")`
   - `status`: `BookingStatus @default(PENDING)`
   - `tripStatus`: `TripStatus @default(NOTSTARTED)` (fixed typo)
   - `basePrice`: `Float @default(0)`
   - `distancePrice`: `Float @default(0)`
   - `totalPrice`: `Float @default(0)`
   - `depositPaid`: `Float @default(0)`
   - `paymentStatus`: `PaymentStatus @default(UNPAID)`
   - `driverNotes`: `String @default("")`
   - `notes`: `String @default("")`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `payments`: `Payments[]`
   - `reviews`: `Reviews[]`
   - `conversation`: `Conversations?`
   - `vehicleAvailabilities`: `VehicleAvailability[]`
   - `scheduledNotifications`: `ScheduledNotifications[]`
   - `referrals`: `Referrals[]`
   - `@@unique([vehicleId, bookingDate, startTime])`

6. **`Packages` (`prisma/models/packages.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `customer`: `Users @relation(fields: [customerId], references: [id])`
   - `customerId`: `String`
   - `packageName`: `String`
   - `packageType`: `PackageType`
   - `totalPrice`: `Float @default(0)`
   - `discountPercentage`: `Float @default(0)`
   - `status`: `PackageStatus @default(ACTIVE)`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`
   - `bookings`: `Bookings[]`

7. **`Payments` (`prisma/models/payments.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `booking`: `Bookings @relation(fields: [bookingId], references: [id])`
   - `bookingId`: `String`
   - `amount`: `Float`
   - `paymentMethod`: `PaymentMethod`
   - `transactionRef`: `String @default("")`
   - `status`: `PaymentRecordStatus @default(PENDING)`
   - `paidAt`: `DateTime?`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`

8. **`Reviews` (`prisma/models/reviews.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `booking`: `Bookings @relation(fields: [bookingId], references: [id])`
   - `bookingId`: `String`
   - `reviewerType`: `ReviewerType`
   - `revieweeId`: `String`
   - `overallRating`: `Int`
   - `vehicleRating`: `Int?`
   - `punctualityRating`: `Int`
   - `comment`: `String @default("")`
   - `visibleAt`: `DateTime?`
   - `createdAt`: `DateTime @default(now())`

9. **`Waitlist` (`prisma/models/waitlist.prisma`)**:
   - `id`: `String @id @default(uuid())`
   - `customer`: `Users @relation(fields: [customerId], references: [id])`
   - `customerId`: `String`
   - `vehicle`: `Vehicles @relation(fields: [vehicleId], references: [id])`
   - `vehicleId`: `String`
   - `requestedDate`: `DateTime`
   - `requestedTime`: `String`
   - `position`: `Int`
   - `status`: `WaitlistStatus @default(WAITING)`
   - `notifiedAt`: `DateTime?`
   - `expiresAt`: `DateTime?`
   - `createdAt`: `DateTime @default(now())`
   - `updatedAt`: `DateTime @default(now()) @updatedAt`

10. **`Conversations` & `Messages` (`prisma/models/chat.prisma`)**:
    - `Conversations`:
      - `id`: `String @id @default(uuid())`
      - `booking`: `Bookings @relation(fields: [bookingId], references: [id])`
      - `bookingId`: `String @unique`
      - `customer`: `Users @relation("CustomerConversations", fields: [customerId], references: [id])`
      - `customerId`: `String`
      - `driver`: `Drivers @relation(fields: [driverId], references: [id])`
      - `driverId`: `String`
      - `status`: `ConversationStatus @default(OPEN)`
      - `createdAt`: `DateTime @default(now())`
      - `updatedAt`: `DateTime @default(now()) @updatedAt`
      - `messages`: `Messages[]`
    - `Messages`:
      - `id`: `String @id @default(uuid())`
      - `conversation`: `Conversations @relation(fields: [conversationId], references: [id])`
      - `conversationId`: `String`
      - `senderType`: `SenderType`
      - `sender`: `Users @relation(fields: [senderId], references: [id])`
      - `senderId`: `String`
      - `content`: `String`
      - `messageType`: `MessageType @default(TEXT)`
      - `isRead`: `Boolean @default(false)`
      - `createdAt`: `DateTime @default(now())`

11. **`ScheduledNotifications` (`prisma/models/notifications.prisma`)**:
    - `id`: `String @id @default(uuid())`
    - `booking`: `Bookings @relation(fields: [bookingId], references: [id])`
    - `bookingId`: `String`
    - `recipientType`: `NotificationRecipientType`
    - `recipient`: `Users @relation(fields: [recipientId], references: [id])`
    - `recipientId`: `String`
    - `notificationType`: `NotificationType`
    - `channel`: `NotificationChannel @default(PUSH)`
    - `scheduledAt`: `DateTime`
    - `sentAt`: `DateTime?`
    - `status`: `NotificationStatus @default(PENDING)`
    - `createdAt`: `DateTime @default(now())`
    - `updatedAt`: `DateTime @default(now()) @updatedAt`

12. **`Referrals` & `WalletTransactions` (`prisma/models/referrals.prisma` & `prisma/models/wallet.prisma`)**:
    - `Referrals`:
      - `id`: `String @id @default(uuid())`
      - `referrer`: `Users @relation("Referrer", fields: [referrerId], references: [id])`
      - `referrerId`: `String`
      - `referred`: `Users @relation("Referred", fields: [referredId], references: [id])`
      - `referredId`: `String`
      - `referralCode`: `String`
      - `status`: `ReferralStatus @default(PENDING)`
      - `rewardAmount`: `Float @default(0)`
      - `triggeringBooking`: `Bookings? @relation(fields: [triggeringBookingId], references: [id])`
      - `triggeringBookingId`: `String?`
      - `completedAt`: `DateTime?`
      - `createdAt`: `DateTime @default(now())`
    - `WalletTransactions`:
      - `id`: `String @id @default(uuid())`
      - `user`: `Users @relation(fields: [userId], references: [id])`
      - `userId`: `String`
      - `amount`: `Float`
      - `type`: `WalletTransactionType`
      - `description`: `String @default("")`
      - `createdAt`: `DateTime @default(now())`

---

## 5. Verification Method

To independently verify the completeness and validity of the updated schema:

1. **Prisma Generation Check**:
   ```bash
   npx prisma generate
   ```
   *Expected result*: Generates TypeScript Prisma Client in `generated/prisma` and Zod Schemas in `src/v1/schemas/zod` without errors.

2. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   ```
   *Expected result*: TypeScript compilation completes cleanly.

3. **Database Migration Verification**:
   ```bash
   npx prisma migrate dev --name init_full_mishwarak_schema
   ```
   *Expected result*: Successfully applies migrations to PostgreSQL instance specified in `DATABASE_URL`.

4. **Seed Verification**:
   ```bash
   npm run seed
   npm run seed:api
   ```
   *Expected result*: Populates baseline database records (Roles, Admin, Customer, Driver, Vehicles) without foreign key or unique constraint violations.
