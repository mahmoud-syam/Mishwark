import fs from "fs";
import path from "path";
import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import {
  AvailabilityStatus,
  BookingStatus,
  DriverStatus,
  Prisma,
  VehicleCategory,
} from "../../../generated/prisma";
import { BadRequestException, ConflictException, NotFoundException } from "../utils/errors";
import { addDays, dateKey, diffDays, isDateKey } from "../utils/businessTime";
import SettingsService from "./settings.service";
import { isOvernight, nearbyDays } from "../utils/slots";
import { bookingRef } from "../utils/bookingRef";
import { imageTypeOf } from "../middlewares/multer.middleware";

/**
 * Fleet management for the dashboard: cars, their photos and app details,
 * the drivers assigned to them, retiring, and the maintenance schedule.
 *
 * A car's status is derived, never set by hand:
 *   RETIRED      retiredAt is set
 *   MAINTENANCE  an open maintenance covers the day
 *   BOOKED       it has a non-cancelled booking that day
 *   AVAILABLE    otherwise
 */

export type FleetStatus = "AVAILABLE" | "BOOKED" | "MAINTENANCE" | "RETIRED";

/** Suggested feature tags (the admin can add others). */
export const DEFAULT_FEATURES = ["تكييف", "واي فاي", "شاشات خلفية", "مقاعد جلد", "إضاءة أجواء", "مياه مجانية", "شاحن موبايل", "زينة فرح"];

/** Bookings still to come: a finished or cancelled trip never blocks the car. */
const UPCOMING = [BookingStatus.PENDING, BookingStatus.CONFIRMED];

export const MAX_IMAGES_PER_VEHICLE = 12;
export const VEHICLE_UPLOAD_DIR = path.join(process.cwd(), "uploads", "vehicles");

const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const blockReason = (type: string, id: string) => `صيانة (${type}) #${id}`;

// ------------------------------------------------------------------ input
const text = (max: number) => z.string().trim().min(1).max(max);
const plate = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((p) => p.replace(/\s+/g, " "));
const money = z.number().min(0).max(1_000_000);
const features = z
  .array(z.string().trim().min(1).max(30))
  .max(20)
  .transform((list) => [...new Set(list)]);

export const vehicleCreateSchema = z
  .object({
    make: text(60),
    model: text(60),
    year: z.number().int().min(1950).max(new Date().getFullYear() + 1),
    plateNumber: plate,
    color: z.string().trim().max(30).default(""),
    capacity: z.number().int().min(1).max(60),
    category: z.nativeEnum(VehicleCategory),
    basePrice: money.default(0),
    pricePerKm: money.default(0),
    pricePerHour: money.default(0),
    description: z.string().trim().max(1000).default(""),
    luggage: z.number().int().min(0).max(30).default(0),
    features: features.default([]),
  })
  .strict();

export const vehicleUpdateSchema = z
  .object({
    make: text(60),
    model: text(60),
    year: z.number().int().min(1950).max(new Date().getFullYear() + 1),
    plateNumber: plate,
    color: z.string().trim().max(30),
    capacity: z.number().int().min(1).max(60),
    category: z.nativeEnum(VehicleCategory),
    basePrice: money,
    pricePerKm: money,
    pricePerHour: money,
    description: z.string().trim().max(1000),
    luggage: z.number().int().min(0).max(30),
    features,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const assignDriversSchema = z
  .object({
    driverIds: z.array(z.string().min(1)).max(10).transform((ids) => [...new Set(ids)]),
    primaryDriverId: z.string().min(1).optional(),
  })
  .strict();

const dateKeySchema = z.string().refine(isDateKey, { message: "Use YYYY-MM-DD" });

export const maintenanceCreateSchema = z
  .object({
    maintenanceType: text(100),
    startDate: dateKeySchema,
    endDate: dateKeySchema.optional(),
    cost: money.default(0),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const maintenanceCompleteSchema = z
  .object({
    cost: money.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const retireSchema = z.object({ reason: z.string().trim().max(200).optional() }).strict();

export type VehicleCreateInput = z.infer<typeof vehicleCreateSchema>;
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>;

// ------------------------------------------------------------------ service
export class FleetService {
  /** Derived status of each car on a day (default: today). */
  public static async statuses(vehicleIds: string[], day = dateKey()): Promise<Map<string, FleetStatus>> {
    const out = new Map<string, FleetStatus>();
    if (!vehicleIds.length) return out;
    const d = dayStart(day);
    const [vehicles, maint, booked] = await Promise.all([
      prismaClient.vehicles.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, retiredAt: true } }),
      prismaClient.vehicleMaintenance.findMany({
        where: { vehicleId: { in: vehicleIds }, completedDate: null, scheduledDate: { lte: d }, OR: [{ endDate: { gte: d } }, { endDate: null, scheduledDate: d }] },
        select: { vehicleId: true },
      }),
      prismaClient.bookings.findMany({
        where: { vehicleId: { in: vehicleIds }, bookingDate: day, status: { not: BookingStatus.CANCELLED } },
        select: { vehicleId: true },
      }),
    ]);
    const inMaint = new Set(maint.map((m) => m.vehicleId));
    const isBooked = new Set(booked.map((b) => b.vehicleId));
    for (const v of vehicles) {
      out.set(v.id, v.retiredAt ? "RETIRED" : inMaint.has(v.id) ? "MAINTENANCE" : isBooked.has(v.id) ? "BOOKED" : "AVAILABLE");
    }
    return out;
  }

  /** Open maintenance that covers a day, if any. */
  public static async maintenanceOn(db: Prisma.TransactionClient | typeof prismaClient, vehicleId: string, day: string) {
    const d = dayStart(day);
    return db.vehicleMaintenance.findFirst({
      where: { vehicleId, completedDate: null, scheduledDate: { lte: d }, OR: [{ endDate: { gte: d } }, { endDate: null, scheduledDate: d }] },
    });
  }

  private static async assertPlateFree(plateNumber: string, exceptId?: string) {
    const clash = await prismaClient.vehicles.findFirst({
      where: { plateNumber: { equals: plateNumber, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (clash) throw new ConflictException("This plate number is already registered to another car");
  }

  // ---------------------------------------------------------------- reads
  public static async list(params: { search?: string; category?: VehicleCategory; status?: FleetStatus }) {
    const search = params.search?.trim();
    const vehicles = await prismaClient.vehicles.findMany({
      where: {
        ...(params.category && { category: params.category }),
        ...(search && {
          OR: [
            { make: { contains: search, mode: "insensitive" } },
            { model: { contains: search, mode: "insensitive" } },
            { plateNumber: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: [{ retiredAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      include: {
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
        vehicleDrivers: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: { driver: { select: { id: true, fullName: true, status: true } } },
        },
      },
    });
    const ids = vehicles.map((v) => v.id);
    const today = dateKey();
    const [statuses, upcoming, nextMaint, { categoryRates }] = await Promise.all([
      this.statuses(ids, today),
      prismaClient.bookings.groupBy({
        by: ["vehicleId"],
        where: { vehicleId: { in: ids }, bookingDate: { gte: today }, status: { in: UPCOMING } },
        _count: { _all: true },
      }),
      prismaClient.vehicleMaintenance.findMany({
        where: { vehicleId: { in: ids }, completedDate: null, OR: [{ endDate: { gte: dayStart(today) } }, { endDate: null, scheduledDate: { gte: dayStart(today) } }] },
        orderBy: { scheduledDate: "asc" },
      }),
      SettingsService.get(),
    ]);
    const upcomingBy = new Map(upcoming.map((u) => [u.vehicleId, u._count._all]));
    const maintBy = new Map<string, (typeof nextMaint)[number]>();
    for (const m of nextMaint) if (!maintBy.has(m.vehicleId)) maintBy.set(m.vehicleId, m);

    const items = vehicles
      .map((v) => {
        const rate = categoryRates[v.category];
        const m = maintBy.get(v.id);
        return {
          id: v.id,
          make: v.make,
          model: v.model,
          name: `${v.make} ${v.model}`.trim(),
          year: v.year,
          plateNumber: v.plateNumber,
          color: v.color,
          capacity: v.capacity,
          luggage: v.luggage,
          category: v.category,
          status: statuses.get(v.id) ?? "AVAILABLE",
          retiredAt: v.retiredAt,
          // 0 means "use the price of the car type" (Settings).
          basePrice: v.basePrice,
          effectiveBasePrice: v.basePrice > 0 ? v.basePrice : rate.basePrice,
          usesTypePrices: v.basePrice === 0 && v.pricePerKm === 0 && v.pricePerHour === 0,
          coverImage: v.images[0]?.imageUrl ?? null,
          imagesCount: v.images.length,
          features: v.features,
          drivers: v.vehicleDrivers.map((vd) => ({ id: vd.driver.id, name: vd.driver.fullName, status: vd.driver.status, isPrimary: vd.isPrimary })),
          upcomingBookings: upcomingBy.get(v.id) ?? 0,
          nextMaintenance: m ? { id: m.id, type: m.maintenanceType, startDate: keyOf(m.scheduledDate), endDate: keyOf(m.endDate ?? m.scheduledDate) } : null,
        };
      })
      .filter((v) => !params.status || v.status === params.status);

    const active = items.filter((v) => v.status !== "RETIRED");
    const all = params.status ? null : items;
    return {
      items,
      summary: all && {
        total: active.length,
        available: active.filter((v) => v.status === "AVAILABLE").length,
        booked: active.filter((v) => v.status === "BOOKED").length,
        maintenance: active.filter((v) => v.status === "MAINTENANCE").length,
        retired: items.length - active.length,
        withoutDriver: active.filter((v) => v.drivers.length === 0).length,
      },
    };
  }

  public static async detail(id: string) {
    const v = await prismaClient.vehicles.findUnique({
      where: { id },
      include: {
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
        vehicleDrivers: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: { driver: { select: { id: true, fullName: true, status: true, rating: true } } },
        },
        maintenance: { orderBy: { scheduledDate: "desc" } },
      },
    });
    if (!v) throw new NotFoundException("Car not found");
    const today = dateKey();
    const [status, upcoming, stats, { categoryRates }] = await Promise.all([
      this.statuses([id], today),
      prismaClient.bookings.findMany({
        where: { vehicleId: id, bookingDate: { gte: today }, status: { in: UPCOMING } },
        orderBy: [{ bookingDate: "asc" }, { startTime: "asc" }],
        take: 10,
        select: { id: true, bookingDate: true, startTime: true, endTime: true, status: true, customer: { select: { id: true, name: true } } },
      }),
      prismaClient.bookings.aggregate({
        where: { vehicleId: id, status: BookingStatus.COMPLETED },
        _count: { _all: true },
        _sum: { totalPrice: true },
      }),
      SettingsService.get(),
    ]);
    const { vehicleDrivers, maintenance, ...rest } = v;
    return {
      ...rest,
      name: `${v.make} ${v.model}`.trim(),
      status: status.get(id) ?? "AVAILABLE",
      typePrices: categoryRates[v.category],
      drivers: vehicleDrivers.map((vd) => ({ id: vd.driver.id, name: vd.driver.fullName, status: vd.driver.status, rating: vd.driver.rating, isPrimary: vd.isPrimary })),
      maintenance: maintenance.map((m) => ({
        id: m.id,
        type: m.maintenanceType,
        startDate: keyOf(m.scheduledDate),
        endDate: keyOf(m.endDate ?? m.scheduledDate),
        cost: m.cost,
        notes: m.notes,
        completedAt: m.completedDate,
        state: m.completedDate ? "DONE" : keyOf(m.endDate ?? m.scheduledDate) < today ? "OVERDUE" : keyOf(m.scheduledDate) <= today ? "IN_PROGRESS" : "SCHEDULED",
      })),
      upcomingBookings: upcoming.map((b) => ({ ...b, ref: bookingRef(b.id) })),
      stats: { completedTrips: stats._count._all, revenue: Math.round((stats._sum.totalPrice ?? 0) * 100) / 100 },
    };
  }

  /** Feature tags to offer in the form: the defaults plus any already used. */
  public static async featureSuggestions() {
    const rows = await prismaClient.vehicles.findMany({ select: { features: true } });
    const used = rows.flatMap((r) => r.features);
    return [...new Set([...DEFAULT_FEATURES, ...used])];
  }

  // ---------------------------------------------------------------- writes
  public static async create(input: VehicleCreateInput) {
    await this.assertPlateFree(input.plateNumber);
    return prismaClient.vehicles.create({ data: input });
  }

  public static async update(id: string, input: VehicleUpdateInput) {
    const before = await prismaClient.vehicles.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Car not found");
    if (input.plateNumber && input.plateNumber !== before.plateNumber) await this.assertPlateFree(input.plateNumber, id);
    const after = await prismaClient.vehicles.update({ where: { id }, data: input });
    return { before, after };
  }

  /** Upcoming (today onwards), non-cancelled bookings of a car. */
  private static async upcomingBookings(vehicleId: string, from = dateKey(), to?: string, driverIds?: string[]) {
    // The day before is read too: a trip that runs past midnight reaches `from`.
    const before = addDays(from, -1);
    const rows = (
      await prismaClient.bookings.findMany({
        where: { vehicleId, status: { in: UPCOMING }, bookingDate: to ? { gte: before, lte: to } : { gte: before }, ...(driverIds && { driverId: { in: driverIds } }) },
        orderBy: [{ bookingDate: "asc" }, { startTime: "asc" }],
        select: { id: true, bookingDate: true, startTime: true, endTime: true, customer: { select: { name: true } } },
      })
    ).filter((b) => b.bookingDate >= from || isOvernight(b.startTime, b.endTime));
    return rows.map((b) => ({ id: b.id, ref: bookingRef(b.id), date: b.bookingDate, startTime: b.startTime, endTime: b.endTime, customer: b.customer?.name ?? "" }));
  }

  public static async retire(id: string, reason?: string) {
    const v = await prismaClient.vehicles.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Car not found");
    if (v.retiredAt) throw new BadRequestException("This car is already retired");
    const upcoming = await this.upcomingBookings(id);
    if (upcoming.length) {
      throw new ConflictException("Move or cancel this car's upcoming bookings before retiring it", undefined, { bookings: upcoming });
    }
    return prismaClient.vehicles.update({ where: { id }, data: { retiredAt: new Date(), retiredReason: reason || null } });
  }

  public static async reactivate(id: string) {
    const v = await prismaClient.vehicles.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Car not found");
    if (!v.retiredAt) throw new BadRequestException("This car is not retired");
    return prismaClient.vehicles.update({ where: { id }, data: { retiredAt: null, retiredReason: null } });
  }

  /** Replaces the car's drivers. The primary one is tried first for new bookings. */
  public static async setDrivers(id: string, driverIds: string[], primaryDriverId?: string) {
    const v = await prismaClient.vehicles.findUnique({ where: { id }, select: { id: true } });
    if (!v) throw new NotFoundException("Car not found");
    const found = await prismaClient.drivers.findMany({ where: { id: { in: driverIds } }, select: { id: true, fullName: true } });
    if (found.length !== driverIds.length) throw new BadRequestException("One or more drivers were not found");
    const primary = primaryDriverId ?? driverIds[0];
    if (driverIds.length && !driverIds.includes(primary)) throw new BadRequestException("The main driver must be one of the car's drivers");

    const before = await prismaClient.vehicleDrivers.findMany({ where: { vehicleId: id }, include: { driver: { select: { fullName: true } } } });
    // A driver taken off the car can't keep its upcoming trips: move them first.
    const removed = before.map((b) => b.driverId).filter((d) => !driverIds.includes(d));
    if (removed.length) {
      const stranded = await this.upcomingBookings(id, dateKey(), undefined, removed);
      if (stranded.length) {
        throw new ConflictException("These upcoming trips are with a driver you're removing. Move them to another driver first", undefined, { bookings: stranded });
      }
    }
    await prismaClient.$transaction([
      prismaClient.vehicleDrivers.deleteMany({ where: { vehicleId: id } }),
      ...driverIds.map((driverId) => prismaClient.vehicleDrivers.create({ data: { vehicleId: id, driverId, isPrimary: driverId === primary } })),
    ]);
    const name = (did: string) => found.find((f) => f.id === did)?.fullName ?? did;
    return {
      before: before.map((b) => b.driver.fullName + (b.isPrimary ? " (أساسي)" : "")),
      after: driverIds.map((d) => name(d) + (d === primary ? " (أساسي)" : "")),
    };
  }

  // ---------------------------------------------------------------- photos
  public static async addImages(id: string, files: Express.Multer.File[]) {
    // Synchronous so a refused upload leaves nothing on disk by the time we answer.
    const removeAll = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
    const v = await prismaClient.vehicles.findUnique({ where: { id }, include: { images: true } });
    if (!v) {
      removeAll();
      throw new NotFoundException("Car not found");
    }
    if (!files.length) throw new BadRequestException("Choose at least one photo");
    if (files.some((f) => imageTypeOf(f.path) !== f.mimetype)) {
      removeAll();
      throw new BadRequestException("Unsupported file type: this file isn't a real photo. Use JPG, PNG or WEBP.");
    }
    if (v.images.length + files.length > MAX_IMAGES_PER_VEHICLE) {
      removeAll();
      throw new BadRequestException(`A car can have up to ${MAX_IMAGES_PER_VEHICLE} photos`);
    }
    const hasCover = v.images.some((i) => i.isCover);
    const start = v.images.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    await prismaClient.vehicleImages.createMany({
      data: files.map((f, i) => ({
        vehicleId: id,
        imageUrl: `/uploads/vehicles/${path.basename(f.path)}`,
        isCover: !hasCover && i === 0,
        sortOrder: start + i + 1,
      })),
    });
    return prismaClient.vehicleImages.findMany({ where: { vehicleId: id }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] });
  }

  public static async removeImage(id: string, imageId: string) {
    const img = await prismaClient.vehicleImages.findFirst({ where: { id: imageId, vehicleId: id } });
    if (!img) throw new NotFoundException("Photo not found");
    await prismaClient.vehicleImages.delete({ where: { id: imageId } });
    if (img.isCover) {
      const next = await prismaClient.vehicleImages.findFirst({ where: { vehicleId: id }, orderBy: { sortOrder: "asc" } });
      if (next) await prismaClient.vehicleImages.update({ where: { id: next.id }, data: { isCover: true } });
    }
    if (img.imageUrl.startsWith("/uploads/vehicles/")) {
      fs.rm(path.join(VEHICLE_UPLOAD_DIR, path.basename(img.imageUrl)), { force: true }, () => {});
    }
  }

  public static async setCover(id: string, imageId: string) {
    const img = await prismaClient.vehicleImages.findFirst({ where: { id: imageId, vehicleId: id } });
    if (!img) throw new NotFoundException("Photo not found");
    await prismaClient.$transaction([
      prismaClient.vehicleImages.updateMany({ where: { vehicleId: id }, data: { isCover: false } }),
      prismaClient.vehicleImages.update({ where: { id: imageId }, data: { isCover: true } }),
    ]);
  }

  // ----------------------------------------------------------- maintenance
  /**
   * Schedules maintenance over [startDate, endDate]. Refused when the car has
   * bookings on those days (they're returned so the admin can move them) or
   * another open maintenance overlaps. The days are blocked for booking.
   */
  public static async scheduleMaintenance(vehicleId: string, input: z.infer<typeof maintenanceCreateSchema>) {
    const v = await prismaClient.vehicles.findUnique({ where: { id: vehicleId } });
    if (!v) throw new NotFoundException("Car not found");
    if (v.retiredAt) throw new BadRequestException("This car is retired");
    const start = input.startDate;
    const end = input.endDate ?? start;
    if (start < dateKey()) throw new BadRequestException("Maintenance can't start in the past");
    if (end < start) throw new BadRequestException("The end date must be on or after the start date");
    if (diffDays(start, end) > 60) throw new BadRequestException("Maintenance can't be longer than 60 days");

    const clashes = await this.upcomingBookings(vehicleId, start, end);
    if (clashes.length) {
      throw new ConflictException("This car has bookings on those days. Move or cancel them first", undefined, { bookings: clashes });
    }
    const overlap = await prismaClient.vehicleMaintenance.findFirst({
      where: { vehicleId, completedDate: null, scheduledDate: { lte: dayStart(end) }, OR: [{ endDate: { gte: dayStart(start) } }, { endDate: null, scheduledDate: { gte: dayStart(start) } }] },
    });
    if (overlap) throw new ConflictException("Another maintenance is already scheduled on those days");

    return prismaClient.$transaction(async (tx) => {
      const m = await tx.vehicleMaintenance.create({
        data: { vehicleId, maintenanceType: input.maintenanceType, scheduledDate: dayStart(start), endDate: dayStart(end), cost: input.cost, notes: input.notes ?? null },
      });
      const reason = blockReason(input.maintenanceType, m.id);
      for (let d = start; d <= end; d = addDays(d, 1)) {
        await tx.vehicleAvailability.upsert({
          where: { vehicleId_date: { vehicleId, date: dayStart(d) } },
          create: { vehicleId, date: dayStart(d), status: AvailabilityStatus.BLOCKED, reason },
          update: { status: AvailabilityStatus.BLOCKED, reason, bookingId: null },
        });
      }
      return m;
    });
  }

  /** Releases the blocked days of a maintenance from `from` onwards. */
  private static async releaseDays(tx: Prisma.TransactionClient, m: { id: string; vehicleId: string }, from: string) {
    await tx.vehicleAvailability.deleteMany({
      where: { vehicleId: m.vehicleId, date: { gte: dayStart(from) }, status: AvailabilityStatus.BLOCKED, reason: { endsWith: `#${m.id}` } },
    });
  }

  /** Marks maintenance done today; the remaining days open up for booking. */
  public static async completeMaintenance(id: string, input: z.infer<typeof maintenanceCompleteSchema>) {
    const m = await prismaClient.vehicleMaintenance.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Maintenance not found");
    if (m.completedDate) throw new BadRequestException("This maintenance is already done");
    const today = dateKey();
    return prismaClient.$transaction(async (tx) => {
      await this.releaseDays(tx, m, today);
      return tx.vehicleMaintenance.update({
        where: { id },
        data: { completedDate: new Date(), ...(input.cost !== undefined && { cost: input.cost }), ...(input.notes !== undefined && { notes: input.notes }) },
      });
    });
  }

  /** Cancels maintenance that hasn't been done; its days open up again. */
  public static async cancelMaintenance(id: string) {
    const m = await prismaClient.vehicleMaintenance.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Maintenance not found");
    if (m.completedDate) throw new BadRequestException("Maintenance that is already done can't be cancelled");
    await prismaClient.$transaction(async (tx) => {
      await this.releaseDays(tx, m, keyOf(m.scheduledDate) < dateKey() ? dateKey() : keyOf(m.scheduledDate));
      await tx.vehicleMaintenance.delete({ where: { id } });
    });
    return m;
  }

  // ------------------------------------------------------------- bookings
  /**
   * Driver for a new booking. Only the car's drivers may drive it: an explicit
   * driver must be one of them; otherwise the main driver is tried first, then
   * the others, skipping anyone off, on leave or busy at that time.
   */
  public static async pickDriver(
    tx: Prisma.TransactionClient,
    params: { vehicleId: string; driverId?: string; bookingDate: string; startTime: string; endTime: string; overlaps: (t: { bookingDate: string; startTime: string; endTime: string }) => boolean }
  ) {
    const assigned = await tx.vehicleDrivers.findMany({
      where: { vehicleId: params.vehicleId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      include: { driver: { select: { id: true, status: true, licenseExpiry: true } } },
    });
    if (!assigned.length) throw new BadRequestException("This car has no driver assigned yet");
    const unavailable = (s: DriverStatus) => s === DriverStatus.OFF || s === DriverStatus.ONLEAVE;
    // A licence that has expired by the trip's day rules the driver out.
    const expired = (d: { licenseExpiry: Date | null }) => !!d.licenseExpiry && dateKey(d.licenseExpiry) < params.bookingDate;

    if (params.driverId) {
      const a = assigned.find((x) => x.driver.id === params.driverId);
      if (!a) throw new BadRequestException("This driver isn't assigned to this car");
      if (unavailable(a.driver.status)) throw new BadRequestException("Assigned driver is currently OFF or ON LEAVE");
      if (expired(a.driver)) throw new BadRequestException("This driver's licence has expired");
      return a.driver.id;
    }
    for (const a of assigned) {
      if (unavailable(a.driver.status) || expired(a.driver)) continue;
      const busy = await tx.bookings.findMany({
        where: { driverId: a.driver.id, bookingDate: { in: nearbyDays(params.bookingDate) }, status: { not: BookingStatus.CANCELLED } },
        select: { bookingDate: true, startTime: true, endTime: true },
      });
      if (!busy.some(params.overlaps)) return a.driver.id;
    }
    throw new ConflictException("No driver of this car is free at this time");
  }
}

export default FleetService;
