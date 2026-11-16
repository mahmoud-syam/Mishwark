import { Request, Response } from "express";
import ChatService from "../services/chat.service";
import { SenderType } from "../../../generated/prisma";
import { paramStr } from "../utils/routeParams";
import { isDriverRole } from "../constants/roles";
import prismaClient from "../utils/prismaClientHelper";
import { bookingPartyOf } from "../services/booking.service";
import { NotFoundException } from "../utils/errors";

/** The caller must be the booking's customer, its driver, or an admin. */
const assertBookingParty = async (bookingId: string, user: any) => {
  const booking = await prismaClient.bookings.findUnique({ where: { id: bookingId }, select: { customerId: true, driverId: true } });
  if (!booking || (await bookingPartyOf(booking, user)) === null) {
    throw new NotFoundException(`Booking with ID ${bookingId} not found`);
  }
};
const assertConversationParty = async (conversationId: string, user: any) => {
  const c = await prismaClient.conversations.findUnique({ where: { id: conversationId }, select: { bookingId: true } });
  if (!c) throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
  await assertBookingParty(c.bookingId, user);
};

export const getOrCreateConversation = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  await assertBookingParty(paramStr(req.params.id), req.user);
  const conversation = await ChatService.getOrCreateConversation(paramStr(req.params.id), userId);
  res.status(200).json({ success: true, data: conversation });
};

export const sendMessage = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const userId = user.id;

  // A null role previously fell through to CUSTOMER, which made every driver
  // fail the conversation.customerId check in ChatService.sendMessage.
  const senderType = isDriverRole(user.role?.name)
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
  await assertConversationParty(paramStr(req.params.conversationId), req.user);
  const result = await ChatService.markMessagesAsRead(paramStr(req.params.conversationId), userId);
  res.status(200).json({ success: true, data: result });
};

export const closeConversation = async (req: Request, res: Response) => {
  await assertConversationParty(paramStr(req.params.conversationId), req.user);
  const conversation = await ChatService.closeConversation(paramStr(req.params.conversationId));
  res.status(200).json({ success: true, data: conversation });
};

export const getBookingConversation = async (req: Request, res: Response) => {
  await assertBookingParty(paramStr(req.params.id), req.user);
  const conversation = await ChatService.getBookingConversation(paramStr(req.params.id));
  res.status(200).json({ success: true, data: conversation });
};
