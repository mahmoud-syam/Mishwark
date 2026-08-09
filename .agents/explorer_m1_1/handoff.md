# Handoff Report — Explorer 1 (Milestone M1: Prisma Models & DB Layer)

## 1. Observation

Direct observations from examining the codebase, `ORIGINAL_REQUEST.md`, `PROJECT.md`, `SCOPE.md`, `Mishwark-Data-Model.docx` (via `extracted_docx_text.txt`), `package.json`, `prisma.config.ts`, and `prisma/models/*`:

1. **Prisma Multi-file Setup**:
   - `prisma.config.ts` defines `schema: "prisma"`, which enables Prisma ORM 7.8 to recursively scan and parse all `.prisma` files inside `prisma/` and `prisma/models/`.
   - Running `npx prisma generate` successfully parses `prisma/schema.prisma`, `prisma/zod.prisma`, and files under `prisma/models/`.

2. **Existing Models & Schema Files**:
   - `prisma/models/enums.prisma`: Contains `DriverStatus`, `VehicleCategory` (`CAR`, `VAN`, `BUS`, `TRUCK`), `VehicleStatus`, `BookingStatus`, `TripStatus`, `PaymentStatus`.
   - `prisma/models/users.prisma`: Contains `Users` (with `email` as non-nullable `@unique`, `preferredLanguage` default `"en"`, `rating_avg` default `0`), `PhoneNumbers`, `Drivers` (with `licenseExpiry` as `String @default("")`).
   - `prisma/models/vehicles.prisma`: Contains `Vehicles` (with `year` as `String @default("")`), `VehicleImages`, `VehicleDrivers`, `VehicleAvailability` (missing `bookingId` FK and missing `@@unique([vehicleId, date])`), and `Bookings` (contains typo `tripeStatus TripStatus`, missing `packageId`, `routeWaypoints`, `payments`, `reviews`, `conversation`, `waitlists`, `scheduledNotifications`, `referrals`, `tripLocations`).
   - `prisma/models/roles.prisma`: Contains `Role` and `Permission`.
   - `prisma/models/settings.prisma`: Contains `SystemSettings`.

3. **Missing Models**:
   - Missing primary model files:
     - `prisma/models/packages.prisma` (`Packages`)
     - `prisma/models/payments.prisma` (`Payments`)
     - `prisma/models/reviews.prisma` (`Reviews`)
     - `prisma/models/waitlist.prisma` (`Waitlist`)
     - `prisma/models/chat.prisma` (`Conversations`, `Messages`)
     - `prisma/models/notifications.prisma` (`ScheduledNotifications`)
     - `prisma/models/referrals.prisma` (`Referrals`)
     - `prisma/models/wallet.prisma` (`WalletTransactions`)
   - Missing auxiliary models:
     - `TripLocations` (for live tracking, referenced in docx §1.14)
     - `VehicleMaintenance` (for maintenance logs, referenced in docx §1.15)
   - Layout Note: `Bookings` model should be extracted from `prisma/models/vehicles.prisma` into its own file `prisma/models/bookings.prisma` as specified in `PROJECT.md`.

4. **Missing Enums**:
   - `VehicleCategory`: needs `CLASSIC` and `LUXURY` added.
   - `AvailabilityStatus`: `AVAILABLE`, `BOOKED`, `BLOCKED`.
   - `PackageType`: `MULTI_CAR`, `MULTI_EVENT`.
   - `PackageStatus`: `ACTIVE`, `COMPLETED`, `CANCELLED`, `EXPIRED`.
   - `PaymentMethod`: `PAYMOB`, `FAWRY`, `CASH`, `WALLET`.
   - `PaymentRecordStatus`: `PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`.
   - `ReviewerType`: `CUSTOMER_TO_DRIVER`, `DRIVER_TO_CUSTOMER`.
   - `WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`.
   - `ConversationStatus`: `OPEN`, `CLOSED`.
   - `SenderType`: `CUSTOMER`, `DRIVER`, `SYSTEM`.
   - `MessageType`: `TEXT`, `QUICK_REPLY`.
   - `NotificationRecipientType`: `CUSTOMER`, `DRIVER`, `ADMIN`.
   - `NotificationType`: `REMINDER_24H`, `REMINDER_2H`, `REMINDER_30M`, `RATE_TRIP`, `SYSTEM`.
   - `NotificationChannel`: `PUSH`, `SMS`, `WHATSAPP`.
   - `NotificationStatus`: `SCHEDULED`, `SENT`, `FAILED`, `CANCELLED`.
   - `ReferralStatus`: `PENDING`, `COMPLETED`, `EXPIRED`.
   - `WalletTransactionType`: `REFERRAL_REWARD`, `REFUND`, `MANUAL_ADJUSTMENT`, `PAYMENT_DEDUCTION`, `DEPOSIT`.

5. **Seed Infrastructure**:
   - `prisma/seed/` is currently an empty directory.
   - `package.json` specifies `"seed": "npx ts-node prisma/seed/seed.ts"` and `"seed:api": "npx tsx prisma/seed/api_seed_roles.ts"`.

---

## 2. Logic Chain

1. **Schema Integrity & Multi-file Architecture**:
   - Prisma v7.8 with `prisma.config.ts` (`schema: "prisma"`) merges all `.prisma` files inside `prisma/` recursively.
   - Creating modular files under `prisma/models/` ensures clean maintenance and adheres to `PROJECT.md` layer standards.

2. **Fixing Existing Schema Inconsistencies**:
   - `Users.email` must be `String? @unique` to support OTP-only customer creation without fake placeholder emails (as seen in `src/v1/controllers/auth.controller.ts:486`).
   - `Users.preferredLanguage` default must be `"ar"` as required by docx §1.1.
   - `Users.rating_avg` / `customerRating` should default to `5.0`.
   - `Drivers.licenseExpiry` must be `DateTime?` instead of `String` for proper date handling and validation.
   - `Vehicles.year` must be `Int @default(2024)` instead of `String`.
   - `VehicleAvailability`: adding `bookingId String?` and `@@unique([vehicleId, date])` enables single-query calendar availability reads and double-booking checks.
   - `Bookings`: renaming `tripeStatus` -> `tripStatus` fixes a typo that breaks type generation and runtime queries.
   - Extracting `Bookings` to `prisma/models/bookings.prisma` keeps model boundaries clean.

3. **Defining Missing Enums & Models**:
   - Cross-referencing `Mishwark-Data-Model.docx` sections 1.1 through 1.15 guarantees all field types, constraints, default values, and relations match domain requirements.
   - Bi-directional relations must be defined symmetrically in both models to satisfy Prisma schema validation rules.

---

## 3. Detailed Schema Specifications & Proposed Implementation

Below are the exact schema contents to be written/updated by Implementer 1 across all 12 model files:

### 3.1 `prisma/models/enums.prisma`
```prisma
enum DriverStatus {
  ACTIVE
  OFF
  ONTRIP
  ONLEAVE
}

enum VehicleCategory {
  CAR
  VAN
  BUS
  TRUCK
  CLASSIC
  LUXURY
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
  INPROGRESS
  ARRIVED
  COMPLETED
}

enum PaymentStatus {
  UNPAID
  PAID
  PARTIALLY_PAID
}

enum PackageType {
  MULTI_CAR
  MULTI_EVENT
}

enum PackageStatus {
  ACTIVE
  COMPLETED
  CANCELLED
  EXPIRED
}

enum PaymentMethod {
  PAYMOB
  FAWRY
  CASH
  WALLET
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
  ADMIN
}

enum NotificationType {
  REMINDER_24H
  REMINDER_2H
  REMINDER_30M
  RATE_TRIP
  SYSTEM
}

enum NotificationChannel {
  PUSH
  SMS
  WHATSAPP
}

enum NotificationStatus {
  SCHEDULED
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
  PAYMENT_DEDUCTION
  DEPOSIT
}
```

### 3.2 `prisma/models/users.prisma`
```prisma
model Users {
  id                String  @id @default(uuid())
  code              String  @default("")
  name              String
  email             String? @unique
  pic               String  @default("")
  password          String  @default("")
  preferredLanguage String  @default("ar")

  isDeleted        Boolean @default(false)
  twoFactorEnabled Boolean @default(false)
  twoFactorSecret  String? @default("")
  tokenVersion     Int     @default(0)

  phoneNumber  String? @unique
  otpVerified  Boolean @default(false)
  otpCode      String?
  referralCode String? @unique
  referredById String?
  referredBy   Users?  @relation("Referrals", fields: [referredById], references: [id])
  referrals    Users[] @relation("Referrals")

  phoneNumbers PhoneNumbers[]
  rating_avg   Float?         @default(5.0)
  role         Role?          @relation("UserRoles", fields: [roleId], references: [id])
  roleId       String?

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  drivers                Drivers?
  bookings               Bookings[]
  packages               Packages[]
  payments               Payments[]
  reviewsGiven           Reviews[]                @relation("ReviewsGiven")
  reviewsReceived        Reviews[]                @relation("ReviewsReceived")
  waitlists              Waitlist[]
  customerConversations  Conversations[]          @relation("CustomerConversations")
  sentMessages           Messages[]
  scheduledNotifications ScheduledNotifications[] @relation("NotificationRecipient")
  referralsGiven         Referrals[]              @relation("Referrer")
  referralsReceived      Referrals[]              @relation("Referred")
  walletTransactions     WalletTransactions[]
}

model PhoneNumbers {
  id     String @id @default(uuid())
  number String

  user      Users?   @relation(fields: [userId], references: [id])
  userId    String?
  drivers   Drivers? @relation(fields: [driversId], references: [id])
  driversId String?
}

model Drivers {
  id                  String               @id @default(uuid())
  user                Users                @relation(fields: [userId], references: [id])
  userId              String               @unique
  fullName            String               @default("")
  phoneNumbers        PhoneNumbers[]
  licenseNumber       String               @default("")
  licenseExpiry       DateTime?
  pic                 String               @default("")
  rating_avg          Float?               @default(5.0)
  status              DriverStatus         @default(ACTIVE)

  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @default(now()) @updatedAt
  vehicleDrivers      VehicleDrivers[]
  bookings            Bookings[]
  driverConversations Conversations[]      @relation("DriverConversations")
}
```

### 3.3 `prisma/models/vehicles.prisma`
```prisma
model Vehicles {
  id                    String                @id @default(uuid())
  make                  String                @default("")
  model                 String                @default("")
  year                  Int                   @default(2024)
  plateNumber           String                @unique @default("")
  color                 String                @default("")
  capacity              Int                   @default(0)
  category              VehicleCategory       @default(CAR)
  status                VehicleStatus         @default(AVAILABLE)
  basePrice             Float                 @default(0)
  pricePerKm            Float                 @default(0)
  pricePerHour          Float                 @default(0)
  images                VehicleImages[]
  description           String                @default("")
  createdAt             DateTime              @default(now())
  updatedAt             DateTime              @default(now()) @updatedAt
  vehicleDrivers        VehicleDrivers[]
  vehicleAvailabilities VehicleAvailability[]
  bookings              Bookings[]
  waitlists             Waitlist[]
  maintenance           VehicleMaintenance[]
}

model VehicleImages {
  id        String   @id @default(uuid())
  vehicle   Vehicles @relation(fields: [vehicleId], references: [id])
  vehicleId String
  imageUrl  String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
}

model VehicleDrivers {
  id        String   @id @default(uuid())
  vehicle   Vehicles @relation(fields: [vehicleId], references: [id])
  vehicleId String
  driver    Drivers  @relation(fields: [driverId], references: [id])
  driverId  String
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
}

model VehicleAvailability {
  id        String             @id @default(uuid())
  vehicle   Vehicles           @relation(fields: [vehicleId], references: [id])
  vehicleId String
  date      DateTime
  status    AvailabilityStatus @default(AVAILABLE)
  reason    String             @default("")
  booking   Bookings?          @relation(fields: [bookingId], references: [id])
  bookingId String?
  createdAt DateTime           @default(now())
  updatedAt DateTime           @default(now()) @updatedAt

  @@unique([vehicleId, date])
}

model VehicleMaintenance {
  id              String    @id @default(uuid())
  vehicle         Vehicles  @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  vehicleId       String
  maintenanceType String
  cost            Float     @default(0)
  scheduledDate   DateTime
  completedDate   DateTime?
  notes           String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @default(now()) @updatedAt
}
```

### 3.4 `prisma/models/bookings.prisma`
```prisma
model Bookings {
  id             String    @id @default(uuid())
  customer       Users     @relation(fields: [customerId], references: [id])
  customerId     String
  vehicle        Vehicles  @relation(fields: [vehicleId], references: [id])
  vehicleId      String
  driver         Drivers   @relation(fields: [driverId], references: [id])
  driverId       String
  package        Packages? @relation(fields: [packageId], references: [id])
  packageId      String?
  eventType      String    @default("")
  startPoint     String    @default("")
  endPoint       String    @default("")
  routeWaypoints Json?
  distanceKm     Float     @default(0)
  bookingDate    String    @default("")
  startTime      String    @default("")
  endTime        String    @default("")

  status                 BookingStatus            @default(PENDING)
  tripStatus             TripStatus               @default(NOTSTARTED)
  basePrice              Float                    @default(0)
  distancePrice          Float                    @default(0)
  totalPrice             Float                    @default(0)
  depositPaid            Float                    @default(0)
  paymentStatus          PaymentStatus            @default(UNPAID)
  driverNotes            String                   @default("")
  notes                  String                   @default("")
  createdAt              DateTime                 @default(now())
  updatedAt              DateTime                 @default(now()) @updatedAt

  vehicleAvailabilities  VehicleAvailability[]
  payments               Payments[]
  reviews                Reviews[]
  conversation           Conversations?
  waitlists              Waitlist[]
  scheduledNotifications ScheduledNotifications[]
  referrals              Referrals[]
  tripLocations          TripLocations[]

  @@unique([vehicleId, bookingDate, startTime])
}

model TripLocations {
  id         String   @id @default(uuid())
  booking    Bookings @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  bookingId  String
  latitude   Float
  longitude  Float
  speed      Float?
  recordedAt DateTime @default(now())
}
```

### 3.5 `prisma/models/packages.prisma`
```prisma
model Packages {
  id                 String        @id @default(uuid())
  customer           Users         @relation(fields: [customerId], references: [id])
  customerId         String
  packageName        String
  packageType        PackageType
  totalPrice         Float         @default(0)
  discountPercentage Float         @default(0)
  status             PackageStatus @default(ACTIVE)
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @default(now()) @updatedAt

  bookings           Bookings[]
}
```

### 3.6 `prisma/models/payments.prisma`
```prisma
model Payments {
  id             String              @id @default(uuid())
  booking        Bookings            @relation(fields: [bookingId], references: [id])
  bookingId      String
  user           Users?               @relation(fields: [userId], references: [id])
  userId         String?
  amount         Float
  paymentMethod  PaymentMethod
  transactionRef String?
  status         PaymentRecordStatus @default(PENDING)
  paidAt         DateTime?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @default(now()) @updatedAt
}
```

### 3.7 `prisma/models/reviews.prisma`
```prisma
model Reviews {
  id                String       @id @default(uuid())
  booking           Bookings     @relation(fields: [bookingId], references: [id])
  bookingId         String
  reviewer          Users        @relation("ReviewsGiven", fields: [reviewerId], references: [id])
  reviewerId        String
  reviewee          Users        @relation("ReviewsReceived", fields: [revieweeId], references: [id])
  revieweeId        String
  reviewerType      ReviewerType
  overallRating     Int
  vehicleRating     Int?
  punctualityRating Int?
  comment           String?
  visibleAt         DateTime?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @default(now()) @updatedAt
}
```

### 3.8 `prisma/models/waitlist.prisma`
```prisma
model Waitlist {
  id            String         @id @default(uuid())
  customer      Users          @relation(fields: [customerId], references: [id])
  customerId    String
  vehicle       Vehicles       @relation(fields: [vehicleId], references: [id])
  vehicleId     String
  booking       Bookings?      @relation(fields: [bookingId], references: [id])
  bookingId     String?
  requestedDate String
  requestedTime String?
  position      Int            @default(1)
  status        WaitlistStatus @default(WAITING)
  notifiedAt    DateTime?
  expiresAt     DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @default(now()) @updatedAt
}
```

### 3.9 `prisma/models/chat.prisma`
```prisma
model Conversations {
  id         String             @id @default(uuid())
  booking    Bookings           @relation(fields: [bookingId], references: [id])
  bookingId  String             @unique
  customer   Users              @relation("CustomerConversations", fields: [customerId], references: [id])
  customerId String
  driver     Drivers            @relation("DriverConversations", fields: [driverId], references: [id])
  driverId   String
  status     ConversationStatus @default(OPEN)
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @default(now()) @updatedAt

  messages   Messages[]
}

model Messages {
  id             String        @id @default(uuid())
  conversation   Conversations @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  conversationId String
  sender         Users         @relation(fields: [senderId], references: [id])
  senderId       String
  senderType     SenderType
  messageType    MessageType   @default(TEXT)
  content        String
  isRead         Boolean       @default(false)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @default(now()) @updatedAt
}
```

### 3.10 `prisma/models/notifications.prisma`
```prisma
model ScheduledNotifications {
  id               String                   @id @default(uuid())
  booking          Bookings?                @relation(fields: [bookingId], references: [id])
  bookingId        String?
  recipient        Users                    @relation("NotificationRecipient", fields: [recipientId], references: [id])
  recipientId      String
  recipientType    NotificationRecipientType @default(CUSTOMER)
  notificationType NotificationType
  channel          NotificationChannel      @default(PUSH)
  title            String?
  body             String?
  scheduledAt      DateTime
  sentAt           DateTime?
  status           NotificationStatus       @default(SCHEDULED)
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @default(now()) @updatedAt
}
```

### 3.11 `prisma/models/referrals.prisma`
```prisma
model Referrals {
  id                  String         @id @default(uuid())
  referrer            Users          @relation("Referrer", fields: [referrerId], references: [id])
  referrerId          String
  referred            Users          @relation("Referred", fields: [referredId], references: [id])
  referredId          String
  referralCode        String
  status              ReferralStatus @default(PENDING)
  rewardAmount        Float          @default(0)
  triggeringBooking   Bookings?      @relation(fields: [triggeringBookingId], references: [id])
  triggeringBookingId String?
  completedAt         DateTime?
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @default(now()) @updatedAt
}
```

### 3.12 `prisma/models/wallet.prisma`
```prisma
model WalletTransactions {
  id          String                @id @default(uuid())
  user        Users                 @relation(fields: [userId], references: [id])
  userId      String
  amount      Float
  type        WalletTransactionType
  description String?
  createdAt   DateTime              @default(now())
  updatedAt   DateTime              @default(now()) @updatedAt
}
```

---

## 4. Caveats

1. **Read-Only Scope**: Explorer 1 did not modify any `.prisma` or `.ts` files in `prisma/` or `src/`. All implementation must be executed by Implementer 1.
2. **Pre-existing Controller Inconsistencies**: Legacy controller files (`auth.controller.ts`, `vehicles.controller.ts`) contain unused code references from old template code (e.g. `teams`, `graduationFaculty`, `reportingTo`). These do not block `prisma generate`, but `tsc --noEmit` will report errors until cleaned up or typed properly during API/service implementation phases.

---

## 5. Conclusion

The schema requirements for Milestone M1 are fully analyzed, mapped, and verified against `Mishwark-Data-Model.docx` and `SCOPE.md`. All missing primary models, auxiliary models, enums, relation pairs, FK constraints, and field defaults have been specified with exact drop-in Prisma syntax.

---

## 6. Verification Method

To independently verify the schema implementation once applied by Implementer 1:

1. **Prisma Generation**:
   Run command: `npx prisma generate`
   Expected outcome: Exit code 0, Prisma Client generated to `generated/prisma`, Zod types generated to `src/v1/schemas/zod`.
2. **Schema Verification**:
   Inspect `generated/prisma/index.d.ts` to confirm presence of `Packages`, `Payments`, `Reviews`, `Waitlist`, `Conversations`, `Messages`, `ScheduledNotifications`, `Referrals`, `WalletTransactions`, `TripLocations`, `VehicleMaintenance`, and all 16 missing enums.
