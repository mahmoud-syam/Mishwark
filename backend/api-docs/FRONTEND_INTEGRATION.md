# Mishwarak API — Frontend Integration Guide

Base URL: `http://localhost:5000/api/v1`
Interactive docs: `http://localhost:5000/api-docs/` (Try it out is enabled)
Machine-readable spec: `http://localhost:5000/api-docs.json`

100 operations across 91 paths. They are exercised by the backend test suite
(`npm test` in `backend/`) and a live API sweep, so the shapes here are verified.

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

Validation failures are always **422** with Zod issues in `errors`, malformed
JSON is **400**, and an unexpected server error is a generic **500**
("Something went wrong") — internal details are logged, never returned.

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

**Recommended customer flow (easy sign-up):** let people browse with no
account (`GET /vehicles`, `GET /vehicles/:id`, `POST /bookings/estimate-price`
are public). Ask for the phone number only when they tap "book", keep their
choices (car, date, times, places) in the app while they enter the code, then
go straight back to the booking confirmation. If `profileComplete` is false,
ask for the name on that confirmation screen and save it with `PATCH /auth/me`
before `POST /bookings`. No email or password for customers.

```http
POST /auth/otp/request
{ "phoneNumber": "+201001234567" }              // name and role are optional
{ "phoneNumber": "+201001234567", "role": "customer", "name": "Ahmed" }
```

Dashboard accounts (Admin, Super Admin) can't use OTP: **403** "Dashboard
accounts sign in with email, password and 2FA", on request and on verify.

Phone numbers are stored as `+20…`. `01001234567`, `+20 100 123 4567` and
`00201001234567` all reach the same account, on request and verify alike.

`role` is `customer` (default) or `driver`. Only used when the phone number is
new; for an existing phone the account's role is untouched. Drivers must send
`licenseNumber`.

The 4-digit code is sent by SMS once the server has an SMS provider
(`SMS_PROVIDER`); until then it is returned as `dev_otp` so development works.
Codes expire after 5 minutes and die after 5 wrong attempts ("OTP code
expired"). Requesting a new code within 60 seconds returns **429**; a failed SMS
returns **502** and can be retried immediately.

```http
POST /auth/otp/verify
{ "phoneNumber": "+201001234567", "code": "123456" }
```

```json
{
  "message": "OTP verified successfully",
  "token": "<JWT>",
  "role": "CUSTOMER",
  "user": { "id": "...", "name": "...", "email": null, "tokenVersion": 0, "role": { "id": "...", "name": "CUSTOMER", "permissions": [] } },
  "profileComplete": false
}
```

The token lasts **30 days** (server setting `APP_SESSION_DAYS`), so customers
and drivers don't need a new code every day. Logout, signing in on another
device, or a disabled account still end it at once (401: sign in again).
`profileComplete` is false while the account has no name yet (signed up with
the phone number only).

**Profile.** `GET /auth/me` returns `{ id, name, pic, email, phoneNumber,
preferredLanguage, role, profileComplete }` (`pic` is a path such as
`/uploads/employees/pic-<uuid>.jpg`, or `""`). The signed-in user updates their
own details with:

```http
PATCH /auth/me
{ "name": "Mona Adel", "email": "mona@example.com", "preferredLanguage": "ar" }
```

All fields optional; `email: null` clears it. Name 2 to 80 characters (422),
an email already used by another account is **409**, unknown fields (like
`phoneNumber`, which is the sign-in and can't change here) are **422**.
Returns the same shape as `GET /auth/me`.

The user's own photo (optional, any account):

```http
PUT    /auth/me/photo   multipart/form-data: photo=<JPG, PNG or WEBP, 5 MB>
DELETE /auth/me/photo
```

Both return the same shape as `GET /auth/me`. A file that isn't really an
image is a 400; above 5 MB is a 413.

This is the **only** flow that returns the JWT in the body. The code `0000` is
accepted as a testing bypass outside production only (or when the server sets
`OTP_TEST_BYPASS=true`).

### 2. Login (always 2FA-gated)

```http
POST /auth/login
{ "email": "...", "password": "..." }
```

`POST /auth/login` **never** returns a token. It answers with the next step
and a **`loginToken`**: a signed pass for that step only, valid 5 minutes and
usable once. All HTTP 200:

```json
// Temporary password (account created or reset by a Super Admin): pick a new one
{ "message": "Choose a new password", "passwordChangeRequired": true, "userId": "UUID", "loginToken": "eyJ..." }
```

```json
// 2FA not set up yet — enable it before the user can log in
{ "message": "2FA setup required", "twoFactorSetupRequired": true, "userId": "UUID", "secret": "BASE32", "qrCodeDataURL": "data:image/png;base64,...", "loginToken": "eyJ..." }
```

```json
// 2FA already enabled — answer the challenge
{ "message": "2FA required", "twoFactorRequired": true, "userId": "UUID", "loginToken": "eyJ..." }
```

Then, depending on which you got:

| Login said | Call | Body |
|-----------|------|------|
| `passwordChangeRequired` | `POST /auth/set-password` | `{ "loginToken", "newPassword" }` (8+ characters, not the temporary one). Answers with the next step, like login |
| `twoFactorSetupRequired` | `POST /auth/verify-2fa-setup` | `{ "loginToken", "token" }` — the 6-digit code; the secret travels inside the pass |
| `twoFactorRequired` | `POST /auth/verify-2fa` | `{ "loginToken", "token" }` |

**Limits (all sign-in steps, OTP included).** 5 wrong passwords or codes for
one account from one device (IP) block that device from that account for 15
minutes: **429** with `errors.retryAfterSeconds`, even for the right password.
Show "too many attempts, try again in N minutes"; don't retry automatically.
The account owner on another device is not affected. Besides that, `/auth/*`
allows 100 requests per IP per 15 minutes and `/auth/otp/request` 10 (429
with standard `RateLimit` headers). A disabled team account gets **403**
"This account is disabled".

> **Changed (17 Nov 2026):** these steps used to take `userId` (and, for
> setup, a `secret` from the client). That let anyone who knew an account's
> id attach their own authenticator and sign in without the password, so a
> bare `userId` is now refused with 400. Send the `loginToken` from the
> previous step instead. A 400 saying "Sign in again" or "expired" means the
> pass expired or was used: start again from `POST /auth/login`. The success
> reply now has the user under `user` (`optimizedUser` is still sent).

Both 2FA verification routes set the JWT as a **`token` cookie only**, with
nothing in the body. With `credentials: 'include'` the cookie arrives
automatically; otherwise read `Set-Cookie` and attach it as `Authorization:
Bearer <token>` yourself (native HTTP clients can read `Set-Cookie`;
browser JavaScript can't). The cookie is `httpOnly`, `sameSite: lax`, and
`secure` when `NODE_ENV=production` (override with `COOKIE_SECURE`). Its
max age is 24 hours, the same as the JWT inside it.

If a wrong TOTP code is sent, `tokenVersion` is **not** incremented, so the
user's other sessions survive.

### 3. Signup

`POST /auth/signup` is `multipart/form-data`, not JSON. Fields: `name`,
`email`, `password`, `role` (`customer`|`driver`), `phoneNumbers` (JSON-encoded
array in a text part, e.g. `[{"number":"+201001234567"}]`), `pic` (file part),
`licenseNumber` + `licenseExpiry` (required when `role=driver`), optional
`referralCode`.

Only `pic` is kept, and it must be a real JPG, PNG or WEBP (400 otherwise);
any other uploaded file is discarded. Driver documents are not public.

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
change, 2FA reset and logout — so all of these sign the target user out
everywhere. After `POST /auth/logout` the same token gets 401; drop it locally.

### 2FA management (authenticated)

```http
GET  /auth/2fa/setup    → { "secret": "BASE32", "qrCodeDataURL": "data:image/png;base64,..." }
POST /auth/2fa/verify   → { "token": "123456", "secret": "BASE32" }  // both required
POST /auth/2fa/disable  → { "token": "123456" }  // current code, required while 2FA is on
```

`/auth/2fa/verify` stores the secret and flips `twoFactorEnabled`. Missing
`token` or `secret`, or a malformed secret, is a 400, not a 500.

Temporary passwords for dashboard accounts (Team page) expire after
`tempPasswordDays` (7 by default): signing in with one after that is **403**
"This temporary password has expired"; a Super Admin issues a new one.

### Admin credential management

```http
PUT  /auth/change-password/:userId   { "newPassword": "min8chars", "reset2FA": false }
POST /auth/reset-2fa/:userId         no body
```

Both require the `user_password:manage` permission. There is no `oldPassword`
field — the caller holds the permission. Every call bumps `tokenVersion`.
Dashboard accounts (Admin, Super Admin) can only be reset by a Super Admin
(403 otherwise); the dashboard's Team page does that. Passwords are 8+
characters (422 otherwise).

---

### Driver documents (ID, licence, criminal record)

A driver uploads five papers: `NATIONAL_ID_FRONT`, `NATIONAL_ID_BACK`,
`LICENSE_FRONT`, `LICENSE_BACK`, `CRIMINAL_RECORD`. JPG, PNG, WEBP or PDF, up to
10 MB, checked by the file's content (a renamed file is a 400). They are stored
privately: no public URL, only the driver and the dashboard team can open them.

Two ways, use either:

1. **With signup** (`POST /auth/signup`, role `driver`): file fields
   `nationalIdFront`, `nationalIdBack`, `licenseFront`, `licenseBack`,
   `criminalRecord`. The response lists them in `documents`
   (`[{ field, status: "PENDING" }]`, or `"FAILED"` with `error`); a bad file
   doesn't undo the signup, upload it again with option 2.
2. **After signing in** (the OTP flow): one paper per request.

```http
POST /driver/documents          multipart/form-data: type=LICENSE_FRONT, file=<photo>
GET  /driver/documents          → { documents: [{ type, status, reviewNote, uploadedAt, id }], summary: { state } }
GET  /driver/documents/:id/file → the paper itself (driver's own only)
```

`status` per paper: `MISSING`, `PENDING` (waiting for the office), `APPROVED`,
`REJECTED` with `reviewNote` (show it: "الصورة مش واضحة"). Uploading the same
type again replaces it and sends it back to review. `summary.state` is the
overall picture for a "your papers" screen: `MISSING` → `PENDING` → `APPROVED`,
or `REJECTED` when one needs re-uploading.

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

> **Package and referral discounts.** Send the Bearer token with
> `POST /bookings/estimate-price` so the quote includes the customer's own
> discounts; the response has `packageDiscount` and `referralDiscount`, and the
> booking stores the same fields. A package's discount % is set by an admin, so
> a new package starts at 0% (`discountPercentage` in `POST /packages` is
> ignored). A referred customer gets the referral discount on their first
> booking automatically; `POST /referrals/apply` returns 400 once they have
> booked, so offer the code field only before the first booking.

> **Pricing fields the server ignores.** `surgeMultiplier`, `packageDiscount`
> and `referralDiscount` in a request body are ignored. The server applies the
> peak surge from the admin Settings when `isPeakHour` is true, and discounts
> only from `packageId` / `referralCode`. Deposit % and default prices per car
> type are also admin settings, so always show the amounts the API returns.


Each endpoint accepts exactly one location shape:
`{latitude, longitude}`, `{startLat, startLng}`, `{lat, lng}`, or a plain place
name string (geocoded). Free text geocoding needs `ORS_API_KEY`; without it the
server falls back to a straight-line estimate and says so in `route.source` and
`route.warning`.

`customBasePrice`, `customPricePerKm` and `customPricePerHour` are **rejected**
if sent — pricing is server-authoritative. Distance and duration are always
recomputed server-side. Any `distanceKm` you send is only echoed back under
`comparison` and never priced, so don't bother computing it client-side.

### Prices: wedding, private trip, VIP

Every booking has a **service type**, and each type has its own pricing (all
of it is edited by the owner on the dashboard's Pricing page):

| `serviceType` | Price | Extras |
|---|---|---|
| `WEDDING` | The car's own fixed price (`weddingPrice` on the vehicle), or the default | Covers N hours and N km; each started extra hour and each extra km is charged |
| `TRIP` | From the company (Sharqia) to a listed destination: fixed price per car category. Any other place: the category's "another place" price | Covers N km (150 by default); each extra km is charged |
| `VIP` | The car's own VIP price, or the VIP default | Like a wedding, with its own prices |

`GET /pricing` (public) returns the rules, the start point and the destinations
with their prices per category, so the app can show "from …" prices. The exact
price always comes from the API:

```http
POST /bookings/estimate-price
{ "serviceType": "WEDDING", "vehicleId": "…", "startPoint": {…}, "endPoint": {…},
  "startTime": "19:00", "endTime": "01:00" }

{ "serviceType": "TRIP", "vehicleId": "…", "destinationId": "…" }   // no points needed

→ { "data": { "totalPrice": 2200, "depositRequired": 440, … },
    "lines": [
      { "code": "wedding", "amount": 1600, "includedHours": 4, "includedKm": 50 },
      { "code": "extra_hours", "quantity": 2, "unitPrice": 300, "included": 4, "amount": 600 }
    ],
    "bookedMinutes": 360, "depositRate": 20, "route": { "distanceKm": 4.1, "source": "haversine" } }
```

Show `lines` as the price breakdown (codes: `wedding`, `vip`, `trip` (with
`name`), `trip_other`, `extra_hours`, `extra_km`, `package_discount`,
`referral_discount`; negative amounts are discounts), then the total and the
deposit. `route.source: "haversine"` means the distance is an estimate. Send the
same `serviceType` / `destinationId` to `POST /bookings`; the booking keeps them
with `priceLines`. Without `serviceType` the older per-km price still applies
(for app versions that aren't updated yet).

### Choosing places on a map

`startPoint` / `endPoint` should be exact coordinates with a name:
`{ "latitude": 30.0749, "longitude": 31.3462, "label": "قاعة الماسة، مدينة نصر" }`.
The API offers place search and pin-to-address on OpenStreetMap data, no key
needed on your side (no account required either):

```http
GET /places/search?q=قاعة الماسة&lat=30.04&lng=31.23   // lat/lng = map centre, optional
→ [{ "name": "قاعة الماسة", "detail": "مدينة نصر، القاهرة", "label": "قاعة الماسة، مدينة نصر، القاهرة",
     "latitude": 30.0749, "longitude": 31.3462, "kind": "amenity:events_venue" }]

GET /places/reverse?lat=30.07212&lng=31.33181      // after the user drops or drags a pin
→ { "name": "...", "detail": "...", "label": "...", "latitude": 30.07212, "longitude": 31.33181 }
```

Search as the user types (debounce ~350 ms, at least 2 characters). Egypt
only. Search returns **502** when the provider is down: let the user drop a pin
instead. Reverse never fails for a point in Egypt (worst case the label is the
coordinates); let the user edit the label ("البوابة 2"). For the map itself use
OpenStreetMap tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the
"© OpenStreetMap" credit) or any map SDK; only the coordinates matter to the API.

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
- Both times are `HH:mm` (00:00 to 23:59) and can't be equal. An `endTime`
  **earlier** than `startTime` means the trip ends the next morning (a wedding
  from `22:00` to `01:00`). It must end by the hour set in the dashboard
  Settings (06:00 by default): otherwise **400** "A trip can run past midnight
  but must end by 06:00". Show "ends the next day" in your UI when end < start.
- `bookingDate` is `YYYY-MM-DD`, can't be in the past, and at most
  `maxAdvanceBookingDays` ahead (365 by default): **400** "Trips can be booked
  up to 365 days ahead".
- A trip shorter than the minimum in Settings (30 minutes by default):
  **400** "A trip must be at least 30 minutes long".
- **Both** `startPoint` and `endPoint` are required. A distance-less booking
  prices at base only, which would otherwise allow free rides.
- Only the car's own drivers can drive it (the admin assigns them on the fleet
  page). A `driverId` that isn't one of them returns **400** "This driver isn't
  assigned to this car". Omitting `driverId` tries the car's main driver first,
  then its other drivers, skipping anyone off, on leave or busy at that time.
  If none of them is free: **409** "No driver of this car is free at this time".
  A car with no driver: **400** "This car has no driver assigned yet" (such
  cars are not listed by `GET /vehicles`, so this only happens with a stale list).
- A retired car returns **400** "This car is no longer available", and a day
  with scheduled maintenance returns **400** "This car is in maintenance on that
  day". `GET /vehicles/:id/availability` shows those days as BLOCKED.
- A vehicle can take several trips a day, but trips of the same vehicle or
  driver must be at least the gap set in the dashboard Settings apart (60 minutes by default);
  otherwise **409**. Only a day marked BLOCKED (e.g. maintenance) is closed.
- A new booking is `PENDING` with `depositRequired` (20% of the price) and
  `depositPaid: 0`. It becomes `CONFIRMED` automatically once confirmed payments
  cover the deposit, or when the driver/admin confirms it.
- A unique DB constraint on `[vehicleId, bookingDate, startTime]` (active
  bookings only, so a cancelled booking frees its slot) returns **409** on a
  double-book. Surface it as "that slot was just taken", not a generic error.
- Gaps and clashes are checked across midnight: a 22:00 to 01:00 trip blocks
  the same car and driver until 02:00 the next day (with the default 60-minute
  gap), and maintenance on the next day blocks it.

### Status transitions

```
BookingStatus:  PENDING → CONFIRMED | CANCELLED
                CONFIRMED → COMPLETED | CANCELLED
                COMPLETED, CANCELLED → terminal

TripStatus:     NOTSTARTED → INPROGRESS → ARRIVED → COMPLETED
                (INPROGRESS → COMPLETED is also accepted; ARRIVED is optional)

Starting a trip (INPROGRESS) requires a CONFIRMED booking, and a driver can
start it at most 2 hours before its slot, Cairo time (TRIP_EARLY_START_MINUTES).
Admins are exempt from the time window only.
```

Anything else is a 400. `PATCH /bookings/:id/trip-status` with `COMPLETED`
auto-completes the booking and releases the driver.

`DELETE /bookings/:id` cancels: it releases vehicle availability and the
driver, and promotes waitlist position #1. Only `PENDING` and `CONFIRMED`
bookings can be cancelled.

**Cancellation and the deposit.** Before the customer confirms, show what
happens to their money:

```http
GET /bookings/:id/cancellation
→ { "paid": 1390, "refund": 0, "kept": 1390, "outcome": "KEPT",
    "freeUntil": "2026-11-16T19:00:00.000Z", "freeCancellationHours": 48 }
```

Cancelled at least `freeCancellationHours` (48 by default) before the start:
everything paid goes back to the customer's **wallet**. Later: the deposit is
kept and anything paid above it goes back. Nothing paid: nothing to settle
(`outcome: null`). The cancelled booking carries `cancelledAt`,
`depositOutcome` (`REFUNDED` | `KEPT` | null) and `depositRefunded`; the
DELETE response also has `cancellation` with the same numbers. An admin can
send `{ "refundDeposit": true }` (or `false`) to decide either way; a customer
sending it is ignored.

### Who can act on a booking

`GET /bookings/:id`, cancelling, payments, chat and reviews are limited to the
booking's customer, its assigned driver and admins; anyone else gets **404**.

| Action | Customer (owner) | Assigned driver | Admin |
|---|---|---|---|
| `PATCH /status` → `CONFIRMED` | ✗ (pay the deposit) | ✓ | ✓ |
| `PATCH /status` → `CANCELLED` / `DELETE` | ✓ | ✗ | ✓ |
| `PATCH /status` → `COMPLETED` | ✗ (use trip-status) | ✗ (use trip-status) | ✓ |
| `POST /payments/:id/refund` | ✗ | ✗ | ✓ |

Reviews: the server sets `revieweeId` from the booking (the other party);
sending a different one is a 400.

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
GET   /driver/stats?startDate=2026-01-01&endDate=2026-09-30
GET   /driver/:id            PUBLIC — id, fullName, pic, rating, status, vehicles only
```

`PATCH /driver/status` returns **403** when an admin set the driver's current
OFF/ONLEAVE status from the dashboard; only an admin can lift it. A status the
driver set himself stays his to change.

`GET /driver/profile` returns **404** (`errorCode` 1001) for a `CUSTOMER`
token. Do not call it unconditionally; check the role first, or treat 1001 as
"no driver profile" rather than an error state.

**Changed:** `POST /driver/vehicles` and `DELETE /driver/vehicles/:vehicleId`
now always return **403** "Cars are assigned to drivers by the administration".
Remove the "pick my car" screen from the driver app; the driver's cars come
from the admin.

`GET /driver/stats` returns trip counts, `totalRevenue` (gross),
`commissionRate`, `companyShare` and `netEarnings` (gross minus the company's
commission, the same split the admin dashboard shows).

---

## Vehicles (public)

```http
GET /vehicles?category=VAN&status=AVAILABLE
GET /vehicles/:id
GET /vehicles/:id/availability?month=2026-09
```

No auth required. `month` is `YYYY-MM`.

- Only cars customers can book are listed: retired cars and cars with no driver
  are hidden. `GET /vehicles/:id` returns **404** for those and for unknown ids
  (it used to return 400).
- `status` is worked out for today: `AVAILABLE`, `BOOKED` (has a trip today) or
  `MAINTENANCE` (maintenance scheduled today). It is no longer set by hand.
- `images` come cover first: use `images[0]` as the car's main photo, and show a
  placeholder when the list is empty.
- New fields `luggage` (number of bags) and `features` (labels such as
  "تكييف", "واي فاي") are for the car details screen.

```ts
interface Vehicle {
  id: string;
  make: string; model: string; year: number;
  plateNumber: string; color: string; capacity: number;
  category: VehicleCategory; status: VehicleStatus;
  basePrice: number; pricePerKm: number; pricePerHour: number;
  description: string;
  luggage: number;          // new
  features: string[];       // new, shown as chips
  createdAt: string; updatedAt: string;  // ISO 8601
  images: VehicleImage[];   // cover first; { id, imageUrl, isCover, sortOrder }
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

`amount` must be positive and at most `totalPrice − depositPaid`; the customer
can pay the deposit first or everything at once. `paymentMethod` is one of
`PAYMOB`, `FAWRY`, `CASH`, `WALLET`.

**Who confirms a payment** (`PATCH /payments/:id/status`, `SUCCESS` / `FAILED`):
an admin (any method, from the dashboard's payment window) or the booking's
assigned driver (`CASH` only, for cash he collected). The customer app creates
the payment and then waits; it cannot mark it paid (403). When a gateway is
integrated, its webhook settles online payments.

On every confirmed payment the booking's `depositPaid` (sum of confirmed
payments) and `paymentStatus` are recalculated, and a `PENDING` booking whose
deposit is covered becomes `CONFIRMED`. `GET /payments/summary/:bookingId`
returns `depositRequired`, `depositDue`, `totalPaid` and `remaining`.

```http
GET  /wallet/balance              → { success: true, data: { balance: number } }
GET  /wallet/transactions?page=1&limit=20&type=REFUND
POST /wallet/credit               admin only — { userId, amount, type, description? }
POST /wallet/debit                admin only — same body
```

```http
POST   /waitlist                   { vehicleId, requestedDate, requestedTime? }
GET    /waitlist/me
GET    /waitlist/:id
DELETE /waitlist/:id
POST   /waitlist/:id/convert
```

`requestedDate` is `YYYY-MM-DD`, `requestedTime` is `HH:mm`. When a slot frees
up, entry #1 becomes `NOTIFIED`; `POST /waitlist/:id/convert` marks it
`CONVERTED` and the app then creates the booking with `POST /bookings` (route
and times are needed). Waitlist entries, packages, single reviews and
referrals are visible only to their owner (and admins); others get 404.

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
GET  /referrals/me
GET  /referrals/:id
```

The reward is paid by the server: when the referred customer's trip
completes, the referral flips to `COMPLETED` and both wallets are credited
(once). There is no client endpoint for it any more.

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

The web dashboard's fleet page uses `GET/POST /admin/vehicles`,
`GET/PATCH /admin/vehicles/:id`, `.../retire`, `.../reactivate`,
`PUT .../drivers`, photo upload/cover/delete and maintenance endpoints (all
changes need `vehicle:manage`). The apps don't call these; see the API docs.
`PUT .../drivers` returns 409 with `errors.bookings` when a driver being
removed still has upcoming trips on that car. `GET /admin/overview` alerts
include `driver_unavailable` (a driver who is off or on leave but still holds
upcoming trips).

---

## Integration notes

**Recommended booking flow**: `GET /vehicles` → `POST /bookings/estimate-distance`
for the distance display → `POST /bookings/estimate-price` for the quote →
`POST /bookings` → poll or refetch `GET /bookings/:id` for status changes.

**Optimistic UI**: safe for booking **status** transitions (you know the target
state) but not for `POST /bookings` — the 409 double-book conflict is real and
must be surfaced, not retried.

**Booking rules worth surfacing**: a start time more than 15 minutes in the
past today is a 400 ("This start time has already passed"). A retired car gets
400 from `POST /bookings/estimate-price` ("This car is no longer available").
Drivers whose licence has expired are never auto-assigned; choosing one by hand
is a 400.

**Page size**: every `?limit=` is capped at 100; read `pagination.limit` back.

**Caching**: no `Cache-Control` headers are set. `GET /vehicles` is safe to
cache client-side for a session. Availability and booking lists are not —
availability changes the moment someone books.

**Real-time**: none. Poll, or refetch on window focus. `GET /notifications/unread-count`
is the cheapest badge poll; `GET /bookings/:id` is the booking-detail poll.

**Dev credentials** (from `npm run seed`): `admin@mishwarak.com`,
`customer@mishwarak.com`, and two drivers, all with password `secret123`. Every
seeded account returns `twoFactorSetupRequired` from `POST /auth/login` on first
use, so drive the full setup flow at least once.

---

## Test scenarios

1. **OTP happy path** — `otp/request` then `otp/verify` with the returned
   `dev_otp`; expect a `token` in the body and subsequent authenticated calls to
   succeed.
2. **Login with no 2FA** — expect `twoFactorSetupRequired: true` with a `secret`,
   QR data URL and `loginToken`, and **no** session token.
3. **Login setup completion** — `verify-2fa-setup` with that `loginToken` plus a
   fresh TOTP code; expect a cookie. The same `loginToken` a second time: 400.
4. **Login challenge** — second login returns `twoFactorRequired: true`; then
   `verify-2fa` with its `loginToken` + code; expect a cookie.
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
