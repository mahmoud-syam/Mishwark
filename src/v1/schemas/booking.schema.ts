import { z } from "zod";
import { VehicleCategory, BookingStatus, TripStatus } from "../../../generated/prisma";

export const calculatePriceSchema = z.object({
  vehicleCategory: z.union([z.nativeEnum(VehicleCategory), z.string()]).optional(),
  distanceKm: z.number().min(0).optional().default(0),
  durationMinutes: z.number().min(0).optional().default(0),
  isPeakHour: z.boolean().optional(),
  surgeMultiplier: z.number().optional(),
  packageDiscount: z.number().min(0).optional(),
  referralDiscount: z.number().min(0).optional(),
  customBasePrice: z.number().min(0).optional(),
  customPricePerKm: z.number().min(0).optional(),
  customPricePerHour: z.number().min(0).optional(),
  vehicleId: z.string().optional(),
  packageId: z.string().optional(),
  referralCode: z.string().optional(),
});

export const createBookingSchema = z.object({
  customerId: z.string().optional(),
  vehicleId: z.string().min(1, "vehicleId is required"),
  driverId: z.string().optional(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate must be in YYYY-MM-DD format"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime must be in HH:mm format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime must be in HH:mm format"),
  distanceKm: z.number().min(0).optional().default(0),
  durationMinutes: z.number().min(0).optional().default(0),
  startPoint: z.string().optional().default(""),
  endPoint: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  driverNotes: z.string().optional().default(""),
  packageId: z.string().optional(),
  eventType: z.string().optional().default(""),
  isPeakHour: z.boolean().optional(),
  surgeMultiplier: z.number().optional(),
});

export const updateBookingStatusSchema = z.object({
  status: z.nativeEnum(BookingStatus),
});

export const updateTripStatusSchema = z.object({
  tripStatus: z.nativeEnum(TripStatus),
});

export const cancelBookingSchema = z.object({
  reason: z.string().optional(),
});

export const listBookingsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.nativeEnum(BookingStatus).optional(),
  tripStatus: z.nativeEnum(TripStatus).optional(),
  bookingDate: z.string().optional(),
  customerId: z.string().optional(),
  driverId: z.string().optional(),
  vehicleId: z.string().optional(),
});
