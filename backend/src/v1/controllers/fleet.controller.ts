import { Request, Response } from "express";
import { z } from "zod";
import FleetService, {
  assignDriversSchema,
  maintenanceCompleteSchema,
  maintenanceCreateSchema,
  retireSchema,
  vehicleCreateSchema,
  vehicleUpdateSchema,
} from "../services/fleet.service";
import AuditService from "../services/audit.service";
import { AuditAction, VehicleCategory } from "../../../generated/prisma";
import { paramStr, queryStr } from "../utils/routeParams";

const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });
const label = (v: { make: string; model: string; plateNumber: string }) => `عربية: ${v.make} ${v.model} (${v.plateNumber})`;

/** Arabic names for the audit log. */
const FIELD_LABELS: Record<string, string> = {
  make: "الماركة",
  model: "الموديل",
  year: "سنة الصنع",
  plateNumber: "رقم اللوحة",
  color: "اللون",
  capacity: "عدد الركاب",
  category: "النوع",
  weddingPrice: "سعر الزفاف",
  vipPrice: "سعر VIP",
  description: "الوصف",
  luggage: "الشنط",
  features: "المميزات",
};

const listQuery = z.object({
  search: z.string().max(60).optional(),
  category: z.nativeEnum(VehicleCategory).optional(),
  status: z.enum(["AVAILABLE", "BOOKED", "MAINTENANCE", "RETIRED"]).optional(),
});

export const listFleet = async (req: Request, res: Response) => {
  const q = listQuery.parse({ search: queryStr(req.query.search), category: queryStr(req.query.category), status: queryStr(req.query.status) });
  const data = await FleetService.list(q);
  res.json({ success: true, data: data.items, summary: data.summary });
};

export const getFleetVehicle = async (req: Request, res: Response) => {
  res.json({ success: true, data: await FleetService.detail(paramStr(req.params.id)) });
};

export const getFeatureSuggestions = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await FleetService.featureSuggestions() });
};

export const createVehicle = async (req: Request, res: Response) => {
  const input = vehicleCreateSchema.parse(req.body);
  const v = await FleetService.create(input);
  await AuditService.record(actorOf(req), { action: AuditAction.CREATE, entityType: "vehicle", entityId: v.id, entityLabel: label(v), details: "عربية جديدة في الأسطول" });
  res.status(201).json({ success: true, data: v });
};

export const updateFleetVehicle = async (req: Request, res: Response) => {
  const input = vehicleUpdateSchema.parse(req.body);
  const { before, after } = await FleetService.update(paramStr(req.params.id), input);
  const show = (x: unknown) => (Array.isArray(x) ? x.join("، ") || "—" : String(x));
  const details = Object.keys(input)
    .filter((k) => show((before as any)[k]) !== show((after as any)[k]))
    .map((k) => `${FIELD_LABELS[k] ?? k}: ${show((before as any)[k])} → ${show((after as any)[k])}`)
    .join(" · ");
  if (details) await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "vehicle", entityId: after.id, entityLabel: label(after), details });
  res.json({ success: true, data: after });
};

export const retireVehicle = async (req: Request, res: Response) => {
  const { reason } = retireSchema.parse(req.body ?? {});
  const v = await FleetService.retire(paramStr(req.params.id), reason);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "vehicle", entityId: v.id, entityLabel: label(v), details: `إيقاف العربية${reason ? `: ${reason}` : ""}` });
  res.json({ success: true, data: v });
};

export const reactivateVehicle = async (req: Request, res: Response) => {
  const v = await FleetService.reactivate(paramStr(req.params.id));
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "vehicle", entityId: v.id, entityLabel: label(v), details: "إعادة تشغيل العربية" });
  res.json({ success: true, data: v });
};

export const setVehicleDrivers = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const { driverIds, primaryDriverId } = assignDriversSchema.parse(req.body);
  const change = await FleetService.setDrivers(id, driverIds, primaryDriverId);
  const v = await FleetService.detail(id);
  await AuditService.record(actorOf(req), {
    action: AuditAction.UPDATE,
    entityType: "vehicle",
    entityId: id,
    entityLabel: label(v),
    details: `السواقين: ${change.before.join("، ") || "—"} → ${change.after.join("، ") || "—"}`,
  });
  res.json({ success: true, data: v.drivers });
};

export const uploadVehicleImages = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const files = (req.files as Express.Multer.File[]) ?? [];
  const images = await FleetService.addImages(id, files);
  const v = await FleetService.detail(id);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "vehicle", entityId: id, entityLabel: label(v), details: `إضافة ${files.length} صورة` });
  res.status(201).json({ success: true, data: images });
};

export const deleteVehicleImage = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  await FleetService.removeImage(id, paramStr(req.params.imageId));
  const v = await FleetService.detail(id);
  await AuditService.record(actorOf(req), { action: AuditAction.DELETE, entityType: "vehicle", entityId: id, entityLabel: label(v), details: "حذف صورة" });
  res.json({ success: true, data: v.images });
};

export const setVehicleCover = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  await FleetService.setCover(id, paramStr(req.params.imageId));
  res.json({ success: true, data: (await FleetService.detail(id)).images });
};

export const scheduleMaintenance = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const input = maintenanceCreateSchema.parse(req.body);
  const m = await FleetService.scheduleMaintenance(id, input);
  const v = await FleetService.detail(id);
  const range = input.endDate && input.endDate !== input.startDate ? `${input.startDate} → ${input.endDate}` : input.startDate;
  await AuditService.record(actorOf(req), { action: AuditAction.CREATE, entityType: "vehicle", entityId: id, entityLabel: label(v), details: `صيانة: ${input.maintenanceType} · ${range}` });
  res.status(201).json({ success: true, data: m });
};

export const completeMaintenance = async (req: Request, res: Response) => {
  const input = maintenanceCompleteSchema.parse(req.body ?? {});
  const m = await FleetService.completeMaintenance(paramStr(req.params.id), input);
  const v = await FleetService.detail(m.vehicleId);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "vehicle", entityId: m.vehicleId, entityLabel: label(v), details: `خلصت الصيانة: ${m.maintenanceType}${m.cost ? ` · التكلفة ${m.cost}` : ""}` });
  res.json({ success: true, data: m });
};

export const cancelMaintenance = async (req: Request, res: Response) => {
  const m = await FleetService.cancelMaintenance(paramStr(req.params.id));
  const v = await FleetService.detail(m.vehicleId);
  await AuditService.record(actorOf(req), { action: AuditAction.DELETE, entityType: "vehicle", entityId: m.vehicleId, entityLabel: label(v), details: `إلغاء صيانة: ${m.maintenanceType}` });
  res.json({ success: true, data: { id: m.id } });
};
