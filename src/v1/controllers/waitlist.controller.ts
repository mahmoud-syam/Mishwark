import { Request, Response } from "express";
import WaitlistService from "../services/waitlist.service";
import { paramStr } from "../utils/routeParams";

export const joinWaitlist = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const entry = await WaitlistService.joinWaitlist({
    customerId: userId,
    vehicleId: req.body.vehicleId,
    requestedDate: req.body.requestedDate,
    requestedTime: req.body.requestedTime,
  });
  res.status(201).json({ success: true, data: entry });
};

export const getWaitlistEntry = async (req: Request, res: Response) => {
  const entry = await WaitlistService.getWaitlistEntry(paramStr(req.params.id));
  res.status(200).json({ success: true, data: entry });
};

export const getCustomerWaitlist = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const entries = await WaitlistService.getCustomerWaitlist(userId);
  res.status(200).json({ success: true, data: entries });
};

export const cancelWaitlist = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await WaitlistService.cancelWaitlist(paramStr(req.params.id), userId);
  res.status(200).json({ success: true, data: result });
};

export const convertWaitlistToBooking = async (req: Request, res: Response) => {
  const entry = await WaitlistService.convertWaitlistToBooking(paramStr(req.params.id));
  res.status(200).json({ success: true, data: entry });
};
