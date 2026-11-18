import prismaClient from "../utils/prismaClientHelper";
import {
  ReviewerType,
  BookingStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "../utils/errors";

export class ReviewService {
  public static async createReview(data: any, reviewerId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: data.bookingId },
      include: { reviews: true, driver: { select: { userId: true } } },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${data.bookingId} not found`);
    }

    // Only the two parties of the trip may review each other, and the reviewee
    // is derived from the booking rather than trusted from the client.
    // Previously anyone could post a review (e.g. a fake 1-star complaint) on
    // any completed booking, against any user id.
    let revieweeId: string;
    if (data.reviewerType === ReviewerType.CUSTOMER_TO_DRIVER) {
      if (booking.customerId !== reviewerId) {
        throw new ForbiddenException("Only the booking's customer can review the driver");
      }
      revieweeId = booking.driver.userId;
    } else if (data.reviewerType === ReviewerType.DRIVER_TO_CUSTOMER) {
      if (booking.driver.userId !== reviewerId) {
        throw new ForbiddenException("Only the assigned driver can review the customer");
      }
      revieweeId = booking.customerId;
    } else {
      throw new BadRequestException("reviewerType must be CUSTOMER_TO_DRIVER or DRIVER_TO_CUSTOMER");
    }
    if (data.revieweeId && data.revieweeId !== revieweeId) {
      throw new BadRequestException("revieweeId does not match the other party of this booking");
    }

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException("Can only review completed bookings");
    }

    const existingReview = booking.reviews.find(
      (r) => r.reviewerId === reviewerId && r.reviewerType === data.reviewerType
    );
    if (existingReview) {
      throw new ConflictException("You have already reviewed this booking");
    }

    // The unique (booking, direction) rule settles two reviews sent at once.
    const review = await prismaClient.reviews
      .create({
        data: {
          bookingId: data.bookingId,
          reviewerId,
          revieweeId,
          reviewerType: data.reviewerType,
          overallRating: data.overallRating,
          vehicleRating: data.vehicleRating || null,
          punctualityRating: data.punctualityRating || null,
          comment: data.comment || null,
          visibleAt: null,
        },
      })
      .catch((e: any) => {
        if (e?.code === "P2002") throw new ConflictException("You have already reviewed this booking");
        throw e;
      });

    await this.checkAndReleaseBlindReviews(data.bookingId);

    return review;
  }

  public static async checkAndReleaseBlindReviews(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
      include: { reviews: true },
    });

    if (!booking || booking.reviews.length === 0) return;

    const hasCustomerReview = booking.reviews.some(
      (r) => r.reviewerType === ReviewerType.CUSTOMER_TO_DRIVER
    );
    const hasDriverReview = booking.reviews.some(
      (r) => r.reviewerType === ReviewerType.DRIVER_TO_CUSTOMER
    );

    const now = new Date();
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;

    if (hasCustomerReview && hasDriverReview) {
      await prismaClient.reviews.updateMany({
        where: { bookingId, visibleAt: null },
        data: { visibleAt: now },
      });
      return;
    }

    const oldestReview = booking.reviews.reduce((min, r) =>
      r.createdAt < min.createdAt ? r : min
    );

    if (now.getTime() - oldestReview.createdAt.getTime() >= fortyEightHoursMs) {
      await prismaClient.reviews.updateMany({
        where: { bookingId, visibleAt: null },
        data: { visibleAt: now },
      });
    }
  }

  public static async getReviewById(reviewId: string) {
    const review = await prismaClient.reviews.findUnique({
      where: { id: reviewId },
      include: {
        reviewer: {
          select: { id: true, name: true, pic: true },
        },
        reviewee: {
          select: { id: true, name: true, pic: true },
        },
        booking: {
          select: { id: true, bookingDate: true, vehicle: true },
        },
      },
    });

    if (!review) {
      throw new NotFoundException(`Review with ID ${reviewId} not found`);
    }

    return review;
  }

  public static async getBookingReviews(bookingId: string, requestorId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const now = new Date();
    const reviews = await prismaClient.reviews.findMany({
      where: { bookingId },
      include: {
        reviewer: { select: { id: true, name: true, pic: true } },
        reviewee: { select: { id: true, name: true, pic: true } },
      },
    });

    return reviews.filter((r) => {
      if (r.visibleAt && r.visibleAt <= now) return true;
      if (r.reviewerId === requestorId || r.revieweeId === requestorId) return true;
      return false;
    });
  }

  public static async getUserReviews(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const now = new Date();
    const where = {
      OR: [
        { revieweeId: userId, visibleAt: { lte: now } },
        { reviewerId: userId },
      ],
    };

    const [items, total] = await Promise.all([
      prismaClient.reviews.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          reviewer: { select: { id: true, name: true, pic: true } },
          reviewee: { select: { id: true, name: true, pic: true } },
          booking: { select: { id: true, bookingDate: true } },
        },
      }),
      prismaClient.reviews.count({ where }),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async updateDriverRating(driverId: string) {
    const driver = await prismaClient.drivers.findUnique({ where: { id: driverId } });
    if (!driver) return;

    const avgReview = await prismaClient.reviews.aggregate({
      where: {
        revieweeId: driver.userId,
        reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
        visibleAt: { not: null },
      },
      _avg: { overallRating: true },
    });

    const newRating = avgReview._avg.overallRating || 5.0;

    await prismaClient.drivers.update({
      where: { id: driverId },
      data: { rating: Math.round(newRating * 10) / 10 },
    });
  }
}

export default ReviewService;
