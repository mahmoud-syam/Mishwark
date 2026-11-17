import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  initiatePayment,
  updatePaymentStatus,
  getBookingPayments,
  getPaymentById,
  refundPayment,
  getPaymentSummary,
} from "../controllers/payment.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const paymentRouter: Router = Router();

paymentRouter.post("/", authMiddleware, errorHandler(initiatePayment));
paymentRouter.patch("/:id/status", authMiddleware, errorHandler(updatePaymentStatus));
paymentRouter.get("/:id", authMiddleware, errorHandler(getPaymentById));
paymentRouter.post("/:id/refund", authMiddleware, errorHandler(refundPayment));
paymentRouter.get("/booking/:bookingId", authMiddleware, errorHandler(getBookingPayments));
paymentRouter.get("/summary/:bookingId", authMiddleware, errorHandler(getPaymentSummary));

export default paymentRouter;
