import { z } from "zod";

export const referralIdParamSchema = z.object({
  id: z.string().min(1),
});

export const completeReferralSchema = z.object({
  bookingId: z.string().min(1),
});
