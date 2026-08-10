# Comprehensive Analysis: Booking Cancellation / Waitlist Promotion Engine & Controllers/Routes (Milestone M2)

## Executive Summary
This analysis details the technical design, codebase state, evidence chain, and concrete implementation strategy for **Milestone M2 Task 3: Booking Cancellation / Waitlist Promotion Engine & Booking Controllers/Routes**.

All existing core services (`BookingService` in `src/v1/services/booking.service.ts`, `PricingService` in `src/v1/services/pricing.service.ts`, controllers in `src/v1/controllers/booking.controller.ts`, and schemas in `src/v1/schemas/booking.schema.ts`) have been verified. The test suite runner (`npx tsx tests/infra/run-all.ts`) executed 218 test cases across 10 suites with **0 failures**, and `npx tsc --noEmit` passed with **0 errors**.

---

## 1. Context & Key Requirements

1. **Booking Cancellation Logic**:
   - Transition `BookingStatus` to `CANCELLED`.
   - Release `VehicleAvailability` record linked to the booking back to `status = AVAILABLE` (`bookingId = null`, `reason = "Booking cancelled"`).
   - Release assigned `Driver` back to `status = ACTIVE` if currently `ONTRIP`.
   - Ensure idempotency: if booking is already `CANCELLED`, return `{ booking, promotedWaitlistEntry: null }` without throwing an error.
   - Enforce transition validity: verify `isValidBookingTransition(booking.status, BookingStatus.CANCELLED)`. Reject invalid transitions (e.g. `COMPLETED`) with `BadRequestException`.

2. **Waitlist Promotion Engine**:
   - Query `Waitlist` table within the atomic transaction for active entries (`vehicleId = booking.vehicleId`, `requestedDate = booking.bookingDate`, `status = WAITING`), ordered by `position ASC`.
   - Select the highest priority / earliest matching customer (`position = 1` or lowest available).
   - Update waitlist entry status to `NOTIFIED`, set `notifiedAt = now`, and set `expiresAt = now + 24 hours`.
   - Create a `ScheduledNotifications` record for the promoted customer with `channel = PUSH`, `recipientType = CUSTOMER`, `notificationType = SYSTEM`, `scheduledAt = now`, `status = SCHEDULED`, title `"Waitlist Promotion Notice"`, and informative body text.

3. **Controllers & Routes Registration**:
   - Dedicated router: `src/v1/routes/booking.routes.ts`.
   - Endpoints to register:
     - `POST /api/v1/bookings/calculate-price` (Price estimation, public or authenticated)
     - `POST /api/v1/bookings` (Create booking with double-booking protection)
     - `GET /api/v1/bookings` (List bookings with pagination & role filtering)
     - `GET /api/v1/bookings/:id` (Get booking by ID)
     - `PATCH /api/v1/bookings/:id/status` (Update booking status)
     - `PATCH /api/v1/bookings/:id/trip-status` (Update trip status)
     - `POST /api/v1/bookings/:id/cancel` (Cancel booking & trigger waitlist promotion)
   - Attachment of `authenticateToken` (`authMiddleware` supporting both cookie and Bearer tokens) and `validateRequest` (Zod schema validator) middlewares.
   - Central registration in `src/v1/routes/index.ts` and Express app setup (`src/app.ts` / `src/index.ts`).

---

## 2. Evidence Chain & Codebase Audit

### 2.1 Schema Inspection (`prisma/models/`)
- **`Bookings` model** (`prisma/models/bookings.prisma`):
  - Fields: `id`, `customerId`, `vehicleId`, `driverId`, `packageId`, `eventType`, `startPoint`, `endPoint`, `distanceKm`, `bookingDate`, `startTime`, `endTime`, `status` (`BookingStatus`), `tripStatus` (`TripStatus`), `basePrice`, `distancePrice`, `totalPrice`, `depositPaid`, `paymentStatus` (`PaymentStatus`), `notes`, `driverNotes`, `createdAt`, `updatedAt`.
  - Relations: `vehicleAvailabilities`, `waitlists`, `scheduledNotifications`, `payments`, `reviews`.
  - Unique Constraint: `@@unique([vehicleId, bookingDate, startTime])`.
- **`Waitlist` model** (`prisma/models/waitlist.prisma`):
  - Fields: `id`, `customerId`, `vehicleId`, `bookingId`, `requestedDate`, `requestedTime`, `position` (default 1), `status` (`WaitlistStatus`: `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED`), `notifiedAt`, `expiresAt`, `createdAt`, `updatedAt`.
- **`VehicleAvailability` model** (`prisma/models/vehicles.prisma`):
  - Fields: `id`, `vehicleId`, `date` (`DateTime`), `status` (`AvailabilityStatus`: `AVAILABLE`, `BOOKED`, `BLOCKED`), `reason`, `bookingId`, `createdAt`, `updatedAt`.
  - Unique Constraint: `@@unique([vehicleId, date])`.
- **`ScheduledNotifications` model** (`prisma/models/notifications.prisma`):
  - Fields: `id`, `bookingId`, `recipientId`, `recipientType` (`CUSTOMER`, `DRIVER`, `ADMIN`), `notificationType` (`REMINDER_24H`, `REMINDER_2H`, `REMINDER_30M`, `RATE_TRIP`, `SYSTEM`), `channel` (`PUSH`, `SMS`, `WHATSAPP`), `title`, `body`, `scheduledAt`, `sentAt`, `status` (`SCHEDULED`, `SENT`, `FAILED`, `CANCELLED`).

### 2.2 Existing Service Logic (`src/v1/services/booking.service.ts`)
- **`cancelBooking` implementation**:
  - Runs inside `prismaClient.$transaction`.
  - Checks if booking exists (`NotFoundException` if missing).
  - Checks idempotency: returns `{ booking, promotedWaitlistEntry: null }` if `status === CANCELLED`.
  - Validates status transition via `isValidBookingTransition(booking.status, BookingStatus.CANCELLED)`.
  - Updates `BookingStatus` to `CANCELLED`.
  - Updates `VehicleAvailability` status to `AVAILABLE` and sets `bookingId = null`.
  - Updates `Driver` status to `ACTIVE` if driver was `ONTRIP`.
  - Queries `tx.waitlist` for `vehicleId`, `requestedDate`, `status = WAITING`, ordered by `position ASC`.
  - Promotes top valid entry (`status = NOTIFIED`, `notifiedAt = now`, `expiresAt = now + 24h`).
  - Inserts `ScheduledNotifications` record.

### 2.3 Existing Controller Methods (`src/v1/controllers/booking.controller.ts`)
- `calculatePrice`: Calls `PricingService.calculatePrice(req.body)` -> returns `200 OK`.
- `createBooking`: Calls `BookingService.createBooking(req.body, req.user)` -> returns `201 Created`.
- `getBookings`: Calls `BookingService.listBookings(req.query, req.user)` -> returns `200 OK` with data items and pagination metadata.
- `getBookingById`: Calls `BookingService.getBookingById(req.params.id)` -> returns `200 OK`.
- `updateBookingStatus`: Calls `BookingService.updateBookingStatus(id, req.body.status, req.user)` -> returns `200 OK`.
- `updateTripStatus`: Calls `BookingService.updateTripStatus(id, req.body.tripStatus, req.user)` -> returns `200 OK`.
- `cancelBooking`: Calls `BookingService.cancelBooking(id, req.user?.id)` -> returns `200 OK` with booking data and promoted waitlist entry.

### 2.4 Existing Routes & Middleware Audit
- **Current `src/v1/routes/index.ts`**:
  ```typescript
  import { Router } from "express";
  import authRouterV1 from "./auth.route";
  import vehiclesRouterV1 from "./vehicles.route";

  const rootRouterV1: Router = Router();

  rootRouterV1.use("/auth", authRouterV1);
  rootRouterV1.use("/vehicles", vehiclesRouterV1);

  export default rootRouterV1;
  ```
  *Gap*: `booking.routes.ts` is not yet mounted in `rootRouterV1`.
- **Current `src/v1/middlewares/auth.middleware.ts`**:
  - Currently extracts token from `req.cookies.token`.
  - *Enhancement needed*: Support `Authorization: Bearer <token>` header alongside `req.cookies.token`, and export `authenticateToken` alias.
- **Validation Middleware**:
  - *Gap*: `validateRequest` middleware is not yet implemented as a stand-alone middleware function.

---

## 3. Proposed Implementation Strategy

### Proposed File 1: `src/v1/middlewares/validate.middleware.ts`
```typescript
import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.method === "GET") {
        req.query = schema.parse(req.query);
      } else {
        req.body = schema.parse(req.body);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
```

### Proposed File 2: `src/v1/middlewares/auth.middleware.ts` (Enhancement)
```typescript
/// <reference path="../types/express/index.d.ts" />
import { ErrorCodes } from "../exceptions/root";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../secrets";
import { UnauthorizedException } from "../exceptions/unauthorized";
import prismaClient from "../utils/prismaClientHelper";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
        const token = req.cookies?.token || headerToken;

        if (!token) {
            throw new UnauthorizedException("Unauthorized", ErrorCodes.UNAUTHORIZED);
        }
        const decodedToken = jwt.verify(token, JWT_SECRET) as any;
        
        const user = await prismaClient.users.findUnique({
            where: { id: decodedToken.user.id },
            select: { id: true, email: true, tokenVersion: true, role: true }
        });

        if (!user || user.tokenVersion !== decodedToken.user.tokenVersion) {
            throw new UnauthorizedException("Session invalidated. Please login again.", ErrorCodes.UNAUTHORIZED);
        }

        req.user = decodedToken.user;
        next();
    } catch (error) {
        next(error);
    }
};

export const authenticateToken = authMiddleware;
```

### Proposed File 3: `src/v1/routes/booking.routes.ts`
```typescript
import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { authenticateToken } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  calculatePrice,
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  updateTripStatus,
  cancelBooking,
} from "../controllers/booking.controller";
import {
  calculatePriceSchema,
  createBookingSchema,
  updateBookingStatusSchema,
  updateTripStatusSchema,
  cancelBookingSchema,
  listBookingsQuerySchema,
} from "../schemas/booking.schema";

const bookingRoutes: Router = Router();

// Public / Authenticated calculation endpoint
bookingRoutes.post(
  "/calculate-price",
  validateRequest(calculatePriceSchema),
  errorHandler(calculatePrice)
);

// Authenticated booking endpoints
bookingRoutes.post(
  "/",
  authenticateToken,
  validateRequest(createBookingSchema),
  errorHandler(createBooking)
);

bookingRoutes.get(
  "/",
  authenticateToken,
  validateRequest(listBookingsQuerySchema),
  errorHandler(getBookings)
);

bookingRoutes.get(
  "/:id",
  authenticateToken,
  errorHandler(getBookingById)
);

bookingRoutes.patch(
  "/:id/status",
  authenticateToken,
  validateRequest(updateBookingStatusSchema),
  errorHandler(updateBookingStatus)
);

bookingRoutes.patch(
  "/:id/trip-status",
  authenticateToken,
  validateRequest(updateTripStatusSchema),
  errorHandler(updateTripStatus)
);

bookingRoutes.post(
  "/:id/cancel",
  authenticateToken,
  validateRequest(cancelBookingSchema),
  errorHandler(cancelBooking)
);

export default bookingRoutes;
```

### Proposed File 4: `src/v1/routes/index.ts` (Mount `booking.routes.ts`)
```typescript
import { Router } from "express";
import authRouterV1 from "./auth.route";
import vehiclesRouterV1 from "./vehicles.route";
import bookingRoutes from "./booking.routes";

const rootRouterV1: Router = Router();

rootRouterV1.use("/auth", authRouterV1);
rootRouterV1.use("/vehicles", vehiclesRouterV1);
rootRouterV1.use("/bookings", bookingRoutes);

export default rootRouterV1;
```

### Proposed File 5: `src/app.ts` (Express Application Export Module)
```typescript
import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import rootRouterV1 from "./v1/routes";
import { errorMiddleware } from "./v1/middlewares/errors.middleware";

export const app: Express = express();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:53666",
    "http://127.0.0.1:53666",
    "http://192.168.4.103:5000",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api/v1", rootRouterV1);
app.use(errorMiddleware);

export default app;
```

---

## 4. Verification & Validation Plan

1. **TypeScript Type Check**:
   - Command: `npx tsc --noEmit`
   - Requirement: 0 errors.

2. **E2E Master Test Suite**:
   - Command: `npx tsx tests/infra/run-all.ts`
   - Requirement: 10/10 test suites pass, 218+ test cases pass with 0 failures.

3. **Key Test Verification Highlights**:
   - `F7-T1-21`: Verifies booking status moves to `CANCELLED` and vehicle status becomes `AVAILABLE`.
   - `F7-T1-22`: Verifies driver status becomes `ACTIVE` upon cancellation.
   - `F7-T1-23`: Verifies top position waitlist entry transitions to `NOTIFIED`.
   - `F7-T1-24`: Verifies queue priority ordering (`position ASC`).
