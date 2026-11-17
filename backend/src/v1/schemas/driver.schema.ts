import { z } from "zod";

export const driverIdParamSchema = z.object({
  id: z.string().min(1),
});

export const updateDriverStatusSchema = z.object({
  status: z.enum(["ACTIVE", "OFF", "ONLEAVE"]),
});

export const driverBookingsQuerySchema = z.object({
  filter: z.enum(["today", "upcoming", "completed"]).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const updateDriverProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  licenseNumber: z.string().min(1).optional(),
  licenseExpiry: z.string().optional(),
  pic: z.string().optional(),
});

export const driverStatsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
