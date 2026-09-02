import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  calculatePrice,
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  updateTripStatus,
  cancelBooking,
} from "../controllers/booking.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const bookingRouter: Router = Router();

bookingRouter.post("/estimate-price", errorHandler(calculatePrice));
bookingRouter.post("/", authMiddleware, errorHandler(createBooking));
bookingRouter.get("/", authMiddleware, errorHandler(getBookings));
bookingRouter.get("/:id", authMiddleware, errorHandler(getBookingById));
bookingRouter.patch("/:id/status", authMiddleware, errorHandler(updateBookingStatus));
bookingRouter.patch("/:id/trip-status", authMiddleware, errorHandler(updateTripStatus));
bookingRouter.delete("/:id", authMiddleware, errorHandler(cancelBooking));

export default bookingRouter;
