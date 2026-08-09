import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { getVehicles, getVehicleById, getVehicleAvailability } from "../controllers/vehicles.controller";

const vehiclesRouterV1: Router = Router();

vehiclesRouterV1.get("/", errorHandler(getVehicles));
vehiclesRouterV1.get("/:id", errorHandler(getVehicleById));
vehiclesRouterV1.get("/:id/availability", errorHandler(getVehicleAvailability));

export default vehiclesRouterV1;
