# Technical Analysis & Implementation Blueprint: Milestone M2 (Bookings & Pricing Core Engine)

## Executive Summary
Milestone M2 implements the core commercial engine of the Mishwark Backend platform, comprising:
1. **Pricing Calculation Engine** (`src/v1/services/pricing.service.ts`): Accurate server-side price estimates including base price, distance price, duration price, peak hour surge multipliers, package/referral discounts, and 20% deposit calculation.
2. **Booking Core Service & State Machine** (`src/v1/services/booking.service.ts`): Complete state machine for `BookingStatus` (`PENDING` -> `CONFIRMED` -> `COMPLETED` / `CANCELLED`) and `TripStatus` (`NOTSTARTED` -> `INPROGRESS` -> `ARRIVED` -> `COMPLETED`).
3. **Double-Booking Protection & Concurrency Control**: Overlap detection algorithms within atomic `prisma.$transaction` checking both `Bookings` and `VehicleAvailability` records, returning HTTP 409 Conflict on collision.
4. **Booking Cancellation & Waitlist Promotion Engine**: Automated release of vehicle availability and promotion of top-priority waiting customers from the `Waitlist` queue upon cancellation.
5. **Clean Architecture Controllers, Routes & Schemas**: Express v5 controllers, Zod validation schemas, and router integration into `src/v1/routes/index.ts`.

---

## 1. Existing Codebase Audit & Architecture Alignment

### 4-Tier Clean Architecture Structure
The codebase follows a strict 4-Tier Clean Architecture:
- **Layer 1: Routes** (`src/v1/routes/`): URL route declarations, HTTP verbs, middleware attachment (`authMiddleware`, `errorHandler`).
- **Layer 2: Controllers** (`src/v1/controllers/`): HTTP request parsing, Zod schema validation, service invocation, and structured response formatting. All controllers are wrapped in `errorHandler(...)`.
- **Layer 3: Services** (`src/v1/services/`): Business logic, pricing math, state transition rules, database transactions via Prisma Client.
- **Layer 4: Database Layer** (`prisma/models/`): Prisma models generated via `@prisma/adapter-pg` and Zod types generated via `zod-prisma-types`.

### Existing Schema & Models Inspected
- `prisma/models/vehicles.prisma`:
  - `Vehicles`: `category` (`CAR`, `VAN`, `BUS`, `TRUCK`, `CLASSIC`, `LUXURY`), `basePrice` (Float), `pricePerKm` (Float), `pricePerHour` (Float), `status` (`AVAILABLE`, `BOOKED`, `MAINTENANCE`).
  - `VehicleAvailability`: `vehicleId`, `date` (DateTime), `status` (`AVAILABLE`, `BOOKED`, `BLOCKED`), `reason`, `bookingId`. Unique index: `@@unique([vehicleId, date])`.
- `prisma/models/bookings.prisma`:
  - `Bookings`: `customerId`, `vehicleId`, `driverId`, `packageId`, `eventType`, `startPoint`, `endPoint`, `routeWaypoints`, `distanceKm`, `bookingDate` (String YYYY-MM-DD), `startTime` (String HH:mm), `endTime` (String HH:mm), `status` (`BookingStatus`), `tripStatus` (`TripStatus`), `basePrice`, `distancePrice`, `totalPrice`, `depositPaid`, `paymentStatus` (`PaymentStatus`), `notes`, `driverNotes`. Unique index: `@@unique([vehicleId, bookingDate, startTime])`.
- `prisma/models/waitlist.prisma`:
  - `Waitlist`: `customerId`, `vehicleId`, `requestedDate` (DateTime), `requestedTime` (String), `position` (Int), `status` (`WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`), `notifiedAt`, `expiresAt`.
- `prisma/models/packages.prisma`:
  - `Packages`: `customerId`, `packageName`, `packageType` (`MULTI_CAR`, `MULTI_EVENT`), `totalPrice`, `discountPercentage`, `status` (`PackageStatus`).
- `prisma/models/referrals.prisma`:
  - `Referrals`: `referrerId`, `referredId`, `referralCode`, `status`, `rewardAmount`.

---

## 2. Pricing Calculation Engine Specification

### 2.1 Default Category Pricing Table
When individual vehicle rates are not custom-overridden (or when estimating price based on vehicle category alone), the engine uses standard rates per category:

| Vehicle Category | Base Price (EGP) | Price per KM (EGP) | Price per Hour (EGP) |
|---|---|---|---|
| `CAR` | 50.00 | 10.00 | 25.00 |
| `VAN` | 150.00 | 15.00 | 40.00 |
| `BUS` | 300.00 | 25.00 | 60.00 |
| `TRUCK` | 250.00 | 20.00 | 50.00 |
| `CLASSIC` | 200.00 | 18.00 | 45.00 |
| `LUXURY` | 350.00 | 30.00 | 75.00 |

*Fallback Rule*: Unknown or missing category defaults to `CAR` rates (`basePrice`: 50, `pricePerKm`: 10, `pricePerHour`: 25).

### 2.2 Vehicle Rate Lookup Hierarchy
1. If `vehicleId` is provided, query `prismaClient.vehicles.findUnique({ where: { id: vehicleId } })`.
2. If vehicle exists and has non-zero rate attributes:
   - `basePrice = vehicle.basePrice > 0 ? vehicle.basePrice : categoryDefault.basePrice`
   - `pricePerKm = vehicle.pricePerKm > 0 ? vehicle.pricePerKm : categoryDefault.pricePerKm`
   - `pricePerHour = vehicle.pricePerHour > 0 ? vehicle.pricePerHour : categoryDefault.pricePerHour`
3. Otherwise, use `categoryDefault` rates directly based on `vehicleCategory`.

### 2.3 Mathematical Formula Chain
```
validDistance = Math.max(0, distanceKm || 0)
validDuration = Math.max(0, durationMinutes || 0)

distancePrice = Math.round((validDistance * pricePerKm) * 100) / 100
timePrice     = Math.round(((validDuration / 60) * pricePerHour) * 100) / 100
subtotal      = basePrice + distancePrice + timePrice

surgeMultiplier = isPeakHour ? (surgeMultiplier > 0 ? surgeMultiplier : 1.25) : 1.00
surchargedTotal = subtotal * surgeMultiplier

rawDiscount    = (packageDiscount || 0) + (referralDiscount || 0)
discountAmount = Math.min(surchargedTotal, Math.max(0, rawDiscount))

totalPrice  = Math.max(0, Math.round((surchargedTotal - discountAmount) * 100) / 100)
depositPaid = Math.round(totalPrice * 0.20 * 100) / 100
```

### 2.4 Interface Contracts (`pricing.service.ts`)
```typescript
export interface CalculatePriceParams {
  vehicleCategory?: VehicleCategory | string;
  vehicleId?: string;
  distanceKm: number;
  durationMinutes: number;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  packageDiscount?: number;
  referralDiscount?: number;
  packageId?: string;
  referralCode?: string;
  customBasePrice?: number;
  customPricePerKm?: number;
  customPricePerHour?: number;
}

export interface PriceBreakdown {
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  surgeMultiplier: number;
  discountAmount: number;
  totalPrice: number;
  depositPaid: number;
}
```

---

## 3. Booking Core Service & State Machine Specification

### 3.1 `BookingStatus` State Machine
Allowed status transitions:
- `PENDING` -> `CONFIRMED`
- `PENDING` -> `CANCELLED`
- `CONFIRMED` -> `COMPLETED`
- `CONFIRMED` -> `CANCELLED`
- Terminal states: `COMPLETED`, `CANCELLED` (no outgoing transitions allowed).

Guard Function:
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

### 3.2 `TripStatus` State Machine
Allowed trip status transitions:
- `NOTSTARTED` -> `INPROGRESS`
- `INPROGRESS` -> `ARRIVED`
- `INPROGRESS` -> `COMPLETED`
- `ARRIVED` -> `COMPLETED`
- Terminal state: `COMPLETED`.
- Guard rule: Trip status updates are prohibited if `BookingStatus === CANCELLED`.

Guard Function:
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

## 4. Double-Booking Protection & Concurrency Locking Specification

### 4.1 Time Window Overlap Algorithm
Time format: `HH:mm` (24-hour format).
Convert time string to total minutes from midnight (`hours * 60 + minutes`).
Two time slots `[startA, endA]` and `[startB, endB]` overlap if and only if:
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

### 4.2 Concurrency Lock Execution Sequence in `prisma.$transaction`
```typescript
await prismaClient.$transaction(async (tx) => {
  // 1. Verify Vehicle is available (not MAINTENANCE)
  const vehicle = await tx.vehicles.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.status === 'MAINTENANCE') {
    throw new BadRequestsException("Vehicle unavailable or in maintenance", ErrorCodes.UNPROCESSABLE_ENTITY);
  }

  // 2. Verify Driver is active
  const driver = await tx.drivers.findUnique({ where: { id: driverId } });
  if (!driver || driver.status !== 'ACTIVE') {
    throw new BadRequestsException("Driver is not active", ErrorCodes.UNPROCESSABLE_ENTITY);
  }

  // 3. Check VehicleAvailability table for date
  const dateObj = new Date(`${bookingDate}T00:00:00.000Z`);
  const availability = await tx.vehicleAvailability.findFirst({
    where: {
      vehicleId,
      date: dateObj,
      status: { in: ['BOOKED', 'BLOCKED'] },
    },
  });
  if (availability) {
    throw new ConflictException("Vehicle is already booked or blocked for this date");
  }

  // 4. Check existing Bookings for vehicle & driver overlap
  const existingBookings = await tx.bookings.findMany({
    where: {
      bookingDate,
      status: { not: 'CANCELLED' },
      OR: [{ vehicleId }, { driverId }],
    },
  });

  for (const bk of existingBookings) {
    if (checkSlotOverlap(startTime, endTime, bk.startTime, bk.endTime)) {
      throw new ConflictException("Double booking collision detected for time slot");
    }
  }

  // 5. Calculate final price server-side
  const pricing = await calculatePrice({
    vehicleCategory: vehicle.category,
    vehicleId: vehicle.id,
    distanceKm,
    durationMinutes,
    packageId,
    referralCode,
  });

  // 6. Create Booking
  const newBooking = await tx.bookings.create({
    data: {
      customerId,
      vehicleId,
      driverId,
      packageId: packageId || null,
      eventType: eventType || "",
      startPoint,
      endPoint,
      routeWaypoints: routeWaypoints || null,
      distanceKm,
      bookingDate,
      startTime,
      endTime,
      status: 'PENDING',
      tripStatus: 'NOTSTARTED',
      basePrice: pricing.basePrice,
      distancePrice: pricing.distancePrice,
      totalPrice: pricing.totalPrice,
      depositPaid: pricing.depositPaid,
      paymentStatus: 'UNPAID',
      driverNotes: driverNotes || "",
      notes: notes || "",
    },
  });

  // 7. Upsert VehicleAvailability to BOOKED
  await tx.vehicleAvailability.upsert({
    where: { vehicleId_date: { vehicleId, date: dateObj } },
    update: { status: 'BOOKED', bookingId: newBooking.id },
    create: { vehicleId, date: dateObj, status: 'BOOKED', bookingId: newBooking.id },
  });

  return newBooking;
});
```

---

## 5. Booking Cancellation & Waitlist Promotion Specification

### 5.1 Cancellation Workflow Execution
1. Validate current `BookingStatus`: Must be `PENDING` or `CONFIRMED`. Reject if `COMPLETED` or `CANCELLED`.
2. In atomic `prisma.$transaction`:
   - Update `Booking.status` to `CANCELLED`.
   - Release `VehicleAvailability` record (`status = AVAILABLE`, `bookingId = null`).
   - Re-enable `Driver.status` to `ACTIVE` (if on trip).
   - Query `Waitlist` queue:
     ```typescript
     const dateObj = new Date(`${booking.bookingDate}T00:00:00.000Z`);
     const waitlistEntry = await tx.waitlist.findFirst({
       where: {
         vehicleId: booking.vehicleId,
         requestedDate: dateObj,
         status: 'WAITING',
         customerId: { not: null },
       },
       orderBy: { position: 'asc' },
     });

     if (waitlistEntry) {
       await tx.waitlist.update({
         where: { id: waitlistEntry.id },
         data: {
           status: 'NOTIFIED',
           notifiedAt: new Date(),
           expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours window
         },
       });

       // Create notification record
       await tx.scheduledNotifications.create({
         data: {
           bookingId: booking.id,
           recipientType: 'CUSTOMER',
           recipientId: waitlistEntry.customerId,
           notificationType: 'SYSTEM',
           channel: 'PUSH',
           scheduledAt: new Date(),
           status: 'SCHEDULED',
         },
       });
     }
     ```

---

## 6. Endpoints & Schemas Reference Table

| Verb | Endpoint Path | Description | Access | Success Status | Conflict / Error |
|---|---|---|---|---|---|
| `POST` | `/api/v1/bookings/estimate-price` | Calculate price breakdown | Public / Auth | 200 OK | 400 Bad Request |
| `POST` | `/api/v1/bookings` | Create booking (double-booking check) | Auth (Customer) | 201 Created | 409 Conflict / 400 |
| `GET` | `/api/v1/bookings` | List user/driver bookings (filters & pagination) | Auth | 200 OK | 401 Unauthorized |
| `GET` | `/api/v1/bookings/:id` | Get booking details | Auth | 200 OK | 404 Not Found |
| `PATCH` | `/api/v1/bookings/:id/status` | Update booking status (`CONFIRMED`, `COMPLETED`, `CANCELLED`) | Auth (Admin / Staff) | 200 OK | 400 Bad Request |
| `PATCH` | `/api/v1/bookings/:id/trip-status` | Update trip status (`INPROGRESS`, `ARRIVED`, `COMPLETED`) | Auth (Driver / Admin) | 200 OK | 400 Bad Request / 403 |
| `POST` | `/api/v1/bookings/:id/cancel` | Cancel booking & trigger waitlist promotion | Auth (Customer / Admin) | 200 OK | 400 Bad Request |

---

## 7. New Code Components to Create in Implementation Phase

1. `src/v1/exceptions/conflict.ts`: `ConflictException` (inherits `HttpException` with status `409`).
2. `src/v1/schemas/booking.schema.ts`: Zod schemas for price estimation, booking creation, status update, trip status update, query filters.
3. `src/v1/services/pricing.service.ts`: Pricing calculation engine math & lookup functions.
4. `src/v1/services/booking.service.ts`: Booking creation, availability checks, state transitions, double-booking locks, cancellation & waitlist promotion.
5. `src/v1/controllers/booking.controller.ts`: Express controllers wrapping booking service methods.
6. `src/v1/routes/booking.routes.ts`: Router mounting all 7 booking endpoints with middleware.
7. `src/v1/routes/index.ts`: Update to mount `rootRouterV1.use("/bookings", bookingRouterV1)`.

---

## 8. Verification Strategy

1. **TypeScript Compilation**: `npx tsc --noEmit` must complete with zero errors.
2. **Master Test Runner**: `npx ts-node tests/infra/run-all.ts` must execute all tests in `tests/tier1` and `tests/tier2` cleanly (specifically `f4_f5_f6_f7_bookings_pricing.test.ts` and `f4_f5_f6_f7_bookings_boundaries.test.ts`).
