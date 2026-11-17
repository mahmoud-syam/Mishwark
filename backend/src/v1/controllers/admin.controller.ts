import { Request, Response } from "express";
import { z } from "zod";
import AdminService from "../services/admin.service";
import { paramStr, queryNum, queryStr, queryLimit } from "../utils/routeParams";
import AuditService from "../services/audit.service";
import SettingsService, { updateSettingsSchema } from "../services/settings.service";
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
    queryLimit(req.query.limit, 20)
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
    limit: queryLimit(req.query.limit, 20),
    role: queryStr(req.query.role),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const listDrivers = async (req: Request, res: Response) => {
  const result = await AdminService.listDrivers({
    page: queryNum(req.query.page, 1),
    limit: queryLimit(req.query.limit, 20),
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
  const settings = await SettingsService.getForAdmin();
  res.status(200).json({ success: true, data: settings });
};

/** Arabic names for the audit log (shown on the dashboard). */
const SETTING_LABELS: Record<string, string> = {
  depositRate: "نسبة العربون %",
  bookingBufferMinutes: "الفاصل بين الرحلات (دقيقة)",
  tripEarlyStartMinutes: "بدء الرحلة مبكراً (دقيقة)",
  defaultCommissionRate: "عمولة السائق الجديد %",
  referralRewardAmount: "مكافأة الإحالة",
  referredDiscountAmount: "خصم العميل المدعو على أول حجز",
  peakSurgeMultiplier: "مضاعف وقت الذروة",
  vipSpendThreshold: "حد عميل VIP",
  delayAlertMinutes: "تنبيه التأخير (دقيقة)",
  punctualityGraceMinutes: "سماحية التأخير في البدء (دقيقة)",
  complaintMaxRating: "تقييم الشكوى (أقل من أو يساوي)",
  maintenanceAlertDays: "تنبيه الصيانة (يوم)",
  performanceHistoryVisible: "performanceHistoryVisible",
  evaluationsVisible: "evaluationsVisible",
  selfAppraisalsVisible: "selfAppraisalsVisible",
};

const describeSettingsChange = (before: any, after: any): string => {
  const parts: string[] = [];
  for (const key of Object.keys(SETTING_LABELS)) {
    if (before[key] !== after[key]) parts.push(`${SETTING_LABELS[key]}: ${before[key]} → ${after[key]}`);
  }
  for (const cat of Object.keys(after.categoryRates ?? {})) {
    const b = before.categoryRates?.[cat] ?? {};
    const a = after.categoryRates[cat];
    for (const f of ["basePrice", "pricePerKm", "pricePerHour"]) {
      if (b[f] !== a[f]) parts.push(`سعر ${cat} ${f}: ${b[f]} → ${a[f]}`);
    }
  }
  return parts.join(" · ");
};

export const updateSystemSettings = async (req: Request, res: Response) => {
  const input = updateSettingsSchema.parse(req.body);
  const before = await SettingsService.getForAdmin();
  const settings = await SettingsService.update(input);
  const details = describeSettingsChange(before, settings);
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
    limit: queryLimit(req.query.limit, 20),
    status: queryStr(req.query.status),
    customerId: queryStr(req.query.customerId),
    driverId: queryStr(req.query.driverId),
    vehicleId: queryStr(req.query.vehicleId),
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};
