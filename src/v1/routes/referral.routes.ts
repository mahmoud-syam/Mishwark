import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  generateReferralCode,
  applyReferralCode,
  completeReferral,
  getReferralStats,
  getReferralById,
} from "../controllers/referral.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const referralRouter: Router = Router();

referralRouter.post("/generate-code", authMiddleware, errorHandler(generateReferralCode));
referralRouter.post("/apply", authMiddleware, errorHandler(applyReferralCode));
referralRouter.post("/:id/complete", errorHandler(completeReferral));
referralRouter.get("/me", authMiddleware, errorHandler(getReferralStats));
referralRouter.get("/:id", authMiddleware, errorHandler(getReferralById));

export default referralRouter;
