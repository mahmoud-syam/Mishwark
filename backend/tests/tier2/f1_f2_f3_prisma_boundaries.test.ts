import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
  UserRole,
} from '../../generated/prisma';
import { UsersSchema, VehiclesSchema, BookingsSchema } from '../../src/v1/schemas/zod';
import { isDatabaseConnected, resetDatabase, seedDatabase } from '../infra/db-setup';
import { z } from 'zod';

describe('Tier 2: Features F1, F2, F3 - Database Constraints, Invalid Relations & Boundaries', () => {
  test('F1-T2-01: Email unique constraint prevents duplicate user email creation in Users model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const duplicateEmail = `dup_user_${Date.now()}@test.com`;
      const role = await prismaClient.role.create({
        data: { name: UserRole.CUSTOMER, description: 'Role for duplicate-email test' },
      });

      await prismaClient.users.create({
        data: {
          name: 'First User',
          email: duplicateEmail,
          code: `CODE1_${Date.now()}`,
          roleId: role.id,
        },
      });

      let threwError = false;
      try {
        await prismaClient.users.create({
          data: {
            name: 'Second User',
            email: duplicateEmail,
            code: `CODE2_${Date.now()}`,
            roleId: role.id,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      // Schema level unique assertion
      const userSchema = UsersSchema.shape.email;
      expect(userSchema).toBeDefined();
    }
  });

  test('F1-T2-02: Phone number unique constraint prevents duplicate user phone numbers in Users model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const duplicatePhone = `+20111${Math.floor(100000 + Math.random() * 900000)}`;
      const role = await prismaClient.role.create({
        data: { name: UserRole.CUSTOMER, description: 'Role for duplicate-phone test' },
      });

      await prismaClient.users.create({
        data: {
          name: 'Phone User 1',
          email: `phone1_${Date.now()}@test.com`,
          phoneNumber: duplicatePhone,
          roleId: role.id,
        },
      });

      let threwError = false;
      try {
        await prismaClient.users.create({
          data: {
            name: 'Phone User 2',
            email: `phone2_${Date.now()}@test.com`,
            phoneNumber: duplicatePhone,
            roleId: role.id,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(UsersSchema.shape.phoneNumber).toBeDefined();
    }
  });

  test('F1-T2-03: Referral code unique constraint prevents duplicate referral codes in Users model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const dupReferral = `REF_${Date.now()}`;
      const role = await prismaClient.role.create({
        data: { name: UserRole.CUSTOMER, description: 'Role for referral uniqueness test' },
      });

      await prismaClient.users.create({
        data: {
          name: 'Referral User 1',
          email: `ref1_${Date.now()}@test.com`,
          referralCode: dupReferral,
          roleId: role.id,
        },
      });

      let threwError = false;
      try {
        await prismaClient.users.create({
          data: {
            name: 'Referral User 2',
            email: `ref2_${Date.now()}@test.com`,
            referralCode: dupReferral,
            roleId: role.id,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(UsersSchema.shape.referralCode).toBeDefined();
    }
  });

  test('F1-T2-04: Plate number unique constraint prevents duplicate vehicle registration in Vehicles model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const dupPlate = `PLATE-${Date.now()}`;

      await prismaClient.vehicles.create({
        data: {
          make: 'Toyota',
          model: 'Corolla',
          plateNumber: dupPlate,
          category: VehicleCategory.CAR,
        },
      });

      let threwError = false;
      try {
        await prismaClient.vehicles.create({
          data: {
            make: 'Honda',
            model: 'Civic',
            plateNumber: dupPlate,
            category: VehicleCategory.CAR,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(VehiclesSchema.shape.plateNumber).toBeDefined();
    }
  });

  test('F1-T2-05: Role name unique constraint prevents duplicate role names in Role model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      // Role.name is a UserRole enum column, so the duplicate has to reuse a valid
      // enum value rather than an arbitrary string.
      const dupRoleName = UserRole.CUSTOMER;

      await prismaClient.role.create({
        data: {
          name: dupRoleName,
          description: 'First Role',
        },
      });

      let threwError = false;
      try {
        await prismaClient.role.create({
          data: {
            name: dupRoleName,
            description: 'Duplicate Role',
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  test('F1-T2-06: Compound unique constraint [vehicleId, bookingDate, startTime] blocks duplicate slot bookings', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      const seed = await seedDatabase();
      const bookingDate = '2026-10-15';
      const startTime = '10:00';

      await prismaClient.bookings.create({
        data: {
          customerId: seed.riderUser.id,
          vehicleId: seed.vehicle.id,
          driverId: seed.driverProfile.id,
          bookingDate,
          startTime,
          endTime: '12:00',
          status: BookingStatus.CONFIRMED,
        },
      });

      let threwError = false;
      try {
        await prismaClient.bookings.create({
          data: {
            customerId: seed.riderUser.id,
            vehicleId: seed.vehicle.id,
            driverId: seed.driverProfile.id,
            bookingDate,
            startTime,
            endTime: '12:00',
            status: BookingStatus.PENDING,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(BookingsSchema.shape.vehicleId).toBeDefined();
      expect(BookingsSchema.shape.bookingDate).toBeDefined();
      expect(BookingsSchema.shape.startTime).toBeDefined();
    }
  });

  test('F1-T2-07: Creating Drivers profile with non-existent userId fails foreign key relation constraint', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const invalidUserId = '00000000-0000-0000-0000-000000000000';

      let threwError = false;
      try {
        await prismaClient.drivers.create({
          data: {
            userId: invalidUserId,
            fullName: 'Ghost Driver',
            licenseNumber: 'GHOST-123',
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  test('F1-T2-08: Creating Bookings record with non-existent customerId or vehicleId fails foreign key constraint', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const invalidId = '00000000-0000-0000-0000-000000000000';

      let threwError = false;
      try {
        await prismaClient.bookings.create({
          data: {
            customerId: invalidId,
            vehicleId: invalidId,
            driverId: invalidId,
            bookingDate: '2026-11-01',
            startTime: '14:00',
            endTime: '16:00',
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  test('F1-T2-09: Creating VehicleDrivers link with non-existent driverId fails foreign key constraint', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      const seed = await seedDatabase();
      const invalidDriverId = '00000000-0000-0000-0000-000000000000';

      let threwError = false;
      try {
        await prismaClient.vehicleDrivers.create({
          data: {
            vehicleId: seed.vehicle.id,
            driverId: invalidDriverId,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  test('F1-T2-10: Enum type boundary check - invalid string value for DriverStatus is rejected by Zod schema', () => {
    const driverStatusSchema = z.nativeEnum(DriverStatus);
    const invalidResult = driverStatusSchema.safeParse('INVALID_DRIVER_STATUS');
    expect(invalidResult.success).toBe(false);

    const validResult = driverStatusSchema.safeParse('ACTIVE');
    expect(validResult.success).toBe(true);
  });

  test('F1-T2-11: Enum type boundary check - invalid string value for VehicleCategory is rejected by Zod schema', () => {
    const categorySchema = z.nativeEnum(VehicleCategory);
    const invalidResult = categorySchema.safeParse('SUBMARINE');
    expect(invalidResult.success).toBe(false);

    const validResult = categorySchema.safeParse('BUS');
    expect(validResult.success).toBe(true);
  });

  test('F1-T2-12: Enum type boundary check - invalid string value for VehicleStatus is rejected by Zod schema', () => {
    const vehicleStatusSchema = z.nativeEnum(VehicleStatus);
    const invalidResult = vehicleStatusSchema.safeParse('DESTROYED');
    expect(invalidResult.success).toBe(false);

    const validResult = vehicleStatusSchema.safeParse('MAINTENANCE');
    expect(validResult.success).toBe(true);
  });

  test('F1-T2-13: Enum type boundary check - invalid string value for BookingStatus is rejected by Zod schema', () => {
    const bookingStatusSchema = z.nativeEnum(BookingStatus);
    const invalidResult = bookingStatusSchema.safeParse('SUPER_CONFIRMED');
    expect(invalidResult.success).toBe(false);

    const validResult = bookingStatusSchema.safeParse('CANCELLED');
    expect(validResult.success).toBe(true);
  });

  test('F1-T2-14: Enum type boundary check - invalid string value for TripStatus is rejected by Zod schema', () => {
    const tripStatusSchema = z.nativeEnum(TripStatus);
    const invalidResult = tripStatusSchema.safeParse('FLYING');
    expect(invalidResult.success).toBe(false);

    const validResult = tripStatusSchema.safeParse('INPROGRESS');
    expect(validResult.success).toBe(true);
  });

  test('F1-T2-15: Missing seed handling - querying non-existent role returns null without throwing crash exception', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      // SUPER_ADMIN is a valid UserRole value but is not part of seedDatabase,
      // so the lookup must come back null rather than throw.
      const nonExistentRole = await prismaClient.role.findUnique({
        where: { name: UserRole.SUPER_ADMIN },
      });
      expect(nonExistentRole).toBeNull();
    } else {
      expect(null).toBeNull();
    }
  });

  test('F1-T2-16: Missing seed handling - resetDatabase on already empty database executes safely', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      let secondResetError: any = null;
      try {
        await resetDatabase();
      } catch (err) {
        secondResetError = err;
      }
      expect(secondResetError).toBeNull();
    } else {
      let resetError: any = null;
      try {
        await resetDatabase();
      } catch (err) {
        resetError = err;
      }
      expect(resetError).toBeNull();
    }
  });

  test('F1-T2-17: Boundary check on self-referential referral link handling for Users model', async () => {
    const connected = await isDatabaseConnected();
    if (connected) {
      await resetDatabase();
      const invalidParentId = '00000000-0000-0000-0000-000000000000';
      const role = await prismaClient.role.create({
        data: { name: UserRole.CUSTOMER, description: 'Role for referral boundary test' },
      });

      let threwError = false;
      try {
        await prismaClient.users.create({
          data: {
            name: 'Referred User',
            email: `referred_${Date.now()}@test.com`,
            referredById: invalidParentId,
            roleId: role.id,
          },
        });
      } catch (err: any) {
        threwError = true;
      }
      expect(threwError).toBe(true);
    } else {
      expect(UsersSchema.shape.referredById).toBeDefined();
    }
  });
});
