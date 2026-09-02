import { Request, Response } from "express";
import ReviewService from "../services/review.service";
import { paramStr, queryNum } from "../utils/routeParams";

export const createReview = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const review = await ReviewService.createReview(req.body, userId);
  res.status(201).json({ success: true, data: review });
};

export const getReviewById = async (req: Request, res: Response) => {
  const review = await ReviewService.getReviewById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: review });
};

export const getBookingReviews = async (req: Request, res: Response) => {
  const userId = req.user?.id;
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
