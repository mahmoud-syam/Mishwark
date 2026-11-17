import { z } from "zod";

export const notificationQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["SCHEDULED", "SENT", "FAILED", "CANCELLED"]).optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});
