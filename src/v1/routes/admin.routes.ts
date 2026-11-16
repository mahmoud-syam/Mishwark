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
import {
  getOverview,
  getDriversSummary,
  getDay,
  getLiveTrips,
  getDriverAnalytics,
  updateDriverCommission,
  getCustomerAnalytics,
  searchCustomers,
  createCustomer,
  bookOnBehalf,
  updateVehicle,
  getAssignableDrivers,
  listAuditLogs,
  exportAuditLogs,
} from "../controllers/admin-dashboard.controller";
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

// Web dashboard
adminRouter.get("/overview", errorHandler(getOverview));
adminRouter.get("/days/:date", errorHandler(getDay));
adminRouter.get("/trips/live", errorHandler(getLiveTrips));
adminRouter.get("/drivers-summary", errorHandler(getDriversSummary));
adminRouter.get("/drivers-assignable", errorHandler(getAssignableDrivers));
adminRouter.get("/drivers/:id/analytics", errorHandler(getDriverAnalytics));
adminRouter.patch("/drivers/:id/commission", errorHandler(updateDriverCommission));
adminRouter.get("/customers/search", errorHandler(searchCustomers));
adminRouter.post("/customers", errorHandler(createCustomer));
adminRouter.get("/customers/:id/analytics", errorHandler(getCustomerAnalytics));
adminRouter.post("/bookings", errorHandler(bookOnBehalf));
adminRouter.patch("/vehicles/:id", errorHandler(updateVehicle));
adminRouter.get("/audit-logs/export", errorHandler(exportAuditLogs));
adminRouter.get("/audit-logs", errorHandler(listAuditLogs));
adminRouter.put("/settings", errorHandler(updateSystemSettings));

export default adminRouter;
