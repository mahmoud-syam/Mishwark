import fs from 'fs';
import path from 'path';
import { hashSync } from 'bcrypt';
import { generate, generateSecret } from 'otplib';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey, timeKey } from '../../src/v1/utils/businessTime';

/**
 * Fixes from the 17 Nov QA review: phone formats, past start times, expired
 * licences, drivers removed or on leave with trips, retired-car estimates,
 * page-size caps, 2FA off needs a code, signup uploads.
 */
describe('Tier 2: QA review fixes', () => {
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
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner3@mishwark.test', phoneNumber: '+201099990003', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.api = createApiClient();
    return true;
  };
  const driver = async (extra: Record<string, unknown> = {}) => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Rev Driver ${i}`, phoneNumber: `+20107770${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Rev Driver ${i}`, licenseNumber: `REV-${i}`, licenseExpiry: new Date('2030-01-01'), status: DriverStatus.ACTIVE, ...extra } } },
      include: { drivers: true },
    });
    return u.drivers!.id;
  };
  const car = async (driverIds: string[]) => {
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Kia', model: 'K5', year: 2024, plateNumber: `REV-${++n}`, capacity: 4, category: 'LUXURY' }, { token: ctx.su })).body.data;
    expect((await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds }, { token: ctx.su })).status).toBe(200);
    return c.id as string;
  };
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Rev Guest ${++n}`, phoneNumber: `+20106660${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return generateRiderToken({ id: u.id });
  };
  const book = async (vehicleId: string, bookingDate: string, extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings', { vehicleId, bookingDate, startTime: '10:00', endTime: '11:00', startPoint: HALL, endPoint: HOTEL, ...extra }, { token: await customer() });
  const day = () => addDays(dateKey(), 40 + ++seq);

  test('REV-01: 010… and +2010… are the same account', async () => {
    if (!(await setup())) return;
    const a = await ctx.api.post('/auth/otp/request', { phoneNumber: '01012300099', name: 'Local Format' });
    expect(a.status).toBe(200);
    const signedA = (await ctx.api.post('/auth/otp/verify', { phoneNumber: '01012300099', code: a.body.dev_otp }, { headers: { 'X-Forwarded-For': '198.51.100.70' } })).body;
    const stored = await prismaClient.users.findUnique({ where: { id: signedA.user.id } });
    expect(stored!.phoneNumber).toBe('+201012300099');
    await prismaClient.users.update({ where: { id: signedA.user.id }, data: { otpSentAt: new Date(Date.now() - 120_000) } });
    const b = await ctx.api.post('/auth/otp/request', { phoneNumber: '+20 101 230 0099' }, { headers: { 'X-Forwarded-For': '198.51.100.71' } });
    const signedB = (await ctx.api.post('/auth/otp/verify', { phoneNumber: '00201012300099', code: b.body.dev_otp }, { headers: { 'X-Forwarded-For': '198.51.100.71' } })).body;
    expect(signedB.user.id).toBe(signedA.user.id);
  });

  test('REV-02: a start time that already passed today is refused', async () => {
    if (!(await setup())) return;
    const c = await car([await driver()]);
    const now = timeKey();
    const mins = Number(now.slice(0, 2)) * 60 + Number(now.slice(3));
    if (mins < 60) return; // just after midnight there's no "earlier today" to test
    const past = `${String(Math.floor((mins - 45) / 60)).padStart(2, '0')}:${String((mins - 45) % 60).padStart(2, '0')}`;
    const end = `${String(Math.floor((mins - 30) / 60)).padStart(2, '0')}:${String((mins - 30) % 60).padStart(2, '0')}`;
    const res = await book(c, dateKey(), { startTime: past, endTime: end });
    expect(res.status).toBe(400);
    expect(res.body.message.includes('already passed')).toBe(true);
  });

  test('REV-03: a driver whose licence has expired is skipped (and refused when chosen)', async () => {
    if (!(await setup())) return;
    const expired = await driver({ licenseExpiry: new Date('2020-01-01') });
    const ok = await driver();
    const c = await car([expired, ok]);
    const auto = await book(c, day());
    expect(auto.status).toBe(201);
    expect(auto.body.data.driverId).toBe(ok);
    const chosen = await book(c, day(), { driverId: expired });
    expect(chosen.status).toBe(400);
  });

  test('REV-04: a driver with upcoming trips on a car can\'t be removed from it until they move', async () => {
    if (!(await setup())) return;
    const d1 = await driver();
    const d2 = await driver();
    const c = await car([d1, d2]);
    const b = await book(c, day());
    expect(b.body.data.driverId).toBe(d1);
    const refused = await ctx.api.put(`/admin/vehicles/${c}/drivers`, { driverIds: [d2] }, { token: ctx.su });
    expect(refused.status).toBe(409);
    expect(refused.body.errors.bookings[0].id).toBe(b.body.data.id);
    // Removing the other driver is fine.
    expect((await ctx.api.put(`/admin/vehicles/${c}/drivers`, { driverIds: [d1] }, { token: ctx.su })).status).toBe(200);
    await prismaClient.bookings.update({ where: { id: b.body.data.id }, data: { status: BookingStatus.CANCELLED } });
    expect((await ctx.api.put(`/admin/vehicles/${c}/drivers`, { driverIds: [d2] }, { token: ctx.su })).status).toBe(200);
  });

  test('REV-05: a driver on leave who still holds trips shows as an alert on the overview', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const c = await car([d]);
    const b = await book(c, day());
    expect(b.status).toBe(201);
    expect((await ctx.api.patch(`/admin/drivers/${d}/status`, { status: 'ONLEAVE' }, { token: ctx.su })).status).toBe(200);
    const alerts = (await ctx.api.get('/admin/overview', { token: ctx.su })).body.data.alerts;
    const a = alerts.find((x: any) => x.type === 'driver_unavailable' && x.entityId === d);
    expect(a.trips).toBe(1);
    expect(a.driverStatus).toBe('ONLEAVE');
  });

  test('REV-06: no price estimate for a retired car', async () => {
    if (!(await setup())) return;
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Old', model: 'Car', year: 2020, plateNumber: `REV-${++n}`, capacity: 4, category: 'CAR' }, { token: ctx.su })).body.data;
    expect((await ctx.api.post('/bookings/estimate-price', { vehicleId: c.id, startPoint: HALL, endPoint: HOTEL })).status).toBe(200);
    expect((await ctx.api.post(`/admin/vehicles/${c.id}/retire`, {}, { token: ctx.su })).status).toBe(200);
    expect((await ctx.api.post('/bookings/estimate-price', { vehicleId: c.id, startPoint: HALL, endPoint: HOTEL })).status).toBe(400);
  });

  test('REV-07: list endpoints cap the page size at 100', async () => {
    if (!(await setup())) return;
    const res = await ctx.api.get('/bookings?limit=100000', { token: await customer() });
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  test('REV-08: turning 2FA off needs the current code; a bad secret is a 400', async () => {
    if (!(await setup())) return;
    const secret = generateSecret();
    const u = await prismaClient.users.create({ data: { name: '2FA User', email: 'tfa@mishwark.test', phoneNumber: '+201099990004', password: 'x', roleId: ctx.seed.riderUser.roleId, twoFactorEnabled: true, twoFactorSecret: secret } });
    const token = generateRiderToken({ id: u.id });
    expect((await ctx.api.post('/auth/2fa/disable', {}, { token })).status).toBe(400);
    expect((await ctx.api.post('/auth/2fa/disable', { token: '000000' }, { token })).status).toBe(400);
    expect((await ctx.api.post('/auth/2fa/verify', { token: '123456', secret: 'SHORT' }, { token })).status).toBe(400);
    expect((await ctx.api.post('/auth/2fa/disable', { token: await generate({ secret }) }, { token })).status).toBe(200);
  });

  test('REV-09: signup keeps only a real profile picture; other uploaded files are dropped', async () => {
    if (!(await setup())) return;
    const dir = path.join(process.cwd(), 'uploads', 'employees');
    fs.mkdirSync(dir, { recursive: true });
    const before = new Set(fs.readdirSync(dir));
    const form = new FormData();
    form.append('name', 'Doc Test');
    form.append('email', 'doc@mishwark.test');
    form.append('password', 'Doc#Pass123');
    form.append('phoneNumbers', JSON.stringify([{ number: '01012300077' }]));
    form.append('pic', new Blob(['not an image'], { type: 'image/png' }), 'p.png');
    form.append('ID', new Blob(['%PDF-1.4 national id'], { type: 'application/pdf' }), 'id.pdf');
    const res = await ctx.api.post('/auth/signup', form);
    expect(res.status).toBe(400);
    const left = fs.readdirSync(dir).filter((f) => !before.has(f));
    expect(left.length).toBe(0);
  });

  test('REV-10: after logout the same token stops working', async () => {
    if (!(await setup())) return;
    const r = await ctx.api.post('/auth/otp/request', { phoneNumber: '01012300055', name: 'Logout User' }, { headers: { 'X-Forwarded-For': '198.51.100.80' } });
    const v = (await ctx.api.post('/auth/otp/verify', { phoneNumber: '01012300055', code: r.body.dev_otp }, { headers: { 'X-Forwarded-For': '198.51.100.80' } })).body;
    expect((await ctx.api.get('/auth/me', { token: v.token })).status).toBe(200);
    expect((await ctx.api.post('/auth/logout', {}, { token: v.token })).status).toBe(200);
    expect((await ctx.api.get('/auth/me', { token: v.token })).status).toBe(401);
    // Logging out with a token that's already dead is still fine.
    expect((await ctx.api.post('/auth/logout', {}, { token: v.token })).status).toBe(200);
  });
});
