import prismaClient from "../utils/prismaClientHelper";
import {
  PackageType,
  PackageStatus,
  BookingStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
} from "../utils/errors";
import { calculateEstimatedPrice } from "./pricing.service";

export class PackageService {
  public static async createPackage(data: {
    customerId: string;
    packageName: string;
    packageType: PackageType;
    discountPercentage?: number;
  }) {
    const pkg = await prismaClient.packages.create({
      data: {
        customerId: data.customerId,
        packageName: data.packageName,
        packageType: data.packageType,
        discountPercentage: data.discountPercentage || 0,
        status: PackageStatus.ACTIVE,
      },
    });

    return pkg;
  }

  public static async addBookingToPackage(packageId: string, bookingId: string) {
    const pkg = await prismaClient.packages.findUnique({
      where: { id: packageId },
    });

    if (!pkg) {
      throw new NotFoundException(`Package with ID ${packageId} not found`);
    }

    if (pkg.status !== PackageStatus.ACTIVE) {
      throw new BadRequestException("Cannot add bookings to a non-active package");
    }

    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (booking.packageId) {
      throw new BadRequestException("Booking is already part of another package");
    }

    if (booking.customerId !== pkg.customerId) {
      throw new BadRequestException("Booking customer does not match package customer");
    }

    const updatedBooking = await prismaClient.bookings.update({
      where: { id: bookingId },
      data: { packageId },
    });

    await this.recalculatePackageTotal(packageId);

    return updatedBooking;
  }

  public static async removeBookingFromPackage(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (!booking.packageId) {
      throw new BadRequestException("Booking is not part of a package");
    }

    const packageId = booking.packageId;

    await prismaClient.bookings.update({
      where: { id: bookingId },
      data: { packageId: null },
    });

    await this.recalculatePackageTotal(packageId);

    return { message: "Booking removed from package" };
  }

  public static async recalculatePackageTotal(packageId: string) {
    const pkg = await prismaClient.packages.findUnique({
      where: { id: packageId },
      include: { bookings: true },
    });

    if (!pkg) return;

    const activeBookings = pkg.bookings.filter(
      (b) => b.status !== BookingStatus.CANCELLED
    );

    const subtotal = activeBookings.reduce((sum, b) => sum + b.totalPrice, 0);
    const discountAmount = subtotal * (pkg.discountPercentage / 100);
    const totalPrice = Math.round((subtotal - discountAmount) * 100) / 100;

    await prismaClient.packages.update({
      where: { id: packageId },
      data: { totalPrice: Math.max(0, totalPrice) },
    });
  }

  public static async getPackageById(packageId: string) {
    const pkg = await prismaClient.packages.findUnique({
      where: { id: packageId },
      include: {
        bookings: {
          include: {
            vehicle: { select: { id: true, make: true, model: true, category: true } },
            driver: { select: { id: true, fullName: true } },
          },
        },
        customer: { select: { id: true, name: true, phoneNumber: true } },
      },
    });

    if (!pkg) {
      throw new NotFoundException(`Package with ID ${packageId} not found`);
    }

    return pkg;
  }

  public static async getCustomerPackages(customerId: string) {
    const packages = await prismaClient.packages.findMany({
      where: { customerId },
      include: {
        bookings: {
          select: { id: true, bookingDate: true, status: true, totalPrice: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return packages;
  }

  public static async cancelPackage(packageId: string) {
    const pkg = await prismaClient.packages.findUnique({
      where: { id: packageId },
    });

    if (!pkg) {
      throw new NotFoundException(`Package with ID ${packageId} not found`);
    }

    if (pkg.status !== PackageStatus.ACTIVE) {
      throw new BadRequestException("Only active packages can be cancelled");
    }

    await prismaClient.packages.update({
      where: { id: packageId },
      data: { status: PackageStatus.CANCELLED },
    });

    await prismaClient.bookings.updateMany({
      where: { packageId, status: { not: BookingStatus.CANCELLED } },
      data: { packageId: null },
    });

    return { message: "Package cancelled and bookings detached" };
  }
}

export default PackageService;
