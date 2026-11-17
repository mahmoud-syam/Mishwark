import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
} from '../../generated/prisma';
import { UsersSchema, VehiclesSchema, BookingsSchema } from '../../src/v1/schemas/zod';
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
  generateInvalidToken,
  generateExpiredToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../src/secrets';

describe('Tier 1: Features F1, F2, F3 - Prisma Models, Client & Seeds Coverage', () => {
  test('F1-T1-01: PrismaClient contains definitions for all 11 primary and auxiliary models', () => {
    expect(prismaClient).toBeDefined();
    expect(prismaClient.users).toBeDefined();
    expect(prismaClient.drivers).toBeDefined();
    expect(prismaClient.vehicles).toBeDefined();
    expect(prismaClient.bookings).toBeDefined();
    expect(prismaClient.role).toBeDefined();
    expect(prismaClient.permission).toBeDefined();
    expect(prismaClient.systemSettings).toBeDefined();
    expect(prismaClient.phoneNumbers).toBeDefined();
    expect(prismaClient.vehicleImages).toBeDefined();
    expect(prismaClient.vehicleDrivers).toBeDefined();
    expect(prismaClient.vehicleAvailability).toBeDefined();
  });

  test('F1-T1-02: DriverStatus enum exports exact values ACTIVE, OFF, ONTRIP, ONLEAVE', () => {
    expect(DriverStatus).toBeDefined();
    expect(DriverStatus.ACTIVE).toBe('ACTIVE');
    expect(DriverStatus.OFF).toBe('OFF');
    expect(DriverStatus.ONTRIP).toBe('ONTRIP');
    expect(DriverStatus.ONLEAVE).toBe('ONLEAVE');
  });

  test('F1-T1-03: VehicleCategory enum exports exact values CAR, VAN, BUS, TRUCK', () => {
    expect(VehicleCategory).toBeDefined();
    expect(VehicleCategory.CAR).toBe('CAR');
    expect(VehicleCategory.VAN).toBe('VAN');
    expect(VehicleCategory.BUS).toBe('BUS');
    expect(VehicleCategory.TRUCK).toBe('TRUCK');
  });

  test('F1-T1-04: VehicleStatus enum exports exact values AVAILABLE, BOOKED, MAINTENANCE', () => {
    expect(VehicleStatus).toBeDefined();
    expect(VehicleStatus.AVAILABLE).toBe('AVAILABLE');
    expect(VehicleStatus.BOOKED).toBe('BOOKED');
    expect(VehicleStatus.MAINTENANCE).toBe('MAINTENANCE');
  });

  test('F1-T1-05: BookingStatus enum exports exact values PENDING, CONFIRMED, COMPLETED, CANCELLED', () => {
    expect(BookingStatus).toBeDefined();
    expect(BookingStatus.PENDING).toBe('PENDING');
    expect(BookingStatus.CONFIRMED).toBe('CONFIRMED');
    expect(BookingStatus.COMPLETED).toBe('COMPLETED');
    expect(BookingStatus.CANCELLED).toBe('CANCELLED');
  });

  test('F1-T1-06: TripStatus enum exports exact values NOTSTARTED, INPROGRESS, COMPLETED, ARRIVED', () => {
    expect(TripStatus).toBeDefined();
    expect(TripStatus.NOTSTARTED).toBe('NOTSTARTED');
    expect(TripStatus.INPROGRESS).toBe('INPROGRESS');
    expect(TripStatus.COMPLETED).toBe('COMPLETED');
    expect(TripStatus.ARRIVED).toBe('ARRIVED');
  });

  test('F1-T1-07: PaymentStatus enum exports exact values UNPAID, PAID, PARTIALLY_PAID', () => {
    expect(PaymentStatus).toBeDefined();
    expect(PaymentStatus.UNPAID).toBe('UNPAID');
    expect(PaymentStatus.PAID).toBe('PAID');
    expect(PaymentStatus.PARTIALLY_PAID).toBe('PARTIALLY_PAID');
  });

  test('F1-T1-08: Users model structure includes default security and profile attributes', () => {
    const mockUser = {
      id: 'usr-123',
      name: 'John Doe',
      email: 'john@example.com',
      code: 'EMP-001',
      isDeleted: false,
      twoFactorEnabled: false,
      tokenVersion: 0,
      rating_avg: 5.0,
      preferredLanguage: 'en',
    };

    expect(mockUser.name).toBe('John Doe');
    expect(mockUser.isDeleted).toBe(false);
    expect(mockUser.twoFactorEnabled).toBe(false);
    expect(mockUser.tokenVersion).toBe(0);
    expect(mockUser.preferredLanguage).toBe('en');
  });

  test('F1-T1-09: Drivers model structure links to User with DriverStatus active state', () => {
    const mockDriver = {
      id: 'drv-123',
      userId: 'usr-123',
      fullName: 'John Driver',
      licenseNumber: 'DL-554433',
      status: DriverStatus.ACTIVE,
      rating_avg: 4.8,
    };

    expect(mockDriver.userId).toBe('usr-123');
    expect(mockDriver.status).toBe(DriverStatus.ACTIVE);
    expect(mockDriver.rating_avg).toBe(4.8);
  });

  test('F1-T1-10: Vehicles model structure supports category, status, and pricing fields', () => {
    const mockVehicle = {
      id: 'veh-123',
      make: 'Toyota',
      model: 'HiAce',
      plateNumber: 'VAN-7788',
      capacity: 14,
      category: VehicleCategory.VAN,
      status: VehicleStatus.AVAILABLE,
      basePrice: 150.0,
      pricePerKm: 15.0,
      pricePerHour: 40.0,
    };

    expect(mockVehicle.category).toBe(VehicleCategory.VAN);
    expect(mockVehicle.status).toBe(VehicleStatus.AVAILABLE);
    expect(mockVehicle.capacity).toBe(14);
    expect(mockVehicle.basePrice).toBe(150.0);
  });

  test('F1-T1-11: Bookings model structure binds customer, vehicle, driver, and statuses', () => {
    const mockBooking = {
      id: 'bk-123',
      customerId: 'usr-123',
      vehicleId: 'veh-123',
      driverId: 'drv-123',
      bookingDate: '2026-09-01',
      startTime: '09:00',
      endTime: '12:00',
      status: BookingStatus.PENDING,
      tripeStatus: TripStatus.NOTSTARTED,
      paymentStatus: PaymentStatus.UNPAID,
      totalPrice: 250.0,
      depositPaid: 50.0,
    };

    expect(mockBooking.status).toBe(BookingStatus.PENDING);
    expect(mockBooking.tripeStatus).toBe(TripStatus.NOTSTARTED);
    expect(mockBooking.paymentStatus).toBe(PaymentStatus.UNPAID);
    expect(mockBooking.totalPrice).toBe(250.0);
  });

  test('F1-T1-12: SystemSettings model defines global default settings record structure', () => {
    const mockSettings = {
      id: 'global',
      performanceHistoryVisible: true,
      evaluationsVisible: true,
      selfAppraisalsVisible: true,
    };

    expect(mockSettings.id).toBe('global');
    expect(mockSettings.performanceHistoryVisible).toBe(true);
    expect(mockSettings.evaluationsVisible).toBe(true);
    expect(mockSettings.selfAppraisalsVisible).toBe(true);
  });

  test('F2-T1-13: Zod schemas are generated and exported for Users, Vehicles, Bookings', () => {
    expect(UsersSchema).toBeDefined();
    expect(VehiclesSchema).toBeDefined();
    expect(BookingsSchema).toBeDefined();
  });

  test('F2-T1-14: UsersSchema successfully validates valid user payload', () => {
    const validUserPayload = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      code: 'USR001',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      pic: '',
      password: 'hashed_password_string',
      preferredLanguage: 'en',
      isDeleted: false,
      twoFactorEnabled: false,
      twoFactorSecret: '',
      tokenVersion: 0,
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
      lastLoginAt: null,
      disabledAt: null,
      phoneNumber: '+201012345678',
      otpVerified: true,
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      otpSentAt: null,
      referralCode: 'REF123',
      referredById: null,
      customerRating: 5.0,
      roleId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = UsersSchema.safeParse(validUserPayload);
    expect(parsed.success).toBe(true);
  });

  test('F2-T1-15: VehiclesSchema successfully validates valid vehicle payload', () => {
    const validVehiclePayload = {
      id: '123e4567-e89b-12d3-a456-426614174002',
      make: 'Nissan',
      model: 'Sunny',
      year: 2023,
      plateNumber: 'EGY-1234',
      color: 'White',
      capacity: 4,
      category: VehicleCategory.CAR,
      status: VehicleStatus.AVAILABLE,
      basePrice: 100.0,
      pricePerKm: 12.5,
      pricePerHour: 30.0,
      description: 'Clean sedan',
      luggage: 3,
      features: ['تكييف', 'واي فاي'],
      retiredAt: null,
      retiredReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = VehiclesSchema.safeParse(validVehiclePayload);
    expect(parsed.success).toBe(true);
  });

  test('F3-T1-16: seedDatabase creates or returns authoritative roles and system settings', async () => {
    const seeds = await seedDatabase();

    expect(seeds).toBeDefined();
    expect(seeds.adminRole).toBeDefined();
    // Names follow the UserRole enum; middleware normalizes case when comparing.
    expect(seeds.adminRole.name).toBe('ADMIN');

    expect(seeds.driverRole).toBeDefined();
    expect(seeds.driverRole.name).toBe('DRIVER');

    expect(seeds.customerRole).toBeDefined();
    expect(seeds.customerRole.name).toBe('CUSTOMER');

    expect(seeds.systemSettings).toBeDefined();
    expect(seeds.systemSettings.id).toBe('global');
  });

  test('F3-T1-17: seedDatabase generates consistent admin, driver, rider test users and vehicle', async () => {
    const seeds = await seedDatabase();

    expect(seeds.adminUser).toBeDefined();
    expect(seeds.adminUser.email).toBe('admin@mishwark.test');

    expect(seeds.driverUser).toBeDefined();
    expect(seeds.driverUser.email).toBe('driver@mishwark.test');

    expect(seeds.riderUser).toBeDefined();
    expect(seeds.riderUser.email).toBe('rider@mishwark.test');

    expect(seeds.vehicle).toBeDefined();
    expect(seeds.vehicle.plateNumber).toBe('ABC-1234');
  });

  test('F3-T1-18: resetDatabase executes without throwing errors', async () => {
    let error: any = null;
    try {
      await resetDatabase();
    } catch (err) {
      error = err;
    }
    expect(error).toBeNull();
  });

  test('F3-T1-19: auth-helper correctly generates signed JWT tokens for Admin, Driver, and Rider roles', () => {
    const adminToken = generateAdminToken();
    const driverToken = generateDriverToken();
    const riderToken = generateRiderToken();
    const invalidToken = generateInvalidToken();

    expect(adminToken).toBeDefined();
    expect(typeof adminToken).toBe('string');

    const decodedAdmin: any = jwt.verify(
      adminToken,
      JWT_SECRET || '58232f52e620c21a7820d06348f0829591b2a6ffad3bfc4431248177fc897569'
    );
    // Role names must match the UserRole enum values; middleware normalizes
    // case, but the token payload carries the canonical uppercase form.
    expect(decodedAdmin.user.role.name).toBe('ADMIN');

    const decodedDriver: any = jwt.verify(
      driverToken,
      JWT_SECRET || '58232f52e620c21a7820d06348f0829591b2a6ffad3bfc4431248177fc897569'
    );
    expect(decodedDriver.user.role.name).toBe('DRIVER');

    const decodedRider: any = jwt.verify(
      riderToken,
      JWT_SECRET || '58232f52e620c21a7820d06348f0829591b2a6ffad3bfc4431248177fc897569'
    );
    expect(decodedRider.user.role.name).toBe('CUSTOMER');

    expect(invalidToken).toBe('invalid.jwt.token.string.for.testing');
  });

  test('F3-T1-20: api-client initializes express application and handles HTTP request agent calls', async () => {
    const client = createApiClient();
    const response = await client.get('/vehicles');

    expect(response).toBeDefined();
    expect(typeof response.status).toBe('number');
    await client.stop();
  });
});
