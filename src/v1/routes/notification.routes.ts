import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
} from "../controllers/notification.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const notificationRouter: Router = Router();

notificationRouter.get("/", authMiddleware, errorHandler(getUserNotifications));
notificationRouter.get("/unread-count", authMiddleware, errorHandler(getUnreadCount));
notificationRouter.patch("/:id/read", authMiddleware, errorHandler(markAsRead));
notificationRouter.patch("/read-all", authMiddleware, errorHandler(markAllAsRead));

export default notificationRouter;
