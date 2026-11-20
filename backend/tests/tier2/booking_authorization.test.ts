import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, TripStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken, generateDriverToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';

/**
 * Regression tests for the cross-account holes found in the QA cycle:
 * a customer could read, cancel or complete someone else's booking, review
 * trips they weren't on, refund other people's payments; drivers couldn't read
 * their own chats; PATCH-cancel left the vehicle blocked.
 */
describe('Tier 2: Booking ownership, reviews, chat & payments authorization', () => {
  const ctx: any = { seq: 0 };

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    const other = await prismaClient.users.create({ data: { name: 'Other Customer', email: 'other@mishwark.test', roleId: seed.customerRole.id } });
    ctx.admin = generateAdminToken({ id: seed.adminUser.id });
    ctx.owner = generateRiderToken({ id: seed.riderUser.id });
    ctx.other = generateRiderToken({ id: other.id });
    ctx.driver = generateDriverToken({ id: seed.driverUser.id });
    return true;
  };

  const makeBooking = (over: any = {}) =>
    prismaClient.bookings.create({
      data: {
        customerId: ctx.seed.riderUser.id,
        vehicleId: ctx.seed.vehicle.id,
        driverId: ctx.seed.driverProfile.id,
        bookingDate: addDays(dateKey(), 3),
        // Unique per call: (vehicleId, bookingDate, startTime) is a unique key.
        startTime: `${String(8 + Math.floor(ctx.seq / 60)).padStart(2, '0')}:${String(ctx.seq++ % 60).padStart(2, '0')}`,
        endTime: '23:59',
        totalPrice: 1000,
        ...over,
      },
    });

  test('AUTHZ-01: another customer gets 404 on GET /bookings/:id; owner, driver and admin can read it', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking();
    expect((await api.get(`/bookings/${b.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.get(`/bookings/${b.id}`, { token: ctx.owner })).status).toBe(200);
    expect((await api.get(`/bookings/${b.id}`, { token: ctx.driver })).status).toBe(200);
    expect((await api.get(`/bookings/${b.id}`, { token: ctx.admin })).status).toBe(200);
  });

  test('AUTHZ-02: another customer cannot cancel (DELETE or PATCH) and a driver cannot cancel', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking();
    expect((await api.delete(`/bookings/${b.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.patch(`/bookings/${b.id}/status`, { status: 'CANCELLED' }, { token: ctx.other })).status).toBe(404);
    expect((await api.delete(`/bookings/${b.id}`, { token: ctx.driver })).status).toBe(403);
    const still = await prismaClient.bookings.findUnique({ where: { id: b.id } });
    expect(still?.status).toBe(BookingStatus.PENDING);
  });

  test('AUTHZ-03: a customer cannot mark their booking COMPLETED; admin can', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking({ status: BookingStatus.CONFIRMED });
    expect((await api.patch(`/bookings/${b.id}/status`, { status: 'COMPLETED' }, { token: ctx.owner })).status).toBe(403);
    expect((await api.patch(`/bookings/${b.id}/status`, { status: 'COMPLETED' }, { token: ctx.admin })).status).toBe(200);
  });

  test('AUTHZ-04: cancelling via PATCH /status releases the vehicle day like DELETE', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const date = addDays(dateKey(), 9);
    const b = await makeBooking({ bookingDate: date });
    const day = new Date(`${date}T00:00:00.000Z`);
    await prismaClient.vehicleAvailability.create({ data: { vehicleId: ctx.seed.vehicle.id, date: day, status: 'BOOKED', bookingId: b.id } });
    const res = await api.patch(`/bookings/${b.id}/status`, { status: 'CANCELLED' }, { token: ctx.owner });
    expect(res.status).toBe(200);
    const av = await prismaClient.vehicleAvailability.findUnique({ where: { vehicleId_date: { vehicleId: ctx.seed.vehicle.id, date: day } } });
    expect(av === null || av.status === 'AVAILABLE').toBe(true);
  });

  test('AUTHZ-05: only trip parties can review, and the reviewee is set by the server', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking({ status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED });
    const outsider = await api.post('/reviews', { bookingId: b.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 1 }, { token: ctx.other });
    expect(outsider.status).toBe(403);
    const wrongTarget = await api.post('/reviews', { bookingId: b.id, reviewerType: 'CUSTOMER_TO_DRIVER', revieweeId: ctx.seed.adminUser.id, overallRating: 1 }, { token: ctx.owner });
    expect(wrongTarget.status).toBe(400);
    const ok = await api.post('/reviews', { bookingId: b.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 4 }, { token: ctx.owner });
    expect(ok.status).toBe(201);
    expect(ok.body.data.revieweeId).toBe(ctx.seed.driverUser.id);
  });

  test('AUTHZ-06: the assigned driver can read the booking chat; outsiders cannot', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking();
    const conv = await api.post(`/chat/booking/${b.id}`, {}, { token: ctx.owner });
    expect(conv.status).toBe(200);
    await api.post(`/chat/${conv.body.data.id}/messages`, { content: 'hello' }, { token: ctx.owner });
    const asDriver = await api.get(`/chat/${conv.body.data.id}/messages`, { token: ctx.driver });
    expect(asDriver.status).toBe(200);
    expect(asDriver.body.data.length).toBe(1);
    expect((await api.post(`/chat/booking/${b.id}`, {}, { token: ctx.other })).status).toBe(404);
  });

  test('AUTHZ-08: packages, single reviews, referrals and waitlist entries are private', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const pkg = await prismaClient.packages.create({ data: { customerId: ctx.seed.riderUser.id, packageName: 'P', packageType: 'MULTI_CAR' } });
    expect((await api.get(`/packages/${pkg.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.patch(`/packages/${pkg.id}/cancel`, {}, { token: ctx.other })).status).toBe(404);
    expect((await api.get(`/packages/${pkg.id}`, { token: ctx.owner })).status).toBe(200);

    const b = await makeBooking({ status: BookingStatus.COMPLETED, tripStatus: TripStatus.COMPLETED });
    const rv = await prismaClient.reviews.create({ data: { bookingId: b.id, reviewerId: ctx.seed.riderUser.id, revieweeId: ctx.seed.driverUser.id, reviewerType: 'CUSTOMER_TO_DRIVER', overallRating: 4 } });
    expect((await api.get(`/reviews/${rv.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.get(`/reviews/booking/${b.id}`, { token: ctx.other })).status).toBe(404);
    // Blind review: the driver reads it once it is released, not before.
    expect((await api.get(`/reviews/${rv.id}`, { token: ctx.driver })).status).toBe(404);
    await prismaClient.reviews.update({ where: { id: rv.id }, data: { visibleAt: new Date() } });
    expect((await api.get(`/reviews/${rv.id}`, { token: ctx.driver })).status).toBe(200);

    const wl = await prismaClient.waitlist.create({ data: { customerId: ctx.seed.riderUser.id, vehicleId: ctx.seed.vehicle.id, requestedDate: addDays(dateKey(), 5), position: 1 } });
    expect((await api.get(`/waitlist/${wl.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.post(`/waitlist/${wl.id}/convert`, {}, { token: ctx.other })).status).toBe(404);
  });

  test('AUTHZ-09: admin wallet credit goes to the target user; public driver profile hides private fields', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    // Wallet writes need the wallet:manage permission (SUPER_ADMIN has it implicitly).
    await prismaClient.permission.upsert({
      where: { name: 'wallet:manage' },
      create: { name: 'wallet:manage', roles: { connect: { id: ctx.seed.adminRole.id } } },
      update: { roles: { connect: { id: ctx.seed.adminRole.id } } },
    });
    const res = await api.post('/wallet/credit', { userId: ctx.seed.riderUser.id, amount: 40, type: 'MANUAL_ADJUSTMENT' }, { token: ctx.admin });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(ctx.seed.riderUser.id);
    expect((await api.post('/wallet/credit', { amount: 40, type: 'MANUAL_ADJUSTMENT' }, { token: ctx.admin })).status).toBe(422);

    const pub = await api.get(`/driver/${ctx.seed.driverProfile.id}`);
    expect(pub.status).toBe(200);
    for (const k of ['licenseNumber', 'licenseExpiry', 'commissionRate', 'user', 'userId']) expect(k in pub.body.data).toBe(false);
  });

  test('AUTHZ-10: unexpected errors never leak internals; validation errors are 422', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const res = await api.post('/auth/verify-2fa', {});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body).includes('prisma')).toBe(false);
    expect((await api.post('/auth/login', {})).status).toBe(422);
  });

  test('AUTHZ-07: payments are private to the booking and refunds are admin-only', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const b = await makeBooking({ status: BookingStatus.CONFIRMED });
    const pay = await api.post('/payments', { bookingId: b.id, amount: 100, paymentMethod: 'CASH' }, { token: ctx.owner });
    expect(pay.status).toBe(201);
    expect((await api.get(`/payments/booking/${b.id}`, { token: ctx.other })).status).toBe(404);
    expect((await api.patch(`/payments/${pay.body.data.id}/status`, { status: 'SUCCESS' }, { token: ctx.other })).status).toBe(404);
    expect((await api.post(`/payments/${pay.body.data.id}/refund`, {}, { token: ctx.owner })).status).toBe(403);
  });
});
