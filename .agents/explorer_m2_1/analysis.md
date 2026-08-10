# Analysis Report: Milestone M2 — Pricing & Bookings Core Engine

## Executive Summary
This document provides a comprehensive, read-only technical analysis of the Pricing Calculation Engine for Milestone M2 (`Bookings & Pricing Core Engine`) in the Mishwark Backend repository. The objective is to define the exact mathematical formulas, data models, interface DTOs, Zod validation schemas, boundary edge cases, and implementation strategy required for `src/v1/services/pricing.service.ts` without modifying any source code.

---

## 1. System Architecture & File Locations
The pricing engine sits in the 4-Tier Clean Architecture model:
- **Routes Layer**: `src/v1/routes/booking.routes.ts` (`POST /api/v1/bookings/calculate-price`)
- **Controller Layer**: `src/v1/controllers/booking.controller.ts` (`calculatePrice`)
- **Validation Layer**: `src/v1/schemas/booking.schema.ts` (`calculatePriceSchema`)
- **Service Layer**: `src/v1/services/pricing.service.ts` (`PricingService`, `calculateEstimatedPrice`)
- **DB Layer**: Prisma schema models in `prisma/models/` (`vehicles.prisma`, `packages.prisma`, `referrals.prisma`, `bookings.prisma`, `settings.prisma`, `enums.prisma`)

---

## 2. Prisma Schema & Data Types Inventory

### A. Vehicle Category Rates (`VehicleCategory` Enum)
Defined in `prisma/models/enums.prisma`:
```prisma
enum VehicleCategory {
  CAR
  VAN
  BUS
  TRUCK
  CLASSIC
  LUXURY
}
```

Default Category Rates Table:
| Vehicle Category | Base Price ($) | Price per Km ($/km) | Price per Hour ($/hr) |
|---|---|---|---|
| `CAR` | 50.00 | 10.00 | 25.00 |
| `VAN` | 150.00 | 15.00 | 40.00 |
| `BUS` | 300.00 | 25.00 | 60.00 |
| `TRUCK` | 250.00 | 20.00 | 50.00 |
| `CLASSIC` | 200.00 | 18.00 | 45.00 |
| `LUXURY` | 350.00 | 30.00 | 75.00 |

### B. Vehicles Model (`prisma/models/vehicles.prisma`)
```prisma
model Vehicles {
  id           String          @id @default(uuid())
  category     VehicleCategory @default(CAR)
  status       VehicleStatus   @default(AVAILABLE)
  basePrice    Float           @default(0)
  pricePerKm   Float           @default(0)
  pricePerHour Float           @default(0)
  ...
}
```
*Logic Rule*: If `vehicleId` is specified in pricing parameters, query the database. If custom rate fields (`basePrice`, `pricePerKm`, `pricePerHour`) on the vehicle record are `> 0`, override category defaults.

### C. Packages Model (`prisma/models/packages.prisma`)
```prisma
model Packages {
  id                 String        @id @default(uuid())
  customerId         String
  packageName        String
  packageType        PackageType
  totalPrice         Float         @default(0)
  discountPercentage Float         @default(0)
  status             PackageStatus @default(ACTIVE)
  ...
}
```
*Logic Rule*: If `packageId` is specified and `packageDiscount` is omitted, query `Packages` table. If package exists, has `status === ACTIVE`, and `discountPercentage > 0`, compute `packageDiscount = surchargedTotal * (discountPercentage / 100)`.

### D. Referrals Model (`prisma/models/referrals.prisma`)
```prisma
model Referrals {
  id           String         @id @default(uuid())
  referralCode String
  status       ReferralStatus @default(PENDING)
  rewardAmount Float          @default(0)
  ...
}
```
*Logic Rule*: If `referralCode` is specified and `referralDiscount` is omitted, query `Referrals` table for matching code. If found and `rewardAmount > 0`, set `referralDiscount = referral.rewardAmount`.

---

## 3. Mathematical Formulas & Pricing Logic

### Step-by-Step Pricing Pipeline
1. **Distance Input Normalization**:
   $$\text{validDistance} = \max(0, \text{distanceKm} \parallel 0)$$
2. **Duration Input Normalization**:
   $$\text{validDuration} = \max(0, \text{durationMinutes} \parallel 0)$$
3. **Distance Price**:
   $$\text{distancePrice} = \text{validDistance} \times \text{pricePerKm}$$
4. **Time Price**:
   $$\text{timePrice} = \left( \frac{\text{validDuration}}{60} \right) \times \text{pricePerHour}$$
5. **Subtotal**:
   $$\text{subtotal} = \text{basePrice} + \text{distancePrice} + \text{timePrice}$$
6. **Surge Multiplier Calculation**:
   - If `isPeakHour` is `true`:
     $$\text{surge} = (\text{surgeMultiplier} > 0) ? \text{surgeMultiplier} : 1.25$$
   - Else:
     $$\text{surge} = (\text{surgeMultiplier} > 0) ? \text{surgeMultiplier} : 1.0$$
7. **Surcharged Subtotal**:
   $$\text{surchargedTotal} = \text{subtotal} \times \text{surge}$$
8. **Discounts Calculation**:
   $$\text{rawDiscount} = (\text{packageDiscount} \parallel 0) + (\text{referralDiscount} \parallel 0)$$
   $$\text{discountAmount} = \min(\text{surchargedTotal}, \max(0, \text{rawDiscount}))$$
9. **Final Total Price**:
   $$\text{totalPrice} = \max\left(0, \text{Math.round}\Big((\text{surchargedTotal} - \text{discountAmount}) \times 100\Big) / 100\right)$$
10. **20% Deposit Requirement**:
    $$\text{depositPaid} = \text{Math.round}\Big(\text{totalPrice} \times 0.20 \times 100\Big) / 100$$

---

## 4. DTO Interfaces & Signatures

```typescript
export interface CalculatePriceParams {
  vehicleCategory?: VehicleCategory | string;
  distanceKm?: number;
  durationMinutes?: number;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  packageDiscount?: number;
  referralDiscount?: number;
  customBasePrice?: number;
  customPricePerKm?: number;
  customPricePerHour?: number;
  vehicleId?: string;
  packageId?: string;
  referralCode?: string;
}

export interface CalculatePriceDTO {
  vehicleCategory?: VehicleCategory;
  distanceKm?: number;
  durationMinutes?: number;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  vehicleId?: string;
  packageId?: string;
  referralCode?: string;
}

export interface PriceBreakdown {
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  surgeMultiplier: number;
  discountAmount: number;
  totalPrice: number;
  depositPaid: number;
}
```

### Static Functions & Class Signatures
```typescript
export function calculateEstimatedPrice(params: CalculatePriceParams): PriceBreakdown;

export class PricingService {
  public static async calculatePrice(params: CalculatePriceParams): Promise<PriceBreakdown>;
}
```

---

## 5. Zod Validation Schema Specs (`src/v1/schemas/booking.schema.ts`)
```typescript
export const calculatePriceSchema = z.object({
  vehicleCategory: z.union([z.nativeEnum(VehicleCategory), z.string()]).optional(),
  distanceKm: z.number().min(0).optional().default(0),
  durationMinutes: z.number().min(0).optional().default(0),
  isPeakHour: z.boolean().optional(),
  surgeMultiplier: z.number().optional(),
  packageDiscount: z.number().min(0).optional(),
  referralDiscount: z.number().min(0).optional(),
  customBasePrice: z.number().min(0).optional(),
  customPricePerKm: z.number().min(0).optional(),
  customPricePerHour: z.number().min(0).optional(),
  vehicleId: z.string().optional(),
  packageId: z.string().optional(),
  referralCode: z.string().optional(),
});
```

---

## 6. Gaps & Audit Findings in Existing Implementation

1. **Package Status Filter**: In `PricingService.calculatePrice`, fetching a package currently queries `prismaClient.packages.findUnique({ where: { id: params.packageId } })` without checking `pkg.status === PackageStatus.ACTIVE`. An expired or cancelled package must NOT apply a discount.
2. **Surge Multiplier Negative Boundary**: Negative inputs (e.g. `surgeMultiplier: -2.5`) should fall back to `1.25` if `isPeakHour` is true or `1.0` if false.
3. **Floating Point Rounding Consistency**: Ensure all component prices (`distancePrice`, `timePrice`, `discountAmount`, `totalPrice`, `depositPaid`) are explicitly rounded to 2 decimal places using `Math.round(val * 100) / 100`.
4. **Fallback Handling**: If database queries fail or vehicle/package/referral IDs are invalid, `PricingService.calculatePrice` catches errors and gracefully falls back to category defaults without throwing 500 internal server errors.

---

## 7. Verification Matrix
- `npx tsc --noEmit` must return 0 errors.
- `npx tsx tests/infra/run-all.ts` test suites (Tier 1 & Tier 2) must execute with 100% pass rate.
