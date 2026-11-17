# Mishwark Admin Dashboard

Arabic (RTL) web dashboard for Mishwark admins, built from the Figma file
(screens 07, 18, 21–25). React 19 + Vite + TypeScript + Tailwind v4 +
TanStack Query. It talks to the API in `../backend` only.

## Run it

```bash
# 1. API
cd backend
cp .env.example .env            # set DATABASE_URL, JWT_SECRET
npm ci
npx prisma migrate deploy
npm run seed                    # roles + admin@mishwarak.com / secret123
npm run seed:demo               # optional: realistic Arabic demo data around today
npm run dev                     # API on :5000

# 2. Dashboard (dev, hot reload), in another terminal
cd frontend
npm ci
npm run dev                     # http://localhost:3000/dashboard  (proxies /api to :5000)
```

First login as admin shows a QR code: scan it with Google/Microsoft
Authenticator, then enter the 6-digit code. After that every login asks for the
code.

## Production

```bash
cd backend
npm run dashboard:build         # -> frontend/dist
npm run build && npm start      # API serves the dashboard at /dashboard
```

The API serves `frontend/dist` (or `DASHBOARD_DIST`) from its own origin, so the auth cookie is
first-party: no CORS, no token in `localStorage`. The (commented) GitHub
deploy workflow already includes the build and upload steps.

## Screens

| Route | Figma | What it does |
|---|---|---|
| `/` | 07-dashboard | KPIs, alerts (maintenance, complaints), fleet, top drivers, 2-week calendar, latest bookings, weekly revenue. Click a vehicle to edit its price/status. |
| `/day/:date` | 18-day-details | One day's schedule, stats and driver assignments; `?booking=id` highlights a booking. |
| `/book` | 21-book-on-behalf | Search or quick-create a customer, book, live price quote, optional Super-Admin price override, mark as paid. |
| `/live` | 22-live-operations | Trips in progress with progress, remaining time and delay warnings. Refreshes every 30s. |
| `/drivers/:id` | 23-driver-analytics | Income vs commission by day/month/year, editable commission %, quality, Excel export. |
| `/customers/:id` | 24-customer-analytics | Spend, bookings, wallet, referrals, VIP badge, Excel export. |
| `/audit` | 25-audit-log | Append-only audit trail with filters and server-side Excel export. |
| `/drivers` | (new) | "عرض كل السائقين": every driver, ranked by month revenue, with status control. |
| `/packages` | (new) | Customer packages; the admin sets each package's discount %. |
| `/settings` | (new) | Business settings: deposit %, trip gap, early start, commissions, referral amounts, peak surge, alert thresholds, prices per car type. |
| `/login` | (new, same style) | Email + password + TOTP 2FA (setup or challenge). |

## API added for the dashboard

All under `/api/v1/admin` (admin roles only) unless noted:

`GET /overview` · `GET /days/:date` · `GET /trips/live` · `GET /drivers-summary` ·
`GET /drivers-assignable` · `GET /drivers/:id/analytics?period=` ·
`PATCH /drivers/:id/commission` · `GET /customers/search?q=` · `POST /customers` ·
`GET /customers/:id/analytics?period=` · `POST /bookings` (book on behalf) ·
`PATCH /vehicles/:id` · `GET /audit-logs` · `GET /audit-logs/export` ·
`GET /auth/me` (any signed-in user).

Schema (migration `20261116120000_admin_dashboard`): `AuditLogs` table,
`Drivers.commissionRate` (default 20), `Bookings.tripStartedAt` /
`tripCompletedAt`.

## Definitions

- **Revenue** = `totalPrice` of CONFIRMED + COMPLETED bookings whose date has arrived.
- **Month revenue delta** compares the month so far with the same number of days last month.
- **Occupancy** = vehicle-days booked in the last 7 days ÷ (non-maintenance vehicles × 7).
- **Complaint** = a customer review of a driver rated 2★ or lower (Settings).
- **Delay** = how far the projected arrival is past *scheduled start + planned duration*; flagged at ≥ 5 min (Settings).
- **Punctuality** = trips started within 10 minutes of the slot (Settings).
- **VIP** = lifetime spend ≥ 15,000 EGP (Settings).
- All "today"/month math uses `BUSINESS_TZ` (default `Africa/Cairo`), not UTC.
