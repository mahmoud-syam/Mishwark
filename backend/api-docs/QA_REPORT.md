# QA Report — Admin Dashboard × Customer App × Driver App

**Date:** 2026-11-16 · **Branch:** `feature/web-dashboard` · **Scope:** the full booking cycle across the customer app, the driver app and the new admin web dashboard.

## How it was tested

The mobile apps are not in this repository, so both apps were simulated through the exact API calls documented in `FRONTEND_INTEGRATION.md`:

- **Clean, isolated environment:** a fresh database with only the base seed and a separate API instance, so every dashboard number had a known expected value.
- **End-to-end cycle:** customer signs up → quotes → books → driver sees, confirms, starts, arrives, completes → reviews, chat, payment → cancellation and waitlist → admin actions flowing back into both apps. The dashboard (overview, calendar, day details, live operations, analytics, audit log) was checked after every step, plus a browser screenshot of live operations while the trip was running.
- **Negative tests:** every per-booking endpoint was called by a user who is *not* on that booking (another customer, another driver).
- **Production-mode check:** auth behaviour with `NODE_ENV=production`.

## Result

| | Count |
|---|---|
| End-to-end checks (final run) | 106 / 106 + 47 / 47 passing |
| API sweep (functional, ownership, no-auth, robustness) | 357 / 357 passing |
| Bugs found and fixed | 17 |
| Product decisions taken and implemented | 7 + SMS/OTP hardening |
| Backend test suite | 379 / 379 passing |

All dashboard numbers matched the database exactly at every step: revenue,
pending bookings, live trips, payments, driver and customer analytics,
complaints, referrals and audit entries.

---

## Final pre-push verification

| Check | Result |
|---|---|
| **API sweep:** all 98 operations called with valid data by the right role | 125 / 125 |
| **Ownership:** another customer on per-resource endpoints | 12 / 12 (404) |
| **No token:** every protected endpoint | 85 / 85 (401) |
| **Robustness:** empty body or unknown id on every write and every parameterised read | 67 / 67 (no 5xx) |
| **End-to-end cycle:** customer app → driver app → dashboard | 103 / 103 |
| **Backend test suite** | 272 / 272 |
| **Dashboard UI:** compiled production server, real 2FA login, every page and flow, Excel exports, 390px mobile | 30 / 30 |
| **Hand-written migrations vs Prisma schema:** fresh DB, 23 models, 235 columns, 24 enums, unique indexes | No differences |
| **Builds:** backend `tsc` + build, dashboard build, API-docs consistency | Pass |

## Production login (OTP): resolved

**Problem:** `POST /auth/otp/request` returned the code as `dev_otp` in every
environment, so anyone could log in as any phone number. On top of that, the
4-digit code never expired and had no attempt limit, so it could be brute-forced.

**Done:**
- **Provider-agnostic SMS module** (`src/v1/services/sms.service.ts`): Twilio, or
  a generic HTTP gateway for an Egyptian provider.
- **Once `SMS_PROVIDER` is set**, the code only travels by SMS and `dev_otp`
  disappears.
- **OTP hardening:** codes expire after 5 minutes, are invalidated after 5 wrong
  guesses, and resends are throttled to one every 60 seconds (429). The codes
  now use a crypto RNG.
- **`0000` test code** is off in production unless `OTP_TEST_BYPASS=true`.

**Remaining:** choose the SMS provider and set its keys before launch. Until
then the server logs a production warning on every start.

---

## Bugs fixed

| # | Severity | Problem (before) | Fix |
|---|---|---|---|
| F-01 | Critical | Any signed-in user could open **any booking** by id (`GET /bookings/:id`), including the other customer's name and phone. | Only the booking's customer, its assigned driver or an admin can read it; others get 404. |
| F-02 | Critical | Any user could **cancel any booking** via `DELETE /bookings/:id` or `PATCH /status`. | Customer (owner) and admin only; drivers get 403; others 404. |
| F-03 | Critical | `PATCH /bookings/:id/status` had no authorization at all: a customer could mark a booking **COMPLETED**, which then counted as revenue on the dashboard. | Role matrix: customer → CANCELLED, driver → CONFIRMED, admin → any (D-6 removed the customer's CONFIRMED). COMPLETED goes through the trip flow. |
| F-04 | High | Cancelling via `PATCH /status` left the vehicle day **blocked** (only `DELETE` released it and promoted the waitlist). | Both paths now use the same cancellation logic. |
| F-05 | High | Anyone could post a **review on any completed booking** against any user id, which could create fake complaints on the dashboard. | Only the trip's customer or driver can review, and the server sets the reviewee. |
| F-06 | High | **Drivers could never read their chats**: the check compared a driver id to a user id. Create, read and close endpoints also had no participant check. | Driver resolved correctly; every chat endpoint is limited to the booking's parties and admins. |
| F-07 | Critical | Any user could **list, settle or refund any payment**. | Payments limited to the booking's parties; refunds are admin-only. |
| F-08 | Critical | Any customer could book on **another customer's account** by sending their `customerId`. | Only admins can set `customerId` (this is how the dashboard's "book on behalf" works). |
| F-09 | Critical | OTP code `0000` logged anyone in, **in every environment**. | Disabled when `NODE_ENV=production` (override with `OTP_TEST_BYPASS=true` for a tester server). |
| F-10 | Medium | The driver app showed **gross income only**, while the dashboard splits income by commission %. | `GET /driver/stats` now also returns `commissionRate`, `companyShare` and `netEarnings`, using the same numbers as the dashboard. |
| F-11 | Low | The docs said INPROGRESS → COMPLETED is rejected; the code allows it. | Docs corrected (ARRIVED is optional). |
| F-12 | High | A trip could be started and completed on a booking that was still PENDING. The trip finished but the booking stayed pending: no revenue, no referral reward, wrong dashboard. | Starting a trip requires a CONFIRMED booking. |
| F-13 | High | Packages, single reviews, single referrals and waitlist entries (view, cancel, convert, add/remove booking) had **no ownership check**: any customer could read or change another customer's. | Owner or admin only; others get 404. |
| F-14 | High | `POST /wallet/credit` and `/debit` adjusted the **admin's own wallet**, so customers never received credits. | Body now takes `userId` (required, validated), and the adjustment is audit-logged. |
| F-15 | Medium | The public `GET /driver/:id` exposed license number and expiry, commission, email and phone. | Returns only id, name, photo, rating, status and vehicles. |
| F-16 | Medium | Invalid input on 10 endpoints returned **500**, and unexpected errors returned the raw Prisma message with server file paths. | One error middleware: validation → 422, malformed JSON → 400, known database errors → 404/409/400, everything else → a generic 500 (details logged only). |
| F-17 | Low | The past-date check used the UTC day. | Uses the Cairo day. |
| F-18 | High | The auth cookie was hard-coded `httpOnly: false, secure: false` with a 7-day life, so any script on the dashboard could read the admin token and it could travel over plain HTTP. | `httpOnly` always, `secure` in production (`COOKIE_SECURE` override), 24 h life to match the JWT. One helper: `utils/authCookie.ts`. Apps unaffected (they use the body token). |
| F-19 | Critical | `POST /bookings` and the price estimate trusted `surgeMultiplier`, `packageDiscount` and `referralDiscount` from the request: a customer could send `surgeMultiplier: 0.01` and pay 1% of the price. | Ignored server-side. The peak surge comes from Settings (applied when `isPeakHour` is true); discounts come only from `packageId` / `referralCode`. Old app builds that send the fields keep working. |
| F-20 | High | `PUT /admin/settings` had no permission check (any admin) and no body validation. | Requires `settings:manage` (Super Admin by default); body validated with ranges, unknown fields refused (422). |
| F-21 | High | Package and referral discounts showed on the estimate but `POST /bookings` never applied them: the customer saw one price and was charged another. | The booking now carries `packageDiscount` and `referralDiscount`; deposit and package total follow the discounted price. |
| F-22 | Critical | A customer set their own package discount (`discountPercentage` up to 100%), and a booking could use any package id, including another customer's. | The customer's value is ignored; an admin sets the % (`PATCH /admin/packages/:id/discount`). A booking may only use the customer's own ACTIVE package (404 / 400). Existing packages reset to 0% by migration. |
| F-23 | High | Any referral code, passed by anyone, took 25 EGP off any estimate, any number of times. | Only a customer who applied a code gets the discount (Settings `referredDiscountAmount`), on their first booking only. Codes can be applied only before the first booking. |
| F-24 | High | Signing up with a referral code set `referredById` but created no referral record, so the referrer was never paid. | Signup creates the PENDING referral (reward from Settings); paid when the first trip completes. |
| F-25 | Low | Package total re-applied the discount on top of booking prices; removing a booking or cancelling the package left its discount. | Package total = sum of booking prices. Leaving the package removes its discount from bookings nothing was paid on. |
| F-26 | Low | The commission split was rounded to whole pounds, differently in the driver app and the dashboard (net 79.09 vs 79 for the same trips, and share + net didn't add up). Showed once discounts produced piaster prices. | Both round to the piaster: share = revenue x rate, net = revenue - share, in `GET /driver/stats` and the dashboard driver report. |
| F-27 | Medium | When the database was unreachable, every endpoint answered 400 "Invalid request", which tells the apps the request was wrong. | Database errors (Prisma P1xxx, failed startup) return 503 "Service temporarily unavailable" and are logged. |
| F-28 | High | The test suite deletes every row before it runs, with no check on which database: `npm test` / `npm run verify` with a normal `.env` would wipe the dev (or production) data. | The suite refuses to run unless the database name contains "test" (override: `ALLOW_TEST_DB_RESET=true`); `resetDatabase` checks again. |

### Fleet management (2026-11-17)

Found while building the fleet page and fixed on `feature/fleet-management`.

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-29 | High | Any driver could attach himself to any car (`POST /driver/vehicles`) and so take its bookings. | Cars are assigned by an admin from the fleet page (`vehicle:manage`); the driver endpoints return 403. |
| F-30 | High | A booking without a driver took the first ACTIVE driver in the whole system, not one of the car's drivers, and failed with 409 if that one driver was busy even when others were free. | Only the car's drivers can drive it: main driver first, then the others, skipping off, on-leave and busy ones. A chosen driver must be one of them. |
| F-31 | Medium | Putting a car in MAINTENANCE by hand ignored its bookings (they stayed on a car marked unavailable) and was never undone automatically. | Maintenance is scheduled with dates: refused (409, with the bookings listed) on booked days, blocks its days, and the status follows the dates. Existing manual MAINTENANCE cars were converted by the migration. |
| F-32 | Medium | Car photos were only checked by the type the browser declares, so a renamed text file was accepted as an image. | The file's first bytes must be a real JPG, PNG or WEBP of the declared type; refused uploads leave nothing on disk. |
| F-33 | Low | `GET /vehicles/:id` returned 400 for an unknown car. | 404, also for retired and driverless cars. |

Still open: signup (`POST /auth/signup`, `pic` and documents) has the same
declared-type-only check as F-32. Not changed here; worth the same fix.

### Team accounts & sign-in (2026-11-17)

Found while building the Team page and fixed on `feature/team-accounts`.

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-34 | Critical | `POST /auth/verify-2fa-setup` took a `userId` and a 2FA secret chosen by the caller, without checking the password or that 2FA was off. Anyone who knew an account's id (the Super Admin's included) could attach their own authenticator and sign in without the password. | `POST /auth/login` now hands out a signed `loginToken` (5 minutes, one step, single use) after the password is checked; the next steps refuse a bare `userId`. The 2FA secret travels inside the signed pass, never from the caller. |
| F-35 | High | `POST /auth/verify-2fa` also took only `userId` + code: the password step could be skipped, leaving the 6-digit code as the only factor. | Same `loginToken` requirement. A wrong code changes nothing. |
| F-36 | High | `PUT /auth/change-password/:userId` and `POST /auth/reset-2fa/:userId` let any admin holding `user_password:manage` reset any account, including the Super Admin's. No password rules (an empty or 1-character password was accepted). | Dashboard accounts are reset by a Super Admin only (403); passwords need 8+ characters (422). The Team page is the place for dashboard accounts. |
| F-37 | Low | The authenticator app showed the accounts as "ACS Portal". | Shown as "Mishwark". |

### Sign-in limits & disabling accounts (2026-11-17)

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-38 | High | No limit on sign-in attempts: passwords, 2FA codes and OTP codes could be guessed without end (OTP only reset its own counter after 5). | 5 wrong attempts per device and account → that device is blocked from that account for 15 minutes (the owner elsewhere is unaffected, so nobody can lock someone out on purpose). A device failing across 30 accounts is blocked from all. Per-IP request limits on `/auth` (100/15 min) and `/auth/otp/request` (10/15 min, SMS cost). |
| F-39 | Medium | No security headers; anyone leaving the team kept a working account (resets only). | helmet headers on every response and a strict Content-Security-Policy on the dashboard. A Super Admin can disable and re-enable team accounts (signed out at once, history kept). |

Deploying behind Cloudflare Tunnel needs nothing more (`TRUST_PROXY=loopback`,
the default). Behind another proxy set `TRUST_PROXY`, or every visitor shares
the proxy's address and the per-IP limits hit everyone at once. Counters are
in memory: right for one API instance.

### Review of the whole cycle (2026-11-17)

A second pass that acted as a tester across admin, customer and driver flows
(`probe` script, 16 exploratory checks). Fixed:

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-40 | High | Driver and employee documents (national ID, licence, criminal record) were downloadable by anyone with the link. | Only profile pictures and car photos are public. Signup keeps only the profile picture, refuses a fake image, and deletes every other uploaded file. |
| F-41 | High | `010…`, `+2010…` and `0020…` were three different accounts for the same phone. | Every phone is stored as `+20…` (OTP sign-in, customers added from the dashboard). Existing numbers were converted by a migration when that caused no clash. |
| F-42 | High | A booking could be made today for a time that had already passed. | Refused when the start is more than 15 minutes in the past (Cairo time). |
| F-43 | High | Removing a driver from a car left that car's upcoming trips with a driver who no longer drives it. | 409 that lists the trips; move them first. |
| F-44 | High | Putting a driver on leave (or off) gave no sign of the trips they still hold. | New overview alert `driver_unavailable` with the number of trips and the first date. |
| F-45 | Medium | A driver whose licence had expired could be assigned. | Skipped by auto-assignment; refused (400) when chosen by hand. |
| F-46 | Medium | `?limit=` had no ceiling (`limit=100000` returned everything). | Every list caps the page at 100. |
| F-47 | Medium | 2FA could be turned off with just a session. | Needs the current 6-digit code. |
| F-48 | Medium | Logout only cleared the cookie; a copied token kept working until it expired. | Logout revokes the token (one session per account, so nothing else is signed out). |
| F-49 | Low | Price estimate worked for a retired car; a malformed 2FA secret gave a 500; a missing or short `JWT_SECRET` was only found on the first sign-in. | 400 for both; the API refuses to start without `JWT_SECRET` (32+ characters in production). |

### Booking policies (2026-11-18)

The four open product questions, implemented with defaults that can all be
changed on the Settings page (for the owner to review):

| Question | Default |
|---|---|
| Trips past midnight | Allowed; must end by 06:00 (0 turns them off). Clash checks cover the day before and after. |
| Booking horizon / shortest trip | 365 days ahead, at least 30 minutes. |
| Deposit on cancellation | Cancelled 48 h+ before: everything paid back to the wallet. Later: deposit kept, the rest back. An admin can decide either way. |
| Temporary password expiry | 7 days. |

Found while testing them:

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-50 | High | A cancelled booking kept its slot: the same car couldn't be booked again that day at the same start time (unique index counted cancelled bookings). | Partial unique index on active bookings only. |
| F-51 | Medium | The dashboard had no way to find, confirm or cancel a booking outside the day view. | New Bookings page (search by ref/name/phone, status tabs, payment filter) with confirm, complete, payments and cancel. |
| F-52 | Low | An admin confirming or cancelling a booking wasn't in the audit log. | Logged with the old and new status, and the money settled on cancel. |
| F-53 | Low | `HH:mm` accepted impossible times like 25:99. | Validated as 00:00 to 23:59. |

### Easy sign-up for customers (2026-11-18)

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-54 | Critical | A dashboard account (Admin or Super Admin) could sign in with an SMS code to its phone number, skipping the password and 2FA. | OTP is refused for dashboard accounts, on request (no SMS sent) and on verify. |
| F-55 | Medium | Customers had to request a new SMS code every 24 hours, and there was no way for them to give or change their name or email. | App sessions last 30 days (`APP_SESSION_DAYS`); `PATCH /auth/me`; `profileComplete` tells the app when to ask for the name. |

### Team profile (2026-11-18)

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-57 | Medium | A team member couldn't change their own name, photo or password; only a Super Admin could reset a password, and that endpoint didn't ask for the current one. | Profile page (click your name in the side menu): name, photo (`PUT/DELETE /auth/me/photo`, real-image check, random file name, old file deleted unless another account uses it) and password (`POST /auth/me/password`: current password required and counted toward the lockout, other sessions signed out, this one kept). Photos show in the side menu and on the Team page. |

### Driver documents (2026-11-18)

| # | Severity | Problem | Fix |
|---|---|---|---|
| F-56 | High | Drivers' papers sent at signup were never linked to the driver (and, before F-40, sat in a public folder). The office had no way to see or check them. | Private storage (`DRIVER_DOCUMENTS_DIR`, outside every public folder), uploads at signup or later (`POST /driver/documents`), real-type check, downloads only for the driver and the dashboard, review with a reason the driver sees, a home alert and a status on every driver card. |

### Pricing by service type (2026-11-18)

The price was base + km × rate + **driving** time × rate: a 7 pm to 1 am wedding
was charged for the 30 minutes of driving, not the six hours booked, and the
breakdown showed bare numbers. Replaced with the owner's model, all editable on
a new Pricing page:

- Wedding: a fixed price per car (or the default), covering hours and km; each
  started extra hour and each extra km is charged.
- Private trip: from the company in Sharqia to a listed destination at a fixed
  price per car category, or anywhere else at the category's price; km beyond
  the included ones (150 by default) are extra.
- VIP: a fixed price per occasion, like a wedding with its own prices.

The quote and the booking show the price as itemised lines (what the price
covers, the extras with quantity × unit price, discounts, deposit). Requests
without a service type keep the older per-km price for app versions that
aren't updated.

### Booking map (2026-11-18)

Book on behalf used a fixed list of 11 places (plus free text the server had
to guess). It now opens a map of Egypt: search any place, or click / drag a
pin; the address fills in by itself and can be edited, and the booking stores
the exact coordinates. Built on OpenStreetMap (free, no account): Photon for
search as you type, Nominatim for pin-to-address, both through the API
(`/places/search`, `/places/reverse`) with a day's cache and a per-IP limit.
The mobile apps can use the same endpoints.

New: Team page (Super Admin only) to create dashboard accounts with a
temporary password (changed at first sign-in, then 2FA), reset 2FA or the
password, and change the role. Every action signs the member out and is
audit-logged.
