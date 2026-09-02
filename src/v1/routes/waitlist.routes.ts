import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  joinWaitlist,
  getWaitlistEntry,
  getCustomerWaitlist,
  cancelWaitlist,
  convertWaitlistToBooking,
} from "../controllers/waitlist.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const waitlistRouter: Router = Router();

waitlistRouter.post("/", authMiddleware, errorHandler(joinWaitlist));
waitlistRouter.get("/me", authMiddleware, errorHandler(getCustomerWaitlist));
waitlistRouter.get("/:id", authMiddleware, errorHandler(getWaitlistEntry));
waitlistRouter.delete("/:id", authMiddleware, errorHandler(cancelWaitlist));
waitlistRouter.post("/:id/convert", authMiddleware, errorHandler(convertWaitlistToBooking));

export default waitlistRouter;
