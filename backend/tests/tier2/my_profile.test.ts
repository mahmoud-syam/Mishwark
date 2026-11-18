import fs from 'fs';
import path from 'path';
import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { EMPLOYEE_PHOTOS_FOLDER } from '../../src/v1/middlewares/multer.middleware';

/**
 * A team member's own profile: name, photo and password, from the dashboard.
 */
describe('Tier 2: my profile (name, photo, password)', () => {
  const ctx: any = {};
  let n = 0;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
  const PASSWORD = 'Old-pass-123';

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    ctx.api = createApiClient();
    return true;
  };
  const member = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Team ${i}`, email: `team${i}@profile.test`, password: hashSync(PASSWORD, 4), roleId: ctx.seed.adminRole.id, twoFactorEnabled: true },
    });
    const token = generateAdminToken({ id: u.id, email: u.email!, tokenVersion: 0, role: { id: ctx.seed.adminRole.id } as any });
    return { id: u.id, token };
  };
  const putPhoto = (token: string, body: Buffer, mime = 'image/png', name = 'me.png') => {
    const form = new FormData();
    form.append('photo', new Blob([body], { type: mime }), name);
    return ctx.api.put('/auth/me/photo', form, { token });
  };
  const fileOf = (pic: string) => path.join(EMPLOYEE_PHOTOS_FOLDER, path.basename(pic));

  test('PROF-01: a team member changes their name; /auth/me returns it', async () => {
    if (!(await setup())) return;
    const m = await member();
    const r = await ctx.api.patch('/auth/me', { name: 'سارة أحمد' }, { token: m.token });
    expect(r.status).toBe(200);
    const me = (await ctx.api.get('/auth/me', { token: m.token })).body;
    expect(me.name).toBe('سارة أحمد');
    expect(me.pic).toBe('');
  });

  test('PROF-02: uploading a photo saves it under a random name and serves it', async () => {
    if (!(await setup())) return;
    const m = await member();
    const r = await putPhoto(m.token, PNG);
    expect(r.status).toBe(200);
    const pic = r.body.data?.pic ?? r.body.pic;
    expect(/^\/uploads\/employees\/pic-[0-9a-f-]{36}\.png$/.test(pic)).toBe(true);
    expect(fs.existsSync(fileOf(pic))).toBe(true);
    expect((await ctx.api.get('/auth/me', { token: m.token })).body.pic).toBe(pic);
    ctx.firstPic = pic;
    ctx.m2 = m;
  });

  test('PROF-03: a new photo replaces the old one and deletes its file', async () => {
    if (!(await setup())) return;
    const m = ctx.m2;
    const r = await putPhoto(m.token, PNG);
    const pic = r.body.data?.pic ?? r.body.pic;
    expect(pic).not.toBe(ctx.firstPic);
    expect(fs.existsSync(fileOf(ctx.firstPic))).toBe(false);
    expect(fs.existsSync(fileOf(pic))).toBe(true);
    const del = await ctx.api.delete('/auth/me/photo', { token: m.token });
    expect(del.status).toBe(200);
    expect(fs.existsSync(fileOf(pic))).toBe(false);
    expect((await ctx.api.get('/auth/me', { token: m.token })).body.pic).toBe('');
  });

  test('PROF-04: a fake image, a PDF or no file is refused and nothing is kept', async () => {
    if (!(await setup())) return;
    const m = await member();
    const before = fs.readdirSync(EMPLOYEE_PHOTOS_FOLDER).length;
    expect((await putPhoto(m.token, Buffer.from('not really a png'))).status).toBe(400);
    expect((await putPhoto(m.token, Buffer.from('%PDF-1.4\n'), 'application/pdf', 'x.pdf')).status).toBe(400);
    expect((await ctx.api.put('/auth/me/photo', new FormData(), { token: m.token })).status).toBe(400);
    expect(fs.readdirSync(EMPLOYEE_PHOTOS_FOLDER).length).toBe(before);
    expect((await ctx.api.get('/auth/me', { token: m.token })).body.pic).toBe('');
  });

  test('PROF-05: no token, no upload', async () => {
    if (!(await setup())) return;
    const before = fs.readdirSync(EMPLOYEE_PHOTOS_FOLDER).length;
    const form = new FormData();
    form.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
    expect((await ctx.api.put('/auth/me/photo', form)).status).toBe(401);
    expect(fs.readdirSync(EMPLOYEE_PHOTOS_FOLDER).length).toBe(before);
  });

  test('PROF-06: deleting my photo never removes a file another account uses', async () => {
    if (!(await setup())) return;
    const a = await member();
    const b = await member();
    const up = await putPhoto(a.token, PNG);
    const pic = up.body.data?.pic ?? up.body.pic;
    await prismaClient.users.update({ where: { id: b.id }, data: { pic } }); // b points at a's file
    await ctx.api.delete('/auth/me/photo', { token: b.token });
    expect(fs.existsSync(fileOf(pic))).toBe(true);
    await ctx.api.delete('/auth/me/photo', { token: a.token });
    expect(fs.existsSync(fileOf(pic))).toBe(false);
  });

  test('PROF-07: password change needs the right current password', async () => {
    if (!(await setup())) return;
    const m = await member();
    const wrong = await ctx.api.post('/auth/me/password', { currentPassword: 'nope-nope', newPassword: 'New-pass-456' }, { token: m.token });
    expect(wrong.status).toBe(400);
    const same = await ctx.api.post('/auth/me/password', { currentPassword: PASSWORD, newPassword: PASSWORD }, { token: m.token });
    expect(same.status).toBe(400);
    const short = await ctx.api.post('/auth/me/password', { currentPassword: PASSWORD, newPassword: 'short' }, { token: m.token });
    expect(short.status).toBe(422); // validation, like the rest of the API
  });

  test('PROF-08: after a password change this session continues, older tokens stop working', async () => {
    if (!(await setup())) return;
    const m = await member();
    const r = await ctx.api.post('/auth/me/password', { currentPassword: PASSWORD, newPassword: 'New-pass-456' }, { token: m.token });
    expect(r.status).toBe(200);
    const fresh = r.cookies.token;
    expect(!!fresh).toBe(true);
    expect((await ctx.api.get('/auth/me', { token: m.token })).status).toBe(401);
    expect((await ctx.api.get('/auth/me', { token: fresh })).status).toBe(200);
    const row = await prismaClient.users.findUnique({ where: { id: m.id }, select: { password: true } });
    const { compareSync } = await import('bcrypt');
    expect(compareSync('New-pass-456', row!.password)).toBe(true);
  });

  test('PROF-09: app accounts (phone sign-in) have no password to change', async () => {
    if (!(await setup())) return;
    const u = await prismaClient.users.create({ data: { name: `Rider ${++n}`, phoneNumber: `+20104440${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    const t = generateRiderToken({ id: u.id });
    const r = await ctx.api.post('/auth/me/password', { currentPassword: 'x', newPassword: 'New-pass-456' }, { token: t });
    expect(r.status).toBe(403);
  });
});
