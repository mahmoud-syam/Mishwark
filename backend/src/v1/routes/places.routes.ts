import { Router } from "express";
import { errorHandler } from "../../error-handler";
import { reversePlace, searchPlaces } from "../controllers/places.controller";

// Public: the apps let people browse and price trips before signing up.
// Limited per IP in src/index.ts (PLACES_RATE_LIMIT).
const placesRouter: Router = Router();
placesRouter.get("/search", errorHandler(searchPlaces));
placesRouter.get("/reverse", errorHandler(reversePlace));

export default placesRouter;
