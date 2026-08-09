import z from "zod";

export const VehicleQuerySchema = z.object({
    category: z.string().optional(),
    status: z.string().optional()
});

export const VehicleAvailabilityQuerySchema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format")
});
