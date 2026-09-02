import { Request, Response } from "express";
import AdminService from "../services/admin.service";
import { paramStr, queryNum, queryStr } from "../utils/routeParams";

export const getDashboardStats = async (req: Request, res: Response) => {
  const stats = await AdminService.getDashboardStats();
  res.status(200).json({ success: true, data: stats });
};

export const getBookingsCalendar = async (req: Request, res: Response) => {
  const calendar = await AdminService.getBookingsCalendar(queryStr(req.query.month) as string);
  res.status(200).json({ success: true, data: calendar });
};

export const getBookingsByDate = async (req: Request, res: Response) => {
  const result = await AdminService.getBookingsByDate(
    queryStr(req.query.date) as string,
    queryNum(req.query.page, 1),
    queryNum(req.query.limit, 20)
  );
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const getFleetStatus = async (req: Request, res: Response) => {
  const fleet = await AdminService.getFleetStatus();
  res.status(200).json({ success: true, data: fleet });
};

export const getDriverStats = async (req: Request, res: Response) => {
  const stats = await AdminService.getDriverStats(paramStr(req.params.id));
  res.status(200).json({ success: true, data: stats });
};

export const listUsers = async (req: Request, res: Response) => {
  const result = await AdminService.listUsers({
    page: queryNum(req.query.page, 1),
    limit: queryNum(req.query.limit, 20),
    role: queryStr(req.query.role),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const listDrivers = async (req: Request, res: Response) => {
  const result = await AdminService.listDrivers({
    page: queryNum(req.query.page, 1),
    limit: queryNum(req.query.limit, 20),
    status: queryStr(req.query.status),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const updateUserRole = async (req: Request, res: Response) => {
  const user = await AdminService.updateUserRole(req.body.userId, req.body.roleId);
  res.status(200).json({ success: true, data: user });
};

export const toggleDriverStatus = async (req: Request, res: Response) => {
  const driver = await AdminService.toggleDriverStatus(paramStr(req.params.id), req.body.status);
  res.status(200).json({ success: true, data: driver });
};

export const getSystemSettings = async (req: Request, res: Response) => {
  const settings = await AdminService.getSystemSettings();
  res.status(200).json({ success: true, data: settings });
};

export const updateSystemSettings = async (req: Request, res: Response) => {
  const settings = await AdminService.updateSystemSettings(req.body);
  res.status(200).json({ success: true, data: settings });
};

export const getAllBookings = async (req: Request, res: Response) => {
  const result = await AdminService.getAllBookings({
    page: queryNum(req.query.page, 1),
    limit: queryNum(req.query.limit, 20),
    status: queryStr(req.query.status),
    customerId: queryStr(req.query.customerId),
    driverId: queryStr(req.query.driverId),
    vehicleId: queryStr(req.query.vehicleId),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};
