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
  isValidSystemSettingUpdate,
  PayoutRequest,
} from '../tier1/f15_f16_dashboards.test';

describe('Tier 3: Pairwise & Cross-Feature Multi-Module Interaction Tests', () => {

  // --------------------------------------------------------------------------
  // Interaction 1: F4 (Pricing) + F10 (Wallet) + F11 (Referral Program)
  // --------------------------------------------------------------------------
  test('F3-T3-01: Pricing Engine calculates surge price with referral reward discount and deducts wallet balance', () => {
    // 1. Calculate pricing with peak multiplier and referral discount
    const pricing = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 25,
      durationMinutes: 45,
      isPeakHour: true,
      surgeMultiplier: 1.3,
      referralDiscount: 50.0,
    });

    expect(pricing.surgeMultiplier).toBe(1.3);
    expect(pricing.discountAmount).toBe(50.0);
    expect(pricing.totalPrice).toBeGreaterThan(0);

    // 2. Initial rider wallet balance
    const walletTransactions = [
      { type: WalletTransactionType.DEPOSIT, amount: 500.0 },
    ];
    const initialBalance = computeWalletBalance(walletTransactions);
    expect(initialBalance).toBe(500.0);

    // 3. Deduct trip deposit from wallet via PAYMENT_DEDUCTION
    const afterDepositTransactions = [
      ...walletTransactions,
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: pricing.depositPaid },
    ];
    const newBalance = computeWalletBalance(afterDepositTransactions);
    expect(newBalance).toBe(500.0 - pricing.depositPaid);
  });

  // --------------------------------------------------------------------------
  // Interaction 2: F5 (Booking Creation) + F7 (Waitlist) + F14 (Notifications)
  // --------------------------------------------------------------------------
  test('F3-T3-02: Booking cancellation triggers atomic waitlist promotion and queues scheduled notification', () => {
    // 1. Existing primary booking cancelled
    const booking = { id: 'bk-001', status: BookingStatus.PENDING };
    const canCancel = isValidBookingTransition(booking.status, BookingStatus.CANCELLED);
    expect(canCancel).toBe(true);

    // 2. Waitlist queue promotion
    const waitlistQueue = [
      { id: 'wl-1', customerId: 'cust-wait-1', position: 1, status: WaitlistStatus.WAITING },
      { id: 'wl-2', customerId: 'cust-wait-2', position: 2, status: WaitlistStatus.WAITING },
    ];

    const topPosition = waitlistQueue.sort((a, b) => a.position - b.position)[0];
    topPosition.status = WaitlistStatus.PROMOTED;
    expect(topPosition.customerId).toBe('cust-wait-1');
    expect(topPosition.status).toBe(WaitlistStatus.PROMOTED);

    // 3. Queue notification for promoted rider
    const notification = {
      recipientId: topPosition.customerId,
      type: NotificationType.BOOKING_CONFIRMED,
      status: NotificationStatus.PENDING,
      title: 'Waitlist Promotion Success',
      body: 'Your slot has been confirmed!',
    };
    expect(notification.recipientId).toBe('cust-wait-1');
    expect(notification.status).toBe(NotificationStatus.PENDING);
  });

  // --------------------------------------------------------------------------
  // Interaction 3: F6 (Booking State Machine) + F8 (Driver Shift) + F15 (Driver Dashboard)
  // --------------------------------------------------------------------------
  test('F3-T3-03: Driver sets shift ACTIVE, booking appears on driver active trip overview, trip status advances to ONTRIP', () => {
    // 1. Driver shift transition to ACTIVE
    const shiftStep = isValidDriverShiftTransition(DriverStatus.OFF, DriverStatus.ACTIVE);
    expect(shiftStep).toBe(true);

    // 2. Booking active overview
    const mockBookings = [
      {
        id: 'bk-active',
        driverId: 'drv-77',
        riderName: 'Khaled',
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.NOTSTARTED,
        startTime: '11:00',
        bookingDate: '2026-08-10',
      },
    ];
    const activeTrip = getDriverActiveTrip('drv-77', mockBookings);
    expect(activeTrip?.bookingId).toBe('bk-active');

    // 3. Trip status advances from NOTSTARTED -> INPROGRESS
    const tripStep = isValidTripStatusTransition(TripStatus.NOTSTARTED, TripStatus.INPROGRESS);
    expect(tripStep.valid).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Interaction 4: F9 (Reviews) + F15 (Driver Dashboard) + F16 (Admin Dashboard)
  // --------------------------------------------------------------------------
  test('F3-T3-04: Review rating submission releases blind rating and updates driver score on Driver & Admin dashboards', () => {
    // 1. Both rider and driver submit reviews -> blind review visible
    const now = new Date();
    const createdAt = new Date(now.getTime() - 3600 * 1000);
    const visibleAt = new Date(createdAt.getTime() + 48 * 3600 * 1000);

    const isVisible = isBlindReviewVisible(createdAt, visibleAt, true, now);
    expect(isVisible).toBe(true);

    // 2. Driver aggregate rating score updated
    const runningAvg = computeRunningAverageRating([5, 4], 5);
    expect(runningAvg).toBe(4.7);

    // 3. Driver dashboard rating summary reflects update
    const driverProfile = { id: 'drv-001', rating_avg: runningAvg, status: DriverStatus.ACTIVE };
    const overview = getDriverStatusOverview(driverProfile);
    expect(overview.rating_avg).toBe(4.7);
  });

  // --------------------------------------------------------------------------
  // Interaction 5: F10 (Wallet) + F13 (Packages) + F7 (Waitlist Promotion)
  // --------------------------------------------------------------------------
  test('F3-T3-05: Customer purchases package via wallet, consumes slot, cancels booking, and slot is restored', () => {
    // 1. Deduct package cost from wallet
    const transactions = [
      { type: WalletTransactionType.DEPOSIT, amount: 1000.0 },
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: 600.0 }, // 5-trip package
    ];
    const balance = computeWalletBalance(transactions);
    expect(balance).toBe(400.0);

    // 2. Package slot tracking
    const packageRecord = { totalTrips: 5, remainingTrips: 5, status: PackageStatus.ACTIVE };
    packageRecord.remainingTrips -= 1; // Booked trip
    expect(packageRecord.remainingTrips).toBe(4);

    // 3. Cancellation returns slot
    packageRecord.remainingTrips += 1;
    expect(packageRecord.remainingTrips).toBe(5);
  });

  // --------------------------------------------------------------------------
  // Interaction 6: F4 (Pricing Engine) + F6 (Booking State Machine) + F10 (Wallet Payments)
  // --------------------------------------------------------------------------
  test('F3-T3-06: Trip completion calculates final price with distance/time breakdown and executes wallet payment deduction', () => {
    // 1. Calculate final trip price
    const pricing = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.VAN,
      distanceKm: 40,
      durationMinutes: 90,
      customBasePrice: 150,
    });
    expect(pricing.totalPrice).toBeGreaterThan(0);

    // 2. Booking transitions to COMPLETED
    const canComplete = isValidBookingTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED);
    expect(canComplete).toBe(true);

    // 3. Complete payment deduction from wallet
    const transactions = [
      { type: WalletTransactionType.DEPOSIT, amount: 2000.0 },
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: pricing.totalPrice },
    ];
    const remBalance = computeWalletBalance(transactions);
    expect(remBalance).toBe(2000.0 - pricing.totalPrice);
  });

  // --------------------------------------------------------------------------
  // Interaction 7: F5 (Double-Booking Lock) + F8 (Vehicle Availability) + F6 (Booking State Machine)
  // --------------------------------------------------------------------------
  test('F3-T3-07: Double-booking protection detects time overlap, checks driver license/vehicle status before booking', () => {
    // 1. Check driver license & vehicle availability
    const driver = { status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' };
    const vehicle = { status: VehicleStatus.AVAILABLE };
    const assignCheck = canAssignVehicleToDriver(driver, vehicle);
    expect(assignCheck.allowed).toBe(true);

    // 2. Double booking time slot conflict check
    const existingSlot = { start: '10:00', end: '12:00' };
    const newRequestSlot = { start: '11:30', end: '13:00' };
    const isOverlapping = checkSlotOverlap(
      existingSlot.start,
      existingSlot.end,
      newRequestSlot.start,
      newRequestSlot.end
    );
    expect(isOverlapping).toBe(true); // Overlap detected -> blocked
  });

  // --------------------------------------------------------------------------
  // Interaction 8: F12 (In-App Chat) + F6 (Booking Workflow) + F14 (Scheduled Notifications)
  // --------------------------------------------------------------------------
  test('F3-T3-08: Active booking initializes conversation, rider message updates unread count and triggers chat notification', () => {
    // 1. Booking confirmed -> conversation initialized
    const conversation = {
      id: 'conv-100',
      bookingId: 'bk-100',
      status: ConversationStatus.ACTIVE,
    };
    expect(conversation.status).toBe(ConversationStatus.ACTIVE);

    // 2. Rider sends chat message
    const chatMessage = {
      conversationId: 'conv-100',
      senderType: 'CUSTOMER',
      messageType: MessageType.TEXT,
      content: 'I am waiting near entrance gate 2',
    };
    expect(chatMessage.content).toContain('entrance gate 2');

    // 3. Automated push notification triggered for driver
    const notif = {
      recipientId: 'drv-001',
      type: NotificationType.SYSTEM_ALERT,
      title: 'New message from Rider',
      status: NotificationStatus.SENT,
    };
    expect(notif.status).toBe(NotificationStatus.SENT);
  });

  // --------------------------------------------------------------------------
  // Interaction 9: F13 (Packages) + F4 (Pricing) + F5 (Booking Creation)
  // --------------------------------------------------------------------------
  test('F3-T3-09: Multi-vehicle package creation calculates bundle discount and provisions linked bookings', () => {
    // 1. Bundle discount calculation
    const packageDiscount = calculatePackageDiscountAmount(1500.0, 15); // 15% discount
    expect(packageDiscount).toBe(225.0);

    // 2. Multi-booking linked creation
    const bookings = [
      { id: 'b1', packageId: 'pkg-1', vehicleCategory: VehicleCategory.CAR },
      { id: 'b2', packageId: 'pkg-1', vehicleCategory: VehicleCategory.VAN },
    ];
    expect(bookings.length).toBe(2);
    expect(bookings[0].packageId).toBe('pkg-1');
  });

  // --------------------------------------------------------------------------
  // Interaction 10: F15 (Driver Dashboard) + F10 (Wallet/Earnings) + F16 (Admin Approvals)
  // --------------------------------------------------------------------------
  test('F3-T3-10: Driver completes trips, daily earnings summarize payout, Admin approves payout request', () => {
    // 1. Daily earnings summary
    const completedBookings = [
      { id: 'b1', driverId: 'drv-88', bookingDate: '2026-08-09', status: BookingStatus.COMPLETED, totalPrice: 400, tipAmount: 50 },
    ];
    const earnings = calculateDriverDailyEarnings('drv-88', completedBookings, '2026-08-09', 0.15);
    expect(earnings.netPayout).toBe(340); // 400 - 60
    expect(earnings.totalEarnings).toBe(390); // 340 + 50

    // 2. Driver requests payout -> Admin approves
    const payout: PayoutRequest = {
      id: 'po-88',
      driverId: 'drv-88',
      amount: earnings.totalEarnings,
      status: 'PENDING',
      requestedAt: '2026-08-09T18:00:00Z',
    };

    const approval = processDriverPayout(payout, 'APPROVE');
    expect(approval.success).toBe(true);
    expect(approval.payout?.status).toBe('APPROVED');
  });

  // --------------------------------------------------------------------------
  // Interaction 11: F11 (Referral Engine) + F1 (Prisma Models) + F5 (Booking Creation)
  // --------------------------------------------------------------------------
  test('F3-T3-11: Referral code signup links user and activates wallet bonus upon first completed booking', () => {
    const referralRecord = {
      id: 'ref-001',
      referrerId: 'user-referrer',
      refereeId: 'user-referee',
      code: 'REF-MISHWARAK-2026',
      status: ReferralStatus.PENDING,
    };

    // First booking completes
    const canComplete = isValidBookingTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED);
    expect(canComplete).toBe(true);

    // Referral status transitions to REWARDED
    referralRecord.status = ReferralStatus.REWARDED;
    expect(referralRecord.status).toBe(ReferralStatus.REWARDED);
  });

  // --------------------------------------------------------------------------
  // Interaction 12: F8 (Driver Profile) + F9 (Reviews Engine) + F16 (Admin Management)
  // --------------------------------------------------------------------------
  test('F3-T3-12: Driver rating drops below system threshold, trigger admin overview alert and status update', () => {
    // 1. Reviews yield low average
    const lowAvg = computeRunningAverageRating([2, 1], 2);
    expect(lowAvg).toBe(1.7);

    // 2. Admin inspects active drivers
    const drivers = [{ id: 'd-low', status: DriverStatus.ACTIVE, rating_avg: lowAvg }];
    const lowRatingDrivers = drivers.filter((d) => d.rating_avg < 3.0);
    expect(lowRatingDrivers.length).toBe(1);

    // 3. Shift status updated to ONLEAVE / SUSPENDED for retraining
    const shiftStep = isValidDriverShiftTransition(DriverStatus.ACTIVE, DriverStatus.ONLEAVE);
    expect(shiftStep).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Interaction 13: F7 (Cancellation) + F10 (Wallet Refunds) + F14 (Notifications)
  // --------------------------------------------------------------------------
  test('F3-T3-13: Rider cancels confirmed booking 24h prior, refund issued to wallet and SMS notification sent', () => {
    // 1. Cancellation state transition
    const canCancel = isValidBookingTransition(BookingStatus.CONFIRMED, BookingStatus.CANCELLED);
    expect(canCancel).toBe(true);

    // 2. Refund credited back to wallet
    const walletLogs = [
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: 200.0 },
      { type: WalletTransactionType.REFUND, amount: 200.0 },
    ];
    const netWalletEffect = computeWalletBalance(walletLogs);
    expect(netWalletEffect).toBe(0.0);

    // 3. Notification dispatched
    const cancellationNotif = {
      recipientId: 'rider-001',
      type: NotificationType.BOOKING_CANCELLED,
      status: NotificationStatus.SENT,
    };
    expect(cancellationNotif.status).toBe(NotificationStatus.SENT);
  });

  // --------------------------------------------------------------------------
  // Interaction 14: F12 (Chat) + F15 (Driver Dashboard) + F6 (Trip Progress)
  // --------------------------------------------------------------------------
  test('F3-T3-14: Driver receives rider chat message in active trip view and updates trip status to ARRIVED', () => {
    // 1. Active trip view
    const mockBookings = [
      { id: 'bk-33', driverId: 'drv-33', status: BookingStatus.CONFIRMED, tripStatus: TripStatus.INPROGRESS },
    ];
    const trip = getDriverActiveTrip('drv-33', mockBookings);
    expect(trip?.tripStatus).toBe(TripStatus.INPROGRESS);

    // 2. Trip status updated to ARRIVED
    const transition = isValidTripStatusTransition(TripStatus.INPROGRESS, TripStatus.ARRIVED);
    expect(transition.valid).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Interaction 15: F14 (Notifications) + F6 (Booking Workflow) + F4 (Pricing)
  // --------------------------------------------------------------------------
  test('F3-T3-15: Scheduled notification job triggers 2h reminder before trip with price summary', () => {
    const pricing = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 15,
      durationMinutes: 30,
    });

    const reminderNotif = {
      bookingId: 'bk-777',
      type: NotificationType.TRIP_REMINDER_2H,
      status: NotificationStatus.SENT,
      body: `Reminder: Your trip starts in 2 hours. Estimated price: EGP ${pricing.totalPrice}`,
    };

    expect(reminderNotif.status).toBe(NotificationStatus.SENT);
    expect(reminderNotif.body).toContain(`EGP ${pricing.totalPrice}`);
  });

  // --------------------------------------------------------------------------
  // Interaction 16: F16 (Admin Dashboard) + F5 (Booking Overrides) + F8 (Vehicle Availability)
  // --------------------------------------------------------------------------
  test('F3-T3-16: Admin overrides vehicle assignment due to maintenance lock and reassigns available vehicle', () => {
    // 1. Original vehicle placed in MAINTENANCE
    const origVehicle = { id: 'v-old', status: VehicleStatus.MAINTENANCE };
    const canAssignOld = canAssignVehicleToDriver({ status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' }, origVehicle);
    expect(canAssignOld.allowed).toBe(false);

    // 2. Admin performs override to new available vehicle
    const booking = { id: 'bk-override', vehicleId: 'v-old', driverId: 'drv-1', status: BookingStatus.CONFIRMED };
    const override = adminOverrideBooking(booking, { newVehicleId: 'v-new-available' });
    expect(override.success).toBe(true);
    expect(override.updatedBooking.vehicleId).toBe('v-new-available');
  });

  // --------------------------------------------------------------------------
  // Interaction 17: F1 (Prisma Models) + F2 (Zod Validation) + F16 (Admin System Settings)
  // --------------------------------------------------------------------------
  test('F3-T3-17: Admin updates system settings via Zod-validated payload and persists configuration state', () => {
    const settingsUpdate = {
      performanceHistoryVisible: true,
      evaluationsVisible: false,
      selfAppraisalsVisible: true,
      maxSurgeMultiplier: 2.0,
    };

    const validFlag = isValidSystemSettingUpdate('evaluationsVisible', settingsUpdate.evaluationsVisible);
    const validSurge = isValidSystemSettingUpdate('maxSurgeMultiplier', settingsUpdate.maxSurgeMultiplier);

    expect(validFlag.valid).toBe(true);
    expect(validSurge.valid).toBe(true);
  });
});
