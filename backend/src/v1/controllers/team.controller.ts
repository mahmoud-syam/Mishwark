import { NextFunction, Request, Response } from "express";
import TeamService, { teamCreateSchema, teamRoleSchema } from "../services/team.service";
import AuditService from "../services/audit.service";
import { AuditAction } from "../../../generated/prisma";
import { paramStr } from "../utils/routeParams";
import { isSuperAdminRole } from "../constants/roles";
import { ForbiddenException } from "../utils/errors";

const ROLE_AR: Record<string, string> = { SUPER_ADMIN: "سوبر أدمن", ADMIN: "أدمن" };
const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name });
const label = (m: { name: string; email: string | null }) => `حساب: ${m.name}${m.email ? ` (${m.email})` : ""}`;

/** The Team page is the Super Admin's only. */
export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!isSuperAdminRole(req.user?.role?.name)) return next(new ForbiddenException("Only a Super Admin can manage team accounts"));
  next();
};

export const listTeam = async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await TeamService.list() });
};

export const createTeamMember = async (req: Request, res: Response) => {
  const { member, temporaryPassword } = await TeamService.create(teamCreateSchema.parse(req.body ?? {}));
  await AuditService.record(actorOf(req), {
    action: AuditAction.CREATE,
    entityType: "user",
    entityId: member.id,
    entityLabel: label(member),
    details: `إنشاء حساب ${ROLE_AR[member.role]} بباسورد مؤقت`,
  });
  // The temporary password is shown once; only its hash is stored.
  res.status(201).json({ success: true, data: { member, temporaryPassword } });
};

export const resetTeamMember2FA = async (req: Request, res: Response) => {
  const member = await TeamService.reset2FA(paramStr(req.params.id), req.user!.id);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "user", entityId: member.id, entityLabel: label(member), details: "إعادة ضبط التحقق بخطوتين" });
  res.status(200).json({ success: true, data: member });
};

export const resetTeamMemberPassword = async (req: Request, res: Response) => {
  const { member, temporaryPassword } = await TeamService.resetPassword(paramStr(req.params.id), req.user!.id);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "user", entityId: member.id, entityLabel: label(member), details: "إعادة ضبط الباسورد (باسورد مؤقت جديد)" });
  res.status(200).json({ success: true, data: { member, temporaryPassword } });
};

export const setTeamMemberRole = async (req: Request, res: Response) => {
  const { role } = teamRoleSchema.parse(req.body ?? {});
  const { member, from } = await TeamService.setRole(paramStr(req.params.id), req.user!.id, role);
  if (from !== role) {
    await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "user", entityId: member.id, entityLabel: label(member), details: `الدور: ${ROLE_AR[from] ?? from} → ${ROLE_AR[role]}` });
  }
  res.status(200).json({ success: true, data: member });
};

export const disableTeamMember = async (req: Request, res: Response) => {
  const member = await TeamService.disable(paramStr(req.params.id), req.user!.id);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "user", entityId: member.id, entityLabel: label(member), details: "إيقاف الحساب (خرج من كل الأجهزة)" });
  res.status(200).json({ success: true, data: member });
};

export const enableTeamMember = async (req: Request, res: Response) => {
  const member = await TeamService.enable(paramStr(req.params.id), req.user!.id);
  await AuditService.record(actorOf(req), { action: AuditAction.UPDATE, entityType: "user", entityId: member.id, entityLabel: label(member), details: "إعادة تفعيل الحساب" });
  res.status(200).json({ success: true, data: member });
};
