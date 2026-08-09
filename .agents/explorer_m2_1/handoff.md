# Handoff Report: Explorer 1 (Milestone M2 — Bookings & Pricing Core Engine)

## 1. Observation

### Codebase and Model Inspection
- **Prisma Schema Models** (`prisma/models/`):
  - `bookings.prisma`: `Bookings` model with composite unique constraint `@@unique([vehicleId, bookingDate, startTime])`.
  - `vehicles.prisma`: `Vehicles` model (with `category`, `basePrice`, `pricePerKm`, `pricePerHour`, `status`), `VehicleAvailability` model (with `@@unique([vehicleId, date])`).
  - `waitlist.prisma`: `Waitlist` model with fields (`customerId`, `vehicleId`, `requestedDate`, `requestedTime`, `position`, `status`).
  - `packages.prisma` & `referrals.prisma`: Models for multi-car/multi-event packages and user referral program tracking.
- **Existing Routes & Controllers** (`src/v1/routes/index.ts`, `src/v1/controllers/vehicles.controller.ts`):
  - Express v5 pattern with `errorHandler` async wrapper.
  - Middlewares `authMiddleware`, `adminMiddleware`, `errorMiddleware`.
  - Service directory currently lacks `pricing.service.ts` and `booking.service.ts`.
- **Existing Test Infrastructure** (`tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts`, `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts`):
  - Defines the exact authoritative formula for price estimates:
    - Default rates per category: `CAR` (50, 10, 25), `VAN` (150, 15, 40), `BUS` (300, 25, 60), `TRUCK` (250, 20, 50), `CLASSIC` (200, 18, 45), `LUXURY` (350, 30, 75).
    - Distance price: `distanceKm * pricePerKm`.
    - Time price: `(durationMinutes / 60) * pricePerHour`.
    - Peak surge multiplier default: `1.25` when `isPeakHour` is true.
    - Package + Referral discount capping to prevent negative total price.
    - 20% deposit requirement: `totalPrice * 0.20`.
    - Slot overlap condition: `sA < eB && sB < eA`.
    - State machine transitions for `BookingStatus` (`PENDING` -> `CONFIRMED` -> `COMPLETED`/`CANCELLED`) and `TripStatus` (`NOTSTARTED` -> `INPROGRESS` -> `ARRIVED` -> `COMPLETED`).

---

## 2. Logic Chain

1. **Pricing Engine Logic**:
   - Query vehicle custom rates if `vehicleId` provided; fallback to `VehicleCategory` standard defaults table; fallback to `CAR` rates if category missing/unknown.
   - Clamp `distanceKm` and `durationMinutes` with `Math.max(0, val)`.
   - Calculate subtotal = `basePrice + distancePrice + timePrice`. Apply peak surge multiplier to subtotal if `isPeakHour = true`.
   - Subtract total combined discount (`packageDiscount + referralDiscount`), capped at `surchargedTotal`.
   - Round total price to 2 decimal places and compute 20% deposit.

2. **Double-Booking & Availability Control Logic**:
   - Execute all booking creations inside `prisma.$transaction`.
   - Check vehicle status (must not be `MAINTENANCE`) and driver status (must be `ACTIVE`).
   - Check existing `VehicleAvailability` records for `BOOKED` or `BLOCKED` status on `bookingDate`.
   - Query existing active `Bookings` on the date for vehicle/driver and run slot overlap formula `sA < eB && sB < eA`.
   - If overlap detected, throw a HTTP 409 `ConflictException`.
   - Upon creation, insert `Bookings` record and upsert `VehicleAvailability` to status `BOOKED` linked to `bookingId`.

3. **Cancellation & Waitlist Promotion Logic**:
   - Check state transition validity: only `PENDING` or `CONFIRMED` bookings can be cancelled.
   - Update `Booking.status` to `CANCELLED`, release `VehicleAvailability` record back to `AVAILABLE`, set assigned driver back to `ACTIVE`.
   - Find top waiting entry in `Waitlist` table (`status = WAITING`, ordered by `position ASC`), update status to `NOTIFIED`, set 24h expiration timer, and generate a `ScheduledNotifications` record.

---

## 3. Caveats

- **Time Format Assumption**: Booking dates are stored as ISO dates (`YYYY-MM-DD` or `DateTime`), and time slots as `HH:mm` strings (24h format).
- **Peak Hour Detection**: In `calculatePrice`, if `isPeakHour` boolean is explicitly passed, it overrides date/time heuristics. If omitted, time of day can be checked against standard peak windows (07:00-09:30, 16:30-19:30).
- **Referral Code / Package Validation**: If `packageId` or `referralCode` is passed to `calculatePrice`, the service queries `Packages` and `Referrals`/`Users` tables to compute exact dollar discounts.

---

## 4. Conclusion

The technical architecture and complete implementation blueprint for Milestone M2 (Bookings & Pricing Engine) are defined in `analysis.md`. The design fulfills all requirements of `ORIGINAL_REQUEST.md`, `SCOPE.md`, and `PROJECT.md`, while remaining 100% compliant with existing tier 1-4 tests.

### Required Files to Build in Implementation Phase:
1. `src/v1/exceptions/conflict.ts`: `ConflictException` (HTTP 409).
2. `src/v1/schemas/booking.schema.ts`: Zod validation schemas.
3. `src/v1/services/pricing.service.ts`: Pricing calculation engine.
4. `src/v1/services/booking.service.ts`: Booking creation, double-booking lock, state machine, waitlist promotion.
5. `src/v1/controllers/booking.controller.ts`: Express controllers.
6. `src/v1/routes/booking.routes.ts`: Booking routes.
7. `src/v1/routes/index.ts`: Mounting booking router under `/bookings`.

---

## 5. Verification Method

To verify the blueprint implementation:
1. **Compilation Check**: Run `npx tsc --noEmit` from project root (`C:/Projects/Mishwarak-backend`). Must return 0 errors.
2. **Master Test Runner**: Run `npx ts-node tests/infra/run-all.ts`.
   - All tests in `tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts` must pass.
   - All tests in `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts` must pass.
