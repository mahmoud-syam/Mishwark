import { z } from "zod";

export const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  reviewerType: z.enum(["CUSTOMER_TO_DRIVER", "DRIVER_TO_CUSTOMER"]),
  revieweeId: z.string().min(1),
  overallRating: z.number().int().min(1).max(5),
  vehicleRating: z.number().int().min(1).max(5).optional(),
  punctualityRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(1000, "The comment is too long (1000 characters at most)").optional(),
});

export const reviewIdParamSchema = z.object({
  id: z.string().min(1),
});
