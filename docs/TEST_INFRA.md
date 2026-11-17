# E2E Test Infra: Mishwark Backend

> Describes the API in `backend/`. File paths and commands below are relative to that folder.

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + BVA + Pairwise + Workload Testing across 4 Tiers.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| 1 | Complete Prisma Schema & Models | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Prisma Client & Zod Generation | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | Database Seeds & Migrations | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 4 | Pricing Calculation Engine | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 5 | Booking Creation & Double-Booking Protection | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 6 | Booking Workflow & State Machine | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 7 | Booking Cancellation & Waitlist Promotion | ORIGINAL_REQUEST §R2, R3 | 5 | 5 | ✓ | ✓ |
| 8 | Driver Profile & Vehicle Availability API | ORIGINAL_REQUEST §R3, R4 | 5 | 5 | ✓ | ✓ |
| 9 | Reviews & Rating Engine | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 10 | Wallet & Payments Integration | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 11 | Referral Program Engine | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 12 | In-App Chat / Messaging | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 13 | Multi-Vehicle & Multi-Event Packages | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 14 | Automated Scheduled Notifications | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 15 | Driver Dashboard Endpoints | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| 16 | Admin Dashboard Endpoints | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: Custom headless test runner / tsx script (`npx tsx tests/run-all.ts`)
- Location: `tests/`
- Test case format: Structured TypeScript test suites executing HTTP API requests against express app / database models with strict pass/fail reporting and non-zero exit codes on failure.
- Directory layout:
  - `tests/infra/` — DB seed reset helper (`db-setup.ts`), HTTP API test client (`api-client.ts`), Auth JWT helper (`auth-helper.ts`), Test Runner (`run-all.ts`)
  - `tests/tier1/` — Feature coverage tests (≥80 tests, 5 per feature)
  - `tests/tier2/` — Boundary, corner case & double-booking concurrency tests (≥80 tests, 5 per feature)
  - `tests/tier3/` — Cross-feature combination & interaction tests (≥16 pairwise tests)
  - `tests/tier4/` — Real-world application scenarios & full user journeys (≥8 scenario tests)

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Ride Journey: User Registration, Booking, Driver Assignment, Trip Progress, Completion & Rating | F1, F5, F6, F8, F9, F15 | High |
| 2 | Pricing & Discount Stacking: Package Purchase, Referral Redemption, Surge Calculation, Deposit Deduction & Wallet Payout | F4, F10, F11, F13 | High |
| 3 | Concurrency & Overbooking: Simultaneous Bookings, Time-Window Collisions, Waitlist Enqueue & Automated Promotion | F5, F7, F10, F14 | High |
| 4 | Driver Shift Management, Vehicle Maintenance Lock & Trip State Transitions | F6, F8, F15 | Medium |
| 5 | Blind Review Release & Driver Aggregate Score Update | F6, F9, F15 | Medium |
| 6 | Chat & Notification Automation during Active Booking | F6, F12, F14 | Medium |
| 7 | Admin System Override, Booking Cancellation, Refund & Dashboard Analytics | F7, F10, F16 | High |
| 8 | Multi-Event Package Creation, Allocation & Exhaustion | F4, F5, F13 | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature (80 total)
- Tier 2: ≥5 per feature (80 total)
- Tier 3: pairwise coverage of feature interactions (16 total)
- Tier 4: ≥8 realistic application scenarios
- Total: ≥184 E2E test cases
