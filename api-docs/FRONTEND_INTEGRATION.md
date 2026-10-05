# Mishwarak API — Frontend Integration Guide

Base URL: `http://localhost:5000/api/v1`
Interactive docs: `http://localhost:5000/api-docs/` (Try it out is enabled)
Machine-readable spec: `http://localhost:5000/api-docs.json`

84 operations across 76 paths. Every operation below is exercised by the live
smoke suite (`npm run smoke`), so the shapes here are verified, not aspirational.

---

## Response envelopes

Success responses are **not** uniform. Check which one an endpoint uses before
writing destructuring logic.

```ts
// Most resources: bookings, payments, wallet, packages, driver, admin, notifications
{ success: true, data: T | T[], pagination?: Pagination }

// Vehicles and availability
{ message: "Vehicles fetched successfully", data: T[] }

// Booking cancellation
{ success: true, message: "Booking cancelled successfully", data: Booking }

// Auth and 2FA
{ message: "...", ... }   // no envelope; see Authentication
```

Paginated endpoints always return `pagination` alongside `data`:

```ts
interface Pagination {
  total: number;      // total matching rows, not page length
  page: number;       // 1-based
  limit: number;
  totalPages: number; // 0 when total is 0
}
```

Paginated: `GET /bookings`, `GET /driver/bookings`, `GET /driver/stats`-adjacent
lists, `GET /wallet/transactions`, `GET /notifications`, `GET /admin/bookings`,
`GET /admin/bookings/all`, `GET /admin/users`, `GET /admin/drivers`,
`GET /wallet/transactions`.

## Error envelope

Every failure, including auth failures, uses the same body:

```ts
interface ApiError {
  message: string;      // human-readable, safe to surface in a toast
  errorCode: number;    // stable numeric code, switch on this
  errors: unknown[] | null;  // Zod issues on 422, otherwise null
}
```

| Status | Meaning |
|--------|---------|
| 400 | Business rule rejected it (`errorCode` 1001–1005) |
| 401 | Missing, malformed, expired, or revoked token |
| 403 | Authenticated but lacks the role or permission |
| 422 | Schema validation failed; `errors` lists the offending fields |
| 500 | Unexpected server fault (`errorCode` 3001) |

Key `errorCode` values:

| Code | Constant | Typical trigger |
|------|----------|-----------------|
| 1001 | USER_NOT_FOUND | Unknown user, or a driver without a driver profile |
| 1005 | INVALID_CREDENTIALS | Wrong password, wrong OTP, wrong TOTP |
| 2001 | UNPROCESSABLE_ENTITY | Body failed schema validation |
| 3001 | INTERNAL_EXCEPTION | Unhandled fault |
| 4001 | UNAUTHORIZED | Token missing/invalid/expired/revoked |
| 4003 | FORBIDDEN | Permission gate refused |

A 401 is always "log out and re-authenticate". Malformed and expired JWTs both
return 401, never 500.

---

## Authentication

There are three entry points. **Two of them never return a token in the body** —
they set a cookie. Plan your auth state machine around this.

### 1. OTP (simplest, recommended for mobile)

```http
POST /auth/otp/request
{ "phoneNumber": "+201001234567", "role": "customer", "name": "Ahmed" }
```

`role` is `customer` (default) or `driver`. Only used when the phone number is
new; for an existing phone the account's role is untouched. Drivers must send
`licenseNumber`. The response echoes the code in non-production as `dev_otp`.

```http
POST /auth/otp/verify
{ "phoneNumber": "+201001234567", "code": "123456" }
```

```json
{
  "message": "OTP verified successfully",
  "token": "<JWT>",
  "role": "CUSTOMER",
  "user": { "id": "...", "name": "...", "email": null, "tokenVersion": 0, "role": { "id": "...", "name": "CUSTOMER", "permissions": [] } }
}
```

This is the **only** flow that returns the JWT in the body. The code `0000` is
accepted in every environment as a testing bypass.

### 2. Login (always 2FA-gated)

```http
POST /auth/login
{ "email": "...", "password": "..." }
```

`POST /auth/login` **never** returns a token. It always returns one of two
payloads, both HTTP 200:

```json
// 2FA not set up yet — enable it before the user can log in
{ "message": "2FA setup required", "twoFactorSetupRequired": true, "userId": "UUID", "secret": "BASE32", "qrCodeDataURL": "data:image/png;base64,..." }
```

```json
// 2FA already enabled — answer the challenge
{ "message": "2FA required", "twoFactorRequired": true, "userId": "UUID" }
```

Then, depending on which you got:

| Login said | Call | Body |
|-----------|------|------|
| `twoFactorSetupRequired` | `POST /auth/verify-2fa-setup` | `{ "userId", "token", "secret" }` — `secret` is the value login returned |
| `twoFactorRequired` | `POST /auth/verify-2fa` | `{ "userId", "token" }` — code only, secret is already stored |

Both 2FA verification routes set the JWT as a **`token` cookie only**, with
nothing in the body. With `credentials: 'include'` the cookie arrives
automatically; otherwise read `Set-Cookie` and attach it as `Authorization:
Bearer <token>` yourself. The cookie is `sameSite: lax`, `secure: false`,
`httpOnly: false`, 7-day max age.

If a wrong TOTP code is sent, `tokenVersion` is **not** incremented, so the
user's other sessions survive.

### 3. Signup

`POST /auth/signup` is `multipart/form-data`, not JSON. Fields: `name`,
`email`, `password`, `role` (`customer`|`driver`), `phoneNumbers` (JSON-encoded
array in a text part, e.g. `[{"number":"+201001234567"}]`), `pic` (file part),
`licenseNumber` + `licenseExpiry` (required when `role=driver`), optional
`referralCode`.

Password min 8 characters. Admin roles cannot be self-assigned — that requires
`PATCH /admin/users/role`. Signup does not return a token.

### Sending the token

`authMiddleware` accepts the token from **either** the `token` cookie or an
`Authorization: Bearer <token>` header, cookie first. Using the header is more
predictable for SPAs; the browser will not send the cookie cross-origin unless
you set `credentials: 'include'`.

CORS is restricted to `localhost:3000`, `localhost:53666` and
`192.168.4.103:5000` with credentials enabled. Your dev origin must be on that
list.

### Session invalidation

The role is re-read from the database on every authenticated request, so a role
change takes effect immediately. A `tokenVersion` bump invalidates every
existing session. That happens on OTP verification, 2FA login, admin password
change, and 2FA reset — so all of these sign the target user out everywhere.

### 2FA management (authenticated)

```http
GET  /auth/2fa/setup    → { "secret": "BASE32", "qrCodeDataURL": "data:image/png;base64,..." }
POST /auth/2fa/verify   → { "token": "123456", "secret": "BASE32" }  // both required
POST /auth/2fa/disable  → no body
```

`/auth/2fa/verify` stores the secret and flips `twoFactorEnabled`. Missing
`token` or `secret` is a 400, not a 500.

### Admin credential management

```http
PUT  /auth/change-password/:userId   { "newPassword": "min6chars", "reset2FA": false }
POST /auth/reset-2fa/:userId         no body
```

Both require the `user_password:manage` permission. There is no `oldPassword`
field — the caller holds the permission. Every call bumps `tokenVersion`.

---

## Roles and permissions

Role names are uppercase and match the enum exactly: `SUPER_ADMIN`, `ADMIN`,
`CUSTOMER`, `DRIVER`. Comparison is case-insensitive on the backend, but send
the canonical uppercase form.

`SUPER_ADMIN` implicitly holds every permission. `ADMIN` needs the specific
permission granted to its role.

| Permission | Gates |
|-----------|-------|
| `dashboard:view` | `/admin/stats/summary` |
| `user:manage` | `/admin/users*` |
| `driver:manage` | `/admin/drivers*` |
| `booking:manage` | `/admin/bookings*` |
| `vehicle:manage` | `/admin/vehicles/status` |
| `payment:manage` | `/admin/*payment*` |
| `settings:manage` | `/admin/settings` |
| `review:manage` | review moderation |
| `wallet:manage` | `POST /wallet/credit`, `POST /wallet/debit` |
| `user_password:manage` | `PUT /auth/change-password/:userId`, `POST /auth/reset-2fa/:userId` |

Wallet **reads** are available to any authenticated user; wallet **writes** are
admin-only. The write gate is enforced server-side — a customer or driver
calling it gets a 403.

---

## Enums

| Enum | Values |
|------|--------|
| `UserRole` | `SUPER_ADMIN`, `ADMIN`, `CUSTOMER`, `DRIVER` |
| `VehicleCategory` | `CAR`, `VAN`, `BUS`, `TRUCK`, `CLASSIC`, `LUXURY` |
| `VehicleStatus` | `AVAILABLE`, `BOOKED`, `MAINTENANCE` |
| `AvailabilityStatus` | `AVAILABLE`, `BOOKED`, `BLOCKED` |
| `BookingStatus` | `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED` |
| `TripStatus` | `NOTSTARTED`, `INPROGRESS`, `ARRIVED`, `COMPLETED` |
| `DriverStatus` | `ACTIVE`, `OFF`, `ONTRIP`, `ONLEAVE` |
| `PaymentStatus` | `UNPAID`, `PAID`, `PARTIALLY_PAID` |
| `PaymentMethod` | `PAYMOB`, `FAWRY`, `CASH`, `WALLET` |
| `PaymentRecordStatus` | `PENDING`, `SUCCESS`, `FAILED`, `REFUNDED` |
| `PackageType` | `MULTI_CAR`, `MULTI_EVENT` |
| `PackageStatus` | `ACTIVE`, `COMPLETED`, `CANCELLED`, `EXPIRED` |
| `ReviewerType` | `CUSTOMER_TO_DRIVER`, `DRIVER_TO_CUSTOMER` |
| `WaitlistStatus` | `WAITING`, `NOTIFIED`, `CONVERTED`, `EXPIRED` |
| `ReferralStatus` | `PENDING`, `COMPLETED`, `EXPIRED` |
| `NotificationStatus` | `SCHEDULED`, `SENT`, `FAILED`, `CANCELLED` |
| `NotificationType` | `REMINDER_24H`, `REMINDER_2H`, `REMINDER_30M`, `RATE_TRIP`, `SYSTEM` |
| `MessageType` | `TEXT`, `QUICK_REPLY` |
| `WalletTransactionType` | `REFERRAL_REWARD`, `REFUND`, `MANUAL_ADJUSTMENT`, `PAYMENT_DEDUCTION`, `DEPOSIT` |

All query-string enum filters accept lowercase and are upcased server-side
(`?status=available` works). JSON bodies need the exact uppercase values.

---

## Bookings

### Pricing is server-side and cannot be influenced

```http
POST /bookings/estimate-price
{ "vehicleCategory": "VAN", "startPoint": { "latitude": 30.0444, "longitude": 31.2357 }, "endPoint": "Maadi, Cairo" }
```

```json
{
  "success": true,
  "data": {
    "basePrice": 150, "distancePrice": 120, "timePrice": 40,
    "surgeMultiplier": 1, "discountAmount": 0,
    "totalPrice": 310, "depositPaid": 62
  },
  "route": {
    "distanceKm": 12.0, "durationMinutes": 30,
    "source": "openrouteservice",
    "start": { "latitude": 30.0444, "longitude": 31.2357 },
    "end": { "latitude": 30.0444, "longitude": 31.2357 },
    "warning": "..."
  },
  "comparison": { "claimedDistanceKm": null, "claimedDurationMinutes": null, "distanceDifferenceKm": null, "withinTolerance": true }
}
```

Each endpoint accepts exactly one location shape:
`{latitude, longitude}`, `{startLat, startLng}`, `{lat, lng}`, or a plain place
name string (geocoded). Free text geocoding needs `ORS_API_KEY`; without it the
server falls back to a straight-line estimate and says so in `route.source` and
`route.warning`.

`customBasePrice`, `customPricePerKm` and `customPricePerHour` are **rejected**
if sent — pricing is server-authoritative. Distance and duration are always
recomputed server-side. Any `distanceKm` you send is only echoed back under
`comparison` and never priced, so don't bother computing it client-side.

### Creating a booking

```http
POST /bookings
{
  "vehicleId": "UUID", "bookingDate": "2026-11-10",
  "startTime": "09:00", "endTime": "11:00",
  "startPoint": { "latitude": 30.0444, "longitude": 31.2357 },
  "endPoint": { "latitude": 31.2001, "longitude": 29.9187 },
  "notes": "optional, max 2000"
}
```

Returns 201 with `{ success: true, data: Booking }`, status `PENDING`.

Rules:
- `startTime` must be earlier than `endTime`, both `HH:mm`.
- `bookingDate` is `YYYY-MM-DD` and cannot be in the past.
- **Both** `startPoint` and `endPoint` are required. A distance-less booking
  prices at base only, which would otherwise allow free rides.
- Omitting `driverId` auto-assigns an `ACTIVE` driver. If none is available the
  request is rejected.
- A vehicle in `MAINTENANCE` cannot be booked.
- A unique DB constraint on `[vehicleId, bookingDate, startTime]` returns
  **409** on a double-book. Surface it as "that slot was just taken", not a
  generic error.

### Status transitions

```
BookingStatus:  PENDING → CONFIRMED | CANCELLED
                CONFIRMED → COMPLETED | CANCELLED
                COMPLETED, CANCELLED → terminal

TripStatus:     NOTSTARTED → INPROGRESS → ARRIVED → COMPLETED
```

Anything else is a 400. `PATCH /bookings/:id/trip-status` with `COMPLETED`
auto-completes the booking and releases the driver.

`DELETE /bookings/:id` cancels: it releases vehicle availability and the
driver, and promotes waitlist position #1. Only `PENDING` and `CONFIRMED`
bookings can be cancelled.

### Queries

```http
GET /bookings?page=1&limit=10&status=PENDING&tripStatus=NOTSTARTED&bookingDate=2026-11-10&vehicleId=UUID
GET /bookings/:id
```

`page` and `limit` arrive as strings and are coerced server-side.

---

## Driver

```http
GET   /driver/profile
PUT   /driver/profile        { fullName, licenseNumber, licenseExpiry, pic }
PATCH /driver/status         { status: "ACTIVE" | "OFF" | "ONLEAVE" }
GET   /driver/bookings?filter=today|upcoming|completed&page=1&limit=10
POST  /driver/vehicles       { vehicleId, isPrimary }
DELETE /driver/vehicles/:vehicleId
GET   /driver/stats?startDate=2026-01-01&endDate=2026-09-30
GET   /driver/:id            PUBLIC — rating included
```

`GET /driver/profile` returns **404** (`errorCode` 1001) for a `CUSTOMER`
token. Do not call it unconditionally; check the role first, or treat 1001 as
"no driver profile" rather than an error state.

`POST /driver/vehicles` rejects a vehicle already assigned to another driver.

`GET /driver/stats` includes daily earnings, net payout after the platform fee,
and trip counts.

---

## Vehicles (public)

```http
GET /vehicles?category=VAN&status=AVAILABLE
GET /vehicles/:id
GET /vehicles/:id/availability?month=2026-09
```

No auth required. `month` is `YYYY-MM`. `GET /vehicles/:id` for an unknown id
returns **400**, not 404.

```ts
interface Vehicle {
  id: string;
  make: string; model: string; year: number;
  plateNumber: string; color: string; capacity: number;
  category: VehicleCategory; status: VehicleStatus;
  basePrice: number; pricePerKm: number; pricePerHour: number;
  description: string;
  createdAt: string; updatedAt: string;  // ISO 8601
  images: VehicleImage[];
}
```

Category default rates, used when the vehicle row has no explicit rate:

| Category | basePrice | pricePerKm | pricePerHour |
|----------|-----------|------------|--------------|
| CAR | 50 | 10 | 25 |
| VAN | 150 | 15 | 40 |
| BUS | 300 | 25 | 60 |
| TRUCK | 250 | 20 | 50 |
| CLASSIC | 200 | 18 | 45 |
| LUXURY | 350 | 30 | 75 |

---

## Payments, wallet, waitlist, packages

```http
POST   /payments                    { bookingId, amount, paymentMethod }
PATCH  /payments/:id/status         { status, transactionRef? }
GET    /payments/:id
POST   /payments/:id/refund
GET    /payments/booking/:bookingId
GET    /payments/summary/:bookingId
```

`amount` must be positive. `paymentMethod` is one of `PAYMOB`, `FAWRY`, `CASH`,
`WALLET`. `PATCH /payments/:id/status` accepts `SUCCESS`, `FAILED`, `REFUNDED`.

```http
GET  /wallet/balance              → { success: true, data: { balance: number } }
GET  /wallet/transactions?page=1&limit=20&type=REFUND
POST /wallet/credit               admin only — { amount, type, description }
POST /wallet/debit                admin only
```

```http
POST   /waitlist                   { vehicleId, requestedDate, requestedTime? }
GET    /waitlist/me
GET    /waitlist/:id
DELETE /waitlist/:id
POST   /waitlist/:id/convert
```

`requestedDate` is `YYYY-MM-DD`, `requestedTime` is `HH:mm`. Conversion creates
a booking from the entry.

```http
POST   /packages                   { packageName, packageType, discountPercentage? }
GET    /packages/me
GET    /packages/:id
POST   /packages/:id/booking       { packageId }
DELETE /packages/:id/booking
PATCH  /packages/:id/cancel
```

`packageType` is `MULTI_CAR` or `MULTI_EVENT`. `discountPercentage` is 0–100,
default 0.

---

## Reviews, chat, referrals, notifications

```http
POST /reviews
{ bookingId, reviewerType, revieweeId, overallRating, vehicleRating?, punctualityRating?, comment? }
GET /reviews/me
GET /reviews/booking/:id
GET /reviews/:id
```

Ratings are integers 1–5. `reviewerType` must match the caller's side
(`CUSTOMER_TO_DRIVER` or `DRIVER_TO_CUSTOMER`); the server enforces this.

```http
GET   /chat/booking/:bookingId            get or fetch the booking's conversation
POST  /chat/booking/:bookingId            create
GET   /chat/:conversationId/messages
POST  /chat/:conversationId/messages      { content, messageType? }
PATCH /chat/:conversationId/read
PATCH /chat/:conversationId/close
```

Polling only — there is no websocket or SSE channel. `messageType` defaults to
`TEXT`.

```http
POST /referrals/generate-code
POST /referrals/apply            { referralCode }
POST /referrals/:id/complete     { bookingId }  PUBLIC
GET  /referrals/me
GET  /referrals/:id
```

`POST /referrals/:id/complete` is public and credits both wallets when the
referred user completes a first booking. Because it is unauthenticated, gate it
by booking ownership on your side rather than trusting it blindly.

```http
GET   /notifications?page=1&limit=20&status=SENT
GET   /notifications/unread-count
PATCH /notifications/:id/read
PATCH /notifications/read-all
```

Reminder notifications (`REMINDER_24H`, `REMINDER_2H`, `REMINDER_30M`) are
scheduled server-side. Poll `unread-count` for a badge; there is no push
delivery to the browser.

---

## Admin

All `/admin/*` routes require `SUPER_ADMIN` or `ADMIN` (plus `authMiddleware`).

```http
GET   /admin/stats/summary
GET   /admin/bookings/calendar?month=2026-09
GET   /admin/bookings?date=2026-09-10&page=1&limit=20
GET   /admin/bookings/all
GET   /admin/vehicles/status
GET   /admin/drivers/:id/stats
GET   /admin/drivers?page=1&limit=20
PATCH /admin/drivers/:id/status
GET   /admin/users?page=1&limit=20&role=CUSTOMER
PATCH /admin/users/role            { userId, roleId }
GET   /admin/settings
PUT   /admin/settings             { performanceHistoryVisible, evaluationsVisible, selfAppraisalsVisible }
```

Admin responses use `{ success: true, data, pagination? }`. Route order matters
on the server: `/admin/bookings/calendar` and `/admin/bookings/all` are
registered before `/admin/bookings`, so both work — no action needed from you.

`PATCH /admin/users/role` is the only way to grant an admin role.

---

## Integration notes

**Recommended booking flow**: `GET /vehicles` → `POST /bookings/estimate-distance`
for the distance display → `POST /bookings/estimate-price` for the quote →
`POST /bookings` → poll or refetch `GET /bookings/:id` for status changes.

**Optimistic UI**: safe for booking **status** transitions (you know the target
state) but not for `POST /bookings` — the 409 double-book conflict is real and
must be surfaced, not retried.

**Caching**: no `Cache-Control` headers are set. `GET /vehicles` is safe to
cache client-side for a session. Availability and booking lists are not —
availability changes the moment someone books.

**Real-time**: none. Poll, or refetch on window focus. `GET /notifications/unread-count`
is the cheapest badge poll; `GET /bookings/:id` is the booking-detail poll.

**Dev credentials** (from `npm run seed`): `admin@mishwarak.com`,
`customer@mishwarak.com`, and two drivers, all with password `secret123`. Every
seeded account returns `twoFactorSetupRequired` from `POST /auth/login` on first
use, so drive the full setup flow at least once. `npm run smoke` creates its own
throwaway accounts with a timestamped phone number, so it is safe to run
repeatedly.

---

## Test scenarios

1. **OTP happy path** — `otp/request` then `otp/verify` with the returned
   `dev_otp`; expect a `token` in the body and subsequent authenticated calls to
   succeed.
2. **Login with no 2FA** — expect `twoFactorSetupRequired: true` with a `secret`
   and QR data URL, and **no** token.
3. **Login setup completion** — `verify-2fa-setup` with that `secret` plus a
   fresh TOTP code; expect a cookie and no body token.
4. **Login challenge** — second login returns `twoFactorRequired: true`; then
   `verify-2fa` with `userId` + code only; expect a cookie.
5. **Validation error** — `POST /bookings` without `endPoint`; expect 422 with
   `errors` naming `endPoint`.
6. **Double booking** — book the same `[vehicleId, bookingDate, startTime]`
   twice; expect 409 on the second.
7. **Permission denied** — call `POST /wallet/credit` with a `CUSTOMER` token;
   expect 403 `errorCode` 4003.
8. **Revoked session** — capture a token, verify an OTP for the same user (which
   bumps `tokenVersion`), then reuse the old token; expect 401 "Session
   invalidated".
9. **Expired or malformed token** — expect 401, never 500.
10. **No driver profile** — `GET /driver/profile` with a `CUSTOMER` token;
    expect 404 `errorCode` 1001 and handle it as an empty state.

---

## Open questions

- Booking status transitions do not have a role-specific matrix beyond the
  state machine; confirm whether customers should be able to move `PENDING` →
  `CONFIRMED` or whether the driver must do it.
- `GET /vehicles/:id` returns 400 for a missing vehicle rather than 404. It was
  left as-is for compatibility; worth normalizing if the frontend prefers 404.
- Payment initiation does not integrate a real gateway; `PATCH
  /payments/:id/status` is how a payment is marked settled today.
