import { Request, Response } from "express";
import { ForbiddenException } from "../utils/errors";
import DriverService from "../services/driver.service";
import { paramStr, queryNum, queryStr, queryLimit } from "../utils/routeParams";

export const getDriverProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const profile = await DriverService.getDriverProfile(userId);
  res.status(200).json({ success: true, data: profile });
};

export const updateDriverProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const profile = await DriverService.updateDriverProfile(userId, req.body);
  res.status(200).json({ success: true, data: profile });
};

export const toggleDriverStatus = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const driver = await DriverService.toggleDriverStatus(userId, req.body.status);
  res.status(200).json({ success: true, data: driver });
};

export const getDriverBookings = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await DriverService.listDriverBookings(userId, {
    filter: queryStr(req.query.filter),
    page: queryNum(req.query.page, 1),
    limit: queryLimit(req.query.limit, 10),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

// Cars are assigned to drivers by an admin on the dashboard's fleet page; a
// driver used to be able to attach himself to any car from the app.
const ASSIGNED_BY_ADMIN = "Cars are assigned to drivers by the administration";

export const assignVehicle = async (_req: Request, _res: Response) => {
  throw new ForbiddenException(ASSIGNED_BY_ADMIN);
};

export const removeVehicleAssignment = async (_req: Request, _res: Response) => {
  throw new ForbiddenException(ASSIGNED_BY_ADMIN);
};

export const getDriverStats = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const stats = await DriverService.getDriverStats(userId);
  res.status(200).json({ success: true, data: stats });
};

export const getDriverById = async (req: Request, res: Response) => {
  const driver = await DriverService.getDriverById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: driver });
};
