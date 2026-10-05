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

export class BookingService {
  public static async createBooking(data: CreateBookingDTO, authenticatedUser?: any) {
    const customerId = data.customerId || authenticatedUser?.id;
    if (!customerId) {
      throw new BadRequestException("customerId is required to create a booking");
    }

    // Past date check
    const todayStr = new Date().toISOString().split("T")[0];
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
      const existingAvailability = await tx.vehicleAvailability.findFirst({
        where: {
          vehicleId: data.vehicleId,
          date: normalizedDate,
          status: { in: [AvailabilityStatus.BOOKED, AvailabilityStatus.BLOCKED] },
        },
      });
      if (existingAvailability) {
        throw new ConflictException(
          "Vehicle is already booked or blocked for the specified date"
        );
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
        if (checkSlotOverlap(data.startTime, data.endTime, existing.startTime, existing.endTime)) {
          throw new ConflictException(
            "Vehicle or driver has an overlapping booking for this time slot"
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
          depositPaid: priceEstimate.depositPaid,
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
          bookingId: newBooking.id,
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

      // 2. Release VehicleAvailability record back to AVAILABLE
      const normalizedDate = new Date(`${booking.bookingDate}T00:00:00.000Z`);
      const existingAvail = await tx.vehicleAvailability.findFirst({
        where: {
          vehicleId: booking.vehicleId,
          bookingId: bookingId,
        },
      });

      if (existingAvail) {
        await tx.vehicleAvailability.update({
          where: { id: existingAvail.id },
          data: {
            status: AvailabilityStatus.AVAILABLE,
            bookingId: null,
            reason: "Booking cancelled",
          },
        });
      } else {
        // Fallback upsert
        await tx.vehicleAvailability.upsert({
          where: {
            vehicleId_date: {
              vehicleId: booking.vehicleId,
              date: normalizedDate,
            },
          },
          create: {
            vehicleId: booking.vehicleId,
            date: normalizedDate,
            status: AvailabilityStatus.AVAILABLE,
            reason: "Booking cancelled",
          },
          update: {
            status: AvailabilityStatus.AVAILABLE,
            bookingId: null,
            reason: "Booking cancelled",
          },
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

    const updated = await prismaClient.bookings.update({
      where: { id: bookingId },
      data: { status: newStatus },
    });

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

    const updateData: any = { tripStatus: newTripStatus };

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
