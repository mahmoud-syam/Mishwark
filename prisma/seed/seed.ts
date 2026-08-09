import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, DriverStatus, VehicleCategory, VehicleStatus } from "@prisma/client";
import { seedRolesAndPermissions } from "./api_seed_roles";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mishwarak";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

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
    const superAdminRole = await prisma.role.findUnique({ where: { name: "Super Admin" } });
    const customerRole = await prisma.role.findUnique({ where: { name: "Customer" } });
    const driverRole = await prisma.role.findUnique({ where: { name: "Driver" } });

    // 3. Seed Super Admin User
    console.log("Seeding Super Admin user...");
    const adminUser = await prisma.users.upsert({
      where: { email: "admin@mishwarak.com" },
      update: {
        name: "System Admin",
        roleId: superAdminRole?.id,
      },
      create: {
        email: "admin@mishwarak.com",
        name: "System Admin",
        phoneNumber: "+201000000000",
        password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vj.W.", // dummy hash
        roleId: superAdminRole?.id,
        preferredLanguage: "ar",
      },
    });

    // 4. Seed Test Customer
    console.log("Seeding Test Customer...");
    const customerUser = await prisma.users.upsert({
      where: { email: "customer@mishwarak.com" },
      update: {
        name: "John Customer",
        roleId: customerRole?.id,
      },
      create: {
        email: "customer@mishwarak.com",
        name: "John Customer",
        phoneNumber: "+201011111111",
        password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vj.W.",
        roleId: customerRole?.id,
        customerRating: 5.0,
        preferredLanguage: "ar",
      },
    });

    // 5. Seed Test Drivers and Profiles
    console.log("Seeding Test Drivers...");
    const driver1User = await prisma.users.upsert({
      where: { email: "driver1@mishwarak.com" },
      update: { name: "Ahmed Driver", roleId: driverRole?.id },
      create: {
        email: "driver1@mishwarak.com",
        name: "Ahmed Driver",
        phoneNumber: "+201022222222",
        password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vj.W.",
        roleId: driverRole?.id,
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
      update: { name: "Mohamed Driver", roleId: driverRole?.id },
      create: {
        email: "driver2@mishwarak.com",
        name: "Mohamed Driver",
        phoneNumber: "+201033333333",
        password: "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vj.W.",
        roleId: driverRole?.id,
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
        basePrice: 150.0,
        pricePerKm: 10.0,
        pricePerHour: 50.0,
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
        basePrice: 150.0,
        pricePerKm: 10.0,
        pricePerHour: 50.0,
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
        basePrice: 300.0,
        pricePerKm: 20.0,
        pricePerHour: 100.0,
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
        basePrice: 300.0,
        pricePerKm: 20.0,
        pricePerHour: 100.0,
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
        basePrice: 80.0,
        pricePerKm: 5.0,
        pricePerHour: 30.0,
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
        basePrice: 80.0,
        pricePerKm: 5.0,
        pricePerHour: 30.0,
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
