import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import {
  DriverStatus,
  BookingStatus,
  TripStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "../utils/errors";

const DriverProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, "Name is too short").max(80),
    licenseNumber: z.string().trim().min(3).max(40),
    licenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "licenseExpiry must be YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date"),
  })
  .partial(); // other fields are ignored, not refused, so older app versions keep working

export class DriverService {
  public static async getDriverProfile(userId: string) {
    const driver = await prismaClient.drivers.findUnique({
      where: { userId },
      include: {
        user: {
          select: { id: true, email: true, name: true, phoneNumber: true, preferredLanguage: true, pic: true },
        },
        vehicleDrivers: {
          include: {
            vehicle: true,
          },
        },
      },
    });

    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    return driver;
  }

  public static async updateDriverProfile(userId: string, data: any) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    // Only these, checked. `pic` used to take any text (an outside link would
    // then load in the dashboard); the photo is uploaded with PUT /auth/me/photo.
    const input = DriverProfileSchema.parse(data ?? {});
    const updated = await prismaClient.drivers.update({
      where: { id: driver.id },
      data: {
        ...(input.fullName && { fullName: input.fullName }),
        ...(input.licenseNumber && { licenseNumber: input.licenseNumber }),
        ...(input.licenseExpiry && { licenseExpiry: new Date(`${input.licenseExpiry}T00:00:00.000Z`) }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
    // The account name shows in the dashboard and on reviews; keep it in step.
    if (input.fullName) await prismaClient.users.update({ where: { id: userId }, data: { name: input.fullName } });
    return updated;
  }

  public static async toggleDriverStatus(userId: string, status: DriverStatus) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    if (!Object.values(DriverStatus).includes(status)) {
      throw new BadRequestException(`status must be one of ${Object.values(DriverStatus).filter((x) => x !== DriverStatus.ONTRIP).join(", ")}`);
    }
    if (status === DriverStatus.ONTRIP) {
      throw new BadRequestException("Cannot manually set status to ONTRIP; this is managed by trip lifecycle");
    }

    // A leave/off status set by an admin can only be lifted by an admin.
    if (driver.statusSetByAdmin && driver.status !== status) {
      throw new ForbiddenException("Your status was set by the administration; contact them to change it");
    }

    return await prismaClient.drivers.update({
      where: { id: driver.id },
      data: { status, statusSetByAdmin: false },
    });
  }

  public static async listDriverBookings(
    userId: string,
    params: { filter?: string; page?: number; limit?: number }
  ) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 10;
    const skip = (page - 1) * limit;

    const today = new Date().toISOString().split("T")[0];
    const where: any = { driverId: driver.id };

    if (params.filter === "today") {
      where.bookingDate = today;
      where.status = { not: BookingStatus.CANCELLED };
    } else if (params.filter === "upcoming") {
      where.bookingDate = { gte: today };
      where.status = { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] };
    } else if (params.filter === "completed") {
      where.status = BookingStatus.COMPLETED;
    }

    const [items, total] = await Promise.all([
      prismaClient.bookings.findMany({
        where,
        skip,
        take: limit,
        orderBy: { bookingDate: "desc" },
        include: {
          vehicle: true,
          customer: {
            select: { id: true, name: true, phoneNumber: true },
          },
        },
      }),
      prismaClient.bookings.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async getDriverStats(userId: string) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    const today = new Date().toISOString().split("T")[0];

    const [totalTrips, completedTrips, todayTrips, totalRevenue, averageRating] = await Promise.all([
      prismaClient.bookings.count({
        where: { driverId: driver.id, status: { not: BookingStatus.CANCELLED } },
      }),
      prismaClient.bookings.count({
        where: { driverId: driver.id, status: BookingStatus.COMPLETED },
      }),
      prismaClient.bookings.count({
        where: { driverId: driver.id, bookingDate: today, status: { not: BookingStatus.CANCELLED } },
      }),
      prismaClient.bookings.aggregate({
        where: { driverId: driver.id, status: BookingStatus.COMPLETED },
        _sum: { totalPrice: true },
      }),
      prismaClient.reviews.aggregate({
        where: { revieweeId: driver.userId },
        _avg: { overallRating: true },
      }),
    ]);

    // Money to the piaster, split the same way as the dashboard
    // (AdminDashboardService.driverAnalytics): share first, net = gross - share.
    const gross = Math.round((totalRevenue._sum.totalPrice || 0) * 100) / 100;
    const companyShare = Math.round(gross * (driver.commissionRate / 100) * 100) / 100;
    return {
      totalTrips,
      completedTrips,
      todayTrips,
      totalRevenue: gross,
      // Same split the admin dashboard shows for this driver.
      commissionRate: driver.commissionRate,
      companyShare,
      netEarnings: Math.round((gross - companyShare) * 100) / 100,
      averageRating: averageRating._avg.overallRating || 5.0,
      rating: driver.rating,
    };
  }

  public static async getDriverById(driverId: string) {
    // Public endpoint (no auth): only what a customer needs to see about their
    // driver. Previously it exposed license number/expiry, commission, email,
    // phone and internal flags.
    const driver = await prismaClient.drivers.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        fullName: true,
        pic: true,
        rating: true,
        status: true,
        vehicleDrivers: {
          select: { isPrimary: true, vehicle: { select: { id: true, make: true, model: true, color: true, category: true, year: true } } },
        },
      },
    });

    if (!driver) {
      throw new NotFoundException(`Driver with ID ${driverId} not found`);
    }

    return driver;
  }
}

export default DriverService;
