import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus, ReviewerType } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import SettingsService from '../../src/v1/services/settings.service';

/**
 * The reviews page: every review shows who wrote it, about whom and on which
 * trip; complaints stay open until the office writes what was done.
 */
describe('Tier 2: reviews and complaints (dashboard)', () => {
  const ctx: any = {};
  let n = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    await prismaClient.systemSettings.updateMany({ data: { complaintMaxRating: 2 } });
    SettingsService.clearCache();
    ctx.api = createApiClient();
    ctx.admin = generateAdminToken({ id: ctx.seed.adminUser.id, role: { id: ctx.seed.adminRole.id, name: 'ADMIN' } as any });

    const customer = (name: string, phone: string) =>
      prismaClient.users.create({ data: { name, phoneNumber: phone, roleId: ctx.seed.riderUser.roleId } });
    ctx.mona = await customer('منى عادل', '+201055500011');
    ctx.karim = await customer('كريم فتحي', '+201055500022');
    const du = await prismaClient.users.create({
      data: { name: 'سامي السواق', phoneNumber: '+201066600033', roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: 'سامي السواق', licenseNumber: 'RV-1', status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    ctx.sami = { userId: du.id, driverId: du.drivers!.id };
    ctx.other = { userId: ctx.seed.driverUser.id, driverId: ctx.seed.driverProfile.id };
    return true;
  };

  const trip = (customerId: string, driverId: string) =>
    prismaClient.bookings.create({
      data: {
        customerId, vehicleId: ctx.seed.vehicle.id, driverId,
        bookingDate: `2026-0${1 + (n % 9)}-${String(10 + (++n % 18)).padStart(2, '0')}`, startTime: `${String(8 + (n % 10)).padStart(2, '0')}:00`, endTime: `${String(9 + (n % 10)).padStart(2, '0')}:00`,
        status: BookingStatus.COMPLETED, totalPrice: 1000,
      },
    });
  const review = async (by: string, about: string, rating: number, booking: { id: string }, type = ReviewerType.CUSTOMER_TO_DRIVER, comment?: string) =>
    prismaClient.reviews.create({ data: { bookingId: booking.id, reviewerId: by, revieweeId: about, reviewerType: type, overallRating: rating, comment } });

  test('RVW-01: a complaint shows who complained, about which driver, on which trip', async () => {
    if (!(await setup())) return;
    const b = await trip(ctx.mona.id, ctx.sami.driverId);
    ctx.c1 = await review(ctx.mona.id, ctx.sami.userId, 1, b, ReviewerType.CUSTOMER_TO_DRIVER, 'اتأخر ساعة');
    const r = await ctx.api.get('/admin/reviews?kind=complaints&state=open', { token: ctx.admin });
    expect(r.status).toBe(200);
    const row = r.body.data.find((x: any) => x.id === ctx.c1.id);
    expect(row.isComplaint).toBe(true);
    expect(row.handled).toBe(null);
    expect(row.reviewer.name).toBe('منى عادل');
    expect(row.reviewer.phone).toBe('+201055500011');
    expect(row.reviewer.driverId).toBe(null);
    expect(row.reviewee.name).toBe('سامي السواق');
    expect(row.reviewee.driverId).toBe(ctx.sami.driverId);
    expect(row.booking.id).toBe(b.id);
    expect(/^MW-[0-9A-F]{6}$/.test(row.booking.ref)).toBe(true);
    expect(row.comment).toBe('اتأخر ساعة');
    expect(r.body.counts.openComplaints >= 1).toBe(true);
  });

  test('RVW-02: the home alert names the customer and opens the complaint', async () => {
    if (!(await setup())) return;
    const o = (await ctx.api.get('/admin/overview', { token: ctx.admin })).body.data;
    const alert = o.alerts.find((a: any) => a.type === 'complaint' && a.reviewId === ctx.c1.id);
    expect(alert.customerName).toBe('منى عادل');
    expect(alert.driverName).toBe('سامي السواق');
    expect(alert.entityId).toBe(ctx.sami.driverId);
    expect(o.kpis.openComplaints).toBe(1);
  });

  test('RVW-03: marking handled needs a note; then it leaves the alerts and is audit-logged', async () => {
    if (!(await setup())) return;
    const noNote = await ctx.api.patch(`/admin/reviews/${ctx.c1.id}`, { handled: true }, { token: ctx.admin });
    expect(noNote.status).toBe(422);
    const ok = await ctx.api.patch(`/admin/reviews/${ctx.c1.id}`, { handled: true, note: 'كلمنا العميلة واعتذرنا' }, { token: ctx.admin });
    expect(ok.status).toBe(200);
    expect(ok.body.data.handled.note).toBe('كلمنا العميلة واعتذرنا');
    expect(ok.body.data.handled.by.id).toBe(ctx.seed.adminUser.id);
    const o = (await ctx.api.get('/admin/overview', { token: ctx.admin })).body.data;
    expect(o.alerts.some((a: any) => a.reviewId === ctx.c1.id)).toBe(false);
    expect(o.kpis.openComplaints).toBe(0);
    const handled = await ctx.api.get('/admin/reviews?kind=complaints&state=handled', { token: ctx.admin });
    expect(handled.body.data.some((x: any) => x.id === ctx.c1.id)).toBe(true);
    const audit = await prismaClient.auditLogs.findFirst({ where: { entityType: 'review', entityId: ctx.c1.id } });
    expect(audit!.entityLabel.includes('منى عادل')).toBe(true);
  });

  test('RVW-04: a handled complaint can be opened again', async () => {
    if (!(await setup())) return;
    const r = await ctx.api.patch(`/admin/reviews/${ctx.c1.id}`, { handled: false }, { token: ctx.admin });
    expect(r.status).toBe(200);
    expect(r.body.data.handled).toBe(null);
    const row = await prismaClient.reviews.findUnique({ where: { id: ctx.c1.id } });
    expect(row!.handledAt).toBe(null);
    expect(row!.handledById).toBe(null);
  });

  test('RVW-05: a good review or a driver rating a customer is not a complaint', async () => {
    if (!(await setup())) return;
    const b = await trip(ctx.karim.id, ctx.sami.driverId);
    const good = await review(ctx.karim.id, ctx.sami.userId, 5, b);
    const byDriver = await review(ctx.sami.userId, ctx.karim.id, 1, b, ReviewerType.DRIVER_TO_CUSTOMER, 'العميل اتأخر');
    expect((await ctx.api.patch(`/admin/reviews/${good.id}`, { handled: true, note: 'مفيش حاجة' }, { token: ctx.admin })).status).toBe(400);
    expect((await ctx.api.patch(`/admin/reviews/${byDriver.id}`, { handled: true, note: 'مفيش حاجة' }, { token: ctx.admin })).status).toBe(400);
    const open = (await ctx.api.get('/admin/reviews', { token: ctx.admin })).body.data.map((x: any) => x.id);
    expect(open.includes(good.id) || open.includes(byDriver.id)).toBe(false);
    const all = (await ctx.api.get('/admin/reviews?kind=all', { token: ctx.admin })).body.data;
    const d = all.find((x: any) => x.id === byDriver.id);
    expect(d.direction).toBe('DRIVER_TO_CUSTOMER');
    expect(d.reviewer.driverId).toBe(ctx.sami.driverId);
    expect(d.reviewee.name).toBe('كريم فتحي');
    expect(d.isComplaint).toBe(false);
    ctx.byDriver = byDriver;
  });

  test('RVW-06: filters: driver (both sides), customer, direction, rating, phone and booking ref', async () => {
    if (!(await setup())) return;
    const b = await trip(ctx.karim.id, ctx.other.driverId);
    const elsewhere = await review(ctx.karim.id, ctx.other.userId, 4, b);
    const ids = async (qs: string) => (await ctx.api.get(`/admin/reviews?kind=all&${qs}`, { token: ctx.admin })).body.data.map((x: any) => x.id);

    const sami = await ids(`driverId=${ctx.sami.driverId}`);
    expect(sami.includes(ctx.byDriver.id) && sami.includes(ctx.c1.id) && !sami.includes(elsewhere.id)).toBe(true);
    const karim = await ids(`customerId=${ctx.karim.id}`);
    expect(karim.includes(elsewhere.id) && karim.includes(ctx.byDriver.id) && !karim.includes(ctx.c1.id)).toBe(true);
    const drivers = await ids('direction=DRIVER_TO_CUSTOMER');
    expect(drivers.includes(ctx.byDriver.id) && !drivers.includes(elsewhere.id)).toBe(true);
    const fours = await ids('rating=4');
    expect(fours.includes(elsewhere.id) && !fours.includes(ctx.c1.id)).toBe(true);
    const byPhone = await ids('q=01055500011');
    expect(byPhone.includes(ctx.c1.id) && !byPhone.includes(elsewhere.id)).toBe(true);
    const ref = 'MW-' + b.id.replace(/-/g, '').slice(0, 6).toUpperCase();
    const byRef = await ids(`q=${ref}`);
    expect(byRef.length).toBe(1);
    expect(byRef[0]).toBe(elsewhere.id);
  });

  test('RVW-07: the complaint threshold comes from Settings', async () => {
    if (!(await setup())) return;
    const b = await trip(ctx.mona.id, ctx.other.driverId);
    const three = await review(ctx.mona.id, ctx.other.userId, 3, b);
    const has = async () => (await ctx.api.get('/admin/reviews?kind=complaints&state=all', { token: ctx.admin })).body.data.some((x: any) => x.id === three.id);
    expect(await has()).toBe(false);
    await prismaClient.systemSettings.updateMany({ data: { complaintMaxRating: 3 } });
    SettingsService.clearCache();
    expect(await has()).toBe(true);
    await prismaClient.systemSettings.updateMany({ data: { complaintMaxRating: 2 } });
    SettingsService.clearCache();
  });

  test('RVW-08: customers and unknown ids are refused', async () => {
    if (!(await setup())) return;
    const rider = generateRiderToken({ id: ctx.mona.id });
    expect((await ctx.api.get('/admin/reviews', { token: rider })).status).toBe(403);
    expect((await ctx.api.patch(`/admin/reviews/${ctx.c1.id}`, { handled: true, note: 'xxx' }, { token: rider })).status).toBe(403);
    expect((await ctx.api.get('/admin/reviews/00000000-0000-0000-0000-000000000000', { token: ctx.admin })).status).toBe(404);
    expect((await ctx.api.get('/admin/reviews')).status).toBe(401);
  });
});
