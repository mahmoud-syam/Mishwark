import { Request, Response } from "express";
import * as XLSX from "xlsx";
import AdminDashboardService from "../services/admin-dashboard.service";
import AuditService from "../services/audit.service";
import PackageService from "../services/package.service";
import { AuditAction, PackageStatus } from "../../../generated/prisma";
import { paramStr, queryNum, queryStr } from "../utils/routeParams";
import {
  auditActionSchema,
  bookOnBehalfSchema,
  commissionSchema,
  packageDiscountSchema,
  dateParamSchema,
  periodSchema,
  quickCustomerSchema,
  vehiclePatchSchema,
} from "../schemas/admin-dashboard.schema";
import { BUSINESS_TZ } from "../utils/businessTime";

const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });

export const getOverview = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await AdminDashboardService.overview() });
};

export const getDriversSummary = async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, queryNum(req.query.limit, 3)));
  res.json({ success: true, data: await AdminDashboardService.driversSummary(limit) });
};

export const getDay = async (req: Request, res: Response) => {
  const date = dateParamSchema.parse(paramStr(req.params.date));
  res.json({ success: true, data: await AdminDashboardService.day(date) });
};

export const getLiveTrips = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await AdminDashboardService.liveTrips() });
};

export const getDriverAnalytics = async (req: Request, res: Response) => {
  const period = periodSchema.parse(queryStr(req.query.period));
  res.json({ success: true, data: await AdminDashboardService.driverAnalytics(paramStr(req.params.id), period) });
};

export const updateDriverCommission = async (req: Request, res: Response) => {
  const { commissionRate } = commissionSchema.parse(req.body);
  const data = await AdminDashboardService.setCommission(paramStr(req.params.id), commissionRate, actorOf(req));
  res.json({ success: true, data });
};

export const getCustomerAnalytics = async (req: Request, res: Response) => {
  const period = periodSchema.parse(queryStr(req.query.period));
  res.json({ success: true, data: await AdminDashboardService.customerAnalytics(paramStr(req.params.id), period) });
};

export const searchCustomers = async (req: Request, res: Response) => {
  const data = await AdminDashboardService.searchCustomers(queryStr(req.query.q) ?? "", Math.min(20, queryNum(req.query.limit, 8)));
  res.json({ success: true, data });
};

export const createCustomer = async (req: Request, res: Response) => {
  const input = quickCustomerSchema.parse(req.body);
  res.status(201).json({ success: true, data: await AdminDashboardService.quickCreateCustomer(input, actorOf(req)) });
};

export const bookOnBehalf = async (req: Request, res: Response) => {
  const input = bookOnBehalfSchema.parse(req.body);
  res.status(201).json({ success: true, data: await AdminDashboardService.bookOnBehalf(input, actorOf(req)) });
};

export const updateVehicle = async (req: Request, res: Response) => {
  const patch = vehiclePatchSchema.parse(req.body);
  res.json({ success: true, data: await AdminDashboardService.updateVehicle(paramStr(req.params.id), patch, actorOf(req)) });
};

export const getAssignableDrivers = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await AdminDashboardService.assignableDrivers() });
};

export const listAuditLogs = async (req: Request, res: Response) => {
  const action = auditActionSchema.parse(queryStr(req.query.action));
  const result = await AuditService.list({ action, page: queryNum(req.query.page, 1), limit: queryNum(req.query.limit, 20) });
  res.json({ success: true, data: result.items, pagination: result.pagination });
};

const ACTION_AR: Record<string, string> = { CREATE: "إنشاء", UPDATE: "تعديل", DELETE: "حذف" };

export const exportAuditLogs = async (req: Request, res: Response) => {
  const action = auditActionSchema.parse(queryStr(req.query.action));
  const rows = await AuditService.listForExport(action);
  const fmt = new Intl.DateTimeFormat("ar-EG", { timeZone: BUSINESS_TZ, dateStyle: "medium", timeStyle: "short" });

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      "التاريخ والوقت": fmt.format(r.createdAt),
      "مين عمل الفعل": r.actorName,
      "الفعل": ACTION_AR[r.action] ?? r.action,
      "على إيه": r.entityLabel,
      "التفاصيل": r.details,
      "نوع العنصر": r.entityType,
      "معرّف العنصر": r.entityId,
    }))
  );
  sheet["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 8 }, { wch: 34 }, { wch: 40 }, { wch: 12 }, { wch: 38 }];
  const book = XLSX.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(book, sheet, "Audit Log");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buffer);
};

// ---------------------------------------------------------------- packages
const PACKAGE_STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"] as const;

export const listPackages = async (req: Request, res: Response) => {
  const status = queryStr(req.query.status);
  const result = await PackageService.listForAdmin({
    status: PACKAGE_STATUSES.includes(status as any) ? (status as PackageStatus) : undefined,
    page: queryNum(req.query.page, 1),
    limit: queryNum(req.query.limit, 50),
  });
  res.json({ success: true, data: result.items, pagination: result.pagination });
};

export const updatePackageDiscount = async (req: Request, res: Response) => {
  const { discountPercentage } = packageDiscountSchema.parse(req.body);
  const id = paramStr(req.params.id);
  const result = await PackageService.setDiscount(id, discountPercentage);
  if (result.before !== discountPercentage) {
    const pkg = result.package!;
    await AuditService.record(actorOf(req), {
      action: AuditAction.UPDATE,
      entityType: "package",
      entityId: id,
      entityLabel: `باكدج: ${pkg.packageName}`,
      details: `خصم الباكدج: ${result.before}% → ${discountPercentage}%` + (result.repriced ? ` · اتعدّل سعر ${result.repriced} حجز` : ""),
    });
  }
  res.json({ success: true, data: { ...result.package, repriced: result.repriced } });
};
