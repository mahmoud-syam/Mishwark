import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus, TripStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';
import { otpBypassAllowed, otpDelivery } from '../../src/v1/controllers/auth.controller';

/**
 * Found by the full-cycle app review (18 Nov): requests sent at the same moment
 * double-booked a car, refunded a deposit several times, saved two reviews for
 * one trip; confirmed payments could exceed the price; no length limits on
 * reviews and chat; trip-status errors revealed other people's bookings.
 */
describe('Tier 2: full-cycle app review fixes', () => {
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
    ctx.seed = await seedDatabase();
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner-fix@mishwark.test', phoneNumber: '+201099990077', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.api = createApiClient();
    return true;
  };
  const driver = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Fix Driver ${i}`, phoneNumber: `+20108990${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Fix Driver ${i}`, licenseNumber: `FIX-${i}`, status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    const token = generateToken({ id: u.id, email: '', name: u.name, tokenVersion: 0, roleId: u.roleId, role: { id: u.roleId, name: 'DRIVER', permissions: [] } } as any);
    return { driverId: u.drivers!.id, userId: u.id, token };
  };
  const car = async (driverIds?: string[]) => {
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Kia', model: 'K5', year: 2024, plateNumber: `FIX-${++n}`, capacity: 4, category: 'LUXURY' }, { token: ctx.su })).body.data;
    const ids = driverIds ?? [(await driver()).driverId];
    expect((await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds: ids }, { token: ctx.su })).status).toBe(200);
    return c.id as string;
  };
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Fix Guest ${++n}`, phoneNumber: `+20105660${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return { id: u.id, token: generateRiderToken({ id: u.id }) };
  };
  const book = (vehicleId: string, bookingDate: string, startTime: string, endTime: string, who: { token: string }) =>
    ctx.api.post('/bookings', { vehicleId, bookingDate, startTime, endTime, startPoint: HALL, endPoint: HOTEL }, { token: who.token });
  const day = () => addDays(dateKey(), 30 + ++seq * 3);

  test('FIX-01: overlapping bookings sent at once: only one is saved', async () => {
    if (!(await setup())) return;
    const c = await car();
    const d = day();
    const people = await Promise.all([1, 2, 3, 4, 5, 6].map(() => customer()));
    const res = await Promise.all(people.map((p, i) => book(c, d, i % 2 ? '15:00' : '14:00', i % 2 ? '17:00' : '16:00', p)));
    expect(res.filter((r: any) => r.status === 201).length).toBe(1);
    expect(await prismaClient.bookings.count({ where: { vehicleId: c, bookingDate: d, status: { not: BookingStatus.CANCELLED } } })).toBe(1);
  });

  test('FIX-02: a night trip and an early trip next day sent at once: one is saved', async () => {
    if (!(await setup())) return;
    const c = await car();
    const d = day();
    const [p1, p2, p3, p4] = await Promise.all([1, 2, 3, 4].map(() => customer()));
    const res = await Promise.all([book(c, d, '22:00', '02:00', p1), book(c, addDays(d, 1), '00:30', '01:30', p2), book(c, d, '22:00', '02:00', p3), book(c, addDays(d, 1), '00:30', '01:30', p4)]);
    expect(res.filter((r: any) => r.status === 201).length).toBe(1);
  });

  test('FIX-03: several cancels at once refund the deposit once', async () => {
    if (!(await setup())) return;
    const c = await car();
    const p = await customer();
    const b = (await book(c, day(), '10:00', '12:00', p)).body.data;
    const pay = (await ctx.api.post('/payments', { bookingId: b.id, amount: b.depositRequired, paymentMethod: 'CASH' }, { token: p.token })).body.data;
    expect((await ctx.api.patch(`/payments/${pay.id}/status`, { status: 'SUCCESS' }, { token: ctx.su })).status).toBe(200);
    const res = await Promise.all([1, 2, 3, 4].map(() => ctx.api.delete(`/bookings/${b.id}`, { token: p.token })));
    expect(res.every((r: any) => r.status === 200)).toBe(true);
    const refunds = await prismaClient.walletTransactions.findMany({ where: { userId: p.id, type: 'REFUND' } });
    expect(refunds.length).toBe(1);
    expect(Math.abs(refunds[0].amount - b.depositRequired) < 0.01).toBe(true);
  });

  test('FIX-04: confirmed payments can never exceed the price', async () => {
    if (!(await setup())) return;
    const c = await car();
    const p = await customer();
    const b = (await book(c, day(), '10:00', '12:00', p)).body.data;
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await ctx.api.post('/payments', { bookingId: b.id, amount: b.totalPrice, paymentMethod: 'CASH' }, { token: p.token })).body.data.id);
    const res = await Promise.all(ids.map((id: string) => ctx.api.patch(`/payments/${id}/status`, { status: 'SUCCESS' }, { token: ctx.su })));
    expect(res.filter((r: any) => r.status === 200).length).toBe(1);
    const refused = res.find((r: any) => r.status === 400);
    expect(refused.body.message.includes('over the booking')).toBe(true);
    const row = await prismaClient.bookings.findUnique({ where: { id: b.id } });
    expect(Math.abs(row!.depositPaid - b.totalPrice) < 0.01).toBe(true);
  });

  test('FIX-05: trip status: an outsider gets 404, the customer 403, before any state check', async () => {
    if (!(await setup())) return;
    const c = await car();
    const p = await customer();
    const stranger = await customer();
    const b = (await book(c, day(), '10:00', '12:00', p)).body.data;
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'COMPLETED' }, { token: stranger.token })).status).toBe(404);
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'COMPLETED' }, { token: p.token })).status).toBe(403);
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'COMPLETED' }, { token: stranger.token })).status).toBe(404);
  });

  test('FIX-06: three reviews of one trip sent at once: one is saved', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const c = await car([d.driverId]);
    const p = await customer();
    const b = (await book(c, day(), '10:00', '12:00', p)).body.data;
    await prismaClient.bookings.update({ where: { id: b.id }, data: { status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED } });
    const body = { bookingId: b.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 2, comment: 'late' };
    const res = await Promise.all([1, 2, 3].map(() => ctx.api.post('/reviews', body, { token: p.token })));
    expect(res.filter((r: any) => r.status === 201).length).toBe(1);
    expect(res.filter((r: any) => r.status === 409).length).toBe(2);
    expect(await prismaClient.reviews.count({ where: { bookingId: b.id, reviewerType: 'CUSTOMER_TO_DRIVER' } })).toBe(1);
    const long = await ctx.api.post('/reviews', { bookingId: b.id, reviewerType: 'DRIVER_TO_CUSTOMER', overallRating: 5, comment: 'x'.repeat(1001) }, { token: d.token });
    expect(long.status).toBe(422);
    ctx.reviewedBooking = b;
    ctx.reviewedCustomer = p;
  });

  test('FIX-07: chat messages: not empty, 2000 characters at most', async () => {
    if (!(await setup())) return;
    const b = ctx.reviewedBooking;
    const conv = (await ctx.api.post(`/chat/booking/${b.id}`, {}, { token: ctx.reviewedCustomer.token })).body.data;
    expect((await ctx.api.post(`/chat/${conv.id}/messages`, { content: '   ' }, { token: ctx.reviewedCustomer.token })).status).toBe(422);
    expect((await ctx.api.post(`/chat/${conv.id}/messages`, { content: 'y'.repeat(2001) }, { token: ctx.reviewedCustomer.token })).status).toBe(422);
    expect((await ctx.api.post(`/chat/${conv.id}/messages`, { content: 'on my way' }, { token: ctx.reviewedCustomer.token })).status).toBe(201);
  });

  test('FIX-08: a request body over the limit is a 413, not a 500', async () => {
    if (!(await setup())) return;
    const p = await customer();
    const res = await ctx.api.post('/bookings', { notes: 'z'.repeat(300_000) }, { token: p.token });
    expect(res.status).toBe(413);
  });

  test('FIX-09: waitlist: no past dates, and someone else\'s entry is not found', async () => {
    if (!(await setup())) return;
    const c = await car();
    const p = await customer();
    const other = await customer();
    expect((await ctx.api.post('/waitlist', { vehicleId: c, requestedDate: addDays(dateKey(), -2) }, { token: p.token })).status).toBe(400);
    expect((await ctx.api.post('/waitlist', { vehicleId: c, requestedDate: addDays(dateKey(), 400) }, { token: p.token })).status).toBe(400);
    const w = await ctx.api.post('/waitlist', { vehicleId: c, requestedDate: day(), requestedTime: '10:00' }, { token: p.token });
    expect(w.status).toBe(201);
    expect((await ctx.api.delete(`/waitlist/${w.body.data.id}`, { token: other.token })).status).toBe(404);
  });

  test('FIX-10: driver profile: no photo link, a real expiry date, known statuses only', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const ok = await ctx.api.put('/driver/profile', { fullName: 'سامح السواق', pic: 'https://tracker.example/p.gif', rating: 1, commissionRate: 0 }, { token: d.token });
    expect(ok.status).toBe(200);
    const row = await prismaClient.drivers.findUnique({ where: { id: d.driverId }, include: { user: true } });
    expect(row!.pic).toBe('');
    expect(row!.rating).toBe(5);
    expect(row!.commissionRate).toBe(20);
    expect(row!.user.name).toBe('سامح السواق');
    expect((await ctx.api.put('/driver/profile', { licenseExpiry: 'soon' }, { token: d.token })).status).toBe(422);
    expect((await ctx.api.patch('/driver/status', { status: 'SUPERSTAR' }, { token: d.token })).status).toBe(400);
  });

  test('FIX-11: in production with no SMS set up, codes are never returned and 0000 is off', async () => {
    // Pure decisions (changing NODE_ENV here would leak into suites running alongside).
    expect(otpDelivery({ smsConfigured: false, nodeEnv: 'production' })).toBe('refuse');
    expect(otpDelivery({ smsConfigured: false, nodeEnv: 'production', devResponse: 'false' })).toBe('refuse');
    expect(otpDelivery({ smsConfigured: false, nodeEnv: 'production', devResponse: 'true' })).toBe('response');
    expect(otpDelivery({ smsConfigured: true, nodeEnv: 'production', devResponse: 'true' })).toBe('sms');
    expect(otpDelivery({ smsConfigured: false, nodeEnv: 'development' })).toBe('response');
    expect(otpBypassAllowed('production', undefined)).toBe(false);
    expect(otpBypassAllowed('production', 'true')).toBe(true);
    expect(otpBypassAllowed('test', undefined)).toBe(true);
  });
});
