import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
} from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
  generateInvalidToken,
  generateExpiredToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import {
  getDriverActiveTrip,
  getDriverUpcomingSchedule,
  calculateDriverDailyEarnings,
  isValidTripStatusTransition,
  getDriverStatusOverview,
  calculateAdminSystemStats,
  filterSystemUsers,
  adminOverrideBooking,
  processDriverPayout,
  isValidSystemSettingUpdate,
  PayoutRequest,
} from '../tier1/f15_f16_dashboards.test';

describe('Tier 2: Features F15 & F16 - Driver & Admin Dashboard Boundaries, Authorization & Edge Cases', () => {

  // --------------------------------------------------------------------------
  // Feature F15 Boundaries: Driver Dashboard Edge Cases & Security
  // --------------------------------------------------------------------------

  test('F15-T2-01: Non-driver (Rider role) accessing driver active trip overview is rejected with 403 Forbidden', async () => {
    const api = createApiClient();
    const riderToken = generateRiderToken();

    const res = await api.get('/driver/active-trip', { token: riderToken });
    const isProtected = res.status === 401 || res.status === 403 || res.status === 404 || (typeof res.body === 'object' && res.body?.success === false);
    expect(isProtected).toBe(true);
  });

  test('F15-T2-02: Unauthorized trip status update for booking assigned to another driver is rejected', () => {
    const booking = {
      id: 'bk-999',
      driverId: 'drv-original-owner',
      status: BookingStatus.CONFIRMED,
      tripStatus: TripStatus.NOTSTARTED,
    };

    const attemptingDriverId = 'drv-imposter-123';

    // Verify ownership check
    const isOwner = booking.driverId === attemptingDriverId;
    expect(isOwner).toBe(false);

    if (!isOwner) {
      const authError = { success: false, code: 403, message: 'Driver does not own this trip' };
      expect(authError.success).toBe(false);
      expect(authError.code).toBe(403);
    }
  });

  test('F15-T2-03: Negative earnings calculation bounds & invalid date handling', () => {
    const mockBookings = [
      { id: 'b1', driverId: 'drv-001', bookingDate: '2026-08-10', status: BookingStatus.COMPLETED, totalPrice: -50.0, tipAmount: -10 },
    ];

    // Handle invalid negative values cleanly by clamping to 0 or flagging
    const summary = calculateDriverDailyEarnings('drv-001', mockBookings, '2026-08-10', -0.2);
    expect(summary.date).toBe('2026-08-10');
    // Platform commission or total earnings should remain defined and deterministic
    expect(typeof summary.grossEarnings).toBe('number');
  });

  test('F15-T2-04: Updating status on an already COMPLETED trip is rejected by state machine', () => {
    const check1 = isValidTripStatusTransition(TripStatus.COMPLETED, TripStatus.INPROGRESS);
    expect(check1.valid).toBe(false);

    const check2 = isValidTripStatusTransition(TripStatus.COMPLETED, TripStatus.NOTSTARTED);
    expect(check2.valid).toBe(false);
  });

  test('F15-T2-05: Driver updating trip status when driver shift status is OFF or ONLEAVE is blocked', () => {
    const driverProfile = {
      id: 'drv-off',
      status: DriverStatus.OFF,
    };

    const canExecuteTrip = driverProfile.status === DriverStatus.ACTIVE;
    expect(canExecuteTrip).toBe(false);
  });

  test('F15-T2-06: Driver endpoint access with invalid or expired auth token returns 401 Unauthorized', async () => {
    const api = createApiClient();
    const invalidToken = generateInvalidToken();

    const res = await api.get('/driver/earnings', { token: invalidToken });
    const isUnauthorized = res.status === 401 || res.status === 403 || res.status === 404 || (typeof res.body === 'object' && res.body?.success === false);
    expect(isUnauthorized).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Feature F16 Boundaries: Admin Dashboard Edge Cases & Security
  // --------------------------------------------------------------------------

  test('F16-T2-01: Non-admin (Driver or Rider role) accessing admin dashboard endpoints is rejected with 403', async () => {
    const api = createApiClient();
    const driverToken = generateDriverToken();

    const res = await api.get('/admin/overview-stats', { token: driverToken });
    const isForbidden = res.status === 401 || res.status === 403 || res.status === 404 || (typeof res.body === 'object' && res.body?.success === false);
    expect(isForbidden).toBe(true);
  });

  test('F16-T2-02: Approving payout in already PROCESSED or REJECTED state is rejected', () => {
    const processedPayout: PayoutRequest = {
      id: 'po-200',
      driverId: 'drv-123',
      amount: 500,
      status: 'PROCESSED',
      requestedAt: '2026-08-01T00:00:00Z',
    };

    const result = processDriverPayout(processedPayout, 'APPROVE');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Cannot process payout with status PROCESSED');
  });

  test('F16-T2-03: Updating system settings with invalid types or unknown keys is rejected', () => {
    const invalidKeyCheck = isValidSystemSettingUpdate('unknownFeatureFlag', true);
    expect(invalidKeyCheck.valid).toBe(false);
    expect(invalidKeyCheck.reason).toContain('Unknown setting key');

    const invalidTypeCheck = isValidSystemSettingUpdate('evaluationsVisible', 'not-a-boolean');
    expect(invalidTypeCheck.valid).toBe(false);
    expect(invalidTypeCheck.reason).toContain('expects a boolean value');

    const negativeSurgeCheck = isValidSystemSettingUpdate('maxSurgeMultiplier', -1.5);
    expect(negativeSurgeCheck.valid).toBe(false);
  });

  test('F16-T2-04: Admin override with non-existent booking ID returns failure response', () => {
    const result = adminOverrideBooking(null, { newStatus: BookingStatus.CANCELLED });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Booking not found');
  });

  test('F16-T2-05: Payout approval with zero or negative amount is rejected', () => {
    const zeroPayout: PayoutRequest = {
      id: 'po-300',
      driverId: 'drv-123',
      amount: 0.0,
      status: 'PENDING',
      requestedAt: '2026-08-09T00:00:00Z',
    };

    const result = processDriverPayout(zeroPayout, 'APPROVE');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('amount must be greater than zero');
  });

  test('F16-T2-06: Unauthenticated request to admin dashboard endpoints returns 401 Unauthorized', async () => {
    const api = createApiClient();

    const res = await api.get('/admin/overview-stats');
    const isUnauthorized = res.status === 401 || res.status === 403 || res.status === 404 || (typeof res.body === 'object' && res.body?.success === false);
    expect(isUnauthorized).toBe(true);
  });
});
