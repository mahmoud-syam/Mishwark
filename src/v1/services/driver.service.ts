import prismaClient from "../utils/prismaClientHelper";
import {
  DriverStatus,
  BookingStatus,
  TripStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
} from "../utils/errors";

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

    return await prismaClient.drivers.update({
      where: { id: driver.id },
      data: {
        ...(data.fullName && { fullName: data.fullName }),
        ...(data.licenseNumber && { licenseNumber: data.licenseNumber }),
        ...(data.licenseExpiry && { licenseExpiry: new Date(data.licenseExpiry) }),
        ...(data.pic && { pic: data.pic }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  public static async toggleDriverStatus(userId: string, status: DriverStatus) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    if (status === DriverStatus.ONTRIP) {
      throw new BadRequestException("Cannot manually set status to ONTRIP; this is managed by trip lifecycle");
    }

    return await prismaClient.drivers.update({
      where: { id: driver.id },
      data: { status },
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

  public static async assignVehicle(userId: string, vehicleId: string, isPrimary: boolean = false) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    const vehicle = await prismaClient.vehicles.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const existing = await prismaClient.vehicleDrivers.findFirst({
      where: { driverId: driver.id, vehicleId },
    });

    if (existing) {
      throw new BadRequestException("Driver is already assigned to this vehicle");
    }

    return await prismaClient.vehicleDrivers.create({
      data: {
        driverId: driver.id,
        vehicleId,
        isPrimary,
      },
    });
  }

  public static async removeVehicleAssignment(userId: string, vehicleId: string) {
    const driver = await prismaClient.drivers.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile not found for user ${userId}`);
    }

    await prismaClient.vehicleDrivers.deleteMany({
      where: { driverId: driver.id, vehicleId },
    });

    return { message: "Vehicle assignment removed" };
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

    return {
      totalTrips,
      completedTrips,
      todayTrips,
      totalRevenue: totalRevenue._sum.totalPrice || 0,
      averageRating: averageRating._avg.overallRating || 5.0,
      rating: driver.rating,
    };
  }

  public static async getDriverById(driverId: string) {
    const driver = await prismaClient.drivers.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
        vehicleDrivers: { include: { vehicle: true } },
      },
    });

    if (!driver) {
      throw new NotFoundException(`Driver with ID ${driverId} not found`);
    }

    return driver;
  }
}

export default DriverService;
