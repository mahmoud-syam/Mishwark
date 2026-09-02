import { Request, Response } from "express";
import WalletService from "../services/wallet.service";

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

export const creditWallet = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const transaction = await WalletService.creditWallet(userId, req.body.amount, req.body.type, req.body.description);
  res.status(201).json({ success: true, data: transaction });
};

export const debitWallet = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const transaction = await WalletService.debitWallet(userId, req.body.amount, req.body.type, req.body.description);
  res.status(201).json({ success: true, data: transaction });
};
