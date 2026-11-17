import { Request, Response } from "express";
import NotificationService from "../services/notification.service";
import { paramStr, queryNum, queryStr, queryLimit } from "../utils/routeParams";

export const getUserNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await NotificationService.getUserNotifications(userId, {
    page: queryNum(req.query.page, 1),
    limit: queryLimit(req.query.limit, 20),
    status: queryStr(req.query.status) as any,
  });
  res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
};

export const markAsRead = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const notification = await NotificationService.markAsRead(paramStr(req.params.id), userId);
  res.status(200).json({ success: true, data: notification });
};

export const markAllAsRead = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await NotificationService.markAllAsRead(userId);
  res.status(200).json({ success: true, data: result });
};

export const getUnreadCount = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await NotificationService.getUnreadCount(userId);
  res.status(200).json({ success: true, data: result });
};
