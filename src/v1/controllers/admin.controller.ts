import { Request, Response } from "express";
import { z } from "zod";
import AdminService from "../services/admin.service";
import { paramStr, queryNum, queryStr } from "../utils/routeParams";
import AuditService from "../services/audit.service";
import prismaClient from "../utils/prismaClientHelper";
import { AuditAction } from "../../../generated/prisma";

const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name });

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
  req.body = z.object({ userId: z.string().min(1), roleId: z.string().min(1) }).parse(req.body);
  const before = await prismaClient.users.findUnique({
    where: { id: req.body.userId },
    select: { name: true, role: { select: { name: true } } },
  });
  const user = await AdminService.updateUserRole(req.body.userId, req.body.roleId);
  await AuditService.record(actorOf(req), {
    action: AuditAction.UPDATE,
    entityType: "user",
    entityId: user.id,
    entityLabel: `مستخدم: ${user.name}`,
    details: `role: ${before?.role?.name ?? "-"} → ${user.role?.name ?? "-"}`,
  });
  res.status(200).json({ success: true, data: user });
};

export const toggleDriverStatus = async (req: Request, res: Response) => {
  const before = await prismaClient.drivers.findUnique({
    where: { id: paramStr(req.params.id) },
    select: { status: true },
  });
  const driver = await AdminService.toggleDriverStatus(paramStr(req.params.id), req.body.status);
  if (before && before.status !== driver.status) {
    await AuditService.record(actorOf(req), {
      action: AuditAction.UPDATE,
      entityType: "driver",
      entityId: driver.id,
      entityLabel: `سائق: ${driver.fullName}`,
      details: `status: ${before.status.toLowerCase()} → ${driver.status.toLowerCase()}`,
    });
  }
  res.status(200).json({ success: true, data: driver });
};

export const getSystemSettings = async (req: Request, res: Response) => {
  const settings = await AdminService.getSystemSettings();
  res.status(200).json({ success: true, data: settings });
};

export const updateSystemSettings = async (req: Request, res: Response) => {
  const before = await AdminService.getSystemSettings();
  const settings = await AdminService.updateSystemSettings(req.body);
  const details = AuditService.diff(before as any, settings as any, [
    "performanceHistoryVisible",
    "evaluationsVisible",
    "selfAppraisalsVisible",
  ]);
  if (details) {
    await AuditService.record(actorOf(req), {
      action: AuditAction.UPDATE,
      entityType: "settings",
      entityId: "global",
      entityLabel: "إعدادات النظام",
      details,
    });
  }
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
