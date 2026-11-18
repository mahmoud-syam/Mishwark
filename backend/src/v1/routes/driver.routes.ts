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
import { listMyDocuments, myDocumentFile, uploadMyDocument } from "../controllers/driver-document.controller";
import { documentUpload } from "../services/driver-document.service";

const driverRouter: Router = Router();

driverRouter.get("/profile", authMiddleware, errorHandler(getDriverProfile));
driverRouter.put("/profile", authMiddleware, errorHandler(updateDriverProfile));
driverRouter.patch("/status", authMiddleware, errorHandler(toggleDriverStatus));
driverRouter.get("/bookings", authMiddleware, errorHandler(getDriverBookings));
driverRouter.post("/vehicles", authMiddleware, errorHandler(assignVehicle));
driverRouter.delete("/vehicles/:vehicleId", authMiddleware, errorHandler(removeVehicleAssignment));
driverRouter.get("/stats", authMiddleware, errorHandler(getDriverStats));
// Papers (ID, licence, criminal record): private, reviewed from the dashboard.
driverRouter.get("/documents", authMiddleware, errorHandler(listMyDocuments));
driverRouter.post("/documents", authMiddleware, documentUpload.single("file"), errorHandler(uploadMyDocument));
driverRouter.get("/documents/:id/file", authMiddleware, errorHandler(myDocumentFile));
driverRouter.get("/:id", errorHandler(getDriverById));

export default driverRouter;
