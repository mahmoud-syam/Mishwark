import prismaClient from "../utils/prismaClientHelper";
import DiscountService from "./discount.service";
import {
  PackageType,
  PackageStatus,
  BookingStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
} from "../utils/errors";

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
        // Set by an admin afterwards (setDiscount). A customer used to pick
        // their own % here, up to 100%.
        discountPercentage: 0,
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

    await prismaClient.bookings.update({
      where: { id: bookingId },
      data: { packageId },
    });
    // The package % applies if nothing has been paid on the booking yet.
    await DiscountService.repriceForPackage(prismaClient, bookingId, pkg.discountPercentage);

    await this.recalculatePackageTotal(packageId);

    return prismaClient.bookings.findUnique({ where: { id: bookingId } });
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
    // Leaving the package removes its discount (only while nothing is paid).
    await DiscountService.repriceForPackage(prismaClient, bookingId, 0);

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

    // Booking prices already include the package discount; applying the % again
    // here would discount twice.
    const totalPrice = Math.round(activeBookings.reduce((sum, b) => sum + b.totalPrice, 0) * 100) / 100;

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

  /**
   * Admin sets the package discount. Bookings in the package that nothing has
   * been paid on yet are re-priced; paid or confirmed ones keep their price.
   */
  public static async setDiscount(packageId: string, percentage: number) {
    const pkg = await prismaClient.packages.findUnique({
      where: { id: packageId },
      include: { bookings: { select: { id: true, status: true } } },
    });
    if (!pkg) throw new NotFoundException(`Package with ID ${packageId} not found`);
    if (pkg.status !== PackageStatus.ACTIVE) throw new BadRequestException("Only an active package's discount can be changed");

    await prismaClient.packages.update({ where: { id: packageId }, data: { discountPercentage: percentage } });
    let repriced = 0;
    for (const b of pkg.bookings) {
      if (b.status === BookingStatus.CANCELLED) continue;
      if (await DiscountService.repriceForPackage(prismaClient, b.id, percentage)) repriced++;
    }
    await this.recalculatePackageTotal(packageId);
    return { before: pkg.discountPercentage, repriced, package: await prismaClient.packages.findUnique({ where: { id: packageId } }) };
  }

  /** Dashboard list: newest first, with the customer and booking counts. */
  public static async listForAdmin(params: { status?: PackageStatus; page?: number; limit?: number }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const where = params.status ? { status: params.status } : {};
    const [rows, total] = await Promise.all([
      prismaClient.packages.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true } },
          bookings: { select: { id: true, status: true, totalPrice: true, packageDiscount: true, depositPaid: true } },
        },
      }),
      prismaClient.packages.count({ where }),
    ]);
    const items = rows.map(({ bookings, ...p }) => {
      const active = bookings.filter((b) => b.status !== BookingStatus.CANCELLED);
      return {
        ...p,
        bookingsCount: active.length,
        unpaidBookings: active.filter((b) => b.status === BookingStatus.PENDING && b.depositPaid === 0).length,
        discountGiven: Math.round(active.reduce((sum, b) => sum + b.packageDiscount, 0) * 100) / 100,
      };
    });
    return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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

    const attached = await prismaClient.bookings.findMany({
      where: { packageId, status: { not: BookingStatus.CANCELLED } },
      select: { id: true },
    });
    await prismaClient.bookings.updateMany({
      where: { packageId, status: { not: BookingStatus.CANCELLED } },
      data: { packageId: null },
    });
    for (const b of attached) await DiscountService.repriceForPackage(prismaClient, b.id, 0);

    return { message: "Package cancelled and bookings detached" };
  }
}

export default PackageService;
