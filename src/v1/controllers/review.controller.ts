import { Request, Response } from "express";
import { z } from "zod";
import ReviewService from "../services/review.service";
import { paramStr, queryNum } from "../utils/routeParams";
import prismaClient from "../utils/prismaClientHelper";
import { assertOwnerOrAdmin } from "../utils/ownership";
import { bookingPartyOf } from "../services/booking.service";
import { NotFoundException } from "../utils/errors";
import { createReviewSchema } from "../schemas/review.schema";

export const createReview = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  // revieweeId is optional now: the server derives it from the booking.
  const input = createReviewSchema.extend({ revieweeId: z.string().nullish() }).parse(req.body);
  const review = await ReviewService.createReview(input, userId);
  res.status(201).json({ success: true, data: review });
};

export const getReviewById = async (req: Request, res: Response) => {
  const r = await prismaClient.reviews.findUnique({ where: { id: paramStr(req.params.id) }, select: { reviewerId: true, revieweeId: true } });
  if (!r) throw new NotFoundException("Review not found");
  assertOwnerOrAdmin(req.user, [r.reviewerId, r.revieweeId], "Review");
  const review = await ReviewService.getReviewById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: review });
};

export const getBookingReviews = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const b = await prismaClient.bookings.findUnique({ where: { id: paramStr(req.params.id) }, select: { customerId: true, driverId: true } });
  if (!b || (await bookingPartyOf(b, req.user)) === null) throw new NotFoundException("Booking not found");
  const reviews = await ReviewService.getBookingReviews(paramStr(req.params.id), userId || "");
  res.status(200).json({ success: true, data: reviews });
};

export const getUserReviews = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await ReviewService.getUserReviews(
    userId,
    queryNum(req.query.page, 1),
    queryNum(req.query.limit, 10)
  );
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};
