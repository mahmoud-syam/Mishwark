import { tripMinutes } from "../utils/slots";
import { bookingRef } from "../utils/bookingRef";
import prismaClient from "../utils/prismaClientHelper";
import {
  AuditAction,
  BookingStatus,
  DriverStatus,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  ServiceType,
  ReferralStatus,
  ReviewerType,
  TripStatus,
  VehicleStatus,
} from "../../../generated/prisma";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "../utils/errors";
import { isSuperAdminRole, USER_ROLES } from "../constants/roles";
import BookingService from "./booking.service";
import AuditService, { AuditActor } from "./audit.service";
import PaymentService from "./payment.service";
import SettingsService, { DEFAULT_SETTINGS } from "./settings.service";
import FleetService from "./fleet.service";
import DriverDocumentService from "./driver-document.service";
import ReviewAdminService from "./review-admin.service";
import {
  addDays,
  addMonths,
  dateKey,
  diffDays,
  isDateKey,
  monthStart,
  yearStart,
  zonedToInstant,
} from "../utils/businessTime";

/** Bookings that represent money the business has earned or locked in. */
const REVENUE_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];
const LIVE_TRIP_STATUSES: TripStatus[] = [TripStatus.INPROGRESS, TripStatus.ARRIVED];
/**
 * Thresholds (complaint rating, punctuality grace, delay alert, maintenance
 * alert, VIP spend, deposit %) come from the Settings page: SettingsService.
 */
export const COMPLAINT_MAX_RATING = DEFAULT_SETTINGS.complaintMaxRating;

export type AnalyticsPeriod = "day" | "month" | "year";

export { bookingRef };

/** What the dashboard shows for one booking (day page, bookings page). */
const BOOKING_ROW = {
  customer: { select: { id: true, name: true, phoneNumber: true } },
  vehicle: { select: { id: true, make: true, model: true, plateNumber: true, category: true } },
  driver: { select: { id: true, fullName: true } },
  payments: {
    select: { id: true, amount: true, paymentMethod: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.BookingsInclude;

const shapeBooking = (b: Prisma.BookingsGetPayload<{ include: typeof BOOKING_ROW }>) => ({
  id: b.id,
  ref: bookingRef(b.id),
  status: b.status,
  tripStatus: b.tripStatus,
  bookingDate: b.bookingDate,
  startTime: b.startTime,
  endTime: b.endTime,
  startPoint: b.startPoint,
  endPoint: b.endPoint,
  eventType: b.eventType,
  packageId: b.packageId,
  totalPrice: b.totalPrice,
  packageDiscount: b.packageDiscount,
  referralDiscount: b.referralDiscount,
  paymentStatus: b.paymentStatus,
  depositRequired: b.depositRequired,
  paid: b.depositPaid,
  payments: b.payments,
  notes: b.notes,
  createdAt: b.createdAt,
  cancelledAt: b.cancelledAt,
  depositOutcome: b.depositOutcome,
  depositRefunded: b.depositRefunded,
  serviceType: b.serviceType,
  priceLines: b.priceLines,
  customer: b.customer,
  vehicle: { ...b.vehicle, name: vehicleName(b.vehicle) },
  driver: b.driver,
});


const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const vehicleName = (v: { make: string; model: string }) => `${v.make} ${v.model}`.trim();

/** Inclusive [from, to] date-key range covered by an analytics period. */
const periodRange = (period: AnalyticsPeriod, today: string) => {
  if (period === "year") return { from: yearStart(today), to: today };
  if (period === "month") return { from: monthStart(today), to: today };
  return { from: today, to: today };
};

/**
 * Chart buckets for a period: last 7 days for "day", last 6 months for
 * "month", last 3 years for "year". Each bucket is an inclusive key range.
 */
const chartBuckets = (period: AnalyticsPeriod, today: string) => {
  const buckets: { key: string; from: string; to: string }[] = [];
  if (period === "day") {
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      buckets.push({ key: d, from: d, to: d });
    }
  } else if (period === "month") {
    for (let i = 5; i >= 0; i--) {
      const from = addMonths(today, -i);
      buckets.push({ key: from.slice(0, 7), from, to: addDays(addMonths(from, 1), -1) });
    }
  } else {
    const y = Number(today.slice(0, 4));
    for (let i = 2; i >= 0; i--) {
      buckets.push({ key: String(y - i), from: `${y - i}-01-01`, to: `${y - i}-12-31` });
    }
  }
  return buckets;
};

const sumInBucket = <T extends { bookingDate: string }>(rows: T[], b: { from: string; to: string }, pick: (r: T) => number) =>
  rows.filter((r) => r.bookingDate >= b.from && r.bookingDate <= b.to).reduce((s, r) => s + pick(r), 0);

export interface BookOnBehalfInput {
  customerId: string;
  vehicleId: string;
  driverId?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  startPoint?: any;
  endPoint?: any;
  serviceType?: ServiceType;
  destinationId?: string;
  eventType?: string;
  notes?: string;
  priceOverride?: number;
  markPaid?: boolean;
  paymentMethod?: PaymentMethod;
}

export class AdminDashboardService {
  // ---------------------------------------------------------------- overview
  public static async overview() {
    const cfg = await SettingsService.get();
    const today = dateKey();
    const yesterday = addDays(today, -1);
    const mStart = monthStart(today);
    const dayOfMonth = diffDays(mStart, today);
    const lmStart = addMonths(today, -1);
    const lmEndCap = addDays(mStart, -1);
    const lmSpanEnd = addDays(lmStart, dayOfMonth);
    const lmEnd = lmSpanEnd < lmEndCap ? lmSpanEnd : lmEndCap;
    const weekStart = addDays(today, -6);
    const now = new Date();
    const maintenanceHorizon = new Date(now.getTime() + cfg.maintenanceAlertDays * 86_400_000);

    const [
      todayBookings,
      yesterdayBookings,
      monthRevenue,
      lastMonthRevenue,
      vehicles,
      todayRows,
      weekRows,
      maintenance,
      complaints,
      liveTrips,
      pendingBookings,
    ] = await Promise.all([
      prismaClient.bookings.count({ where: { bookingDate: today, status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.bookings.count({ where: { bookingDate: yesterday, status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.bookings.aggregate({
        where: { bookingDate: { gte: mStart, lte: today }, status: { in: REVENUE_STATUSES } },
        _sum: { totalPrice: true },
      }),
      prismaClient.bookings.aggregate({
        where: { bookingDate: { gte: lmStart, lte: lmEnd }, status: { in: REVENUE_STATUSES } },
        _sum: { totalPrice: true },
      }),
      // Retired cars are out of the fleet numbers.
      prismaClient.vehicles.findMany({ where: { retiredAt: null }, select: { id: true, make: true, model: true, _count: { select: { vehicleDrivers: true } } } }),
      prismaClient.bookings.findMany({
        where: { bookingDate: today, status: { not: BookingStatus.CANCELLED } },
        select: { vehicleId: true },
        distinct: ["vehicleId"],
      }),
      prismaClient.bookings.findMany({
        where: { bookingDate: { gte: weekStart, lte: today }, status: { not: BookingStatus.CANCELLED } },
        select: { vehicleId: true, bookingDate: true, status: true, totalPrice: true },
      }),
      prismaClient.vehicleMaintenance.findMany({
        where: { completedDate: null, vehicle: { retiredAt: null }, scheduledDate: { gte: new Date(now.getTime() - 86_400_000), lte: maintenanceHorizon } },
        include: { vehicle: { select: { id: true, make: true, model: true } } },
        orderBy: { scheduledDate: "asc" },
      }),
      // Open complaints (not yet marked handled), newest first.
      ReviewAdminService.openComplaints(5),
      prismaClient.bookings.count({ where: { tripStatus: { in: LIVE_TRIP_STATUSES }, status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.bookings.count({ where: { status: BookingStatus.PENDING, bookingDate: { gte: today } } }),
    ]);

    const totalVehicles = vehicles.length;
    // Status is derived from the maintenance schedule (FleetService), not set by hand.
    const fleetStatus = await FleetService.statuses(vehicles.map((v) => v.id), today);
    const maintenanceVehicles = vehicles.filter((v) => fleetStatus.get(v.id) === "MAINTENANCE").length;
    const operational = totalVehicles - maintenanceVehicles;
    const bookedToday = todayRows.length;
    const usedSlots = new Set(weekRows.map((r) => `${r.vehicleId}|${r.bookingDate}`)).size;

    const weeklyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      weeklyRevenue.push({
        date: d,
        revenue: weekRows
          .filter((r) => r.bookingDate === d && REVENUE_STATUSES.includes(r.status))
          .reduce((s, r) => s + r.totalPrice, 0),
      });
    }

    // Drivers who are off or on leave but still hold upcoming trips: those
    // trips need another driver (setting the status doesn't move them).
    const stranded = await prismaClient.bookings.groupBy({
      by: ["driverId"],
      where: {
        bookingDate: { gte: today },
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        driver: { status: { in: [DriverStatus.OFF, DriverStatus.ONLEAVE] } },
      },
      _count: { _all: true },
      _min: { bookingDate: true },
    });
    const strandedDrivers = stranded.length
      ? await prismaClient.drivers.findMany({ where: { id: { in: stranded.map((x) => x.driverId) } }, select: { id: true, fullName: true, status: true } })
      : [];

    // Drivers with papers waiting for review.
    const papersWaiting = await prismaClient.driverDocuments.groupBy({ by: ["driverId"], where: { status: "PENDING" }, _count: { _all: true } });
    // Waiting because the driver changed his licence details (a note is only set then).
    const licenceChanged = new Set(
      (await prismaClient.driverDocuments.findMany({ where: { status: "PENDING", reviewNote: { not: null } }, select: { driverId: true }, distinct: ["driverId"] })).map((x) => x.driverId)
    );
    const papersDrivers = papersWaiting.length
      ? await prismaClient.drivers.findMany({ where: { id: { in: papersWaiting.map((x) => x.driverId) } }, select: { id: true, fullName: true } })
      : [];

    const alerts = [
      ...papersWaiting.map((x) => ({
        type: "documents_pending" as const,
        severity: "warning" as const,
        entityId: x.driverId,
        driverName: papersDrivers.find((d) => d.id === x.driverId)?.fullName ?? "",
        documents: x._count._all,
        licenceChanged: licenceChanged.has(x.driverId),
      })),
      ...stranded.map((x) => {
        const d = strandedDrivers.find((v) => v.id === x.driverId);
        return {
          type: "driver_unavailable" as const,
          severity: "danger" as const,
          entityId: x.driverId,
          driverName: d?.fullName ?? "",
          driverStatus: d?.status ?? DriverStatus.OFF,
          trips: x._count._all,
          firstDate: x._min.bookingDate ?? today,
        };
      }),
      ...maintenance.map((m) => ({
        type: "maintenance" as const,
        severity: "warning" as const,
        entityId: m.vehicle.id,
        vehicleName: vehicleName(m.vehicle),
        maintenanceType: m.maintenanceType,
        daysUntil: Math.max(0, diffDays(today, dateKey(m.scheduledDate))),
      })),
      // A car with no driver can't be booked and is hidden from the app.
      ...vehicles
        .filter((v) => v._count.vehicleDrivers === 0)
        .map((v) => ({
          type: "no_driver" as const,
          severity: "warning" as const,
          entityId: v.id,
          vehicleName: vehicleName(v),
        })),
      ...complaints.rows.map((r) => ({
        type: "complaint" as const,
        severity: "danger" as const,
        entityId: r.reviewee.driverId ?? r.reviewee.userId,
        reviewId: r.id,
        driverName: r.reviewee.name,
        customerName: r.reviewer.name,
        rating: r.overallRating,
        comment: r.comment,
        bookingId: r.booking?.id ?? "",
      })),
    ];

    return {
      today,
      kpis: {
        todayBookings,
        yesterdayBookings,
        monthRevenue: monthRevenue._sum.totalPrice ?? 0,
        lastMonthRevenue: lastMonthRevenue._sum.totalPrice ?? 0,
        totalVehicles,
        availableVehicles: Math.max(0, operational - bookedToday),
        bookedVehicles: bookedToday,
        maintenanceVehicles,
        occupancyRate: operational > 0 ? round((usedSlots / (operational * 7)) * 100) : 0,
        liveTrips,
        pendingBookings,
        openComplaints: complaints.count,
      },
      weeklyRevenue,
      alerts,
    };
  }

  // ------------------------------------------------------- drivers summary
  public static async driversSummary(limit = 3) {
    const cfg = await SettingsService.get();
    const today = dateKey();
    const mStart = monthStart(today);
    const drivers = await prismaClient.drivers.findMany({
      select: { id: true, fullName: true, status: true, statusSetByAdmin: true, rating: true, userId: true, user: { select: { name: true } } },
    });
    if (drivers.length === 0) return [];

    const ids = drivers.map((d) => d.id);
    const userIds = drivers.map((d) => d.userId);

    const docRows = await prismaClient.driverDocuments.findMany({ where: { driverId: { in: ids } }, select: { driverId: true, type: true, status: true } });
    const [monthAgg, completedAgg, ratingAgg, complaintAgg] = await Promise.all([
      prismaClient.bookings.groupBy({
        by: ["driverId"],
        where: { driverId: { in: ids }, bookingDate: { gte: mStart, lte: today }, status: { in: REVENUE_STATUSES } },
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prismaClient.bookings.groupBy({
        by: ["driverId"],
        where: { driverId: { in: ids }, status: BookingStatus.COMPLETED },
        _count: { _all: true },
      }),
      prismaClient.reviews.groupBy({
        by: ["revieweeId"],
        where: { revieweeId: { in: userIds }, reviewerType: ReviewerType.CUSTOMER_TO_DRIVER },
        _avg: { overallRating: true },
        _count: { _all: true },
      }),
      prismaClient.reviews.groupBy({
        by: ["revieweeId"],
        where: {
          revieweeId: { in: userIds },
          reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
          overallRating: { lte: cfg.complaintMaxRating },
        },
        _count: { _all: true },
      }),
    ]);

    return drivers
      .map((d) => {
        const m = monthAgg.find((a) => a.driverId === d.id);
        const r = ratingAgg.find((a) => a.revieweeId === d.userId);
        return {
          id: d.id,
          name: d.fullName || d.user.name,
          status: d.status,
          statusLocked: d.statusSetByAdmin,
          rating: round(r?._avg.overallRating ?? d.rating ?? 5, 1),
          reviewCount: r?._count._all ?? 0,
          complaints: complaintAgg.find((a) => a.revieweeId === d.userId)?._count._all ?? 0,
          monthRevenue: m?._sum.totalPrice ?? 0,
          monthTrips: m?._count._all ?? 0,
          totalTrips: completedAgg.find((a) => a.driverId === d.id)?._count._all ?? 0,
          documents: DriverDocumentService.summarize(docRows.filter((x) => x.driverId === d.id)),
        };
      })
      .sort((a, b) => b.monthRevenue - a.monthRevenue || b.totalTrips - a.totalTrips)
      .slice(0, limit);
  }

  // ----------------------------------------------------------- day details
  public static async day(date: string) {
    const [bookings, totalVehicles, drivers] = await Promise.all([
      prismaClient.bookings.findMany({
        where: { bookingDate: date, status: { not: BookingStatus.CANCELLED } },
        orderBy: { startTime: "asc" },
        include: BOOKING_ROW,
      }),
      prismaClient.vehicles.count(),
      prismaClient.drivers.findMany({
        select: { id: true, fullName: true, status: true },
        orderBy: { fullName: "asc" },
      }),
    ]);

    return {
      date,
      stats: {
        total: bookings.length,
        pending: bookings.filter((b) => b.status === BookingStatus.PENDING).length,
        expectedRevenue: bookings.reduce((s, b) => s + b.totalPrice, 0),
        vehiclesUsed: new Set(bookings.map((b) => b.vehicleId)).size,
        totalVehicles,
      },
      bookings: bookings.map(shapeBooking),
      drivers: drivers.map((d) => {
        const trips = bookings.filter((b) => b.driverId === d.id).map((b) => b.startTime);
        return { id: d.id, name: d.fullName, status: d.status, trips };
      }),
    };
  }

  // -------------------------------------------------------- bookings page
  /**
   * Bookings page: search by reference (MW-1A2B3C), customer name or phone,
   * filtered by status, payment and dates. Upcoming = today onwards, soonest
   * first; past = before today, latest first. `counts` are per status for the
   * same search, so the tabs show how many each would give.
   */
  public static async bookings(params: {
    q?: string;
    status?: string;
    paymentStatus?: string;
    scope?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const today = dateKey();
    const where: Prisma.BookingsWhereInput = {};
    const and: Prisma.BookingsWhereInput[] = [];
    const scope = params.scope === "past" || params.scope === "all" ? params.scope : "upcoming";
    if (scope === "upcoming") and.push({ bookingDate: { gte: today } });
    if (scope === "past") and.push({ bookingDate: { lt: today } });
    if (params.from && isDateKey(params.from)) and.push({ bookingDate: { gte: params.from } });
    if (params.to && isDateKey(params.to)) and.push({ bookingDate: { lte: params.to } });
    if (params.paymentStatus && (Object.values(PaymentStatus) as string[]).includes(params.paymentStatus)) {
      and.push({ paymentStatus: params.paymentStatus as PaymentStatus });
    }
    const q = (params.q ?? "").trim();
    if (q) {
      const ref = q.replace(/^#?MW-?/i, "");
      const digits = q.replace(/\D/g, "");
      const or: Prisma.BookingsWhereInput[] = [{ customer: { name: { contains: q, mode: "insensitive" } } }];
      if (/^[0-9a-f]{3,8}$/i.test(ref)) or.push({ id: { startsWith: ref.toLowerCase() } });
      if (digits.length >= 4) {
        // 01012345678 is stored as +201012345678.
        const local = digits.replace(/^0020/, "").replace(/^20(?=1)/, "").replace(/^0(?=1)/, "");
        or.push({ customer: { phoneNumber: { contains: local } } });
      }
      and.push({ OR: or });
    }
    if (and.length) where.AND = and;
    const status = params.status && (Object.values(BookingStatus) as string[]).includes(params.status) ? (params.status as BookingStatus) : undefined;
    const listWhere: Prisma.BookingsWhereInput = status ? { ...where, status } : where;
    const order: Prisma.SortOrder = scope === "upcoming" ? "asc" : "desc";

    const [rows, total, byStatus] = await Promise.all([
      prismaClient.bookings.findMany({
        where: listWhere,
        orderBy: [{ bookingDate: order }, { startTime: order }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: BOOKING_ROW,
      }),
      prismaClient.bookings.count({ where: listWhere }),
      prismaClient.bookings.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(Object.values(BookingStatus).map((st) => [st, byStatus.find((x) => x.status === st)?._count._all ?? 0]));
    return {
      items: rows.map(shapeBooking),
      counts,
      pagination: { total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) },
    };
  }

  // ------------------------------------------------------------ live trips
  public static async liveTrips() {
    const cfg = await SettingsService.get();
    const rows = await prismaClient.bookings.findMany({
      where: { tripStatus: { in: LIVE_TRIP_STATUSES }, status: { not: BookingStatus.CANCELLED } },
      orderBy: [{ bookingDate: "asc" }, { startTime: "asc" }],
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true } },
        vehicle: { select: { id: true, make: true, model: true, plateNumber: true } },
        driver: {
          select: {
            id: true,
            fullName: true,
            user: { select: { phoneNumber: true } },
            phoneNumbers: { select: { number: true }, take: 1 },
          },
        },
      },
    });

    const now = Date.now();
    return rows.map((b) => {
      const scheduledStart = zonedToInstant(b.bookingDate, b.startTime).getTime();
      const scheduledEnd = scheduledStart + tripMinutes(b.startTime, b.endTime || b.startTime) * 60_000;
      const plannedMinutes =
        b.durationMinutes > 0 ? b.durationMinutes : Math.max(15, (scheduledEnd - scheduledStart) / 60_000);
      const startedAt = b.tripStartedAt?.getTime() ?? scheduledStart;
      const expectedEnd = startedAt + plannedMinutes * 60_000;
      const scheduledArrival = scheduledStart + plannedMinutes * 60_000;
      const elapsedMinutes = Math.max(0, (now - startedAt) / 60_000);
      const remainingMinutes = Math.max(0, (expectedEnd - now) / 60_000);
      const delayMinutes = Math.max(0, (Math.max(expectedEnd, now) - scheduledArrival) / 60_000);
      const total = elapsedMinutes + remainingMinutes;

      return {
        id: b.id,
        ref: bookingRef(b.id),
        bookingDate: b.bookingDate,
        tripStatus: b.tripStatus,
        startPoint: b.startPoint,
        endPoint: b.endPoint,
        customer: b.customer,
        vehicle: { ...b.vehicle, name: vehicleName(b.vehicle) },
        driver: {
          id: b.driver.id,
          name: b.driver.fullName,
          phone: b.driver.user?.phoneNumber || b.driver.phoneNumbers[0]?.number || null,
        },
        startedAt: new Date(startedAt).toISOString(),
        startedOnRecord: Boolean(b.tripStartedAt),
        elapsedMinutes: Math.round(elapsedMinutes),
        remainingMinutes: Math.round(remainingMinutes),
        delayMinutes: Math.round(delayMinutes),
        isDelayed: delayMinutes >= cfg.delayAlertMinutes,
        progress: total > 0 ? round(Math.min(1, elapsedMinutes / total), 3) : 0,
      };
    });
  }

  // ------------------------------------------------------ driver analytics
  public static async driverAnalytics(driverId: string, period: AnalyticsPeriod) {
    const cfg = await SettingsService.get();
    const driver = await prismaClient.drivers.findUnique({
      where: { id: driverId },
      select: { id: true, fullName: true, status: true, commissionRate: true, userId: true, user: { select: { name: true } } },
    });
    if (!driver) throw new NotFoundException(`Driver with ID ${driverId} not found`);

    const today = dateKey();
    const range = periodRange(period, today);
    const buckets = chartBuckets(period, today);
    const rate = driver.commissionRate / 100;

    const [earning, allCount, ratingAgg, complaints, punctualityRows, recent] = await Promise.all([
      prismaClient.bookings.findMany({
        where: { driverId, status: { in: REVENUE_STATUSES }, bookingDate: { lte: today } },
        select: { bookingDate: true, totalPrice: true },
      }),
      prismaClient.bookings.count({ where: { driverId, bookingDate: { gte: range.from, lte: range.to }, status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.reviews.aggregate({
        where: { revieweeId: driver.userId, reviewerType: ReviewerType.CUSTOMER_TO_DRIVER },
        _avg: { overallRating: true },
        _count: { _all: true },
      }),
      prismaClient.reviews.count({
        where: { revieweeId: driver.userId, reviewerType: ReviewerType.CUSTOMER_TO_DRIVER, overallRating: { lte: cfg.complaintMaxRating } },
      }),
      prismaClient.bookings.findMany({
        where: { driverId, tripStartedAt: { not: null } },
        select: { bookingDate: true, startTime: true, tripStartedAt: true },
      }),
      prismaClient.bookings.findMany({
        where: { driverId, status: { in: REVENUE_STATUSES }, bookingDate: { lte: today } },
        orderBy: [{ bookingDate: "desc" }, { startTime: "desc" }],
        take: 5,
        include: { customer: { select: { id: true, name: true } } },
      }),
    ]);

    const inRange = earning.filter((r) => r.bookingDate >= range.from && r.bookingDate <= range.to);
    const periodIncome = round(inRange.reduce((s, r) => s + r.totalPrice, 0), 2);
    const lifetimeIncome = round(earning.reduce((s, r) => s + r.totalPrice, 0), 2);
    const onTime = punctualityRows.filter(
      (r) => r.tripStartedAt!.getTime() <= zonedToInstant(r.bookingDate, r.startTime).getTime() + cfg.punctualityGraceMinutes * 60_000
    ).length;

    return {
      driver: { id: driver.id, name: driver.fullName || driver.user.name, status: driver.status, commissionRate: driver.commissionRate },
      period,
      range,
      periodStats: {
        trips: allCount,
        driverIncome: periodIncome,
        // To the piaster, net = income - share, so the two always add up and
        // match GET /driver/stats in the driver app.
        companyShare: round(periodIncome * rate, 2),
        driverNet: round(periodIncome - round(periodIncome * rate, 2), 2),
      },
      lifetime: {
        trips: earning.length,
        driverIncome: lifetimeIncome,
        companyShare: round(lifetimeIncome * rate, 2),
        averageTripValue: earning.length ? round(lifetimeIncome / earning.length) : 0,
      },
      quality: {
        rating: ratingAgg._avg.overallRating != null ? round(ratingAgg._avg.overallRating, 1) : null,
        reviewCount: ratingAgg._count._all,
        complaints,
        punctualityRate: punctualityRows.length ? round((onTime / punctualityRows.length) * 100) : null,
      },
      chart: buckets.map((b) => {
        const income = round(sumInBucket(earning, b, (r) => r.totalPrice), 2);
        return { key: b.key, income, share: round(income * rate, 2) };
      }),
      recentTrips: recent.map((b) => ({
        id: b.id,
        ref: bookingRef(b.id),
        bookingDate: b.bookingDate,
        customer: b.customer,
        value: b.totalPrice,
        share: round(b.totalPrice * rate),
        status: b.status,
      })),
    };
  }

  public static async setCommission(driverId: string, rate: number, actor: AuditActor) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException("commissionRate must be between 0 and 100");
    }
    const before = await prismaClient.drivers.findUnique({ where: { id: driverId }, select: { commissionRate: true, fullName: true } });
    if (!before) throw new NotFoundException(`Driver with ID ${driverId} not found`);

    const updated = await prismaClient.drivers.update({
      where: { id: driverId },
      data: { commissionRate: rate },
      select: { id: true, fullName: true, commissionRate: true },
    });
    await AuditService.record(actor, {
      action: AuditAction.UPDATE,
      entityType: "driver",
      entityId: driverId,
      entityLabel: `سائق: ${before.fullName}`,
      details: `commission: ${before.commissionRate}% → ${rate}%`,
    });
    return updated;
  }

  // ---------------------------------------------------- customer analytics
  public static async customerAnalytics(customerId: string, period: AnalyticsPeriod) {
    const cfg = await SettingsService.get();
    const customer = await prismaClient.users.findFirst({
      where: { id: customerId, isDeleted: false },
      select: { id: true, name: true, phoneNumber: true, email: true, createdAt: true, customerRating: true, role: { select: { name: true } } },
    });
    if (!customer) throw new NotFoundException(`Customer with ID ${customerId} not found`);

    const today = dateKey();
    const range = periodRange(period, today);
    const buckets = chartBuckets(period, today);

    const [bookings, wallet, referralsInvited, referralsConverted] = await Promise.all([
      prismaClient.bookings.findMany({
        where: { customerId },
        orderBy: [{ bookingDate: "desc" }, { startTime: "desc" }],
        select: {
          id: true,
          bookingDate: true,
          status: true,
          totalPrice: true,
          vehicle: { select: { make: true, model: true } },
        },
      }),
      prismaClient.walletTransactions.aggregate({ where: { userId: customerId }, _sum: { amount: true } }),
      prismaClient.referrals.count({ where: { referrerId: customerId } }),
      prismaClient.referrals.count({ where: { referrerId: customerId, status: ReferralStatus.COMPLETED } }),
    ]);

    // Money counts once the trip date has arrived; upcoming confirmed bookings
    // still show in the history list but not in spend totals.
    const spending = bookings.filter((b) => REVENUE_STATUSES.includes(b.status) && b.bookingDate <= today);
    const lifetimeSpend = spending.reduce((s, b) => s + b.totalPrice, 0);
    const inRange = (b: { bookingDate: string }) => b.bookingDate >= range.from && b.bookingDate <= range.to;

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phoneNumber: customer.phoneNumber,
        email: customer.email,
        memberSince: customer.createdAt,
        rating: customer.customerRating,
        isVip: lifetimeSpend >= cfg.vipSpendThreshold,
      },
      period,
      range,
      periodStats: {
        bookings: bookings.filter((b) => inRange(b) && b.status !== BookingStatus.CANCELLED).length,
        spend: spending.filter(inRange).reduce((s, b) => s + b.totalPrice, 0),
      },
      lifetime: {
        spend: lifetimeSpend,
        bookings: bookings.filter((b) => b.status !== BookingStatus.CANCELLED).length,
        averageBookingValue: spending.length ? round(lifetimeSpend / spending.length) : 0,
        cancelled: bookings.filter((b) => b.status === BookingStatus.CANCELLED).length,
        walletBalance: wallet._sum.amount ?? 0,
      },
      referrals: { invited: referralsInvited, converted: referralsConverted },
      chart: buckets.map((b) => ({ key: b.key, spend: sumInBucket(spending, b, (r) => r.totalPrice) })),
      recentBookings: bookings.slice(0, 5).map((b) => ({
        id: b.id,
        ref: bookingRef(b.id),
        bookingDate: b.bookingDate,
        vehicle: vehicleName(b.vehicle),
        value: b.totalPrice,
        status: b.status,
      })),
    };
  }

  // --------------------------------------------------------- customer CRUD
  public static async searchCustomers(search: string, limit = 8) {
    const q = search.trim();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    const or: Prisma.UsersWhereInput[] = [{ name: { contains: q, mode: "insensitive" } }];
    if (digits.length >= 3) or.push({ phoneNumber: { contains: digits.replace(/^0/, "") } });

    const users = await prismaClient.users.findMany({
      where: { isDeleted: false, role: { name: USER_ROLES.CUSTOMER }, OR: or },
      take: limit,
      orderBy: [{ bookings: { _count: "desc" } }, { name: "asc" }],
      select: { id: true, name: true, phoneNumber: true, _count: { select: { bookings: true } } },
    });
    return users.map((u) => ({ id: u.id, name: u.name, phoneNumber: u.phoneNumber, bookingsCount: u._count.bookings }));
  }

  public static async quickCreateCustomer(input: { name: string; phoneNumber: string }, actor: AuditActor) {
    const phone = input.phoneNumber.trim();
    const existing = await prismaClient.users.findUnique({ where: { phoneNumber: phone } });
    if (existing) throw new ConflictException("A user with this phone number already exists");

    const role = await prismaClient.role.findUnique({ where: { name: USER_ROLES.CUSTOMER } });
    if (!role) throw new NotFoundException("Customer role is not seeded");

    const user = await prismaClient.users.create({
      data: { name: input.name.trim(), phoneNumber: phone, roleId: role.id },
      select: { id: true, name: true, phoneNumber: true },
    });
    await AuditService.record(actor, {
      action: AuditAction.CREATE,
      entityType: "customer",
      entityId: user.id,
      entityLabel: `عميل: ${user.name}`,
      details: "حساب جديد من لوحة التحكم",
    });
    return { ...user, bookingsCount: 0 };
  }

  // ------------------------------------------------------ book on behalf
  public static async bookOnBehalf(input: BookOnBehalfInput, actor: AuditActor & { role?: { name?: string } | null }) {
    const customer = await prismaClient.users.findFirst({
      where: { id: input.customerId, isDeleted: false },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException(`Customer with ID ${input.customerId} not found`);

    if (input.priceOverride !== undefined && !isSuperAdminRole(actor.role?.name)) {
      throw new ForbiddenException("Only a Super Admin can override the computed price");
    }

    const booking = await BookingService.createBooking(
      {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        bookingDate: input.bookingDate,
        startTime: input.startTime,
        endTime: input.endTime,
        startPoint: input.startPoint,
        endPoint: input.endPoint,
        serviceType: input.serviceType,
        destinationId: input.destinationId,
        eventType: input.eventType,
        notes: input.notes,
      },
      actor
    );

    const computedPrice = booking.totalPrice;
    const finalPrice = input.priceOverride ?? computedPrice;
    const data: Prisma.BookingsUpdateInput = { status: BookingStatus.CONFIRMED };

    if (input.priceOverride !== undefined && input.priceOverride !== computedPrice) {
      data.totalPrice = finalPrice;
      // An overridden price replaces any discount that was computed.
      data.packageDiscount = 0;
      data.referralDiscount = 0;
      const { depositRate } = await SettingsService.get();
      data.depositRequired = Math.round(finalPrice * (depositRate / 100) * 100) / 100;
      data.notes = [booking.notes, `[price override: ${computedPrice} → ${finalPrice}]`].filter(Boolean).join("\n");
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const b = await tx.bookings.update({ where: { id: booking.id }, data });
      if (input.markPaid) {
        await tx.payments.create({
          data: {
            bookingId: booking.id,
            userId: input.customerId,
            amount: finalPrice,
            paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
            status: PaymentRecordStatus.SUCCESS,
            paidAt: new Date(),
            transactionRef: `ADMIN-${actor.id.slice(0, 8)}`,
          },
        });
      }
      return b;
    });
    if (input.markPaid) {
      // Same path as any confirmed payment: sets depositPaid / paymentStatus.
      await PaymentService.recalculateBookingPaymentStatus(booking.id);
    }
    const final = await prismaClient.bookings.findUniqueOrThrow({ where: { id: booking.id } });

    await AuditService.record(actor, {
      action: AuditAction.CREATE,
      entityType: "booking",
      entityId: booking.id,
      entityLabel: `حجز #${bookingRef(booking.id)} (نيابة عن عميل)`,
      details: [
        customer.name,
        input.priceOverride !== undefined && input.priceOverride !== computedPrice ? `price: ${computedPrice} → ${finalPrice}` : "",
        input.markPaid ? "مدفوع مقدمًا" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });

    void updated;
    return { ...final, ref: bookingRef(final.id), computedPrice };
  }

  // ------------------------------------------------------- fleet pricing
  /** Drivers that can take a booking; with a car, only that car's drivers (main first). */
  public static async assignableDrivers(vehicleId?: string) {
    if (vehicleId) {
      const rows = await prismaClient.vehicleDrivers.findMany({
        where: { vehicleId, driver: { status: { in: [DriverStatus.ACTIVE, DriverStatus.ONTRIP] } } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: { driver: { select: { id: true, fullName: true, status: true } } },
      });
      return rows.map((r) => ({ ...r.driver, isPrimary: r.isPrimary }));
    }
    return prismaClient.drivers.findMany({
      where: { status: { in: [DriverStatus.ACTIVE, DriverStatus.ONTRIP] } },
      select: { id: true, fullName: true, status: true },
      orderBy: { fullName: "asc" },
    });
  }
}

export default AdminDashboardService;
