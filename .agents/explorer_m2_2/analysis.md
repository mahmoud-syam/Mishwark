# Technical Analysis: Booking State Machine, Double-Booking Prevention & Concurrency Locks (Milestone M2 - Explorer 2)

## Executive Summary
This technical analysis covers the design, rules, edge cases, and concurrency mechanisms required for the **Booking State Machine**, **Double-Booking Prevention Engine**, and **Waitlist Promotion Logic** for Milestone M2 (Bookings & Pricing Core Engine) of the Mishwark Backend platform.

Key findings:
1. **Prisma Models & Enum Constraints**:
   - `Bookings`: Has `@@unique([vehicleId, bookingDate, startTime])`. Contains `status` (`BookingStatus`: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`) and `tripStatus` (`TripStatus`: `NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED`).
   - *Enum Reconciliation*: The Prisma schema enum value for trip status is `INPROGRESS` (in `prisma/models/enums.prisma`). API interfaces expecting `EN_ROUTE` must map transparently to `INPROGRESS` or accept `INPROGRESS`.
   - `VehicleAvailability`: Has `@@unique([vehicleId, date])` where `date` is a `DateTime` (normalized to midnight UTC `YYYY-MM-DDT00:00:00.000Z`).
   - `Waitlist`: Contains `requestedDate` (`String`), `requestedTime` (`String?`), `position` (`Int`), `status` (`WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`), `notifiedAt` (`DateTime?`), and `expiresAt` (`DateTime?`).

2. **Concurrency & Double-Booking Prevention**:
   - Database unique index `@@unique([vehicleId, bookingDate, startTime])` prevents exact duplicate start times, but **does not** prevent partial window overlaps (e.g. 09:30-11:30 vs 10:00-12:00) or driver scheduling conflicts.
   - All booking creations must execute inside an atomic `prisma.$transaction` with a two-tier overlap check:
     - Tier 1: Check `VehicleAvailability` where `status IN ('BOOKED', 'BLOCKED')` for the target `bookingDate`.
     - Tier 2: Query non-cancelled `Bookings` for both `vehicleId` and `driverId` on `bookingDate`, applying time window overlap logic (`newStart < existingEnd AND existingStart < newEnd`).
   - Any collision triggers an immediate rollback and returns **HTTP 409 Conflict**.

3. **Cancellation & Waitlist Promotion Engine**:
   - Cancelling a booking updates `BookingStatus` to `CANCELLED` and resets `VehicleAvailability` to `AVAILABLE`.
   - Automatically queries the `Waitlist` queue for `vehicleId` and `requestedDate` ordered by `position ASC`, updates the top `WAITING` entry to `NOTIFIED`, sets `expiresAt` (24h claim window), and queues a `ScheduledNotifications` record.

---

## 1. Codebase & Prisma Models Audit

### 1.1 Prisma Schema & Field Definitions

#### `Bookings` Model (`prisma/models/bookings.prisma`)
```prisma
model Bookings {
  id             String    @id @default(uuid())
  customerId     String
  vehicleId      String
  driverId       String
  packageId      String?
  eventType      String    @default("")
  startPoint     String    @default("")
  endPoint       String    @default("")
  routeWaypoints Json?
  distanceKm     Float     @default(0)
  bookingDate    String    @default("") // YYYY-MM-DD
  startTime      String    @default("") // HH:mm
  endTime        String    @default("") // HH:mm

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

  @@unique([vehicleId, bookingDate, startTime])
}
```

#### `VehicleAvailability` Model (`prisma/models/vehicles.prisma`)
```prisma
model VehicleAvailability {
  id        String             @id @default(uuid())
  vehicleId String
  date      DateTime           // Midnight UTC Date
  status    AvailabilityStatus @default(AVAILABLE) // AVAILABLE, BOOKED, BLOCKED
  reason    String             @default("")
  bookingId String?
  createdAt DateTime           @default(now())
  updatedAt DateTime           @default(now()) @updatedAt

  @@unique([vehicleId, date])
}
```

#### `Waitlist` Model (`prisma/models/waitlist.prisma`)
```prisma
model Waitlist {
  id            String         @id @default(uuid())
  customerId    String
  vehicleId     String
  bookingId     String?
  requestedDate String         // YYYY-MM-DD
  requestedTime String?        // HH:mm
  position      Int            @default(1)
  status        WaitlistStatus @default(WAITING) // WAITING, NOTIFIED, CONVERTED, EXPIRED
  notifiedAt    DateTime?
  expiresAt     DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @default(now()) @updatedAt
}
```

#### `Drivers` Model (`prisma/models/users.prisma`)
```prisma
model Drivers {
  id            String       @id @default(uuid())
  userId        String       @unique
  fullName      String       @default("")
  status        DriverStatus @default(ACTIVE) // ACTIVE, OFF, ONTRIP, ONLEAVE
}
```

---

## 2. Booking State Machine & Trip Workflow

### 2.1 `BookingStatus` State Machine
The `BookingStatus` tracks the commercial lifecycle of a booking.

#### State Definitions
- `PENDING`: Initial state upon creation. Booking is registered; payment may be UNPAID or PARTIALLY_PAID.
- `CONFIRMED`: Deposit/payment acknowledged, driver and vehicle allocated and locked.
- `COMPLETED`: Trip finished successfully and finalized. (Terminal state).
- `CANCELLED`: Booking cancelled by customer or admin. (Terminal state).

#### Transition Matrix & Guard Rules
| From State | Allowed Target States | Invalid Target States | Guard Condition / Rule |
|---|---|---|---|
| `PENDING` | `CONFIRMED`, `CANCELLED` | `COMPLETED` | Cannot skip confirmation step |
| `CONFIRMED` | `COMPLETED`, `CANCELLED` | `PENDING` | Cannot revert to pending |
| `COMPLETED` | *None* | `PENDING`, `CONFIRMED`, `CANCELLED` | Terminal state; throws 400 Bad Request |
| `CANCELLED` | *None* | `PENDING`, `CONFIRMED`, `COMPLETED` | Terminal state; throws 400 Bad Request |

#### Validation Implementation Reference
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

### 2.2 `TripStatus` State Machine
The `TripStatus` tracks operational execution of the trip by the driver.

#### State Definitions & Enum Mapping Reconciliation
- `NOTSTARTED`: Driver has not yet departed for pickup.
- `INPROGRESS`: Driver is en route or trip is active. *(Note: `INPROGRESS` is the canonical Prisma enum value defined in `enums.prisma`; API requests passing `EN_ROUTE` must be mapped to `INPROGRESS`).*
- `ARRIVED`: Driver has arrived at pickup location.
- `COMPLETED`: Customer dropped off and trip completed. (Terminal state).

#### Transition Matrix & Guard Rules
| From State | Allowed Target States | Invalid Target States | Guard Condition / Rule |
|---|---|---|---|
| `NOTSTARTED` | `INPROGRESS` | `ARRIVED`, `COMPLETED` | Must start trip first |
| `INPROGRESS` | `ARRIVED`, `COMPLETED` | `NOTSTARTED` | Cannot move backward |
| `ARRIVED` | `COMPLETED` | `NOTSTARTED`, `INPROGRESS` | Terminal step before completion |
| `COMPLETED` | *None* | All states | Terminal state |

#### Cancellation & Role Boundaries
1. **Cancelled Booking Boundary**: Trip status transitions are strictly forbidden if `BookingStatus === CANCELLED`. Any attempt to advance trip status on a cancelled booking must return **400 Bad Request**.
2. **Authorization Boundary**: Updating `TripStatus` requires Driver (assigned to the booking) or Admin credentials (`DRIVER` or `ADMIN` role). Rider tokens attempting `PATCH /driver/bookings/:id/trip-status` must be rejected with **403 Forbidden**.

#### Validation Implementation Reference
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

---

## 3. Double-Booking Prevention & Concurrency Locking

### 3.1 Time Window Overlap Algorithm
Time slots are represented as `HH:mm` strings (24-hour clock).
To determine if two intervals `[startA, endA]` and `[startB, endB]` overlap:

```typescript
export function checkSlotOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const toMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const sA = toMins(startA);
  const eA = toMins(endA);
  const sB = toMins(startB);
  const eB = toMins(endB);
  return sA < eB && sB < eA;
}
```

#### Overlap Matrix Examples
- **Exact Collision** (`10:00-12:00` vs `10:00-12:00`): `10:00 < 12:00` AND `10:00 < 12:00` -> **OVERLAP (Blocked)**
- **Partial Start Collision** (`09:30-11:30` vs `10:00-12:00`): `09:30 < 12:00` AND `10:00 < 11:30` -> **OVERLAP (Blocked)**
- **Partial End Collision** (`10:30-12:30` vs `10:00-12:00`): `10:30 < 12:00` AND `10:00 < 12:30` -> **OVERLAP (Blocked)**
- **Enclosing Collision** (`08:00-14:00` vs `10:00-12:00`): `08:00 < 12:00` AND `10:00 < 14:00` -> **OVERLAP (Blocked)**
- **Adjacent Touch Boundary** (`08:00-10:00` vs `10:00-12:00`): `08:00 < 12:00` (true) BUT `10:00 < 10:00` (false) -> **NO OVERLAP (Allowed)**

### 3.2 Atomic Concurrency Check Sequence in `prisma.$transaction`

To guarantee 100% thread safety and prevent race conditions under high concurrent traffic:

```typescript
export async function createBookingWithDoubleBookingProtection(
  tx: PrismaTransaction,
  params: CreateBookingParams
) {
  const { customerId, vehicleId, driverId, bookingDate, startTime, endTime } = params;

  // 1. Check Vehicle Existence & Maintenance Status
  const vehicle = await tx.vehicles.findUnique({ where: { id: vehicleId } });
  if (!vehicle) {
    throw new NotFoundException("Vehicle not found", ErrorCodes.SERVICE_NOT_FOUND);
  }
  if (vehicle.status === VehicleStatus.MAINTENANCE) {
    throw new BadRequestsException("Vehicle is currently under maintenance", ErrorCodes.UNPROCESSABLE_ENTITY);
  }

  // 2. Check Driver Existence & Active Status
  const driver = await tx.drivers.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundException("Driver not found", ErrorCodes.USER_NOT_FOUND);
  }
  if (driver.status === DriverStatus.OFF || driver.status === DriverStatus.ONLEAVE) {
    throw new BadRequestsException(`Driver is currently ${driver.status.toLowerCase()}`, ErrorCodes.UNPROCESSABLE_ENTITY);
  }

  // 3. VehicleAvailability Calendar Check for Date
  const dateObj = new Date(`${bookingDate}T00:00:00.000Z`);
  const availability = await tx.vehicleAvailability.findFirst({
    where: {
      vehicleId,
      date: dateObj,
      status: { in: [AvailabilityStatus.BOOKED, AvailabilityStatus.BLOCKED] },
    },
  });

  if (availability) {
    throw new ConflictException("Vehicle is already booked or blocked for this date");
  }

  // 4. Query Existing Active Bookings for Vehicle OR Driver on bookingDate
  const existingBookings = await tx.bookings.findMany({
    where: {
      bookingDate,
      status: { not: BookingStatus.CANCELLED },
      OR: [{ vehicleId }, { driverId }],
    },
  });

  // 5. Evaluate Time Slot Overlaps
  for (const existing of existingBookings) {
    if (checkSlotOverlap(startTime, endTime, existing.startTime, existing.endTime)) {
      if (existing.vehicleId === vehicleId) {
        throw new ConflictException("Double booking collision: Vehicle is already booked for this time window");
      }
      if (existing.driverId === driverId) {
        throw new ConflictException("Double booking collision: Driver is already assigned to another trip in this time window");
      }
    }
  }

  // 6. Calculate Price Server-Side
  const pricing = calculateEstimatedPrice({
    vehicleCategory: vehicle.category,
    customBasePrice: vehicle.basePrice,
    customPricePerKm: vehicle.pricePerKm,
    customPricePerHour: vehicle.pricePerHour,
    distanceKm: params.distanceKm,
    durationMinutes: params.durationMinutes,
  });

  // 7. Create Booking Record
  const newBooking = await tx.bookings.create({
    data: {
      customerId,
      vehicleId,
      driverId,
      packageId: params.packageId || null,
      eventType: params.eventType || "",
      startPoint: params.startPoint || "",
      endPoint: params.endPoint || "",
      routeWaypoints: params.routeWaypoints || null,
      distanceKm: params.distanceKm,
      bookingDate,
      startTime,
      endTime,
      status: BookingStatus.PENDING,
      tripStatus: TripStatus.NOTSTARTED,
      basePrice: pricing.basePrice,
      distancePrice: pricing.distancePrice,
      totalPrice: pricing.totalPrice,
      depositPaid: pricing.depositPaid,
      paymentStatus: PaymentStatus.UNPAID,
      driverNotes: params.driverNotes || "",
      notes: params.notes || "",
    },
  });

  // 8. Upsert VehicleAvailability to BOOKED
  await tx.vehicleAvailability.upsert({
    where: {
      vehicleId_date: { vehicleId, date: dateObj },
    },
    update: {
      status: AvailabilityStatus.BOOKED,
      bookingId: newBooking.id,
    },
    create: {
      vehicleId,
      date: dateObj,
      status: AvailabilityStatus.BOOKED,
      bookingId: newBooking.id,
    },
  });

  return newBooking;
}
```

---

## 4. Cancellation Logic & Waitlist Promotion Engine

### 4.1 Cancellation Execution Workflow
When a customer or admin cancels a booking (`POST /api/v1/bookings/:id/cancel`):

1. **Precondition Validation**:
   - Fetch booking by ID. Throw `NotFoundException` (404) if not found.
   - Validate current `BookingStatus`: Must be `PENDING` or `CONFIRMED`.
   - If status is `COMPLETED` or `CANCELLED`, throw `BadRequestsException` (400) ("Booking cannot be cancelled from status COMPLETED/CANCELLED").

2. **Atomic Execution inside `prisma.$transaction`**:
   - Update `Booking.status` to `CANCELLED`.
   - Release `VehicleAvailability`: Reset status to `AVAILABLE` and `bookingId` to `null` for `(vehicleId, dateObj)`.
   - Reset Driver Status: If driver status was `ONTRIP`, update to `ACTIVE`.
   - **Waitlist Queue Query**:
     ```typescript
     const topWaitlistEntry = await tx.waitlist.findFirst({
       where: {
         vehicleId: booking.vehicleId,
         requestedDate: booking.bookingDate,
         status: WaitlistStatus.WAITING,
         customerId: { not: null },
         position: { gt: 0 },
       },
       orderBy: { position: 'asc' },
     });
     ```
   - **Promotion Action** (if top entry exists):
     - Update waitlist entry status to `NOTIFIED`.
     - Set `notifiedAt = new Date()`.
     - Set `expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)` (24-hour window to complete booking).
     - Create `ScheduledNotifications` record:
       ```typescript
       await tx.scheduledNotifications.create({
         data: {
           bookingId: booking.id,
           recipientId: topWaitlistEntry.customerId,
           recipientType: NotificationRecipientType.CUSTOMER,
           notificationType: NotificationType.SYSTEM,
           channel: NotificationChannel.PUSH,
           title: "Vehicle Available!",
           body: `A vehicle you requested for date ${booking.bookingDate} is now available. Book within 24 hours to secure your reservation.`,
           scheduledAt: new Date(),
           status: NotificationStatus.SCHEDULED,
         },
       });
       ```

### 4.2 Edge Case & Defensive Handling
- **Empty Waitlist**: If no waitlist entry matches, the transaction completes cleanly without error (`promotedWaitlistId: null`).
- **Corrupt / Invalid Waitlist Entries**: Query includes filters `customerId: { not: null }` and `position: { gt: 0 }` to avoid promoting malformed entries.
- **Idempotency**: Cancelling an already-cancelled booking returns 400 without re-triggering waitlist notifications.

---

## 5. Architectural Blueprints for Implementation Phase

To complete Milestone M2, the following modules must be created/updated in `src/v1/`:

### 5.1 New Exception Class (`src/v1/exceptions/conflict.ts`)
```typescript
import { ErrorCodes, HttpException } from "./root";

export class ConflictException extends HttpException {
    constructor(message: string, errorCode: ErrorCodes | number = ErrorCodes.UNPROCESSABLE_ENTITY, errors: any = null) {
        super(message, errorCode, 409, errors);
    }
}
```

### 5.2 Schemas (`src/v1/schemas/booking.schema.ts`)
Must define Zod schemas for:
- `EstimatePriceSchema`: `vehicleCategory`, `vehicleId`, `distanceKm`, `durationMinutes`, `isPeakHour`, `packageId`, `referralCode`.
- `CreateBookingSchema`: `vehicleId`, `driverId`, `bookingDate` (regex `^\d{4}-\d{2}-\d{2}$`), `startTime` (regex `^\d{2}:\d{2}$`), `endTime` (regex `^\d{2}:\d{2}$`), `startPoint`, `endPoint`, `distanceKm`, `durationMinutes`.
- `UpdateBookingStatusSchema`: `status` (`CONFIRMED`, `COMPLETED`, `CANCELLED`).
- `UpdateTripStatusSchema`: `tripStatus` (`INPROGRESS`, `ARRIVED`, `COMPLETED`).
- `BookingQuerySchema`: `customerId`, `driverId`, `status`, `tripStatus`, `date`, `page`, `limit`.

### 5.3 Service (`src/v1/services/booking.service.ts`)
Methods:
- `calculatePriceEstimate(dto: EstimatePriceDTO)`
- `createBooking(customerId: string, dto: CreateBookingDTO)`
- `getBookingById(id: string, user: AuthenticatedUser)`
- `listBookings(filter: BookingFilterDTO, page: number, limit: number)`
- `updateBookingStatus(id: string, status: BookingStatus, user: AuthenticatedUser)`
- `updateTripStatus(id: string, tripStatus: TripStatus, user: AuthenticatedUser)`
- `cancelBooking(id: string, user: AuthenticatedUser)`

### 5.4 Controller (`src/v1/controllers/booking.controller.ts`)
Wrapping service calls in Express standard handler patterns with `res.status(200|201).json(...)`.

### 5.5 Routes (`src/v1/routes/booking.routes.ts`)
Endpoints:
- `POST /api/v1/bookings/estimate-price`
- `POST /api/v1/bookings`
- `GET /api/v1/bookings`
- `GET /api/v1/bookings/:id`
- `PATCH /api/v1/bookings/:id/status`
- `PATCH /api/v1/bookings/:id/trip-status`
- `POST /api/v1/bookings/:id/cancel`

Router mounted in `src/v1/routes/index.ts` via `rootRouterV1.use("/bookings", bookingRouterV1)`.

---

## 6. Verification & Test Suite Compliance Matrix

All design decisions align directly with test assertions in:
1. `tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts`
2. `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts`

| Test Case | Objective Verified | Implementation Strategy |
|---|---|---|
| `F4-T1-01` .. `F4-T1-07` | Pricing math, defaults, surge, discounts | `pricing.service.ts` math formula chain |
| `F5-T1-08` .. `F5-T1-13` | Booking creation, availability lock | `prisma.$transaction` + `VehicleAvailability` upsert |
| `F5-T2-08` .. `F5-T2-12` | Time slot overlap boundaries (nested, partial, adjacent) | `checkSlotOverlap` helper (`sA < eB && sB < eA`) |
| `F5-T2-14` .. `F5-T2-15` | MAINTENANCE vehicle & OFF driver rejection | Pre-validation inside booking transaction |
| `F6-T1-14` .. `F6-T1-20` | Booking & Trip status state machine transitions | `isValidBookingTransition` & `isValidTripTransition` |
| `F6-T2-19` | Trip update on cancelled booking blocked | Guard rule checking `Booking.status !== CANCELLED` |
| `F6-T2-20` | Unauthorized trip status update blocked | `authorizeRole(['DRIVER', 'ADMIN'])` middleware |
| `F7-T1-21` .. `F7-T1-24` | Booking cancellation & top waitlist promotion | Transactional release + `Waitlist` update + `ScheduledNotifications` |
| `F7-T2-21` .. `F7-T2-24` | Cancellation edge cases (empty queue, corrupt records) | Defensive filtering (`customerId !== null && position > 0`) |
