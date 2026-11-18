import fs from 'fs';
import path from 'path';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { DriverStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { DOCUMENTS_DIR } from '../../src/v1/services/driver-document.service';

/**
 * Driver papers: uploaded by the driver (at signup or later), stored privately,
 * opened only by the driver and the dashboard, approved or rejected with a
 * reason the driver sees.
 */
describe('Tier 2: driver documents (private upload and review)', () => {
  const ctx: any = {};
  let n = 0;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
  const PDF = Buffer.from('%PDF-1.4\n% test document\n');
  const TYPES = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'LICENSE_FRONT', 'LICENSE_BACK', 'CRIMINAL_RECORD'];

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    ctx.api = createApiClient();
    ctx.admin = generateAdminToken({ id: ctx.seed.adminUser.id, role: { id: ctx.seed.adminRole.id, name: 'ADMIN' } as any });
    return true;
  };
  const driver = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Doc Driver ${i}`, phoneNumber: `+20108770${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Doc Driver ${i}`, licenseNumber: `DOC-${i}`, status: DriverStatus.ACTIVE } } },
      include: { drivers: true, role: true },
    });
    const token = generateToken({ id: u.id, email: '', name: u.name, tokenVersion: 0, roleId: u.roleId, role: { id: u.roleId, name: 'DRIVER', permissions: [] } } as any);
    return { id: u.drivers!.id, token };
  };
  const customer = async () => {
    const u = await prismaClient.users.create({ data: { name: `Doc Guest ${++n}`, phoneNumber: `+20103330${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return generateRiderToken({ id: u.id });
  };
  const upload = (token: string, type: string, body: Buffer, mime = 'image/png', name = 'doc.png') => {
    const form = new FormData();
    form.append('type', type);
    form.append('file', new Blob([body], { type: mime }), name);
    return ctx.api.post('/driver/documents', form, { token });
  };

  test('DOC-01: a driver uploads each paper; the list shows what is uploaded and what is missing', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const empty = (await ctx.api.get('/driver/documents', { token: d.token })).body.data;
    expect(empty.documents.length).toBe(5);
    expect(empty.documents.every((x: any) => x.status === 'MISSING')).toBe(true);
    expect(empty.summary.state).toBe('MISSING');
    expect((await upload(d.token, 'NATIONAL_ID_FRONT', PNG)).status).toBe(201);
    expect((await upload(d.token, 'CRIMINAL_RECORD', PDF, 'application/pdf', 'fish.pdf')).status).toBe(201);
    const list = (await ctx.api.get('/driver/documents', { token: d.token })).body.data;
    expect(list.documents.find((x: any) => x.type === 'NATIONAL_ID_FRONT').status).toBe('PENDING');
    expect(list.documents.find((x: any) => x.type === 'CRIMINAL_RECORD').mimeType).toBe('application/pdf');
    expect(list.summary.missing).toBe(3);
  });

  test('DOC-02: a renamed file, an unknown type, a non-driver and a huge file are refused', async () => {
    if (!(await setup())) return;
    const d = await driver();
    expect((await upload(d.token, 'LICENSE_FRONT', Buffer.from('just text'))).status).toBe(400);
    expect((await upload(d.token, 'PASSPORT', PNG)).status).toBe(400);
    expect((await upload(await customer(), 'LICENSE_FRONT', PNG)).status).toBe(403);
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10)]);
    expect((await upload(d.token, 'LICENSE_FRONT', big)).status).toBe(413);
    expect(await prismaClient.driverDocuments.count({ where: { driverId: d.id } })).toBe(0);
  });

  test('DOC-03: files are private: the driver and the dashboard can open them, nobody else', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const other = await driver();
    const doc = (await upload(d.token, 'LICENSE_FRONT', PNG)).body.data;
    const row = await prismaClient.driverDocuments.findUnique({ where: { id: doc.id } });
    // Stored outside every public folder.
    expect(fs.existsSync(path.join(DOCUMENTS_DIR, row!.fileName))).toBe(true);
    expect(row!.fileName.includes('uploads')).toBe(false);
    expect((await ctx.api.get(`/uploads/${row!.fileName}`)).status).toBe(404);
    const own = await ctx.api.get(`/driver/documents/${doc.id}/file`, { token: d.token });
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect((await ctx.api.get(`/driver/documents/${doc.id}/file`, { token: other.token })).status).toBe(404);
    expect((await ctx.api.get(`/driver/documents/${doc.id}/file`)).status).toBe(401);
    expect((await ctx.api.get(`/admin/driver-documents/${doc.id}/file`, { token: await customer() })).status).toBe(403);
    expect((await ctx.api.get(`/admin/driver-documents/${doc.id}/file`, { token: ctx.admin })).status).toBe(200);
  });

  test('DOC-04: reject with a reason the driver sees; a new upload goes back to review; approve all', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const ids: Record<string, string> = {};
    for (const t of TYPES) ids[t] = (await upload(d.token, t, PNG)).body.data.id;
    expect((await ctx.api.patch(`/admin/driver-documents/${ids.LICENSE_BACK}`, { status: 'REJECTED' }, { token: ctx.admin })).status).toBe(400);
    expect((await ctx.api.patch(`/admin/driver-documents/${ids.LICENSE_BACK}`, { status: 'REJECTED', note: 'الصورة مش واضحة' }, { token: ctx.admin })).status).toBe(200);
    let mine = (await ctx.api.get('/driver/documents', { token: d.token })).body.data;
    const rejected = mine.documents.find((x: any) => x.type === 'LICENSE_BACK');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.reviewNote).toBe('الصورة مش واضحة');
    expect(mine.summary.state).toBe('REJECTED');
    const oldFile = (await prismaClient.driverDocuments.findUnique({ where: { id: ids.LICENSE_BACK } }))!.fileName;
    const again = (await upload(d.token, 'LICENSE_BACK', PDF, 'application/pdf', 'b.pdf')).body.data;
    expect(again.id).toBe(ids.LICENSE_BACK);
    expect(again.status).toBe('PENDING');
    expect(fs.existsSync(path.join(DOCUMENTS_DIR, oldFile))).toBe(false);
    for (const t of TYPES) expect((await ctx.api.patch(`/admin/driver-documents/${ids[t]}`, { status: 'APPROVED' }, { token: ctx.admin })).status).toBe(200);
    mine = (await ctx.api.get('/driver/documents', { token: d.token })).body.data;
    expect(mine.summary.state).toBe('APPROVED');
    expect((await ctx.api.get(`/admin/drivers/${d.id}/documents`, { token: ctx.admin })).body.data.summary.approved).toBe(5);
    expect(await prismaClient.auditLogs.count({ where: { entityType: 'driver_document', entityId: d.id } })).toBe(6);
  });

  test('DOC-05: signup as a driver stores the papers privately; other roles never keep them', async () => {
    if (!(await setup())) return;
    const form = (role: string, email: string, phone: string) => {
      const f = new FormData();
      f.append('name', 'Signup Driver');
      f.append('email', email);
      f.append('password', 'Driver#Pass1');
      f.append('role', role);
      f.append('phoneNumbers', JSON.stringify([{ number: phone }]));
      f.append('licenseNumber', 'LIC-777');
      f.append('licenseExpiry', '2030-01-01');
      f.append('nationalIdFront', new Blob([PNG], { type: 'image/png' }), 'id.png');
      f.append('licenseFront', new Blob([PDF], { type: 'application/pdf' }), 'lic.pdf');
      f.append('criminalRecord', new Blob([Buffer.from('fake')], { type: 'image/png' }), 'fake.png');
      return f;
    };
    const res = await ctx.api.post('/auth/signup', form('driver', 'sd@mishwark.test', '01012300901'));
    expect(res.status).toBe(201);
    const byField = Object.fromEntries(res.body.documents.map((x: any) => [x.field, x.status]));
    expect(byField).toEqual({ nationalIdFront: 'PENDING', licenseFront: 'PENDING', criminalRecord: 'FAILED' });
    const drv = await prismaClient.drivers.findFirst({ where: { user: { email: 'sd@mishwark.test' } } });
    expect(await prismaClient.driverDocuments.count({ where: { driverId: drv!.id } })).toBe(2);
    const cust = await ctx.api.post('/auth/signup', form('customer', 'sc@mishwark.test', '01012300902'));
    expect(cust.status).toBe(201);
    expect(cust.body.documents).toBe(undefined);
    // No paper left in the public uploads folder.
    const pub = path.join(process.cwd(), 'uploads', 'employees');
    expect(fs.readdirSync(pub).some((f) => /^(nationalId|license|criminal)/.test(f))).toBe(false);
  });

  test('DOC-06: the dashboard sees who has papers waiting, and each driver\'s state', async () => {
    if (!(await setup())) return;
    const d = await driver();
    await upload(d.token, 'NATIONAL_ID_FRONT', PNG);
    await upload(d.token, 'NATIONAL_ID_BACK', PNG);
    const alerts = (await ctx.api.get('/admin/overview', { token: ctx.admin })).body.data.alerts;
    const a = alerts.find((x: any) => x.type === 'documents_pending' && x.entityId === d.id);
    expect(a.documents).toBe(2);
    const summary = (await ctx.api.get('/admin/drivers-summary?limit=100', { token: ctx.admin })).body.data.find((x: any) => x.id === d.id);
    expect(summary.documents.state).toBe('MISSING');
    expect(summary.documents.pending).toBe(2);
  });
});
