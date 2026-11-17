import prismaClient from "../utils/prismaClientHelper";
import {
  BookingStatus,
  VehicleStatus,
  DriverStatus,
} from "../../../generated/prisma";
import {
  NotFoundException,
  BadRequestException,
} from "../utils/errors";
import { normalizeRoleName, USER_ROLES } from "../constants/roles";

export class AdminService {
  public static async getDashboardStats() {
    const today = new Date().toISOString().split("T")[0];

    const [
      totalUsers,
      totalDrivers,
      totalVehicles,
      totalBookings,
      completedBookings,
      cancelledBookings,
      todayBookings,
      totalRevenue,
      activeDrivers,
      availableVehicles,
    ] = await Promise.all([
      prismaClient.users.count({ where: { isDeleted: false } }),
      prismaClient.drivers.count(),
      prismaClient.vehicles.count(),
      prismaClient.bookings.count({ where: { status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.bookings.count({ where: { status: BookingStatus.COMPLETED } }),
      prismaClient.bookings.count({ where: { status: BookingStatus.CANCELLED } }),
      prismaClient.bookings.count({ where: { bookingDate: today, status: { not: BookingStatus.CANCELLED } } }),
      prismaClient.bookings.aggregate({
        where: { status: BookingStatus.COMPLETED },
        _sum: { totalPrice: true },
      }),
      prismaClient.drivers.count({ where: { status: DriverStatus.ACTIVE } }),
      prismaClient.vehicles.count({ where: { status: VehicleStatus.AVAILABLE } }),
    ]);

    return {
      totalUsers,
      totalDrivers,
      totalVehicles,
      totalBookings,
      completedBookings,
      cancelledBookings,
      todayBookings,
      totalRevenue: totalRevenue._sum.totalPrice || 0,
      activeDrivers,
      availableVehicles,
    };
  }

  public static async getBookingsCalendar(month: string) {
    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const bookings = await prismaClient.bookings.findMany({
      where: {
        bookingDate: {
          gte: startDate.toISOString().split("T")[0],
          lt: nextMonth.toISOString().split("T")[0],
        },
        status: { not: BookingStatus.CANCELLED },
      },
      select: {
        bookingDate: true,
        status: true,
      },
    });

    const calendarMap: Record<string, number> = {};

    bookings.forEach((b) => {
      if (!calendarMap[b.bookingDate]) calendarMap[b.bookingDate] = 0;
      calendarMap[b.bookingDate]++;
    });

    return calendarMap;
  }

  public static async getBookingsByDate(date: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const where = {
      bookingDate: date,
      status: { not: BookingStatus.CANCELLED },
    };

    const [items, total] = await Promise.all([
      prismaClient.bookings.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startTime: "asc" },
        include: {
          vehicle: { select: { id: true, make: true, model: true, category: true } },
          customer: { select: { id: true, name: true, phoneNumber: true } },
          driver: { select: { id: true, fullName: true } },
        },
      }),
      prismaClient.bookings.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async getFleetStatus() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const vehicles = await prismaClient.vehicles.findMany({
      include: {
        vehicleDrivers: {
          include: {
            driver: {
              select: { id: true, fullName: true, status: true },
            },
          },
        },
        vehicleAvailabilities: {
          where: {
            date: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
        },
      },
    });

    return vehicles.map((v) => ({
      id: v.id,
      make: v.make,
      model: v.model,
      category: v.category,
      status: v.status,
      plateNumber: v.plateNumber,
      assignedDrivers: v.vehicleDrivers.map((vd) => ({
        id: vd.driver.id,
        name: vd.driver.fullName,
        status: vd.driver.status,
        isPrimary: vd.isPrimary,
      })),
      todayAvailability: v.vehicleAvailabilities[0]?.status || "AVAILABLE",
    }));
  }

  public static async getDriverStats(driverId: string) {
    const driver = await prismaClient.drivers.findUnique({
      where: { id: driverId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!driver) {
      throw new NotFoundException(`Driver with ID ${driverId} not found`);
    }

    const [totalTrips, completedTrips, totalRevenue, averageRating, totalReviews] = await Promise.all([
      prismaClient.bookings.count({
        where: { driverId, status: { not: BookingStatus.CANCELLED } },
      }),
      prismaClient.bookings.count({
        where: { driverId, status: BookingStatus.COMPLETED },
      }),
      prismaClient.bookings.aggregate({
        where: { driverId, status: BookingStatus.COMPLETED },
        _sum: { totalPrice: true },
      }),
      prismaClient.reviews.aggregate({
        where: { revieweeId: driver.userId },
        _avg: { overallRating: true, vehicleRating: true, punctualityRating: true },
      }),
      prismaClient.reviews.count({
        where: { revieweeId: driver.userId },
      }),
    ]);

    return {
      driver: {
        id: driver.id,
        fullName: driver.fullName,
        status: driver.status,
        rating: driver.rating,
      },
      totalTrips,
      completedTrips,
      totalRevenue: totalRevenue._sum.totalPrice || 0,
      averageRating: {
        overall: averageRating._avg.overallRating || 5.0,
        vehicle: averageRating._avg.vehicleRating || 5.0,
        punctuality: averageRating._avg.punctualityRating || 5.0,
      },
      totalReviews,
    };
  }

  public static async listUsers(params: { page?: number; limit?: number; role?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false };
    if (params.role) {
      // Role.name is now a UserRole enum, so an unrecognised value would make
      // Prisma throw instead of returning an empty page.
      const roleName = normalizeRoleName(params.role);
      if (roleName) {
        where.role = { name: roleName };
      } else {
        throw new BadRequestException(`Unknown role: ${params.role}`);
      }
    }

    const [items, total] = await Promise.all([
      prismaClient.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, email: true, phoneNumber: true, preferredLanguage: true,
          referralCode: true, customerRating: true, createdAt: true,
          role: { select: { id: true, name: true } },
        },
      }),
      prismaClient.users.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async listDrivers(params: { page?: number; limit?: number; status?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;

    const [items, total] = await Promise.all([
      prismaClient.drivers.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true, phoneNumber: true } },
          vehicleDrivers: { include: { vehicle: { select: { id: true, make: true, model: true } } } },
        },
      }),
      prismaClient.drivers.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async updateUserRole(userId: string, roleId: string) {
    const user = await prismaClient.users.findUnique({
      where: { id: userId },
      include: { role: { select: { id: true, name: true } } },
    });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const role = await prismaClient.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);

    // Guard against locking everyone out of the admin panel.
    if (user.role?.name === USER_ROLES.SUPER_ADMIN && role.name !== USER_ROLES.SUPER_ADMIN) {
      const remaining = await prismaClient.users.count({
        where: { role: { name: USER_ROLES.SUPER_ADMIN }, isDeleted: false },
      });
      if (remaining <= 1) {
        throw new BadRequestException(
          "Cannot demote the last remaining Super Admin"
        );
      }
    }

    // A user carrying the Driver role but no Drivers row 404s on every
    // /driver/* endpoint and cannot appear on a booking, so the profile is
    // created on promotion rather than left to a separate manual step.
    if (role.name === USER_ROLES.DRIVER) {
      await prismaClient.drivers.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          fullName: user.name,
          pic: user.pic ?? "",
          phoneNumbers: user.phoneNumber
            ? { create: [{ number: user.phoneNumber }] }
            : undefined,
        },
      });
    }

    return await prismaClient.users.update({
      where: { id: userId },
      data: { roleId },
      include: { role: { select: { id: true, name: true } } },
    });
  }

  public static async toggleDriverStatus(driverId: string, status: DriverStatus) {
    const driver = await prismaClient.drivers.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException(`Driver with ID ${driverId} not found`);

    if (status === DriverStatus.ONTRIP) {
      throw new BadRequestException("Cannot manually set status to ONTRIP");
    }

    return await prismaClient.drivers.update({
      where: { id: driverId },
      // OFF/ONLEAVE set here is locked for the driver app; ACTIVE unlocks it.
      data: { status, statusSetByAdmin: status !== DriverStatus.ACTIVE },
    });
  }

  public static async getSystemSettings() {
    let settings = await prismaClient.systemSettings.findUnique({ where: { id: "global" } });

    if (!settings) {
      settings = await prismaClient.systemSettings.create({ data: { id: "global" } });
    }

    return settings;
  }

  public static async updateSystemSettings(data: any) {
    return await prismaClient.systemSettings.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        performanceHistoryVisible: data.performanceHistoryVisible ?? true,
        evaluationsVisible: data.evaluationsVisible ?? true,
        selfAppraisalsVisible: data.selfAppraisalsVisible ?? true,
      },
      update: {
        ...(data.performanceHistoryVisible !== undefined && { performanceHistoryVisible: data.performanceHistoryVisible }),
        ...(data.evaluationsVisible !== undefined && { evaluationsVisible: data.evaluationsVisible }),
        ...(data.selfAppraisalsVisible !== undefined && { selfAppraisalsVisible: data.selfAppraisalsVisible }),
      },
    });
  }

  public static async getAllBookings(params: { page?: number; limit?: number; status?: string; customerId?: string; driverId?: string; vehicleId?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;
    if (params.driverId) where.driverId = params.driverId;
    if (params.vehicleId) where.vehicleId = params.vehicleId;

    const [items, total] = await Promise.all([
      prismaClient.bookings.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { id: true, make: true, model: true, category: true } },
          customer: { select: { id: true, name: true, phoneNumber: true } },
          driver: { select: { id: true, fullName: true } },
        },
      }),
      prismaClient.bookings.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}

export default AdminService;
