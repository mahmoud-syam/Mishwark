import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  createReview,
  getReviewById,
  getBookingReviews,
  getUserReviews,
} from "../controllers/review.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const reviewRouter: Router = Router();

reviewRouter.post("/", authMiddleware, errorHandler(createReview));
reviewRouter.get("/me", authMiddleware, errorHandler(getUserReviews));
reviewRouter.get("/booking/:id", authMiddleware, errorHandler(getBookingReviews));
reviewRouter.get("/:id", authMiddleware, errorHandler(getReviewById));

export default reviewRouter;
