import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus, ReferralStatus, TripStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken, generateDriverToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';

/**
 * Business rules agreed after the QA cycle (api-docs/QA_REPORT.md):
 * deposit required vs paid, who settles payments, auto-confirm on deposit,
 * several trips per vehicle per day with a 60-min buffer, a 2-hour trip start
 * window, admin-set leave lock, server-side referral rewards and OTP limits.
 */
describe('Tier 2: Booking, payment, driver & OTP rules', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    ctx.admin = generateAdminToken({ id: seed.adminUser.id });
    ctx.rider = generateRiderToken({ id: seed.riderUser.id });
    ctx.driver = generateDriverToken({ id: seed.driverUser.id });
    ctx.api = createApiClient();
    return true;
  };

  const book = (date: string, start: string, end: string, token = ctx.rider) =>
    ctx.api.post('/bookings', { vehicleId: ctx.seed.vehicle.id, driverId: ctx.seed.driverProfile.id, bookingDate: date, startTime: start, endTime: end, startPoint: HALL, endPoint: HOTEL }, { token });

  test('RULE-01: several trips per vehicle per day, but 60 minutes apart', async () => {
    if (!(await setup())) return;
    const d = addDays(dateKey(), 10);
    expect((await book(d, '10:00', '12:00')).status).toBe(201);
    expect((await book(d, '16:00', '18:00')).status).toBe(201);
    expect((await book(d, '12:30', '14:00')).status).toBe(409);
    expect((await book(d, '13:00', '15:00')).status).toBe(201);
  });

  test('RULE-02: cancelling one trip keeps the day BOOKED while others remain', async () => {
    if (!(await setup())) return;
    const d = addDays(dateKey(), 11);
    const a = (await book(d, '09:00', '10:00')).body.data;
    await book(d, '15:00', '16:00');
    expect((await ctx.api.delete(`/bookings/${a.id}`, { token: ctx.rider })).status).toBe(200);
    const row = await prismaClient.vehicleAvailability.findUnique({
      where: { vehicleId_date: { vehicleId: ctx.seed.vehicle.id, date: new Date(`${d}T00:00:00.000Z`) } },
    });
    expect(row?.status).toBe('BOOKED');
  });

  test('RULE-03: deposit is required, not pre-paid; paying it auto-confirms', async () => {
    if (!(await setup())) return;
    const b = (await book(addDays(dateKey(), 12), '10:00', '12:00')).body.data;
    expect(b.status).toBe(BookingStatus.PENDING);
    expect(b.depositPaid).toBe(0);
    expect(b.depositRequired).toBeGreaterThan(0);

    const pay = await ctx.api.post('/payments', { bookingId: b.id, amount: b.depositRequired, paymentMethod: 'CASH' }, { token: ctx.rider });
    expect(pay.status).toBe(201);
    // The customer can't settle it; the assigned driver can (cash).
    expect((await ctx.api.patch(`/payments/${pay.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.rider })).status).toBe(403);
    expect((await ctx.api.patch(`/payments/${pay.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.driver })).status).toBe(200);

    const after = await prismaClient.bookings.findUnique({ where: { id: b.id } });
    expect(after?.status).toBe(BookingStatus.CONFIRMED);
    expect(after?.depositPaid).toBe(b.depositRequired);
    expect(after?.paymentStatus).toBe('PARTIALLY_PAID');

    // The rest can be paid in full afterwards.
    const rest = await ctx.api.post('/payments', { bookingId: b.id, amount: b.totalPrice - b.depositRequired, paymentMethod: 'PAYMOB' }, { token: ctx.rider });
    expect(rest.status).toBe(201);
    expect((await ctx.api.patch(`/payments/${rest.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.driver })).status).toBe(403);
    expect((await ctx.api.patch(`/payments/${rest.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.admin })).status).toBe(200);
    expect((await prismaClient.bookings.findUnique({ where: { id: b.id } }))?.paymentStatus).toBe('PAID');
  });

  test('RULE-04: customers can no longer confirm their own booking', async () => {
    if (!(await setup())) return;
    const b = (await book(addDays(dateKey(), 13), '10:00', '12:00')).body.data;
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'CONFIRMED' }, { token: ctx.rider })).status).toBe(403);
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'CONFIRMED' }, { token: ctx.driver })).status).toBe(200);
  });

  test('RULE-05: trips start only on confirmed bookings, and drivers at most 2 hours early; admins anytime', async () => {
    if (!(await setup())) return;
    const b = (await book(addDays(dateKey(), 2), '10:00', '12:00')).body.data;
    // Unconfirmed bookings can't start at all.
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'INPROGRESS' }, { token: ctx.admin })).status).toBe(400);
    await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'CONFIRMED' }, { token: ctx.driver });
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'INPROGRESS' }, { token: ctx.driver })).status).toBe(400);
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'INPROGRESS' }, { token: ctx.admin })).status).toBe(200);
  });

  test('RULE-06: a leave set by an admin can only be lifted by an admin', async () => {
    if (!(await setup())) return;
    const id = ctx.seed.driverProfile.id;
    expect((await ctx.api.patch(`/admin/drivers/${id}/status`, { status: 'ONLEAVE' }, { token: ctx.admin })).status).toBe(200);
    expect((await ctx.api.patch('/driver/status', { status: 'ACTIVE' }, { token: ctx.driver })).status).toBe(403);
    expect((await ctx.api.patch(`/admin/drivers/${id}/status`, { status: 'ACTIVE' }, { token: ctx.admin })).status).toBe(200);
    // A status the driver set himself stays his to change.
    expect((await ctx.api.patch('/driver/status', { status: 'OFF' }, { token: ctx.driver })).status).toBe(200);
    expect((await ctx.api.patch('/driver/status', { status: 'ACTIVE' }, { token: ctx.driver })).status).toBe(200);
    expect((await prismaClient.drivers.findUnique({ where: { id } }))?.status).toBe(DriverStatus.ACTIVE);
  });

  test('RULE-07: referral reward is paid by the server on trip completion; no public endpoint', async () => {
    if (!(await setup())) return;
    const referrer = ctx.seed.adminUser;
    const ref = await prismaClient.referrals.create({
      data: { referrerId: referrer.id, referredId: ctx.seed.riderUser.id, referralCode: 'TEST', rewardAmount: 25 },
    });
    expect((await ctx.api.post(`/referrals/${ref.id}/complete`, {})).status).toBe(404);

    const b = await prismaClient.bookings.create({
      data: {
        customerId: ctx.seed.riderUser.id, vehicleId: ctx.seed.vehicle.id, driverId: ctx.seed.driverProfile.id,
        bookingDate: dateKey(), startTime: '00:01', endTime: '23:59', status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.ARRIVED, totalPrice: 500,
      },
    });
    expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'COMPLETED' }, { token: ctx.driver })).status).toBe(200);
    const after = await prismaClient.referrals.findUnique({ where: { id: ref.id } });
    expect(after?.status).toBe(ReferralStatus.COMPLETED);
    const credits = await prismaClient.walletTransactions.count({ where: { type: 'REFERRAL_REWARD', userId: { in: [referrer.id, ctx.seed.riderUser.id] } } });
    expect(credits).toBe(2);
  });

  test('RULE-08: OTP expires after too many wrong guesses and resends are throttled', async () => {
    if (!(await setup())) return;
    const phone = '+201066600001';
    const first = await ctx.api.post('/auth/otp/request', { phoneNumber: phone, name: 'OTP Test' });
    expect(first.status).toBe(200);
    expect(typeof first.body.dev_otp).toBe('string'); // no SMS provider in tests
    expect((await ctx.api.post('/auth/otp/request', { phoneNumber: phone })).status).toBe(429);

    for (let i = 0; i < 5; i++) {
      expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: '9' + String(i).repeat(3) === first.body.dev_otp ? '1111' : '9' + String(i).repeat(3) })).status).toBe(400);
    }
    // This device is now blocked for that phone (sign-in guard)...
    expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: first.body.dev_otp })).status).toBe(429);
    // ...and from any device the code itself is dead.
    const late = await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: first.body.dev_otp }, { headers: { 'X-Forwarded-For': '198.51.100.44' } });
    expect(late.status).toBe(400);
    expect(String(late.body.message)).toContain('expired');
  });
});
