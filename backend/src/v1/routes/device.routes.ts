import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { authMiddleware } from "../middlewares/auth.middleware";
import { listDevices, registerDevice, removeDevice } from "../controllers/device.controller";

const deviceRouter: Router = Router();

deviceRouter.get("/", authMiddleware, errorHandler(listDevices));
deviceRouter.post("/", authMiddleware, errorHandler(registerDevice));
deviceRouter.delete("/", authMiddleware, errorHandler(removeDevice));

export default deviceRouter;
