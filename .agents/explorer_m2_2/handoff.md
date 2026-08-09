# Handoff Report: Booking State Machine, Double-Booking Protection & Concurrency Locks (M2 Explorer 2)

## 1. Observation
1. **Prisma Models & Enums Inspected**:
   - `prisma/models/bookings.prisma` (lines 1–53): Defines `Bookings` model with `@@unique([vehicleId, bookingDate, startTime])`. Fields `status` (`BookingStatus`: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`) and `tripStatus` (`TripStatus`: `NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED`).
   - `prisma/models/enums.prisma` (lines 29–41): Enum `BookingStatus` has `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`. Enum `TripStatus` has `NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED`. *(Note: Enum value in database schema is `INPROGRESS`, mapping to `EN_ROUTE` referenced in functional requirements).*
   - `prisma/models/vehicles.prisma` (lines 45–58): `VehicleAvailability` model with `@@unique([vehicleId, date])` where `date` is `DateTime`. Statuses: `AVAILABLE`, `BOOKED`, `BLOCKED`.
   - `prisma/models/waitlist.prisma` (lines 1–18): `Waitlist` model with `requestedDate` (`String`), `requestedTime` (`String?`), `position` (`Int`), `status` (`WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`), `notifiedAt`, `expiresAt`.
   - `prisma/models/notifications.prisma` (lines 1–18): `ScheduledNotifications` model with `bookingId`, `recipientId`, `recipientType`, `notificationType`, `channel`, `scheduledAt`, `status`.

2. **Existing Core Application Structure**:
   - `src/v1/exceptions/root.ts` (lines 4–17): Base `HttpException` class.
   - `src/v1/exceptions/bad-requests.ts` (lines 1–7): `BadRequestsException` (400).
   - `src/v1/exceptions/not-found.ts` (lines 1–7): `NotFoundException` (404).
   - `src/v1/utils/prismaClientHelper.ts` (lines 1–12): Exports singleton `prismaClient`.

3. **Test Specs Inspected**:
   - `tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts`: Defines reference calculators `calculateEstimatedPrice`, `checkSlotOverlap`, `isValidBookingTransition`, `isValidTripTransition`, and tests `F4-T1-01` through `F7-T1-24`.
   - `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts`: Tests edge cases `F4-T2-01` through `F7-T2-24` including zero/negative pricing inputs, overlap window boundaries (nested, partial, adjacent), cancelled trip updates, and waitlist promotion edge cases.

---

## 2. Logic Chain
1. **Double-Booking & Concurrency Protection**:
   - Observation: DB constraint `@@unique([vehicleId, bookingDate, startTime])` only catches exact identical start time collisions for vehicles. It does not catch overlapping windows (e.g. 09:30–11:30 vs 10:00–12:00) or driver schedule collisions.
   - Logic Step: Double-booking prevention must be enforced dynamically inside an atomic `prisma.$transaction`.
   - Logic Step: Overlap check logic `(startA < endB && startB < endA)` must query existing non-cancelled bookings for both `vehicleId` and `driverId` on `bookingDate`.
   - Logic Step: In addition, `VehicleAvailability` records for the date must be checked for `BOOKED` or `BLOCKED` status.
   - Conclusion: Any collision during transaction throws `ConflictException` (HTTP 409 Conflict), rolling back the transaction immediately.

2. **State Machine Integrity**:
   - Observation: `BookingStatus` can transition `PENDING -> CONFIRMED -> COMPLETED/CANCELLED`. `TripStatus` can transition `NOTSTARTED -> INPROGRESS -> ARRIVED -> COMPLETED`.
   - Logic Step: Invalid status transitions must be blocked by explicit state machine guard functions (`isValidBookingTransition` and `isValidTripTransition`), throwing `BadRequestsException` (400 Bad Request).
   - Logic Step: Attempting to update `TripStatus` when `BookingStatus === CANCELLED` must be blocked.
   - Logic Step: Updating `TripStatus` requires `DRIVER` (assigned) or `ADMIN` role; unauthorized users receive `403 Forbidden`.

3. **Cancellation & Waitlist Promotion Flow**:
   - Observation: `Waitlist` queue holds customer requests for booked vehicles ordered by `position ASC`.
   - Logic Step: Upon cancelling a booking in `prisma.$transaction`, the booking status is set to `CANCELLED` and `VehicleAvailability` status is reset to `AVAILABLE`.
   - Logic Step: The top waitlist entry (`status = WAITING`, `position > 0`, `customerId != null`) is queried ordered by `position ASC`.
   - Logic Step: If found, the entry status is updated to `NOTIFIED`, `notifiedAt` set to `now()`, `expiresAt` set to 24h from now, and a `ScheduledNotifications` record is inserted with `status = SCHEDULED`.

---

## 3. Caveats
- **Trip Status Enum Alignment**: `enums.prisma` uses `INPROGRESS` while some design docs use `EN_ROUTE`. Service code should handle or map `EN_ROUTE` to `INPROGRESS` cleanly.
- **Date Normalization**: `VehicleAvailability.date` is a `DateTime` object while `Bookings.bookingDate` is a `YYYY-MM-DD` string. All dates queried against `VehicleAvailability` must normalize `bookingDate` to UTC midnight (`YYYY-MM-DDT00:00:00.000Z`).
- **Pessimistic Locking**: `prisma.$transaction` provides atomic isolation; Postgres will serialize concurrent upserts on `VehicleAvailability`'s unique index `@@unique([vehicleId, date])`.

---

## 4. Conclusion
The detailed technical architecture, state transition rules, double-booking transaction sequence, and waitlist promotion logic for M2 are fully documented in `analysis.md`. The proposed implementation blueprints provide exact guidance for creating `ConflictException` (409), `booking.schema.ts`, `booking.service.ts`, `booking.controller.ts`, and `booking.routes.ts`.

---

## 5. Verification Method
To independently verify the architecture and readiness for implementation:
1. **File Inspection**:
   - `view_file` on `prisma/models/bookings.prisma`, `vehicles.prisma`, `waitlist.prisma`, `enums.prisma`.
   - `view_file` on `C:/Projects/Mishwarak-backend/.agents/explorer_m2_2/analysis.md`.
2. **TypeScript & Schema Compilation Check**:
   - Execute `npx tsc --noEmit` from working directory to confirm zero existing TypeScript errors.
3. **Test Suite Verification**:
   - `npx ts-node tests/infra/run-all.ts` to execute master test suite.
