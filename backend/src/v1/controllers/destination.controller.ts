import { Request, Response } from "express";
import { AuditAction } from "../../../generated/prisma";
import AuditService from "../services/audit.service";
import DestinationService, { destinationCreateSchema, destinationUpdateSchema } from "../services/destination.service";
import { paramStr } from "../utils/routeParams";

const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name });

/** GET /pricing (public): prices and rules for the apps. */
export const getPricingCatalog = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await DestinationService.catalog() });
};

export const listDestinations = async (_req: Request, res: Response) => {
  res.json({ success: true, data: await DestinationService.list(true) });
};

export const createDestination = async (req: Request, res: Response) => {
  const d = await DestinationService.create(destinationCreateSchema.parse(req.body));
  await AuditService.record(actorOf(req), { action: AuditAction.CREATE, entityType: "destination", entityId: d.id, entityLabel: `وجهة: ${d.name}`, details: `prices ${JSON.stringify(d.prices)}` });
  res.status(201).json({ success: true, data: d });
};

export const updateDestination = async (req: Request, res: Response) => {
  const { before, after } = await DestinationService.update(paramStr(req.params.id), destinationUpdateSchema.parse(req.body));
  const changes = (["name", "includedKm", "active", "latitude", "longitude"] as const)
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${before[k]} → ${after[k]}`);
  if (JSON.stringify(before.prices) !== JSON.stringify(after.prices)) changes.push(`prices: ${JSON.stringify(before.prices)} → ${JSON.stringify(after.prices)}`);
  if (changes.length) await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "destination", entityId: after.id, entityLabel: `وجهة: ${after.name}`, details: changes.join(" · ") });
  res.json({ success: true, data: after });
};

export const deleteDestination = async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const r = await DestinationService.remove(id);
  await AuditService.record(actorOf(req), { action: r.removed ? AuditAction.DELETE : AuditAction.UPDATE, entityType: "destination", entityId: id, entityLabel: `وجهة: ${r.name}`, details: r.removed ? "deleted" : "switched off (has bookings)" });
  res.json({ success: true, data: r });
};
