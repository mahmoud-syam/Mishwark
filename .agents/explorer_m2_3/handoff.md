# Handoff Report: Explorer 3 — M2 API Endpoints, Middleware & Testing Setup

## 1. Observation

- **Express App Setup (`src/index.ts`)**:
  - `src/index.ts` lines 11–44 initialize `const app: Express = express()`, configure CORS/cookie/JSON/static middlewares, attach `/api/v1` router, attach `errorMiddleware`, and invoke `app.listen(Number(PORT), ...)`.
  - Currently no `src/app.ts` file exists to export `app` separately for integration testing.

- **Main Router (`src/v1/routes/index.ts`)**:
  - Lines 5–10 attach `/auth` (`authRouterV1`) and `/vehicles` (`vehiclesRouterV1`).
  - `bookingRouterV1` is not yet mounted.

- **Error Handling & Controller Wrappers (`src/error-handler.ts` & `src/v1/middlewares/errors.middleware.ts`)**:
  - `src/error-handler.ts` lines 7–26 export `errorHandler(method: Function)`, catching `HttpException`, `ZodError`, and generic errors.
  - `src/v1/middlewares/errors.middleware.ts` handles status codes and formats JSON response with `{ message, errorCode, errors }`.

- **Existing Middlewares (`src/v1/middlewares/`)**:
  - `auth.middleware.ts` lines 10–32 export `authMiddleware`, reading `req.cookies.token` only. `Authorization` header reading and `authenticateToken` alias are currently missing.
  - `permission.middleware.ts` lines 10–50 export `requirePermission`. `authorizeRole` middleware is currently missing.
  - Request validation middleware (`validateRequest`) does not exist yet in `src/v1/middlewares/`.

- **Prisma Schema & Enums (`prisma/models/`)**:
  - `Bookings` model (`prisma/models/bookings.prisma`: lines 1–42) contains fields: `id`, `customerId`, `vehicleId`, `driverId`, `packageId`, `eventType`, `startPoint`, `endPoint`, `routeWaypoints`, `distanceKm`, `bookingDate`, `startTime`, `endTime`, `status` (`BookingStatus`), `tripStatus` (`TripStatus`), `basePrice`, `distancePrice`, `totalPrice`, `depositPaid`, `paymentStatus`, `driverNotes`, `notes`.
  - Enums (`prisma/models/enums.prisma`: lines 29–41):
    - `BookingStatus`: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`
    - `TripStatus`: `NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED`
  - `VehicleAvailability` model (`prisma/models/vehicles.prisma`: lines 45–58): `id`, `vehicleId`, `date`, `status` (`AvailabilityStatus`: `AVAILABLE`, `BOOKED`, `BLOCKED`), `bookingId`.
  - `Waitlist` model (`prisma/models/waitlist.prisma`: lines 1–18): `id`, `customerId`, `vehicleId`, `bookingId`, `requestedDate`, `requestedTime`, `position`, `status` (`WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`), `notifiedAt`, `expiresAt`.

- **Test Infrastructure (`package.json`)**:
  - `package.json` line 53 has `"tsx": "^4.21.0"`. `node --test` / `tsx --test` or Supertest can be used for testing.

---

## 2. Logic Chain

1. **App Separation**:
   - Isolating app initialization into `src/app.ts` and server startup into `src/index.ts` allows test files to import `app` directly for supertest route testing without port conflicts.

2. **Middleware Standardization**:
   - `authMiddleware` must check both `req.cookies.token` and `req.headers.authorization` header (`Bearer <token>`) to support standard API authorization calls. Alias `export const authenticateToken = authMiddleware;` fulfills contract requirements.
   - `validateRequest` middleware using Zod provides declarative, automatic request body and query validation across all routes.
   - `authorizeRole` middleware ensures role isolation (`CUSTOMER` vs `DRIVER` vs `ADMIN`).

3. **Validation & State Machine Enforcement**:
   - Zod validation schemas in `src/v1/schemas/booking.schema.ts` enforce shape, type, and regex constraints (e.g., `YYYY-MM-DD`, `HH:mm`) before controller execution.
   - The state machine transitions for `BookingStatus` (`PENDING` -> `CONFIRMED` -> `COMPLETED`/`CANCELLED`) and `TripStatus` (`NOTSTARTED` -> `INPROGRESS` -> `ARRIVED` -> `COMPLETED`) safeguard data integrity.

4. **Double-Booking Protection & Concurrency Locking**:
   - Using `prisma.$transaction`, checking time window overlaps `(newStart < existingEnd AND newEnd > existingStart)` against `Bookings` and `VehicleAvailability` prevents race conditions.
   - Returning HTTP 409 Conflict provides clear error semantics when availability conflicts occur.

5. **Waitlist Promotion Automation**:
   - Upon cancellation, transactional release of `VehicleAvailability` and querying the earliest `Waitlist` row (`position ASC`, `WAITING`) ensures automatic queue promotion and notification scheduling.

---

## 3. Caveats

- **Timezone Standardization**: Booking dates and start/end times should be handled consistently in UTC or standardized local ISO strings to avoid timezone mismatch during time range overlap calculation.
- **External Notifications**: Actual push/SMS notification delivery is part of M3; for M2, waitlist promotion creates `ScheduledNotifications` rows in the database.

---

## 4. Conclusion

The technical requirements, schema specs, middleware structure, endpoint parameters, state machine rules, and test strategy for M2 (Bookings & Pricing Engine) are fully analyzed and mapped. Implementers can proceed directly to writing `src/app.ts`, `src/v1/middlewares/validation.middleware.ts`, `src/v1/schemas/booking.schema.ts`, `src/v1/services/pricing.service.ts`, `src/v1/services/booking.service.ts`, `src/v1/controllers/booking.controller.ts`, and `src/v1/routes/booking.routes.ts`.

---

## 5. Verification Method

To verify the setup and findings:
1. Run `npx tsc --noEmit` to verify type compliance across the project.
2. Inspect `src/app.ts`, `src/v1/routes/index.ts`, `src/v1/middlewares/auth.middleware.ts`, and `src/v1/schemas/booking.schema.ts`.
3. Test route endpoints using `npx tsx --test tests/**/*.test.ts` or Supertest once implementers finalize code.
