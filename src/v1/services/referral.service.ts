import prismaClient from "../utils/prismaClientHelper";
import {
  ReferralStatus,
  WalletTransactionType,
  BookingStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "../utils/errors";

export class ReferralService {
  public static async generateReferralCode(userId: string) {
    const user = await prismaClient.users.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.referralCode) {
      return { referralCode: user.referralCode };
    }

    const code = `MRK${user.name.substring(0, 3).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;

    const updated = await prismaClient.users.update({
      where: { id: userId },
      data: { referralCode: code },
    });

    return { referralCode: updated.referralCode };
  }

  public static async applyReferralCode(referredUserId: string, referralCode: string) {
    const referrer = await prismaClient.users.findFirst({
      where: { referralCode },
    });

    if (!referrer) {
      throw new NotFoundException("Invalid referral code");
    }

    if (referrer.id === referredUserId) {
      throw new BadRequestException("Cannot refer yourself");
    }

    const existingReferral = await prismaClient.referrals.findFirst({
      where: { referredId: referredUserId },
    });

    if (existingReferral) {
      throw new ConflictException("You have already been referred");
    }

    const referral = await prismaClient.referrals.create({
      data: {
        referrerId: referrer.id,
        referredId: referredUserId,
        referralCode,
        status: ReferralStatus.PENDING,
        rewardAmount: 25,
      },
    });

    await prismaClient.users.update({
      where: { id: referredUserId },
      data: { referredById: referrer.id },
    });

    return referral;
  }

  /**
   * Pays the referral reward when the referred customer's trip completes.
   *
   * Called by the server from the trip lifecycle (never from a client: the old
   * public POST /referrals/:id/complete let anyone trigger payouts). It is
   * idempotent — the PENDING → COMPLETED flip is a conditional update, so a
   * retry or a concurrent completion can't credit the wallets twice.
   */
  public static async completeReferral(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException("Only a completed trip can trigger the referral reward");
    }

    const existingReferral = await prismaClient.referrals.findFirst({
      where: {
        referredId: booking.customerId,
        status: ReferralStatus.PENDING,
      },
    });

    if (!existingReferral) return null;

    return prismaClient.$transaction(async (tx) => {
      const flipped = await tx.referrals.updateMany({
        where: { id: existingReferral.id, status: ReferralStatus.PENDING },
        data: {
          status: ReferralStatus.COMPLETED,
          triggeringBookingId: bookingId,
          completedAt: new Date(),
        },
      });
      if (flipped.count === 0) return null;

      if (existingReferral.rewardAmount > 0) {
        await tx.walletTransactions.createMany({
          data: [
            {
              userId: existingReferral.referrerId,
              amount: existingReferral.rewardAmount,
              type: WalletTransactionType.REFERRAL_REWARD,
              description: "Referral reward for referring user",
            },
            {
              userId: existingReferral.referredId,
              amount: existingReferral.rewardAmount,
              type: WalletTransactionType.REFERRAL_REWARD,
              description: "Referral welcome bonus",
            },
          ],
        });
      }
      return tx.referrals.findUnique({ where: { id: existingReferral.id } });
    });
  }

  public static async getReferralStats(userId: string) {
    const referralsGiven = await prismaClient.referrals.findMany({
      where: { referrerId: userId },
      include: {
        referred: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalRewards = await prismaClient.walletTransactions.aggregate({
      where: {
        userId,
        type: WalletTransactionType.REFERRAL_REWARD,
      },
      _sum: { amount: true },
    });

    return {
      referralCode: (await prismaClient.users.findUnique({ where: { id: userId } }))?.referralCode,
      totalReferrals: referralsGiven.length,
      completedReferrals: referralsGiven.filter((r) => r.status === ReferralStatus.COMPLETED).length,
      totalRewards: totalRewards._sum.amount || 0,
      referrals: referralsGiven,
    };
  }

  public static async getReferralById(referralId: string) {
    const referral = await prismaClient.referrals.findUnique({
      where: { id: referralId },
      include: {
        referrer: { select: { id: true, name: true } },
        referred: { select: { id: true, name: true } },
        triggeringBooking: { select: { id: true, bookingDate: true, totalPrice: true } },
      },
    });

    if (!referral) {
      throw new NotFoundException(`Referral with ID ${referralId} not found`);
    }

    return referral;
  }
}

export default ReferralService;
