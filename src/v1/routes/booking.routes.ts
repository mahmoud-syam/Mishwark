import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  calculatePrice,
  estimateDistance,
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  updateTripStatus,
  cancelBooking,
} from "../controllers/booking.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const bookingRouter: Router = Router();

// Literal paths must be registered before "/:id", otherwise Express treats
// "estimate-distance" as a booking id.
bookingRouter.post("/estimate-price", errorHandler(calculatePrice));
bookingRouter.post("/estimate-distance", errorHandler(estimateDistance));
bookingRouter.post("/", authMiddleware, errorHandler(createBooking));
bookingRouter.get("/", authMiddleware, errorHandler(getBookings));
bookingRouter.get("/:id", authMiddleware, errorHandler(getBookingById));
bookingRouter.patch("/:id/status", authMiddleware, errorHandler(updateBookingStatus));
bookingRouter.patch("/:id/trip-status", authMiddleware, errorHandler(updateTripStatus));
bookingRouter.delete("/:id", authMiddleware, errorHandler(cancelBooking));

export default bookingRouter;
