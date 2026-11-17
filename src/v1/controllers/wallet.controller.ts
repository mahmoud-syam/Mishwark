import { Request, Response } from "express";
import { z } from "zod";
import WalletService from "../services/wallet.service";
import prismaClient from "../utils/prismaClientHelper";
import AuditService from "../services/audit.service";
import { AuditAction, WalletTransactionType } from "../../../generated/prisma";
import { NotFoundException } from "../utils/errors";

export const getBalance = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const balance = await WalletService.getBalance(userId);
  res.status(200).json({ success: true, data: balance });
};

export const getTransactions = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await WalletService.getTransactions(userId, {
    page: req.query.page ? parseInt(req.query.page as string) : 1,
    limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
    type: req.query.type as any,
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

// Admin-only (canAdjustWallet). The target is the user in the body; this used
// to credit/debit the admin's own wallet, so customers never received it.
const adjustSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  type: z.nativeEnum(WalletTransactionType),
  description: z.string().max(500).optional(),
});

const adjust = (kind: "credit" | "debit") => async (req: Request, res: Response) => {
  const input = adjustSchema.parse(req.body);
  const target = await prismaClient.users.findFirst({ where: { id: input.userId, isDeleted: false }, select: { id: true, name: true } });
  if (!target) throw new NotFoundException("User not found");
  const transaction =
    kind === "credit"
      ? await WalletService.creditWallet(target.id, input.amount, input.type, input.description)
      : await WalletService.debitWallet(target.id, input.amount, input.type, input.description);
  await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
    action: AuditAction.UPDATE,
    entityType: "wallet",
    entityId: target.id,
    entityLabel: `محفظة: ${target.name}`,
    details: `${kind === "credit" ? "+" : "-"}${input.amount} (${input.type})${input.description ? ` · ${input.description}` : ""}`,
  });
  res.status(201).json({ success: true, data: transaction });
};

export const creditWallet = adjust("credit");
export const debitWallet = adjust("debit");
