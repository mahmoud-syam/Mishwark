import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  AvailabilityStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
  PackageType,
  PackageStatus,
  PaymentMethod,
  PaymentRecordStatus,
  ReviewerType,
  WaitlistStatus,
  ConversationStatus,
  SenderType,
  MessageType,
  NotificationRecipientType,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  ReferralStatus,
  WalletTransactionType,
} from "@prisma/client";
import { execSync } from "child_process";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL || "postgresql://admin:pass@localhost:5433/mishwarak?schema=public";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function runTests() {
  console.log("=================================================");
  console.log("STARTING EMPIRICAL CHALLENGER TEST SUITE (M1)");
  console.log("=================================================");

  let testCount = 0;
  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  function assert(condition: boolean, testName: string, detail?: string) {
    testCount++;
    if (condition) {
      passCount++;
      console.log(`[PASS] Test ${testCount}: ${testName}`);
    } else {
      failCount++;
      const msg = `[FAIL] Test ${testCount}: ${testName}${detail ? " - " + detail : ""}`;
      console.error(msg);
      failures.push(msg);
    }
  }

  try {
    // ----------------------------------------------------------------------
    // TEST GROUP 1: SEED SCRIPT IDEMPOTENCY
    // ----------------------------------------------------------------------
    console.log("\n--- TEST GROUP 1: SEED SCRIPT IDEMPOTENCY ---");
    try {
      console.log("Executing seed.ts second run for idempotency check...");
      execSync("npx tsx prisma/seed/seed.ts", { stdio: "pipe" });
      assert(true, "Seed script re-run execution succeeded");
    } catch (e: any) {
      assert(false, "Seed script re-run execution failed", e.message);
    }

    try {
      console.log("Executing api_seed_roles.ts second run for idempotency check...");
      execSync("npx tsx prisma/seed/api_seed_roles.ts", { stdio: "pipe" });
      assert(true, "Role seed script re-run execution succeeded");
    } catch (e: any) {
      assert(false, "Role seed script re-run execution failed", e.message);
    }

    // ----------------------------------------------------------------------
    // TEST GROUP 2: SEEDED ENTITY VERIFICATION & RELATIONS
    // ----------------------------------------------------------------------
    console.log("\n--- TEST GROUP 2: SEEDED ENTITY VERIFICATION & RELATIONS ---");
    
    // SystemSettings
    const settings = await prisma.systemSettings.findUnique({ where: { id: "global" } });
    assert(settings !== null, "SystemSettings global record exists", `Found: ${JSON.stringify(settings)}`);
    assert(settings?.performanceHistoryVisible === true, "SystemSettings.performanceHistoryVisible is true");

    // Roles & Permissions
    const roles = await prisma.role.findMany({ include: { permissions: true } });
    assert(roles.length >= 4, `Roles seeded count >= 4 (actual: ${roles.length})`);
    
    const superAdmin = roles.find((r) => r.name === "Super Admin");
    assert(superAdmin !== undefined, "Super Admin role exists");
    assert(superAdmin?.permissions.length === 9, `Super Admin has 9 permissions (actual: ${superAdmin?.permissions.length})`);

    const admin = roles.find((r) => r.name === "Admin");
    assert(admin !== undefined, "Admin role exists");
    assert(admin?.permissions.length === 7, `Admin has 7 permissions (actual: ${admin?.permissions.length})`);

    // Users
    const adminUser = await prisma.users.findUnique({ where: { email: "admin@mishwarak.com" }, include: { role: true } });
    assert(adminUser !== null, "Admin user exists");
    assert(adminUser?.role?.name === "Super Admin", "Admin user linked to Super Admin role");

    const customerUser = await prisma.users.findUnique({ where: { email: "customer@mishwarak.com" }, include: { role: true } });
    assert(customerUser !== null, "Customer user exists");
    assert(customerUser?.customerRating === 5.0, "Customer rating default/seeded is 5.0");

    const driver1User = await prisma.users.findUnique({ where: { email: "driver1@mishwarak.com" }, include: { drivers: true } });
    assert(driver1User !== null && driver1User.drivers !== null, "Driver 1 User and Driver Profile exist");
    assert(driver1User?.drivers?.status === DriverStatus.ACTIVE, "Driver 1 status is ACTIVE");
    assert(driver1User?.drivers?.rating === 5.0, "Driver 1 rating is 5.0");

    // Vehicles & VehicleDrivers
    const vehicles = await prisma.vehicles.findMany({ include: { vehicleDrivers: { include: { driver: true } } } });
    assert(vehicles.length >= 3, `Vehicles count >= 3 (actual: ${vehicles.length})`);

    const van = vehicles.find((v) => v.plateNumber === "ABC-1234");
    assert(van !== undefined, "Vehicle VAN ABC-1234 exists");
    assert(van?.category === VehicleCategory.VAN, "Vehicle VAN category is VAN");
    assert(van?.vehicleDrivers.length === 1, "Vehicle VAN has primary driver assigned");
    assert(van?.vehicleDrivers[0].driver.fullName === "Ahmed Driver", "Vehicle VAN driver is Ahmed Driver");

    // ----------------------------------------------------------------------
    // TEST GROUP 3: ENUM EXHAUSTIVE VALIDATION
    // ----------------------------------------------------------------------
    console.log("\n--- TEST GROUP 3: ENUM EXHAUSTIVE VALIDATION ---");
    
    // Validate every enum variant can be queried / used in DB
    const driverStatuses = Object.values(DriverStatus);
    assert(driverStatuses.length === 4, `DriverStatus enum has 4 values (ACTIVE, OFF, ONTRIP, ONLEAVE)`);
    
    const vehicleCategories = Object.values(VehicleCategory);
    assert(vehicleCategories.length === 6, `VehicleCategory enum has 6 values (CAR, VAN, BUS, TRUCK, CLASSIC, LUXURY)`);

    const vehicleStatuses = Object.values(VehicleStatus);
    assert(vehicleStatuses.length === 3, `VehicleStatus enum has 3 values (AVAILABLE, BOOKED, MAINTENANCE)`);

    const availabilityStatuses = Object.values(AvailabilityStatus);
    assert(availabilityStatuses.length === 3, `AvailabilityStatus enum has 3 values (AVAILABLE, BOOKED, BLOCKED)`);

    const bookingStatuses = Object.values(BookingStatus);
    assert(bookingStatuses.length === 4, `BookingStatus enum has 4 values`);

    const tripStatuses = Object.values(TripStatus);
    assert(tripStatuses.length === 4, `TripStatus enum has 4 values`);

    const paymentStatuses = Object.values(PaymentStatus);
    assert(paymentStatuses.length === 3, `PaymentStatus enum has 3 values`);

    const packageTypes = Object.values(PackageType);
    assert(packageTypes.length === 2, `PackageType enum has 2 values`);

    const packageStatuses = Object.values(PackageStatus);
    assert(packageStatuses.length === 4, `PackageStatus enum has 4 values`);

    const paymentMethods = Object.values(PaymentMethod);
    assert(paymentMethods.length === 4, `PaymentMethod enum has 4 values`);

    const paymentRecordStatuses = Object.values(PaymentRecordStatus);
    assert(paymentRecordStatuses.length === 4, `PaymentRecordStatus enum has 4 values`);

    const reviewerTypes = Object.values(ReviewerType);
    assert(reviewerTypes.length === 2, `ReviewerType enum has 2 values`);

    const waitlistStatuses = Object.values(WaitlistStatus);
    assert(waitlistStatuses.length === 4, `WaitlistStatus enum has 4 values`);

    const conversationStatuses = Object.values(ConversationStatus);
    assert(conversationStatuses.length === 2, `ConversationStatus enum has 2 values`);

    const senderTypes = Object.values(SenderType);
    assert(senderTypes.length === 3, `SenderType enum has 3 values`);

    const messageTypes = Object.values(MessageType);
    assert(messageTypes.length === 2, `MessageType enum has 2 values`);

    const recipientTypes = Object.values(NotificationRecipientType);
    assert(recipientTypes.length === 3, `NotificationRecipientType enum has 3 values`);

    const notificationTypes = Object.values(NotificationType);
    assert(notificationTypes.length === 5, `NotificationType enum has 5 values`);

    const notificationChannels = Object.values(NotificationChannel);
    assert(notificationChannels.length === 3, `NotificationChannel enum has 3 values`);

    const notificationStatuses = Object.values(NotificationStatus);
    assert(notificationStatuses.length === 4, `NotificationStatus enum has 4 values`);

    const referralStatuses = Object.values(ReferralStatus);
    assert(referralStatuses.length === 3, `ReferralStatus enum has 3 values`);

    const walletTxTypes = Object.values(WalletTransactionType);
    assert(walletTxTypes.length === 5, `WalletTransactionType enum has 5 values`);

    // ----------------------------------------------------------------------
    // TEST GROUP 4: MODEL INSTANTIATION & FK INTEGRITY
    // ----------------------------------------------------------------------
    console.log("\n--- TEST GROUP 4: MODEL INSTANTIATION & FK INTEGRITY ---");

    // Test creating records across all 9 missing models + 2 auxiliary models in a transaction, then clean up
    try {
      await prisma.$transaction(async (tx) => {
        // Create test user for dummy records
        const testUser = await tx.users.create({
          data: {
            name: "Test User Model Check",
            email: "test_model_check@mishwarak.com",
            phoneNumber: "+201999999999",
          },
        });

        // Create test driver profile
        const testDriver = await tx.drivers.create({
          data: {
            userId: testUser.id,
            fullName: "Test Driver Profile",
            licenseNumber: "LIC-TEST-999",
          },
        });

        // Create test vehicle
        const testVehicle = await tx.vehicles.create({
          data: {
            make: "TestMake",
            model: "TestModel",
            plateNumber: "TEST-0000",
            category: VehicleCategory.CLASSIC,
          },
        });

        // 1. VehicleMaintenance
        const maint = await tx.vehicleMaintenance.create({
          data: {
            vehicleId: testVehicle.id,
            maintenanceType: "Oil Change",
            cost: 150.0,
            scheduledDate: new Date(),
          },
        });
        assert(maint.id !== undefined, "VehicleMaintenance model created successfully");

        // 2. Packages
        const pkg = await tx.packages.create({
          data: {
            customerId: testUser.id,
            packageName: "Wedding Package",
            packageType: PackageType.MULTI_CAR,
            totalPrice: 5000,
            discountPercentage: 10,
          },
        });
        assert(pkg.id !== undefined, "Packages model created successfully");

        // 3. Bookings
        const booking = await tx.bookings.create({
          data: {
            customerId: testUser.id,
            vehicleId: testVehicle.id,
            driverId: testDriver.id,
            packageId: pkg.id,
            bookingDate: "2026-09-01",
            startTime: "10:00",
            endTime: "14:00",
            routeWaypoints: [{ lat: 30.0, lng: 31.2 }],
            status: BookingStatus.CONFIRMED,
            tripStatus: TripStatus.NOTSTARTED,
          },
        });
        assert(booking.id !== undefined, "Bookings model created successfully (with routeWaypoints JSON and packageId FK)");

        // 4. TripLocations
        const tripLoc = await tx.tripLocations.create({
          data: {
            bookingId: booking.id,
            latitude: 30.0444,
            longitude: 31.2357,
            speed: 60.5,
          },
        });
        assert(tripLoc.id !== undefined, "TripLocations model created successfully");

        // 5. VehicleAvailability
        const avail = await tx.vehicleAvailability.create({
          data: {
            vehicleId: testVehicle.id,
            date: new Date("2026-09-01T00:00:00Z"),
            status: AvailabilityStatus.BOOKED,
            bookingId: booking.id,
          },
        });
        assert(avail.id !== undefined, "VehicleAvailability model created successfully (with bookingId FK)");

        // 6. Payments
        const payment = await tx.payments.create({
          data: {
            bookingId: booking.id,
            userId: testUser.id,
            amount: 500,
            paymentMethod: PaymentMethod.PAYMOB,
            status: PaymentRecordStatus.SUCCESS,
          },
        });
        assert(payment.id !== undefined, "Payments model created successfully");

        // 7. Reviews
        const review = await tx.reviews.create({
          data: {
            bookingId: booking.id,
            reviewerId: testUser.id,
            revieweeId: adminUser!.id,
            reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
            overallRating: 5,
            comment: "Great trip!",
          },
        });
        assert(review.id !== undefined, "Reviews model created successfully");

        // 8. Waitlist
        const waitlist = await tx.waitlist.create({
          data: {
            customerId: testUser.id,
            vehicleId: testVehicle.id,
            bookingId: booking.id,
            requestedDate: "2026-09-01",
            status: WaitlistStatus.WAITING,
          },
        });
        assert(waitlist.id !== undefined, "Waitlist model created successfully");

        // 9. Conversations & Messages
        const conv = await tx.conversations.create({
          data: {
            bookingId: booking.id,
            customerId: testUser.id,
            driverId: testDriver.id,
            status: ConversationStatus.OPEN,
          },
        });
        assert(conv.id !== undefined, "Conversations model created successfully");

        const msg = await tx.messages.create({
          data: {
            conversationId: conv.id,
            senderId: testUser.id,
            senderType: SenderType.CUSTOMER,
            messageType: MessageType.TEXT,
            content: "Hello Driver!",
          },
        });
        assert(msg.id !== undefined, "Messages model created successfully");

        // 10. ScheduledNotifications
        const notif = await tx.scheduledNotifications.create({
          data: {
            bookingId: booking.id,
            recipientId: testUser.id,
            recipientType: NotificationRecipientType.CUSTOMER,
            notificationType: NotificationType.REMINDER_24H,
            channel: NotificationChannel.PUSH,
            title: "Reminder",
            body: "Your trip is tomorrow",
            scheduledAt: new Date(),
          },
        });
        assert(notif.id !== undefined, "ScheduledNotifications model created successfully");

        // 11. Referrals
        const ref = await tx.referrals.create({
          data: {
            referrerId: adminUser!.id,
            referredId: testUser.id,
            referralCode: "REF-TEST-123",
            status: ReferralStatus.COMPLETED,
            rewardAmount: 50,
            triggeringBookingId: booking.id,
          },
        });
        assert(ref.id !== undefined, "Referrals model created successfully");

        // 12. WalletTransactions
        const wtx = await tx.walletTransactions.create({
          data: {
            userId: testUser.id,
            amount: 50.0,
            type: WalletTransactionType.REFERRAL_REWARD,
            description: "Referral reward for test user",
          },
        });
        assert(wtx.id !== undefined, "WalletTransactions model created successfully");

        // Force rollback of test data so DB remains clean
        throw new Error("ROLLBACK_TEST_TRANSACTION");
      });
    } catch (e: any) {
      if (e.message === "ROLLBACK_TEST_TRANSACTION") {
        assert(true, "All 11 new/updated Prisma models instantiated and rolled back cleanly");
      } else {
        assert(false, "Model instantiation transaction failed", e.message);
      }
    }

    // ----------------------------------------------------------------------
    // TEST GROUP 5: CONSTRAINT STRESS-TESTS
    // ----------------------------------------------------------------------
    console.log("\n--- TEST GROUP 5: CONSTRAINT STRESS-TESTS ---");

    // 1. Foreign Key Failure (Invalid Role ID)
    try {
      await prisma.users.create({
        data: {
          name: "FK Fail Test",
          email: "fk_fail@mishwarak.com",
          roleId: "non-existent-uuid-12345",
        },
      });
      assert(false, "Inserting user with invalid roleId should fail");
    } catch (e: any) {
      assert(true, "FK constraint enforced: user creation failed with invalid roleId");
    }

    // 2. Unique Constraint Failure (Duplicate Email)
    try {
      await prisma.users.create({
        data: {
          name: "Duplicate Admin",
          email: "admin@mishwarak.com",
        },
      });
      assert(false, "Inserting duplicate email should fail");
    } catch (e: any) {
      assert(true, "Unique constraint enforced: duplicate email creation failed");
    }

    // 3. Unique Constraint Failure (VehicleAvailability [vehicleId, date])
    const firstVehicle = await prisma.vehicles.findFirst();
    if (firstVehicle) {
      const testDate = new Date("2026-10-01T00:00:00Z");
      await prisma.vehicleAvailability.create({
        data: {
          vehicleId: firstVehicle.id,
          date: testDate,
          status: AvailabilityStatus.AVAILABLE,
        },
      });

      try {
        await prisma.vehicleAvailability.create({
          data: {
            vehicleId: firstVehicle.id,
            date: testDate,
            status: AvailabilityStatus.BLOCKED,
          },
        });
        assert(false, "Inserting duplicate VehicleAvailability [vehicleId, date] should fail");
      } catch (e: any) {
        assert(true, "Unique constraint enforced: duplicate VehicleAvailability [vehicleId, date] failed");
      } finally {
        await prisma.vehicleAvailability.deleteMany({ where: { vehicleId: firstVehicle.id, date: testDate } });
      }
    }

    // 4. Unique Constraint Failure (Bookings [vehicleId, bookingDate, startTime])
    const testCust = await prisma.users.findFirst({ where: { email: "customer@mishwarak.com" } });
    const testDriverProfile = await prisma.drivers.findFirst();
    if (firstVehicle && testCust && testDriverProfile) {
      const b1 = await prisma.bookings.create({
        data: {
          customerId: testCust.id,
          vehicleId: firstVehicle.id,
          driverId: testDriverProfile.id,
          bookingDate: "2026-10-15",
          startTime: "09:00",
          endTime: "12:00",
        },
      });

      try {
        await prisma.bookings.create({
          data: {
            customerId: testCust.id,
            vehicleId: firstVehicle.id,
            driverId: testDriverProfile.id,
            bookingDate: "2026-10-15",
            startTime: "09:00",
            endTime: "15:00",
          },
        });
        assert(false, "Inserting duplicate Booking [vehicleId, bookingDate, startTime] should fail");
      } catch (e: any) {
        assert(true, "Unique constraint enforced: duplicate Booking [vehicleId, bookingDate, startTime] failed");
      } finally {
        await prisma.bookings.delete({ where: { id: b1.id } });
      }
    }

  } catch (globalErr: any) {
    console.error("Global error in empirical test suite:", globalErr);
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n=================================================");
  console.log(`TEST SUITE SUMMARY: Total=${testCount}, Pass=${passCount}, Fail=${failCount}`);
  console.log("=================================================");

  if (failCount > 0) {
    console.error("Failures:");
    failures.forEach((f) => console.error(" - " + f));
    process.exit(1);
  } else {
    console.log("ALL EMPIRICAL TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  }
}

runTests();
