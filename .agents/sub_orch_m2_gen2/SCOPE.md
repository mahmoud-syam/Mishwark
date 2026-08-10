# Scope: Milestone M2 — Bookings & Pricing Core Engine with Double-Booking Protection

## Objectives
1. **Pricing Calculation Engine** (`src/v1/services/pricing.service.ts`):
   - Calculate trip estimates: Base price, distance price (distanceKm * pricePerKm), duration price (hours * pricePerHour), surge multiplier for peak hours.
   - Support discounts for package bookings (`discountPercentage`) and valid referral codes.
   - Deposit calculation logic (20% deposit requirement).

2. **Booking Core Service & State Machine** (`src/v1/services/booking.service.ts`):
   - Implement complete state machine transitions:
     - `BookingStatus`: `PENDING` -> `CONFIRMED` -> `COMPLETED` / `CANCELLED`
     - `TripStatus`: `NOTSTARTED` -> `EN_ROUTE` -> `ARRIVED` -> `COMPLETED`
   - Require valid state transitions only; reject invalid transitions with standard HttpException (400 Bad Request).

3. **Double-Booking Protection & Concurrency Locking**:
   - Must execute within atomic `prisma.$transaction`.
   - Overlap detection algorithm for date `YYYY-MM-DD` and time range `[startTime, endTime]`:
     - Check `VehicleAvailability` where `vehicleId = X` AND `date = bookingDate` AND `status = BOOKED`/`BLOCKED`.
     - Check existing `Bookings` for vehicle AND driver where `status NOT IN (CANCELLED)` and time windows overlap `(newStart < existingEnd AND newEnd > existingStart)`.
   - Update/Create `VehicleAvailability` record to `status = BOOKED` linked to `bookingId`.
   - Lock driver availability if assigned.
   - Return clean HTTP 409 Conflict if double-booking is detected.

4. **Booking Cancellation & Waitlist Promotion Engine**:
   - Upon cancellation: update `BookingStatus` to `CANCELLED`, release `VehicleAvailability` record back to `AVAILABLE`.
   - Query `Waitlist` table for top position customer waiting for matching vehicle/date; update waitlist status to `NOTIFIED` and trigger scheduled notification.

5. **Controllers & Routes**:
   - `src/v1/controllers/booking.controller.ts`
   - `src/v1/routes/booking.routes.ts`
   - Attach middleware (`authenticateToken`, `validateRequest`).
   - Endpoints:
     - `POST /api/v1/bookings/calculate-price` (Public/Authenticated price estimate)
     - `POST /api/v1/bookings` (Create booking with double-booking check)
     - `GET /api/v1/bookings` (List user/driver bookings with pagination & filters)
     - `GET /api/v1/bookings/:id` (Get booking details)
     - `PATCH /api/v1/bookings/:id/status` (Update booking status)
     - `PATCH /api/v1/bookings/:id/trip-status` (Update trip status)
     - `POST /api/v1/bookings/:id/cancel` (Cancel booking & trigger waitlist promotion)

## Verification
- Must run `npx tsc --noEmit` cleanly with 0 errors.
- Must execute E2E test runner (`npx tsx tests/infra/run-all.ts`) and verify all booking/pricing tests pass.
- Must execute 2x Reviewers, 2x Challengers, and Forensic Auditor verification.
