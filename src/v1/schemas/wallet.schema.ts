import { z } from "zod";

export const walletQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  type: z.enum(["REFERRAL_REWARD", "REFUND", "MANUAL_ADJUSTMENT", "PAYMENT_DEDUCTION", "DEPOSIT"]).optional(),
});
