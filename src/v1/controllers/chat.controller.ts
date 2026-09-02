import { Request, Response } from "express";
import ChatService from "../services/chat.service";
import { SenderType } from "../../../generated/prisma";
import { paramStr } from "../utils/routeParams";

export const getOrCreateConversation = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const conversation = await ChatService.getOrCreateConversation(paramStr(req.params.id), userId);
  res.status(200).json({ success: true, data: conversation });
};

export const sendMessage = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const user = req.user as any;
  const senderType = (user.role?.name || "").toLowerCase() === "driver"
    ? SenderType.DRIVER
    : SenderType.CUSTOMER;

  const message = await ChatService.sendMessage(
    paramStr(req.params.conversationId),
    userId,
    senderType,
    req.body.content,
    req.body.messageType
  );
  res.status(201).json({ success: true, data: message });
};

export const getConversationMessages = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const messages = await ChatService.getConversationMessages(paramStr(req.params.conversationId), userId);
  res.status(200).json({ success: true, data: messages });
};

export const markMessagesAsRead = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const result = await ChatService.markMessagesAsRead(paramStr(req.params.conversationId), userId);
  res.status(200).json({ success: true, data: result });
};

export const closeConversation = async (req: Request, res: Response) => {
  const conversation = await ChatService.closeConversation(paramStr(req.params.conversationId));
  res.status(200).json({ success: true, data: conversation });
};

export const getBookingConversation = async (req: Request, res: Response) => {
  const conversation = await ChatService.getBookingConversation(paramStr(req.params.id));
  res.status(200).json({ success: true, data: conversation });
};
