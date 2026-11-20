import { describe, test, expect } from '../infra/run-all';
import MapsService, { toCoordinates } from '../../src/v1/services/maps.service';
import { compareDistance, describePoint } from '../../src/v1/services/booking.service';
import {
  calculatePriceSchema,
  createBookingSchema,
  estimateDistanceSchema,
} from '../../src/v1/schemas/booking.schema';

// These tests must never touch the network. The haversine fallback path is the
// one under test here; the OpenRouteService path is covered by its own
// integration check against a live key.
delete process.env.ORS_API_KEY;

const CAIRO = { latitude: 30.0444, longitude: 31.2357 };
const ALEXANDRIA = { latitude: 31.2001, longitude: 29.9187 };
const MAADI = { latitude: 30.0459, longitude: 31.2516 };

describe('Route metrics: server-computed distanceKm and durationMinutes', () => {

  // --- Coordinate normalisation ---

  test('RM-T2-01: toCoordinates accepts { latitude, longitude }', () => {
    expect(toCoordinates({ latitude: 30.0444, longitude: 31.2357 })).toEqual(CAIRO);
  });

  test('RM-T2-02: toCoordinates accepts { lat, lng }', () => {
    expect(toCoordinates({ lat: 30.0444, lng: 31.2357 })).toEqual(CAIRO);
  });

  test('RM-T2-03: toCoordinates accepts { startLat, startLng }', () => {
    expect(toCoordinates({ startLat: 30.0444, startLng: 31.2357 })).toEqual(CAIRO);
  });

  test('RM-T2-04: toCoordinates parses a "lat, lng" string', () => {
    expect(toCoordinates('30.0444, 31.2357')).toEqual(CAIRO);
  });

  test('RM-T2-05: toCoordinates returns null for a free-text place name so it can be geocoded', () => {
    expect(toCoordinates('Maadi, Cairo')).toBeNull();
  });

  test('RM-T2-06: toCoordinates returns null for empty, null and non-numeric input', () => {
    expect(toCoordinates(null)).toBeNull();
    expect(toCoordinates(undefined)).toBeNull();
    expect(toCoordinates('   ')).toBeNull();
    expect(toCoordinates({ latitude: NaN, longitude: 31.2 })).toBeNull();
  });

  // --- Haversine fallback (no API key) ---

  test('RM-T2-07: route falls back to haversine when ORS_API_KEY is absent, and says so', async () => {
    const route = await MapsService.route(CAIRO, ALEXANDRIA);
    expect(route.source).toBe('haversine');
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.durationMinutes).toBeGreaterThan(0);
    // A silent fallback would be indistinguishable from a verified price.
    expect(typeof route.warning).toBe('string');
  });

  test('RM-T2-08: Cairo to Alexandria is a plausible road distance, not a straight line', async () => {
    const route = await MapsService.route(CAIRO, ALEXANDRIA);
    // Straight line is ~180 km; road distance must exceed it and stay sane.
    expect(route.distanceKm).toBeGreaterThan(150);
    expect(route.distanceKm).toBeLessThan(320);
  });

  test('RM-T2-09: near-identical points short-circuit to zero without a provider call', async () => {
    const route = await MapsService.route(CAIRO, { latitude: 30.04441, longitude: 31.23571 });
    expect(route.distanceKm).toBe(0);
    expect(route.durationMinutes).toBe(0);
  });

  test('RM-T2-10: route rejects a missing endpoint rather than defaulting to 0 km', async () => {
    await expect(() => MapsService.route(CAIRO, undefined)).toReject('endPoint is required');
  });

  test('RM-T2-11: route rejects out-of-range coordinates', async () => {
    await expect(() => MapsService.route(CAIRO, { latitude: 200, longitude: 31.2 })).toReject('latitude must be between');
  });

  test('RM-T2-12: duration is derived from distance, so it scales with route length', async () => {
    const short = await MapsService.route(CAIRO, MAADI);
    const long = await MapsService.route(CAIRO, ALEXANDRIA);
    expect(long.durationMinutes).toBeGreaterThan(short.durationMinutes);
  });

  // --- describePoint ---

  test('RM-T2-13: describePoint keeps free text and renders coordinates', () => {
    expect(describePoint('Maadi, Cairo')).toBe('Maadi, Cairo');
    expect(describePoint(CAIRO)).toBe('30.044400, 31.235700');
    expect(describePoint(undefined)).toBe('');
  });

  // --- The client-supplied number can no longer set the price ---

  test('RM-T2-14: estimate-price rejects customPricePerKm', () => {
    const parsed = calculatePriceSchema.safeParse({
      startPoint: CAIRO,
      endPoint: ALEXANDRIA,
      customPricePerKm: 0.01,
    } as any);
    expect(parsed.success).toBe(false);
  });

  test('RM-T2-15: estimate-price rejects customBasePrice and customPricePerHour too', () => {
    expect(calculatePriceSchema.safeParse({ startPoint: CAIRO, customBasePrice: 0 } as any).success).toBe(false);
    expect(calculatePriceSchema.safeParse({ startPoint: CAIRO, customPricePerHour: 0 } as any).success).toBe(false);
  });

  test('RM-T2-16: estimate-price needs the car (the per-km price by car type is gone)', () => {
    expect(calculatePriceSchema.safeParse({ startPoint: CAIRO, endPoint: ALEXANDRIA }).success).toBe(false);
    expect(calculatePriceSchema.safeParse({ vehicleId: 'v1', startPoint: CAIRO, endPoint: ALEXANDRIA }).success).toBe(true);
  });

  test('RM-T2-18: estimate-price requires an endpoint before it will price anything', () => {
    expect(calculatePriceSchema.safeParse({}).success).toBe(false);
  });

  // --- Booking creation cannot skip the route ---

  test('RM-T2-19: createBooking needs where the trip goes (it starts at the company unless a start is given)', () => {
    const base = {
      vehicleId: 'v1',
      bookingDate: '2099-01-01',
      startTime: '10:00',
      endTime: '12:00',
    };
    expect(createBookingSchema.safeParse({ ...base, startPoint: CAIRO }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, endPoint: ALEXANDRIA }).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...base }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, startPoint: CAIRO, endPoint: ALEXANDRIA }).success).toBe(true);
  });

  test('RM-T2-20: createBooking rejects an end time equal to the start or an impossible time', () => {
    const base = { vehicleId: 'v1', bookingDate: '2099-01-01', startPoint: CAIRO, endPoint: ALEXANDRIA };
    expect(createBookingSchema.safeParse({ ...base, startTime: '10:00', endTime: '10:00' }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, startTime: '25:00', endTime: '26:00' }).success).toBe(false);
    // An earlier end time = the trip ends the next morning; the overnight
    // limit from Settings is applied when booking (booking_rules tests).
    expect(createBookingSchema.safeParse({ ...base, startTime: '22:00', endTime: '01:00' }).success).toBe(true);
  });

  test('RM-T2-21: createBooking rejects a client that claims a negative distance', () => {
    const parsed = createBookingSchema.safeParse({
      vehicleId: 'v1',
      bookingDate: '2099-01-01',
      startTime: '10:00',
      endTime: '12:00',
      startPoint: CAIRO,
      endPoint: ALEXANDRIA,
      distanceKm: -100,
    });
    expect(parsed.success).toBe(false);
  });

  test('RM-T2-22: estimate-distance demands both endpoints', () => {
    expect(estimateDistanceSchema.safeParse({ startPoint: CAIRO }).success).toBe(false);
    expect(estimateDistanceSchema.safeParse({ startPoint: CAIRO, endPoint: ALEXANDRIA }).success).toBe(true);
  });

  // --- Server vs client comparison ---

  test('RM-T2-23: a close claim is within the 10% tolerance', () => {
    const result = compareDistance({ distanceKm: 100, durationMinutes: 120 }, 105, 125);
    expect(result.withinTolerance).toBe(true);
    expect(result.distanceDifferenceKm).toBe(5);
  });

  test('RM-T2-24: an under-reported claim is flagged', () => {
    // The abusive case: 1 km claimed for a 200 km trip.
    const result = compareDistance({ distanceKm: 200, durationMinutes: 240 }, 1, 5);
    expect(result.withinTolerance).toBe(false);
    expect(result.distanceDifferenceKm).toBe(-199);
  });

  test('RM-T2-25: no claim at all is trivially within tolerance', () => {
    const result = compareDistance({ distanceKm: 200, durationMinutes: 240 });
    expect(result.claimedDistanceKm).toBeNull();
    expect(result.distanceDifferenceKm).toBeNull();
    expect(result.withinTolerance).toBe(true);
  });
});
