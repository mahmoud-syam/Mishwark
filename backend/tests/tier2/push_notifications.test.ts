import http from 'http';
import { generateKeyPairSync } from 'crypto';
import { hashSync } from 'bcrypt';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { DriverStatus, NotificationStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateRiderToken, generateToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey, zonedToInstant } from '../../src/v1/utils/businessTime';
import PushService from '../../src/v1/services/push.service';
import Notify from '../../src/v1/services/notify.service';

/**
 * Push notifications: phones register their Firebase token; booking, trip,
 * payment and paper events reach the right person (inbox + push); reminders
 * go out at Cairo time; dead tokens are dropped. Runs against a fake FCM.
 */
describe('Tier 2: push notifications', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  const sent: { token: string; title: string; body: string; data: Record<string, string> }[] = [];
  let n = 0;
  let seq = 0;

  const fakeFcm = () =>
    new Promise<http.Server>((resolve) => {
      const srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }));
          if (req.url?.endsWith('/messages:send')) {
            if (req.headers.authorization !== 'Bearer fake-access') { res.statusCode = 401; return res.end('{}'); }
            const m = JSON.parse(body).message;
            if (m.token.startsWith('dead-')) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
            }
            sent.push({ token: m.token, title: m.notification.title, body: m.notification.body, data: m.data });
            return res.end(JSON.stringify({ name: 'projects/p/messages/1' }));
          }
          res.statusCode = 404;
          res.end('{}');
        });
      });
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    ctx.seed = await seedDatabase();
    const superRole = await prismaClient.role.create({ data: { name: 'SUPER_ADMIN', description: 'Super Admin' } });
    const su = await prismaClient.users.create({ data: { name: 'Owner', email: 'owner-push@mishwark.test', phoneNumber: '+201099990088', password: hashSync('Owner#Pass1', 4), roleId: superRole.id } });
    ctx.su = generateToken({ id: su.id, email: su.email!, name: su.name, tokenVersion: 0, roleId: superRole.id, role: { id: superRole.id, name: 'SUPER_ADMIN', permissions: [] } } as any);
    ctx.api = createApiClient();
    ctx.srv = await fakeFcm();
    const port = (ctx.srv.address() as any).port;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    PushService.configureForTests({ account: { project_id: 'p', client_email: 'push@p.iam.gserviceaccount.com', private_key: privateKey, token_uri: `http://127.0.0.1:${port}/token` }, apiUrl: `http://127.0.0.1:${port}` });
    return true;
  };
  const driver = async () => {
    const i = ++n;
    const u = await prismaClient.users.create({
      data: { name: `Push Driver ${i}`, phoneNumber: `+20108660${String(i).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id, drivers: { create: { fullName: `Push Driver ${i}`, licenseNumber: `PUSH-${i}`, status: DriverStatus.ACTIVE } } },
      include: { drivers: true },
    });
    const token = generateToken({ id: u.id, email: '', name: u.name, tokenVersion: 0, roleId: u.roleId, role: { id: u.roleId, name: 'DRIVER', permissions: [] } } as any);
    return { driverId: u.drivers!.id, userId: u.id, token };
  };
  const car = async (driverId: string) => {
    const c = (await ctx.api.post('/admin/vehicles', { make: 'Kia', model: 'K5', year: 2024, plateNumber: `PUSH-${++n}`, capacity: 4, category: 'LUXURY' }, { token: ctx.su })).body.data;
    expect((await ctx.api.put(`/admin/vehicles/${c.id}/drivers`, { driverIds: [driverId] }, { token: ctx.su })).status).toBe(200);
    return c.id as string;
  };
  const customer = async (lang = 'ar') => {
    const u = await prismaClient.users.create({ data: { name: `Push Guest ${++n}`, phoneNumber: `+20105770${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId, preferredLanguage: lang } });
    return { id: u.id, token: generateRiderToken({ id: u.id }) };
  };
  const device = (who: { token: string }, token: string, platform = 'android') => ctx.api.post('/devices', { token, platform, appVersion: '1.0.0' }, { token: who.token });
  const pushesTo = (token: string) => sent.filter((s) => s.token === token);
  const trip = async (lang = 'ar') => {
    const d = await driver();
    const c = await car(d.driverId);
    const p = await customer(lang);
    const tag = `${++seq}`.padStart(4, '0');
    const ptok = `cust-${tag}-` + 'x'.repeat(30);
    const dtok = `drv-${tag}-` + 'y'.repeat(30);
    expect((await device(p, ptok)).status).toBe(201);
    expect((await device(d, dtok, 'ios')).status).toBe(201);
    const date = addDays(dateKey(), 10 + seq * 2);
    const b = (await ctx.api.post('/bookings', { vehicleId: c, bookingDate: date, startTime: '18:00', endTime: '20:00', startPoint: HALL, endPoint: HOTEL }, { token: p.token })).body.data;
    await Notify.idle();
    return { d, c, p, b, ptok, dtok, date };
  };

  test('PUSH-01: phones register, move to the account that signs in, and can be removed', async () => {
    if (!(await setup())) return;
    const a = await customer();
    const b = await customer();
    const tok = 'shared-phone-' + 'z'.repeat(40);
    expect((await device(a, tok)).status).toBe(201);
    expect((await device(a, 'short', 'android')).status).toBe(422);
    expect((await device(a, tok + '1', 'symbian')).status).toBe(422);
    expect((await ctx.api.post('/devices', { token: tok, platform: 'ios' })).status).toBe(401);
    expect((await device(b, tok)).status).toBe(201);
    expect((await prismaClient.deviceTokens.findUnique({ where: { token: tok } }))!.userId).toBe(b.id);
    const list = (await ctx.api.get('/devices', { token: b.token })).body.data;
    expect(list.length).toBe(1);
    expect(list[0].token).toBe(undefined);
    expect((await ctx.api.delete(`/devices?token=${tok}`, { token: a.token })).body.data.removed).toBe(0);
    expect((await ctx.api.delete('/devices', { token: b.token, body: { token: tok } })).body.data.removed).toBe(1);
  });

  test('PUSH-02: a new booking reaches its driver; confirming it reaches the customer, with reminders at Cairo time', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const neu = pushesTo(t.dtok).find((s) => s.data.type === 'NEW_TRIP');
    expect(!!neu).toBe(true);
    expect(neu!.data.bookingId).toBe(t.b.id);
    expect(neu!.body.includes('MW-')).toBe(true);
    expect((await ctx.api.patch(`/bookings/${t.b.id}/status`, { status: 'CONFIRMED' }, { token: t.d.token })).status).toBe(200);
    await Notify.idle();
    const ok = pushesTo(t.ptok).find((s) => s.data.type === 'BOOKING_CONFIRMED');
    expect(ok!.title).toBe('حجزك اتأكد');
    const reminders = await prismaClient.scheduledNotifications.findMany({ where: { bookingId: t.b.id, notificationType: { in: ['REMINDER_24H', 'REMINDER_2H'] } } });
    expect(reminders.length).toBe(3); // customer 24h + 2h, driver 2h
    const startsAt = zonedToInstant(t.date, '18:00').getTime();
    const r24 = reminders.find((r) => r.notificationType === 'REMINDER_24H')!;
    expect(r24.scheduledAt.getTime()).toBe(startsAt - 24 * 3_600_000);
    expect(r24.status).toBe(NotificationStatus.SCHEDULED);
    // Not in the inbox before its time.
    const inbox = (await ctx.api.get('/notifications', { token: t.p.token })).body.data;
    expect(inbox.some((x: any) => x.notificationType === 'REMINDER_24H')).toBe(false);
    ctx.t2 = t;
  });

  test('PUSH-03: a due reminder is pushed once, even with two workers at the same moment', async () => {
    if (!(await setup())) return;
    const t = ctx.t2;
    const r = await prismaClient.scheduledNotifications.findFirst({ where: { bookingId: t.b.id, notificationType: 'REMINDER_24H' } });
    await prismaClient.scheduledNotifications.update({ where: { id: r!.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await Promise.all([Notify.processDue(), Notify.processDue()]);
    expect(pushesTo(t.ptok).filter((s) => s.data.notificationId === r!.id).length).toBe(1);
    expect((await prismaClient.scheduledNotifications.findUnique({ where: { id: r!.id } }))!.status).toBe(NotificationStatus.SENT);
    const inbox = (await ctx.api.get('/notifications', { token: t.p.token })).body.data;
    expect(inbox.some((x: any) => x.id === r!.id && x.read === false)).toBe(true);
  });

  test('PUSH-04: the trip itself: on the way, arrived, rate the trip', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const c = await car(d.driverId);
    const p = await customer();
    const ptok = 'trip-cust-' + 'q'.repeat(30);
    await device(p, ptok);
    const now = new Date(Date.now() + 10 * 60_000);
    const hh = (x: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(x);
    const end = new Date(now.getTime() + 60 * 60_000);
    const today = dateKey(now);
    if (dateKey(end) !== today) return; // too close to midnight for a same-day trip
    const b = (await ctx.api.post('/bookings', { vehicleId: c, bookingDate: today, startTime: hh(now), endTime: hh(end), startPoint: HALL, endPoint: HOTEL }, { token: p.token })).body.data;
    expect((await ctx.api.patch(`/bookings/${b.id}/status`, { status: 'CONFIRMED' }, { token: d.token })).status).toBe(200);
    for (const s of ['INPROGRESS', 'ARRIVED', 'COMPLETED']) expect((await ctx.api.patch(`/bookings/${b.id}/trip-status`, { tripStatus: s }, { token: d.token })).status).toBe(200);
    await Notify.idle();
    const types = pushesTo(ptok).map((s) => s.data.type);
    expect(types.includes('TRIP_STARTED') && types.includes('DRIVER_ARRIVED') && types.includes('RATE_TRIP')).toBe(true);
    // Reminders left for a finished trip are dropped.
    expect(await prismaClient.scheduledNotifications.count({ where: { bookingId: b.id, status: NotificationStatus.SCHEDULED, scheduledAt: { gt: new Date() } } })).toBe(0);
  });

  test('PUSH-05: paying the deposit: the customer hears "received + confirmed", the driver "confirmed"', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const pay = (await ctx.api.post('/payments', { bookingId: t.b.id, amount: t.b.depositRequired, paymentMethod: 'CASH' }, { token: t.p.token })).body.data;
    expect((await ctx.api.patch(`/payments/${pay.id}/status`, { status: 'SUCCESS' }, { token: ctx.su })).status).toBe(200);
    await Notify.idle();
    const cust = pushesTo(t.ptok);
    const paid = cust.find((s) => s.data.type === 'PAYMENT_RECEIVED');
    expect(paid!.body.includes('اتأكد')).toBe(true);
    expect(cust.some((s) => s.data.type === 'BOOKING_CONFIRMED')).toBe(false); // one message, not two
    expect(pushesTo(t.dtok).some((s) => s.data.type === 'BOOKING_CONFIRMED')).toBe(true);
    ctx.t5 = t;
  });

  test('PUSH-06: a customer cancels: the driver is told, the customer is not, reminders are dropped', async () => {
    if (!(await setup())) return;
    const t = ctx.t5;
    const before = pushesTo(t.ptok).length;
    expect((await ctx.api.delete(`/bookings/${t.b.id}`, { token: t.p.token })).status).toBe(200);
    expect((await ctx.api.delete(`/bookings/${t.b.id}`, { token: t.p.token })).status).toBe(200);
    await Notify.idle();
    expect(pushesTo(t.dtok).filter((s) => s.data.type === 'BOOKING_CANCELLED').length).toBe(1);
    expect(pushesTo(t.ptok).length).toBe(before);
    expect(await prismaClient.scheduledNotifications.count({ where: { bookingId: t.b.id, status: NotificationStatus.SCHEDULED } })).toBe(0);
  });

  test('PUSH-07: the office cancels: the customer hears it with the refund', async () => {
    if (!(await setup())) return;
    const t = await trip();
    const pay = (await ctx.api.post('/payments', { bookingId: t.b.id, amount: t.b.depositRequired, paymentMethod: 'CASH' }, { token: t.p.token })).body.data;
    await ctx.api.patch(`/payments/${pay.id}/status`, { status: 'SUCCESS' }, { token: ctx.su });
    expect((await ctx.api.delete(`/bookings/${t.b.id}`, { token: ctx.su, body: { refundDeposit: true } })).status).toBe(200);
    await Notify.idle();
    const c = pushesTo(t.ptok).find((s) => s.data.type === 'BOOKING_CANCELLED');
    expect(c!.body.includes('المحفظة')).toBe(true);
  });

  test('PUSH-08: English speakers get English; a dead token is removed', async () => {
    if (!(await setup())) return;
    const t = await trip('en');
    await prismaClient.deviceTokens.create({ data: { userId: t.p.id, token: 'dead-' + 'd'.repeat(40), platform: 'ANDROID' } });
    expect((await ctx.api.patch(`/bookings/${t.b.id}/status`, { status: 'CONFIRMED' }, { token: t.d.token })).status).toBe(200);
    await Notify.idle();
    expect(pushesTo(t.ptok).find((s) => s.data.type === 'BOOKING_CONFIRMED')!.title).toBe('Booking confirmed');
    expect(await prismaClient.deviceTokens.count({ where: { token: { startsWith: 'dead-' } } })).toBe(0);
  });

  test('PUSH-09: the driver hears about his papers (with the reason when rejected)', async () => {
    if (!(await setup())) return;
    const d = await driver();
    const dtok = 'papers-' + 'p'.repeat(40);
    await device(d, dtok);
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
    const form = new FormData();
    form.append('type', 'LICENSE_FRONT');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'l.png');
    const doc = (await ctx.api.post('/driver/documents', form, { token: d.token })).body.data;
    expect((await ctx.api.patch(`/admin/driver-documents/${doc.id}`, { status: 'REJECTED', note: 'الصورة مش واضحة' }, { token: ctx.su })).status).toBe(200);
    await Notify.idle();
    const r = pushesTo(dtok).find((s) => s.data.type === 'DOCUMENT_REVIEWED');
    expect(r!.body.includes('الصورة مش واضحة') && r!.body.includes('الرخصة')).toBe(true);
  });

  test('PUSH-10: inbox: unread count, read one, read all; logout forgets the phone', async () => {
    if (!(await setup())) return;
    const t = ctx.t2;
    const count = (await ctx.api.get('/notifications/unread-count', { token: t.p.token })).body.data.unreadCount;
    expect(count >= 2).toBe(true);
    const first = (await ctx.api.get('/notifications', { token: t.p.token })).body.data[0];
    const read = await ctx.api.patch(`/notifications/${first.id}/read`, {}, { token: t.p.token });
    expect(read.body.data.read).toBe(true);
    expect((await ctx.api.get('/notifications/unread-count', { token: t.p.token })).body.data.unreadCount).toBe(count - 1);
    await ctx.api.patch('/notifications/read-all', {}, { token: t.p.token });
    expect((await ctx.api.get('/notifications/unread-count', { token: t.p.token })).body.data.unreadCount).toBe(0);
    // Reminders still to come aren't marked read or counted.
    expect(await prismaClient.scheduledNotifications.count({ where: { recipientId: t.p.id, scheduledAt: { gt: new Date() }, readAt: { not: null } } })).toBe(0);
    expect((await ctx.api.post('/auth/logout', { deviceToken: t.ptok }, { token: t.p.token })).status).toBe(200);
    expect(await prismaClient.deviceTokens.count({ where: { token: t.ptok } })).toBe(0);
  });

  test('PUSH-11: with push off nothing breaks: the inbox still gets it', async () => {
    if (!(await setup())) return;
    PushService.configureForTests(null);
    try {
      const t = await trip();
      expect((await ctx.api.patch(`/bookings/${t.b.id}/status`, { status: 'CONFIRMED' }, { token: t.d.token })).status).toBe(200);
      await Notify.idle();
      expect(pushesTo(t.ptok).length).toBe(0);
      const inbox = (await ctx.api.get('/notifications', { token: t.p.token })).body.data;
      expect(inbox.some((x: any) => x.notificationType === 'BOOKING_CONFIRMED')).toBe(true);
      expect((await ctx.api.get('/admin/integrations', { token: ctx.su })).body.data.push).toBe(false);
    } finally {
      PushService.configureForTests(undefined);
      ctx.srv.close();
    }
  });
});
