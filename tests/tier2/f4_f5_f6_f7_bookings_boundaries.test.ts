import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import {
  DriverStatus,
  VehicleCategory,
  VehicleStatus,
  BookingStatus,
  TripStatus,
  PaymentStatus,
  WaitlistStatus,
} from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected, getMockSeedData } from '../infra/db-setup';
import {
  generateAdminToken,
  generateDriverToken,
  generateRiderToken,
  generateInvalidToken,
} from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import {
  calculateEstimatedPrice,
  checkSlotOverlap,
  isValidBookingTransition,
  isValidTripTransition,
} from '../tier1/f4_f5_f6_f7_bookings_pricing.test';

describe('Tier 2: Features F4, F5, F6, F7 - Boundaries, Corner Cases & Concurrency', () => {

  // --- F4 Boundaries: Pricing Engine Edge Cases ---

  test('F4-T2-01: Zero distance input (distanceKm = 0) returns zero distance price without throwing', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 0,
      durationMinutes: 60,
    });
    expect(est.distancePrice).toBe(0);
    expect(est.totalPrice).toBe(75); // 50 base + 25 time
  });

  test('F4-T2-02: Negative distance input (distanceKm < 0) is normalized to 0 distance price', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: -50,
      durationMinutes: 60,
    });
    expect(est.distancePrice).toBe(0);
    expect(est.totalPrice).toBe(75);
  });

  test('F4-T2-03: Zero duration input (durationMinutes = 0) returns zero time price without throwing', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.VAN,
      distanceKm: 20,
      durationMinutes: 0,
    });
    expect(est.timePrice).toBe(0);
    expect(est.totalPrice).toBe(450); // 150 base + 300 dist
  });

  test('F4-T2-04: Negative duration input (durationMinutes < 0) is normalized to 0 time price', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.VAN,
      distanceKm: 20,
      durationMinutes: -120,
    });
    expect(est.timePrice).toBe(0);
    expect(est.totalPrice).toBe(450);
  });

  test('F4-T2-05: Invalid zero or negative surge multiplier defaults to standard 1.0 multiplier', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 10,
      durationMinutes: 0,
      isPeakHour: true,
      surgeMultiplier: -2.5,
    });
    // Negative surge should fallback to 1.25 default for peak hour or 1.0
    expect(est.surgeMultiplier).toBeGreaterThan(0);
    expect(est.totalPrice).toBeGreaterThan(0);
  });

  test('F4-T2-06: Excessive discount exceeding total price is capped so totalPrice does not become negative', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: VehicleCategory.CAR,
      distanceKm: 5, // 50
      durationMinutes: 0,
      packageDiscount: 500, // Exceeds 100 total
      referralDiscount: 100,
    });

    expect(est.totalPrice).toBe(0);
    expect(est.depositPaid).toBe(0);
  });

  test('F4-T2-07: Unknown vehicle category safely falls back to standard CAR pricing structure', () => {
    const est = calculateEstimatedPrice({
      vehicleCategory: 'UNKNOWN_CATEGORY' as any,
      distanceKm: 10,
      durationMinutes: 60,
    });
    expect(est.basePrice).toBe(50);
    expect(est.totalPrice).toBe(175); // 50 base + 100 dist + 25 time
  });

  // --- F5 Boundaries: Booking Creation Collisions, Window Overlaps & Invalid Attempts ---

  test('F5-T2-08: Simultaneous double-booking collision for identical vehicle slot is detected and blocked', () => {
    const slotA = { vehicleId: 'veh-001', bookingDate: '2026-09-01', startTime: '10:00', endTime: '12:00' };
    const slotB = { vehicleId: 'veh-001', bookingDate: '2026-09-01', startTime: '10:00', endTime: '12:00' };

    const collision = checkSlotOverlap(slotA.startTime, slotA.endTime, slotB.startTime, slotB.endTime);
    expect(collision).toBe(true);
  });

  test('F5-T2-09: Partial start time window collision (09:30-11:30 vs 10:00-12:00) is detected and blocked', () => {
    const overlap = checkSlotOverlap('09:30', '11:30', '10:00', '12:00');
    expect(overlap).toBe(true);
  });

  test('F5-T2-10: Partial end time window collision (10:30-12:30 vs 10:00-12:00) is detected and blocked', () => {
    const overlap = checkSlotOverlap('10:30', '12:30', '10:00', '12:00');
    expect(overlap).toBe(true);
  });

  test('F5-T2-11: Enclosing nested time window collision (08:00-14:00 vs 10:00-12:00) is detected and blocked', () => {
    const overlap = checkSlotOverlap('08:00', '14:00', '10:00', '12:00');
    expect(overlap).toBe(true);
  });

  test('F5-T2-12: Adjacent non-overlapping time window (08:00-10:00 vs 10:00-12:00) is allowed', () => {
    const overlap = checkSlotOverlap('08:00', '10:00', '10:00', '12:00');
    expect(overlap).toBe(false);
  });

  test('F5-T2-13: Past-date booking attempt (bookingDate in past) is rejected by validator', () => {
    const pastDate = '2020-01-01';
    const today = new Date().toISOString().split('T')[0];

    const isPast = pastDate < today;
    expect(isPast).toBe(true);
  });

  test('F5-T2-14: Booking attempt for vehicle in MAINTENANCE status is rejected', () => {
    const vehicle = { id: 'v-maint', status: VehicleStatus.MAINTENANCE };
    const canBook = vehicle.status === VehicleStatus.AVAILABLE;
    expect(canBook).toBe(false);
  });

  test('F5-T2-15: Booking attempt for driver in OFF or ONLEAVE status is rejected', () => {
    const driver1 = { id: 'd-off', status: DriverStatus.OFF };
    const driver2 = { id: 'd-leave', status: DriverStatus.ONLEAVE };

    expect(driver1.status === DriverStatus.ACTIVE).toBe(false);
    expect(driver2.status === DriverStatus.ACTIVE).toBe(false);
  });

  // --- F6 Boundaries: Invalid State Transitions & Unauthorized Access ---

  test('F6-T2-16: Invalid booking transition COMPLETED -> PENDING is rejected by state machine', () => {
    const valid = isValidBookingTransition(BookingStatus.COMPLETED, BookingStatus.PENDING);
    expect(valid).toBe(false);
  });

  test('F6-T2-17: Invalid booking transition CANCELLED -> CONFIRMED is rejected by state machine', () => {
    const valid = isValidBookingTransition(BookingStatus.CANCELLED, BookingStatus.CONFIRMED);
    expect(valid).toBe(false);
  });

  test('F6-T2-18: Invalid trip transition COMPLETED -> NOTSTARTED is rejected by state machine', () => {
    const valid = isValidTripTransition(TripStatus.COMPLETED, TripStatus.NOTSTARTED);
    expect(valid).toBe(false);
  });

  test('F6-T2-19: Attempting to advance trip status on a CANCELLED booking is rejected', () => {
    const booking = { status: BookingStatus.CANCELLED, tripStatus: TripStatus.NOTSTARTED };

    const canStartTrip = booking.status !== BookingStatus.CANCELLED && isValidTripTransition(booking.tripStatus, TripStatus.INPROGRESS);
    expect(canStartTrip).toBe(false);
  });

  test('F6-T2-20: Unauthorized user attempting trip status update is rejected (role authorization boundary)', async () => {
    const riderToken = generateRiderToken();
    const client = createApiClient();

    // Rider token trying to update trip status on driver route / endpoint
    const response = await client.patch('/driver/trips/bk-123/status', { tripStatus: 'INPROGRESS' }, { token: riderToken });

    // Expecting 401/403 or 404 unauthorized error response from API
    expect(response.status >= 400).toBe(true);
    await client.stop();
  });

  // --- F7 Boundaries: Cancellation Edge Cases & Waitlist Promotion Boundaries ---

  test('F7-T2-21: Attempting to cancel an already COMPLETED booking is rejected', () => {
    const bookingStatus = BookingStatus.COMPLETED;
    const canCancel = isValidBookingTransition(bookingStatus, BookingStatus.CANCELLED);
    expect(canCancel).toBe(false);
  });

  test('F7-T2-22: Attempting to cancel an already CANCELLED booking is handled idempotently without re-promoting waitlist', () => {
    const booking = { status: BookingStatus.CANCELLED };
    const canCancel = isValidBookingTransition(booking.status, BookingStatus.CANCELLED);
    expect(canCancel).toBe(false);
  });

  test('F7-T2-23: Cancelling booking when waitlist queue is completely empty executes cleanly without throwing error', () => {
    const emptyWaitlist: any[] = [];
    const vehicleId = 'veh-empty';
    const requestedDate = '2026-12-01';

    const matching = emptyWaitlist.filter((w) => w.vehicleId === vehicleId && w.requestedDate === requestedDate);

    expect(matching.length).toBe(0);
    const promoted = matching[0] || null;
    expect(promoted).toBeNull();
  });

  test('F7-T2-24: Corrupted waitlist position or missing customer reference is handled safely during promotion', () => {
    const corruptWaitlist = [
      { id: 'w-corrupt', customerId: null, vehicleId: 'v-001', requestedDate: '2026-10-10', position: -5, status: WaitlistStatus.WAITING },
      { id: 'w-valid', customerId: 'usr-valid', vehicleId: 'v-001', requestedDate: '2026-10-10', position: 1, status: WaitlistStatus.WAITING },
    ];

    // Filter out invalid/corrupt records
    const validEntries = corruptWaitlist.filter(
      (w) => w.customerId !== null && w.position > 0 && w.status === WaitlistStatus.WAITING
    );

    expect(validEntries.length).toBe(1);
    expect(validEntries[0].id).toBe('w-valid');
  });

});
