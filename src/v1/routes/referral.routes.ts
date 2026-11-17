import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  generateReferralCode,
  applyReferralCode,
  getReferralStats,
  getReferralById,
} from "../controllers/referral.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const referralRouter: Router = Router();

referralRouter.post("/generate-code", authMiddleware, errorHandler(generateReferralCode));
referralRouter.post("/apply", authMiddleware, errorHandler(applyReferralCode));
// Referral rewards are paid by the server when the referred customer completes
// a trip (see BookingService.updateTripStatus); there is no client endpoint.
referralRouter.get("/me", authMiddleware, errorHandler(getReferralStats));
referralRouter.get("/:id", authMiddleware, errorHandler(getReferralById));

export default referralRouter;
