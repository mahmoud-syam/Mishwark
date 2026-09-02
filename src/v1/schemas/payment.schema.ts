import { z } from "zod";

export const initiatePaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.enum(["PAYMOB", "FAWRY", "CASH", "WALLET"]),
});

export const updatePaymentStatusSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED", "REFUNDED"]),
  transactionRef: z.string().optional(),
});

export const paymentIdParamSchema = z.object({
  id: z.string().min(1),
});
