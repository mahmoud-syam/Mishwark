# Handoff Report: Milestone M2 — Pricing Engine Exploration

## 1. Observation
- **Service implementation**: `src/v1/services/pricing.service.ts` contains `calculateEstimatedPrice` and `PricingService.calculatePrice`.
- **Validation Schema**: `src/v1/schemas/booking.schema.ts` defines `calculatePriceSchema` (lines 4-18) supporting `vehicleCategory`, `distanceKm`, `durationMinutes`, `isPeakHour`, `surgeMultiplier`, `packageDiscount`, `referralDiscount`, `customBasePrice`, `customPricePerKm`, `customPricePerHour`, `vehicleId`, `packageId`, `referralCode`.
- **Controller Endpoint**: `src/v1/controllers/booking.controller.ts` exports `calculatePrice` (lines 5-11), which calls `PricingService.calculatePrice(req.body)` and returns HTTP 200 with `{ success: true, data: breakdown }`.
- **Prisma Schema Models**:
  - `Vehicles` model in `prisma/models/vehicles.prisma` provides `category`, `basePrice`, `pricePerKm`, `pricePerHour`.
  - `Packages` model in `prisma/models/packages.prisma` provides `discountPercentage` and `status` (`PackageStatus` enum).
  - `Referrals` model in `prisma/models/referrals.prisma` provides `referralCode` and `rewardAmount`.
  - `Enums` in `prisma/models/enums.prisma` define `VehicleCategory` (`CAR`, `VAN`, `BUS`, `TRUCK`, `CLASSIC`, `LUXURY`).
- **Test Expectations**: `tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts` (lines 34-77) and `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts` test:
  - Base rates: `CAR`=$50, `VAN`=$150, `BUS`=$300, `TRUCK`=$250, `CLASSIC`=$200, `LUXURY`=$350.
  - Formula: `subtotal = basePrice + (distanceKm * pricePerKm) + ((durationMinutes / 60) * pricePerHour)`.
  - Peak surge: `surgeMultiplier` default `1.25` for peak hour, `1.0` otherwise.
  - Package discount & Referral discount subtraction capped at surcharged total (so total price never goes below 0).
  - Deposit: exactly 20% of `totalPrice` (`Math.round(totalPrice * 0.20 * 100) / 100`).

## 2. Logic Chain
1. **Inputs Verification**:
   - `distanceKm` and `durationMinutes` are clamped to non-negative values (`Math.max(0, val || 0)`).
   - Category defaults are resolved from `CATEGORY_DEFAULT_RATES`. If custom rates on vehicle are `> 0`, they take precedence.
2. **Surge Scaling**:
   - `isPeakHour` triggers `1.25` surge unless custom positive `surgeMultiplier` is supplied.
   - Non-positive or negative `surgeMultiplier` values are ignored and fallback to defaults (`1.25` or `1.0`).
3. **Discount Computation**:
   - Package lookup checks package validity and applies percentage discount.
   - Referral lookup checks code and applies fixed dollar reward discount.
   - Combined discounts are capped at `surchargedTotal`.
4. **Rounding & Deposit**:
   - Final prices and component breakdown amounts are rounded to 2 decimal places.
   - Deposit requirement is exactly 20% of the calculated total price.

## 3. Caveats
- No code changes were made to source files during this exploration phase (strictly read-only).
- Package status validation (`pkg.status === PackageStatus.ACTIVE`) should be explicitly enforced by implementers when querying the `Packages` model in `PricingService.calculatePrice`.

## 4. Conclusion
The Pricing Calculation Engine specification, formulas, DTO contracts (`CalculatePriceDTO`, `PriceBreakdown`), and validation rules are fully specified and aligned across database models, controller endpoints, service methods, and test suites. Implementers can proceed with feature execution safely.

## 5. Verification Method
1. **TypeScript Type Safety**:
   ```bash
   npx tsc --noEmit
   ```
2. **Automated Test Runner**:
   ```bash
   npx tsx tests/infra/run-all.ts
   ```
3. **Targeted Test Suites**:
   Inspect and run `tests/tier1/f4_f5_f6_f7_bookings_pricing.test.ts` and `tests/tier2/f4_f5_f6_f7_bookings_boundaries.test.ts`.
