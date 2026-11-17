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
  getAssignableDrivers,
  listAuditLogs,
  exportAuditLogs,
  listPackages,
  updatePackageDiscount,
} from "../controllers/admin-dashboard.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { vehicleImageUpload } from "../middlewares/multer.middleware";
import {
  listFleet,
  getFleetVehicle,
  getFeatureSuggestions,
  createVehicle,
  updateFleetVehicle,
  retireVehicle,
  reactivateVehicle,
  setVehicleDrivers,
  uploadVehicleImages,
  deleteVehicleImage,
  setVehicleCover,
  scheduleMaintenance,
  completeMaintenance,
  cancelMaintenance,
} from "../controllers/fleet.controller";
import { PERMISSIONS } from "../constants/roles";
import { createTeamMember, disableTeamMember, enableTeamMember, listTeam, requireSuperAdmin, resetTeamMember2FA, resetTeamMemberPassword, setTeamMemberRole } from "../controllers/team.controller";

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
adminRouter.get("/audit-logs/export", errorHandler(exportAuditLogs));
adminRouter.get("/audit-logs", errorHandler(listAuditLogs));
adminRouter.get("/packages", errorHandler(listPackages));
adminRouter.patch("/packages/:id/discount", requirePermission(PERMISSIONS.BOOKING_MANAGE), errorHandler(updatePackageDiscount));
// Fleet (dashboard /fleet). Reading is open to admins; changes need vehicle:manage.
const canManageFleet = requirePermission(PERMISSIONS.VEHICLE_MANAGE);
adminRouter.get("/vehicles", errorHandler(listFleet));
adminRouter.get("/vehicle-features", errorHandler(getFeatureSuggestions));
adminRouter.get("/vehicles/:id", errorHandler(getFleetVehicle));
adminRouter.post("/vehicles", canManageFleet, errorHandler(createVehicle));
adminRouter.patch("/vehicles/:id", canManageFleet, errorHandler(updateFleetVehicle));
adminRouter.post("/vehicles/:id/retire", canManageFleet, errorHandler(retireVehicle));
adminRouter.post("/vehicles/:id/reactivate", canManageFleet, errorHandler(reactivateVehicle));
adminRouter.put("/vehicles/:id/drivers", canManageFleet, errorHandler(setVehicleDrivers));
adminRouter.post("/vehicles/:id/images", canManageFleet, vehicleImageUpload.array("images", 8), errorHandler(uploadVehicleImages));
adminRouter.delete("/vehicles/:id/images/:imageId", canManageFleet, errorHandler(deleteVehicleImage));
adminRouter.patch("/vehicles/:id/images/:imageId/cover", canManageFleet, errorHandler(setVehicleCover));
adminRouter.post("/vehicles/:id/maintenance", canManageFleet, errorHandler(scheduleMaintenance));
adminRouter.patch("/maintenance/:id/complete", canManageFleet, errorHandler(completeMaintenance));
adminRouter.delete("/maintenance/:id", canManageFleet, errorHandler(cancelMaintenance));

// Team page: dashboard accounts, Super Admin only.
adminRouter.get("/team", requireSuperAdmin, errorHandler(listTeam));
adminRouter.post("/team", requireSuperAdmin, errorHandler(createTeamMember));
adminRouter.post("/team/:id/reset-2fa", requireSuperAdmin, errorHandler(resetTeamMember2FA));
adminRouter.post("/team/:id/reset-password", requireSuperAdmin, errorHandler(resetTeamMemberPassword));
adminRouter.patch("/team/:id/role", requireSuperAdmin, errorHandler(setTeamMemberRole));
adminRouter.post("/team/:id/disable", requireSuperAdmin, errorHandler(disableTeamMember));
adminRouter.post("/team/:id/enable", requireSuperAdmin, errorHandler(enableTeamMember));

// Changing business settings needs settings:manage (Super Admin by default).
adminRouter.put("/settings", requirePermission(PERMISSIONS.SETTINGS_MANAGE), errorHandler(updateSystemSettings));

export default adminRouter;
