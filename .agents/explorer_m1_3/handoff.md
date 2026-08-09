# Handoff Report — Explorer 3 (Milestone M1: Prisma Models & DB Layer)

## 1. Observation

### 1.1 Prisma Build & Config Architecture
- **Prisma Configuration File**: `prisma.config.ts`
  ```typescript
  import "dotenv/config";
  import { defineConfig } from "prisma/config";

  export default defineConfig({
    schema: "prisma",
    migrations: {
      path: "prisma/migrations",
    },
    datasource: {
      url: process.env["DATABASE_URL"],
    },
  });
  ```
  - `schema: "prisma"` configures Prisma 7 to recursively scan the `prisma/` folder and subdirectories for `.prisma` files.
- **Generator 1 (Client)** in `prisma/schema.prisma`:
  ```prisma
  generator client {
    provider = "prisma-client-js"
    output   = "../generated/prisma"
  }
  ```
- **Generator 2 (Zod Schemas)** in `prisma/zod.prisma`:
  ```prisma
  generator zod {
    provider         = "zod-prisma-types"
    output           = "../src/v1/schemas/zod"
    createInputTypes = "false"
    createModelTypes = "true"
  }
  ```
- **Execution Output**:
  Running `npx prisma generate` loads the Prisma config from `prisma.config.ts`, scans `prisma/` for `.prisma` files, and generates:
  1. Prisma Client -> `generated/prisma` (188ms)
  2. Zod Prisma Types -> `src/v1/schemas/zod/index.ts` (241ms)

### 1.2 Database Seeding Current State
- **Directory**: `prisma/seed/` exists in the filesystem but is currently empty (0 files).
- **Existing `package.json` Scripts**:
  ```json
  "seed": "npx ts-node prisma/seed/seed.ts",
  "seed:api": "npx tsx prisma/seed/api_seed_roles.ts"
  ```
- **Missing `package.json` Prisma Config**: `package.json` does not currently contain a `"prisma"` top-level key defining `"seed": "tsx prisma/seed/seed.ts"`. Consequently, running `npx prisma db seed` directly without `"prisma.seed"` config will fail or fall back.

### 1.3 TypeScript Compilation (`npx tsc --noEmit`)
- `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "module": "commonjs",
      "esModuleInterop": true,
      "target": "es6",
      "moduleResolution": "node",
      "sourceMap": true,
      "outDir": "dist",
      "skipLibCheck": true,
      "strict": false,
      "resolveJsonModule": true
    },
    "lib": ["es2015"],
    "include": ["src/**/*", "src/v1/types/**/*.d.ts"]
  }
  ```
- Running `npx tsc --noEmit` revealed compilation errors in legacy controller/middleware files:
  1. `src/v1/controllers/vehicles.controller.ts`: Errors TS2305 (`Module '"@prisma/client"' has no exported member 'VehicleCategory'`). This occurs because `prisma/schema.prisma` outputs to custom path `generated/prisma` instead of standard `node_modules/@prisma/client`, and `tsconfig.json` lacks path mapping for `@prisma/client`.
  2. `src/v1/controllers/auth.controller.ts`: Errors TS2339 / TS2353 referencing legacy fields (`teams`, `graduationFaculty`, `reportingTo`) not present in the Mishwark data model.
- Generated files `src/v1/schemas/zod/index.ts` and `generated/prisma/client.d.ts` had **0** TypeScript errors.

---

## 2. Logic Chain

1. **Prisma Build Process**: Prisma 7 natively supports directory-based schemas (`schema: "prisma"` in `prisma.config.ts`). Therefore, no external file concatenation script is needed before calling `npx prisma generate`. Running `npx prisma generate` automatically incorporates all files in `prisma/models/*.prisma`, `prisma/schema.prisma`, and `prisma/zod.prisma`.
2. **Zod Generation Integration**: `zod-prisma-types` generates model schemas into `src/v1/schemas/zod/index.ts`. In `index.ts`, imports are resolved to `../../../../generated/prisma/client`. Because `src/v1/schemas/zod` is inside `src/`, `tsc` automatically includes it in type-checking.
3. **Seeding Architecture**:
   - `prisma/seed/api_seed_roles.ts` should be a dedicated role and permission seeder, seeding standard roles (`Super Admin`, `Admin`, `Customer`, `Driver`) and permissions (`dashboard:view`, `user:manage`, `role:manage`, `booking:manage`, `vehicle:manage`, `driver:manage`, `payment:manage`, `settings:manage`, `review:manage`).
   - `prisma/seed/seed.ts` should act as the master seed runner, invoking role seeding, and populating:
     - Default `SystemSettings` (`id: "global"`).
     - Default Super Admin user (`admin@mishwarak.com`).
     - Test Customers (`customer@mishwarak.com`).
     - Test Drivers (`driver1@mishwarak.com`, `driver2@mishwarak.com`).
     - Test Vehicles (Categories: `VAN`, `BUS`, `CAR` with base rates and capacities).
     - Vehicle-Driver linkages (`VehicleDrivers`).
4. **TypeScript Configuration Optimization**:
   - Adding `"paths": { "@prisma/client": ["./generated/prisma"] }` and `"baseUrl": "."` to `tsconfig.json` bridges imports so files importing `@prisma/client` resolve seamlessly to `generated/prisma`.
   - Adding `"prisma/seed/**/*"` to `"include"` in `tsconfig.json` ensures seed scripts are type-checked during `npx tsc --noEmit`.
5. **Execution Compatibility**:
   - `tsx` (which is already in `devDependencies` v4.21.0) is faster and more reliable on Node.js v24 than `ts-node`.
   - Registering `"prisma": { "seed": "tsx prisma/seed/seed.ts" }` in `package.json` allows both `npx prisma db seed` and `npm run seed` (`tsx prisma/seed/seed.ts`) to function.

---

## 3. Caveats

- **Database Connection for Seed Execution**: Executing `npx prisma db seed` or `npm run seed` requires a running PostgreSQL instance specified by `DATABASE_URL` in `.env`.
- **Legacy Controller Code**: Pre-existing controller files in `src/v1/controllers/` (such as `auth.controller.ts`) contain legacy references to boilerplate models (`teams`, `graduationFaculty`). These must be refactored by implementers during M1/M2 model wiring.
- **Idempotency**: All seed scripts must use `upsert` or check-before-create logic so re-running `npm run seed` does not fail on unique constraint violations (e.g. `email` or `plateNumber`).

---

## 4. Conclusion & Proposed Implementation Strategy

### 4.1 Proposed `package.json` Additions
Add `prisma` seed configuration and update scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts",
    "prisma:generate": "npx prisma generate",
    "seed": "npx tsx prisma/seed/seed.ts",
    "seed:api": "npx tsx prisma/seed/api_seed_roles.ts"
  },
  "prisma": {
    "seed": "tsx prisma/seed/seed.ts"
  }
}
```

### 4.2 Proposed `tsconfig.json` Updates
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@prisma/client": ["./generated/prisma"]
    },
    "module": "commonjs",
    "esModuleInterop": true,
    "target": "es6",
    "moduleResolution": "node",
    "sourceMap": true,
    "outDir": "dist",
    "skipLibCheck": true,
    "strict": false,
    "resolveJsonModule": true
  },
  "lib": ["es2015"],
  "include": ["src/**/*", "prisma/seed/**/*", "src/v1/types/**/*.d.ts"]
}
```

### 4.3 Proposed Seed Structure & Data Specifications

#### File 1: `prisma/seed/api_seed_roles.ts`
- **Purpose**: Seed core RBAC roles & permissions.
- **Roles**:
  - `Super Admin`: Full system access and dashboard management.
  - `Admin`: System manager role.
  - `Customer`: Regular customer account.
  - `Driver`: Registered driver account.
- **Permissions**:
  - `dashboard:view`, `user:manage`, `role:manage`, `booking:manage`, `vehicle:manage`, `driver:manage`, `payment:manage`, `settings:manage`, `review:manage`.
- **Implementation Logic**:
  ```typescript
  import { PrismaClient } from "../../generated/prisma/client";
  const prisma = new PrismaClient();

  export async function seedRolesAndPermissions() {
    // 1. Upsert Permissions
    // 2. Upsert Roles
    // 3. Connect Permissions to Roles
  }

  if (require.main === module) {
    seedRolesAndPermissions()
      .then(() => prisma.$disconnect())
      .catch((e) => {
        console.error(e);
        prisma.$disconnect();
        process.exit(1);
      });
  }
  ```

#### File 2: `prisma/seed/seed.ts`
- **Purpose**: Master seed file for complete system initialization.
- **Steps**:
  1. Call `seedRolesAndPermissions()` from `api_seed_roles.ts`.
  2. Seed `SystemSettings`:
     - `id`: `"global"`, `performanceHistoryVisible`: `true`, `evaluationsVisible`: `true`, `selfAppraisalsVisible`: `true`.
  3. Seed Super Admin User:
     - `email`: `"admin@mishwarak.com"`, `name`: `"System Admin"`, `phoneNumber`: `"+201000000000"`, `password`: hashed bcrypt string, link `Super Admin` role.
  4. Seed Test Customer:
     - `email`: `"customer@mishwarak.com"`, `name`: `"John Customer"`, `phoneNumber`: `"+201011111111"`, link `Customer` role.
  5. Seed Test Drivers & Profiles:
     - Driver 1: User (`driver1@mishwarak.com`), Driver record (`fullName`: `"Ahmed Driver"`, `licenseNumber`: `"LIC-12345"`, `licenseExpiry`: `"2030-12-31T00:00:00.000Z"`).
     - Driver 2: User (`driver2@mishwarak.com`), Driver record (`fullName`: `"Mohamed Driver"`, `licenseNumber`: `"LIC-67890"`, `licenseExpiry`: `"2030-12-31T00:00:00.000Z"`).
  6. Seed Test Vehicles:
     - Vehicle 1 (VAN): `make`: `"Toyota"`, `model`: `"HiAce"`, `year`: `"2024"`, `plateNumber`: `"ABC-1234"`, `color`: `"White"`, `capacity`: 14, `category`: `"VAN"`, `basePrice`: 150.0, `pricePerKm`: 10.0, `pricePerHour`: 50.0.
     - Vehicle 2 (BUS): `make`: `"Mercedes"`, `model`: `"Sprinter"`, `year`: `"2024"`, `plateNumber`: `"XYZ-5678"`, `color`: `"Black"`, `capacity`: 19, `category`: `"BUS"`, `basePrice`: 300.0, `pricePerKm`: 20.0, `pricePerHour`: 100.0.
     - Vehicle 3 (CAR): `make`: `"Hyundai"`, `model`: `"Elantra"`, `year`: `"2024"`, `plateNumber`: `"CAR-9999"`, `color`: `"Silver"`, `capacity`: 4, `category`: `"CAR"`, `basePrice`: 80.0, `pricePerKm`: 5.0, `pricePerHour`: 30.0.
  7. Seed `VehicleDrivers` assignments linking Vehicles to Drivers.

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Prisma Generation Check**:
   ```bash
   npx prisma generate
   ```
   *Expected Output*: Successfully generates Prisma Client to `generated/prisma` and Zod types to `src/v1/schemas/zod`.

2. **TypeScript Compilation Check**:
   ```bash
   npx tsc --noEmit
   ```
   *Expected Output*: Clean type check for `src/v1/schemas/zod/index.ts` and `prisma/seed/` files.

3. **Seed Execution Check** (with active DB):
   ```bash
   npm run seed
   # AND
   npm run seed:api
   # AND
   npx prisma db seed
   ```
   *Expected Output*: Output logs confirming seeding of roles, admin user, test drivers, test vehicles, and system settings without errors.

### 5.2 Invalidation Conditions
- Any missing relation or field in Prisma models preventing `npx prisma generate`.
- Schema generation errors when generating `src/v1/schemas/zod/index.ts`.
- Non-idempotent seed execution throwing `P2002` (Unique constraint failed) when re-running `npm run seed`.
