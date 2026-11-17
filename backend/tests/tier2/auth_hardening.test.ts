import { hashSync } from 'bcrypt';
import { generate } from 'otplib';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import SignInGuard from '../../src/v1/services/sign-in-guard.service';

/**
 * Wrong passwords and codes are limited per device AND account: after 5 the
 * device is blocked from that account for 15 minutes, while the owner on
 * another device is unaffected. A Super Admin can disable a team account.
 */
describe('Tier 2: Sign-in limits & disabled accounts', () => {
  const ctx: any = {};
  let n = 0;
  const ATTACKER = { headers: { 'X-Forwarded-For': '203.0.113.7' } };
  const OWNER = { headers: { 'X-Forwarded-For': '198.51.100.20' } };

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = (ctx.suUser = await prismaClient.users.create({
      data: { name: 'Owner', email: 'owner2@mishwark.test', phoneNumber: '+201099990002', password: hashSync('Owner#Pass1', 4), roleId: superRole.id },
    }));
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.api = createApiClient();
    return true;
  };

  /** A team member who finished first sign-in (own password + 2FA). */
  const member = async () => {
    const email = `guard${++n}@mishwark.test`;
    const created = (await ctx.api.post('/admin/team', { name: `Guard ${n}`, email, role: 'ADMIN' }, { token: ctx.su })).body.data;
    const s1 = (await ctx.api.post('/auth/login', { email, password: created.temporaryPassword }, OWNER)).body;
    const s2 = (await ctx.api.post('/auth/set-password', { loginToken: s1.loginToken, newPassword: 'Right#Pass12' }, OWNER)).body;
    const s3 = await ctx.api.post('/auth/verify-2fa-setup', { loginToken: s2.loginToken, token: await generate({ secret: s2.secret }) }, OWNER);
    expect(s3.status).toBe(200);
    return { id: created.member.id as string, email, secret: s2.secret as string, session: s3.cookies.token as string };
  };
  const login = (email: string, password: string, from = ATTACKER) => ctx.api.post('/auth/login', { email, password }, from);

  test('GUARD-01: 5 wrong passwords block that device from that account, even with the right password', async () => {
    if (!(await setup())) return;
    const m = await member();
    for (let i = 0; i < 5; i++) expect((await login(m.email, 'Wrong#Pass' + i)).status).toBe(400);
    const blocked = await login(m.email, 'Right#Pass12');
    expect(blocked.status).toBe(429);
    expect(blocked.body.errors.retryAfterSeconds).toBeGreaterThan(800);
    // The owner on their own device is not locked out.
    expect((await login(m.email, 'Right#Pass12', OWNER)).body.twoFactorRequired).toBe(true);
    // Other accounts from the blocked device still work.
    const other = await member();
    expect((await login(other.email, 'Right#Pass12')).status).toBe(200);
  });

  test('GUARD-02: a correct sign-in clears the count; unknown emails count too', async () => {
    if (!(await setup())) return;
    const m = await member();
    for (let i = 0; i < 4; i++) await login(m.email, 'Wrong#Pass' + i);
    expect((await login(m.email, 'Right#Pass12')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(m.email, 'Wrong#Again' + i)).status).toBe(400);
    expect((await login(m.email, 'Right#Pass12')).status).toBe(200);
    for (let i = 0; i < 5; i++) await login('nobody@mishwark.test', 'Whatever#1');
    expect((await login('nobody@mishwark.test', 'Whatever#1')).status).toBe(429);
  });

  test('GUARD-03: wrong 2FA codes are limited the same way', async () => {
    if (!(await setup())) return;
    const m = await member();
    const pass = (await login(m.email, 'Right#Pass12')).body.loginToken;
    for (let i = 0; i < 5; i++) expect((await ctx.api.post('/auth/verify-2fa', { loginToken: pass, token: '000000' }, ATTACKER)).status).toBe(400);
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: pass, token: await generate({ secret: m.secret }) }, ATTACKER)).status).toBe(429);
    expect((await login(m.email, 'Right#Pass12')).status).toBe(429);
    // Owner's device: fine.
    const own = (await login(m.email, 'Right#Pass12', OWNER)).body.loginToken;
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: own, token: await generate({ secret: m.secret }) }, OWNER)).status).toBe(200);
  });

  test('GUARD-04: a device failing across many accounts is blocked altogether', async () => {
    if (!(await setup())) return;
    const spray = { headers: { 'X-Forwarded-For': '192.0.2.99' } };
    for (let i = 0; i < 30; i++) await ctx.api.post('/auth/login', { email: `spray${i}@mishwark.test`, password: 'Guess#123' }, spray);
    const m = await member();
    expect((await ctx.api.post('/auth/login', { email: m.email, password: 'Right#Pass12' }, spray)).status).toBe(429);
    expect((await login(m.email, 'Right#Pass12', OWNER)).status).toBe(200);
  });

  test('GUARD-05: wrong OTP codes are limited per device and phone', async () => {
    if (!(await setup())) return;
    const phone = ctx.seed.riderUser.phoneNumber;
    await prismaClient.users.update({ where: { id: ctx.seed.riderUser.id }, data: { otpCode: '4821', otpExpiresAt: new Date(Date.now() + 5 * 60_000), otpAttempts: 0 } });
    for (let i = 0; i < 5; i++) expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: '111' + i }, ATTACKER)).status).toBe(400);
    await prismaClient.users.update({ where: { id: ctx.seed.riderUser.id }, data: { otpCode: '4821', otpAttempts: 0 } });
    expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: '4821' }, ATTACKER)).status).toBe(429);
    expect((await ctx.api.post('/auth/otp/verify', { phoneNumber: phone, code: '4821' }, OWNER)).status).toBe(200);
    SignInGuard.reset();
  });

  test('DIS-01: a disabled account is signed out and can\'t sign in until enabled again', async () => {
    if (!(await setup())) return;
    const m = await member();
    const pending = (await login(m.email, 'Right#Pass12', OWNER)).body.loginToken; // pass issued before disabling
    expect((await ctx.api.post(`/admin/team/${m.id}/disable`, {}, { token: ctx.admin })).status).toBe(403);
    const off = await ctx.api.post(`/admin/team/${m.id}/disable`, {}, { token: ctx.su });
    expect(off.status).toBe(200);
    expect(typeof off.body.data.disabledAt).toBe('string');
    expect((await ctx.api.get('/auth/me', { token: m.session })).status).toBe(401);
    const refused = await login(m.email, 'Right#Pass12', OWNER);
    expect(refused.status).toBe(403);
    expect(refused.body.message.includes('disabled')).toBe(true);
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: pending, token: await generate({ secret: m.secret }) }, OWNER)).status).toBe(400);
    // Listed last, history kept.
    const list = (await ctx.api.get('/admin/team', { token: ctx.su })).body.data;
    expect(list[list.length - 1].id).toBe(m.id);

    expect((await ctx.api.post(`/admin/team/${m.id}/enable`, {}, { token: ctx.su })).status).toBe(200);
    const back = (await login(m.email, 'Right#Pass12', OWNER)).body;
    expect(back.twoFactorRequired).toBe(true);
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: back.loginToken, token: await generate({ secret: m.secret }) }, OWNER)).status).toBe(200);
    const logs = await prismaClient.auditLogs.findMany({ where: { entityId: m.id, details: { contains: 'الحساب' } } });
    expect(logs.length).toBe(2);
  });

  test('DIS-02: you can\'t disable yourself; a Super Admin can disable another Super Admin', async () => {
    if (!(await setup())) return;
    expect((await ctx.api.post(`/admin/team/${ctx.suUser.id}/disable`, {}, { token: ctx.su })).status).toBe(400);
    const m = await member();
    expect((await ctx.api.patch(`/admin/team/${m.id}/role`, { role: 'SUPER_ADMIN' }, { token: ctx.su })).status).toBe(200);
    expect((await ctx.api.post(`/admin/team/${m.id}/disable`, {}, { token: ctx.su })).status).toBe(200);
    expect((await ctx.api.post(`/admin/team/${ctx.seed.riderUser.id}/disable`, {}, { token: ctx.su })).status).toBe(404);
  });
});
