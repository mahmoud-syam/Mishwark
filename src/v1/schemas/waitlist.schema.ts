import { z } from "zod";

export const joinWaitlistSchema = z.object({
  vehicleId: z.string().min(1),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  requestedTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const waitlistIdParamSchema = z.object({
  id: z.string().min(1),
});
