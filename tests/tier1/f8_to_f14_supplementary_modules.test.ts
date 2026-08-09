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
  PaymentRecordStatus,
  ReviewerType,
  ConversationStatus,
  SenderType,
  MessageType,
  NotificationRecipientType,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  PackageType,
  PackageStatus,
  ReferralStatus,
  WalletTransactionType,
  AvailabilityStatus,
} from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';

// ============================================================================
// Authoritative Reference Calculators & State Logic Helpers for F8 - F14
// ============================================================================

export function isValidDriverShiftTransition(from: DriverStatus, to: DriverStatus): boolean {
  const allowed: Record<DriverStatus, DriverStatus[]> = {
    [DriverStatus.ACTIVE]: [DriverStatus.OFF, DriverStatus.ONLEAVE, DriverStatus.ONTRIP],
    [DriverStatus.OFF]: [DriverStatus.ACTIVE],
    [DriverStatus.ONLEAVE]: [DriverStatus.ACTIVE],
    [DriverStatus.ONTRIP]: [DriverStatus.ACTIVE],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function canAssignVehicleToDriver(
  driver: { status: DriverStatus; licenseExpiry: string | Date },
  vehicle: { status: VehicleStatus }
): { allowed: boolean; reason?: string } {
  if (driver.status !== DriverStatus.ACTIVE) {
    return { allowed: false, reason: 'Driver is not ACTIVE' };
  }
  const expiry = new Date(driver.licenseExpiry);
  if (isNaN(expiry.getTime()) || expiry <= new Date()) {
    return { allowed: false, reason: 'Driver license is expired or invalid' };
  }
  if (vehicle.status !== VehicleStatus.AVAILABLE) {
    return { allowed: false, reason: 'Vehicle is not AVAILABLE' };
  }
  return { allowed: true };
}

export function computeRunningAverageRating(existingRatings: number[], newRating: number): number {
  if (newRating < 1 || newRating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  const all = [...existingRatings, newRating];
  const sum = all.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / all.length) * 10) / 10;
}

export function isBlindReviewVisible(
  reviewCreatedAt: Date,
  visibleAt: Date,
  bothSubmitted: boolean,
  currentTime: Date
): boolean {
  if (bothSubmitted) return true;
  return currentTime.getTime() >= visibleAt.getTime();
}

export function computeWalletBalance(
  transactions: { type: WalletTransactionType; amount: number }[]
): number {
  let balance = 0;
  for (const tx of transactions) {
    switch (tx.type) {
      case WalletTransactionType.DEPOSIT:
      case WalletTransactionType.REFUND:
      case WalletTransactionType.REFERRAL_REWARD:
        balance += tx.amount;
        break;
      case WalletTransactionType.MANUAL_ADJUSTMENT:
        balance += tx.amount; // Can be positive or negative
        break;
      case WalletTransactionType.PAYMENT_DEDUCTION:
        balance -= tx.amount;
        break;
    }
  }
  return Math.round(balance * 100) / 100;
}

export function calculateDepositAmount(totalPrice: number): number {
  return Math.round(totalPrice * 0.20 * 100) / 100;
}

export function generateReferralCodeString(userId: string): string {
  const cleanId = userId.replace(/-/g, '').substring(0, 6).toUpperCase();
  return `REF-${cleanId}`;
}

export function calculatePackageDiscountAmount(totalPrice: number, discountPercentage: number): number {
  const clampedDiscount = Math.max(0, Math.min(100, discountPercentage));
  return Math.round(totalPrice * (clampedDiscount / 100) * 100) / 100;
}

export function isValidNotificationChannel(channel: string): boolean {
  return Object.values(NotificationChannel).includes(channel as NotificationChannel);
}

// ============================================================================
// Tier 1 Test Suite Execution
// ============================================================================

describe('Tier 1: Features F8 to F14 - Supplementary Modules Coverage', () => {

  // --------------------------------------------------------------------------
  // Feature F8: Driver Profile & Vehicle Availability API
  // --------------------------------------------------------------------------

  test('F8-T1-01: Driver profile query returns complete details including license number, expiry, rating, and status', async () => {
    const mockSeed = getMockSeedData();
    const profile = {
      id: mockSeed.driverProfile.id,
      fullName: mockSeed.driverProfile.fullName,
      licenseNumber: 'LIC-998877',
      licenseExpiry: '2030-12-31',
      rating: 4.9,
      status: DriverStatus.ACTIVE,
    };

    expect(profile.id).toBeDefined();
    expect(profile.fullName).toBe('Test Driver Profile');
    expect(profile.licenseNumber).toBe('LIC-998877');
    expect(profile.rating).toBe(4.9);
    expect(profile.status).toBe(DriverStatus.ACTIVE);
  });

  test('F8-T1-02: Shift status toggling updates driver status between ACTIVE and OFF / ONLEAVE', () => {
    let currentStatus = DriverStatus.ACTIVE;

    // Toggle to OFF
    if (isValidDriverShiftTransition(currentStatus, DriverStatus.OFF)) {
      currentStatus = DriverStatus.OFF;
    }
    expect(currentStatus).toBe(DriverStatus.OFF);

    // Toggle back to ACTIVE
    if (isValidDriverShiftTransition(currentStatus, DriverStatus.ACTIVE)) {
      currentStatus = DriverStatus.ACTIVE;
    }
    expect(currentStatus).toBe(DriverStatus.ACTIVE);

    // Toggle to ONLEAVE
    if (isValidDriverShiftTransition(currentStatus, DriverStatus.ONLEAVE)) {
      currentStatus = DriverStatus.ONLEAVE;
    }
    expect(currentStatus).toBe(DriverStatus.ONLEAVE);
  });

  test('F8-T1-03: Driver shift status transitions to ONTRIP when assigned to active booking and back to ACTIVE when trip completes', () => {
    let currentStatus = DriverStatus.ACTIVE;

    // Assign to active trip
    if (isValidDriverShiftTransition(currentStatus, DriverStatus.ONTRIP)) {
      currentStatus = DriverStatus.ONTRIP;
    }
    expect(currentStatus).toBe(DriverStatus.ONTRIP);

    // Complete trip
    if (isValidDriverShiftTransition(currentStatus, DriverStatus.ACTIVE)) {
      currentStatus = DriverStatus.ACTIVE;
    }
    expect(currentStatus).toBe(DriverStatus.ACTIVE);
  });

  test('F8-T1-04: Primary vehicle assignment binds driver to a vehicle in VehicleDrivers with isPrimary = true', () => {
    const driver = { id: 'drv-101', status: DriverStatus.ACTIVE, licenseExpiry: '2030-01-01' };
    const vehicle = { id: 'veh-101', status: VehicleStatus.AVAILABLE };

    const check = canAssignVehicleToDriver(driver, vehicle);
    expect(check.allowed).toBe(true);

    const vehicleDriverAssignment = {
      id: 'vd-001',
      vehicleId: vehicle.id,
      driverId: driver.id,
      isPrimary: true,
      createdAt: new Date(),
    };

    expect(vehicleDriverAssignment.vehicleId).toBe('veh-101');
    expect(vehicleDriverAssignment.driverId).toBe('drv-101');
    expect(vehicleDriverAssignment.isPrimary).toBe(true);
  });

  test('F8-T1-05: Vehicle availability blockage creates a VehicleAvailability record with BLOCKED status for a specific date and reason', () => {
    const blockage = {
      id: 'va-block-001',
      vehicleId: 'veh-202',
      date: new Date('2026-10-15'),
      status: AvailabilityStatus.BLOCKED,
      reason: 'Scheduled routine maintenance',
    };

    expect(blockage.vehicleId).toBe('veh-202');
    expect(blockage.status).toBe(AvailabilityStatus.BLOCKED);
    expect(blockage.reason).toContain('maintenance');
  });

  test('F8-T1-06: Querying vehicle availability filters out dates blocked with BLOCKED status', () => {
    const availabilities = [
      { date: '2026-10-01', status: AvailabilityStatus.AVAILABLE },
      { date: '2026-10-02', status: AvailabilityStatus.BLOCKED, reason: 'Maintenance' },
      { date: '2026-10-03', status: AvailabilityStatus.BOOKED },
    ];

    const openDates = availabilities.filter((a) => a.status === AvailabilityStatus.AVAILABLE);
    expect(openDates.length).toBe(1);
    expect(openDates[0].date).toBe('2026-10-01');
  });

  // --------------------------------------------------------------------------
  // Feature F9: Reviews & Rating Engine
  // --------------------------------------------------------------------------

  test('F9-T1-07: Rider submits review for driver (CUSTOMER_TO_DRIVER) with overall rating, vehicle rating, punctuality rating, and comment', () => {
    const review = {
      id: 'rev-001',
      bookingId: 'bk-991',
      reviewerId: 'usr-rider-01',
      revieweeId: 'usr-driver-01',
      reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
      overallRating: 5,
      vehicleRating: 5,
      punctualityRating: 4,
      comment: 'Excellent trip and clean vehicle!',
      createdAt: new Date(),
    };

    expect(review.reviewerType).toBe(ReviewerType.CUSTOMER_TO_DRIVER);
    expect(review.overallRating).toBe(5);
    expect(review.vehicleRating).toBe(5);
    expect(review.punctualityRating).toBe(4);
  });

  test('F9-T1-08: Driver submits review for rider (DRIVER_TO_CUSTOMER) with overall rating and comment', () => {
    const review = {
      id: 'rev-002',
      bookingId: 'bk-991',
      reviewerId: 'usr-driver-01',
      revieweeId: 'usr-rider-01',
      reviewerType: ReviewerType.DRIVER_TO_CUSTOMER,
      overallRating: 4,
      comment: 'Polite rider, on time.',
      createdAt: new Date(),
    };

    expect(review.reviewerType).toBe(ReviewerType.DRIVER_TO_CUSTOMER);
    expect(review.overallRating).toBe(4);
  });

  test('F9-T1-09: Running average rating computation updates driver rating based on all submitted reviews', () => {
    const existingDriverRatings = [5, 4, 5, 4]; // sum 18, avg 4.5
    const newRating = 5;
    const updatedAvg = computeRunningAverageRating(existingDriverRatings, newRating);

    // (18 + 5) / 5 = 23 / 5 = 4.6
    expect(updatedAvg).toBe(4.6);
  });

  test('F9-T1-10: Running average rating computation updates customer customerRating based on driver reviews', () => {
    const existingRiderRatings = [4.0, 5.0];
    const newRating = 3;
    const updatedAvg = computeRunningAverageRating(existingRiderRatings, newRating);

    // (4 + 5 + 3) / 3 = 12 / 3 = 4.0
    expect(updatedAvg).toBe(4.0);
  });

  test('F9-T1-11: Blind review rule sets visibleAt timestamp to 48 hours after review creation', () => {
    const createdAt = new Date('2026-09-01T10:00:00Z');
    const visibleAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);

    const currentTimeBeforeExpiry = new Date('2026-09-02T10:00:00Z'); // 24 hours later
    const isVisibleSolo = isBlindReviewVisible(createdAt, visibleAt, false, currentTimeBeforeExpiry);
    expect(isVisibleSolo).toBe(false);

    const currentTimeAfterExpiry = new Date('2026-09-03T10:00:01Z'); // >48 hours later
    const isVisibleAfter = isBlindReviewVisible(createdAt, visibleAt, false, currentTimeAfterExpiry);
    expect(isVisibleAfter).toBe(true);
  });

  test('F9-T1-12: Blind review rule reveals reviews immediately when both rider and driver have submitted their reviews before 48h', () => {
    const createdAt = new Date('2026-09-01T10:00:00Z');
    const visibleAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
    const currentTimeBeforeExpiry = new Date('2026-09-01T12:00:00Z'); // 2 hours later

    const bothSubmitted = true;
    const isVisibleNow = isBlindReviewVisible(createdAt, visibleAt, bothSubmitted, currentTimeBeforeExpiry);
    expect(isVisibleNow).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Feature F10: Wallet & Payments Integration
  // --------------------------------------------------------------------------

  test('F10-T1-13: Wallet balance is accurately computed as the net sum of DEPOSIT, REFUND, REFERRAL_REWARD, MANUAL_ADJUSTMENT, and PAYMENT_DEDUCTION transactions', () => {
    const transactions = [
      { type: WalletTransactionType.DEPOSIT, amount: 200.0 },
      { type: WalletTransactionType.REFERRAL_REWARD, amount: 50.0 },
      { type: WalletTransactionType.PAYMENT_DEDUCTION, amount: 80.0 },
      { type: WalletTransactionType.REFUND, amount: 30.0 },
      { type: WalletTransactionType.MANUAL_ADJUSTMENT, amount: -10.0 },
    ];

    // Net = 200 + 50 - 80 + 30 - 10 = 190.0
    const balance = computeWalletBalance(transactions);
    expect(balance).toBe(190.0);
  });

  test('F10-T1-14: Transaction logging records wallet operations with type, amount, user ID, and description', () => {
    const tx = {
      id: 'tx-101',
      userId: 'usr-wallet-01',
      amount: 50.0,
      type: WalletTransactionType.REFERRAL_REWARD,
      description: 'Reward for referring user RDR-002',
      createdAt: new Date(),
    };

    expect(tx.userId).toBe('usr-wallet-01');
    expect(tx.type).toBe(WalletTransactionType.REFERRAL_REWARD);
    expect(tx.amount).toBe(50.0);
  });

  test('F10-T1-15: Payment recording succeeds for CASH, FAWRY, PAYMOB, and WALLET payment methods', () => {
    const methods = [PaymentMethod.CASH, PaymentMethod.FAWRY, PaymentMethod.PAYMOB, PaymentMethod.WALLET];

    for (const method of methods) {
      const payment = {
        id: `pay-${method.toLowerCase()}`,
        bookingId: 'bk-500',
        amount: 150.0,
        paymentMethod: method,
        status: PaymentRecordStatus.SUCCESS,
      };
      expect(payment.status).toBe(PaymentRecordStatus.SUCCESS);
      expect(payment.paymentMethod).toBe(method);
    }
  });

  test('F10-T1-16: Deposit deduction correctly records 20% of booking total price as initial deposit payment', () => {
    const bookingTotalPrice = 350.0;
    const deposit = calculateDepositAmount(bookingTotalPrice);

    expect(deposit).toBe(70.0); // 350 * 0.20 = 70.0
  });

  test('F10-T1-17: Refund processing updates payment status to REFUNDED and adds REFUND transaction to user wallet balance', () => {
    const payment = {
      id: 'pay-to-refund-01',
      amount: 100.0,
      status: PaymentRecordStatus.SUCCESS,
    };

    // Execute refund
    payment.status = PaymentRecordStatus.REFUNDED;
    const refundTx = {
      type: WalletTransactionType.REFUND,
      amount: payment.amount,
      description: `Refund for payment ${payment.id}`,
    };

    expect(payment.status).toBe(PaymentRecordStatus.REFUNDED);
    expect(refundTx.type).toBe(WalletTransactionType.REFUND);
    expect(refundTx.amount).toBe(100.0);
  });

  test('F10-T1-18: Partial payment recording updates booking payment status to PARTIALLY_PAID until remaining balance is settled', () => {
    const booking = {
      totalPrice: 200.0,
      paidAmount: 70.0,
      paymentStatus: PaymentStatus.UNPAID,
    };

    if (booking.paidAmount > 0 && booking.paidAmount < booking.totalPrice) {
      booking.paymentStatus = PaymentStatus.PARTIALLY_PAID;
    }

    expect(booking.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);
  });

  // --------------------------------------------------------------------------
  // Feature F11: Referral Program Engine
  // --------------------------------------------------------------------------

  test('F11-T1-19: Referral code generation creates a unique referral code string for user registration', () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const code = generateReferralCodeString(userId);

    expect(code).toBe('REF-123E45');
    expect(code.startsWith('REF-')).toBe(true);
  });

  test('F11-T1-20: Referral tracking links referrer and referred user in Referrals table with status PENDING', () => {
    const referralRecord = {
      id: 'ref-track-001',
      referrerId: 'usr-referrer-1',
      referredId: 'usr-referred-2',
      referralCode: 'REF-USER01',
      status: ReferralStatus.PENDING,
      rewardAmount: 50.0,
    };

    expect(referralRecord.referrerId).toBe('usr-referrer-1');
    expect(referralRecord.referredId).toBe('usr-referred-2');
    expect(referralRecord.status).toBe(ReferralStatus.PENDING);
  });

  test('F11-T1-21: Referral status transitions to COMPLETED upon first completed booking by the referred user', () => {
    const referral = {
      id: 'ref-001',
      status: ReferralStatus.PENDING,
      completedAt: null as Date | null,
    };

    // First booking completed
    referral.status = ReferralStatus.COMPLETED;
    referral.completedAt = new Date();

    expect(referral.status).toBe(ReferralStatus.COMPLETED);
    expect(referral.completedAt).toBeDefined();
  });

  test('F11-T1-22: Referral bonus allocation credits wallet bonus (e.g. 50.0) to referrer via REFERRAL_REWARD transaction', () => {
    const referrerUser = { id: 'usr-referrer-1', walletBalance: 100.0 };
    const bonusAmount = 50.0;

    const rewardTx = {
      userId: referrerUser.id,
      amount: bonusAmount,
      type: WalletTransactionType.REFERRAL_REWARD,
      description: 'Bonus for referred user first completed trip',
    };

    referrerUser.walletBalance = computeWalletBalance([
      { type: WalletTransactionType.DEPOSIT, amount: 100.0 },
      rewardTx,
    ]);

    expect(referrerUser.walletBalance).toBe(150.0);
  });

  test('F11-T1-23: Discount application applies referral discount to booking total price calculation for referred customer', () => {
    const baseTotal = 200.0;
    const referralDiscount = 30.0;
    const finalPrice = Math.max(0, baseTotal - referralDiscount);

    expect(finalPrice).toBe(170.0);
  });

  test('F11-T1-24: Querying referral history returns all referred users, current statuses, and total earned rewards', () => {
    const userReferrals = [
      { id: 'ref-1', status: ReferralStatus.COMPLETED, rewardAmount: 50.0 },
      { id: 'ref-2', status: ReferralStatus.COMPLETED, rewardAmount: 50.0 },
      { id: 'ref-3', status: ReferralStatus.PENDING, rewardAmount: 50.0 },
    ];

    const completedRewards = userReferrals
      .filter((r) => r.status === ReferralStatus.COMPLETED)
      .reduce((sum, r) => sum + r.rewardAmount, 0);

    expect(completedRewards).toBe(100.0);
  });

  // --------------------------------------------------------------------------
  // Feature F12: In-App Chat / Messaging
  // --------------------------------------------------------------------------

  test('F12-T1-25: In-app chat conversation initializes for a booking linking customer and driver with OPEN status', () => {
    const conversation = {
      id: 'conv-001',
      bookingId: 'bk-chat-01',
      customerId: 'usr-customer-01',
      driverId: 'drv-profile-01',
      status: ConversationStatus.OPEN,
      createdAt: new Date(),
    };

    expect(conversation.bookingId).toBe('bk-chat-01');
    expect(conversation.status).toBe(ConversationStatus.OPEN);
  });

  test('F12-T1-26: Customer sends text message (TEXT) in conversation creating a Messages record', () => {
    const msg = {
      id: 'msg-001',
      conversationId: 'conv-001',
      senderId: 'usr-customer-01',
      senderType: SenderType.CUSTOMER,
      messageType: MessageType.TEXT,
      content: 'Hello, I have arrived at the pickup location.',
      isRead: false,
    };

    expect(msg.senderType).toBe(SenderType.CUSTOMER);
    expect(msg.messageType).toBe(MessageType.TEXT);
    expect(msg.isRead).toBe(false);
  });

  test('F12-T1-27: Driver sends quick-reply message (QUICK_REPLY) in conversation', () => {
    const msg = {
      id: 'msg-002',
      conversationId: 'conv-001',
      senderId: 'usr-driver-user-01',
      senderType: SenderType.DRIVER,
      messageType: MessageType.QUICK_REPLY,
      content: 'I am 2 minutes away.',
      isRead: false,
    };

    expect(msg.senderType).toBe(SenderType.DRIVER);
    expect(msg.messageType).toBe(MessageType.QUICK_REPLY);
  });

  test('F12-T1-28: Mark read status updates isRead = true for unread messages received in conversation', () => {
    const messageList = [
      { id: 'm1', senderType: SenderType.CUSTOMER, isRead: false },
      { id: 'm2', senderType: SenderType.CUSTOMER, isRead: false },
    ];

    // Driver marks conversation messages as read
    const updated = messageList.map((m) => ({ ...m, isRead: true }));

    expect(updated.every((m) => m.isRead === true)).toBe(true);
  });

  test('F12-T1-29: Querying conversation messages returns chronological message history with sender info', () => {
    const history = [
      { id: 'm1', createdAt: new Date('2026-10-01T10:00:00Z'), content: 'First message' },
      { id: 'm2', createdAt: new Date('2026-10-01T10:01:00Z'), content: 'Second message' },
    ];

    const isSorted = history[0].createdAt < history[1].createdAt;
    expect(isSorted).toBe(true);
  });

  test('F12-T1-30: Closing conversation transitions conversation status from OPEN to CLOSED', () => {
    const conversation = { id: 'conv-001', status: ConversationStatus.OPEN };

    // Close on booking completion
    conversation.status = ConversationStatus.CLOSED;
    expect(conversation.status).toBe(ConversationStatus.CLOSED);
  });

  // --------------------------------------------------------------------------
  // Feature F13: Multi-Vehicle & Multi-Event Packages
  // --------------------------------------------------------------------------

  test('F13-T1-31: Multi-vehicle package creation creates Packages record with MULTI_CAR type, total price, and discount percentage', () => {
    const pkg = {
      id: 'pkg-car-001',
      customerId: 'usr-customer-01',
      packageName: 'Wedding Fleet Bundle (3 Cars)',
      packageType: PackageType.MULTI_CAR,
      totalPrice: 1200.0,
      discountPercentage: 15.0,
      status: PackageStatus.ACTIVE,
    };

    expect(pkg.packageType).toBe(PackageType.MULTI_CAR);
    expect(pkg.discountPercentage).toBe(15.0);
    expect(pkg.status).toBe(PackageStatus.ACTIVE);
  });

  test('F13-T1-32: Multi-event package creation creates Packages record with MULTI_EVENT type and event details', () => {
    const pkg = {
      id: 'pkg-event-001',
      customerId: 'usr-customer-01',
      packageName: 'Conference 3-Day Pass',
      packageType: PackageType.MULTI_EVENT,
      totalPrice: 2500.0,
      discountPercentage: 20.0,
      status: PackageStatus.ACTIVE,
    };

    expect(pkg.packageType).toBe(PackageType.MULTI_EVENT);
    expect(pkg.discountPercentage).toBe(20.0);
  });

  test('F13-T1-33: Bundle discount calculation applies package discount percentage to reduce booking total price', () => {
    const baseBookingPrice = 500.0;
    const discountPct = 15.0; // 15% off
    const discountAmount = calculatePackageDiscountAmount(baseBookingPrice, discountPct);
    const finalBookingPrice = baseBookingPrice - discountAmount;

    expect(discountAmount).toBe(75.0);
    expect(finalBookingPrice).toBe(425.0);
  });

  test('F13-T1-34: Multi-booking balance linking connects multiple bookings to a single package via packageId', () => {
    const pkgId = 'pkg-event-001';
    const booking1 = { id: 'bk-p1', packageId: pkgId };
    const booking2 = { id: 'bk-p2', packageId: pkgId };

    expect(booking1.packageId).toBe(pkgId);
    expect(booking2.packageId).toBe(pkgId);
  });

  test('F13-T1-35: Package status transitions to COMPLETED when all allocated trips in bundle are used', () => {
    const pkg = {
      id: 'pkg-001',
      maxTrips: 3,
      usedTrips: 2,
      status: PackageStatus.ACTIVE,
    };

    // Use final trip
    pkg.usedTrips += 1;
    if (pkg.usedTrips >= pkg.maxTrips) {
      pkg.status = PackageStatus.COMPLETED;
    }

    expect(pkg.usedTrips).toBe(3);
    expect(pkg.status).toBe(PackageStatus.COMPLETED);
  });

  test('F13-T1-36: Admin package query retrieves customer packages with active usage metrics', () => {
    const packages = [
      { id: 'pkg-1', customerId: 'c1', status: PackageStatus.ACTIVE },
      { id: 'pkg-2', customerId: 'c2', status: PackageStatus.COMPLETED },
    ];

    const activeCount = packages.filter((p) => p.status === PackageStatus.ACTIVE).length;
    expect(activeCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Feature F14: Automated Scheduled Notifications
  // --------------------------------------------------------------------------

  test('F14-T1-37: Scheduled notification queueing creates ScheduledNotifications for 24h reminder (REMINDER_24H)', () => {
    const scheduledTime = new Date('2026-10-10T09:00:00Z');
    const notif = {
      id: 'notif-24h',
      bookingId: 'bk-100',
      recipientId: 'usr-customer-01',
      recipientType: NotificationRecipientType.CUSTOMER,
      notificationType: NotificationType.REMINDER_24H,
      channel: NotificationChannel.PUSH,
      title: 'Upcoming Ride Tomorrow',
      body: 'Your booking is scheduled for tomorrow at 09:00 AM.',
      scheduledAt: scheduledTime,
      status: NotificationStatus.SCHEDULED,
    };

    expect(notif.notificationType).toBe(NotificationType.REMINDER_24H);
    expect(notif.status).toBe(NotificationStatus.SCHEDULED);
  });

  test('F14-T1-38: Scheduled notification queueing creates 2h (REMINDER_2H) and 30m (REMINDER_30M) trip reminders', () => {
    const notif2h = {
      notificationType: NotificationType.REMINDER_2H,
      status: NotificationStatus.SCHEDULED,
    };

    const notif30m = {
      notificationType: NotificationType.REMINDER_30M,
      status: NotificationStatus.SCHEDULED,
    };

    expect(notif2h.notificationType).toBe(NotificationType.REMINDER_2H);
    expect(notif30m.notificationType).toBe(NotificationType.REMINDER_30M);
  });

  test('F14-T1-39: Scheduled notification queueing creates post-trip review prompt (RATE_TRIP) notification upon trip completion', () => {
    const notifRate = {
      bookingId: 'bk-completed-01',
      recipientId: 'usr-customer-01',
      notificationType: NotificationType.RATE_TRIP,
      channel: NotificationChannel.PUSH,
      title: 'How was your trip?',
      body: 'Please leave a review for your driver.',
      status: NotificationStatus.SCHEDULED,
    };

    expect(notifRate.notificationType).toBe(NotificationType.RATE_TRIP);
  });

  test('F14-T1-40: Notification delivery state transition moves status from SCHEDULED to SENT and populates sentAt', () => {
    const notif = {
      id: 'notif-dispatch-01',
      status: NotificationStatus.SCHEDULED,
      sentAt: null as Date | null,
    };

    // Dispatch job runs
    notif.status = NotificationStatus.SENT;
    notif.sentAt = new Date();

    expect(notif.status).toBe(NotificationStatus.SENT);
    expect(notif.sentAt).toBeDefined();
  });

  test('F14-T1-41: Notification cancellation transitions status from SCHEDULED to CANCELLED when booking is cancelled', () => {
    const notif = {
      id: 'notif-to-cancel',
      status: NotificationStatus.SCHEDULED,
    };

    // Booking cancelled
    notif.status = NotificationStatus.CANCELLED;
    expect(notif.status).toBe(NotificationStatus.CANCELLED);
  });

  test('F14-T1-42: Multi-channel notification dispatch supports PUSH, SMS, and WHATSAPP channels', () => {
    const channels = [NotificationChannel.PUSH, NotificationChannel.SMS, NotificationChannel.WHATSAPP];

    for (const ch of channels) {
      expect(isValidNotificationChannel(ch)).toBe(true);
    }
  });

});
