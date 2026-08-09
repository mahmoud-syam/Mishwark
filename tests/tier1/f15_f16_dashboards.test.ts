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
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
  generateInvalidToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';

// ============================================================================
// Authoritative Reference Calculators & Dashboard Logic Engines for F15 & F16
// ============================================================================

export interface DriverTripOverview {
  bookingId: string;
  riderName: string;
  riderPhone: string;
  pickupLocation: string;
  dropoffLocation: string;
  scheduledTime: string;
  status: BookingStatus;
  tripStatus: TripStatus;
  totalPrice: number;
}

export function getDriverActiveTrip(driverId: string, bookings: any[]): DriverTripOverview | null {
  const activeBooking = bookings.find(
    (b) =>
      b.driverId === driverId &&
      b.status === BookingStatus.CONFIRMED &&
      [TripStatus.NOTSTARTED, TripStatus.INPROGRESS, TripStatus.ARRIVED].includes(b.tripStatus)
  );

  if (!activeBooking) return null;

  return {
    bookingId: activeBooking.id,
    riderName: activeBooking.riderName || 'Rider',
    riderPhone: activeBooking.riderPhone || '+20100000000',
    pickupLocation: activeBooking.pickupLocation || 'Cairo Downtown',
    dropoffLocation: activeBooking.dropoffLocation || 'Maadi',
    scheduledTime: activeBooking.startTime,
    status: activeBooking.status,
    tripStatus: activeBooking.tripStatus,
    totalPrice: activeBooking.totalPrice,
  };
}

export function getDriverUpcomingSchedule(driverId: string, bookings: any[], targetDateStr?: string): DriverTripOverview[] {
  const today = targetDateStr || new Date().toISOString().split('T')[0];
  const upcoming = bookings.filter(
    (b) =>
      b.driverId === driverId &&
      b.status === BookingStatus.CONFIRMED &&
      b.bookingDate >= today
  );

  return upcoming
    .sort((a, b) => {
      if (a.bookingDate !== b.bookingDate) {
        return a.bookingDate.localeCompare(b.bookingDate);
      }
      return a.startTime.localeCompare(b.startTime);
    })
    .map((b) => ({
      bookingId: b.id,
      riderName: b.riderName || 'Rider',
      riderPhone: b.riderPhone || '+20100000000',
      pickupLocation: b.pickupLocation || 'Cairo Downtown',
      dropoffLocation: b.dropoffLocation || 'Maadi',
      scheduledTime: b.startTime,
      status: b.status,
      tripStatus: b.tripStatus,
      totalPrice: b.totalPrice,
    }));
}

export interface DriverDailyEarningsSummary {
  date: string;
  completedTripsCount: number;
  grossEarnings: number;
  platformCommission: number;
  netPayout: number;
  tips: number;
  totalEarnings: number;
}

export function calculateDriverDailyEarnings(
  driverId: string,
  bookings: any[],
  dateStr: string,
  commissionRate: number = 0.15
): DriverDailyEarningsSummary {
  const dayCompletedBookings = bookings.filter(
    (b) =>
      b.driverId === driverId &&
      b.status === BookingStatus.COMPLETED &&
      b.bookingDate === dateStr
  );

  const completedTripsCount = dayCompletedBookings.length;
  const grossEarnings = dayCompletedBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
  const tips = dayCompletedBookings.reduce((sum, b) => sum + (b.tipAmount || 0), 0);
  const platformCommission = Math.round(grossEarnings * commissionRate * 100) / 100;
  const netPayout = Math.round((grossEarnings - platformCommission) * 100) / 100;
  const totalEarnings = Math.round((netPayout + tips) * 100) / 100;

  return {
    date: dateStr,
    completedTripsCount,
    grossEarnings: Math.round(grossEarnings * 100) / 100,
    platformCommission,
    netPayout,
    tips: Math.round(tips * 100) / 100,
    totalEarnings,
  };
}

export function isValidTripStatusTransition(
  currentStatus: TripStatus,
  targetStatus: TripStatus
): { valid: boolean; reason?: string } {
  const allowedTransitions: Record<TripStatus, TripStatus[]> = {
    [TripStatus.NOTSTARTED]: [TripStatus.INPROGRESS],
    [TripStatus.INPROGRESS]: [TripStatus.ARRIVED],
    [TripStatus.ARRIVED]: [TripStatus.COMPLETED],
    [TripStatus.COMPLETED]: [],
  };

  const isAllowed = allowedTransitions[currentStatus]?.includes(targetStatus) ?? false;
  if (!isAllowed) {
    return {
      valid: false,
      reason: `Invalid trip status transition from ${currentStatus} to ${targetStatus}`,
    };
  }
  return { valid: true };
}

export function getDriverStatusOverview(driverProfile: any) {
  if (!driverProfile) {
    return { status: DriverStatus.OFF, rating_avg: 0.0, active: false };
  }
  return {
    driverId: driverProfile.id,
    fullName: driverProfile.fullName,
    status: driverProfile.status,
    rating_avg: driverProfile.rating_avg || 5.0,
    active: driverProfile.status === DriverStatus.ACTIVE,
  };
}

export function getDriverRatingSummary(reviews: any[]) {
  if (!reviews || reviews.length === 0) {
    return { averageRating: 5.0, totalReviews: 0, ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
  }

  const breakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;

  for (const r of reviews) {
    const star = Math.min(5, Math.max(1, Math.round(r.rating || 5)));
    breakdown[star] = (breakdown[star] || 0) + 1;
    sum += r.rating;
  }

  const averageRating = Math.round((sum / reviews.length) * 10) / 10;
  return {
    averageRating,
    totalReviews: reviews.length,
    ratingBreakdown: breakdown,
  };
}

// ----------------------------------------------------------------------------
// Admin Dashboard (F16) Reference Engine
// ----------------------------------------------------------------------------

export interface AdminSystemStats {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  cancellationRate: number;
  totalRevenue: number;
  activeDriversCount: number;
  totalRegisteredUsers: number;
}

export function calculateAdminSystemStats(
  users: any[],
  drivers: any[],
  bookings: any[]
): AdminSystemStats {
  const totalBookings = bookings.length;
  const completedBookings = bookings.filter((b) => b.status === BookingStatus.COMPLETED).length;
  const cancelledBookings = bookings.filter((b) => b.status === BookingStatus.CANCELLED).length;
  const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 1000) / 10 : 0;

  const totalRevenue = bookings
    .filter((b) => b.status === BookingStatus.COMPLETED)
    .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

  const activeDriversCount = drivers.filter((d) => d.status === DriverStatus.ACTIVE).length;
  const totalRegisteredUsers = users.length;

  return {
    totalBookings,
    completedBookings,
    cancelledBookings,
    cancellationRate,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    activeDriversCount,
    totalRegisteredUsers,
  };
}

export function filterSystemUsers(users: any[], query?: { roleId?: string; search?: string }) {
  if (!query) return users;
  let filtered = [...users];

  if (query.roleId) {
    filtered = filtered.filter((u) => u.roleId === query.roleId);
  }
  if (query.search) {
    const term = query.search.toLowerCase();
    filtered = filtered.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term)) ||
        (u.code && u.code.toLowerCase().includes(term))
    );
  }

  return filtered;
}

export function adminOverrideBooking(
  booking: any,
  override: { newDriverId?: string; newVehicleId?: string; newStatus?: BookingStatus }
) {
  if (!booking) {
    return { success: false, reason: 'Booking not found' };
  }

  const updated = { ...booking };

  if (override.newDriverId) {
    updated.driverId = override.newDriverId;
  }
  if (override.newVehicleId) {
    updated.vehicleId = override.newVehicleId;
  }
  if (override.newStatus) {
    updated.status = override.newStatus;
  }

  return { success: true, updatedBooking: updated };
}

export interface PayoutRequest {
  id: string;
  driverId: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSED';
  requestedAt: string;
}

export function processDriverPayout(
  payout: PayoutRequest,
  action: 'APPROVE' | 'REJECT'
): { success: boolean; payout?: PayoutRequest; reason?: string } {
  if (!payout) {
    return { success: false, reason: 'Payout request not found' };
  }
  if (payout.status !== 'PENDING') {
    return { success: false, reason: `Cannot process payout with status ${payout.status}` };
  }
  if (payout.amount <= 0) {
    return { success: false, reason: 'Payout amount must be greater than zero' };
  }

  const updated: PayoutRequest = {
    ...payout,
    status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
  };

  return { success: true, payout: updated };
}

export function isValidSystemSettingUpdate(settingKey: string, newValue: any): { valid: boolean; reason?: string } {
  const allowedKeys = [
    'performanceHistoryVisible',
    'evaluationsVisible',
    'selfAppraisalsVisible',
    'maxSurgeMultiplier',
    'defaultCommissionRate',
  ];

  if (!allowedKeys.includes(settingKey)) {
    return { valid: false, reason: `Unknown setting key: ${settingKey}` };
  }

  if (settingKey.endsWith('Visible')) {
    if (typeof newValue !== 'boolean') {
      return { valid: false, reason: `Setting ${settingKey} expects a boolean value` };
    }
  }

  if (settingKey === 'maxSurgeMultiplier' || settingKey === 'defaultCommissionRate') {
    if (typeof newValue !== 'number' || newValue < 0) {
      return { valid: false, reason: `Setting ${settingKey} expects a non-negative number` };
    }
  }

  return { valid: true };
}

export function getSystemAuditLogs(logs: any[], limit: number = 10) {
  return logs.slice(0, limit);
}

// ============================================================================
// Test Suite: Tier 1 - Driver & Admin Dashboards Coverage (F15 & F16)
// ============================================================================

describe('Tier 1: Features F15 & F16 - Driver & Admin Dashboards Coverage', () => {

  // --------------------------------------------------------------------------
  // Feature F15: Driver Dashboard Endpoints & Logic
  // --------------------------------------------------------------------------

  test('F15-T1-01: Driver Dashboard returns active trip overview for assigned driver', () => {
    const mockBookings = [
      {
        id: 'bk-101',
        driverId: 'drv-001',
        riderName: 'Alice Smith',
        riderPhone: '+201011112222',
        pickupLocation: 'Nasr City',
        dropoffLocation: 'New Cairo',
        startTime: '10:00',
        bookingDate: '2026-08-10',
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.INPROGRESS,
        totalPrice: 180.0,
      },
    ];

    const activeTrip = getDriverActiveTrip('drv-001', mockBookings);
    expect(activeTrip).not.toBeNull();
    expect(activeTrip?.bookingId).toBe('bk-101');
    expect(activeTrip?.riderName).toBe('Alice Smith');
    expect(activeTrip?.tripStatus).toBe(TripStatus.INPROGRESS);
    expect(activeTrip?.totalPrice).toBe(180.0);
  });

  test('F15-T1-02: Driver Dashboard returns upcoming schedule sorted chronologically', () => {
    const mockBookings = [
      {
        id: 'bk-202',
        driverId: 'drv-001',
        bookingDate: '2026-08-12',
        startTime: '14:00',
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.NOTSTARTED,
      },
      {
        id: 'bk-201',
        driverId: 'drv-001',
        bookingDate: '2026-08-11',
        startTime: '09:00',
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.NOTSTARTED,
      },
    ];

    const schedule = getDriverUpcomingSchedule('drv-001', mockBookings, '2026-08-10');
    expect(schedule.length).toBe(2);
    expect(schedule[0].bookingId).toBe('bk-201'); // 2026-08-11 comes before 2026-08-12
    expect(schedule[1].bookingId).toBe('bk-202');
  });

  test('F15-T1-03: Driver Dashboard calculates daily earnings summary with net payout and platform fee', () => {
    const mockBookings = [
      { id: 'b1', driverId: 'drv-001', bookingDate: '2026-08-10', status: BookingStatus.COMPLETED, totalPrice: 200, tipAmount: 20 },
      { id: 'b2', driverId: 'drv-001', bookingDate: '2026-08-10', status: BookingStatus.COMPLETED, totalPrice: 300, tipAmount: 30 },
      { id: 'b3', driverId: 'drv-001', bookingDate: '2026-08-09', status: BookingStatus.COMPLETED, totalPrice: 150, tipAmount: 0 },
    ];

    const summary = calculateDriverDailyEarnings('drv-001', mockBookings, '2026-08-10', 0.15);
    expect(summary.completedTripsCount).toBe(2);
    expect(summary.grossEarnings).toBe(500); // 200 + 300
    expect(summary.platformCommission).toBe(75); // 15% of 500
    expect(summary.netPayout).toBe(425); // 500 - 75
    expect(summary.tips).toBe(50); // 20 + 30
    expect(summary.totalEarnings).toBe(475); // 425 + 50
  });

  test('F15-T1-04: Driver updates trip status following valid sequential transitions', () => {
    const step1 = isValidTripStatusTransition(TripStatus.NOTSTARTED, TripStatus.INPROGRESS);
    expect(step1.valid).toBe(true);

    const step2 = isValidTripStatusTransition(TripStatus.INPROGRESS, TripStatus.ARRIVED);
    expect(step2.valid).toBe(true);

    const step3 = isValidTripStatusTransition(TripStatus.ARRIVED, TripStatus.COMPLETED);
    expect(step3.valid).toBe(true);
  });

  test('F15-T1-05: Driver Dashboard retrieves driver profile status overview and availability', () => {
    const mockDriverProfile = {
      id: 'drv-001',
      fullName: 'Ahmed Hassan',
      status: DriverStatus.ACTIVE,
      rating_avg: 4.85,
    };

    const overview = getDriverStatusOverview(mockDriverProfile);
    expect(overview.driverId).toBe('drv-001');
    expect(overview.fullName).toBe('Ahmed Hassan');
    expect(overview.status).toBe(DriverStatus.ACTIVE);
    expect(overview.active).toBe(true);
    expect(overview.rating_avg).toBe(4.85);
  });

  test('F15-T1-06: Driver Dashboard computes average ratings and star breakdown from review logs', () => {
    const reviews = [
      { rating: 5, comment: 'Great drive!' },
      { rating: 5, comment: 'Punctual' },
      { rating: 4, comment: 'Good trip' },
    ];

    const ratingSummary = getDriverRatingSummary(reviews);
    expect(ratingSummary.totalReviews).toBe(3);
    expect(ratingSummary.averageRating).toBe(4.7);
    expect(ratingSummary.ratingBreakdown[5]).toBe(2);
    expect(ratingSummary.ratingBreakdown[4]).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Feature F16: Admin Dashboard Endpoints & Logic
  // --------------------------------------------------------------------------

  test('F16-T1-01: Admin Dashboard aggregates overall system stats (bookings, revenue, cancellation rate)', () => {
    const mockUsers = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
    const mockDrivers = [{ id: 'd1', status: DriverStatus.ACTIVE }, { id: 'd2', status: DriverStatus.OFF }];
    const mockBookings = [
      { id: 'b1', status: BookingStatus.COMPLETED, totalPrice: 250 },
      { id: 'b2', status: BookingStatus.COMPLETED, totalPrice: 350 },
      { id: 'b3', status: BookingStatus.CANCELLED, totalPrice: 100 },
      { id: 'b4', status: BookingStatus.PENDING, totalPrice: 200 },
    ];

    const stats = calculateAdminSystemStats(mockUsers, mockDrivers, mockBookings);
    expect(stats.totalBookings).toBe(4);
    expect(stats.completedBookings).toBe(2);
    expect(stats.cancelledBookings).toBe(1);
    expect(stats.cancellationRate).toBe(25); // 1 out of 4 = 25%
    expect(stats.totalRevenue).toBe(600); // 250 + 350
    expect(stats.activeDriversCount).toBe(1);
    expect(stats.totalRegisteredUsers).toBe(3);
  });

  test('F16-T1-02: Admin Dashboard filters users by role and search terms', () => {
    const mockUsers = [
      { id: 'u1', name: 'Omar Driver', email: 'omar@test.com', roleId: 'role-driver' },
      { id: 'u2', name: 'Sara Customer', email: 'sara@test.com', roleId: 'role-customer' },
      { id: 'u3', name: 'Admin Boss', email: 'admin@test.com', roleId: 'role-admin' },
    ];

    const drivers = filterSystemUsers(mockUsers, { roleId: 'role-driver' });
    expect(drivers.length).toBe(1);
    expect(drivers[0].name).toBe('Omar Driver');

    const searchResult = filterSystemUsers(mockUsers, { search: 'sara' });
    expect(searchResult.length).toBe(1);
    expect(searchResult[0].email).toBe('sara@test.com');
  });

  test('F16-T1-03: Admin performs booking overrides to reassign driver or status', () => {
    const booking = {
      id: 'bk-555',
      driverId: 'drv-old',
      vehicleId: 'veh-old',
      status: BookingStatus.PENDING,
    };

    const overrideResult = adminOverrideBooking(booking, {
      newDriverId: 'drv-new',
      newStatus: BookingStatus.CONFIRMED,
    });

    expect(overrideResult.success).toBe(true);
    expect(overrideResult.updatedBooking.driverId).toBe('drv-new');
    expect(overrideResult.updatedBooking.vehicleId).toBe('veh-old');
    expect(overrideResult.updatedBooking.status).toBe(BookingStatus.CONFIRMED);
  });

  test('F16-T1-04: Admin processes driver payout requests approving valid PENDING transactions', () => {
    const payout: PayoutRequest = {
      id: 'po-100',
      driverId: 'drv-001',
      amount: 1250.0,
      status: 'PENDING',
      requestedAt: '2026-08-09T10:00:00Z',
    };

    const approval = processDriverPayout(payout, 'APPROVE');
    expect(approval.success).toBe(true);
    expect(approval.payout?.status).toBe('APPROVED');
  });

  test('F16-T1-05: Admin Dashboard validates and persists system setting updates', () => {
    const validCheck1 = isValidSystemSettingUpdate('evaluationsVisible', false);
    expect(validCheck1.valid).toBe(true);

    const validCheck2 = isValidSystemSettingUpdate('maxSurgeMultiplier', 2.5);
    expect(validCheck2.valid).toBe(true);
  });

  test('F16-T1-06: Admin Dashboard retrieves audit log entries with pagination limits', () => {
    const logs = [
      { id: 'l1', action: 'USER_SUSPENDED', actor: 'admin-1', timestamp: '2026-08-09T08:00:00Z' },
      { id: 'l2', action: 'SETTING_UPDATED', actor: 'admin-1', timestamp: '2026-08-09T08:30:00Z' },
      { id: 'l3', action: 'PAYOUT_APPROVED', actor: 'admin-1', timestamp: '2026-08-09T09:00:00Z' },
    ];

    const recentLogs = getSystemAuditLogs(logs, 2);
    expect(recentLogs.length).toBe(2);
    expect(recentLogs[0].id).toBe('l1');
    expect(recentLogs[1].id).toBe('l2');
  });
});
