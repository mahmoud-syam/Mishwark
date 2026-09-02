import { Request, Response } from "express";
import ReferralService from "../services/referral.service";
import { paramStr } from "../utils/routeParams";

export const generateReferralCode = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await ReferralService.generateReferralCode(userId);
  res.status(200).json({ success: true, data: result });
};

export const applyReferralCode = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const referral = await ReferralService.applyReferralCode(userId, req.body.referralCode);
  res.status(201).json({ success: true, data: referral });
};

export const completeReferral = async (req: Request, res: Response) => {
  const referral = await ReferralService.completeReferral(paramStr(req.params.id));
  res.status(200).json({ success: true, data: referral });
};

export const getReferralStats = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const stats = await ReferralService.getReferralStats(userId);
  res.status(200).json({ success: true, data: stats });
};

export const getReferralById = async (req: Request, res: Response) => {
  const referral = await ReferralService.getReferralById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: referral });
};
