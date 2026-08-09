# Handoff Report — Explorer 3: Business Logic, API & Edge Case Specialist

**Author**: Explorer 3  
**Target Audience**: Implementer Agents, Orchestrator  
**Date**: 2026-08-09  
**Working Directory**: `C:/Projects/Mishwarak-backend/.agents/explorer_3`

---

## 1. Observation

### 1.1 Project Structure & Existing Implementation
- **Framework**: Express.js with TypeScript, Clean Architecture pattern (Routes -> Controllers -> Zod Schemas -> Prisma Models).
- **Current Main Router**: `src/v1/routes/index.ts` currently mounts `/auth` (`auth.route.ts`) and `/vehicles` (`vehicles.route.ts`).
- **Existing Routes**:
  - `POST /api/v1/auth/signup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/otp/request`, `POST /api/v1/auth/otp/verify`, `POST /api/v1/auth/verify-2fa`, `POST /api/v1/auth/verify-2fa-setup`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all-devices`, `GET/POST /api/v1/auth/2fa/*`.
  - `GET /api/v1/vehicles`, `GET /api/v1/vehicles/:id`, `GET /api/v1/vehicles/:id/availability`.
- **Existing Error Handling & Utility Structure**:
  - Exception classes in `src/v1/exceptions`: `HttpException`, `BadRequestsException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `UnprocessableEntityException`.
  - Error enum `ErrorCodes` in `src/v1/exceptions/root.ts`.
  - Wrapper `errorHandler` in `src/error-handler.ts`.
  - Database Helper `prismaClient` in `src/v1/utils/prismaClientHelper.ts`.
- **Prisma Schema Organization**:
  - Located in `prisma/models/*.prisma` (`users.prisma`, `vehicles.prisma`, `roles.prisma`, `settings.prisma`, `enums.prisma`).

### 1.2 Missing Modules Identified from `Mishwark-Data-Model.docx`
1. **Bookings & Pricing Engine**: Pricing estimation endpoint, creation with double-booking prevention, detail queries, status updates, trip status progression, cancellation.
2. **Driver Dashboard**: Driver-scoped trip listings, trip execution state transitions (`en_route`, `arrived`, `completed`), driver stats.
3. **Waitlist System**: Join waitlist for booked date/vehicle, check position, auto-notification on cancellation, conversion to booking, expiration timer.
4. **Reviews & Blind Rating System**: Two-way ratings (`customer_to_driver`, `driver_to_customer`), hidden until both submit or 48 hours elapse.
5. **Packages**: Creation of multi-car or multi-event package bundles, server-side discount calculation.
6. **Payments**: Paymob/Fawry/Cash integration endpoints, transaction reference tracking, payment webhooks, deposit management.
7. **Chat / Conversations & Messages**: Booking-linked conversations, message history, unread status, WebSocket integration events.
8. **Scheduled Notifications**: Automated triggers for 24h, 2h, 30m trip reminders and post-trip rating prompts.
9. **Referrals & Wallet**: Referral code generation, first-booking reward completion, wallet transaction ledger.
10. **Admin Dashboard**: Aggregated summary statistics, monthly calendar booking density, single-day booking drilldown, fleet availability summary, driver performance metrics.

---

## 2. Logic Chain

### 2.1 Complete API Endpoint Inventory

Below is the definitive inventory of all required API endpoints across modules.

#### 1. Authentication & User Management Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/otp/request` | Public | Request 4-digit OTP for phone login/signup |
| `POST` | `/api/v1/auth/otp/verify` | Public | Verify OTP code; returns JWT with role payload |
| `POST` | `/api/v1/auth/signup` | Public / Admin | Create user account |
| `POST` | `/api/v1/auth/login` | Public | Email/password login |
| `POST` | `/api/v1/auth/logout` | Authenticated | Clear session cookie |
| `PATCH` | `/api/v1/users/me/notification-settings` | Authenticated | Update user push/SMS notification preferences |

#### 2. Vehicles & Availability Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/vehicles` | Public | List vehicles filtered by `category` and `status` |
| `GET` | `/api/v1/vehicles/:id` | Public | Get detailed vehicle profile |
| `GET` | `/api/v1/vehicles/:id/availability` | Public | Get monthly availability calendar (`?month=YYYY-MM`) |
| `POST` | `/api/v1/vehicles` | Admin | Create new vehicle |
| `PATCH` | `/api/v1/vehicles/:id` | Admin | Update vehicle details or status |
| `DELETE` | `/api/v1/vehicles/:id` | Admin | Soft-delete / deactivate vehicle |

#### 3. Bookings & Pricing Engine Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/bookings/estimate-price` | Public / Customer | Server-side price calculation based on route & parameters |
| `POST` | `/api/v1/bookings` | Customer | Create booking (enforces double-booking checks) |
| `GET` | `/api/v1/bookings` | Customer / Admin | List bookings (filters: `filter=upcoming\|completed\|cancelled`, `customerId`) |
| `GET` | `/api/v1/bookings/:id` | Authenticated | Get full booking details (scoped by role) |
| `PATCH` | `/api/v1/bookings/:id` | Customer / Admin | Update booking details before confirmation |
| `PATCH` | `/api/v1/bookings/:id/trip-status` | Driver / Admin | Advance trip execution status (`en_route`, `arrived`, `completed`) |
| `DELETE` | `/api/v1/bookings/:id/cancel` | Customer / Admin | Cancel booking and release calendar schedule |

#### 4. Driver Dashboard Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/driver/bookings` | Driver | List driver's assigned trips (`?filter=today\|upcoming\|completed`) |
| `GET` | `/api/v1/driver/stats` | Driver | Get driver performance metrics (total trips, rating avg) |
| `PATCH` | `/api/v1/driver/status` | Driver | Update driver active status (`ACTIVE`, `OFF`, `ONTRIP`, `ONLEAVE`) |

#### 5. Packages Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/packages` | Customer | Create a multi-car or multi-event package bundle |
| `GET` | `/api/v1/packages` | Customer | List customer active/past packages |
| `GET` | `/api/v1/packages/:id` | Customer | Get package bundle details and associated bookings |

#### 6. Payments Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/payments` | Customer | Initiate deposit or full payment for a booking |
| `GET` | `/api/v1/payments/booking/:bookingId` | Authenticated | Retrieve payment history and status for a booking |
| `POST` | `/api/v1/payments/webhook` | External Webhook | Handle payment gateway callbacks (Paymob / Fawry) |

#### 7. Reviews & Ratings Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/reviews` | Authenticated | Submit review (`customer_to_driver` or `driver_to_customer`) |
| `GET` | `/api/v1/reviews/booking/:bookingId` | Authenticated | Fetch booking reviews (applies blind rating filter) |
| `GET` | `/api/v1/reviews/driver/:driverId` | Public | Fetch visible public driver ratings |

#### 8. Waitlist Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/waitlist` | Customer | Join waitlist for a fully booked vehicle and date |
| `GET` | `/api/v1/waitlist/:id` | Customer | Check current waitlist position and notification status |
| `POST` | `/api/v1/waitlist/:id/convert` | Customer | Convert notified waitlist spot into a pending booking |
| `DELETE` | `/api/v1/waitlist/:id` | Customer | Leave waitlist |

#### 9. Chat & Messaging Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/bookings/:id/conversation` | Customer / Driver | Get or auto-create conversation for a booking |
| `GET` | `/api/v1/conversations/:id/messages` | Participant | Fetch paginated chat message history |
| `POST` | `/api/v1/conversations/:id/messages` | Participant | Send text or quick reply message via REST fallback |

#### 10. Referrals & Wallet Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/referrals/me` | Customer | Get referral code, referral list, and earnings stats |
| `POST` | `/api/v1/referrals/:id/complete` | System / Admin | Complete referral reward after first completed booking |
| `GET` | `/api/v1/wallet/transactions` | Customer | Get customer wallet balance and transaction ledger |

#### 11. Admin Dashboard Module
| HTTP Method | Endpoint Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/admin/stats/summary` | Admin | Key performance indicators (revenue, trip counts, active drivers) |
| `GET` | `/api/v1/admin/bookings/calendar` | Admin | Monthly booking density calendar (`?month=YYYY-MM`) |
| `GET` | `/api/v1/admin/bookings` | Admin | Filterable master booking list (`?date=YYYY-MM-DD`, `status`) |
| `GET` | `/api/v1/admin/vehicles/status` | Admin | Fleet status breakdown (available, booked, maintenance counts) |
| `GET` | `/api/v1/admin/drivers/:id/stats` | Admin | Detailed performance analytics for a specific driver |

---

### 2.2 Payload & Response Structures (DTO Specifications)

#### DTO 1: Price Estimation (`POST /api/v1/bookings/estimate-price`)
- **Request Body**:
  ```json
  {
    "vehicleId": "c4b3a210-1234-4567-89ab-cdef01234567",
    "startPoint": "Cairo Festival City, New Cairo",
    "endPoint": "Smart Village, Giza",
    "distanceKm": 42.5,
    "bookingDate": "2026-08-15",
    "startTime": "10:00",
    "eventType": "WEDDING",
    "packageId": "optional-package-uuid"
  }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "message": "Price estimated successfully",
    "data": {
      "vehicleId": "c4b3a210-1234-4567-89ab-cdef01234567",
      "distanceKm": 42.5,
      "basePrice": 200.00,
      "distancePrice": 425.00,
      "eventSurcharge": 93.75,
      "grossPrice": 718.75,
      "discountAmount": 71.88,
      "totalPrice": 646.87,
      "depositRequired": 129.37,
      "currency": "EGP"
    }
  }
  ```

#### DTO 2: Create Booking (`POST /api/v1/bookings`)
- **Request Body**:
  ```json
  {
    "vehicleId": "c4b3a210-1234-4567-89ab-cdef01234567",
    "driverId": "d1e2f3a4-5678-90ab-cdef-1234567890ab",
    "eventType": "WEDDING",
    "startPoint": "Cairo Festival City, New Cairo",
    "endPoint": "Smart Village, Giza",
    "routeWaypoints": [{"lat": 30.01, "lng": 31.42, "name": "Stop 1"}],
    "distanceKm": 42.5,
    "bookingDate": "2026-08-15",
    "startTime": "10:00",
    "endTime": "14:00",
    "packageId": null,
    "notes": "Please ensure car is decorated",
    "driverNotes": "Call customer 15 mins prior"
  }
  ```
- **Response Body (201 Created)**:
  ```json
  {
    "message": "Booking created successfully",
    "data": {
      "id": "b1a2c3d4-e5f6-7890-abcd-1234567890ef",
      "customerId": "u9876543-2109-8765-4321-fedcba098765",
      "vehicleId": "c4b3a210-1234-4567-89ab-cdef01234567",
      "driverId": "d1e2f3a4-5678-90ab-cdef-1234567890ab",
      "status": "PENDING",
      "tripeStatus": "NOTSTARTED",
      "paymentStatus": "UNPAID",
      "basePrice": 200.00,
      "distancePrice": 425.00,
      "totalPrice": 646.87,
      "depositPaid": 0.00,
      "conversationId": "conv-99887766-5544-3322-1100",
      "createdAt": "2026-08-09T11:15:00.000Z"
    }
  }
  ```

---

### 2.3 Step-by-Step Business Logic Algorithms

#### Algorithm A: Pricing Calculation Engine
```
FUNCTION calculateBookingPrice(params):
    INPUT: vehicleId, distanceKm, eventType, packageId, bookingDate, startTime, endTime
    
    1. Fetch Vehicle record V from DB where id == vehicleId.
       If not found -> THROW NotFoundException("Vehicle not found").
       
    2. Base Fare (B) = V.basePrice
       Price Per Km (P_km) = V.pricePerKm
       Distance Fare (D) = distanceKm * P_km
       
    3. Determine Event Surcharge Rate (S_rate):
       IF eventType == "WEDDING": S_rate = 0.15 (15%)
       ELSE IF eventType == "AIRPORT": S_rate = 0.10 (10%)
       ELSE IF eventType == "MULTI_DAY": S_rate = 0.05 (5%)
       ELSE: S_rate = 0.00
       
       Event Surcharge Amount (S_amount) = (B + D) * S_rate
       Gross Price (G) = B + D + S_amount
       
    4. Determine Package Discount (Disc_amount):
       IF packageId is provided:
           Fetch Package record P from DB where id == packageId AND status == "ACTIVE".
           IF P exists:
               Disc_rate = P.discountPercentage / 100.0
               Disc_amount = G * Disc_rate
           ELSE:
               Disc_amount = 0.0
       ELSE:
           Disc_amount = 0.0
           
    5. Net Total Price (N) = G - Disc_amount
       Deposit Required (Dep) = N * 0.20 (20% mandatory deposit)
       
    6. RETURN {
           basePrice: B,
           distancePrice: D,
           eventSurcharge: S_amount,
           grossPrice: G,
           discountAmount: Disc_amount,
           totalPrice: ROUND(N, 2),
           depositRequired: ROUND(Dep, 2)
       }
END FUNCTION
```

#### Algorithm B: Double-Booking Prevention & Concurrency Control
```
FUNCTION createBookingWithDoubleBookingProtection(customerId, payload):
    INPUT: customerId, vehicleId, driverId, bookingDate, startTime, endTime, route details...
    
    1. Execute inside PRISMA INTERACTIVE TRANSACTION (isolation: ReadCommitted):
       prisma.$transaction(async (tx) => {
       
           a. Check Vehicle Exists & Active Status:
              vehicle = tx.vehicles.findUnique({ where: { id: vehicleId } })
              IF vehicle.status == "MAINTENANCE" ->
                  THROW BadRequestsException("Vehicle is under maintenance", ERROR_VEHICLE_UNAVAILABLE)
                  
           b. Check Vehicle Availability Calendar:
              avail = tx.vehicleAvailability.findFirst({
                  where: { vehicleId, date: bookingDate, status: { in: ["BOOKED", "BLOCKED"] } }
              })
              IF avail exists ->
                  THROW BadRequestsException("Vehicle is unavailable on selected date", ERROR_DOUBLE_BOOKING)
                  
           c. Check Overlapping Time Window for Vehicle:
              // Overlap formula: (StartA < EndB) AND (EndA > StartB)
              overlappingBooking = tx.bookings.findFirst({
                  where: {
                      vehicleId,
                      bookingDate,
                      status: { in: ["PENDING", "CONFIRMED"] },
                      AND: [
                          { startTime: { lt: payload.endTime } },
                          { endTime: { gt: payload.startTime } }
                      ]
                  }
              })
              IF overlappingBooking exists ->
                  THROW BadRequestsException("Vehicle is already booked during this time window", ERROR_DOUBLE_BOOKING)
                  
           d. Check Driver Schedule Overlap:
              driverOverlapping = tx.bookings.findFirst({
                  where: {
                      driverId,
                      bookingDate,
                      status: { in: ["PENDING", "CONFIRMED"] },
                      AND: [
                          { startTime: { lt: payload.endTime } },
                          { endTime: { gt: payload.startTime } }
                      ]
                  }
              })
              IF driverOverlapping exists ->
                  THROW BadRequestsException("Assigned driver is unavailable during this time window", ERROR_DRIVER_BUSY)
                  
           e. Recalculate Pricing Server-Side (Algorithm A) to prevent price tampering.
           
           f. Insert Booking Record:
              newBooking = tx.bookings.create({ ... })
              
           g. Create Linked Conversation:
              tx.conversations.create({ bookingId: newBooking.id, customerId, driverId, status: "OPEN" })
              
           h. Create VehicleAvailability Row:
              tx.vehicleAvailability.create({ vehicleId, date: bookingDate, status: "BOOKED", bookingId: newBooking.id })
              
           i. Schedule Automated Reminder Notifications:
              tx.scheduledNotifications.createMany([
                  { bookingId: newBooking.id, notificationType: "reminder_24h", scheduledAt: calculateOffset(bookingDate, startTime, -24h) },
                  { bookingId: newBooking.id, notificationType: "reminder_2h", scheduledAt: calculateOffset(bookingDate, startTime, -2h) },
                  { bookingId: newBooking.id, notificationType: "reminder_30m", scheduledAt: calculateOffset(bookingDate, startTime, -30m) }
              ])
              
           RETURN newBooking
       })
       CATCH PrismaUniqueConstraintViolation (P2002 on [vehicleId, bookingDate, startTime]):
           THROW BadRequestsException("Double-booking conflict detected at database level", ERROR_DOUBLE_BOOKING)
END FUNCTION
```

#### Algorithm C: Waitlist Auto-Promotion Protocol
```
FUNCTION onBookingCancelled(cancelledBooking):
    1. Mark cancelledBooking.status = "CANCELLED".
    2. Mark corresponding vehicleAvailability status = "AVAILABLE".
    
    3. Query Waitlist for top waiting customer:
       topWaitlist = tx.waitlist.findFirst({
           where: {
               vehicleId: cancelledBooking.vehicleId,
               requestedDate: cancelledBooking.bookingDate,
               status: "WAITING"
           },
           orderBy: { position: "asc" }
       })
       
    4. IF topWaitlist exists:
           Update topWaitlist.status = "NOTIFIED"
           Update topWaitlist.notifiedAt = NOW()
           Update topWaitlist.expiresAt = NOW() + 15 Minutes
           
           Send High-Priority Push Notification to topWaitlist.customerId:
           "A vehicle you waitlisted is now available! You have 15 minutes to confirm."
           
           Schedule Expiration Background Task at topWaitlist.expiresAt:
           "If status is still NOTIFIED after 15m, set status=EXPIRED and call onBookingCancelled(cancelledBooking) to notify position 2."
END FUNCTION
```

---

## 3. Caveats

1. **Prisma Unique Index Granularity**:
   - The current DB index `@unique([vehicleId, bookingDate, startTime])` prevents identical `startTime` entries, but does **NOT** enforce overlapping time range prevention (e.g. 10:00-14:00 vs 11:00-12:00).
   - Application-level overlap checking inside transactions (Algorithm B step 1c) is **mandatory** to prevent partial window conflicts.
2. **Blind Rating Exposure Protection**:
   - When calling `GET /api/v1/reviews/booking/:bookingId`, the query handler MUST check `visible_at`. If `visible_at` is `NULL` or `> NOW()`, mask the comment and ratings unless BOTH parties have submitted reviews.
3. **Future Live Tracking Integration**:
   - `TripLocations` table is defined for future GPS updates. In the current phase, live socket location updates update in-memory state or low-latency logs, while core booking status relies on `PATCH /bookings/:id/trip-status`.

---

## 4. Conclusion

- **Total Endpoints Required**: 38 distinct endpoints mapped across 11 modules.
- **Data Architecture Compliance**: Fully aligns with `Mishwark-Data-Model.docx` entities and `ORIGINAL_REQUEST.md` Clean Architecture rules.
- **Safety Mechanisms**: Double-booking protection is enforced dual-layer (Prisma transaction overlap checks + DB level unique constraint P2002 handling).
- **Pricing Security**: Fully server-side computed; Flutter client only sends parameters, never prices.

---

## 5. Verification Method

To verify the implementation of this business logic once built:

1. **TypeScript Build & Type Safety Check**:
   ```bash
   npx tsc --noEmit
   ```
2. **Prisma Schema Generation & Validation**:
   ```bash
   npx prisma generate
   ```
3. **Unit / Integration Test Vectors**:
   - **Test Vector 1 (Pricing Engine)**: Send `POST /api/v1/bookings/estimate-price` with `distanceKm: 10`, `vehicle.basePrice: 100`, `vehicle.pricePerKm: 15`, `eventType: "WEDDING"`. Expected Total Price = `(100 + 150) * 1.15 = 287.50 EGP`.
   - **Test Vector 2 (Double-Booking Prevention)**: Create Booking A for Vehicle V1 on 2026-08-15 between 10:00 and 14:00. Attempt creating Booking B for Vehicle V1 on 2026-08-15 between 12:00 and 15:00. Expected Response = `409 Conflict` with error message `"Vehicle is already booked during this time window"`.
   - **Test Vector 3 (Blind Rating Filtering)**: Customer submits review for Booking #100. Call `GET /reviews/booking/100` as Driver. Expected payload = `{ message: "Review pending until both sides rate or 48h pass", data: null }`.
