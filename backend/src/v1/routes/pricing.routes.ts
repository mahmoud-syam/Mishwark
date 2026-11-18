import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { getPricingCatalog } from "../controllers/destination.controller";

// Public: the apps show prices before anyone signs up.
const pricingRouter: Router = Router();
pricingRouter.get("/", errorHandler(getPricingCatalog));

export default pricingRouter;
