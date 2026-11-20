import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { DriverStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';

/**
 * Policies decided on 18 Nov (defaults, all editable in Settings):
 * trips past midnight end by 06:00, at least 30 minutes, up to 365 days ahead;
 * cancelled 48h+ before -> deposit back to the wallet, later -> deposit kept;
 * a team member's temporary password works for 7 days.
 */
describe('Tier 2: booking rules, deposit policy, temporary passwords', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  const DEFAULTS = { maxAdvanceBookingDays: 365, minTripMinutes: 30, overnightLatestEndHour: 6, freeCancellationHours: 48, tempPasswordDays: 7, bookingBufferMinutes: 60 };
  let n = 0;
  let seq = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner4@mishwark.test', phoneNumber: '+201099990005', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.api = createApiClient();
    expect((await settings(DEFAULTS)).status).toBe(200);
    return true;
  };
  const settings = (body: Record<string, unknown>) => ctx.api.put('/admin/settings', body, { token: ctx.su });
  const driver = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Pol Driver ${i}`, phoneNumber: `+20108880${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Pol Driver ${i}`, licenseNumber: `POL-${i}`, licenseExpiry: new Date('2030-01-01'), status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    return u.drivers!.id;
  };
  const car = async (driverIds?: string[]) => {
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Kia', model: 'K5', year: 2024, plateNumber: `POL-${++n}`, capacity: 4, category: 'LUXURY' }, { token: ctx.su })).body.data;
    expect((await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds: driverIds ?? [await driver()] }, { token: ctx.su })).status).toBe(200);
    return c.id as string;
  };
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Pol Guest ${++n}`, phoneNumber: `+20105550${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return { id: u.id, token: generateRiderToken({ id: u.id }) };
  };
  const book = async (vehicleId: string, bookingDate: string, startTime: string, endTime: string, who?: { token: string }) =>
    ctx.api.post('/bookings', { vehicleId, bookingDate, startTime, endTime, startPoint: HALL, endPoint: HOTEL }, { token: (who ?? (await customer())).token });
  const day = () => addDays(dateKey(), 20 + ++seq * 3);
  const wallet = async (userId: string) =>
    (await prismaClient.walletTransactions.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount ?? 0;

  test('POL-01: a trip can run past midnight (22:00 to 01:00)', async () => {
    if (!(await setup())) return;
    const res = await book(await car(), day(), '22:00', '01:00');
    expect(res.status).toBe(201);
    expect(res.body.data.endTime).toBe('01:00');
  });

  test('POL-02: past midnight it must end by the limit in Settings', async () => {
    if (!(await setup())) return;
    const c = await car();
    const late = await book(c, day(), '22:00', '07:00');
    expect(late.status).toBe(400);
    expect(late.body.message.includes('06:00')).toBe(true);
    expect((await settings({ overnightLatestEndHour: 0 })).status).toBe(200);
    expect((await book(c, day(), '22:00', '01:00')).status).toBe(400);
    expect((await settings({ overnightLatestEndHour: 6 })).status).toBe(200);
  });

  test('POL-03: a trip past midnight blocks the car early the next morning', async () => {
    if (!(await setup())) return;
    const c = await car();
    const d = day();
    expect((await book(c, d, '22:00', '01:00')).status).toBe(201);
    // 01:00 + 60 min buffer: 01:30 the next day clashes, 02:30 is fine.
    expect((await book(c, addDays(d, 1), '01:30', '03:00')).status).toBe(409);
    expect((await book(c, addDays(d, 1), '02:30', '04:00')).status).toBe(201);
    // And the other way: an early trip next day stops a late one that would run into it.
    const c2 = await car();
    expect((await book(c2, addDays(d, 1), '00:30', '02:00')).status).toBe(201);
    expect((await book(c2, d, '23:00', '00:15')).status).toBe(409);
  });

  test('POL-04: the same driver can\'t be on two cars across midnight', async () => {
    if (!(await setup())) return;
    const shared = await driver();
    const a = await car([shared]);
    const b = await car([shared]);
    const d = day();
    expect((await book(a, d, '21:00', '02:00')).status).toBe(201);
    const clash = await book(b, addDays(d, 1), '01:00', '03:00');
    expect(clash.status).toBe(409);
  });

  test('POL-05: maintenance the next day blocks a trip that runs into it', async () => {
    if (!(await setup())) return;
    const c = await car();
    const d = day();
    expect((await ctx.api.post(`/admin/vehicles/${c}/maintenance`, { maintenanceType: 'Service', startDate: addDays(d, 1), cost: 0 }, { token: ctx.su })).status).toBe(201);
    expect((await book(c, d, '22:00', '01:00')).status).toBe(400);
    expect((await book(c, d, '18:00', '21:00')).status).toBe(201);
    // The other way: no maintenance on a morning an overnight trip runs into.
    const c2 = await car();
    expect((await book(c2, d, '22:00', '01:00')).status).toBe(201);
    const refused = await ctx.api.post(`/admin/vehicles/${c2}/maintenance`, { maintenanceType: 'Service', startDate: addDays(d, 1), cost: 0 }, { token: ctx.su });
    expect(refused.status).toBe(409);
  });

  test('POL-06: shortest trip and how far ahead come from Settings', async () => {
    if (!(await setup())) return;
    const c = await car();
    const short = await book(c, day(), '10:00', '10:10');
    expect(short.status).toBe(400);
    expect(short.body.message.includes('30 minutes')).toBe(true);
    const far = addDays(dateKey(), 400);
    expect((await book(c, far, '10:00', '12:00')).status).toBe(400);
    expect((await settings({ maxAdvanceBookingDays: 500, minTripMinutes: 0 })).status).toBe(200);
    expect((await book(c, far, '10:00', '12:00')).status).toBe(201);
    expect((await book(c, day(), '10:00', '10:10')).status).toBe(201);
    expect((await settings(DEFAULTS)).status).toBe(200);
  });

  test('POL-07: Settings refuse values out of range', async () => {
    if (!(await setup())) return;
    expect((await settings({ overnightLatestEndHour: 13 })).status).toBe(422);
    expect((await settings({ maxAdvanceBookingDays: 0 })).status).toBe(422);
    expect((await settings({ tempPasswordDays: 0 })).status).toBe(422);
    const got = (await ctx.api.get('/admin/settings', { token: ctx.su })).body.data;
    expect(JSON.stringify(got).includes('freeCancellationHours')).toBe(true);
  });

  test('POL-08: cancelled well ahead, the deposit goes back to the wallet', async () => {
    if (!(await setup())) return;
    const who = await customer();
    const b = (await book(await car(), day(), '10:00', '12:00', who)).body.data;
    await prismaClient.bookings.update({ where: { id: b.id }, data: { depositPaid: b.depositRequired } });
    const terms = (await ctx.api.get(`/bookings/${b.id}/cancellation`, { token: who.token })).body.data;
    expect(terms.refund).toBe(b.depositRequired);
    expect(terms.kept).toBe(0);
    const res = await ctx.api.delete(`/bookings/${b.id}`, { token: who.token });
    expect(res.status).toBe(200);
    expect(res.body.data.depositOutcome).toBe('REFUNDED');
    expect(res.body.data.depositRefunded).toBe(b.depositRequired);
    expect(res.body.data.cancelledAt !== null).toBe(true);
    expect(await wallet(who.id)).toBe(b.depositRequired);
  });

  test('POL-09: cancelled late, the deposit is kept; anything paid above it goes back', async () => {
    if (!(await setup())) return;
    const who = await customer();
    const b = (await book(await car(), addDays(dateKey(), 1), '20:00', '22:00', who)).body.data;
    await prismaClient.bookings.update({ where: { id: b.id }, data: { depositPaid: b.depositRequired + 100 } });
    // The customer can't overrule the policy.
    const res = await ctx.api.delete(`/bookings/${b.id}`, { token: who.token, body: { refundDeposit: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.depositOutcome).toBe('KEPT');
    expect(res.body.data.depositRefunded).toBe(100);
    expect(await wallet(who.id)).toBe(100);
  });

  test('POL-10: an admin can refund the deposit even when cancelling late', async () => {
    if (!(await setup())) return;
    const who = await customer();
    const b = (await book(await car(), addDays(dateKey(), 1), '20:00', '22:00', who)).body.data;
    await prismaClient.bookings.update({ where: { id: b.id }, data: { depositPaid: b.depositRequired } });
    const res = await ctx.api.delete(`/bookings/${b.id}`, { token: ctx.su, body: { refundDeposit: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.depositOutcome).toBe('REFUNDED');
    expect(res.body.cancellation.overridden).toBe(true);
    expect(await wallet(who.id)).toBe(b.depositRequired);
    // Cancelling again changes nothing (no second refund).
    expect((await ctx.api.delete(`/bookings/${b.id}`, { token: ctx.su, body: { refundDeposit: true } })).status).toBe(200);
    expect(await wallet(who.id)).toBe(b.depositRequired);
  });

  test('POL-11: nothing paid, nothing to settle', async () => {
    if (!(await setup())) return;
    const who = await customer();
    const b = (await book(await car(), day(), '10:00', '12:00', who)).body.data;
    const res = await ctx.api.delete(`/bookings/${b.id}`, { token: who.token });
    expect(res.body.data.depositOutcome).toBe(null);
    expect(await wallet(who.id)).toBe(0);
    // Someone else's booking: not found.
    const other = await customer();
    expect((await ctx.api.get(`/bookings/${b.id}/cancellation`, { token: other.token })).status).toBe(404);
  });

  test('POL-12: a temporary password stops working after the days in Settings', async () => {
    if (!(await setup())) return;
    const created = (await ctx.api.post('/admin/team', { name: 'Temp Admin', email: 'temp.admin@mishwark.test', role: 'ADMIN' }, { token: ctx.su })).body.data;
    expect(created.member.tempPasswordExpiresAt !== null).toBe(true);
    const days = (new Date(created.member.tempPasswordExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days > 6.9 && days <= 7).toBe(true);
    await prismaClient.users.update({ where: { id: created.member.id }, data: { tempPasswordExpiresAt: new Date(Date.now() - 60_000) } });
    const expired = await ctx.api.post('/auth/login', { email: 'temp.admin@mishwark.test', password: created.temporaryPassword }, { headers: { 'X-Forwarded-For': '198.51.100.90' } });
    expect(expired.status).toBe(403);
    expect(expired.body.message.includes('expired')).toBe(true);
    const fresh = (await ctx.api.post(`/admin/team/${created.member.id}/reset-password`, {}, { token: ctx.su })).body.data;
    const ok = await ctx.api.post('/auth/login', { email: 'temp.admin@mishwark.test', password: fresh.temporaryPassword }, { headers: { 'X-Forwarded-For': '198.51.100.90' } });
    expect(ok.status).toBe(200);
    expect(ok.body.passwordChangeRequired).toBe(true);
    // After choosing their own password the expiry no longer applies.
    expect((await ctx.api.post('/auth/set-password', { loginToken: ok.body.loginToken, newPassword: 'Mine#Pass2026' })).status).toBe(200);
    const row = await prismaClient.users.findUnique({ where: { id: created.member.id } });
    expect(row!.tempPasswordExpiresAt).toBe(null);
  });

  test('POL-13: a slot freed by a cancellation can be booked again', async () => {
    if (!(await setup())) return;
    const c = await car();
    const d = day();
    const who = await customer();
    const first = (await book(c, d, '10:00', '12:00', who)).body.data;
    expect((await ctx.api.delete(`/bookings/${first.id}`, { token: who.token })).status).toBe(200);
    const again = await book(c, d, '10:00', '12:00');
    expect(again.status).toBe(201);
  });

  test('POL-14: bookings page search finds by reference, local phone format and name; counts per status', async () => {
    if (!(await setup())) return;
    const who = await customer();
    const row = await prismaClient.users.findUnique({ where: { id: who.id } });
    const b = (await book(await car(), day(), '10:00', '12:00', who)).body.data;
    const ref = `MW-${b.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    const byRef = await ctx.api.get(`/admin/bookings/search?scope=all&q=${ref}`, { token: ctx.su });
    expect(byRef.status).toBe(200);
    expect(byRef.body.data.length).toBe(1);
    expect(byRef.body.data[0].ref).toBe(ref);
    const local = '0' + row!.phoneNumber!.slice(3); // +2010… -> 010…
    const byPhone = await ctx.api.get(`/admin/bookings/search?scope=all&q=${local}`, { token: ctx.su });
    expect(byPhone.body.data.some((x: any) => x.id === b.id)).toBe(true);
    const byName = await ctx.api.get(`/admin/bookings/search?scope=upcoming&q=${encodeURIComponent(row!.name)}`, { token: ctx.su });
    expect(byName.body.data[0].id).toBe(b.id);
    expect(byName.body.counts.PENDING).toBe(1);
    expect((await ctx.api.get(`/admin/bookings/search?scope=past&q=${ref}`, { token: ctx.su })).body.data.length).toBe(0);
    // Customers can't use it.
    expect((await ctx.api.get('/admin/bookings/search', { token: who.token })).status).toBe(403);
  });

  test('POL-15: an admin cancelling or confirming is in the audit log', async () => {
    if (!(await setup())) return;
    const b = (await book(await car(), day(), '10:00', '12:00')).body.data;
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'CONFIRMED' }, { token: ctx.su })).status).toBe(200);
    expect((await ctx.api.delete(`/bookings/${b.id}`, { token: ctx.su })).status).toBe(200);
    const logs = await prismaClient.auditLogs.findMany({ where: { entityId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.length).toBe(2);
    expect(logs[0].details.includes('PENDING → CONFIRMED')).toBe(true);
    expect(logs[1].details.includes('cancelled')).toBe(true);
  });
});
