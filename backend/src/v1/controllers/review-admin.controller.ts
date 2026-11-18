import { Request, Response } from "express";
import ReviewAdminService, { handleReviewSchema, reviewListSchema } from "../services/review-admin.service";

const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name });
const idOf = (req: Request) => String(req.params.id);

/** GET /admin/reviews: reviews with who wrote them, about whom, on which trip. */
export const listReviews = async (req: Request, res: Response) => {
  const result = await ReviewAdminService.list(reviewListSchema.parse(req.query));
  res.json({ success: true, data: result.items, counts: result.counts, complaintMaxRating: result.complaintMaxRating, pagination: result.pagination });
};

export const getReview = async (req: Request, res: Response) => {
  res.json({ success: true, data: await ReviewAdminService.get(idOf(req)) });
};

/** PATCH /admin/reviews/:id: { handled: true, note } or { handled: false }. Audit-logged. */
export const handleReview = async (req: Request, res: Response) => {
  const input = handleReviewSchema.parse(req.body ?? {});
  res.json({ success: true, data: await ReviewAdminService.setHandled(idOf(req), input, actorOf(req)) });
};
