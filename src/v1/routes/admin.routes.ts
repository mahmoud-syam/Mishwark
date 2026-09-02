import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getDashboardStats,
  getBookingsCalendar,
  getBookingsByDate,
  getFleetStatus,
  getDriverStats,
  listUsers,
  listDrivers,
  updateUserRole,
  toggleDriverStatus,
  getSystemSettings,
  updateSystemSettings,
  getAllBookings,
} from "../controllers/admin.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";

const adminRouter: Router = Router();

adminRouter.use(authMiddleware, adminMiddleware);

adminRouter.get("/stats/summary", errorHandler(getDashboardStats));
adminRouter.get("/bookings/calendar", errorHandler(getBookingsCalendar));
adminRouter.get("/bookings", errorHandler(getBookingsByDate));
adminRouter.get("/bookings/all", errorHandler(getAllBookings));
adminRouter.get("/vehicles/status", errorHandler(getFleetStatus));
adminRouter.get("/drivers/:id/stats", errorHandler(getDriverStats));
adminRouter.get("/drivers", errorHandler(listDrivers));
adminRouter.patch("/drivers/:id/status", errorHandler(toggleDriverStatus));
adminRouter.get("/users", errorHandler(listUsers));
adminRouter.patch("/users/role", errorHandler(updateUserRole));
adminRouter.get("/settings", errorHandler(getSystemSettings));
adminRouter.put("/settings", errorHandler(updateSystemSettings));

export default adminRouter;
