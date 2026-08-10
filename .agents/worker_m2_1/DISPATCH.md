## 2026-08-10T07:55:00Z
You are a Worker subagent for Milestone M2: Bookings & Pricing Core Engine with Double-Booking Protection.
Your assigned working directory: C:/Projects/Mishwarak-backend/.agents/worker_m2_1/

Scope & Context Files:
- Original Request: C:/Projects/Mishwarak-backend/ORIGINAL_REQUEST.md
- Project Spec: C:/Projects/Mishwarak-backend/PROJECT.md
- Milestone M2 Scope: C:/Projects/Mishwarak-backend/.agents/sub_orch_m2_gen2/SCOPE.md
- Explorer 1 Report (Pricing Engine): C:/Projects/Mishwarak-backend/.agents/explorer_m2_1/handoff.md
- Explorer 2 Report (Booking & Concurrency): C:/Projects/Mishwarak-backend/.agents/explorer_m2_2/handoff.md
- Explorer 3 Report (Cancellation & Routes): C:/Projects/Mishwarak-backend/.agents/explorer_m2_3/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implementation Tasks:
1. Pricing Engine (`src/v1/services/pricing.service.ts`):
   - Implement `calculatePrice(dto: CalculatePriceDTO)`:
     - Base price per vehicle category.
     - Distance price: `distanceKm * pricePerKm`.
     - Duration price: `durationHours * pricePerHour`.
     - Surge multiplier for peak hours.
     - Package discount percentage (`discountPercentage`) if valid `packageId` supplied.
     - Referral discount if valid `referralCode` supplied.
     - Deposit calculation: 20% of `totalPrice`.
     - Return complete `PriceBreakdown` structure.

2. Booking Core Service & State Machine + Concurrency Lock (`src/v1/services/booking.service.ts`):
   - State machine transitions for `BookingStatus` (`PENDING` -> `CONFIRMED` -> `COMPLETED` / `CANCELLED`) and `TripStatus` (`NOTSTARTED` -> `EN_ROUTE` -> `ARRIVED` -> `COMPLETED`). Valid transitions only; reject invalid transitions with standard `HttpException` (400 Bad Request).
   - Atomic double-booking protection within `prisma.$transaction`:
     - Overlap check for `vehicleId` and `driverId` on `bookingDate` (YYYY-MM-DD) and time range `[startTime, endTime]` (overlap formula: `newStart < existingEnd AND newEnd > existingStart`).
     - Check `VehicleAvailability` records (`BOOKED`/`BLOCKED`) and active `Bookings`.
     - Return clean HTTP 409 Conflict if double-booking detected.
     - Create/update `VehicleAvailability` to `BOOKED` linked to `bookingId`.
   - Cancellation & Waitlist Promotion Engine:
     - On cancel: set `BookingStatus` to `CANCELLED`, release `VehicleAvailability` back to `AVAILABLE`.
     - Query `Waitlist` table for top position customer waiting for matching vehicle/date; update waitlist status to `NOTIFIED` and trigger scheduled notification.

3. Controllers & Routes (`src/v1/controllers/booking.controller.ts`, `src/v1/routes/booking.routes.ts`):
   - `POST /api/v1/bookings/calculate-price`
   - `POST /api/v1/bookings`
   - `GET /api/v1/bookings`
   - `GET /api/v1/bookings/:id`
   - `PATCH /api/v1/bookings/:id/status`
   - `PATCH /api/v1/bookings/:id/trip-status`
   - `POST /api/v1/bookings/:id/cancel`
   - Attach middleware (`authenticateToken`, `validateRequest`).
   - Register routes in `src/app.ts`.

Verification Commands to execute:
1. Run `npx tsc --noEmit` and confirm 0 errors.
2. Run `npx tsx tests/infra/run-all.ts` and confirm all test suites pass.

Deliverables:
- Write implementation changes to target files.
- Document changes in `C:/Projects/Mishwarak-backend/.agents/worker_m2_1/changes.md`.
- Produce structured `C:/Projects/Mishwarak-backend/.agents/worker_m2_1/handoff.md` with build/test command outputs.
- Send a completion message to the parent orchestrator.
