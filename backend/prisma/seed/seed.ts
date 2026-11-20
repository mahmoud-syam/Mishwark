import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, DriverStatus, VehicleCategory, VehicleStatus } from "@prisma/client";
import { seedRolesAndPermissions } from "./api_seed_roles";
import "dotenv/config";

import { hashSync } from "bcrypt";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mishwarak";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Seeded accounts sign in with this password via POST /auth/login. It has to be
// a real bcrypt hash: the previous placeholder made every seeded login fail.
export const SEED_PASSWORD = "secret123";
const SEED_PASSWORD_HASH = hashSync(SEED_PASSWORD, 10);

async function main() {
  console.log("Starting database seeding...");

  try {
    // 1. Seed Roles and Permissions
    await seedRolesAndPermissions();

    // 2. Seed System Settings
    console.log("Seeding SystemSettings...");
    await prisma.systemSettings.upsert({
      where: { id: "global" },
      update: {
        performanceHistoryVisible: true,
        evaluationsVisible: true,
        selfAppraisalsVisible: true,
      },
      create: {
        id: "global",
        performanceHistoryVisible: true,
        evaluationsVisible: true,
        selfAppraisalsVisible: true,
      },
    });

    // Fetch Roles
    const superAdminRole = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
    const customerRole = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
    const driverRole = await prisma.role.findUnique({ where: { name: "DRIVER" } });

    if (!superAdminRole || !customerRole || !driverRole) {
      throw new Error(
        "Missing base roles. Run `npm run seed:api` before seeding users."
      );
    }

    // 3. Seed Super Admin User
    console.log("Seeding Super Admin user...");
    const adminUser = await prisma.users.upsert({
      where: { email: "admin@mishwarak.com" },
      update: {
        name: "System Admin",
        roleId: superAdminRole.id,
        password: SEED_PASSWORD_HASH,
      },
      create: {
        email: "admin@mishwarak.com",
        name: "System Admin",
        phoneNumber: "+201000000000",
        password: SEED_PASSWORD_HASH,
        roleId: superAdminRole.id,
        preferredLanguage: "ar",
      },
    });

    // 4. Seed Test Customer
    console.log("Seeding Test Customer...");
    const customerUser = await prisma.users.upsert({
      where: { email: "customer@mishwarak.com" },
      update: {
        name: "John Customer",
        roleId: customerRole.id,
        password: SEED_PASSWORD_HASH,
      },
      create: {
        email: "customer@mishwarak.com",
        name: "John Customer",
        phoneNumber: "+201011111111",
        password: SEED_PASSWORD_HASH,
        roleId: customerRole.id,
        customerRating: 5.0,
        preferredLanguage: "ar",
      },
    });

    // 5. Seed Test Drivers and Profiles
    console.log("Seeding Test Drivers...");
    const driver1User = await prisma.users.upsert({
      where: { email: "driver1@mishwarak.com" },
      update: { name: "Ahmed Driver", roleId: driverRole.id, password: SEED_PASSWORD_HASH },
      create: {
        email: "driver1@mishwarak.com",
        name: "Ahmed Driver",
        phoneNumber: "+201022222222",
        password: SEED_PASSWORD_HASH,
        roleId: driverRole.id,
        preferredLanguage: "ar",
      },
    });

    const driver1Profile = await prisma.drivers.upsert({
      where: { userId: driver1User.id },
      update: {
        fullName: "Ahmed Driver",
        licenseNumber: "LIC-12345",
        licenseExpiry: new Date("2030-12-31"),
        status: DriverStatus.ACTIVE,
        rating: 5.0,
      },
      create: {
        userId: driver1User.id,
        fullName: "Ahmed Driver",
        licenseNumber: "LIC-12345",
        licenseExpiry: new Date("2030-12-31"),
        status: DriverStatus.ACTIVE,
        rating: 5.0,
      },
    });

    const driver2User = await prisma.users.upsert({
      where: { email: "driver2@mishwarak.com" },
      update: { name: "Mohamed Driver", roleId: driverRole.id, password: SEED_PASSWORD_HASH },
      create: {
        email: "driver2@mishwarak.com",
        name: "Mohamed Driver",
        phoneNumber: "+201033333333",
        password: SEED_PASSWORD_HASH,
        roleId: driverRole.id,
        preferredLanguage: "ar",
      },
    });

    const driver2Profile = await prisma.drivers.upsert({
      where: { userId: driver2User.id },
      update: {
        fullName: "Mohamed Driver",
        licenseNumber: "LIC-67890",
        licenseExpiry: new Date("2030-12-31"),
        status: DriverStatus.ACTIVE,
        rating: 5.0,
      },
      create: {
        userId: driver2User.id,
        fullName: "Mohamed Driver",
        licenseNumber: "LIC-67890",
        licenseExpiry: new Date("2030-12-31"),
        status: DriverStatus.ACTIVE,
        rating: 5.0,
      },
    });

    // 6. Seed Test Vehicles
    console.log("Seeding Test Vehicles...");
    const vehicle1 = await prisma.vehicles.upsert({
      where: { plateNumber: "ABC-1234" },
      update: {
        make: "Toyota",
        model: "HiAce",
        year: 2024,
        color: "White",
        capacity: 14,
        category: VehicleCategory.VAN,
        status: VehicleStatus.AVAILABLE,
      },
      create: {
        make: "Toyota",
        model: "HiAce",
        year: 2024,
        plateNumber: "ABC-1234",
        color: "White",
        capacity: 14,
        category: VehicleCategory.VAN,
        status: VehicleStatus.AVAILABLE,
      },
    });

    const vehicle2 = await prisma.vehicles.upsert({
      where: { plateNumber: "XYZ-5678" },
      update: {
        make: "Mercedes",
        model: "Sprinter",
        year: 2024,
        color: "Black",
        capacity: 19,
        category: VehicleCategory.BUS,
        status: VehicleStatus.AVAILABLE,
      },
      create: {
        make: "Mercedes",
        model: "Sprinter",
        year: 2024,
        plateNumber: "XYZ-5678",
        color: "Black",
        capacity: 19,
        category: VehicleCategory.BUS,
        status: VehicleStatus.AVAILABLE,
      },
    });

    const vehicle3 = await prisma.vehicles.upsert({
      where: { plateNumber: "CAR-9999" },
      update: {
        make: "Hyundai",
        model: "Elantra",
        year: 2024,
        color: "Silver",
        capacity: 4,
        category: VehicleCategory.CAR,
        status: VehicleStatus.AVAILABLE,
      },
      create: {
        make: "Hyundai",
        model: "Elantra",
        year: 2024,
        plateNumber: "CAR-9999",
        color: "Silver",
        capacity: 4,
        category: VehicleCategory.CAR,
        status: VehicleStatus.AVAILABLE,
      },
    });

    // 7. Seed Vehicle Drivers Assignments
    console.log("Seeding VehicleDrivers...");
    const existingVD1 = await prisma.vehicleDrivers.findFirst({
      where: { vehicleId: vehicle1.id, driverId: driver1Profile.id },
    });
    if (!existingVD1) {
      await prisma.vehicleDrivers.create({
        data: {
          vehicleId: vehicle1.id,
          driverId: driver1Profile.id,
          isPrimary: true,
        },
      });
    }

    const existingVD2 = await prisma.vehicleDrivers.findFirst({
      where: { vehicleId: vehicle2.id, driverId: driver2Profile.id },
    });
    if (!existingVD2) {
      await prisma.vehicleDrivers.create({
        data: {
          vehicleId: vehicle2.id,
          driverId: driver2Profile.id,
          isPrimary: true,
        },
      });
    }

    // Every car needs at least one driver: only a car's own drivers can drive it.
    const existingVD3 = await prisma.vehicleDrivers.findFirst({
      where: { vehicleId: vehicle3.id, driverId: driver2Profile.id },
    });
    if (!existingVD3) {
      await prisma.vehicleDrivers.create({
        data: {
          vehicleId: vehicle3.id,
          driverId: driver2Profile.id,
          isPrimary: true,
        },
      });
    }

    console.log("Database seeding completed successfully.");
  } catch (error) {
    console.error("Database seeding encountered an error or DB is offline:", error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
