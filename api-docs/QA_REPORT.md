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
| End-to-end checks (final run) | 103 / 103 passing |
| API sweep (98 operations: functional, ownership, no-auth, robustness) | 289 / 289 passing |
| Bugs found and fixed | 17 |
| Product decisions taken and implemented | 7 + SMS/OTP hardening |
| Backend test suite | 272 / 272 passing (+26 new tests) |

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
