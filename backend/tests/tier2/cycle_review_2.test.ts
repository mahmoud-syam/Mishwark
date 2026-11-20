import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus, TripStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';
import ReviewService from '../../src/v1/services/review.service';
import Notify from '../../src/v1/services/notify.service';

/**
 * Second full-cycle review (20 Nov): blind reviews really blind, reviews
 * released after 48 hours and counted in the driver's rating, each side of a
 * booking sees what it needs (the driver's phone once confirmed), readable
 * dates in notifications.
 */
describe('Tier 2: full-cycle review 2', () => {
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
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner-cr2@mishwark.test', phoneNumber: '+201099990099', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.api = createApiClient();
    return true;
  };
  const driver = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `CR Driver ${i}`, phoneNumber: `+20108550${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `CR Driver ${i}`, licenseNumber: `CR-${i}`, status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    const token = generateToken({ id: u.id, email: '', name: u.name, tokenVersion: 0, roleId: u.roleId, role: { id: u.roleId, name: 'DRIVER', permissions: [] } } as any);
    return { driverId: u.drivers!.id, userId: u.id, phone: u.phoneNumber!, token };
  };
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `CR Guest ${++n}`, phoneNumber: `+20105440${String(n).padStart(4, '0')}`, email: `cr${n}@guest.test`, roleId: ctx.seed.riderUser.roleId } });
    return { id: u.id, token: generateRiderToken({ id: u.id }) };
  };
  const trip = async () => {
    const d = await driver();
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Kia', model: 'K5', year: 2024, plateNumber: `CR-${++n}`, capacity: 4, category: 'LUXURY' }, { token: ctx.su })).body.data;
    await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds: [d.driverId] }, { token: ctx.su });
    const p = await customer();
    const b = (await ctx.api.post('/bookings', { vehicleId: c.id, bookingDate: addDays(dateKey(), 20 + ++seq * 2), startTime: '18:00', endTime: '21:00', startPoint: HALL, endPoint: HOTEL, serviceType: 'WEDDING' }, { token: p.token })).body.data;
    await Notify.idle();
    return { d, p, b };
  };

  test('CR-01: blind reviews: the other side sees a review only once both reviewed', async () => {
    if (!(await setup())) return;
    const t = await trip();
    await prismaClient.bookings.update({ where: { id: t.b.id }, data: { status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED } });
    const mine = (await ctx.api.post('/reviews', { bookingId: t.b.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 2, comment: 'اتأخر' }, { token: t.p.token })).body.data;
    // The driver can't read it yet, by any route.
    expect((await ctx.api.get(`/reviews/booking/${t.b.id}`, { token: t.d.token })).body.data.length).toBe(0);
    expect((await ctx.api.get(`/reviews/${mine.id}`, { token: t.d.token })).status).toBe(404);
    expect((await ctx.api.get(`/bookings/${t.b.id}`, { token: t.d.token })).body.data.reviews.length).toBe(0);
    // The writer still sees it.
    expect((await ctx.api.get(`/reviews/booking/${t.b.id}`, { token: t.p.token })).body.data.length).toBe(1);
    // Both reviewed: both visible, and the driver's rating follows.
    await ctx.api.post('/reviews', { bookingId: t.b.id, reviewerType: 'DRIVER_TO_CUSTOMER', overallRating: 5 }, { token: t.d.token });
    expect((await ctx.api.get(`/reviews/booking/${t.b.id}`, { token: t.d.token })).body.data.length).toBe(2);
    expect((await ctx.api.get(`/reviews/${mine.id}`, { token: t.d.token })).status).toBe(200);
    expect((await prismaClient.drivers.findUnique({ where: { id: t.d.driverId } }))!.rating).toBe(2);
  });

  test('CR-02: a review waiting 48 hours for the other side is released and counted', async () => {
    if (!(await setup())) return;
    const t = await trip();
    await prismaClient.bookings.update({ where: { id: t.b.id }, data: { status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED } });
    const r = (await ctx.api.post('/reviews', { bookingId: t.b.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 3 }, { token: t.p.token })).body.data;
    await prismaClient.reviews.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 49 * 3_600_000) } });
    expect((await ctx.api.get(`/reviews/${r.id}`, { token: t.d.token })).status).toBe(404);
    expect(await ReviewService.releaseDue()).toBeGreaterThanOrEqual(1);
    expect((await ctx.api.get(`/reviews/${r.id}`, { token: t.d.token })).status).toBe(200);
    expect((await prismaClient.drivers.findUnique({ where: { id: t.d.driverId } }))!.rating).toBe(3);
  });

  test('CR-03: the customer gets the driver\'s phone once confirmed; the driver never gets the customer\'s email', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const pending = (await ctx.api.get(`/bookings/${t.b.id}`, { token: t.p.token })).body.data;
    expect(pending.driver.phoneNumber).toBe(null);
    expect((await ctx.api.patch(`/bookings/${t.b.id}/status`, { status: 'CONFIRMED' }, { token: t.d.token })).status).toBe(200);
    const confirmed = (await ctx.api.get(`/bookings/${t.b.id}`, { token: t.p.token })).body.data;
    expect(confirmed.driver.phoneNumber).toBe(t.d.phone);
    expect(confirmed.driver.fullName.startsWith('CR Driver')).toBe(true);
    expect('user' in confirmed.driver).toBe(false);
    const byDriver = (await ctx.api.get(`/bookings/${t.b.id}`, { token: t.d.token })).body.data;
    expect(byDriver.customer.phoneNumber.startsWith('+20')).toBe(true);
    expect(byDriver.customer.email).toBe(undefined);
    expect(byDriver.driver.phoneNumber).toBe(undefined);
    // The office sees everything.
    expect((await ctx.api.get(`/bookings/${t.b.id}`, { token: ctx.su })).body.data.customer.email.endsWith('@guest.test')).toBe(true);
  });

  test('CR-04: notification dates read like a person writes them', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const n = await prismaClient.scheduledNotifications.findFirst({ where: { bookingId: t.b.id, notificationType: 'NEW_TRIP' } });
    expect(/(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)/.test(n!.body!)).toBe(true);
    expect(n!.body!.includes('الساعة 6:00 م')).toBe(true);
    expect(/\d{4}-\d{2}-\d{2}/.test(n!.body!)).toBe(false);
  });

  test('CR-05: the driver app shows the same money, trips and rating as the dashboard', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const today = dateKey();
    // One completed trip in the past and one confirmed trip today (in progress).
    await prismaClient.bookings.update({ where: { id: t.b.id }, data: { bookingDate: addDays(today, -3), status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED } });
    const other = await prismaClient.bookings.create({ data: { customerId: t.p.id, vehicleId: t.b.vehicleId, driverId: t.d.driverId, bookingDate: today, startTime: '00:00', endTime: '00:30', startPoint: 'Hall', endPoint: 'Hotel', totalPrice: 1000, status: BookingStatus.CONFIRMED, tripStatus: TripStatus.INPROGRESS } as any });
    // One released and one unreleased review about the driver, plus his own review of the customer.
    await prismaClient.reviews.createMany({ data: [
      { bookingId: t.b.id, reviewerId: t.p.id, revieweeId: t.d.userId, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 4, visibleAt: new Date() },
      { bookingId: other.id, reviewerId: t.p.id, revieweeId: t.d.userId, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 1 },
      { bookingId: t.b.id, reviewerId: t.d.userId, revieweeId: t.p.id, reviewerType: 'DRIVER_TO_CUSTOMER', overallRating: 5, visibleAt: new Date() },
    ] as any });
    const app = (await ctx.api.get('/driver/stats', { token: t.d.token })).body.data;
    const dash = (await ctx.api.get(`/admin/drivers/${t.d.driverId}/analytics?period=month`, { token: ctx.su })).body.data.lifetime;
    expect(app.earningTrips).toBe(dash.trips);
    expect(app.totalRevenue).toBe(dash.driverIncome);
    expect(app.companyShare).toBe(dash.companyShare);
    expect(app.todayTrips).toBe(1);
    expect(app.averageRating).toBe(4);
    expect(app.reviewsCount).toBe(1);
  });

  test('CR-06: cancelling returns the booking without anyone\'s password, codes or private fields', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const r = await ctx.api.delete(`/bookings/${t.b.id}`, { token: t.p.token });
    expect(r.status).toBe(200);
    const flat = JSON.stringify(r.body);
    for (const k of ['password', 'otpCode', 'twoFactorSecret', 'tokenVersion', 'commissionRate', 'licenseNumber']) expect(flat.includes(`"${k}"`)).toBe(false);
    expect(r.body.data.status).toBe('CANCELLED');
    expect(r.body.data.driver.phoneNumber).toBe(null);
  });

  test('CR-07: the driver\'s booking list has the customer\'s name and phone, not email', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const list = (await ctx.api.get('/bookings', { token: t.d.token })).body.data;
    const mine = list.find((b: any) => b.id === t.b.id);
    expect(Object.keys(mine.customer).sort().join(',')).toBe('id,name,phoneNumber');
    expect((await ctx.api.get('/bookings', { token: ctx.su })).body.data.some((b: any) => typeof b.customer.email === 'string')).toBe(true);
  });

  test('CR-08: the response guard drops secret columns anywhere in a body', async () => {
    const { stripSecrets } = await import('../../src/v1/middlewares/strip-secrets.middleware');
    const at = new Date();
    const out: any = stripSecrets({ data: [{ id: 1, password: 'h', customer: { name: 'x', otpCode: '1', twoFactorSecret: 's', tokenVersion: 3 }, at }], temporaryPassword: 'shown-once', secret: 'qr' });
    expect(JSON.stringify(out)).toBe(JSON.stringify({ data: [{ id: 1, customer: { name: 'x' }, at }], temporaryPassword: 'shown-once', secret: 'qr' }));
    expect(out.data[0].at instanceof Date).toBe(true);
  });
});
