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
} from "../../../generated/prisma";
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
import { dateKey, zonedToInstant } from "../utils/businessTime";
import ReferralService from "./referral.service";

export function checkSlotOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const toMins = (t: string) => {
    if (!t) return 0;
    const parts = t.split(":");
    const h = parseInt(parts[0] || "0", 10);
    const m = parseInt(parts[1] || "0", 10);
    return h * 60 + m;
  };
  const sA = toMins(startA);
  const eA = toMins(endA);
  const sB = toMins(startB);
  const eB = toMins(endB);
  return sA < eB && sB < eA;
}

/** Turnaround between two trips of the same vehicle or driver (cleaning, travel). */
export const BOOKING_BUFFER_MINUTES = Number(process.env.BOOKING_BUFFER_MINUTES ?? 60);
/** How early (before the slot) a driver may start a trip. Admins are exempt. */
export const TRIP_EARLY_START_MINUTES = Number(process.env.TRIP_EARLY_START_MINUTES ?? 120);

const shiftTime = (t: string, minutes: number) => {
  const [h, m] = (t || "00:00").split(":").map((x) => parseInt(x || "0", 10));
  const total = Math.min(24 * 60, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Overlap check that also keeps BOOKING_BUFFER_MINUTES free between trips. */
export function checkSlotOverlapWithBuffer(startA: string, endA: string, startB: string, endB: string, buffer = BOOKING_BUFFER_MINUTES): boolean {
  return checkSlotOverlap(startA, endA, shiftTime(startB, -buffer), shiftTime(endB, buffer));
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

    return await prismaClient.$transaction(async (tx) => {
      // 1. Vehicle check
      const vehicle = await tx.vehicles.findUnique({
        where: { id: data.vehicleId },
      });
      if (!vehicle) {
        throw new NotFoundException(`Vehicle with ID ${data.vehicleId} not found`);
      }
      if (vehicle.status === VehicleStatus.MAINTENANCE) {
        throw new BadRequestException("Vehicle is under maintenance and unavailable for booking");
      }

      // 2. Driver check (if provided or auto-assign)
      let driverId = data.driverId;
      if (driverId) {
        const driver = await tx.drivers.findUnique({
          where: { id: driverId },
        });
        if (!driver) {
          throw new NotFoundException(`Driver with ID ${driverId} not found`);
        }
        if (driver.status === DriverStatus.OFF || driver.status === DriverStatus.ONLEAVE) {
          throw new BadRequestException("Assigned driver is currently OFF or ON LEAVE");
        }
      } else {
        // Only genuinely available drivers may be auto-assigned. The previous
        // "fall back to any driver record" branch happily assigned an OFF,
        // ONLEAVE or ONTRIP driver - the exact drivers the explicit-assignment
        // branch above rejects.
        const activeDriver = await tx.drivers.findFirst({
          where: { status: DriverStatus.ACTIVE },
          orderBy: { createdAt: "asc" },
        });
        if (!activeDriver) {
          throw new BadRequestException("No active driver available for assignment");
        }
        driverId = activeDriver.id;
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

      // 4. Overlapping active bookings check for vehicle AND driver
      const existingBookings = await tx.bookings.findMany({
        where: {
          bookingDate: data.bookingDate,
          status: { not: BookingStatus.CANCELLED },
          OR: [
            { vehicleId: data.vehicleId },
            { driverId: driverId },
          ],
        },
      });

      for (const existing of existingBookings) {
        if (checkSlotOverlapWithBuffer(data.startTime, data.endTime, existing.startTime, existing.endTime)) {
          throw new ConflictException(
            `Vehicle or driver has a booking within ${BOOKING_BUFFER_MINUTES} minutes of this time slot`
          );
        }
      }

      // 5. Resolve the route server-side.
      //
      // distanceKm used to be taken straight from the request and fed into the
      // price, so a client could book a 400 km trip for the base fee. It is now
      // always recomputed from the endpoints; the client's figure is only kept
      // alongside it for auditing.
      const route = await MapsService.route(data.startPoint, data.endPoint);

      // 6. Calculate price estimate from the server-computed distance
      const priceEstimate = calculateEstimatedPrice({
        vehicleCategory: vehicle.category,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        isPeakHour: data.isPeakHour,
        surgeMultiplier: data.surgeMultiplier,
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
          startPoint: describePoint(data.startPoint),
          endPoint: describePoint(data.endPoint),
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
    });
  }

  public static async cancelBooking(bookingId: string, cancelledByUserId?: string) {
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
        return { booking, promotedWaitlistEntry: null };
      }

      // Transition validity check
      if (!isValidBookingTransition(booking.status, BookingStatus.CANCELLED)) {
        throw new BadRequestException(`Cannot cancel booking with status ${booking.status}`);
      }

      // 1. Update Booking status to CANCELLED
      const updatedBooking = await tx.bookings.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
      });

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

      return { booking: updatedBooking, promotedWaitlistEntry };
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

    if (!isValidBookingTransition(booking.status, newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${booking.status} to ${newStatus}`
      );
    }

    // Authorization. Previously any signed-in user could confirm, complete or
    // cancel any booking by id.
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

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException("Cannot update trip status on a cancelled booking");
    }

    if (!isValidTripTransition(booking.tripStatus, newTripStatus)) {
      throw new BadRequestException(
        `Invalid trip status transition from ${booking.tripStatus} to ${newTripStatus}`
      );
    }

    // Role boundary check: only admins and the assigned driver may advance a trip.
    // A missing role fails closed - previously `if (user && user.role)` let a
    // role-less user through entirely.
    if (user) {
        const roleName = normalizeRoleName(
            typeof user.role === "string" ? user.role : user.role?.name
        );

        if (roleName === null || !isAdminRole(roleName)) {
            const driverId = await getDriverIdForUser(user.id);
            const isAssignedDriver = driverId !== null && driverId === booking.driverId;

            if (!isAssignedDriver) {
                throw new ForbiddenException("Only the assigned driver or an admin can update trip status");
            }
        }
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
        const slotStart = zonedToInstant(booking.bookingDate, booking.startTime).getTime();
        if (Date.now() < slotStart - TRIP_EARLY_START_MINUTES * 60_000) {
          throw new BadRequestException(
            `This trip can be started from ${TRIP_EARLY_START_MINUTES} minutes before its scheduled time`
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
