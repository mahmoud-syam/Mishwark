import { Request, Response } from "express";
import { assignVehicleSchema } from "../schemas/driver.schema";
import DriverService from "../services/driver.service";
import { paramStr, queryNum, queryStr } from "../utils/routeParams";

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
    limit: queryNum(req.query.limit, 10),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const assignVehicle = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const { vehicleId, isPrimary } = assignVehicleSchema.parse(req.body);
  const assignment = await DriverService.assignVehicle(userId, vehicleId, isPrimary);
  res.status(201).json({ success: true, data: assignment });
};

export const removeVehicleAssignment = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await DriverService.removeVehicleAssignment(userId, paramStr(req.params.vehicleId));
  res.status(200).json({ success: true, data: result });
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
