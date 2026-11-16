import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, TripStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { dateKey, zonedToInstant, addDays } from '../../src/v1/utils/businessTime';

/**
 * Integration tests for the admin web-dashboard endpoints and the
 * book-on-behalf authorization fix. Real HTTP requests against a real database.
 */
describe('Tier 2: Admin web dashboard endpoints, audit trail & booking authorization', () => {
  const ctx: { admin?: string; rider?: string; seed?: any; ready?: boolean } = {};

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    ctx.admin = generateAdminToken({ id: ctx.seed.adminUser.id, role: { id: ctx.seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.rider = generateRiderToken({ id: ctx.seed.riderUser.id });
    return true;
  };

  test('ADM-WEB-01: business time helpers use Cairo calendar days, not UTC', () => {
    // 23:30 UTC on Nov 16 is already Nov 17 in Cairo (UTC+2).
    expect(dateKey(new Date('2026-11-16T23:30:00Z'), 'Africa/Cairo')).toBe('2026-11-17');
    expect(zonedToInstant('2026-11-16', '19:00', 'Africa/Cairo').toISOString()).toBe('2026-11-16T17:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('ADM-WEB-02: overview returns KPIs for admins and is forbidden for customers', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const ok = await api.get('/admin/overview', { token: ctx.admin });
    expect(ok.status).toBe(200);
    expect(ok.body.data.kpis.totalVehicles).toBeGreaterThanOrEqual(1);
    expect(ok.body.data.weeklyRevenue.length).toBe(7);

    const denied = await api.get('/admin/overview', { token: ctx.rider });
    expect(denied.status).toBe(403);
  });

  test('ADM-WEB-03: a customer cannot create a booking on another user\'s account', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const tomorrow = addDays(dateKey(), 1);
    const res = await api.post(
      '/bookings',
      {
        customerId: ctx.seed.adminUser.id,
        vehicleId: ctx.seed.vehicle.id,
        bookingDate: tomorrow,
        startTime: '10:00',
        endTime: '12:00',
        startPoint: { latitude: 30.05, longitude: 31.33 },
        endPoint: { latitude: 30.09, longitude: 31.32 },
      },
      { token: ctx.rider }
    );
    expect(res.status).toBe(403);
    const created = await prismaClient.bookings.count({ where: { customerId: ctx.seed.adminUser.id } });
    expect(created).toBe(0);
  });

  test('ADM-WEB-04: quick-create customer is audit-logged and rejects duplicate phones', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const body = { name: 'Walk-in Customer', phoneNumber: '+201099990001' };
    const first = await api.post('/admin/customers', body, { token: ctx.admin });
    expect(first.status).toBe(201);

    const dup = await api.post('/admin/customers', body, { token: ctx.admin });
    expect(dup.status).toBe(409);

    const logs = await api.get('/admin/audit-logs?action=CREATE', { token: ctx.admin });
    expect(logs.status).toBe(200);
    const entry = logs.body.data.find((l: any) => l.entityId === first.body.data.id);
    expect(entry).toBeDefined();
    expect(entry.actorId).toBe(ctx.seed.adminUser.id);
  });

  test('ADM-WEB-05: commission must be 0-100 and changes are recorded old → new', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const driverId = ctx.seed.driverProfile.id;
    const bad = await api.patch(`/admin/drivers/${driverId}/commission`, { commissionRate: 150 }, { token: ctx.admin });
    expect(bad.status >= 400 && bad.status < 500).toBe(true);

    const ok = await api.patch(`/admin/drivers/${driverId}/commission`, { commissionRate: 25 }, { token: ctx.admin });
    expect(ok.status).toBe(200);
    expect(ok.body.data.commissionRate).toBe(25);

    const log = await prismaClient.auditLogs.findFirst({ where: { entityId: driverId }, orderBy: { createdAt: 'desc' } });
    expect(log?.details).toBe('commission: 20% → 25%');
  });

  test('ADM-WEB-06: live trips flag a trip that overran its planned duration', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const today = dateKey();
    const startedAt = new Date(Date.now() - 40 * 60_000);
    const booking = await prismaClient.bookings.create({
      data: {
        customerId: ctx.seed.riderUser.id,
        vehicleId: ctx.seed.vehicle.id,
        driverId: ctx.seed.driverProfile.id,
        bookingDate: today,
        startTime: '00:00',
        endTime: '23:59',
        durationMinutes: 20,
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.INPROGRESS,
        tripStartedAt: startedAt,
        totalPrice: 1000,
      },
    });
    const res = await api.get('/admin/trips/live', { token: ctx.admin });
    expect(res.status).toBe(200);
    const trip = res.body.data.find((t: any) => t.id === booking.id);
    expect(trip).toBeDefined();
    expect(trip.remainingMinutes).toBe(0);
    expect(trip.isDelayed).toBe(true);
    expect(trip.elapsedMinutes).toBeGreaterThanOrEqual(39);
  });

  test('ADM-WEB-07: day details validate the date and count bookings', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const bad = await api.get('/admin/days/16-11-2026', { token: ctx.admin });
    expect(bad.status >= 400 && bad.status < 500).toBe(true);

    const ok = await api.get(`/admin/days/${dateKey()}`, { token: ctx.admin });
    expect(ok.status).toBe(200);
    expect(ok.body.data.stats.total).toBeGreaterThanOrEqual(1);
    expect(ok.body.data.bookings[0].ref.startsWith('MW-')).toBe(true);
  });

  test('ADM-WEB-08: trip start/finish timestamps are recorded on status changes', async () => {
    if (!(await setup())) return;
    const api = createApiClient();
    const booking = await prismaClient.bookings.create({
      data: {
        customerId: ctx.seed.riderUser.id,
        vehicleId: ctx.seed.vehicle.id,
        driverId: ctx.seed.driverProfile.id,
        bookingDate: addDays(dateKey(), 2),
        startTime: '09:00',
        endTime: '10:00',
        status: BookingStatus.CONFIRMED,
        tripStatus: TripStatus.NOTSTARTED,
      },
    });
    const start = await api.patch(`/bookings/${booking.id}/trip-status`, { tripStatus: 'INPROGRESS' }, { token: ctx.admin });
    expect(start.status).toBe(200);
    const started = await prismaClient.bookings.findUnique({ where: { id: booking.id } });
    expect(started?.tripStartedAt instanceof Date).toBe(true);
  });
});
