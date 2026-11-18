import { Request, Response } from "express";
import { z } from "zod";
import { AuditAction, DriverDocumentType } from "../../../generated/prisma";
import DriverDocumentService from "../services/driver-document.service";
import AuditService from "../services/audit.service";
import { getDriverIdForUser } from "../services/role.service";
import { isAdminRole } from "../constants/roles";
import { BadRequestException, ForbiddenException, NotFoundException } from "../utils/errors";
import { paramStr } from "../utils/routeParams";

const TYPE_LABEL: Record<DriverDocumentType, string> = {
  NATIONAL_ID_FRONT: "البطاقة (وش)",
  NATIONAL_ID_BACK: "البطاقة (ضهر)",
  LICENSE_FRONT: "الرخصة (وش)",
  LICENSE_BACK: "الرخصة (ضهر)",
  CRIMINAL_RECORD: "الفيش والتشبيه",
};

const myDriverId = async (req: Request) => {
  const id = await getDriverIdForUser(req.user!.id);
  if (!id) throw new ForbiddenException("Only drivers have documents");
  return id;
};

/** Sends a document inline, never cached by shared caches. */
const sendDocument = async (res: Response, id: string) => {
  const { doc, full } = await DriverDocumentService.file(id);
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${doc.type.toLowerCase()}.${full.split(".").pop()}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(full);
};

// ---------------------------------------------------------------- driver app
/** GET /driver/documents: every required document with its status (MISSING, PENDING, APPROVED, REJECTED + reviewNote). */
export const listMyDocuments = async (req: Request, res: Response) => {
  res.json({ success: true, data: await DriverDocumentService.list(await myDriverId(req)) });
};

/** POST /driver/documents (multipart: type + file). Replaces the earlier one of that type. */
export const uploadMyDocument = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new BadRequestException("Attach the document as `file`");
  const parsed = z.nativeEnum(DriverDocumentType).safeParse(req.body?.type);
  if (!parsed.success) {
    (await import("fs")).rmSync(file.path, { force: true });
    throw new BadRequestException(`type must be one of ${Object.values(DriverDocumentType).join(", ")}`);
  }
  const driverId = await getDriverIdForUser(req.user!.id);
  if (!driverId) {
    (await import("fs")).rmSync(file.path, { force: true });
    throw new ForbiddenException("Only drivers have documents");
  }
  const doc = await DriverDocumentService.save(driverId, parsed.data, file);
  res.status(201).json({ success: true, data: doc });
};

/** GET /driver/documents/:id/file: the driver's own document. */
export const myDocumentFile = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const { doc } = await DriverDocumentService.file(id);
  if (doc.driver.userId !== req.user!.id && !isAdminRole(req.user?.role?.name)) throw new NotFoundException("Document not found");
  await sendDocument(res, id);
};

// ----------------------------------------------------------------- dashboard
export const adminDriverDocuments = async (req: Request, res: Response) => {
  res.json({ success: true, data: await DriverDocumentService.list(paramStr(req.params.id)) });
};

export const adminDocumentFile = async (req: Request, res: Response) => {
  await sendDocument(res, paramStr(req.params.id));
};

const reviewSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(300).optional() }).strict();

/** PATCH /admin/driver-documents/:id { status, note }: approve, or reject with a reason the driver sees. */
export const reviewDocument = async (req: Request, res: Response) => {
  const { status, note } = reviewSchema.parse(req.body ?? {});
  const r = await DriverDocumentService.review(paramStr(req.params.id), status, note, req.user!.id);
  await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
    action: AuditAction.UPDATE,
    entityType: "driver_document",
    entityId: r.before.driverId,
    entityLabel: `${TYPE_LABEL[r.before.type]}: ${r.driverName}`,
    details: `status: ${r.before.status} → ${status}${status === "REJECTED" ? ` · ${note}` : ""}`,
  });
  res.json({ success: true, data: r.after });
};
