# Scope: E2E Testing Track Orchestrator

## Objectives
Design and implement a comprehensive, opaque-box, requirement-driven E2E test suite for the Mishwark Backend.

## Test Philosophy & Methodology
- Derived directly from `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory`.
- 4-Tier Test Case Design:
  - **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (16 features = ≥80 tests). Happy path isolation tests using standard HTTP API runner or Jest/Supertest harness.
  - **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (16 features = ≥80 tests). Testing zero/negative values, invalid date/time formats, invalid UUIDs, concurrency limits, overlapping time windows, duplicate bookings.
  - **Tier 3 (Cross-Feature Combinations)**: Pairwise feature interactions (e.g. Booking + Pricing + Wallet Discount + Referral Reward).
  - **Tier 4 (Real-World Application Scenarios)**: Full E2E user journeys (Rider registration -> Vehicle search -> Booking -> Double-booking attempt blocked -> Waitlist join -> Trip start -> Trip complete -> Review submitted & blind rating released -> Driver payout/earnings updated).
- Produce `TEST_INFRA.md` at root and publish `TEST_READY.md` at root upon completion.

## Verification
- Test runner must execute headlessly via a single command (e.g. `npm test` or `npm run test:e2e`).
- All test scripts must be self-contained and run cleanly against seeded test database.
