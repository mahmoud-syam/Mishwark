import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  createPackage,
  addBookingToPackage,
  removeBookingFromPackage,
  getPackageById,
  getCustomerPackages,
  cancelPackage,
} from "../controllers/package.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const packageRouter: Router = Router();

packageRouter.post("/", authMiddleware, errorHandler(createPackage));
packageRouter.get("/me", authMiddleware, errorHandler(getCustomerPackages));
packageRouter.get("/:id", authMiddleware, errorHandler(getPackageById));
packageRouter.post("/:id/booking", authMiddleware, errorHandler(addBookingToPackage));
packageRouter.delete("/:id/booking", authMiddleware, errorHandler(removeBookingFromPackage));
packageRouter.patch("/:id/cancel", authMiddleware, errorHandler(cancelPackage));

export default packageRouter;
