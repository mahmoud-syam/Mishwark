# Handoff Report — Explorer M1-2: Prisma Models & DB Layer Fixes

## 1. Observation

### 1.1 Existing Model Files & Locations
- **`prisma/models/vehicles.prisma`** (84 lines): Currently contains models `Vehicles` (lines 1-21), `VehicleImages` (lines 23-30), `VehicleDrivers` (lines 32-41), `VehicleAvailability` (lines 43-52), and `Bookings` (lines 54-82).
- **`prisma/models/users.prisma`** (62 lines): Currently contains models `Users` (lines 1-33), `PhoneNumbers` (lines 35-43), and `Drivers` (lines 45-61).
- **`prisma/models/enums.prisma`** (40 lines): Contains enums `DriverStatus`, `VehicleCategory`, `VehicleStatus`, `BookingStatus`, `TripStatus`, `PaymentStatus`.
- **`prisma.config.ts`** (15 lines): Prisma v7 configuration (`defineConfig({ schema: "prisma" })`), which recursively loads all `.prisma` schema files in `prisma/` and `prisma/models/`.

### 1.2 Identified Typos, Missing FKs, and Schema Issues
1. **`Bookings` Typo (`prisma/models/vehicles.prisma:71`)**:
   ```prisma
   71:   tripeStatus   TripStatus    @default(NOTSTARTED)
   ```
   *Observation*: Field name is misspelled as `tripeStatus` instead of `tripStatus`.

2. **`Bookings` Missing Relations & Foreign Keys (`prisma/models/vehicles.prisma:54-82`)**:
   - `packageId`: Missing FK `packageId String?` and relation `package Packages? @relation(fields: [packageId], references: [id], onDelete: SetNull)`.
   - `routeWaypoints`: Missing JSONB field `routeWaypoints Json?` (required by docx §1.6 for optional extra route stops).
   - `payments`: Missing back-relation `payments Payments[]`.
   - `reviews`: Missing back-relation `reviews Reviews[]`.
   - `conversation`: Missing back-relation `conversation Conversations?`.
   - `waitlists`: Missing back-relation `waitlists Waitlist[]`.
   - `scheduledNotifications`: Missing back-relation `scheduledNotifications ScheduledNotifications[]`.
   - `referrals`: Missing back-relation `referrals Referrals[] @relation("TriggeringBooking")`.
   - `vehicleAvailabilities`: Missing back-relation `vehicleAvailabilities VehicleAvailability[]`.
   - `tripLocations`: Missing back-relation `tripLocations TripLocations[]`.

3. **`VehicleAvailability` Model Issues (`prisma/models/vehicles.prisma:43-52`)**:
   ```prisma
   43: model VehicleAvailability {
   44:   id        String        @id @default(uuid())
   45:   vehicle   Vehicles      @relation(fields: [vehicleId], references: [id])
   46:   vehicleId String
   47:   date      DateTime
   48:   status    VehicleStatus @default(AVAILABLE)
   49:   reason    String        @default("")
   50:   createdAt DateTime      @default(now())
   51:   updatedAt DateTime      @default(now()) @updatedAt
   52: }
   ```
   *Observation*: Missing `bookingId String?` FK field and relation `booking Bookings? @relation(fields: [bookingId], references: [id], onDelete: SetNull)`. Missing unique constraint `@@unique([vehicleId, date])`.

4. **`Users` Model Issues (`prisma/models/users.prisma:1-33`)**:
   ```prisma
   5:   email             String @unique
   8:   preferredLanguage String @default("en")
   24:  rating_avg   Float?         @default(0)
   ```
   *Observation*:
   - `email` is non-nullable (`String @unique`). In `src/v1/controllers/auth.controller.ts:486`, phone-based OTP signup forces dummy email creation: `email: \`${phoneNumber}@placeholder.com\``.
   - `preferredLanguage` defaults to `"en"` instead of `"ar"` (docx §1.1 specifies default `"ar"`).
   - Rating field is named `rating_avg` with default `0`, whereas docx §1.1 specifies `customer_rating` default `5.0`.
   - Missing relations: `packages Packages[]`, `waitlists Waitlist[]`, `walletTransactions WalletTransactions[]`, `referralsAsReferrer Referrals[]`, `referralsAsReferred Referrals[]`.

5. **`Drivers` Model Issues (`prisma/models/users.prisma:45-61`)**:
   ```prisma
   52:   licenseExpiry String         @default("")
   54:   rating_avg    Float?         @default(5.0)
   ```
   *Observation*:
   - `licenseExpiry` is defined as `String @default("")` instead of `DateTime?` (docx §1.2 specifies `license_expiry DATE`).
   - `rating_avg` field should be `rating Float? @default(5.0)` to align with docx §1.2 (`rating`).
   - Missing relation: `conversations Conversations[]`.

6. **`Vehicles` Model Issues (`prisma/models/vehicles.prisma:1-21`)**:
   ```prisma
   5:   year                  String                @default("")
   ```
   *Observation*:
   - `year` is defined as `String @default("")` instead of `Int @default(2024)` (docx §1.3 specifies `year INT`).
   - Missing relations: `waitlists Waitlist[]`, `maintenance VehicleMaintenance[]`.

### 1.3 TypeScript Code & Terminal Command Results
- Executed `npx prisma generate`: Exited with code 0. Loaded schema from `prisma/` and generated Prisma Client to `./generated/prisma` and Zod types to `./src/v1/schemas/zod`.
- Executed `npx tsc --noEmit`: Exited with errors due to legacy template code in `auth.controller.ts` (e.g. `teams`, `reportingTo`, `graduationFaculty`) and missing exports in `@prisma/client` prior to point-of-use module update. No existing model field references break because `tripeStatus`, `rating_avg`, and `licenseExpiry` are not referenced in `src/v1/`.

---

## 2. Logic Chain

1. **`Bookings` Location & Typo Fix**:
   - `Bookings` model is currently situated inside `prisma/models/vehicles.prisma`. Extracting it to `prisma/models/bookings.prisma` satisfies the project structure specified in `PROJECT.md` and `SCOPE.md`.
   - Changing `tripeStatus` to `tripStatus` fixes a misspelled property and aligns the Prisma client generated types with the REST API documentation in docx §1.6 and §3.

2. **`Bookings` Relation Integration**:
   - Docx §1.6, §1.7, §1.8, §1.9, §1.10, §1.11, §1.12, §1.13, §1.14 specify cross-entity links for Bookings.
   - Adding `packageId String?` with `@relation(fields: [packageId], references: [id], onDelete: SetNull)` enables multi-car and multi-event packages.
   - Adding `routeWaypoints Json?` enables storing intermediate waypoints/stops for route pricing.
   - Adding back-relations (`payments`, `reviews`, `conversation`, `waitlists`, `scheduledNotifications`, `referrals`, `vehicleAvailabilities`, `tripLocations`) ensures Prisma bidirectional type navigation operates without schema generation errors.

3. **`VehicleAvailability` Fix**:
   - Docx §1.5 states `booking_id UUID (FK, nullable) set when status = booked`.
   - Adding `bookingId String?` and `booking Bookings? @relation(...)` allows marking calendar entries as booked via a specific booking.
   - Adding `@@unique([vehicleId, date])` enforces database-level uniqueness per vehicle date, enabling efficient single-query availability lookup and upsert operations.

4. **`Users`, `Drivers`, and `Vehicles` Primitive & Default Value Fixes**:
   - `Users.email`: Making `email` optional (`String? @unique`) removes the requirement to store synthetic dummy emails like `${phoneNumber}@placeholder.com` during phone OTP authentication (`auth.controller.ts:486`).
   - `Users.preferredLanguage`: Defaulting to `"ar"` aligns with docx §1.1.
   - `Users.customerRating`: Setting `customerRating Float? @default(5.0)` aligns with docx §1.1 and provides standard rating initial values for new customer profiles.
   - `Drivers.licenseExpiry`: Changing `licenseExpiry` from `String` to `DateTime?` enforces date validity for driver compliance checks.
   - `Drivers.rating`: Renaming `rating_avg` to `rating Float? @default(5.0)` matches docx §1.2.
   - `Vehicles.year`: Changing `year` from `String` to `Int @default(2024)` allows numeric filtering and sorting by vehicle model year.

---

## 3. Caveats

- **Existing Legacy Code in `auth.controller.ts`**: `auth.controller.ts` contains legacy template references (`teams`, `reportingTo`, `graduationFaculty`). These are non-blocking for Prisma schema generation, but will need to be cleaned up when implementers refine the auth controller.
- **Migration & Seed Data**: Physical database table updates (`npx prisma db push` or `npx prisma migrate dev`) will be managed by Implementer M1/Explorer 3 alongside seed scripts in `prisma/seed/`.

---

## 4. Conclusion

The existing Prisma models require exact structural, type, and relational adjustments across `users.prisma`, `vehicles.prisma`, and a new `bookings.prisma` file. Below are the exact proposed schema definitions:

### 4.1 Proposed `prisma/models/users.prisma`
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
  referredBy   Users?  @relation("UserReferral", fields: [referredById], references: [id])
  userReferrals Users[] @relation("UserReferral")

  phoneNumbers   PhoneNumbers[]
  customerRating Float?         @default(5.0)
  role           Role?          @relation("UserRoles", fields: [roleId], references: [id])
  roleId         String?

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt

  drivers             Drivers?
  bookings            Bookings[]
  packages            Packages[]
  waitlists           Waitlist[]
  walletTransactions  WalletTransactions[]
  referralsAsReferrer Referrals[]          @relation("ReferrerUser")
  referralsAsReferred Referrals[]          @relation("ReferredUser")
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
  id            String         @id @default(uuid())
  user          Users          @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId        String         @unique
  fullName      String         @default("")
  phoneNumbers  PhoneNumbers[]
  licenseNumber String         @default("")
  licenseExpiry DateTime?
  pic           String         @default("")
  rating        Float?         @default(5.0)
  status        DriverStatus   @default(ACTIVE)

  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @default(now()) @updatedAt
  vehicleDrivers VehicleDrivers[]
  bookings       Bookings[]
  conversations  Conversations[]
}
```

### 4.2 Proposed `prisma/models/vehicles.prisma`
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
  vehicle   Vehicles @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  vehicleId String
  imageUrl  String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
}

model VehicleDrivers {
  id        String   @id @default(uuid())
  vehicle   Vehicles @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  vehicleId String
  driver    Drivers  @relation(fields: [driverId], references: [id], onDelete: Cascade)
  driverId  String
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
}

model VehicleAvailability {
  id        String        @id @default(uuid())
  vehicle   Vehicles      @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  vehicleId String
  date      DateTime
  status    VehicleStatus @default(AVAILABLE)
  booking   Bookings?     @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  bookingId String?
  reason    String        @default("")
  createdAt DateTime      @default(now())
  updatedAt DateTime      @default(now()) @updatedAt

  @@unique([vehicleId, date])
}
```

### 4.3 Proposed `prisma/models/bookings.prisma`
```prisma
model Bookings {
  id                     String                 @id @default(uuid())
  customer               Users                  @relation(fields: [customerId], references: [id])
  customerId             String
  vehicle                Vehicles               @relation(fields: [vehicleId], references: [id])
  vehicleId              String
  driver                 Drivers                @relation(fields: [driverId], references: [id])
  driverId               String
  package                Packages?              @relation(fields: [packageId], references: [id], onDelete: SetNull)
  packageId              String?
  eventType              String                 @default("")
  startPoint             String                 @default("")
  endPoint               String                 @default("")
  routeWaypoints         Json?
  distanceKm             Float                  @default(0)
  bookingDate            String                 @default("")
  startTime              String                 @default("")
  endTime                String                 @default("")

  status                 BookingStatus          @default(PENDING)
  tripStatus             TripStatus             @default(NOTSTARTED)
  basePrice              Float                  @default(0)
  distancePrice          Float                  @default(0)
  totalPrice             Float                  @default(0)
  depositPaid            Float                  @default(0)
  paymentStatus          PaymentStatus          @default(UNPAID)
  driverNotes            String                 @default("")
  notes                  String                 @default("")
  createdAt              DateTime               @default(now())
  updatedAt              DateTime               @default(now()) @updatedAt

  payments               Payments[]
  reviews                Reviews[]
  conversation           Conversations?
  waitlists              Waitlist[]
  scheduledNotifications ScheduledNotifications[]
  referrals              Referrals[]            @relation("TriggeringBooking")
  vehicleAvailabilities  VehicleAvailability[]
  tripLocations          TripLocations[]

  @@unique([vehicleId, bookingDate, startTime])
}
```

---

## 5. Verification Method

To verify these schema updates independently:

1. **Inspect Schema Files**:
   - Confirm `prisma/models/users.prisma` has `email String? @unique`, `preferredLanguage String @default("ar")`, `customerRating Float? @default(5.0)` in `Users`, and `licenseExpiry DateTime?`, `rating Float? @default(5.0)` in `Drivers`.
   - Confirm `prisma/models/vehicles.prisma` has `year Int @default(2024)` in `Vehicles`, and `bookingId String?`, `booking Bookings?`, `@@unique([vehicleId, date])` in `VehicleAvailability`.
   - Confirm `prisma/models/bookings.prisma` contains model `Bookings` with `tripStatus TripStatus`, `packageId String?`, `routeWaypoints Json?`, and all bidirectional back-relations.

2. **Generate Client & Zod Schemas**:
   - Run `npx prisma generate` from the project root (`C:\Projects\Mishwarak-backend`).
   - Invalidation condition: Any missing relation error or schema parsing failure during `npx prisma generate` indicates an unhandled relation name or mismatched field type across models.
