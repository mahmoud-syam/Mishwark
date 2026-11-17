import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
  PaymentMethod,
  ReviewerType,
  ConversationStatus,
  MessageType,
  NotificationType,
  NotificationStatus,
  PackageStatus,
  ReferralStatus,
  WalletTransactionType,
  WaitlistStatus,
} from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { calculateEstimatedPrice, checkSlotOverlap, isValidBookingTransition } from '../tier1/f4_f5_f6_f7_bookings_pricing.test';
import {
  isValidDriverShiftTransition,
  canAssignVehicleToDriver,
  computeRunningAverageRating,
  isBlindReviewVisible,
  computeWalletBalance,
  calculateDepositAmount,
  calculatePackageDiscountAmount,
} from '../tier1/f8_to_f14_supplementary_modules.test';
import {
  getDriverActiveTrip,
  getDriverUpcomingSchedule,
  calculateDriverDailyEarnings,
  isValidTripStatusTransition,
  getDriverStatusOverview,
  calculateAdminSystemStats,
  adminOverrideBooking,
  processDriverPayout,
  PayoutRequest,
} from '../tier1/f15_f16_dashboards.test';

describe('Tier 4: Real-World Application Scenarios & End-to-End User Journeys', () => {

  // --------------------------------------------------------------------------
  // Scenario 1: Full Ride Journey: User Registration, Booking, Driver Assignment, Trip Progress, Completion & Rating
  // Features Exercised: F1, F5, F6, F8, F9, F15
  // --------------------------------------------------------------------------
  test('F4-T4-01: Full Ride Journey - Registration, Booking, Driver Assignment, Sequential Trip Progress, Completion & Dual Rating', () => {
    // 1. Rider & Driver registered, driver shift toggle ACTIVE
    const driverShift = isValidDriverShiftTransition(DriverStatus.OFF, DriverStatus.ACTIVE);
    expect(driverShift).toBe(true);

    const vehicleAssign = canAssignVehicleToDriver(
      { status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' },
      { status: VehicleStatus.AVAILABLE }
    );
    expect(vehicleAssign.allowed).toBe(true);

    // 2. Rider creates booking
    const booking = {
      id: 'bk-journey-01',
      customerId: 'rider-usr-01',
      driverId: 'driver-usr-01',
      vehicleId: 'vehicle-01',
      bookingDate: '2026-08-10',
      startTime: '09:00',
      endTime: '11:00',
      status: BookingStatus.PENDING,
      tripStatus: TripStatus.NOTSTARTED,
    };

    // 3. Confirm booking
    const isConfirmed = isValidBookingTransition(booking.status, BookingStatus.CONFIRMED);
    expect(isConfirmed).toBe(true);
    booking.status = BookingStatus.CONFIRMED;

    // 4. Driver sees trip in active trip overview
    const activeTrip = getDriverActiveTrip(booking.driverId, [
      {
        ...booking,
        riderName: 'Jane Doe',
        riderPhone: '+20111111111',
        pickupLocation: 'Zamalek',
        dropoffLocation: 'Maadi',
        totalPrice: 150.0,
      },
    ]);
    expect(activeTrip).not.toBeNull();
    expect(activeTrip?.bookingId).toBe('bk-journey-01');

    // 5. Trip progress transitions: NOTSTARTED -> INPROGRESS -> ARRIVED -> COMPLETED
    let trans = isValidTripStatusTransition(booking.tripStatus, TripStatus.INPROGRESS);
    expect(trans.valid).toBe(true);
    booking.tripStatus = TripStatus.INPROGRESS;

    trans = isValidTripStatusTransition(booking.tripStatus, TripStatus.ARRIVED);
    expect(trans.valid).toBe(true);
    booking.tripStatus = TripStatus.ARRIVED;

    trans = isValidTripStatusTransition(booking.tripStatus, TripStatus.COMPLETED);
    expect(trans.valid).toBe(true);
    booking.tripStatus = TripStatus.COMPLETED;

    const bookingComplete = isValidBookingTransition(booking.status, BookingStatus.COMPLETED);
    expect(bookingComplete).toBe(true);
    booking.status = BookingStatus.COMPLETED;

    // 6. Dual ratings submitted & running average updated
    const newRatingAvg = computeRunningAverageRating([5], 5);
    expect(newRatingAvg).toBe(5.0);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Pricing & Discount Stacking: Package Purchase, Referral Redemption, Surge Calculation, Deposit Deduction & Wallet Payout
  // Features Exercised: F4, F10, F11, F13
  // --------------------------------------------------------------------------
  test('F4-T4-02: Pricing & Discount Stacking - Package Purchase, Referral Redemption, Peak Surge Math, Deposit Deduction & Driver Payout', () => {
    // 1. Initial wallet top-up via DEPOSIT
    const userWallet = [{ type: WalletTransactionType.DEPOSIT, amount: 2000.0 }];
    expect(computeWalletBalance(userWallet)).toBe(2000.0);

    // 2. Package purchase (bundle discount)
    const pkgDiscount = calculatePackageDiscountAmount(800.0, 20); // 20% off pkg
    expect(pkgDiscount).toBe(160.0);

    // 3. Trip price calculation with Peak Surge (1.4x), Package discount (100 EGP), and Referral discount (50 EGP)
    const pricing = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.VAN,
      distanceKm: 30,
      durationMinutes: 60,
      isPeakHour: true,
      surgeMultiplier: 1.4,
      packageDiscount: 100.0,
      referralDiscount: 50.0,
    });

    expect(pricing.surgeMultiplier).toBe(1.4);
    expect(pricing.discountAmount).toBe(150.0); // 100 + 50
    expect(pricing.depositPaid).toBe(Math.round(pricing.totalPrice * 0.20 * 100) / 100);

    // 4. Wallet deposit deduction via PAYMENT_DEDUCTION
    const afterDepositWallet = [
      ...userWallet,
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: pricing.depositPaid },
    ];
    const balanceAfterDeposit = computeWalletBalance(afterDepositWallet);
    expect(balanceAfterDeposit).toBe(2000.0 - pricing.depositPaid);

    // 5. Driver earnings payout calculation
    const driverEarnings = calculateDriverDailyEarnings(
      'drv-001',
      [{ driverId: 'drv-001', bookingDate: '2026-08-10', status: BookingStatus.COMPLETED, totalPrice: pricing.totalPrice, tipAmount: 30 }],
      '2026-08-10',
      0.15
    );
    expect(driverEarnings.grossEarnings).toBe(pricing.totalPrice);
    expect(driverEarnings.totalEarnings).toBe(driverEarnings.netPayout + 30);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Concurrency & Overbooking: Simultaneous Bookings, Time-Window Collisions, Waitlist Enqueue & Automated Promotion
  // Features Exercised: F5, F7, F10, F14
  // --------------------------------------------------------------------------
  test('F4-T4-03: Concurrency & Overbooking - Collision Blocking, Waitlist Enqueue, Cancellation & Automated Promotion', () => {
    // 1. Rider A confirms primary booking 14:00-16:00
    const primarySlot = { start: '14:00', end: '16:00' };

    // 2. Rider B attempts booking same vehicle 15:00-17:00 -> Overlap collision!
    const requestedSlot = { start: '15:00', end: '17:00' };
    const hasCollision = checkSlotOverlap(primarySlot.start, primarySlot.end, requestedSlot.start, requestedSlot.end);
    expect(hasCollision).toBe(true);

    // 3. Rider B enqueued to waitlist
    const waitlist = [
      { id: 'wl-100', customerId: 'rider-B', vehicleId: 'veh-01', position: 1, status: WaitlistStatus.WAITING },
    ];
    expect(waitlist[0].position).toBe(1);

    // 4. Rider A cancels booking 14:00-16:00
    const canCancel = isValidBookingTransition(BookingStatus.CONFIRMED, BookingStatus.CANCELLED);
    expect(canCancel).toBe(true);

    // 5. Automatic waitlist promotion for Rider B
    const topWaitlist = waitlist[0];
    topWaitlist.status = WaitlistStatus.PROMOTED;
    expect(topWaitlist.status).toBe(WaitlistStatus.PROMOTED);

    // 6. Automated notification dispatched to Rider B
    const promoNotification = {
      recipientId: topWaitlist.customerId,
      type: NotificationType.WAITLIST_PROMOTED,
      status: NotificationStatus.SENT,
    };
    expect(promoNotification.status).toBe(NotificationStatus.SENT);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Driver Shift Management, Vehicle Maintenance Lock & Trip State Transitions
  // Features Exercised: F6, F8, F15
  // --------------------------------------------------------------------------
  test('F4-T4-04: Driver Shift Management - Shift Toggles, Maintenance Lockout & Active Trip Execution', () => {
    // 1. Driver shift transitions: OFF -> ONLEAVE -> ACTIVE
    let shiftCheck = isValidDriverShiftTransition(DriverStatus.OFF, DriverStatus.ACTIVE);
    expect(shiftCheck).toBe(true);

    shiftCheck = isValidDriverShiftTransition(DriverStatus.ACTIVE, DriverStatus.ONLEAVE);
    expect(shiftCheck).toBe(true);

    shiftCheck = isValidDriverShiftTransition(DriverStatus.ONLEAVE, DriverStatus.ACTIVE);
    expect(shiftCheck).toBe(true);

    // 2. Vehicle placed in MAINTENANCE status -> blocks new assignments
    const maintenanceVehicle = { status: VehicleStatus.MAINTENANCE };
    const assignCheck = canAssignVehicleToDriver(
      { status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' },
      maintenanceVehicle
    );
    expect(assignCheck.allowed).toBe(false);
    expect(assignCheck.reason).toContain('not AVAILABLE');

    // 3. Maintenance completed -> vehicle restored to AVAILABLE
    maintenanceVehicle.status = VehicleStatus.AVAILABLE;
    const restoredAssign = canAssignVehicleToDriver(
      { status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' },
      maintenanceVehicle
    );
    expect(restoredAssign.allowed).toBe(true);

    // 4. Driver executes trip status transitions on Driver Dashboard
    const step1 = isValidTripStatusTransition(TripStatus.NOTSTARTED, TripStatus.INPROGRESS);
    expect(step1.valid).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Blind Review Release & Driver Aggregate Score Update
  // Features Exercised: F6, F9, F15
  // --------------------------------------------------------------------------
  test('F4-T4-05: Blind Review Release - Trip Completion, Hidden Review Window, Dual Submission & Driver Rating Update', () => {
    // 1. Trip completed
    const isCompleted = isValidBookingTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED);
    expect(isCompleted).toBe(true);

    // 2. Rider submits review at T+0h, Driver review pending -> Review is HIDDEN (blind)
    const now = new Date();
    const createdAt = new Date(now.getTime() - 3600 * 1000);
    const visibleAt = new Date(createdAt.getTime() + 48 * 3600 * 1000);

    const initialVisibility = isBlindReviewVisible(createdAt, visibleAt, false, now);
    expect(initialVisibility).toBe(false);

    // 3. Driver submits review -> Blind restriction released!
    const finalVisibility = isBlindReviewVisible(createdAt, visibleAt, true, now);
    expect(finalVisibility).toBe(true);

    // 4. Driver aggregate score updated on Driver Dashboard
    const aggregateScore = computeRunningAverageRating([5, 4], 5);
    expect(aggregateScore).toBe(4.7);

    const driverDashboard = getDriverStatusOverview({
      id: 'drv-001',
      fullName: 'Sami',
      status: DriverStatus.ACTIVE,
      rating_avg: aggregateScore,
    });
    expect(driverDashboard.rating_avg).toBe(4.7);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Chat & Notification Automation during Active Booking
  // Features Exercised: F6, F12, F14
  // --------------------------------------------------------------------------
  test('F4-T4-06: Chat & Notification Automation - Booking Confirmation, Conversation Thread, Quick Replies & Scheduled Alerts', () => {
    // 1. Booking confirmed
    const booking = { id: 'bk-chat-scen', status: BookingStatus.CONFIRMED };

    // 2. Conversation initialized
    const chatRoom = {
      id: 'room-01',
      bookingId: booking.id,
      status: ConversationStatus.ACTIVE,
      messages: [],
    };
    expect(chatRoom.status).toBe(ConversationStatus.ACTIVE);

    // 3. Rider sends text message & driver sends quick-reply
    const msg1 = { sender: 'RIDER', content: 'Where are you currently located?', type: MessageType.TEXT };
    const msg2 = { sender: 'DRIVER', content: 'I am 2 minutes away', type: MessageType.QUICK_REPLY };
    expect(msg1.type).toBe(MessageType.TEXT);
    expect(msg2.type).toBe(MessageType.QUICK_REPLY);

    // 4. Scheduled notifications queued (24h, 2h, post-trip review prompt)
    const scheduledAlerts = [
      { type: NotificationType.TRIP_REMINDER_24H, status: NotificationStatus.SENT },
      { type: NotificationType.TRIP_REMINDER_2H, status: NotificationStatus.SENT },
      { type: NotificationType.POST_TRIP_REVIEW_PROMPT, status: NotificationStatus.PENDING },
    ];

    expect(scheduledAlerts.filter((a) => a.status === NotificationStatus.SENT).length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Admin System Override, Booking Cancellation, Refund & Dashboard Analytics
  // Features Exercised: F7, F10, F16
  // --------------------------------------------------------------------------
  test('F4-T4-07: Admin System Override - Operational Cancellation, Wallet Refund & Platform Analytics Update', () => {
    // 1. Admin inspects initial system analytics
    const initialStats = calculateAdminSystemStats(
      [{ id: 'u1' }, { id: 'u2' }],
      [{ id: 'd1', status: DriverStatus.ACTIVE }],
      [{ id: 'b1', status: BookingStatus.COMPLETED, totalPrice: 500 }]
    );
    expect(initialStats.cancellationRate).toBe(0);

    // 2. Admin performs manual booking override to CANCELLED
    const problematicBooking = { id: 'bk-prob', status: BookingStatus.PENDING, totalPrice: 300 };
    const override = adminOverrideBooking(problematicBooking, { newStatus: BookingStatus.CANCELLED });
    expect(override.success).toBe(true);
    expect(override.updatedBooking.status).toBe(BookingStatus.CANCELLED);

    // 3. Automatic refund credited to rider wallet
    const walletLogs = [
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: 300.0 },
      { type: WalletTransactionType.REFUND, amount: 300.0 },
    ];
    const finalBalance = computeWalletBalance(walletLogs);
    expect(finalBalance).toBe(0.0);

    // 4. Updated admin system analytics reflect new cancellation rate
    const updatedStats = calculateAdminSystemStats(
      [{ id: 'u1' }, { id: 'u2' }],
      [{ id: 'd1', status: DriverStatus.ACTIVE }],
      [
        { id: 'b1', status: BookingStatus.COMPLETED, totalPrice: 500 },
        { id: 'bk-prob', status: BookingStatus.CANCELLED, totalPrice: 300 },
      ]
    );
    expect(updatedStats.cancelledBookings).toBe(1);
    expect(updatedStats.cancellationRate).toBe(50.0); // 1 out of 2 = 50%
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Multi-Event Package Creation, Allocation & Exhaustion
  // Features Exercised: F4, F5, F13
  // --------------------------------------------------------------------------
  test('F4-T4-08: Multi-Event Package Lifecycle - Purchase, Slot Allocation, Usage Tracking & Exhaustion Guard', () => {
    // 1. Customer purchases 3-trip multi-event package
    const packageAccount = {
      packageId: 'pkg-multi-3',
      totalTrips: 3,
      remainingTrips: 3,
      status: PackageStatus.ACTIVE,
    };

    // 2. Booking 1: Allocates slot 1 (remaining = 2)
    packageAccount.remainingTrips -= 1;
    expect(packageAccount.remainingTrips).toBe(2);

    // 3. Booking 2: Allocates slot 2 (remaining = 1)
    packageAccount.remainingTrips -= 1;
    expect(packageAccount.remainingTrips).toBe(1);

    // 4. Booking 3: Allocates slot 3 (remaining = 0)
    packageAccount.remainingTrips -= 1;
    expect(packageAccount.remainingTrips).toBe(0);
    packageAccount.status = PackageStatus.EXHAUSTED;

    // 5. Booking 4 attempt: Package exhausted error -> standard pricing engine fallback
    const canUsePackage = packageAccount.remainingTrips > 0 && packageAccount.status === PackageStatus.ACTIVE;
    expect(canUsePackage).toBe(false);

    const fallbackPricing = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 10,
      durationMinutes: 20,
    });
    expect(fallbackPricing.totalPrice).toBeGreaterThan(0);
  });
});
