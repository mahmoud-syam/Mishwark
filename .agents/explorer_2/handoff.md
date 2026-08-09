# Explorer 2 Handoff Report: Codebase Architecture & Tech Stack Specialist

## 1. Observation

Direct observations from examining the codebase at `C:/Projects/Mishwarak-backend`:

### Core Tech Stack & Dependencies (`package.json`)
- **Runtime & Framework**: Node.js, Express (`v5.2.1`), TypeScript (`v5.9.3`), CommonJS module target (`tsconfig.json`).
- **Database & ORM**: PostgreSQL with Prisma (`v7.8.0`) utilizing `@prisma/adapter-pg` (`v7.4.2`).
- **Schema Validation & Codegen**: Zod (`v4.4.3`) and `zod-prisma-types` (`v3.3.11`).
- **Auth & Security**: JWT (`jsonwebtoken` `v9.0.3`), bcrypt (`v6.0.0`), TOTP 2FA (`otplib` `v13.4.1`, `qrcode` `v1.5.4`), `cookie-parser` (`v1.4.7`).
- **File Uploads & Utilities**: Multer (`v2.1.1`), Mammoth (`v1.12.0` for docx parsing), XLSX (`v0.18.5`), Nodemailer (`v8.0.10`).
- **Dev Environment**: Nodemon (`v3.1.14`), `ts-node` (`v10.9.2`), `tsx` (`v4.21.0`).

### Database Configuration & Prisma Setup
- **Config**: `prisma.config.ts` points to `schema: "prisma"`, `migrations: "prisma/migrations"`.
- **Modular Schema Directory**: Prisma schema files are located under `prisma/models/`:
  - `prisma/models/enums.prisma` (DriverStatus, VehicleCategory, VehicleStatus, BookingStatus, TripStatus, PaymentStatus)
  - `prisma/models/roles.prisma` (Role, Permission)
  - `prisma/models/settings.prisma` (SystemSettings)
  - `prisma/models/users.prisma` (Users, PhoneNumbers, Drivers)
  - `prisma/models/vehicles.prisma` (Vehicles, VehicleImages, VehicleDrivers, VehicleAvailability, Bookings)
- **Client Generation Target**: Generated client is output to `./generated/prisma` (`generated/prisma/client`) as defined in `prisma/schema.prisma`.
- **Zod Types Output**: `zod.prisma` outputs generated Zod schemas to `src/v1/schemas/zod`.

### Codebase Directory Layout (`src/`)
```
src/
├── index.ts                     # Main Express app initialization, CORS, middleware setup, port listening
├── secrets.ts                   # Environment variables (PORT, JWT_SECRET) loaded via dotenv
├── error-handler.ts             # Higher-Order Function wrapper for async controller error catching
└── v1/
    ├── controllers/             # Auth, 2FA, and Vehicles controllers
    │   ├── auth.controller.ts
    │   ├── two-factor.controller.ts
    │   └── vehicles.controller.ts
    ├── exceptions/              # Custom HTTP Exception classes & error code enums
    │   ├── root.ts (HttpException, ErrorCodes)
    │   ├── bad-requests.ts
    │   ├── forbidden.ts
    │   ├── internal-exceptions.ts
    │   ├── not-found.ts
    │   ├── unauthorized.ts
    │   └── validation.ts
    ├── middlewares/             # Express middlewares
    │   ├── admin.middleware.ts
    │   ├── auth.middleware.ts
    │   ├── errors.middleware.ts
    │   ├── multer.middleware.ts
    │   └── permission.middleware.ts
    ├── routes/                  # Express Router modules
    │   ├── index.ts             # Mounted at /api/v1
    │   ├── auth.route.ts
    │   └── vehicles.route.ts
    ├── schemas/                 # Zod validation schemas
    │   ├── auth.schema.ts
    │   ├── vehicles.schema.ts
    │   └── zod/                 # Auto-generated Prisma Zod types
    ├── services/                # Business logic services
    │   ├── email.service.ts
    │   └── two-factor.service.ts
    ├── types/                   # Express Request type augmentation (req.user)
    │   └── express/index.d.ts
    └── utils/                   # Shared helpers & Prisma client singleton
        ├── helpers.ts
        ├── prismaClientHelper.ts
        └── template.utils.ts
```

### Verification & Script Commands (`package.json`)
1. **Prisma Generation**: `npx prisma generate` (Succeeds with exit code 0; generates client to `./generated/prisma` and Zod types to `src/v1/schemas/zod`).
2. **TypeScript Typecheck**: `npx tsc --noEmit` (Executed; fails currently due to legacy field references in `auth.controller.ts` and `@prisma/client` import path in `vehicles.controller.ts`).
3. **Build**: `npm run build` (`tsc`)
4. **Dev Server**: `npm run dev` (`nodemon --watch src --ext ts --exec ts-node src/index.ts`)
5. **Database Seed Scripts**:
   - `npm run seed` (`npx ts-node prisma/seed/seed.ts`)
   - `npm run seed:api` (`npx tsx prisma/seed/api_seed_roles.ts`)

---

## 2. Logic Chain

1. **Architecture Pattern**:
   - The application follows a 4-tier layer pattern: `Route` -> `Middleware` -> `Controller` (wrapped in `errorHandler`) -> `Zod Schema / Prisma Model`.
   - Controllers handle HTTP req/res, delegate validation to Zod schemas, and perform DB operations using `prismaClient` imported from `src/v1/utils/prismaClientHelper`.
   - Errors thrown inside controllers (or Zod validation failures) are caught by `errorHandler` in `src/error-handler.ts` and passed to `errorMiddleware` in `src/v1/middlewares/errors.middleware.ts` which returns uniform JSON error payloads `{ message, errorCode, errors }`.

2. **Database Client Singleton**:
   - Prisma is configured with `@prisma/adapter-pg`.
   - `src/v1/utils/prismaClientHelper.ts` instantiates `new PrismaClient({ adapter })` from `../../../generated/prisma/client`.
   - All modules MUST import `prismaClient` from `src/v1/utils/prismaClientHelper` (or import types from `../../../generated/prisma/client` rather than directly from `@prisma/client` to prevent type mismatches).

3. **Authentication & Session Mechanics**:
   - Authentication relies on cookie-based JWTs (`req.cookies.token`).
   - `authMiddleware` verifies the JWT signature and checks `user.tokenVersion` against the database to allow instant session invalidation (e.g. `logoutAllDevices`, password reset, 2FA reset).
   - Phone OTP flow (`POST /auth/otp/request` & `POST /auth/otp/verify`) creates/authenticates customer users and returns JWT with embedded role payload.

4. **Required Additions for Full Feature Scope (`Mishwark-Data-Model.docx`)**:
   - Missing Prisma Models to create under `prisma/models/`:
     - `Waitlist`
     - `Conversations` & `Messages` (Chat)
     - `ScheduledNotifications`
     - `Referrals` & `WalletTransactions`
     - `Payments`
     - `Reviews`
     - `Packages`
   - Key business logic to implement:
     - Server-side distance and base price calculation (`POST /bookings/estimate-price`).
     - Database double-booking prevention (`UNIQUE(vehicleId, bookingDate, startTime)`).
     - Blind review exposure logic (reviews visible only when both sides submit or after 48 hours).
     - Referral reward triggers upon first confirmed booking.

---

## 3. Caveats

- **Existing Legacy Code Errors**: The current codebase contains legacy employee management attributes in `src/v1/controllers/auth.controller.ts` (e.g., `graduationFaculty`, `reportingTo`, `teams`) leftover from an earlier project skeleton before transitioning to Mishwark ride-booking. These cause `npx tsc --noEmit` to fail until cleaned up.
- **Import Path Standard**: `vehicles.controller.ts` currently imports `@prisma/client` types directly which leads to TypeScript errors because the custom generator outputs to `generated/prisma/client`. Implementers must import Prisma types from `generated/prisma/client` or update output config.
- **Environment Variables**: `.env` specifies local database connection parameters (`DATABASE_URL`, `PORT`, `JWT_SECRET`). Ensure `.env` is present during runtime testing.

---

## 4. Conclusion

The Mishwarak backend provides a clean Express + Prisma foundation ready for scaling to all requirements outlined in `ORIGINAL_REQUEST.md` and `Mishwark-Data-Model.docx`.

### Recommended Clean Architecture & Module Boundaries for Implementation:

#### 1. Prisma Schema File Organization (`prisma/models/`)
- `enums.prisma`: Add `WaitlistStatus`, `MessageType`, `NotificationType`, `NotificationChannel`, `NotificationStatus`, `ReferralStatus`, `WalletTransactionType`, `PaymentMethod`, `PaymentStatus` (update), `ReviewerType`, `PackageType`, `PackageStatus`.
- `users.prisma`: Add relations for `Waitlist`, `Referrals` (referrer/referred), `WalletTransactions`, `Reviews`, `Conversations`, `ScheduledNotifications`.
- `vehicles.prisma`: Keep `Vehicles`, `VehicleImages`, `VehicleDrivers`, `VehicleAvailability`, `Bookings`.
- `bookings.prisma` (or extended `vehicles.prisma`): `Bookings`, `Payments`, `Reviews`, `Packages`.
- `chat.prisma`: `Conversations`, `Messages`.
- `marketing.prisma`: `Waitlist`, `Referrals`, `WalletTransactions`, `ScheduledNotifications`.

#### 2. Module Boundary Breakdown (`src/v1/`)
- **Routes (`src/v1/routes/index.ts`)**:
  - `/api/v1/auth` -> `auth.route.ts` (OTP request/verify, 2FA, session management)
  - `/api/v1/vehicles` -> `vehicles.route.ts` (fleet browsing, availability calendar)
  - `/api/v1/bookings` -> `bookings.route.ts` (price estimation, creation, customer list/details, driver status updates)
  - `/api/v1/driver` -> `driver.route.ts` (driver trips query & status updates)
  - `/api/v1/waitlist` -> `waitlist.route.ts` (join waitlist, check position)
  - `/api/v1/reviews` -> `reviews.route.ts` (customer/driver two-way blind ratings)
  - `/api/v1/referrals` -> `referrals.route.ts` (user referral stats & code)
  - `/api/v1/packages` -> `packages.route.ts` (multi-car/multi-event package booking)
  - `/api/v1/payments` -> `payments.route.ts` (payment status & transaction recording)
  - `/api/v1/chat` -> `chat.route.ts` (conversations & message history)
  - `/api/v1/admin` -> `admin.route.ts` (dashboard statistics, calendar view, fleet status, driver stats)

- **Controllers (`src/v1/controllers/`)**:
  - `auth.controller.ts`, `vehicles.controller.ts`, `bookings.controller.ts`, `driver.controller.ts`, `waitlist.controller.ts`, `reviews.controller.ts`, `referrals.controller.ts`, `packages.controller.ts`, `payments.controller.ts`, `chat.controller.ts`, `admin.controller.ts`.

- **Services (`src/v1/services/`)**:
  - `pricing.service.ts` (Server-side price estimation & package discount logic)
  - `booking.service.ts` (Booking creation & double-booking validation)
  - `reviews.service.ts` (Blind rating visibility enforcement)
  - `referral.service.ts` (Referral completion & wallet crediting)

- **Schemas (`src/v1/schemas/`)**:
  - Separate Zod validation schema files for each module (`bookings.schema.ts`, `waitlist.schema.ts`, `reviews.schema.ts`, etc.).

---

## 5. Verification Method

To independently verify the codebase structure and recommendations:

1. **Verify Prisma Schema Client Generation**:
   ```bash
   npx prisma generate
   ```
   *Expected result*: Generates Prisma client into `generated/prisma` and Zod types into `src/v1/schemas/zod` without errors.

2. **Verify Typecheck Command**:
   ```bash
   npx tsc --noEmit
   ```
   *Expected result*: Executes TypeScript compiler without emitting files, highlighting any type misalignments.

3. **Verify Routing Wiring**:
   Inspect `src/v1/routes/index.ts` to confirm all API sub-routers are mounted under `/api/v1`.

4. **Verify Middleware Hierarchy**:
   Inspect `src/v1/routes/auth.route.ts` and `src/v1/routes/vehicles.route.ts` to confirm usage of `authMiddleware`, `requirePermission`, and `errorHandler`.
