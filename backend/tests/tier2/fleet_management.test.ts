import fs from 'fs';
import path from 'path';
import { describe, test, expect } from '../infra/run-all';
import prismaClient from '../../src/v1/utils/prismaClientHelper';
import { BookingStatus, DriverStatus } from '../../generated/prisma';
import { seedDatabase, resetDatabase, isDatabaseConnected } from '../infra/db-setup';
import { generateAdminToken, generateDriverToken, generateRiderToken } from '../infra/auth-helper';
import { createApiClient } from '../infra/api-client';
import { addDays, dateKey } from '../../src/v1/utils/businessTime';

/**
 * Fleet page: admins add and edit cars, pick each car's drivers, schedule
 * maintenance (blocks the days, refused on booked days), retire/reactivate,
 * and manage photos. Only the car's own drivers can drive it.
 */
describe('Tier 2: Fleet management', () => {
  const ctx: any = {};
  const HALL = { latitude: 30.0566, longitude: 31.3301, label: 'Hall' };
  const HOTEL = { latitude: 30.0911, longitude: 31.3253, label: 'Hotel' };
  const UPLOADS = path.join(process.cwd(), 'uploads', 'vehicles');
  let seq = 0;
  let plate = 0;
  let person = 0;

  const setup = async () => {
    if (ctx.ready !== undefined) return ctx.ready;
    ctx.ready = await isDatabaseConnected();
    if (!ctx.ready) return false;
    await resetDatabase();
    const seed = (ctx.seed = await seedDatabase());
    ctx.admin = generateAdminToken({ id: seed.adminUser.id, role: { id: seed.adminRole.id, name: 'ADMIN' } as any });
    ctx.api = createApiClient();
    ctx.filesBefore = new Set(fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : []);
    return true;
  };
  const grantFleet = async () => {
    const perm = await prismaClient.permission.upsert({ where: { name: 'vehicle:manage' }, update: {}, create: { name: 'vehicle:manage', description: 'Manage the fleet' } });
    await prismaClient.role.update({ where: { id: ctx.seed.adminRole.id }, data: { permissions: { connect: { id: perm.id } } } });
  };

  const day = () => addDays(dateKey(), 20 + ++seq);
  const carBody = (extra: Record<string, unknown> = {}) => ({
    make: 'Kia', model: 'K5', year: 2024, plateNumber: `FL-${++plate}`, color: 'White', capacity: 4, category: 'LUXURY',
    basePrice: 900, pricePerKm: 20, pricePerHour: 150, luggage: 2, features: ['واي فاي'], ...extra,
  });
  const newCar = async (extra: Record<string, unknown> = {}) => {
    const res = await ctx.api.post('/admin/vehicles', carBody(extra), { token: ctx.admin });
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const newDriver = async (status: DriverStatus = DriverStatus.ACTIVE) => {
    const n = ++person;
    const u = await prismaClient.users.create({
      data: {
        name: `Fleet Driver ${n}`, phoneNumber: `+20109990${String(n).padStart(4, '0')}`, roleId: ctx.seed.driverRole.id,
        drivers: { create: { fullName: `Fleet Driver ${n}`, licenseNumber: `FL-LIC-${n}`, licenseExpiry: new Date('2030-01-01'), status } },
      },
      include: { drivers: true },
    });
    return u.drivers!.id;
  };
  const customer = async () => {
    const n = ++person;
    const u = await prismaClient.users.create({ data: { name: `Fleet Guest ${n}`, phoneNumber: `+20108880${String(n).padStart(4, '0')}`, roleId: ctx.seed.riderUser.roleId } });
    return generateRiderToken({ id: u.id });
  };
  const book = async (vehicleId: string, bookingDate: string, extra: Record<string, unknown> = {}) =>
    ctx.api.post('/bookings', { vehicleId, bookingDate, startTime: '10:00', endTime: '11:00', startPoint: HALL, endPoint: HOTEL, ...extra }, { token: await customer() });
  const setDrivers = (id: string, driverIds: string[], primaryDriverId?: string) =>
    ctx.api.put(`/admin/vehicles/${id}/drivers`, { driverIds, ...(primaryDriverId && { primaryDriverId }) }, { token: ctx.admin });
  const publicIds = async () => ((await ctx.api.get('/vehicles?limit=100')).body.data as any[]).map((v) => v.id);
  const blockedDays = (vehicleId: string) => prismaClient.vehicleAvailability.count({ where: { vehicleId, status: 'BLOCKED' } });
  const photos = (files: { name: string; type: string; data: Buffer }[]) => {
    const f = new FormData();
    files.forEach((x) => f.append('images', new Blob([new Uint8Array(x.data)], { type: x.type }), x.name));
    return f;
  };
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const png = (name = 'car.png') => ({ name, type: 'image/png', data: PNG });

  test('FLEET-01: changing the fleet needs vehicle:manage; drivers can no longer pick cars', async () => {
    if (!(await setup())) return;
    expect((await ctx.api.post('/admin/vehicles', carBody(), { token: ctx.admin })).status).toBe(403);
    expect((await ctx.api.get('/admin/vehicles', { token: ctx.admin })).status).toBe(200);
    await grantFleet();
    expect((await ctx.api.post('/admin/vehicles', carBody(), { token: ctx.admin })).status).toBe(201);

    const driver = generateDriverToken({ id: ctx.seed.driverUser.id });
    expect((await ctx.api.post('/driver/vehicles', { vehicleId: ctx.seed.vehicle.id }, { token: driver })).status).toBe(403);
    expect((await ctx.api.delete(`/driver/vehicles/${ctx.seed.vehicle.id}`, { token: driver })).status).toBe(403);
  });

  test('FLEET-02: add/edit a car — validation, unique plate, the old status field is gone', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar({ features: ['واي فاي', 'واي فاي', 'شاحن لاسلكي'], luggage: 3 });
    expect(car.features).toEqual(['واي فاي', 'شاحن لاسلكي']);
    expect(car.luggage).toBe(3);

    const dup = await ctx.api.post('/admin/vehicles', carBody({ plateNumber: car.plateNumber }), { token: ctx.admin });
    expect(dup.status).toBe(409);
    expect((await ctx.api.post('/admin/vehicles', carBody({ capacity: 0 }), { token: ctx.admin })).status).toBe(422);
    expect((await ctx.api.post('/admin/vehicles', carBody({ status: 'MAINTENANCE' }), { token: ctx.admin })).status).toBe(422);

    const other = await newCar();
    expect((await ctx.api.patch(`/admin/vehicles/${other.id}`, { plateNumber: car.plateNumber }, { token: ctx.admin })).status).toBe(409);
    expect((await ctx.api.patch(`/admin/vehicles/${other.id}`, { status: 'AVAILABLE' }, { token: ctx.admin })).status).toBe(422);
    expect((await ctx.api.patch(`/admin/vehicles/${other.id}`, {}, { token: ctx.admin })).status).toBe(422);
    const upd = await ctx.api.patch(`/admin/vehicles/${other.id}`, { basePrice: 0, luggage: 5 }, { token: ctx.admin });
    expect(upd.status).toBe(200);
    const detail = (await ctx.api.get(`/admin/vehicles/${other.id}`, { token: ctx.admin })).body.data;
    expect(detail.luggage).toBe(5);
    const row = (await ctx.api.get('/admin/vehicles', { token: ctx.admin })).body.data.find((v: any) => v.id === other.id);
    expect(row.effectiveBasePrice).toBe(detail.typePrices.basePrice);
    expect((await ctx.api.get('/admin/vehicles/00000000-0000-0000-0000-000000000000', { token: ctx.admin })).status).toBe(404);
  });

  test('FLEET-03: a car without drivers is hidden from the app and flagged; assigning drivers shows it', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar();
    expect((await publicIds()).includes(car.id)).toBe(false);
    const list = (await ctx.api.get('/admin/vehicles', { token: ctx.admin })).body;
    expect(list.summary.withoutDriver).toBeGreaterThanOrEqual(1);
    const alerts = (await ctx.api.get('/admin/overview', { token: ctx.admin })).body.data?.alerts ?? [];
    expect(alerts.some((a: any) => a.type === 'no_driver' && a.entityId === car.id)).toBe(true);
    expect((await book(car.id, day())).status).toBe(400);

    const d1 = await newDriver();
    const outsider = await newDriver();
    expect((await setDrivers(car.id, [d1], outsider)).status).toBeGreaterThanOrEqual(400);
    expect((await setDrivers(car.id, [d1])).status).toBe(200);
    expect((await publicIds()).includes(car.id)).toBe(true);
    const assignable = (await ctx.api.get(`/admin/drivers-assignable?vehicleId=${car.id}`, { token: ctx.admin })).body.data;
    expect(assignable.map((d: any) => d.id)).toEqual([d1]);
  });

  test('FLEET-04: only the car\'s drivers drive it — main driver first, busy/off skipped, none free → refused', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar();
    const main = await newDriver();
    const second = await newDriver();
    const outsider = await newDriver();
    expect((await setDrivers(car.id, [second, main], main)).status).toBe(200);
    const date = day();

    const b1 = await book(car.id, date);
    expect(b1.status).toBe(201);
    expect(b1.body.data.driverId).toBe(main);
    expect((await book(car.id, date, { driverId: outsider, startTime: '15:00', endTime: '16:00' })).status).toBe(400);

    // Same car, same time is a clash for the car itself; a second car shares the drivers.
    const car2 = await newCar();
    expect((await setDrivers(car2.id, [main, second], main)).status).toBe(200);
    const b2 = await book(car2.id, date);
    expect(b2.status).toBe(201);
    expect(b2.body.data.driverId).toBe(second);
    const car3 = await newCar();
    expect((await setDrivers(car3.id, [main, second], main)).status).toBe(200);
    expect((await book(car3.id, date)).status).toBe(409);

    await prismaClient.drivers.update({ where: { id: main }, data: { status: DriverStatus.ONLEAVE } });
    const b3 = await book(car.id, day());
    expect(b3.status).toBe(201);
    expect(b3.body.data.driverId).toBe(second);
    await prismaClient.drivers.update({ where: { id: main }, data: { status: DriverStatus.ACTIVE } });
  });

  test('FLEET-05: maintenance blocks its days, is refused on booked days, and frees the days when done or cancelled', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar();
    expect((await setDrivers(car.id, [await newDriver()])).status).toBe(200);
    const bookedDay = day();
    const b = await book(car.id, bookedDay);
    expect(b.status).toBe(201);

    const clash = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Brakes', startDate: bookedDay, endDate: bookedDay, cost: 0 }, { token: ctx.admin });
    expect(clash.status).toBe(409);
    expect(clash.body.errors.bookings.map((x: any) => x.id)).toContain(b.body.data.id);

    // A trip that already finished doesn't block the day.
    await prismaClient.bookings.update({ where: { id: b.body.data.id }, data: { status: BookingStatus.COMPLETED } });
    const afterTrip = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Brakes', startDate: bookedDay, cost: 0 }, { token: ctx.admin });
    expect(afterTrip.status).toBe(201);
    expect((await ctx.api.delete(`/admin/maintenance/${afterTrip.body.data.id}`, { token: ctx.admin })).status).toBe(200);

    const past = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Oil', startDate: addDays(dateKey(), -1), cost: 0 }, { token: ctx.admin });
    expect(past.status).toBeGreaterThanOrEqual(400);
    expect(past.status).toBeLessThan(500);

    const start = day();
    const end = addDays(start, 1);
    seq += 1; // day() must not hand out `end` again
    const m = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Service', startDate: start, endDate: end, cost: 500 }, { token: ctx.admin });
    expect(m.status).toBe(201);
    expect(await blockedDays(car.id)).toBe(2);
    expect((await book(car.id, end)).status).toBe(400);
    const overlap = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Tyres', startDate: end, cost: 0 }, { token: ctx.admin });
    expect(overlap.status).toBe(409);

    expect((await ctx.api.patch(`/admin/maintenance/${m.body.data.id}/complete`, {}, { token: ctx.admin })).status).toBe(200);
    expect(await blockedDays(car.id)).toBe(0);
    expect((await book(car.id, end)).status).toBe(201);

    const m2 = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Wash', startDate: day(), cost: 0 }, { token: ctx.admin });
    expect(m2.status).toBe(201);
    expect(await blockedDays(car.id)).toBe(1);
    expect((await ctx.api.delete(`/admin/maintenance/${m2.body.data.id}`, { token: ctx.admin })).status).toBe(200);
    expect(await blockedDays(car.id)).toBe(0);

    // Maintenance starting today shows as the car's status.
    const today = await ctx.api.post(`/admin/vehicles/${car.id}/maintenance`, { maintenanceType: 'Check', startDate: dateKey(), cost: 0 }, { token: ctx.admin });
    expect(today.status).toBe(201);
    const row = (await ctx.api.get('/admin/vehicles', { token: ctx.admin })).body.data.find((v: any) => v.id === car.id);
    expect(row.status).toBe('MAINTENANCE');
  });

  test('FLEET-06: retiring is refused while bookings are upcoming; a retired car is hidden and unbookable until reactivated', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar();
    expect((await setDrivers(car.id, [await newDriver()])).status).toBe(200);
    const b = await book(car.id, day());
    expect(b.status).toBe(201);

    const refused = await ctx.api.post(`/admin/vehicles/${car.id}/retire`, { reason: 'Sold' }, { token: ctx.admin });
    expect(refused.status).toBe(409);
    expect(refused.body.errors.bookings.map((x: any) => x.id)).toContain(b.body.data.id);

    // Finished trips don't count as upcoming either.
    await prismaClient.bookings.update({ where: { id: b.body.data.id }, data: { status: BookingStatus.COMPLETED } });
    expect((await ctx.api.post(`/admin/vehicles/${car.id}/retire`, { reason: 'Sold' }, { token: ctx.admin })).status).toBe(200);
    expect((await publicIds()).includes(car.id)).toBe(false);
    expect((await ctx.api.get(`/vehicles/${car.id}`)).status).toBe(404);
    expect((await book(car.id, day())).status).toBe(400);
    const row = (await ctx.api.get('/admin/vehicles', { token: ctx.admin })).body.data.find((v: any) => v.id === car.id);
    expect(row.status).toBe('RETIRED');

    expect((await ctx.api.post(`/admin/vehicles/${car.id}/reactivate`, {}, { token: ctx.admin })).status).toBe(200);
    expect((await publicIds()).includes(car.id)).toBe(true);
    expect((await book(car.id, day())).status).toBe(201);
  });

  test('FLEET-07: photos — real images only, 5 MB and 12-photo limits, cover first in the app', async () => {
    if (!(await setup())) return;
    await grantFleet();
    const car = await newCar();
    expect((await setDrivers(car.id, [await newDriver()])).status).toBe(200);
    const url = `/admin/vehicles/${car.id}/images`;
    const filesNow = () => fs.readdirSync(UPLOADS).length;

    const up = await ctx.api.post(url, photos([png('a.png'), { name: 'b.jpg', type: 'image/jpeg', data: JPG }]), { token: ctx.admin });
    expect(up.status).toBe(201);
    expect(up.body.data.length).toBe(2);
    expect(up.body.data.filter((i: any) => i.isCover).length).toBe(1);

    // A text file renamed .jpg is refused and nothing stays on disk.
    const before = filesNow();
    const fake = await ctx.api.post(url, photos([png('ok.png'), { name: 'x.jpg', type: 'image/jpeg', data: Buffer.from('not an image at all') }]), { token: ctx.admin });
    expect(fake.status).toBe(400);
    expect(filesNow()).toBe(before);
    expect((await ctx.api.post(url, photos([{ name: 'x.gif', type: 'image/gif', data: PNG }]), { token: ctx.admin })).status).toBe(400);
    const big = await ctx.api.post(url, photos([{ name: 'big.jpg', type: 'image/jpeg', data: Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]) }]), { token: ctx.admin });
    expect(big.status).toBe(413);

    // Cover moves; the app lists the cover first.
    const second = up.body.data.find((i: any) => !i.isCover);
    expect((await ctx.api.patch(`${url}/${second.id}/cover`, {}, { token: ctx.admin })).status).toBe(200);
    const pub = (await ctx.api.get(`/vehicles/${car.id}`)).body.data;
    expect(pub.images[0].id).toBe(second.id);
    expect(pub.features).toEqual(['واي فاي']);

    // Deleting the cover promotes another photo.
    expect((await ctx.api.delete(`${url}/${second.id}`, { token: ctx.admin })).status).toBe(200);
    const left = await prismaClient.vehicleImages.findMany({ where: { vehicleId: car.id } });
    expect(left.length).toBe(1);
    expect(left[0].isCover).toBe(true);

    expect((await ctx.api.post(url, photos(Array.from({ length: 8 }, (_, i) => png(`p${i}.png`))), { token: ctx.admin })).status).toBe(201);
    expect((await ctx.api.post(url, photos([png('p8.png'), png('p9.png'), png('p10.png')]), { token: ctx.admin })).status).toBe(201);
    expect((await ctx.api.post(url, photos([png('p11.png')]), { token: ctx.admin })).status).toBe(400);
    expect(await prismaClient.vehicleImages.count({ where: { vehicleId: car.id } })).toBe(12);

    // Clean up the files this test wrote.
    for (const f of fs.readdirSync(UPLOADS)) if (!ctx.filesBefore.has(f)) fs.rmSync(path.join(UPLOADS, f), { force: true });
  });
});
