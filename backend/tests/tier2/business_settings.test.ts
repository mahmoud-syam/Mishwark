import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken, generateDriverToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';
import SettingsService, { DEFAULT_SETTINGS } from '../../src/v1/services/settings.service';
import ReferralService from '../../src/v1/services/referral.service';
import AdminService from '../../src/v1/services/admin.service';

/**
 * Business settings edited from the dashboard Settings page: who may change
 * them, validation, and that each value actually drives the behaviour it names.
 * Also covers the pricing fix: a client-supplied surgeMultiplier or discount is
 * ignored.
 */
describe('Tier 2: Business settings', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  let seq = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    // auth re-reads the role from the database, so the Super Admin is real.
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = await prismaClient.users.create({
      data: { name: 'Owner', email: 'owner@mishwark.test', phoneNumber: '+201099990000', password: 'x', roleId: superRole.id },
    });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.rider = generateRiderToken({ id: seed.riderUser.id });
    ctx.driver = generateDriverToken({ id: seed.driverUser.id });
    ctx.api = createApiClient();
    return true;
  };

  const put = (body: unknown, token = ctx.su) => ctx.api.put('/admin/settings', body, { token });
  const estimate = (extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings/estimate-price', { vehicleId: ctx.seed.vehicle.id, startPoint: HALL, endPoint: HOTEL, ...extra }, { token: ctx.rider });
  const book = (date: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings', { vehicleId: ctx.seed.vehicle.id, driverId: ctx.seed.driverProfile.id, bookingDate: date, startTime: start, endTime: end, startPoint: HALL, endPoint: HOTEL, ...extra }, { token: ctx.rider });
  const nextDay = () => addDays(dateKey(), 20 + ++seq);
  const restore = () => put({ ...Object.fromEntries(Object.entries(DEFAULT_SETTINGS)) });

  test('SET-01: GET returns the defaults (the old hard-coded values)', async () => {
    if (!(await setup())) return;
    const res = await ctx.api.get('/admin/settings', { token: ctx.admin });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.depositRate).toBe(20);
    expect(d.bookingBufferMinutes).toBe(60);
    expect(d.tripEarlyStartMinutes).toBe(120);
    expect(d.vipSpendThreshold).toBe(15000);
    // The per-km prices and the peak multiplier are gone.
    expect(d.categoryRates).toBe(undefined);
    expect(d.peakSurgeMultiplier).toBe(undefined);
  });

  test('SET-02: only settings:manage may change settings; customers cannot read them', async () => {
    if (!(await setup())) return;
    expect((await put({ depositRate: 30 }, ctx.admin)).status).toBe(403);
    expect((await ctx.api.get('/admin/settings', { token: ctx.rider })).status).toBe(403);
    expect((await SettingsService.get()).depositRate).toBe(20);
  });

  test('SET-03: invalid values are refused and nothing changes', async () => {
    if (!(await setup())) return;
    expect((await put({ depositRate: 150 })).status).toBe(422);
    expect((await put({ bookingBufferMinutes: 12.5 })).status).toBe(422);
    expect((await put({ unknownSetting: 1 })).status).toBe(422);
    expect((await put({ peakSurgeMultiplier: 2 })).status).toBe(422); // no longer a setting
    expect((await put({ categoryRates: { CAR: { basePrice: 80, pricePerKm: 1, pricePerHour: 1 } } })).status).toBe(422);
    const s = await SettingsService.get();
    expect(s.depositRate).toBe(20);
  });

  test('SET-04: deposit % and trip prices apply to new quotes and bookings, not existing ones', async () => {
    if (!(await setup())) return;
    const before = (await book(nextDay(), '10:00', '11:00')).body.data;
    expect(before.depositRequired).toBe(Math.round(before.totalPrice * 0.2 * 100) / 100);

    const res = await put({ depositRate: 30, tripOtherPrices: { VAN: 1700 } });
    expect(res.status).toBe(200);
    expect(res.body.data.tripOtherPrices.CAR).toBe(1000); // untouched categories keep their values

    const q = (await estimate()).body.data;
    expect(q.depositRequired).toBe(Math.round(q.totalPrice * 0.3 * 100) / 100);

    const after = (await book(nextDay(), '10:00', '11:00')).body.data;
    expect(after.depositRequired).toBe(Math.round(after.totalPrice * 0.3 * 100) / 100);

    const old = await prismaClient.bookings.findUnique({ where: { id: before.id } });
    expect(old?.depositRequired).toBe(before.depositRequired);
    await put({ tripOtherPrices: { VAN: 1500 } });
    await restore();
  });

  test('SET-05: client-sent surge or discounts are ignored', async () => {
    if (!(await setup())) return;
    const normal = (await estimate()).body.data;
    const cheat = (await estimate({ surgeMultiplier: 0.01, packageDiscount: 9999, referralDiscount: 9999, isPeakHour: true })).body.data;
    expect(cheat.totalPrice).toBe(normal.totalPrice);
    const booked = (await book(nextDay(), '10:00', '11:00', { surgeMultiplier: 0.01, isPeakHour: true })).body.data;
    expect(booked.totalPrice).toBe(normal.totalPrice);
  });

  test('SET-06: the gap between trips follows bookingBufferMinutes', async () => {
    if (!(await setup())) return;
    await put({ bookingBufferMinutes: 0 });
    const d = nextDay();
    expect((await book(d, '10:00', '11:00')).status).toBe(201);
    expect((await book(d, '11:00', '12:00')).status).toBe(201);

    await put({ bookingBufferMinutes: 120 });
    const res = await book(d, '13:30', '14:30');
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('120 minutes');
    await restore();
  });

  test('SET-07: the early-start limit follows tripEarlyStartMinutes', async () => {
    if (!(await setup())) return;
    const b = (await book(nextDay(), '10:00', '11:00')).body.data;
    await prismaClient.bookings.update({ where: { id: b.id }, data: { status: BookingStatus.CONFIRMED } });
    await put({ tripEarlyStartMinutes: 30 });
    const res = await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: 'INPROGRESS' }, { token: ctx.driver });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('30 minutes');
    await restore();
  });

  test('SET-08: new referrals and new drivers take the current reward and commission', async () => {
    if (!(await setup())) return;
    await put({ referralRewardAmount: 40, defaultCommissionRate: 15 });

    const { referralCode } = (await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any;
    // A referral code only works before the first booking, so use a new customer.
    const fresh = await prismaClient.users.create({ data: { name: 'Fresh', phoneNumber: '+201077770000', roleId: ctx.seed.riderUser.roleId } });
    const referral: any = await ReferralService.applyReferralCode(fresh.id, referralCode);
    expect((referral.referral ?? referral).rewardAmount).toBe(40);

    const driverRole = await prismaClient.role.findFirst({ where: { name: 'DRIVER' } });
    const newbie = await prismaClient.users.create({ data: { name: 'New Driver', phoneNumber: '+201088880000', roleId: ctx.seed.riderUser.roleId } });
    await AdminService.updateUserRole(newbie.id, driverRole!.id);
    const profile = await prismaClient.drivers.findUnique({ where: { userId: newbie.id } });
    expect(profile?.commissionRate).toBe(15);
    await restore();
  });

  test('SET-09: the VIP threshold drives the customer badge', async () => {
    if (!(await setup())) return;
    const vip = async () => (await ctx.api.get(`/admin/customers/${ctx.seed.riderUser.id}/analytics?period=year`, { token: ctx.admin })).body.data.customer.isVip;
    expect(await vip()).toBe(false);
    await put({ vipSpendThreshold: 0 });
    expect(await vip()).toBe(true);
    await restore();
    expect(await vip()).toBe(false);
  });

  test('SET-10: every change is audit-logged with readable names', async () => {
    if (!(await setup())) return;
    await put({ depositRate: 25 });
    const log = await prismaClient.auditLogs.findFirst({ where: { entityType: 'settings' }, orderBy: { createdAt: 'desc' } });
    expect(log?.details).toContain('نسبة العربون');
    expect(log?.details).toContain('20 → 25');
    await restore();
    expect((await SettingsService.get()).depositRate).toBe(20);
  });
});
