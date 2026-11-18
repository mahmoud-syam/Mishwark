import jwt from 'jsonwebtoken';
import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { createApiClient } from '../infra/api-client';

/**
 * Easy sign-up for customers: browse without an account, sign up with the
 * phone number only when booking, give a name later. Dashboard accounts can't
 * use the SMS code (it skipped their password and 2FA).
 */
describe('Tier 2: easy sign-up and OTP for dashboard accounts', () => {
  const ctx: any = {};
  let ip = 10;
  const from = () => ({ headers: { 'X-Forwarded-For': `198.51.100.${++ip}` } });

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    ctx.api = createApiClient();
    return true;
  };
  const signIn = async (phone: string) => {
    const h = from();
    const r = await ctx.api.post('/auth/otp/request', { phoneNumber: phone }, h);
    return ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: r.body.dev_otp }, h);
  };

  test('EASY-01: the cars and a price quote need no account', async () => {
    if (!(await setup())) return;
    expect((await ctx.api.get('/vehicles')).status).toBe(200);
    const est = await ctx.api.post('/bookings/estimate-price', {
      vehicleId: ctx.seed.vehicle.id,
      startPoint: { latitude: 30.0566, longitude: 31.3301 },
      endPoint: { latitude: 30.0911, longitude: 31.3253 },
    });
    expect(est.status).toBe(200);
  });

  test('EASY-02: sign up with the phone number only; profileComplete is false until a name is given', async () => {
    if (!(await setup())) return;
    const v = await signIn('01012300301');
    expect(v.status).toBe(200);
    expect(v.body.role).toBe('CUSTOMER');
    expect(v.body.profileComplete).toBe(false);
    const me = await ctx.api.get('/auth/me', { token: v.body.token });
    expect(me.body.profileComplete).toBe(false);
    expect(me.body.phoneNumber).toBe('+201012300301');
  });

  test('EASY-03: the customer completes their details with PATCH /auth/me', async () => {
    if (!(await setup())) return;
    const v = await signIn('01012300302');
    const res = await ctx.api.patch('/auth/me', { name: 'Mona Adel', email: 'Mona@Example.com', preferredLanguage: 'en' }, { token: v.body.token });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Mona Adel');
    expect(res.body.email).toBe('mona@example.com');
    expect(res.body.profileComplete).toBe(true);
    expect((await ctx.api.get('/auth/me', { token: v.body.token })).body.preferredLanguage).toBe('en');
    // Next sign-in reports the profile as complete.
    await prismaClient.users.update({ where: { phoneNumber: '+201012300302' }, data: { otpSentAt: null } });
    expect((await signIn('01012300302')).body.profileComplete).toBe(true);
  });

  test('EASY-04: PATCH /auth/me refuses bad input, a taken email and the phone number', async () => {
    if (!(await setup())) return;
    const a = await signIn('01012300303');
    const b = await signIn('01012300304');
    expect((await ctx.api.patch('/auth/me', { email: 'taken@example.com' }, { token: a.body.token })).status).toBe(200);
    expect((await ctx.api.patch('/auth/me', { email: 'taken@example.com' }, { token: b.body.token })).status).toBe(409);
    expect((await ctx.api.patch('/auth/me', { name: 'x' }, { token: b.body.token })).status).toBe(422);
    expect((await ctx.api.patch('/auth/me', { phoneNumber: '+201099999999' }, { token: b.body.token })).status).toBe(422);
    expect((await ctx.api.patch('/auth/me', { name: 'No Token' })).status).toBe(401);
    // Clearing the email is allowed.
    expect((await ctx.api.patch('/auth/me', { email: null }, { token: a.body.token })).body.email).toBe(null);
  });

  test('EASY-05: an app session lasts 30 days (APP_SESSION_DAYS), and logout still ends it', async () => {
    if (!(await setup())) return;
    const v = await signIn('01012300305');
    const claims = jwt.decode(v.body.token) as { exp: number; iat: number };
    expect(Math.round((claims.exp - claims.iat) / 86400)).toBe(30);
    expect((await ctx.api.post('/auth/logout', {}, { token: v.body.token })).status).toBe(200);
    expect((await ctx.api.get('/auth/me', { token: v.body.token })).status).toBe(401);
  });

  test('EASY-06: a dashboard account can\'t sign in with an SMS code', async () => {
    if (!(await setup())) return;
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    await prismaClient.users.create({ data: { name: 'Owner', email: 'owner6@mishwark.test', phoneNumber: '+201099990006', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    const asked = await ctx.api.post('/auth/otp/request', { phoneNumber: '01099990006' }, from());
    expect(asked.status).toBe(403);
    expect(asked.body.dev_otp).toBe(undefined);
    // Even with a code planted in the database (or the dev bypass), verify refuses.
    await prismaClient.users.update({ where: { phoneNumber: '+201099990006' }, data: { otpCode: '4321', otpExpiresAt: new Date(Date.now() + 60_000) } });
    expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: '+201099990006', code: '4321' }, from())).status).toBe(403);
    expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: '+201099990006', code: '0000' }, from())).status).toBe(403);
    // The seeded Admin too.
    const admin = await prismaClient.users.findUnique({ where: { id: ctx.seed.adminUser.id } });
    if (admin?.phoneNumber) expect((await ctx.api.post('/auth/otp/request', { phoneNumber: admin.phoneNumber }, from())).status).toBe(403);
  });

  test('EASY-07: a dashboard account can\'t change its sign-in email from /auth/me', async () => {
    if (!(await setup())) return;
    const adminToken = (await import('../infra/auth-helper')).generateAdminToken({ id: ctx.seed.adminUser.id, role: { id: ctx.seed.adminRole.id, name: 'ADMIN' } as any });
    expect((await ctx.api.patch('/auth/me', { email: 'new@mishwark.test' }, { token: adminToken })).status).toBe(403);
    expect((await ctx.api.patch('/auth/me', { name: 'Admin Renamed' }, { token: adminToken })).status).toBe(200);
  });
});
