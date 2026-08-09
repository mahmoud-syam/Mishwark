# Project: Mishwark Backend Implementation

## Architecture
- **Framework**: Node.js v20+, Express v5 (TypeScript v5.9)
- **Database & ORM**: PostgreSQL, Prisma ORM v7.8 with `@prisma/adapter-pg`
- **Validation**: Zod v4 schemas automatically generated via `zod-prisma-types`
- **Pattern**: 4-Tier Clean Architecture Layering:
  1. `Routes` (`src/v1/routes/`) — Endpoint path declarations and middleware attachment.
  2. `Middlewares` (`src/v1/middlewares/`) — Authentication (`authenticateToken`), authorization (`authorizeRole`), request validation (`validateRequest`), error handling (`errorMiddleware`).
  3. `Controllers` (`src/v1/controllers/`) — Request parsing, HTTP response formatting, wrapped in async error handler `errorHandler`.
  4. `Services / Prisma Models` (`src/v1/services/` & `prisma/models/`) — Core business logic, pricing math, state transitions, concurrency locks, DB interactions via Prisma Client.

## Code Layout
```
prisma/
├── models/
│   ├── bookings.prisma
│   ├── chat.prisma
│   ├── enums.prisma
│   ├── notifications.prisma
│   ├── packages.prisma
│   ├── payments.prisma
│   ├── referrals.prisma
│   ├── reviews.prisma
│   ├── roles.prisma
│   ├── settings.prisma
│   ├── users.prisma
│   ├── vehicles.prisma
│   ├── waitlist.prisma
│   └── wallet.prisma
├── seed/
│   ├── seed.ts
│   └── api_seed_roles.ts
├── schema.prisma
└── zod.prisma

src/
├── index.ts
├── app.ts
└── v1/
    ├── controllers/
    │   ├── admin.controller.ts
    │   ├── auth.controller.ts
    │   ├── booking.controller.ts
    │   ├── chat.controller.ts
    │   ├── driver.controller.ts
    │   ├── notification.controller.ts
    │   ├── package.controller.ts
    │   ├── payment.controller.ts
    │   ├── referral.controller.ts
    │   ├── review.controller.ts
    │   ├── user.controller.ts
    │   ├── vehicle.controller.ts
    │   ├── waitlist.controller.ts
    │   └── wallet.controller.ts
    ├── services/
    │   ├── admin.service.ts
    │   ├── auth.service.ts
    │   ├── booking.service.ts
    │   ├── chat.service.ts
    │   ├── driver.service.ts
    │   ├── notification.service.ts
    │   ├── package.service.ts
    │   ├── payment.service.ts
    │   ├── pricing.service.ts
    │   ├── referral.service.ts
    │   ├── review.service.ts
    │   ├── user.service.ts
    │   ├── vehicle.service.ts
    │   ├── waitlist.service.ts
    │   └── wallet.service.ts
    ├── routes/
    │   ├── admin.routes.ts
    │   ├── auth.routes.ts
    │   ├── booking.routes.ts
    │   ├── chat.routes.ts
    │   ├── driver.routes.ts
    │   ├── notification.routes.ts
    │   ├── package.routes.ts
    │   ├── payment.routes.ts
    │   ├── referral.routes.ts
    │   ├── review.routes.ts
    │   ├── user.routes.ts
    │   ├── vehicle.routes.ts
    │   ├── waitlist.routes.ts
    │   └── wallet.routes.ts
    ├── middlewares/
    ├── schemas/
    │   └── zod/
    └── utils/
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Complete Prisma Schema & Models | Add all 9 missing primary models (Packages, Payments, Reviews, Waitlist, Conversations, Messages, ScheduledNotifications, Referrals, WalletTransactions) + 2 auxiliary models (TripLocations, VehicleMaintenance), fix typos/enums | M1 | Survey / docx §1 |
| 2 | Prisma Client & Zod Generation | Run `prisma generate` to produce Prisma client and Zod validation schemas cleanly | M1 | Survey / R1 |
| 3 | Database Seeds & Migrations | Create seed scripts for roles, admin user, test drivers, test vehicles, system settings | M1 | Survey / R1 |
| 4 | Pricing Calculation Engine | Calculate base price, distance price, time price, peak multiplier, package/referral discounts based on vehicle category | M2 | Survey / R2, docx §3 |
| 5 | Booking Creation & Double-Booking Protection | Atomic transaction checks for overlapping time windows on vehicle & driver availability; row-level locking / availability status update | M2 | Survey / R2, docx §2, §4 |
| 6 | Booking Workflow & State Machine | Manage booking statuses (PENDING -> CONFIRMED -> COMPLETED/CANCELLED) and trip statuses (NOTSTARTED -> EN_ROUTE -> ARRIVED -> COMPLETED) | M2 | Survey / R2, docx §2 |
| 7 | Booking Cancellation & Waitlist Promotion | Cancel booking, release availability, automatically promote top-positioned waiting customer from waitlist, trigger notification | M2 | Survey / R2, docx §2, §10 |
| 8 | Driver Profile & Vehicle Availability API | Driver profile management, shift toggle (ACTIVE/OFF), vehicle assignment, manual availability blockage | M3 | Survey / R3, docx §1, §5 |
| 9 | Reviews & Rating Engine | Submit customer/driver reviews, compute running average ratings, enforce blind review 48h visibility window | M3 | Survey / R3, docx §9 |
| 10 | Wallet & Payments Integration | Wallet balances, transaction logs, payment initiation, Paymob/Fawry/Cash recording, refunds | M3 | Survey / R3, docx §8, §13 |
| 11 | Referral Program Engine | Generate referral codes, track referral signups, issue wallet rewards upon first completed booking | M3 | Survey / R3, docx §12 |
| 12 | In-App Chat / Messaging | Create booking conversations, send text/quick-reply messages, mark read status | M3 | Survey / R3, docx §11 |
| 13 | Multi-Vehicle & Multi-Event Packages | Package creation, bundle discount calculation, multi-booking linking | M3 | Survey / R3, docx §7 |
| 14 | Automated Scheduled Notifications | Queue 24h, 2h, 30m reminders and post-trip review prompts via Push/SMS/WhatsApp | M3 | Survey / R3, docx §14 |
| 15 | Driver Dashboard Endpoints | Active trip overview, upcoming schedule, daily earnings, trip status updates | M4 | Survey / R4, docx §5 |
| 16 | Admin Dashboard Endpoints | System overview stats, user/driver management, booking overrides, payout approvals, system settings | M4 | Survey / R4, docx §6 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Prisma Models & DB Layer | Prisma schema completion, models, enums, client/zod generation, seeds & migrations | None | DONE |
| M2 | Bookings & Pricing Engine | Pricing calculation, booking state machine, double-booking protection, waitlist promotion | M1 | IN_PROGRESS |
| M3 | Supplementary Modules | Driver availability, Reviews (blind rating), Wallet & Payments, Referrals, Chat, Packages, Notifications | M1, M2 | PLANNED |
| M4 | Driver & Admin Dashboards | Driver trip execution/earnings endpoints, Admin system management & analytics endpoints | M1, M2, M3 | PLANNED |

## Interface Contracts
### Booking Engine ↔ Pricing Engine
```typescript
interface CalculatePriceDTO {
  vehicleCategory: VehicleCategory;
  distanceKm: number;
  durationMinutes: number;
  isPeakHour?: boolean;
  packageId?: string;
  referralCode?: string;
}

interface PriceBreakdown {
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  surgeMultiplier: number;
  discountAmount: number;
  totalPrice: number;
  depositPaid: number;
}
```

### Booking Engine ↔ Availability / Double-Booking Lock
```typescript
interface CheckAvailabilityDTO {
  vehicleId: string;
  driverId: string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
}

// Function signature for atomic double-booking check within Prisma Transaction:
async checkAndLockAvailability(
  tx: PrismaTransaction,
  params: CheckAvailabilityDTO
): Promise<{ success: boolean; conflictReason?: string }>;
```

### Review Engine ↔ Rating Aggregator
```typescript
// Blind review rule: rating is hidden until both parties review or 48 hours elapse
async checkAndReleaseBlindReviews(bookingId: string): Promise<void>;
```
