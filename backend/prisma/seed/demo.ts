/**
 * Demo data for the admin web dashboard.
 *
 *   npm run seed          # roles, admin, base accounts (required first)
 *   npm run seed:demo     # this file: realistic fleet, drivers, customers and
 *                         # ~4 months of bookings around *today*
 *
 * Idempotent: every row it creates is tagged (phone prefix +2012000…, plate
 * suffix "·D", description "[demo]") and removed before re-seeding. Refuses to
 * run when NODE_ENV=production.
 */
import "dotenv/config";
import { priceService } from "../../src/v1/services/service-pricing.service";
import {
  AuditAction,
  AvailabilityStatus,
  BookingStatus,
  DriverStatus,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  ReferralStatus,
  ReviewerType,
  ServiceType,
  TripStatus,
  VehicleCategory,
  VehicleStatus,
  WalletTransactionType,
  PackageType,
} from "../../generated/prisma";
import prisma from "../../src/v1/utils/prismaClientHelper";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { DOCUMENTS_DIR, REQUIRED_DOCUMENTS } from "../../src/v1/services/driver-document.service";
import { addDays, dateKey, zonedToInstant } from "../../src/v1/utils/businessTime";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const DEMO_PHONE = "+2012000";
const DEMO_TAG = "[demo]";

// Deterministic PRNG so every run produces the same dataset shape.
let seed = 20261116;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const PLACES = [
  { label: "قاعة الأفراح، مدينة نصر", lat: 30.0566, lng: 31.3301 },
  { label: "فندق فيرمونت، القاهرة", lat: 30.0911, lng: 31.3253 },
  { label: "مطار القاهرة الدولي", lat: 30.1219, lng: 31.4056 },
  { label: "فندق نايل ريتز كارلتون", lat: 30.0459, lng: 31.2329 },
  { label: "فيلا التجمع الخامس", lat: 30.0074, lng: 31.4913 },
  { label: "قاعة الماسة", lat: 30.0749, lng: 31.3462 },
  { label: "شقة المهندسين", lat: 30.0566, lng: 31.2001 },
  { label: "دار الأوبرا المصرية", lat: 30.0425, lng: 31.2241 },
  { label: "نادي الجزيرة", lat: 30.0566, lng: 31.2195 },
  { label: "مدينتي", lat: 30.1066, lng: 31.6385 },
  { label: "كنيسة الكاتدرائية، العباسية", lat: 30.0726, lng: 31.2756 },
  { label: "فندق الماسة كابيتال", lat: 30.0236, lng: 31.6995 },
];
const EVENTS = ["زفة فرح 💍", "خطوبة", "استقبال مطار", "حفلة تخرج", "مناسبة VIP", "زفة فرح 💍", "زفة فرح 💍"];
const SLOTS = ["13:00", "15:00", "16:30", "17:00", "18:00", "19:00", "19:30", "20:15", "21:00"];

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const addMinutes = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

async function cleanup() {
  const users = await prisma.users.findMany({ where: { phoneNumber: { startsWith: DEMO_PHONE } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const drivers = await prisma.drivers.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const driverIds = drivers.map((d) => d.id);
  const vehicles = await prisma.vehicles.findMany({ where: { description: { startsWith: DEMO_TAG } }, select: { id: true } });
  const vehicleIds = vehicles.map((v) => v.id);
  const bookings = await prisma.bookings.findMany({
    where: { OR: [{ customerId: { in: userIds } }, { driverId: { in: driverIds } }, { vehicleId: { in: vehicleIds } }] },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  await prisma.auditLogs.deleteMany({ where: { metadata: { path: ["demo"], equals: true } } });
  await prisma.reviews.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.payments.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.referrals.deleteMany({ where: { OR: [{ referrerId: { in: userIds } }, { referredId: { in: userIds } }] } });
  await prisma.walletTransactions.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.vehicleAvailability.deleteMany({ where: { OR: [{ vehicleId: { in: vehicleIds } }, { bookingId: { in: bookingIds } }] } });
  await prisma.tripLocations.deleteMany({ where: { bookingId: { in: bookingIds } } });
  // Notifications now come from every booking, trip and paper step, also ones
  // made on demo accounts while trying the dashboard.
  await prisma.scheduledNotifications.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { recipientId: { in: userIds } }] } });
  await prisma.bookings.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.vehicleMaintenance.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.vehicleDrivers.deleteMany({ where: { OR: [{ vehicleId: { in: vehicleIds } }, { driverId: { in: driverIds } }] } });
  await prisma.vehicles.deleteMany({ where: { id: { in: vehicleIds } } });
  await prisma.phoneNumbers.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { driversId: { in: driverIds } }] } });
  await prisma.driverDocuments.deleteMany({ where: { driverId: { in: driverIds } } });
  for (const id of driverIds) fs.rmSync(path.join(DOCUMENTS_DIR, id), { recursive: true, force: true });
  await prisma.drivers.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.packages.deleteMany({ where: { customerId: { in: userIds } } });
  await prisma.users.updateMany({ where: { referredById: { in: userIds } }, data: { referredById: null } });
  await prisma.users.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  console.log("Cleaning previous demo data…");
  await cleanup();

  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  if (!roles.CUSTOMER || !roles.DRIVER) throw new Error("Run `npm run seed` first (roles missing).");
  const admin = await prisma.users.findFirst({ where: { role: { name: "SUPER_ADMIN" } } });

  const today = dateKey();
  let phoneSeq = 1000;
  const phone = () => `${DEMO_PHONE}${phoneSeq++}`;

  // ---- vehicles
  const fleetSpec: [string, string, VehicleCategory, number, number, string, number, number][] = [
    ["مرسيدس", "S-Class", VehicleCategory.LUXURY, 2024, 4, "أسود", 1800, 80],
    ["رنج روفر", "فوج", VehicleCategory.LUXURY, 2023, 5, "أبيض", 2200, 90],
    ["بي إم دبليو", "الفئة 7", VehicleCategory.LUXURY, 2024, 4, "رمادي", 2000, 85],
    ["مرسيدس", "E-Class", VehicleCategory.LUXURY, 2023, 4, "أبيض", 1400, 65],
    ["تويوتا", "هايس VIP", VehicleCategory.VAN, 2023, 10, "فضي", 1200, 50],
    ["كاديلاك", "إسكاليد", VehicleCategory.LUXURY, 2024, 6, "أسود", 2600, 95],
    ["شيفروليه", "بيل إير 1957", VehicleCategory.CLASSIC, 1957, 4, "أحمر", 2400, 70],
    ["لكزس", "LX 600", VehicleCategory.LUXURY, 2024, 6, "أسود", 2100, 85],
    ["مرسيدس", "V-Class", VehicleCategory.VAN, 2023, 7, "أسود", 1500, 60],
    ["أودي", "A8", VehicleCategory.LUXURY, 2023, 4, "كحلي", 1700, 75],
    ["رولز رويس", "جوست", VehicleCategory.LUXURY, 2022, 4, "أبيض", 4500, 140],
  ];
  const plates = ["أ ب ج", "د هـ و", "ز ح ط", "ي ك ل", "م ن س", "ع ف ص", "ق ر ش", "ت ث خ", "ذ ض ظ", "غ أ ب", "ج د ر"];
  const vehicles = [];
  for (let i = 0; i < fleetSpec.length; i++) {
    // refPrice only sets how premium the car is (its wedding / VIP price).
    const [make, model, category, year, capacity, color, refPrice] = fleetSpec[i];
    vehicles.push(
      await prisma.vehicles.create({
        data: {
          make, model, category, year, capacity, color,
          // Wedding price per car (the cheaper ones keep the default from the Pricing page).
          weddingPrice: refPrice >= 1700 ? Math.round(refPrice * 0.9 / 50) * 50 : null,
          vipPrice: refPrice >= 2000 ? Math.round(refPrice * 1.6 / 50) * 50 : null,
          plateNumber: `${plates[i]} ${123 + i * 111}·D`,
          description: `${DEMO_TAG} عربية ${category === VehicleCategory.CLASSIC ? "كلاسيك" : "لوكس"} مجهزة للمناسبات`,
          status: VehicleStatus.AVAILABLE,
          luggage: category === VehicleCategory.VAN ? 6 : capacity >= 6 ? 4 : 3,
          features:
            category === VehicleCategory.CLASSIC
              ? ["زينة فرح", "مياه مجانية"]
              : ["تكييف", "مقاعد جلد", "مياه مجانية", ...(refPrice >= 2000 ? ["واي فاي", "إضاءة أجواء"] : []), ...(capacity >= 6 ? ["شاشات خلفية"] : [])],
        },
      })
    );
  }

  // ---- private-trip destinations (from the company in Sharqia)
  for (const [name, latitude, longitude, includedKm, luxury, van, classic] of [
    ["مطار القاهرة الدولي", 30.1219, 31.4056, null, 2200, 1700, 2600],
    ["القاهرة (وسط البلد)", 30.0444, 31.2357, null, 1800, 1400, 2200],
    ["الإسكندرية", 31.2001, 29.9187, 300, 4500, 3500, 5200],
  ] as [string, number, number, number | null, number, number, number][]) {
    if (await prisma.destinations.findFirst({ where: { name } })) continue;
    await prisma.destinations.create({ data: { name, latitude, longitude, includedKm, prices: { LUXURY: luxury, VAN: van, CLASSIC: classic } } });
  }

  // ---- drivers
  const driverSpec: [string, DriverStatus, number][] = [
    ["أحمد سامي", DriverStatus.ACTIVE, 20],
    ["محمد رمضان", DriverStatus.ACTIVE, 20],
    ["عمر خالد", DriverStatus.ONLEAVE, 18],
    ["كريم حسن", DriverStatus.ACTIVE, 20],
    ["يوسف مجدي", DriverStatus.ACTIVE, 22],
    ["حسام الدين", DriverStatus.ACTIVE, 20],
  ];
  const drivers = [];
  for (const [name, status, commissionRate] of driverSpec) {
    const user = await prisma.users.create({
      data: { name, phoneNumber: phone(), roleId: roles.DRIVER, createdAt: new Date(`${addDays(today, -400)}T10:00:00Z`) },
    });
    const driver = await prisma.drivers.create({
      data: { userId: user.id, fullName: name, status, commissionRate, licenseNumber: `LIC-${phoneSeq}`, rating: 5 },
    });
    drivers.push({ ...driver, userId: user.id });
  }
  for (let i = 0; i < vehicles.length; i++) {
    await prisma.vehicleDrivers.create({ data: { vehicleId: vehicles[i].id, driverId: drivers[i % drivers.length].id, isPrimary: true } });
  }

  // ---- driver papers: plain sample images (no real data). The first driver's
  // wait for review, the second's are approved, the rest uploaded nothing yet.
  const samplePng = (r: number, g: number, b: number) => {
    const w = 240, h = 150;
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const rows = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = y > 20 && y < 40 ? 0.7 : x > 20 && x < 80 && y > 55 && y < 125 ? 0.8 : 1;
      rows[o] = r * band; rows[o + 1] = g * band; rows[o + 2] = b * band;
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
  };
  for (const [i, status] of [[0, "PENDING"], [1, "APPROVED"]] as const) {
    const d = drivers[i];
    if (!d) continue;
    fs.mkdirSync(path.join(DOCUMENTS_DIR, d.id), { recursive: true });
    for (const [k, type] of REQUIRED_DOCUMENTS.entries()) {
      const fileName = `${d.id}/${type.toLowerCase()}-demo.png`;
      const png = samplePng(200 + k * 8, 215, 230 - k * 10);
      fs.writeFileSync(path.join(DOCUMENTS_DIR, fileName), png);
      await prisma.driverDocuments.create({ data: { driverId: d.id, type, fileName, mimeType: "image/png", size: png.length, status, reviewedAt: status === "APPROVED" ? new Date() : null } });
    }
  }

  // ---- customers
  const customerNames = [
    "هند عبد الرحمن", "كريم عاطف", "مصطفى الشريف", "سارة يوسف", "كريم فتحي", "ياسمين علي",
    "نور الدين حسن", "منة الله إبراهيم", "عمرو عادل", "دينا مصطفى", "أحمد فاروق", "رنا سمير",
    "محمود طارق", "هبة الله ناصر", "شريف منير", "ملك أشرف",
  ];
  const customers = [];
  for (let i = 0; i < customerNames.length; i++) {
    customers.push(
      await prisma.users.create({
        data: {
          name: customerNames[i],
          phoneNumber: phone(),
          roleId: roles.CUSTOMER,
          otpVerified: true,
          referralCode: `MW${phoneSeq}`,
          createdAt: new Date(`${addDays(today, -between(60, 260))}T12:00:00Z`),
        },
      })
    );
  }
  const hind = customers[0];
  await prisma.users.update({ where: { id: hind.id }, data: { createdAt: new Date("2026-03-04T12:00:00Z") } });

  // ---- bookings
  type Spec = {
    date: string; time: string; customer: (typeof customers)[number]; vehicleIdx: number; driverIdx: number;
    status: BookingStatus; trip: TripStatus; startedDelta?: number; eventType?: string; from?: number; to?: number;
  };
  const specs: Spec[] = [];
  const usedVehicleDay = new Set<string>();
  const usedDriverSlot = new Set<string>();
  const reserve = (s: Spec) => {
    const vk = `${s.vehicleIdx}|${s.date}`;
    const dk = `${s.driverIdx}|${s.date}|${s.time}`;
    if (usedVehicleDay.has(vk) || usedDriverSlot.has(dk)) return false;
    usedVehicleDay.add(vk);
    usedDriverSlot.add(dk);
    specs.push(s);
    return true;
  };
  const activeDriverIdx = drivers.map((d, i) => (d.status === DriverStatus.ONLEAVE ? -1 : i)).filter((i) => i >= 0);

  // Today's schedule: two trips live right now, one of them running late.
  const nowCairo = new Date();
  const hm = (d: Date) => {
    const k = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    return k;
  };
  const roundTo5 = (d: Date) => new Date(Math.floor(d.getTime() / 300_000) * 300_000);
  const liveA = hm(roundTo5(new Date(nowCairo.getTime() - 22 * 60_000)));
  const liveB = hm(roundTo5(new Date(nowCairo.getTime() - 10 * 60_000)));
  const liveC = hm(roundTo5(new Date(nowCairo.getTime() - 45 * 60_000)));
  reserve({ date: today, time: liveA, customer: customers[0], vehicleIdx: 0, driverIdx: 0, status: BookingStatus.CONFIRMED, trip: TripStatus.INPROGRESS, startedDelta: 0, eventType: "زفة فرح 💍", from: 0, to: 1 });
  reserve({ date: today, time: liveB, customer: customers[2], vehicleIdx: 2, driverIdx: 1, status: BookingStatus.CONFIRMED, trip: TripStatus.INPROGRESS, startedDelta: 2, eventType: "استقبال مطار", from: 2, to: 3 });
  reserve({ date: today, time: liveC, customer: customers[3], vehicleIdx: 3, driverIdx: 3, status: BookingStatus.CONFIRMED, trip: TripStatus.INPROGRESS, startedDelta: 14, eventType: "خطوبة", from: 4, to: 5 });
  reserve({ date: today, time: "20:15", customer: customers[4], vehicleIdx: 4, driverIdx: 4, status: BookingStatus.PENDING, trip: TripStatus.NOTSTARTED, from: 6, to: 7 });
  reserve({ date: today, time: "21:00", customer: customers[5], vehicleIdx: 1, driverIdx: 5, status: BookingStatus.CONFIRMED, trip: TripStatus.NOTSTARTED, from: 8, to: 9 });
  reserve({ date: today, time: "09:30", customer: customers[6], vehicleIdx: 5, driverIdx: 0, status: BookingStatus.COMPLETED, trip: TripStatus.COMPLETED, from: 10, to: 2 });

  // History: ~120 days back.
  for (let d = 120; d >= 1; d--) {
    const date = addDays(today, -d);
    const n = between(0, 3) + (rnd() < 0.25 ? 2 : 0);
    for (let k = 0; k < n; k++) {
      const cancelled = rnd() < 0.08;
      reserve({
        date, time: pick(SLOTS), customer: k === 0 && rnd() < 0.12 ? hind : pick(customers),
        vehicleIdx: between(0, vehicles.length - 1), driverIdx: pick(activeDriverIdx.concat([2])),
        status: cancelled ? BookingStatus.CANCELLED : BookingStatus.COMPLETED,
        trip: cancelled ? TripStatus.NOTSTARTED : TripStatus.COMPLETED,
        startedDelta: rnd() < 0.9 ? between(-5, 6) : between(12, 25),
      });
    }
  }
  // Upcoming: next 3 weeks, busier on Thursdays/Fridays.
  for (let d = 1; d <= 21; d++) {
    const date = addDays(today, d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const n = dow === 4 ? between(4, 6) : dow === 5 ? between(2, 4) : between(0, 2);
    for (let k = 0; k < n; k++) {
      reserve({
        date, time: pick(SLOTS), customer: pick(customers), vehicleIdx: between(0, vehicles.length - 1),
        driverIdx: pick(activeDriverIdx), status: rnd() < 0.8 ? BookingStatus.CONFIRMED : BookingStatus.PENDING,
        trip: TripStatus.NOTSTARTED,
      });
    }
  }

  console.log(`Creating ${specs.length} bookings…`);
  const created: { id: string; spec: Spec; total: number }[] = [];
  for (const s of specs) {
    const v = vehicles[s.vehicleIdx];
    const from = PLACES[s.from ?? between(0, PLACES.length - 1)];
    let to = PLACES[s.to ?? between(0, PLACES.length - 1)];
    if (to === from) to = PLACES[(PLACES.indexOf(from) + 3) % PLACES.length];
    const km = Math.max(3, Math.round(haversineKm(from, to) * 1.3 * 10) / 10);
    const minutes = Math.round(km * 2.2 + 10);
    // Demo trips are weddings, priced like the app prices them (Pricing page defaults).
    const priced = priceService({
      basePrice: v.weddingPrice ?? 1500, baseCode: "wedding", includedHours: 4, extraHourPrice: 300,
      bookedMinutes: 180, includedKm: 50, extraKmPrice: 50, distanceKm: km, depositRate: 20,
    });
    const total = priced.breakdown.totalPrice;
    const distancePrice = priced.breakdown.distancePrice;
    const scheduled = zonedToInstant(s.date, s.time);
    const started = s.trip === TripStatus.NOTSTARTED ? null : new Date(scheduled.getTime() + (s.startedDelta ?? 0) * 60_000);
    const paid = s.status === BookingStatus.COMPLETED;

    const b = await prisma.bookings.create({
      data: {
        customerId: s.customer.id, vehicleId: v.id, driverId: drivers[s.driverIdx].id,
        eventType: s.eventType ?? pick(EVENTS), startPoint: from.label, endPoint: to.label,
        startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, distanceSource: "haversine",
        distanceKm: km, durationMinutes: minutes, bookingDate: s.date, startTime: s.time, endTime: addMinutes(s.time, 180),
        status: s.status, tripStatus: s.trip, basePrice: priced.breakdown.basePrice, distancePrice, totalPrice: total,
        serviceType: ServiceType.WEDDING, priceLines: priced.lines as any,
        depositRequired: Math.round(total * 0.2),
        depositPaid: paid ? total : s.status === BookingStatus.CONFIRMED ? Math.round(total * 0.2) : 0,
        paymentStatus: paid ? PaymentStatus.PAID : s.status === BookingStatus.CONFIRMED ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID,
        tripStartedAt: started,
        tripCompletedAt: s.trip === TripStatus.COMPLETED && started ? new Date(started.getTime() + minutes * 60_000) : null,
        createdAt: new Date(Math.min(Date.now() - between(1, 70) * 3_600_000, scheduled.getTime() - between(2, 20) * 86_400_000)),
      },
    });
    created.push({ id: b.id, spec: s, total });
    if (s.date >= today && s.status !== BookingStatus.CANCELLED) {
      await prisma.vehicleAvailability.upsert({
        where: { vehicleId_date: { vehicleId: v.id, date: new Date(`${s.date}T00:00:00.000Z`) } },
        create: { vehicleId: v.id, date: new Date(`${s.date}T00:00:00.000Z`), status: AvailabilityStatus.BOOKED, bookingId: b.id, reason: "Booking created" },
        update: {},
      });
    }
    if (paid || s.status === BookingStatus.CONFIRMED) {
      // Confirmed bookings have their deposit paid; completed ones are paid in full.
      await prisma.payments.create({
        data: {
          bookingId: b.id, userId: s.customer.id, amount: paid ? total : Math.round(total * 0.2),
          paymentMethod: pick([PaymentMethod.CASH, PaymentMethod.PAYMOB, PaymentMethod.FAWRY]), status: PaymentRecordStatus.SUCCESS,
          paidAt: paid ? scheduled : new Date(b.createdAt.getTime() + 3_600_000),
        },
      });
    }
  }

  // ---- reviews: customers rate drivers (a few low ones are complaints), drivers
  // rate some customers. Older complaints are already handled by the office;
  // the recent ones are open and feed the home alerts.
  const COMMENTS: Record<number, string[]> = {
    5: ["سواق محترم جدًا والعربية نضيفة", "وصل في ميعاده بالظبط، شكرًا", "تجربة ممتازة وهنكررها", "", "", ""],
    4: ["كويس بس اتأخر عشر دقايق", "العربية حلوة والتكييف كان ضعيف شوية", "", ""],
    3: ["السواق كان سايق بسرعة", "العربية مكانتش نضيفة من جوه"],
    2: ["السواق اتأخر نص ساعة ومردش على التليفون", "اتعامل معانا بطريقة مش كويسة", "العربية مش زي اللي في الصور"],
  };
  const DRIVER_NOTES = ["عميل محترم والتزم بالمواعيد", "اتأخروا ساعة عن الميعاد", "", ""];
  const oneOf = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const complaintCutoff = addDays(today, -6);
  for (const c of created.filter((c) => c.spec.status === BookingStatus.COMPLETED)) {
    if (rnd() < 0.15) continue;
    const r = rnd();
    const rating = r < 0.7 ? 5 : r < 0.93 ? 4 : r < 0.97 ? 3 : 2;
    const at = zonedToInstant(c.spec.date, "23:30");
    const oldComplaint = rating <= 2 && c.spec.date < complaintCutoff;
    await prisma.reviews.create({
      data: {
        bookingId: c.id, reviewerId: c.spec.customer.id, revieweeId: drivers[c.spec.driverIdx].userId,
        reviewerType: ReviewerType.CUSTOMER_TO_DRIVER, overallRating: rating, vehicleRating: Math.min(5, rating + 1), punctualityRating: rating,
        comment: oneOf(COMMENTS[rating]) || null,
        createdAt: at,
        ...(oldComplaint && admin
          ? { handledAt: new Date(at.getTime() + 86_400_000), handledById: admin.id, handlingNote: "كلمنا العميل واعتذرنا، ونبّهنا على السواق" }
          : {}),
      },
    });
    if (rnd() < 0.3) {
      await prisma.reviews.create({
        data: {
          bookingId: c.id, reviewerId: drivers[c.spec.driverIdx].userId, revieweeId: c.spec.customer.id,
          reviewerType: ReviewerType.DRIVER_TO_CUSTOMER, overallRating: rnd() < 0.85 ? 5 : 3,
          comment: oneOf(DRIVER_NOTES) || null, createdAt: new Date(at.getTime() + 600_000),
        },
      });
    }
  }
  const recentForRamadan = created.find((c) => c.spec.driverIdx === 1 && c.spec.status === BookingStatus.COMPLETED && c.spec.date >= addDays(today, -6));
  if (recentForRamadan) {
    await prisma.reviews.deleteMany({ where: { bookingId: recentForRamadan.id, reviewerType: ReviewerType.CUSTOMER_TO_DRIVER } });
    await prisma.reviews.create({
      data: {
        bookingId: recentForRamadan.id, reviewerId: recentForRamadan.spec.customer.id, revieweeId: drivers[1].userId,
        reviewerType: ReviewerType.CUSTOMER_TO_DRIVER, overallRating: 2, vehicleRating: 4, punctualityRating: 1,
        comment: "السائق اتأخر ومردش على التليفون", createdAt: new Date(),
      },
    });
  }
  const recentForAhmed = created.find((c) => c.spec.driverIdx === 0 && c.spec.status === BookingStatus.COMPLETED && c.spec.date >= addDays(today, -4));
  if (recentForAhmed) {
    await prisma.reviews.deleteMany({ where: { bookingId: recentForAhmed.id, reviewerType: ReviewerType.CUSTOMER_TO_DRIVER } });
    await prisma.reviews.create({
      data: {
        bookingId: recentForAhmed.id, reviewerId: recentForAhmed.spec.customer.id, revieweeId: drivers[0].userId,
        reviewerType: ReviewerType.CUSTOMER_TO_DRIVER, overallRating: 1, vehicleRating: 2, punctualityRating: 3,
        comment: "العربية كانت ريحتها سجاير والسواق رفض يقفل الشباك", createdAt: new Date(Date.now() - 3 * 3_600_000),
      },
    });
  }

  // ---- maintenance (blocks the car on its days, like the fleet page does):
  // BMW 7 in 3 days for 2 days, Audi A8 today and tomorrow.
  const maintain = async (vehicleId: string, type: string, cost: number, start: string, end: string) => {
    // Demo only: free the days first by cancelling (the real flow refuses a clash instead).
    await prisma.bookings.updateMany({ where: { vehicleId, bookingDate: { gte: start, lte: end } }, data: { status: BookingStatus.CANCELLED } });
    const m = await prisma.vehicleMaintenance.create({
      data: { vehicleId, maintenanceType: type, cost, scheduledDate: new Date(`${start}T00:00:00.000Z`), endDate: new Date(`${end}T00:00:00.000Z`) },
    });
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const date = new Date(`${d}T00:00:00.000Z`);
      const reason = `صيانة (${type}) #${m.id}`;
      await prisma.vehicleAvailability.upsert({
        where: { vehicleId_date: { vehicleId, date } },
        create: { vehicleId, date, status: AvailabilityStatus.BLOCKED, reason },
        update: { status: AvailabilityStatus.BLOCKED, reason, bookingId: null },
      });
    }
  };
  await maintain(vehicles[2].id, "صيانة دورية", 4500, addDays(today, 3), addDays(today, 4));
  await maintain(vehicles[9].id, "تغيير زيت وفرامل", 2200, today, addDays(today, 1));

  // ---- a retired car (kept for its history, hidden from the app)
  await prisma.vehicles.create({
    data: {
      make: "هيونداي", model: "إلنترا", category: VehicleCategory.CAR, year: 2016, capacity: 4, color: "فضي",
      plateNumber: "و ي ر 999·D", description: `${DEMO_TAG} اتباعت`, retiredAt: new Date(`${addDays(today, -40)}T10:00:00Z`), retiredReason: "اتباعت",
    },
  });

  // ---- referrals + wallet for the VIP customer
  for (let i = 0; i < 5; i++) {
    const friend = await prisma.users.create({
      data: { name: `صديق هند ${i + 1}`, phoneNumber: phone(), roleId: roles.CUSTOMER, referredById: hind.id },
    });
    await prisma.referrals.create({
      data: {
        referrerId: hind.id, referredId: friend.id, referralCode: hind.referralCode ?? "MW",
        status: i < 3 ? ReferralStatus.COMPLETED : ReferralStatus.PENDING, rewardAmount: i < 3 ? 100 : 0,
        completedAt: i < 3 ? new Date() : null,
      },
    });
  }
  await prisma.walletTransactions.createMany({
    data: [
      { userId: hind.id, amount: 300, type: WalletTransactionType.REFERRAL_REWARD, description: "مكافأة إحالات" },
      { userId: hind.id, amount: 50, type: WalletTransactionType.MANUAL_ADJUSTMENT, description: "تعويض تأخير" },
    ],
  });

  // ---- packages: one waiting for an admin to set its discount, one at 10%
  // Unpaid pending trips first; the random data doesn't always give a customer
  // two, so fall back to their other upcoming trips (never an empty package).
  const upcomingPending = async (customerId: string) => {
    const pending = await prisma.bookings.findMany({
      where: { customerId, status: BookingStatus.PENDING, depositPaid: 0, bookingDate: { gt: today } },
      orderBy: { bookingDate: "asc" },
      take: 2,
    });
    if (pending.length >= 2) return pending;
    const more = await prisma.bookings.findMany({
      where: { customerId, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }, bookingDate: { gt: today }, id: { notIn: pending.map((b) => b.id) } },
      orderBy: { bookingDate: "asc" },
      take: 2 - pending.length,
    });
    return [...pending, ...more];
  };
  // The random data may leave a customer with no trips ahead; a package needs
  // some, so take the preferred customer if they have any, else the next who does.
  const used = new Set<string>();
  const packageOwner = async (preferred: (typeof customers)[number]) => {
    for (const c of [preferred, ...customers]) {
      if (used.has(c.id)) continue;
      if ((await upcomingPending(c.id)).length) {
        used.add(c.id);
        return c;
      }
    }
    return preferred;
  };
  const demoPackages = [
    { customer: await packageOwner(customers[1]), name: "زفة فرح — 3 عربيات", type: PackageType.MULTI_CAR, pct: 0 },
    { customer: await packageOwner(customers[6]), name: "خطوبة وكتب كتاب", type: PackageType.MULTI_EVENT, pct: 10 },
  ];
  for (const dp of demoPackages) {
    const pkg = await prisma.packages.create({
      data: { customerId: dp.customer.id, packageName: dp.name, packageType: dp.type, discountPercentage: dp.pct },
    });
    let total = 0;
    for (const b of await upcomingPending(dp.customer.id)) {
      const packageDiscount = Math.round(b.totalPrice * dp.pct) / 100;
      const totalPrice = Math.round((b.totalPrice - packageDiscount) * 100) / 100;
      await prisma.bookings.update({
        where: { id: b.id },
        data: { packageId: pkg.id, packageDiscount, totalPrice, depositRequired: Math.round(totalPrice * 20) / 100 },
      });
      total += totalPrice;
    }
    await prisma.packages.update({ where: { id: pkg.id }, data: { totalPrice: Math.round(total * 100) / 100 } });
  }

  // ---- a few audit entries so the log isn't empty on first open
  if (admin) {
    const cust = customers[5];
    const v0 = vehicles[0];
    await prisma.auditLogs.createMany({
      data: [
        { actorId: admin.id, actorName: admin.name, action: AuditAction.UPDATE, entityType: "vehicle", entityId: v0.id, entityLabel: `عربية: ${v0.make} ${v0.model}`, details: `base_price: 1600 → 1800`, metadata: { demo: true }, createdAt: new Date(Date.now() - 26 * 3_600_000) },
        { actorId: admin.id, actorName: admin.name, action: AuditAction.UPDATE, entityType: "driver", entityId: drivers[2].id, entityLabel: `سائق: ${drivers[2].fullName}`, details: `status: active → onleave`, metadata: { demo: true }, createdAt: new Date(Date.now() - 4 * 3_600_000) },
        { actorId: admin.id, actorName: admin.name, action: AuditAction.CREATE, entityType: "customer", entityId: cust.id, entityLabel: `عميل: ${cust.name}`, details: `حساب جديد من لوحة التحكم`, metadata: { demo: true }, createdAt: new Date(Date.now() - 3 * 86_400_000) },
      ],
    });
  }

  console.log(`Demo data ready: ${vehicles.length} vehicles, ${drivers.length} drivers, ${customers.length} customers, ${created.length} bookings.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
