import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getDriverProfile,
  updateDriverProfile,
  toggleDriverStatus,
  getDriverBookings,
  assignVehicle,
  removeVehicleAssignment,
  getDriverStats,
  getDriverById,
} from "../controllers/driver.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const driverRouter: Router = Router();

driverRouter.get("/profile", authMiddleware, errorHandler(getDriverProfile));
driverRouter.put("/profile", authMiddleware, errorHandler(updateDriverProfile));
driverRouter.patch("/status", authMiddleware, errorHandler(toggleDriverStatus));
driverRouter.get("/bookings", authMiddleware, errorHandler(getDriverBookings));
driverRouter.post("/vehicles", authMiddleware, errorHandler(assignVehicle));
driverRouter.delete("/vehicles/:vehicleId", authMiddleware, errorHandler(removeVehicleAssignment));
driverRouter.get("/stats", authMiddleware, errorHandler(getDriverStats));
driverRouter.get("/:id", errorHandler(getDriverById));

export default driverRouter;
