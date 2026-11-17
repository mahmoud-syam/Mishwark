import { hashSync } from 'bcrypt';
import { generate, generateSecret } from 'otplib';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';

/**
 * Sign-in steps are tied together by a signed loginToken (the old flow took a
 * bare userId, and 2FA setup took a caller-chosen secret: anyone knowing an
 * account id could attach their own authenticator and sign in without the
 * password). Team accounts are created and reset by a Super Admin only.
 */
describe('Tier 2: Team accounts & sign-in', () => {
  const ctx: any = {};
  let n = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = (ctx.suUser = await prismaClient.users.create({
      data: { name: 'Owner', email: 'owner@mishwark.test', phoneNumber: '+201099990001', password: hashSync('Owner#Pass1', 4), roleId: superRole.id },
    }));
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    // An admin holding user_password:manage (the old reset endpoints' permission).
    const perm = await prismaClient.permission.upsert({ where: { name: 'user_password:manage' }, update: {}, create: { name: 'user_password:manage', description: 'Reset passwords' } });
    await prismaClient.role.update({ where: { id: seed.adminRole.id }, data: { permissions: { connect: { id: perm.id } } } });
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.api = createApiClient();
    return true;
  };

  const create = async (role = 'ADMIN') => {
    const res = await ctx.api.post('/admin/team', { name: `Member ${++n}`, email: `member${n}@mishwark.test`, role }, { token: ctx.su });
    expect(res.status).toBe(201);
    return res.body.data as { member: { id: string; email: string }; temporaryPassword: string };
  };
  /** Full first sign-in: temporary password → own password → 2FA setup. Returns the session cookie and 2FA secret. */
  const firstSignIn = async (email: string, temp: string, own = 'Own#Password1') => {
    const step1 = (await ctx.api.post('/auth/login', { email, password: temp })).body;
    expect(step1.passwordChangeRequired).toBe(true);
    const step2 = (await ctx.api.post('/auth/set-password', { loginToken: step1.loginToken, newPassword: own })).body;
    expect(step2.twoFactorSetupRequired).toBe(true);
    const done = await ctx.api.post('/auth/verify-2fa-setup', { loginToken: step2.loginToken, token: await generate({ secret: step2.secret }) });
    expect(done.status).toBe(200);
    return { session: done.cookies.token as string, secret: step2.secret as string };
  };

  test('TEAM-01: only a Super Admin manages team accounts', async () => {
    if (!(await setup())) return;
    expect((await ctx.api.get('/admin/team', { token: ctx.admin })).status).toBe(403);
    expect((await ctx.api.post('/admin/team', { name: 'Someone', email: 'x@mishwark.test', role: 'ADMIN' }, { token: ctx.admin })).status).toBe(403);
    const list = await ctx.api.get('/admin/team', { token: ctx.su });
    expect(list.status).toBe(200);
    expect(list.body.data[0].role).toBe('SUPER_ADMIN');
    // Customers and drivers are not team accounts.
    expect(list.body.data.some((m: any) => m.id === ctx.seed.riderUser.id)).toBe(false);
  });

  test('TEAM-02: a new account signs in with a temporary password, picks its own, then sets up 2FA', async () => {
    if (!(await setup())) return;
    const { member, temporaryPassword } = await create();
    expect(temporaryPassword.length).toBe(14);
    expect((await ctx.api.post('/admin/team', { name: 'Again', email: member.email, role: 'ADMIN' }, { token: ctx.su })).status).toBe(409);
    expect((await ctx.api.post('/admin/team', { name: 'Bad', email: 'bad@mishwark.test', role: 'CUSTOMER' }, { token: ctx.su })).status).toBe(422);

    const step1 = (await ctx.api.post('/auth/login', { email: member.email, password: temporaryPassword })).body;
    expect(step1.passwordChangeRequired).toBe(true);
    expect(step1.secret).toBeUndefined();
    expect((await ctx.api.post('/auth/set-password', { loginToken: step1.loginToken, newPassword: temporaryPassword })).status).toBe(400);
    expect((await ctx.api.post('/auth/set-password', { loginToken: step1.loginToken, newPassword: 'short' })).status).toBe(422);
    // A pass for one step can't be used for another.
    expect((await ctx.api.post('/auth/verify-2fa-setup', { loginToken: step1.loginToken, token: '123456' })).status).toBe(400);

    const { session } = await firstSignIn(member.email, temporaryPassword);
    const me = await ctx.api.get('/auth/me', { token: session });
    expect(me.status).toBe(200);
    expect(me.body.role.name).toBe('ADMIN');
    const row = (await ctx.api.get('/admin/team', { token: ctx.su })).body.data.find((m: any) => m.id === member.id);
    expect(row.twoFactorEnabled).toBe(true);
    expect(row.mustChangePassword).toBe(false);
    expect(row.lastLoginAt === null).toBe(false);
  });

  test('TEAM-03: the old flow can no longer take over an account with just its id', async () => {
    if (!(await setup())) return;
    const victim = ctx.suUser.id;
    const evil = generateSecret();
    const takeover = await ctx.api.post('/auth/verify-2fa-setup', { userId: victim, secret: evil, token: await generate({ secret: evil }) });
    expect(takeover.status).toBe(400);
    expect(takeover.cookies.token).toBeUndefined();
    expect((await ctx.api.post('/auth/verify-2fa', { userId: victim, token: '123456' })).status).toBe(400);
    const owner = await prismaClient.users.findUnique({ where: { id: victim } });
    expect(owner!.twoFactorSecret).not.toBe(evil);

    // A forged or expired pass is refused too.
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: 'not-a-pass', token: '123456' })).status).toBe(400);
    // A session token is not a sign-in pass.
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: ctx.su, token: '123456' })).status).toBe(400);
  });

  test('TEAM-04: the 2FA secret comes from the pass, and every pass works once', async () => {
    if (!(await setup())) return;
    const { member, temporaryPassword } = await create();
    const step1 = (await ctx.api.post('/auth/login', { email: member.email, password: temporaryPassword })).body;
    const step2 = (await ctx.api.post('/auth/set-password', { loginToken: step1.loginToken, newPassword: 'Own#Password1' })).body;
    expect((await ctx.api.post('/auth/set-password', { loginToken: step1.loginToken, newPassword: 'Other#Pass12' })).status).toBe(400);

    const evil = generateSecret();
    // Sending a different secret changes nothing: the code must match the pass's secret.
    expect((await ctx.api.post('/auth/verify-2fa-setup', { loginToken: step2.loginToken, secret: evil, token: await generate({ secret: evil }) })).status).toBe(400);
    const ok = await ctx.api.post('/auth/verify-2fa-setup', { loginToken: step2.loginToken, secret: evil, token: await generate({ secret: step2.secret }) });
    expect(ok.status).toBe(200);
    const stored = await prismaClient.users.findUnique({ where: { id: member.id } });
    expect(stored!.twoFactorSecret).toBe(step2.secret);
    expect((await ctx.api.post('/auth/verify-2fa-setup', { loginToken: step2.loginToken, token: await generate({ secret: step2.secret }) })).status).toBe(400);

    // Normal sign-in: password, then code; a wrong code keeps live sessions.
    const login = (await ctx.api.post('/auth/login', { email: member.email, password: 'Own#Password1' })).body;
    expect(login.twoFactorRequired).toBe(true);
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: login.loginToken, token: '000000' })).status).toBe(400);
    expect((await ctx.api.get('/auth/me', { token: ok.cookies.token })).status).toBe(200);
    const signed = await ctx.api.post('/auth/verify-2fa', { loginToken: login.loginToken, token: await generate({ secret: step2.secret }) });
    expect(signed.status).toBe(200);
    expect(typeof signed.body.user.id).toBe('string');
    expect((await ctx.api.post('/auth/verify-2fa', { loginToken: login.loginToken, token: await generate({ secret: step2.secret }) })).status).toBe(400);
  });

  test('TEAM-05: resets — 2FA, password, role — sign the member out and are audit-logged', async () => {
    if (!(await setup())) return;
    const { member, temporaryPassword } = await create();
    let { session } = await firstSignIn(member.email, temporaryPassword);

    const r2fa = await ctx.api.post(`/admin/team/${member.id}/reset-2fa`, {}, { token: ctx.su });
    expect(r2fa.status).toBe(200);
    expect((await ctx.api.get('/auth/me', { token: session })).status).toBe(401);
    expect((await ctx.api.post('/auth/login', { email: member.email, password: 'Own#Password1' })).body.twoFactorSetupRequired).toBe(true);

    const rpw = await ctx.api.post(`/admin/team/${member.id}/reset-password`, {}, { token: ctx.su });
    expect(rpw.status).toBe(200);
    const temp2 = rpw.body.data.temporaryPassword;
    expect(temp2 === temporaryPassword).toBe(false);
    expect((await ctx.api.post('/auth/login', { email: member.email, password: 'Own#Password1' })).status).toBe(400);
    ({ session } = await firstSignIn(member.email, temp2, 'Newer#Password2'));

    const role = await ctx.api.patch(`/admin/team/${member.id}/role`, { role: 'SUPER_ADMIN' }, { token: ctx.su });
    expect(role.status).toBe(200);
    expect(role.body.data.role).toBe('SUPER_ADMIN');
    expect((await ctx.api.get('/auth/me', { token: session })).status).toBe(401);

    const logs = await prismaClient.auditLogs.findMany({ where: { entityId: member.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.length).toBe(4);
    expect(logs.map((l) => l.details).join(' | ').includes('الدور')).toBe(true);
  });

  test('TEAM-06: no acting on your own account, on customers, or on unknown ids', async () => {
    if (!(await setup())) return;
    expect((await ctx.api.post(`/admin/team/${ctx.suUser.id}/reset-2fa`, {}, { token: ctx.su })).status).toBe(400);
    expect((await ctx.api.patch(`/admin/team/${ctx.suUser.id}/role`, { role: 'ADMIN' }, { token: ctx.su })).status).toBe(400);
    expect((await ctx.api.post(`/admin/team/${ctx.seed.riderUser.id}/reset-password`, {}, { token: ctx.su })).status).toBe(404);
    expect((await ctx.api.post('/admin/team/00000000-0000-0000-0000-000000000000/reset-2fa', {}, { token: ctx.su })).status).toBe(404);
  });

  test('TEAM-07: the old reset endpoints can no longer reach a dashboard account without Super Admin', async () => {
    if (!(await setup())) return;
    // An admin with user_password:manage used to reset even the Super Admin.
    expect((await ctx.api.post(`/auth/reset-2fa/${ctx.suUser.id}`, {}, { token: ctx.admin })).status).toBe(403);
    expect((await ctx.api.put(`/auth/change-password/${ctx.suUser.id}`, { newPassword: 'Hijack#Pass1' }, { token: ctx.admin })).status).toBe(403);
    // Customers and drivers can still be helped by that permission; weak passwords are refused.
    expect((await ctx.api.put(`/auth/change-password/${ctx.seed.riderUser.id}`, { newPassword: '123' }, { token: ctx.admin })).status).toBe(422);
    expect((await ctx.api.put(`/auth/change-password/${ctx.seed.riderUser.id}`, { newPassword: 'Rider#Pass12' }, { token: ctx.admin })).status).toBe(200);
    // The Super Admin can use them on any account.
    const { member } = await create();
    expect((await ctx.api.post(`/auth/reset-2fa/${member.id}`, {}, { token: ctx.su })).status).toBe(200);
  });
});
