import { z } from "zod";

export const bookingIdParamSchema = z.object({
  id: z.string().min(1),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1),
  messageType: z.enum(["TEXT", "QUICK_REPLY"]).optional().default("TEXT"),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});
