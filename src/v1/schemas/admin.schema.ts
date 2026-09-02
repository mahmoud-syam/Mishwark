import { z } from "zod";

export const adminStatsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const adminBookingsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM").optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const adminCalendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
});

export const adminVehicleStatusQuerySchema = z.object({
  status: z.enum(["AVAILABLE", "BOOKED", "MAINTENANCE"]).optional(),
});

export const adminDriverStatsParamSchema = z.object({
  id: z.string().min(1),
});

export const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

export const systemSettingsSchema = z.object({
  performanceHistoryVisible: z.boolean().optional(),
  evaluationsVisible: z.boolean().optional(),
  selfAppraisalsVisible: z.boolean().optional(),
});

export const toggleDriverStatusSchema = z.object({
  status: z.enum(["ACTIVE", "OFF", "ONLEAVE"]),
});
