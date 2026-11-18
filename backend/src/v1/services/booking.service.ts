import prismaClient from "../utils/prismaClientHelper";
import {
  BookingStatus,
  TripStatus,
  VehicleStatus,
  DriverStatus,
  AvailabilityStatus,
  WaitlistStatus,
  NotificationRecipientType,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  PaymentStatus,
  DepositOutcome,
  WalletTransactionType,
  ServiceType,
  Prisma,
} from "../../../generated/prisma";
import { bookingRef } from "../utils/bookingRef";
import ServicePricing, { priceService } from "./service-pricing.service";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "../utils/errors";
import { PricingService, calculateEstimatedPrice } from "./pricing.service";
import MapsService, { LocationInput, RouteResult, toCoordinates } from "./maps.service";
import { getDriverIdForUser } from "./role.service";
import { isAdminRole, normalizeRoleName, USER_ROLES } from "../constants/roles";
import { addDays, dateKey, timeKey, zonedToInstant } from "../utils/businessTime";
import { isOvernight, minutesOf, nearbyDays, slotSpan, spansClash, tripMinutes } from "../utils/slots";
import { lockKeys, SCHEDULE_TX } from "../utils/locks";
import ReferralService from "./referral.service";
import SettingsService, { DEFAULT_SETTINGS } from "./settings.service";
import DiscountService from "./discount.service";
import FleetService from "./fleet.service";
import PackageService from "./package.service";

/** Same-day clash of two time slots (a slot whose end is before its start runs past midnight). */
export function checkSlotOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return spansClash(slotSpan(null, startA, endA), slotSpan(null, startB, endB));
}

/**
 * Defaults only. The live values are edited on the dashboard's Settings page
 * (SettingsService: bookingBufferMinutes, tripEarlyStartMinutes).
 */
export const BOOKING_BUFFER_MINUTES = DEFAULT_SETTINGS.bookingBufferMinutes;
export const TRIP_EARLY_START_MINUTES = DEFAULT_SETTINGS.tripEarlyStartMinutes;

/** Overlap check that also keeps BOOKING_BUFFER_MINUTES free between trips. */
export function checkSlotOverlapWithBuffer(startA: string, endA: string, startB: string, endB: string, buffer = BOOKING_BUFFER_MINUTES): boolean {
  return spansClash(slotSpan(null, startA, endA), slotSpan(null, startB, endB), buffer);
}

export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
    [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
    [BookingStatus.COMPLETED]: [],
    [BookingStatus.CANCELLED]: [],
  };
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function isValidTripTransition(from: TripStatus, to: TripStatus): boolean {
  const allowedTransitions: Record<TripStatus, TripStatus[]> = {
    [TripStatus.NOTSTARTED]: [TripStatus.INPROGRESS],
    [TripStatus.INPROGRESS]: [TripStatus.ARRIVED, TripStatus.COMPLETED],
    [TripStatus.ARRIVED]: [TripStatus.COMPLETED],
    [TripStatus.COMPLETED]: [],
  };
  return allowedTransitions[from]?.includes(to) ?? false;
}

export interface CreateBookingDTO {
  customerId?: string;
  vehicleId: string;
  driverId?: string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
  startPoint?: LocationInput;
  endPoint?: LocationInput;
  // Accepted and recorded, but never used for pricing - the server recomputes
  // both. Kept so a mismatch can be audited instead of silently discarded.
  distanceKm?: number;
  durationMinutes?: number;
  notes?: string;
  driverNotes?: string;
  packageId?: string;
  eventType?: string;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  /** Wedding / private trip / VIP pricing. Absent = the older per-km price. */
  serviceType?: ServiceType;
  destinationId?: string;
}

/**
 * Renders a location input as the human-readable label stored on the booking.
 * Free text passes through; coordinates become a "lat, lng" string.
 */
export const describePoint = (point: LocationInput | undefined | null): string => {
  if (point == null) return "";
  if (typeof point === "string") return point.trim();
  if ("label" in point && typeof point.label === "string" && point.label.trim()) {
    return point.label.trim();
  }
  const coords = toCoordinates(point);
  if (!coords) return "";
  return `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
};

/** Anything beyond this ratio is treated as a client/server disagreement. */
const DISTANCE_TOLERANCE_RATIO = 0.1;

export interface DistanceComparison {
  serverDistanceKm: number;
  serverDurationMinutes: number;
  claimedDistanceKm: number | null;
  claimedDurationMinutes: number | null;
  distanceDifferenceKm: number | null;
  withinTolerance: boolean;
}

export const compareDistance = (
  route: Pick<RouteResult, "distanceKm" | "durationMinutes">,
  claimedDistanceKm?: number,
  claimedDurationMinutes?: number
): DistanceComparison => {
  const claimed = typeof claimedDistanceKm === "number" ? claimedDistanceKm : null;
  const claimedDuration = typeof claimedDurationMinutes === "number" ? claimedDurationMinutes : null;
  const difference = claimed === null ? null : Math.round((claimed - route.distanceKm) * 100) / 100;

  return {
    serverDistanceKm: route.distanceKm,
    serverDurationMinutes: route.durationMinutes,
    claimedDistanceKm: claimed,
    claimedDurationMinutes: claimedDuration,
    distanceDifferenceKm: difference,
    // A zero-distance route has no meaningful relative tolerance, so any
    // positive claim is a mismatch and no claim at all is trivially fine.
    withinTolerance:
      claimed === null ||
      route.distanceKm < 0.05 ||
      Math.abs(difference as number) <= route.distanceKm * DISTANCE_TOLERANCE_RATIO,
  };
};

export interface ListBookingsParams {  page?: number;
  limit?: number;
  status?: BookingStatus;
  tripStatus?: TripStatus;
  bookingDate?: string;
  customerId?: string;
  driverId?: string;
  vehicleId?: string;
}

export type BookingParty = "admin" | "customer" | "driver";

/**
 * How `user` relates to a booking: an admin, the booking's customer, its
 * assigned driver, or nobody (null). Every per-booking endpoint goes through
 * this so one customer can never read or change another customer's booking.
 */
export async function bookingPartyOf(
  booking: { customerId: string; driverId: string },
  user: any
): Promise<BookingParty | null> {
  if (!user?.id) return null;
  const roleName = normalizeRoleName(typeof user.role === "string" ? user.role : user.role?.name);
  if (roleName !== null && isAdminRole(roleName)) return "admin";
  if (booking.customerId === user.id) return "customer";
  const driverId = await getDriverIdForUser(user.id);
  if (driverId !== null && driverId === booking.driverId) return "driver";
  return null;
}

export class BookingService {
  /** Pays a pending referral reward; never fails the trip if it can't. */
  public static async rewardReferral(bookingId: string) {
    try {
      await ReferralService.completeReferral(bookingId);
    } catch (err) {
      console.error("[referral] reward failed for booking", bookingId, err);
    }
  }

  public static async createBooking(data: CreateBookingDTO, authenticatedUser?: any) {
    // Only admins may book on someone else's behalf. Previously any customer
    // could pass another user's customerId and create a booking on their account.
    if (data.customerId && authenticatedUser && data.customerId !== authenticatedUser.id) {
      const roleName = normalizeRoleName(
        typeof authenticatedUser.role === "string" ? authenticatedUser.role : authenticatedUser.role?.name
      );
      if (roleName === null || !isAdminRole(roleName)) {
        throw new ForbiddenException("Only admins can create a booking for another customer");
      }
    }
    const customerId = data.customerId || authenticatedUser?.id;
    if (!customerId) {
      throw new BadRequestException("customerId is required to create a booking");
    }

    // Past date check
    // Cairo calendar day, not UTC (UTC rejected "today" between 00:00 and 02:00).
    const todayStr = dateKey();
    if (data.bookingDate < todayStr) {
      throw new BadRequestException("Cannot book a trip for a past date");
    }
    // Today: the start time can't be gone already (15 minutes' grace for a
    // booking made at the door).
    if (data.bookingDate === todayStr && minutesOf(data.startTime) < minutesOf(timeKey()) - 15) {
      throw new BadRequestException("This start time has already passed");
    }

    const settings = await SettingsService.get();
    if (data.bookingDate > addDays(todayStr, settings.maxAdvanceBookingDays)) {
      throw new BadRequestException(`Trips can be booked up to ${settings.maxAdvanceBookingDays} days ahead`);
    }
    // An end time earlier than the start means the trip ends the next morning.
    const overnight = isOvernight(data.startTime, data.endTime);
    if (overnight && (settings.overnightLatestEndHour === 0 || minutesOf(data.endTime) > settings.overnightLatestEndHour * 60)) {
      throw new BadRequestException(
        settings.overnightLatestEndHour === 0
          ? "endTime must be later than startTime"
          : `A trip can run past midnight but must end by ${String(settings.overnightLatestEndHour).padStart(2, "0")}:00`
      );
    }
    if (tripMinutes(data.startTime, data.endTime) < settings.minTripMinutes) {
      throw new BadRequestException(`A trip must be at least ${settings.minTripMinutes} minutes long`);
    }
    // Trips on the day before can run into this one, and an overnight trip
    // reaches the next day, so clashes are checked across three days.
    const span = slotSpan(data.bookingDate, data.startTime, data.endTime);
    const clashes = (t: { bookingDate: string; startTime: string; endTime: string }) =>
      spansClash(span, slotSpan(t.bookingDate, t.startTime, t.endTime), settings.bookingBufferMinutes);

    const created = await prismaClient.$transaction(async (tx) => {
      // One booking at a time per car: without this, two requests for
      // overlapping times both passed the checks below and both were saved.
      await lockKeys(tx, [`vehicle:${data.vehicleId}`]);
      // 1. Vehicle check
      const vehicle = await tx.vehicles.findUnique({
        where: { id: data.vehicleId },
      });
      if (!vehicle) {
        throw new NotFoundException(`Vehicle with ID ${data.vehicleId} not found`);
      }
      if (vehicle.retiredAt) {
        throw new BadRequestException("This car is no longer available");
      }
      // Service pricing decides the default points too (a trip starts at the company).
      const service = data.serviceType
        ? await ServicePricing.resolve(tx, { serviceType: data.serviceType, vehicleId: data.vehicleId, destinationId: data.destinationId, startPoint: data.startPoint, endPoint: data.endPoint }, settings)
        : null;
      const startPoint = service ? service.startPoint : data.startPoint;
      const endPoint = service ? service.endPoint : data.endPoint;
      if (
        (await FleetService.maintenanceOn(tx, vehicle.id, data.bookingDate)) ||
        (overnight && (await FleetService.maintenanceOn(tx, vehicle.id, addDays(data.bookingDate, 1))))
      ) {
        throw new BadRequestException("This car is in maintenance on that day");
      }

      const normalizedDate = new Date(`${data.bookingDate}T00:00:00.000Z`);

      // 3. VehicleAvailability check
      // A day is only closed when it is BLOCKED (e.g. maintenance). BOOKED just
      // means the vehicle has at least one trip that day; several trips per day
      // are allowed as long as their times don't overlap (checked below).
      const existingAvailability = await tx.vehicleAvailability.findFirst({
        where: {
          vehicleId: data.vehicleId,
          date: normalizedDate,
          status: AvailabilityStatus.BLOCKED,
        },
      });
      if (existingAvailability) {
        throw new ConflictException("Vehicle is blocked for the specified date");
      }

      // 3b. The car itself first, so the customer hears the clear reason
      // ("too close to its previous trip") rather than "no driver is free".
      const carTrips = await tx.bookings.findMany({
        where: { bookingDate: { in: nearbyDays(data.bookingDate) }, vehicleId: data.vehicleId, status: { not: BookingStatus.CANCELLED } },
        select: { bookingDate: true, startTime: true, endTime: true },
      });
      if (carTrips.some(clashes)) {
        throw new ConflictException(`Vehicle or driver has a booking within ${settings.bookingBufferMinutes} minutes of this time slot`);
      }

      // 3c. Driver: only the car's own drivers may drive it (assigned by an admin
      // on the fleet page). An explicit driver must be one of them; otherwise
      // the main driver is tried first, then the others, skipping anyone off,
      // on leave or busy at that time. It used to take the first ACTIVE driver
      // in the whole system, and failed with 409 when that one was busy.
      const driverId = await FleetService.pickDriver(tx, {
        vehicleId: vehicle.id,
        driverId: data.driverId,
        bookingDate: data.bookingDate,
        startTime: data.startTime,
        endTime: data.endTime,
        overlaps: clashes,
      });

      // 3d. Re-check the car AND the chosen driver together, once no other
      // booking for this driver (on another car) can be in progress.
      await lockKeys(tx, [`driver:${driverId}`]);
      const existingBookings = await tx.bookings.findMany({
        where: {
          bookingDate: { in: nearbyDays(data.bookingDate) },
          status: { not: BookingStatus.CANCELLED },
          OR: [
            { vehicleId: data.vehicleId },
            { driverId: driverId },
          ],
        },
      });

      for (const existing of existingBookings) {
        if (clashes(existing)) {
          throw new ConflictException(
            `Vehicle or driver has a booking within ${settings.bookingBufferMinutes} minutes of this time slot`
          );
        }
      }

      // 5. Resolve the route server-side.
      //
      // distanceKm used to be taken straight from the request and fed into the
      // price, so a client could book a 400 km trip for the base fee. It is now
      // always recomputed from the endpoints; the client's figure is only kept
      // alongside it for auditing.
      const route = await MapsService.route(startPoint, endPoint);

      // 6. Discounts: the customer's own active package (% set by an admin) and
      // the referral discount on a referred customer's first booking.
      const pkg = await DiscountService.resolvePackage(tx, data.packageId, customerId, true);
      const referralDiscount = await DiscountService.referralDiscount(tx, customerId);

      // 7. Price: by service type (fixed prices, itemised), or the older per-km formula.
      const servicePrice = service
        ? priceService({
            ...service.input,
            bookedMinutes: tripMinutes(data.startTime, data.endTime),
            distanceKm: route.distanceKm,
            packageDiscountPercent: pkg?.discountPercentage ?? 0,
            referralDiscount,
            depositRate: settings.depositRate,
          })
        : null;
      const priceEstimate = servicePrice ? { ...servicePrice.breakdown, depositPaid: servicePrice.depositRequired } : calculateEstimatedPrice({
        packageDiscountPercent: pkg?.discountPercentage ?? 0,
        referralDiscount,
        vehicleCategory: vehicle.category,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        // The client's surgeMultiplier is ignored: the peak surge comes from Settings.
        isPeakHour: data.isPeakHour,
        depositRate: settings.depositRate,
        peakSurgeMultiplier: settings.peakSurgeMultiplier,
        categoryRates: settings.categoryRates,
        basePrice: vehicle.basePrice > 0 ? vehicle.basePrice : undefined,
        pricePerKm: vehicle.pricePerKm > 0 ? vehicle.pricePerKm : undefined,
        pricePerHour: vehicle.pricePerHour > 0 ? vehicle.pricePerHour : undefined,
      });

      // 7. Create Booking Record
      const newBooking = await tx.bookings.create({
        data: {
          customerId: customerId,
          vehicleId: data.vehicleId,
          driverId: driverId,
          packageId: data.packageId || null,
          eventType: data.eventType || "",
          startPoint: describePoint(startPoint),
          endPoint: describePoint(endPoint),
          serviceType: data.serviceType ?? null,
          destinationId: service?.destination?.id ?? null,
          priceLines: servicePrice ? (servicePrice.lines as unknown as Prisma.InputJsonValue) : undefined,
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
          startLat: route.start.latitude,
          startLng: route.start.longitude,
          endLat: route.end.latitude,
          endLng: route.end.longitude,
          distanceSource: route.source,
          claimedDistanceKm: typeof data.distanceKm === "number" ? data.distanceKm : null,
          claimedDurationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : null,
          bookingDate: data.bookingDate,
          startTime: data.startTime,
          endTime: data.endTime,
          status: BookingStatus.PENDING,
          tripStatus: TripStatus.NOTSTARTED,
          basePrice: priceEstimate.basePrice,
          distancePrice: priceEstimate.distancePrice,
          totalPrice: priceEstimate.totalPrice,
          packageDiscount: priceEstimate.packageDiscount,
          referralDiscount: priceEstimate.referralDiscount,
          depositRequired: priceEstimate.depositPaid,
          depositPaid: 0,
          paymentStatus: PaymentStatus.UNPAID,
          notes: data.notes || "",
          driverNotes: data.driverNotes || "",
        },
      });

      // 7. Upsert VehicleAvailability record
      await tx.vehicleAvailability.upsert({
        where: {
          vehicleId_date: {
            vehicleId: data.vehicleId,
            date: normalizedDate,
          },
        },
        create: {
          vehicleId: data.vehicleId,
          date: normalizedDate,
          status: AvailabilityStatus.BOOKED,
          bookingId: newBooking.id,
          reason: "Booking created",
        },
        update: {
          status: AvailabilityStatus.BOOKED,
          reason: "Booking created",
        },
      });

      return newBooking;
    }, SCHEDULE_TX);

    // The package's total is the sum of its bookings' (discounted) prices.
    if (created.packageId) await PackageService.recalculatePackageTotal(created.packageId);
    return created;
  }

  /**
   * What cancelling a booking would do to the money already paid.
   *
   * Policy (Settings): cancelled at least `freeCancellationHours` before the
   * start -> everything paid goes back to the customer's wallet. Later -> the
   * deposit is kept and anything paid above it goes back. An admin may decide
   * either way (`refundDeposit`), e.g. when the company cancels.
   */
  public static cancellationTerms(
    booking: { bookingDate: string; startTime: string; depositPaid: number; depositRequired: number },
    freeCancellationHours: number,
    refundDeposit?: boolean,
    now = Date.now()
  ) {
    const paid = Math.max(0, Math.round(booking.depositPaid * 100) / 100);
    const startsAt = zonedToInstant(booking.bookingDate, booking.startTime).getTime();
    const freeUntil = new Date(startsAt - freeCancellationHours * 3_600_000);
    const free = refundDeposit ?? now <= freeUntil.getTime();
    const kept = free ? 0 : Math.min(paid, Math.max(0, booking.depositRequired));
    const refund = Math.round((paid - kept) * 100) / 100;
    const outcome: DepositOutcome | null = paid <= 0 ? null : kept > 0 ? DepositOutcome.KEPT : DepositOutcome.REFUNDED;
    return { paid, refund, kept, outcome, freeUntil: freeUntil.toISOString(), freeCancellationHours, overridden: refundDeposit !== undefined };
  }

  public static async getCancellationTerms(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    const settings = await SettingsService.get();
    return this.cancellationTerms(booking, settings.freeCancellationHours);
  }

  public static async cancelBooking(bookingId: string, cancelledByUserId?: string, opts: { refundDeposit?: boolean } = {}) {
    const { freeCancellationHours } = await SettingsService.get();
    return await prismaClient.$transaction(async (tx) => {
      const booking = await tx.bookings.findUnique({
        where: { id: bookingId },
        include: {
          customer: true,
          vehicle: true,
          driver: true,
        },
      });

      if (!booking) {
        throw new NotFoundException(`Booking with ID ${bookingId} not found`);
      }

      // Idempotent check: if already CANCELLED, return cleanly without error
      if (booking.status === BookingStatus.CANCELLED) {
        return { booking, promotedWaitlistEntry: null, cancellation: null };
      }

      // Transition validity check
      if (!isValidBookingTransition(booking.status, BookingStatus.CANCELLED)) {
        throw new BadRequestException(`Cannot cancel booking with status ${booking.status}`);
      }

      // 1. Update Booking status to CANCELLED, settling the deposit by the
      //    cancellation policy. A refund is credited to the customer's wallet.
      const terms = BookingService.cancellationTerms(booking, freeCancellationHours, opts.refundDeposit);
      // Claim the cancellation atomically: of several cancels arriving together
      // only one changes the row, so the deposit is refunded once. (Each used to
      // read "not cancelled yet" and refund it again.)
      const claimed = await tx.bookings.updateMany({
        where: { id: bookingId, status: { not: BookingStatus.CANCELLED } },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: cancelledByUserId ?? null,
          depositOutcome: terms.outcome,
          depositRefunded: terms.refund,
        },
      });
      const updatedBooking = await tx.bookings.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true, vehicle: true, driver: true } });
      if (claimed.count === 0) {
        return { booking: updatedBooking, promotedWaitlistEntry: null, cancellation: null };
      }
      if (terms.refund > 0) {
        await tx.walletTransactions.create({
          data: {
            userId: booking.customerId,
            amount: terms.refund,
            type: WalletTransactionType.REFUND,
            description: `Refund for cancelled booking ${bookingRef(booking.id)}`,
          },
        });
      }

      // 2. Release the vehicle's day — but only if no other active trip of
      //    this vehicle remains that day, and never over a BLOCKED day.
      const normalizedDate = new Date(`${booking.bookingDate}T00:00:00.000Z`);
      const dayRow = await tx.vehicleAvailability.findUnique({
        where: { vehicleId_date: { vehicleId: booking.vehicleId, date: normalizedDate } },
      });
      if (dayRow && dayRow.status !== AvailabilityStatus.BLOCKED) {
        const stillBooked = await tx.bookings.findFirst({
          where: {
            vehicleId: booking.vehicleId,
            bookingDate: booking.bookingDate,
            status: { not: BookingStatus.CANCELLED },
            id: { not: bookingId },
          },
          select: { id: true },
        });
        await tx.vehicleAvailability.update({
          where: { id: dayRow.id },
          data: stillBooked
            ? { status: AvailabilityStatus.BOOKED, bookingId: stillBooked.id, reason: "Booking cancelled; other trips remain" }
            : { status: AvailabilityStatus.AVAILABLE, bookingId: null, reason: "Booking cancelled" },
        });
      }

      // 3. Release Driver if driver was ONTRIP
      if (booking.driverId) {
        const driver = await tx.drivers.findUnique({
          where: { id: booking.driverId },
        });
        if (driver && driver.status === DriverStatus.ONTRIP) {
          await tx.drivers.update({
            where: { id: booking.driverId },
            data: { status: DriverStatus.ACTIVE },
          });
        }
      }

      // 4. Query Waitlist for top position waiting customer
      const rawWaitlist = await tx.waitlist.findMany({
        where: {
          vehicleId: booking.vehicleId,
          requestedDate: booking.bookingDate,
          status: WaitlistStatus.WAITING,
        },
        orderBy: { position: "asc" },
      });

      // Filter out invalid or corrupted entries (missing customerId or invalid position)
      const validWaitlist = rawWaitlist.filter(
        (w) => w.customerId !== null && w.customerId !== "" && w.position > 0
      );

      let promotedWaitlistEntry: any = null;

      if (validWaitlist.length > 0) {
        const topEntry = validWaitlist[0];
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h timer

        promotedWaitlistEntry = await tx.waitlist.update({
          where: { id: topEntry.id },
          data: {
            status: WaitlistStatus.NOTIFIED,
            notifiedAt: now,
            expiresAt: expiresAt,
          },
        });

        // Queue a ScheduledNotifications push notification
        await tx.scheduledNotifications.create({
          data: {
            bookingId: booking.id,
            recipientId: topEntry.customerId,
            recipientType: NotificationRecipientType.CUSTOMER,
            notificationType: NotificationType.SYSTEM,
            channel: NotificationChannel.PUSH,
            title: "Waitlist Promotion Notice",
            body: "A vehicle you were waiting for has become available. Complete your booking within 24 hours!",
            scheduledAt: now,
            status: NotificationStatus.SCHEDULED,
          },
        });
      }

      return { booking: updatedBooking, promotedWaitlistEntry, cancellation: terms };
    });
  }

  public static async updateBookingStatus(
    bookingId: string,
    newStatus: BookingStatus,
    user?: any
  ) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Authorization first, so someone with no part in the booking can't learn
    // that it exists or what state it is in from the error.
    // Previously any signed-in user could confirm, complete or cancel any booking by id.
    if (user) {
      const party = await bookingPartyOf(booking, user);
      if (party === null) {
        throw new NotFoundException(`Booking with ID ${bookingId} not found`);
      }
      const allowed: Record<BookingParty, BookingStatus[]> = {
        admin: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.CANCELLED],
        driver: [BookingStatus.CONFIRMED],
        // A customer's booking is confirmed by paying the deposit (automatic)
        // or by the driver/admin — never by the customer directly.
        customer: [BookingStatus.CANCELLED],
      };
      if (!allowed[party].includes(newStatus)) {
        throw new ForbiddenException(`You cannot set this booking to ${newStatus}`);
      }
    }

    if (!isValidBookingTransition(booking.status, newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${booking.status} to ${newStatus}`
      );
    }

    // Cancelling must release the vehicle day and promote the waitlist, exactly
    // like DELETE /bookings/:id. A bare status update used to leave the vehicle
    // blocked for that date.
    if (newStatus === BookingStatus.CANCELLED) {
      const result = await this.cancelBooking(bookingId, user?.id);
      return result.booking;
    }

    const updated = await prismaClient.bookings.update({
      where: { id: bookingId },
      data: { status: newStatus },
    });

    if (newStatus === BookingStatus.COMPLETED) {
      await BookingService.rewardReferral(bookingId);
    }

    return updated;
  }

  public static async updateTripStatus(
    bookingId: string,
    newTripStatus: TripStatus,
    user?: any
  ) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Role boundary check first: only admins and the assigned driver may advance
    // a trip. The booking's customer is told no; anyone else gets 404 so the
    // error doesn't reveal the booking or its state. A missing role fails closed.
    if (user) {
        const roleName = normalizeRoleName(
            typeof user.role === "string" ? user.role : user.role?.name
        );

        if (roleName === null || !isAdminRole(roleName)) {
            const driverId = await getDriverIdForUser(user.id);
            const isAssignedDriver = driverId !== null && driverId === booking.driverId;

            if (!isAssignedDriver) {
                if (user.id === booking.customerId) {
                    throw new ForbiddenException("Only the assigned driver or an admin can update trip status");
                }
                throw new NotFoundException(`Booking with ID ${bookingId} not found`);
            }
        }
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException("Cannot update trip status on a cancelled booking");
    }

    if (!isValidTripTransition(booking.tripStatus, newTripStatus)) {
      throw new BadRequestException(
        `Invalid trip status transition from ${booking.tripStatus} to ${newTripStatus}`
      );
    }

    // A trip runs only on a confirmed booking (deposit paid, or confirmed by the
    // driver/admin). Otherwise the trip completes while the booking stays
    // PENDING: no revenue, no referral reward, wrong dashboard numbers.
    if (newTripStatus === TripStatus.INPROGRESS && booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException("Confirm the booking before starting the trip");
    }

    // Drivers can start a trip at most TRIP_EARLY_START_MINUTES before its slot
    // (Cairo time); otherwise a booking days away would show as "live" on the
    // dashboard and could be completed early. Admins are exempt.
    if (newTripStatus === TripStatus.INPROGRESS && user) {
      const roleName = normalizeRoleName(typeof user.role === "string" ? user.role : user.role?.name);
      if (roleName === null || !isAdminRole(roleName)) {
        const { tripEarlyStartMinutes } = await SettingsService.get();
        const slotStart = zonedToInstant(booking.bookingDate, booking.startTime).getTime();
        if (Date.now() < slotStart - tripEarlyStartMinutes * 60_000) {
          throw new BadRequestException(
            `This trip can be started from ${tripEarlyStartMinutes} minutes before its scheduled time`
          );
        }
      }
    }

    const updateData: any = { tripStatus: newTripStatus };
    if (newTripStatus === TripStatus.INPROGRESS && !booking.tripStartedAt) {
      updateData.tripStartedAt = new Date();
    }
    if (newTripStatus === TripStatus.COMPLETED) {
      updateData.tripCompletedAt = new Date();
    }

    // If trip completed, auto complete booking if status was confirmed/pending
    if (
      newTripStatus === TripStatus.COMPLETED &&
      isValidBookingTransition(booking.status, BookingStatus.COMPLETED)
    ) {
      updateData.status = BookingStatus.COMPLETED;
    }

    const updated = await prismaClient.bookings.update({
      where: { id: bookingId },
      data: updateData,
    });

    if (updated.status === BookingStatus.COMPLETED) {
      await BookingService.rewardReferral(bookingId);
    }

    // Update driver status dynamically
    if (booking.driverId) {
      if (newTripStatus === TripStatus.INPROGRESS) {
        await prismaClient.drivers.update({
          where: { id: booking.driverId },
          data: { status: DriverStatus.ONTRIP },
        }).catch(() => {});
      } else if (newTripStatus === TripStatus.COMPLETED) {
        await prismaClient.drivers.update({
          where: { id: booking.driverId },
          data: { status: DriverStatus.ACTIVE },
        }).catch(() => {});
      }
    }

    return updated;
  }

  public static async listBookings(params: ListBookingsParams, user?: any) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.status) where.status = params.status;
    if (params.tripStatus) where.tripStatus = params.tripStatus;
    if (params.bookingDate) where.bookingDate = params.bookingDate;
    if (params.customerId) where.customerId = params.customerId;
    if (params.driverId) where.driverId = params.driverId;
    if (params.vehicleId) where.vehicleId = params.vehicleId;

    // Scope the result set to what the caller is entitled to see. Admins see
    // everything; everyone else is pinned to their own rows. Previously an
    // absent role skipped this block entirely and returned every booking.
    if (user && !isAdminRole(typeof user.role === "string" ? user.role : user.role?.name)) {
      const roleName = normalizeRoleName(
        typeof user.role === "string" ? user.role : user.role?.name
      );

      if (roleName === USER_ROLES.DRIVER) {
        // Bookings.driverId references Drivers.id, not Users.id.
        const driverId = await getDriverIdForUser(user.id);
        where.driverId = driverId ?? "__no_driver_profile__";
      } else {
        where.customerId = user.id;
      }
    }

    const [items, total] = await Promise.all([
      prismaClient.bookings.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: true,
          customer: {
            select: { id: true, email: true, name: true, phoneNumber: true },
          },
          driver: {
            select: { id: true, fullName: true, status: true },
          },
        },
      }),
      prismaClient.bookings.count({ where }),
    ]);

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  public static async getBookingById(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
      include: {
        vehicle: true,
        customer: {
          select: { id: true, email: true, name: true, phoneNumber: true },
        },
        driver: {
          select: { id: true, fullName: true, status: true },
        },
        payments: true,
        reviews: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    return booking;
  }
}

export default BookingService;
