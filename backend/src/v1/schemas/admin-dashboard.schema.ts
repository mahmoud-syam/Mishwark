import { ServiceType } from "../../../generated/prisma";
import { TIME_RE } from "../utils/slots";
import { z } from "zod";
import { AuditAction, PaymentMethod } from "../../../generated/prisma";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const point = z.union([
  z.object({ latitude, longitude, label: z.string().trim().min(1).max(200).optional() }),
  z.string().trim().min(1).max(200),
]);

export const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const periodSchema = z
  .enum(["day", "month", "year"])
  .optional()
  .transform((v) => v ?? "day");

export const commissionSchema = z.object({
  commissionRate: z.number().min(0).max(100),
});

export const quickCustomerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+?\d{8,15}$/, "phoneNumber must be 8-15 digits, optionally starting with +"),
});

export const bookOnBehalfSchema = z
  .object({
    customerId: z.string().min(1),
    vehicleId: z.string().min(1),
    driverId: z.string().min(1).optional(),
    bookingDate: dateParamSchema,
    startTime: z.string().regex(TIME_RE),
    endTime: z.string().regex(TIME_RE),
    startPoint: point.optional(),
    endPoint: point.optional(),
    serviceType: z.nativeEnum(ServiceType).optional(),
    destinationId: z.string().min(1).optional(),
    eventType: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    priceOverride: z.number().min(0).max(1_000_000).optional(),
    markPaid: z.boolean().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  })
  // An earlier end time = ends the next morning (limit checked when booking).
  .refine((v) => v.startTime !== v.endTime, { path: ["endTime"], message: "endTime must be different from startTime" })
  // A trip starts at the company by default and can end at a listed destination;
  // everything else needs both points.
  .refine((v) => (v.serviceType === ServiceType.TRIP ? !!(v.destinationId || v.endPoint) : !!(v.startPoint && v.endPoint)), {
    path: ["endPoint"],
    message: "Provide startPoint and endPoint, or a destination for a private trip",
  });

export const auditActionSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.toUpperCase() : undefined))
  .pipe(z.nativeEnum(AuditAction).optional());

export const packageDiscountSchema = z.object({
  discountPercentage: z.number().min(0).max(100),
});
