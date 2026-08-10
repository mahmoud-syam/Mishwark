# Analysis Report: Booking Service, State Machine & Double-Booking Protection (Milestone M2)

**Author:** Explorer Agent (`explorer_m2_2`)  
**Target Module:** `src/v1/services/booking.service.ts` & Related Booking Engine Components  
**Date:** 2026-08-10  

---

## 1. Executive Summary

This investigation analyzed the Booking Service, State Machine transitions, and Double-Booking Protection mechanism in the Mishwark backend for Milestone M2. 

Key Findings:
1. **Booking Service (`src/v1/services/booking.service.ts`)** is already fully structured with state machine validation functions (`isValidBookingTransition`, `isValidTripTransition`), atomic Prisma transaction locking (`prisma.$transaction`), double-booking slot overlap detection (`checkSlotOverlap`), price breakdown integration with `PricingService`, and waitlist promotion upon cancellation.
2. **Error Handling Architecture**: Invalid state machine transitions throw `BadRequestException` (translates to HTTP 400 Bad Request via `HttpException`). Double-booking collisions throw `ConflictException` (translates to HTTP 409 Conflict).
3. **Route Integration**: `src/v1/controllers/booking.controller.ts` is present, but `src/v1/routes/booking.routes.ts` is currently missing and needs to be created and mounted onto `src/v1/routes/index.ts` under `/bookings`.
4. **Verification Status**: TypeScript compilation (`npx tsc --noEmit`) compiles cleanly with 0 errors. All 218 test cases across 10 test suites (`npx tsx tests/infra/run-all.ts`) currently pass.

---

## 2. Booking State Machine & Transition Rules

### 2.1 BookingStatus State Machine
The `BookingStatus` enum represents the overarching lifecycle of a booking:
```
PENDING ───► CONFIRMED ───► COMPLETED
   │              │
   ▼              ▼
CANCELLED      CANCELLED
```

- **Allowed Transitions**:
  - `PENDING` -> `CONFIRMED`, `CANCELLED`
  - `CONFIRMED` -> `COMPLETED`, `CANCELLED`
  - `COMPLETED` -> None (terminal state)
  - `CANCELLED` -> None (terminal state)

- **Implementation in Code**:
  ```typescript
  export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
    const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
      [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
      [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
      [BookingStatus.COMPLETED]: [],
      [BookingStatus.CANCELLED]: [],
    };
    return allowedTransitions[from]?.includes(to) ?? false;
  }
  ```

### 2.2 TripStatus State Machine
The `TripStatus` enum tracks real-time trip execution progress by drivers:
```
NOTSTARTED ───► INPROGRESS ───► ARRIVED ───► COMPLETED
```

- **Allowed Transitions**:
  - `NOTSTARTED` -> `INPROGRESS`
  - `INPROGRESS` -> `ARRIVED`, `COMPLETED`
  - `ARRIVED` -> `COMPLETED`
  - `COMPLETED` -> None (terminal state)

- **Implementation in Code**:
  ```typescript
  export function isValidTripTransition(from: TripStatus, to: TripStatus): boolean {
    const allowedTransitions: Record<TripStatus, TripStatus[]> = {
      [TripStatus.NOTSTARTED]: [TripStatus.INPROGRESS],
      [TripStatus.INPROGRESS]: [TripStatus.ARRIVED, TripStatus.COMPLETED],
      [TripStatus.ARRIVED]: [TripStatus.COMPLETED],
      [TripStatus.COMPLETED]: [],
    };
    return allowedTransitions[from]?.includes(to) ?? false;
  }
  ```

- **Validation & Exception Handling**:
  - Invalid transitions raise `BadRequestException` (`statusCode: 400`).
  - Attempting trip updates on a `CANCELLED` booking raises `BadRequestException` ("Cannot update trip status on a cancelled booking").
  - Role check prevents customer/rider accounts from calling trip status updates (`ForbiddenException`, HTTP 403).
  - When `TripStatus` reaches `COMPLETED`, `BookingStatus` automatically transitions to `COMPLETED`.

---

## 3. Double-Booking Protection & Concurrency Locking

Double-booking protection is executed within an atomic `prisma.$transaction` block to ensure concurrency safety.

### 3.1 Overlap Detection Algorithm
Time slot overlap between requested slot `[newStart, newEnd]` and existing slot `[existingStart, existingEnd]` uses the standard interval overlap formula:
$$\text{Overlap} \iff \text{newStart} < \text{existingEnd} \land \text{newEnd} > \text{existingStart}$$

Code Implementation (`checkSlotOverlap`):
```typescript
export function checkSlotOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const toMins = (t: string) => {
    if (!t) return 0;
    const parts = t.split(":");
    const h = parseInt(parts[0] || "0", 10);
    const m = parseInt(parts[1] || "0", 10);
    return h * 60 + m;
  };
  const sA = toMins(startA);
  const eA = toMins(endA);
  const sB = toMins(startB);
  const eB = toMins(endB);
  return sA < eB && sB < eA;
}
```

#### Overlap Matrix Verification
| Existing Window | Requested Window | Mathematical Condition | Result | Behavior |
|---|---|---|---|---|
| 10:00 - 12:00 | 10:00 - 12:00 | 10:00 < 12:00 AND 10:00 < 12:00 | `true` | Overlap (Conflict 409) |
| 09:30 - 11:30 | 10:00 - 12:00 | 10:00 < 11:30 AND 09:30 < 12:00 | `true` | Overlap (Conflict 409) |
| 10:30 - 12:30 | 10:00 - 12:00 | 10:00 < 12:30 AND 10:30 < 12:00 | `true` | Overlap (Conflict 409) |
| 08:00 - 14:00 | 10:00 - 12:00 | 10:00 < 14:00 AND 08:00 < 12:00 | `true` | Overlap (Conflict 409) |
| 08:00 - 10:00 | 10:00 - 12:00 | 10:00 < 10:00 AND 08:00 < 12:00 | `false` | Allowed (Adjacent) |

### 3.2 Atomic Locking Sequence (`BookingService.createBooking`)
1. **Vehicle Validation**: Checks `vehicles.findUnique`. If vehicle status is `MAINTENANCE`, throws `BadRequestException(400)`.
2. **Driver Validation**: Validates driver status if provided. If driver is `OFF` or `ONLEAVE`, throws `BadRequestException(400)`. If unassigned, attempts auto-assignment of an `ACTIVE` driver.
3. **Vehicle Availability Record Check**: Checks `vehicleAvailability` for date `normalizedDate` (`YYYY-MM-DDT00:00:00.000Z`). If status is `BOOKED` or `BLOCKED`, checks for collision.
4. **Active Bookings Search**: Queries `bookings` table for `bookingDate` where `status != CANCELLED` and `(vehicleId = X OR driverId = Y)`.
5. **Time Slot Overlap Check**: Iterates through existing bookings with `checkSlotOverlap`. If overlap is detected, throws `ConflictException(409)`.
6. **Booking Creation & Row Lock**: Creates new `Bookings` record with pricing breakdown.
7. **Availability Update**: Upserts `VehicleAvailability` record setting `status = AvailabilityStatus.BOOKED` and linking `bookingId`.

---

## 4. Booking Cancellation & Waitlist Promotion Engine

When `BookingService.cancelBooking(bookingId)` is executed inside `prisma.$transaction`:

1. **Idempotency & State Validation**:
   - If booking is already `CANCELLED`, returns immediately without error.
   - If status transition to `CANCELLED` is invalid (e.g. from `COMPLETED`), throws `BadRequestException(400)`.
2. **Resource Release**:
   - Updates `Bookings` status to `CANCELLED`.
   - Releases `VehicleAvailability` record back to `AVAILABLE` (clears `bookingId`).
   - If assigned driver had status `ONTRIP`, resets driver status back to `ACTIVE`.
3. **Waitlist Query & Promotion**:
   - Queries `Waitlist` table where `vehicleId = X`, `requestedDate = date`, `status = WAITING`, sorted by `position ASC`.
   - Filters out corrupt entries (`customerId != null`, `position > 0`).
   - Promotes top entry: updates status to `NOTIFIED`, sets `notifiedAt = now`, `expiresAt = now + 24h`.
   - Queues a push notification in `ScheduledNotifications` for the promoted customer.

---

## 5. Controller & Route Wiring Architecture

### 5.1 Endpoints Specification

| Method | Endpoint Path | Controller Function | Auth Required | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/bookings/calculate-price` | `calculatePrice` | Optional | Public/Authenticated price estimate |
| `POST` | `/api/v1/bookings` | `createBooking` | Required | Create booking with double-booking check |
| `GET` | `/api/v1/bookings` | `getBookings` | Required | List user/driver bookings with pagination & filters |
| `GET` | `/api/v1/bookings/:id` | `getBookingById` | Required | Get booking details by ID |
| `PATCH` | `/api/v1/bookings/:id/status` | `updateBookingStatus` | Required | Update booking status (`PENDING` -> `CONFIRMED`, etc.) |
| `PATCH` | `/api/v1/bookings/:id/trip-status` | `updateTripStatus` | Required | Update trip status (`NOTSTARTED` -> `INPROGRESS`, etc.) |
| `POST` | `/api/v1/bookings/:id/cancel` | `cancelBooking` | Required | Cancel booking & trigger waitlist promotion |

### 5.2 Required Implementation Task: `booking.routes.ts`
`src/v1/routes/booking.routes.ts` needs to be created:
```typescript
import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  calculatePrice,
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  updateTripStatus,
  cancelBooking,
} from "../controllers/booking.controller";

const bookingRouterV1: Router = Router();

bookingRouterV1.post("/calculate-price", errorHandler(calculatePrice));
bookingRouterV1.post("/", authMiddleware, errorHandler(createBooking));
bookingRouterV1.get("/", authMiddleware, errorHandler(getBookings));
bookingRouterV1.get("/:id", authMiddleware, errorHandler(getBookingById));
bookingRouterV1.patch("/:id/status", authMiddleware, errorHandler(updateBookingStatus));
bookingRouterV1.patch("/:id/trip-status", authMiddleware, errorHandler(updateTripStatus));
bookingRouterV1.post("/:id/cancel", authMiddleware, errorHandler(cancelBooking));

export default bookingRouterV1;
```

And mounted into `src/v1/routes/index.ts`:
```typescript
import bookingRouterV1 from "./booking.routes";
rootRouterV1.use("/bookings", bookingRouterV1);
```

---

## 6. Proposed Implementation Strategy

1. **Step 1: Route Creation & Wireup**
   - Create `src/v1/routes/booking.routes.ts` with all 7 endpoints wrapped with `errorHandler` and `authMiddleware`.
   - Mount `bookingRouterV1` in `src/v1/routes/index.ts`.

2. **Step 2: Service Verification**
   - Verify `src/v1/services/booking.service.ts` error handling matches `HttpException` status codes (400 for bad transitions/validation, 409 for double bookings, 404 for missing resources, 403 for role violations).

3. **Step 3: Verification Execution**
   - Run `npx tsc --noEmit` to ensure zero compilation errors.
   - Run `npx tsx tests/infra/run-all.ts` to confirm all 218 test cases across all tiers pass.
