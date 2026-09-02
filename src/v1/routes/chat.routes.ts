import { Router } from "express";
import { errorHandler } from "../../error-handler";
import {
  getOrCreateConversation,
  sendMessage,
  getConversationMessages,
  markMessagesAsRead,
  closeConversation,
  getBookingConversation,
} from "../controllers/chat.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const chatRouter: Router = Router();

chatRouter.get("/booking/:id", authMiddleware, errorHandler(getBookingConversation));
chatRouter.post("/booking/:id", authMiddleware, errorHandler(getOrCreateConversation));
chatRouter.get("/:conversationId/messages", authMiddleware, errorHandler(getConversationMessages));
chatRouter.post("/:conversationId/messages", authMiddleware, errorHandler(sendMessage));
chatRouter.patch("/:conversationId/read", authMiddleware, errorHandler(markMessagesAsRead));
chatRouter.patch("/:conversationId/close", authMiddleware, errorHandler(closeConversation));

export default chatRouter;
