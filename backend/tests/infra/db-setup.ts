import prismaClient from '../../src/v1/utils/prismaClientHelper';
import SignInGuard from '../../src/v1/services/sign-in-guard.service';
import SettingsService from '../../src/v1/services/settings.service';
import { assertDisposableDatabase } from './db-guard';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
} from '../../generated/prisma';

export interface TestSeedData {
  adminRole: any;
  driverRole: any;
  customerRole: any;
  systemSettings: any;
  adminUser: any;
  driverUser: any;
  driverProfile: any;
  riderUser: any;
  vehicle: any;
}

export async function isDatabaseConnected(): Promise<boolean> {
  try {
    await prismaClient.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}

export async function resetDatabase(): Promise<void> {
  assertDisposableDatabase(); // second line of defence: never wipe a non-test database
  SignInGuard.reset(); // wrong-attempt counters live in memory
  const connected = await isDatabaseConnected();
  if (!connected) {
    return;
  }

  try {
    // Children before parents. Every model that references another has to be
    // listed, otherwise a leftover row (a conversation pointing at a booking,
    // say) aborts the whole reset with a foreign key violation and the suite
    // then runs against a half-wiped database.
    await prismaClient.messages.deleteMany();
    await prismaClient.conversations.deleteMany();
    await prismaClient.scheduledNotifications.deleteMany();
    await prismaClient.walletTransactions.deleteMany();
    await prismaClient.referrals.deleteMany();
    await prismaClient.reviews.deleteMany();
    await prismaClient.payments.deleteMany();
    await prismaClient.waitlist.deleteMany();
    await prismaClient.tripLocations.deleteMany();
    await prismaClient.bookings.deleteMany();
    await prismaClient.packages.deleteMany();
    await prismaClient.vehicleAvailability.deleteMany();
    await prismaClient.vehicleMaintenance.deleteMany();
    await prismaClient.vehicleDrivers.deleteMany();
    await prismaClient.vehicleImages.deleteMany();
    await prismaClient.vehicles.deleteMany();
    await prismaClient.drivers.deleteMany();
    await prismaClient.phoneNumbers.deleteMany();
    await prismaClient.users.deleteMany();
    await prismaClient.permission.deleteMany();
    await prismaClient.role.deleteMany();
    await prismaClient.systemSettings.deleteMany();
    // Settings are cached in memory; a wiped row must not leave old values behind.
    SettingsService.clearCache();
  } catch (error) {
    console.warn('Database reset encountered non-fatal error:', error);
  }
}

export async function seedDatabase(): Promise<TestSeedData> {
  await resetDatabase();

  const connected = await isDatabaseConnected();
  if (!connected) {
    return getMockSeedData();
  }

  // Create Roles. Names must match the UserRole enum - lowercase values used to
  // create a parallel role set that adminMiddleware then rejected.
  const adminRole = await prismaClient.role.create({
    data: {
      name: 'ADMIN',
      description: 'System Administrator with full permissions',
    },
  });

  const driverRole = await prismaClient.role.create({
    data: {
      name: 'DRIVER',
      description: 'Vehicle Driver user role',
    },
  });

  const customerRole = await prismaClient.role.create({
    data: {
      name: 'CUSTOMER',
      description: 'Rider / Customer user role',
    },
  });

  // Create System Settings
  const systemSettings = await prismaClient.systemSettings.create({
    data: {
      id: 'global',
      performanceHistoryVisible: true,
      evaluationsVisible: true,
      selfAppraisalsVisible: true,
    },
  });

  // Create Test Admin User
  const adminUser = await prismaClient.users.create({
    data: {
      email: 'admin@mishwark.test',
      name: 'System Admin',
      code: 'ADM-001',
      password: '$2b$10$testPasswordHashForTestingOnly1234567890',
      roleId: adminRole.id,
      phoneNumber: '+201000000001',
      otpVerified: true,
      twoFactorEnabled: false,
    },
  });

  // Create Test Driver User & Driver Profile
  const driverUser = await prismaClient.users.create({
    data: {
      email: 'driver@mishwark.test',
      name: 'Test Driver',
      code: 'DRV-001',
      password: '$2b$10$testPasswordHashForTestingOnly1234567890',
      roleId: driverRole.id,
      phoneNumber: '+201000000002',
      otpVerified: true,
      drivers: {
        create: {
          fullName: 'Test Driver Profile',
          licenseNumber: 'LIC-998877',
          licenseExpiry: new Date('2030-12-31T00:00:00.000Z'),
          status: DriverStatus.ACTIVE,
          rating: 4.9,
        },
      },
    },
    include: {
      drivers: true,
    },
  });

  // Create Test Rider User
  const riderUser = await prismaClient.users.create({
    data: {
      email: 'rider@mishwark.test',
      name: 'Test Rider',
      code: 'RDR-001',
      password: '$2b$10$testPasswordHashForTestingOnly1234567890',
      roleId: customerRole.id,
      phoneNumber: '+201000000003',
      otpVerified: true,
    },
  });

  // Create Test Vehicle
  const vehicle = await prismaClient.vehicles.create({
    data: {
      make: 'Toyota',
      model: 'Camry',
      year: 2024,
      plateNumber: 'ABC-1234',
      color: 'Black',
      capacity: 4,
      category: VehicleCategory.CAR,
      status: VehicleStatus.AVAILABLE,
      basePrice: 50.0,
      pricePerKm: 10.0,
      pricePerHour: 25.0,
    },
  });

  // Only a car's own drivers can drive it, so the test car gets the test driver.
  if (driverUser.drivers) {
    await prismaClient.vehicleDrivers.create({ data: { vehicleId: vehicle.id, driverId: driverUser.drivers.id, isPrimary: true } });
  }

  return {
    adminRole,
    driverRole,
    customerRole,
    systemSettings,
    adminUser,
    driverUser,
    driverProfile: driverUser.drivers,
    riderUser,
    vehicle,
  };
}

export function getMockSeedData(): TestSeedData {
  return {
    adminRole: {
      id: 'mock-admin-role-id',
      name: 'ADMIN',
      description: 'System Administrator',
    },
    driverRole: {
      id: 'mock-driver-role-id',
      name: 'DRIVER',
      description: 'Vehicle Driver user role',
    },
    customerRole: {
      id: 'mock-customer-role-id',
      name: 'CUSTOMER',
      description: 'Rider / Customer user role',
    },
    systemSettings: {
      id: 'global',
      performanceHistoryVisible: true,
      evaluationsVisible: true,
      selfAppraisalsVisible: true,
    },
    adminUser: {
      id: 'mock-admin-user-id',
      email: 'admin@mishwark.test',
      name: 'System Admin',
      tokenVersion: 0,
      roleId: 'mock-admin-role-id',
    },
    driverUser: {
      id: 'mock-driver-user-id',
      email: 'driver@mishwark.test',
      name: 'Test Driver',
      tokenVersion: 0,
      roleId: 'mock-driver-role-id',
    },
    driverProfile: {
      id: 'mock-driver-profile-id',
      userId: 'mock-driver-user-id',
      fullName: 'Test Driver Profile',
      status: DriverStatus.ACTIVE,
      rating: 4.9,
    },
    riderUser: {
      id: 'mock-rider-user-id',
      email: 'rider@mishwark.test',
      name: 'Test Rider',
      tokenVersion: 0,
      roleId: 'mock-customer-role-id',
    },
    vehicle: {
      id: 'mock-vehicle-id',
      make: 'Toyota',
      model: 'Camry',
      plateNumber: 'ABC-1234',
      category: VehicleCategory.CAR,
      status: VehicleStatus.AVAILABLE,
    },
  };
}
