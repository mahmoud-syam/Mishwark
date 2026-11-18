import { z } from "zod";

export const bookingIdParamSchema = z.object({
  id: z.string().min(1),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Write a message").max(2000, "The message is too long (2000 characters at most)"),
  messageType: z.enum(["TEXT", "QUICK_REPLY"]).optional().default("TEXT"),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});
