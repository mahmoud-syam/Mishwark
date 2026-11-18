import { Request, Response } from "express";
import PlacesService from "../services/places.service";
import { queryStr } from "../utils/routeParams";

const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** GET /places/search?q=…&lat=&lng= : places in Egypt for the booking map. */
export const searchPlaces = async (req: Request, res: Response) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  try {
    const data = await PlacesService.search(queryStr(req.query.q) ?? "", Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined);
    res.json({ success: true, data });
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    console.warn("[places] search failed:", (err as Error).message);
    res.status(502).json({ message: "Place search is unavailable right now. Drop a pin on the map instead.", errorCode: 5001, errors: null });
  }
};

/** GET /places/reverse?lat=&lng= : the address at a pin. */
export const reversePlace = async (req: Request, res: Response) => {
  res.json({ success: true, data: await PlacesService.reverse(num(req.query.lat), num(req.query.lng)) });
};
