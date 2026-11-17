import { z } from "zod";

export const createPackageSchema = z.object({
  packageName: z.string().min(1),
  packageType: z.enum(["MULTI_CAR", "MULTI_EVENT"]),
  discountPercentage: z.number().min(0).max(100).optional().default(0),
});

export const addBookingToPackageSchema = z.object({
  packageId: z.string().min(1),
});

export const packageIdParamSchema = z.object({
  id: z.string().min(1),
});
