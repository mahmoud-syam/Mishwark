import { Request, Response } from "express";
import prismaClient from "../utils/prismaClientHelper";
import { assertOwnerOrAdmin } from "../utils/ownership";
import { NotFoundException } from "../utils/errors";
import WaitlistService from "../services/waitlist.service";
import { paramStr } from "../utils/routeParams";

const ownEntry = async (id: string, user: any) => {
  const e = await prismaClient.waitlist.findUnique({ where: { id }, select: { customerId: true } });
  if (!e) throw new NotFoundException("Waitlist entry not found");
  assertOwnerOrAdmin(user, [e.customerId], "Waitlist entry");
};

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
  await ownEntry(paramStr(req.params.id), req.user);
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
  await ownEntry(paramStr(req.params.id), req.user);
  const entry = await WaitlistService.convertWaitlistToBooking(paramStr(req.params.id));
  res.status(200).json({ success: true, data: entry });
};
