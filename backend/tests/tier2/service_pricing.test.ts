import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { DriverStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';
import { priceService } from '../../src/v1/services/service-pricing.service';

/**
 * The owner's pricing model:
 * - WEDDING: fixed per car (or the default), covers hours + km, extras beyond.
 * - TRIP: from the company; listed destination = fixed price per car category,
 *   any other place = price per category; km beyond the included ones extra.
 * - VIP: fixed per occasion, like a wedding with its own prices.
 * Without ORS the distance is a straight-line estimate x 1.3 (as in the tests).
 */
describe('Tier 2: pricing by service type (wedding, private trip, VIP)', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  let n = 0;
  let seq = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner7@mishwark.test', phoneNumber: '+201099990007', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.api = createApiClient();
    expect((await ctx.api.put('/admin/settings', {
      depositRate: 20, bookingBufferMinutes: 60, minTripMinutes: 30, maxAdvanceBookingDays: 365, overnightLatestEndHour: 6,
      weddingDefaultPrice: 1500, weddingIncludedHours: 4, weddingIncludedKm: 50, weddingExtraHourPrice: 300, weddingExtraKmPrice: 50,
      vipDefaultPrice: 3000, vipIncludedHours: 4, vipIncludedKm: 50, vipExtraHourPrice: 500, vipExtraKmPrice: 75,
      tripIncludedKm: 150, tripExtraKmPrice: 50, tripOtherPrices: { LUXURY: 2500, VAN: 1500 },
      originLabel: 'الزقازيق، الشرقية', originLat: 30.5877, originLng: 31.502,
    }, { token: ctx.su })).status).toBe(200);
    return true;
  };
  const car = async (extra: Record<string, unknown> = {}) => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Svc Driver ${i}`, phoneNumber: `+20109990${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Svc Driver ${i}`, licenseNumber: `SVC-${i}`, licenseExpiry: new Date('2030-01-01'), status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Mercedes', model: 'S', year: 2026, plateNumber: `SVC-${i}`, capacity: 4, category: 'LUXURY', ...extra }, { token: ctx.su })).body.data;
    expect((await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds: [u.drivers!.id] }, { token: ctx.su })).status).toBe(200);
    return c.id as string;
  };
  const quote = (body: Record<string, unknown>) => ctx.api.post('/bookings/estimate-price', body);
  const day = () => addDays(dateKey(), 30 + ++seq);
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Svc Guest ${++n}`, phoneNumber: `+20104440${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return generateRiderToken({ id: u.id });
  };

  test('SVC-01: the calculation itself (extra started hours and whole km, discounts, deposit)', () => {
    const p = priceService({ basePrice: 1500, baseCode: 'wedding', includedHours: 4, extraHourPrice: 300, bookedMinutes: 6 * 60 + 10, includedKm: 50, extraKmPrice: 50, distanceKm: 61.2, packageDiscountPercent: 10, referralDiscount: 100, depositRate: 20 });
    // 6h10 = 3 started hours beyond 4; 61.2 km = 12 km beyond 50 (rounded up).
    expect(p.lines.map((l) => `${l.code}:${l.quantity ?? ''}:${l.amount}`).join(' ')).toBe('wedding::1500 extra_hours:3:900 extra_km:12:600 package_discount::-300 referral_discount::-100');
    expect(p.gross).toBe(3000);
    expect(p.totalPrice).toBe(2600);
    expect(p.depositRequired).toBe(520);
    // Inside the limits: just the price.
    const q = priceService({ basePrice: 1500, baseCode: 'wedding', includedHours: 4, extraHourPrice: 300, bookedMinutes: 240, includedKm: 50, extraKmPrice: 50, distanceKm: 50, depositRate: 20 });
    expect(q.lines.length).toBe(1);
    expect(q.totalPrice).toBe(1500);
  });

  test('SVC-02: wedding uses the car\'s own price, or the default when it has none', async () => {
    if (!(await setup())) return;
    const own = await car({ weddingPrice: 2000 });
    const plain = await car();
    const a = await quote({ serviceType: 'WEDDING', vehicleId: own, startPoint: HALL, endPoint: HOTEL, startTime: '19:00', endTime: '23:00' });
    expect(a.status).toBe(200);
    expect(a.body.lines[0]).toEqual({ code: 'wedding', amount: 2000, includedHours: 4, includedKm: 50 });
    expect(a.body.data.totalPrice).toBe(2000);
    expect(a.body.data.depositRequired).toBe(400);
    const b = await quote({ serviceType: 'WEDDING', vehicleId: plain, startPoint: HALL, endPoint: HOTEL, startTime: '19:00', endTime: '23:00' });
    expect(b.body.data.totalPrice).toBe(1500);
  });

  test('SVC-03: a wedding past the included hours (into the next morning) pays every started extra hour', async () => {
    if (!(await setup())) return;
    const c = await car({ weddingPrice: 2000 });
    const q = await quote({ serviceType: 'WEDDING', vehicleId: c, startPoint: HALL, endPoint: HOTEL, startTime: '20:00', endTime: '01:30' });
    const extra = q.body.lines.find((l: any) => l.code === 'extra_hours');
    expect(extra).toEqual({ code: 'extra_hours', quantity: 2, unitPrice: 300, included: 4, amount: 600 });
    expect(q.body.data.totalPrice).toBe(2600);
    expect(q.body.bookedMinutes).toBe(330);
  });

  test('SVC-04: private trip to a listed destination: no points needed, price by car category', async () => {
    if (!(await setup())) return;
    const d = (await ctx.api.post('/admin/destinations', { name: 'مطار القاهرة الدولي', latitude: 30.1219, longitude: 31.4056, prices: { LUXURY: 2200, VAN: 1700 } }, { token: ctx.su })).body.data;
    const c = await car();
    const q = await quote({ serviceType: 'TRIP', vehicleId: c, destinationId: d.id });
    expect(q.status).toBe(200);
    expect(q.body.lines[0]).toEqual({ code: 'trip', amount: 2200, name: 'مطار القاهرة الدولي', includedKm: 150 });
    expect(q.body.startPoint.label).toBe('الزقازيق، الشرقية');
    expect(q.body.route.distanceKm < 150).toBe(true);
    expect(q.body.data.totalPrice).toBe(2200);
  });

  test('SVC-05: a trip beyond the included km pays each extra km; another place uses the category price', async () => {
    if (!(await setup())) return;
    const aswan = (await ctx.api.post('/admin/destinations', { name: 'أسوان', latitude: 24.0889, longitude: 32.8998, includedKm: 200, prices: { LUXURY: 6000 } }, { token: ctx.su })).body.data;
    const c = await car();
    const far = await quote({ serviceType: 'TRIP', vehicleId: c, destinationId: aswan.id });
    const km = far.body.lines.find((l: any) => l.code === 'extra_km');
    expect(km.included).toBe(200);
    expect(km.unitPrice).toBe(50);
    expect(km.quantity).toBe(Math.ceil(far.body.route.distanceKm - 200));
    expect(far.body.data.totalPrice).toBe(6000 + km.amount);
    const other = await quote({ serviceType: 'TRIP', vehicleId: c, endPoint: { latitude: 30.7865, longitude: 31.0004, label: 'طنطا' } });
    expect(other.body.lines[0]).toEqual({ code: 'trip_other', amount: 2500, includedKm: 150 });
    // A trip needs a destination or a place.
    expect((await quote({ serviceType: 'TRIP', vehicleId: c })).status).toBe(422);
  });

  test('SVC-06: VIP has its own price per car or the VIP default', async () => {
    if (!(await setup())) return;
    const c = await car({ vipPrice: 4200 });
    const q = await quote({ serviceType: 'VIP', vehicleId: c, startPoint: HALL, endPoint: HOTEL, startTime: '18:00', endTime: '22:00' });
    expect(q.body.lines[0]).toEqual({ code: 'vip', amount: 4200, includedHours: 4, includedKm: 50 });
    const d = await quote({ serviceType: 'VIP', vehicleId: await car(), startPoint: HALL, endPoint: HOTEL, startTime: '18:00', endTime: '23:00' });
    expect(d.body.data.totalPrice).toBe(3000 + 500);
  });

  test('SVC-07: a booking is priced the same way and keeps its service, destination and lines', async () => {
    if (!(await setup())) return;
    const d = (await ctx.api.post('/admin/destinations', { name: 'القاهرة', latitude: 30.0444, longitude: 31.2357, prices: { LUXURY: 1800 } }, { token: ctx.su })).body.data;
    const c = await car();
    const res = await ctx.api.post('/bookings', { vehicleId: c, serviceType: 'TRIP', destinationId: d.id, bookingDate: day(), startTime: '09:00', endTime: '13:00' }, { token: await customer() });
    expect(res.status).toBe(201);
    const b = await prismaClient.bookings.findUnique({ where: { id: res.body.data.id } });
    expect(b!.serviceType).toBe('TRIP');
    expect(b!.destinationId).toBe(d.id);
    expect(b!.totalPrice).toBe(1800);
    expect(b!.depositRequired).toBe(360);
    expect(b!.startPoint).toBe('الزقازيق، الشرقية');
    expect(b!.endPoint).toBe('القاهرة');
    expect((b!.priceLines as any[])[0].code).toBe('trip');
    // Wedding booked by the office for a customer.
    const wedding = await car({ weddingPrice: 2400 });
    const cust = await prismaClient.users.create({ data: { name: 'Office Guest', phoneNumber: '+201044409999', roleId: ctx.seed.riderUser.roleId } });
    const office = await ctx.api.post('/admin/bookings', { customerId: cust.id, vehicleId: wedding, serviceType: 'WEDDING', bookingDate: day(), startTime: '19:00', endTime: '00:30', startPoint: HALL, endPoint: HOTEL }, { token: ctx.su });
    expect(office.status).toBe(201);
    const ob = await prismaClient.bookings.findUnique({ where: { id: office.body.data.id } });
    expect(ob!.totalPrice).toBe(2400 + 2 * 300);
  });

  test('SVC-08: destinations: only settings:manage edits, prices update per category, a used one is switched off', async () => {
    if (!(await setup())) return;
    const adminToken = generateToken({ id: ctx.seed.adminUser.id, email: 'a@a', name: 'Admin', tokenVersion: 0, roleId: ctx.seed.adminRole.id, role: { id: ctx.seed.adminRole.id, name: 'ADMIN', permissions: [] } } as any);
    expect((await ctx.api.post('/admin/destinations', { name: 'X', latitude: 30, longitude: 31 }, { token: adminToken })).status).toBe(403);
    const d = (await ctx.api.post('/admin/destinations', { name: 'بنها', latitude: 30.4659, longitude: 31.1848, prices: { LUXURY: 900 } }, { token: ctx.su })).body.data;
    const up = await ctx.api.patch(`/admin/destinations/${d.id}`, { prices: { VAN: 700 } }, { token: ctx.su });
    expect(up.body.data.prices.LUXURY).toBe(900);
    expect(up.body.data.prices.VAN).toBe(700);
    const list = (await ctx.api.get('/admin/destinations', { token: ctx.su })).body.data.find((x: any) => x.id === d.id);
    expect(list.effectivePrices.CAR).toBe(1000); // CAR not set: the "another place" price
    expect(list.effectiveIncludedKm).toBe(150);
    const c = await car();
    expect((await ctx.api.post('/bookings', { vehicleId: c, serviceType: 'TRIP', destinationId: d.id, bookingDate: day(), startTime: '10:00', endTime: '12:00' }, { token: await customer() })).status).toBe(201);
    const del = await ctx.api.delete(`/admin/destinations/${d.id}`, { token: ctx.su });
    expect(del.body.data.deactivated).toBe(true);
    expect((await quote({ serviceType: 'TRIP', vehicleId: c, destinationId: d.id })).status).toBe(400);
    const logs = await prismaClient.auditLogs.count({ where: { entityType: 'destination', entityId: d.id } });
    expect(logs).toBe(3);
  });

  test('SVC-09: GET /pricing gives the apps every price and rule, without an account', async () => {
    if (!(await setup())) return;
    const res = await ctx.api.get('/pricing');
    expect(res.status).toBe(200);
    expect(res.body.data.origin.label).toBe('الزقازيق، الشرقية');
    expect(res.body.data.wedding.defaultPrice).toBe(1500);
    expect(res.body.data.trip.includedKm).toBe(150);
    expect(res.body.data.trip.otherPrices.LUXURY).toBe(2500);
    expect(res.body.data.destinations.every((d: any) => typeof d.prices.LUXURY === 'number')).toBe(true);
    // Settings reject nonsense.
    expect((await ctx.api.put('/admin/settings', { originLat: 48.85 }, { token: ctx.su })).status).toBe(422);
  });

  test('SVC-10: a request without serviceType keeps the older per-km price (apps not updated yet)', async () => {
    if (!(await setup())) return;
    const c = await car({ basePrice: 500, pricePerKm: 10 });
    const q = await quote({ vehicleId: c, startPoint: HALL, endPoint: HOTEL });
    expect(q.status).toBe(200);
    expect(q.body.lines).toBe(undefined);
    expect(q.body.data.basePrice).toBe(500);
  });
});
