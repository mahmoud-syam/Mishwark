import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';
import ReferralService from '../../src/v1/services/referral.service';

/**
 * Package and referral discounts are applied to the booking itself (they used
 * to show on the estimate only), an admin sets each package's %, and a referred
 * customer gets a fixed discount on their first booking.
 */
describe('Tier 2: Package & referral discounts', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  let seq = 0;
  let phone = 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    // The seeded ADMIN role holds no permissions; package discounts need booking:manage.
    const perm = await prismaClient.permission.upsert({ where: { name: 'booking:manage' }, update: {}, create: { name: 'booking:manage', description: 'Manage bookings' } });
    await prismaClient.role.update({ where: { id: seed.adminRole.id }, data: { permissions: { connect: { id: perm.id } } } });
    ctx.rider = generateRiderToken({ id: seed.riderUser.id });
    ctx.api = createApiClient();
    return true;
  };

  /** A brand-new customer with no bookings. */
  const newCustomer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Guest ${++phone}`, phoneNumber: `+20107770${String(phone).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return { user: u, token: generateRiderToken({ id: u.id }) };
  };
  const day = () => addDays(dateKey(), 30 + ++seq);
  const book = (token: string, extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings', { vehicleId: ctx.seed.vehicle.id, driverId: ctx.seed.driverProfile.id, bookingDate: day(), startTime: '10:00', endTime: '11:00', startPoint: HALL, endPoint: HOTEL, ...extra }, { token });
  const estimate = (token?: string, extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings/estimate-price', { vehicleId: ctx.seed.vehicle.id, startPoint: HALL, endPoint: HOTEL, ...extra }, token ? { token } : {});
  const newPackage = async (token: string, extra: Record<string, unknown> = {}) =>
    (await ctx.api.post('/packages', { packageName: 'Wedding fleet', packageType: 'MULTI_CAR', ...extra }, { token })).body.data;
  const setPct = (id: string, pct: number, token = ctx.admin) => ctx.api.patch(`/admin/packages/${id}/discount`, { discountPercentage: pct }, { token });

  test('DISC-01: no discount from request fields or someone else\'s referral code', async () => {
    if (!(await setup())) return;
    const plain = (await estimate()).body.data;
    const { referralCode } = (await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any;
    const tricked = (await estimate(undefined, { referralCode, packageDiscount: 500, referralDiscount: 500 })).body.data;
    expect(tricked.totalPrice).toBe(plain.totalPrice);
    expect(tricked.discountAmount).toBe(0);
  });

  test('DISC-02: a customer cannot set their own package %; the admin\'s % is charged on the booking', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    const pkg = await newPackage(c.token, { discountPercentage: 100 });
    expect(pkg.discountPercentage).toBe(0);

    const first = (await book(c.token, { packageId: pkg.id })).body.data;
    expect(first.packageDiscount).toBe(0);

    const res = await setPct(pkg.id, 10);
    expect(res.status).toBe(200);
    expect(res.body.data.repriced).toBe(1);

    // The unpaid booking was re-priced, deposit included.
    const repriced = await prismaClient.bookings.findUnique({ where: { id: first.id } });
    expect(repriced!.packageDiscount).toBe(r2(first.totalPrice * 0.1));
    expect(repriced!.totalPrice).toBe(r2(first.totalPrice - repriced!.packageDiscount));
    expect(repriced!.depositRequired).toBe(r2(repriced!.totalPrice * 0.2));

    // The estimate and a new booking both carry the 10%.
    const q = (await estimate(c.token, { packageId: pkg.id })).body.data;
    expect(q.packageDiscount).toBeGreaterThan(0);
    const second = (await book(c.token, { packageId: pkg.id })).body.data;
    expect(second.packageDiscount).toBe(r2((second.totalPrice + second.packageDiscount) * 0.1));

    // Package total = sum of the (already discounted) booking prices.
    const p = await prismaClient.packages.findUnique({ where: { id: pkg.id } });
    expect(p!.totalPrice).toBe(r2(repriced!.totalPrice + second.totalPrice));
  });

  test('DISC-03: someone else\'s or a cancelled package can\'t be used', async () => {
    if (!(await setup())) return;
    const owner = await newCustomer();
    const other = await newCustomer();
    const pkg = await newPackage(owner.token);
    await setPct(pkg.id, 30);

    expect((await book(other.token, { packageId: pkg.id })).status).toBe(404);
    expect((await estimate(other.token, { packageId: pkg.id })).body.data.packageDiscount).toBe(0);

    await ctx.api.patch(`/packages/${pkg.id}/cancel`, {}, { token: owner.token });
    expect((await book(owner.token, { packageId: pkg.id })).status).toBe(400);
  });

  test('DISC-04: changing the % re-prices only bookings nothing was paid on', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    const pkg = await newPackage(c.token);
    await setPct(pkg.id, 10);
    const paid = (await book(c.token, { packageId: pkg.id })).body.data;
    const unpaid = (await book(c.token, { packageId: pkg.id })).body.data;

    const pay = await ctx.api.post('/payments', { bookingId: paid.id, amount: paid.depositRequired, paymentMethod: 'CASH' }, { token: c.token });
    await ctx.api.patch(`/payments/${pay.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.admin });

    const res = await setPct(pkg.id, 20);
    expect(res.body.data.repriced).toBe(1);
    expect((await prismaClient.bookings.findUnique({ where: { id: paid.id } }))!.totalPrice).toBe(paid.totalPrice);
    const u = await prismaClient.bookings.findUnique({ where: { id: unpaid.id } });
    expect(u!.packageDiscount).toBe(r2((unpaid.totalPrice + unpaid.packageDiscount) * 0.2));
  });

  test('DISC-05: leaving the package (or cancelling it) removes the discount from unpaid bookings', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    const pkg = await newPackage(c.token);
    await setPct(pkg.id, 25);
    const a = (await book(c.token, { packageId: pkg.id })).body.data;
    const b = (await book(c.token, { packageId: pkg.id })).body.data;
    const gross = (x: any) => r2(x.totalPrice + x.packageDiscount);

    expect((await ctx.api.delete(`/packages/${a.id}/booking`, { token: c.token })).status).toBe(200);
    const aa = await prismaClient.bookings.findUnique({ where: { id: a.id } });
    expect(aa!.packageDiscount).toBe(0);
    expect(aa!.totalPrice).toBe(gross(a));

    await ctx.api.patch(`/packages/${pkg.id}/cancel`, {}, { token: c.token });
    const bb = await prismaClient.bookings.findUnique({ where: { id: b.id } });
    expect(bb!.packageId).toBe(null);
    expect(bb!.totalPrice).toBe(gross(b));
  });

  test('DISC-06: a referred customer gets the discount on their first booking only', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    const { referralCode } = (await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any;
    expect((await ctx.api.post('/referrals/apply', { referralCode }, { token: c.token })).status).toBeLessThan(300);

    const q = (await estimate(c.token)).body.data;
    expect(q.referralDiscount).toBe(25);

    const first = (await book(c.token)).body.data;
    expect(first.referralDiscount).toBe(25);
    expect(first.depositRequired).toBe(r2(first.totalPrice * 0.2));
    expect((await book(c.token)).body.data.referralDiscount).toBe(0);

    // If the first booking is cancelled, the next one is the first again.
    const d = await newCustomer();
    await ReferralService.applyReferralCode(d.user.id, referralCode);
    const cancelled = (await book(d.token)).body.data;
    await ctx.api.delete(`/bookings/${cancelled.id}`, { token: d.token });
    expect((await book(d.token)).body.data.referralDiscount).toBe(25);
  });

  test('DISC-07: a referral code can\'t be applied after booking', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    await book(c.token);
    const { referralCode } = (await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any;
    const res = await ctx.api.post('/referrals/apply', { referralCode }, { token: c.token });
    expect(res.status).toBe(400);
  });

  test('DISC-08: signing up with a code creates the referral, and the referrer is paid after the first trip', async () => {
    if (!(await setup())) return;
    const { referralCode } = (await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any;
    const res = await ctx.api.post('/auth/signup', { name: 'Invited', email: 'invited@mishwark.test', password: 'password123', phoneNumbers: [{ number: '+201066660001' }], referralCode });
    expect(res.status).toBe(201);
    const invited = await prismaClient.users.findUnique({ where: { email: 'invited@mishwark.test' } });
    const ref = await prismaClient.referrals.findFirst({ where: { referredId: invited!.id } });
    expect(ref?.referrerId).toBe(ctx.seed.driverUser.id);
    expect(ref?.rewardAmount).toBe(25);

    const token = generateRiderToken({ id: invited!.id });
    const b = (await book(token)).body.data;
    expect(b.referralDiscount).toBe(25);
    await prismaClient.bookings.update({ where: { id: b.id }, data: { status: BookingStatus.CONFIRMED } });
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'COMPLETED' }, { token: ctx.admin })).status).toBe(200);
    const credit = await prismaClient.walletTransactions.findFirst({ where: { userId: ctx.seed.driverUser.id, amount: 25 } });
    expect(credit).not.toBe(null);
  });

  test('DISC-09: package discount endpoint: permission, validation, audit', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    const pkg = await newPackage(c.token);
    expect((await setPct(pkg.id, 10, c.token)).status).toBe(403);
    expect((await setPct(pkg.id, 150)).status).toBe(422);
    expect((await setPct(pkg.id, 15)).status).toBe(200);
    const log = await prismaClient.auditLogs.findFirst({ where: { entityType: 'package', entityId: pkg.id } });
    expect(log?.details).toContain('0% → 15%');

    const list = await ctx.api.get('/admin/packages?status=ACTIVE', { token: ctx.admin });
    expect(list.status).toBe(200);
    const row = list.body.data.find((p: any) => p.id === pkg.id);
    expect(row.discountPercentage).toBe(15);
    expect(row.customer.id).toBe(c.user.id);
  });

  test('DISC-10: an admin can quote with a customer\'s discounts; others can\'t borrow them', async () => {
    if (!(await setup())) return;
    const c = await newCustomer();
    await ReferralService.applyReferralCode(c.user.id, ((await ReferralService.generateReferralCode(ctx.seed.driverUser.id)) as any).referralCode);
    expect((await estimate(ctx.admin, { customerId: c.user.id })).body.data.referralDiscount).toBe(25);
    expect((await estimate(ctx.rider, { customerId: c.user.id })).body.data.referralDiscount).toBe(0);
  });
});
