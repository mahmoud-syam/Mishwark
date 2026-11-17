import prismaClient from "../utils/prismaClientHelper";
import { BookingStatus, PackageStatus, Prisma } from "../../../generated/prisma";
import { BadRequestException, NotFoundException } from "../utils/errors";
import SettingsService from "./settings.service";

type Db = Prisma.TransactionClient | typeof prismaClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Who gets which discount. Amounts are never taken from the request:
 *
 * - Package: the % an admin set on the package (PATCH /admin/packages/:id/discount).
 *   The package must belong to the booking's customer and be ACTIVE.
 * - Referral: a customer who joined with someone's code gets
 *   Settings.referredDiscountAmount off their first booking (no other booking
 *   that isn't cancelled).
 */
export class DiscountService {
  /**
   * The package a booking may use. `strict` (booking creation) throws when it
   * can't be used; otherwise (a price estimate) it just returns null.
   */
  public static async resolvePackage(db: Db, packageId: string | null | undefined, customerId: string, strict: boolean) {
    if (!packageId) return null;
    const pkg = await db.packages.findUnique({
      where: { id: packageId },
      select: { id: true, customerId: true, status: true, discountPercentage: true },
    });
    if (!pkg || pkg.customerId !== customerId) {
      if (strict) throw new NotFoundException("Package not found");
      return null;
    }
    if (pkg.status !== PackageStatus.ACTIVE) {
      if (strict) throw new BadRequestException("This package is no longer active");
      return null;
    }
    return pkg;
  }

  /** True while the customer has no booking that isn't cancelled. */
  public static async isFirstBooking(db: Db, customerId: string) {
    const count = await db.bookings.count({ where: { customerId, status: { not: BookingStatus.CANCELLED } } });
    return count === 0;
  }

  /** Discount for a referred customer's first booking, else 0. */
  public static async referralDiscount(db: Db, customerId: string): Promise<number> {
    const { referredDiscountAmount } = await SettingsService.get();
    if (!(referredDiscountAmount > 0)) return 0;
    const referral = await db.referrals.findFirst({ where: { referredId: customerId }, select: { id: true } });
    if (!referral) return 0;
    return (await this.isFirstBooking(db, customerId)) ? referredDiscountAmount : 0;
  }

  /**
   * Re-applies a package % to a booking that nothing has been paid on yet
   * (PENDING, no confirmed payment). Paid or confirmed bookings keep their
   * price. Returns true when the booking was updated.
   */
  public static async repriceForPackage(db: Db, bookingId: string, percentage: number): Promise<boolean> {
    const b = await db.bookings.findUnique({
      where: { id: bookingId },
      select: { status: true, depositPaid: true, totalPrice: true, packageDiscount: true, referralDiscount: true },
    });
    if (!b || b.status !== BookingStatus.PENDING || b.depositPaid > 0) return false;

    const gross = b.totalPrice + b.packageDiscount + b.referralDiscount;
    const packageDiscount = round2(Math.min(gross, gross * (Math.max(0, Math.min(100, percentage)) / 100)));
    const referralDiscount = round2(Math.min(b.referralDiscount, gross - packageDiscount));
    const totalPrice = round2(Math.max(0, gross - packageDiscount - referralDiscount));
    if (totalPrice === b.totalPrice && packageDiscount === b.packageDiscount) return false;

    const { depositRate } = await SettingsService.get();
    await db.bookings.update({
      where: { id: bookingId },
      data: { packageDiscount, referralDiscount, totalPrice, depositRequired: round2(totalPrice * (depositRate / 100)) },
    });
    return true;
  }
}

export default DiscountService;
