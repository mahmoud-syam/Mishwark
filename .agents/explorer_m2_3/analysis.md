# Technical Analysis: M2 API Endpoints, Middleware, Validation Schemas & App Architecture

## Executive Summary
This analysis details the architecture, request validation, middleware integration, endpoint specifications, and test setup required for Milestone M2 (Bookings & Pricing Engine) of the Mishwark backend.

---

## 1. Application Setup & Architectural Conventions

### 1.1 Express App Setup Refactoring
- **Current State**: `src/index.ts` creates the Express application, configures global middleware (CORS, cookie-parser, JSON, static uploads), attaches routes under `/api/v1`, attaches `errorMiddleware`, and immediately calls `app.listen()`.
- **Target Architecture**:
  - Extract the application configuration into `src/app.ts`, exporting the `app` instance.
  - Update `src/index.ts` to import `app` from `./app` and start the HTTP server.
  - **Rationale**: Enables integration tests and route verification tools (e.g., Supertest) to import `app` without binding to a network port or interfering with active servers.

### 1.2 Route Wiring Convention
- Main router: `src/v1/routes/index.ts`
- M2 requirement: Wire `booking.routes.ts` under `/api/v1/bookings`:
  ```typescript
  import bookingRouterV1 from "./booking.routes";
  rootRouterV1.use("/bookings", bookingRouterV1);
  ```

### 1.3 Async Controller Wrapper Pattern
- All controllers MUST use the `errorHandler` wrapper from `src/error-handler.ts`.
- `errorHandler` catches thrown exceptions:
  - `HttpException` instances are passed directly to `next(error)`.
  - `ZodError` instances are wrapped in `UnprocessableEntity` (HTTP 422).
  - General errors are wrapped in `InternalException` (HTTP 500).

---

## 2. Middleware Architecture & Integration

### 2.1 Authentication (`auth.middleware.ts` / `authenticateToken`)
- **Current File**: `src/v1/middlewares/auth.middleware.ts`
- **Functionality**: Extracts JWT from `req.cookies.token`, verifies with `JWT_SECRET`, queries user in Prisma DB, verifies `tokenVersion`, and attaches user object to `req.user`.
- **Enhancement Needed**:
  - Support both `req.cookies?.token` AND `req.headers.authorization?.replace(/^Bearer\s+/, '')` for flexible REST API authorization.
  - Export alias `authenticateToken = authMiddleware` to match interface naming conventions in `SCOPE.md`.

### 2.2 Role Authorization (`authorizeRole`)
- **Location**: `src/v1/middlewares/role.middleware.ts` (or exported from `permission.middleware.ts`).
- **Functionality**: Checks if `req.user` has one of the allowed roles (e.g., `['ADMIN', 'DRIVER', 'CUSTOMER']` or `user.isAdmin`). If unauthorized, throws `ForbiddenException` (HTTP 403).

### 2.3 Request Validation (`validateRequest`)
- **Location**: `src/v1/middlewares/validation.middleware.ts`
- **Functionality**: Higher-order middleware accepting a Zod schema and target property (`'body' | 'query' | 'params'`).
  ```typescript
  export const validateRequest = (schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
    return (req: Request, res: Response, next: NextFunction) => {
      req[source] = schema.parse(req[source]);
      next();
    };
  };
  ```

---

## 3. Zod Validation Schemas (`src/v1/schemas/booking.schema.ts`)

| Schema Name | Target Endpoint | Description & Key Validation Rules |
|-------------|-----------------|------------------------------------|
| `CalculatePriceSchema` | `POST /bookings/calculate-price` | Validates `vehicleCategory` (enum), `distanceKm` (>0), optional `durationMinutes`/`durationHours`, `bookingDate` (YYYY-MM-DD), `startTime` (HH:mm), optional `packageId` (UUID) & `referralCode`. |
| `CreateBookingSchema` | `POST /bookings` | Validates `vehicleId` (UUID), optional `driverId`, optional `packageId`, `startPoint`, `endPoint`, `distanceKm` (>=0), `bookingDate` (YYYY-MM-DD), `startTime` (HH:mm), `endTime` (HH:mm), optional `notes` & `referralCode`. |
| `BookingQuerySchema` | `GET /bookings` | Coerces `page` (min 1, default 1), `limit` (min 1, max 100, default 10), optional `status`, `tripStatus`, `bookingDate`, `customerId`, `driverId`. |
| `UpdateBookingStatusSchema` | `PATCH /bookings/:id/status` | Validates `status` (`PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`) and optional `notes`. |
| `UpdateTripStatusSchema` | `PATCH /bookings/:id/trip-status` | Validates `tripStatus` (`NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED`) and optional `driverNotes`. |
| `CancelBookingSchema` | `POST /bookings/:id/cancel` | Validates optional `reason` string. |

---

## 4. Endpoint Technical Specifications

### 4.1 `POST /api/v1/bookings/calculate-price`
- **Access**: Public or Authenticated
- **Middleware**: Optional `authMiddleware`, `validateRequest(CalculatePriceSchema)`
- **Logic**: Calls `PricingService.calculateTripEstimate(...)` using vehicle category rates, surge multiplier calculation, deposit calculation (20%), and discounts.
- **Success Response**: 200 OK with price breakdown.

### 4.2 `POST /api/v1/bookings`
- **Access**: Authenticated User
- **Middleware**: `authMiddleware`, `validateRequest(CreateBookingSchema)`
- **Logic**:
  1. Executes inside `prisma.$transaction`.
  2. Double-Booking Check: Checks `Bookings` and `VehicleAvailability` for overlap `(newStart < existingEnd AND newEnd > existingStart)` on specified `bookingDate`.
  3. Conflict Handling: If overlap exists, throws `HttpException("Vehicle or Driver is already booked for requested time window", 409, 409)`.
  4. Creates `Bookings` row (`customerId = req.user.id`, `status = PENDING`).
  5. Updates or creates `VehicleAvailability` (`status = BOOKED`, `bookingId = booking.id`).
- **Success Response**: 201 Created with created booking object.

### 4.3 `GET /api/v1/bookings`
- **Access**: Authenticated User / Driver / Admin
- **Middleware**: `authMiddleware`, `validateRequest(BookingQuerySchema, 'query')`
- **Logic**:
  - Regular customers get filtered results (`customerId = req.user.id`).
  - Drivers get filtered results (`driverId = driver.id`).
  - Admins can query all bookings with optional query filters.
- **Success Response**: 200 OK with paginated list and pagination metadata.

### 4.4 `GET /api/v1/bookings/:id`
- **Access**: Authenticated User (Owner, Assigned Driver, or Admin)
- **Middleware**: `authMiddleware`
- **Logic**: Queries booking by ID with relations (`customer`, `vehicle`, `driver`, `package`, `payments`). Enforces ownership check (403 Forbidden if not authorized).
- **Success Response**: 200 OK with booking object.

### 4.5 `PATCH /api/v1/bookings/:id/status`
- **Access**: Authenticated User / Admin
- **Middleware**: `authMiddleware`, `validateRequest(UpdateBookingStatusSchema)`
- **Logic**: Validates state machine transition (`PENDING` -> `CONFIRMED`/`CANCELLED`; `CONFIRMED` -> `COMPLETED`/`CANCELLED`). Throws 400 Bad Request on invalid transition.
- **Success Response**: 200 OK with updated booking object.

### 4.6 `PATCH /api/v1/bookings/:id/trip-status`
- **Access**: Authenticated Driver / Admin
- **Middleware**: `authMiddleware`, `validateRequest(UpdateTripStatusSchema)`
- **Logic**: Validates trip state machine transition (`NOTSTARTED` -> `INPROGRESS` -> `ARRIVED` -> `COMPLETED`). If set to `COMPLETED`, automatically sets `BookingStatus` to `COMPLETED`.
- **Success Response**: 200 OK with updated booking object.

### 4.7 `POST /api/v1/bookings/:id/cancel`
- **Access**: Authenticated User (Owner or Admin)
- **Middleware**: `authMiddleware`, `validateRequest(CancelBookingSchema)`
- **Logic**:
  1. Transactional update of booking status to `CANCELLED`.
  2. Release `VehicleAvailability` record back to `AVAILABLE`.
  3. Query `Waitlist` table for next `WAITING` customer for the vehicle and requested date.
  4. If candidate found, promote status to `NOTIFIED` and queue notification.
- **Success Response**: 200 OK with cancellation details and waitlist promotion status.

---

## 5. Testing Framework & Execution Strategy

### 5.1 Current Test Infrastructure
- Node.js v20+, TypeScript v5.9, `tsx` v4.21 installed.
- Native Node.js test runner (`node --test` / `tsx --test`) is supported without requiring extra native binaries.
- Supertest can be added for HTTP route assertion testing, or custom test helpers using Express route invocation / fetch.

### 5.2 Test Execution Command
- Running TypeScript check: `npx tsc --noEmit`
- Running test runner: `npx tsx --test tests/**/*.test.ts`
