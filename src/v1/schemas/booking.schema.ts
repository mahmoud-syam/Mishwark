import { z } from "zod";
import { VehicleCategory, BookingStatus, TripStatus } from "../../../generated/prisma";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * A booking endpoint. Either resolved coordinates, or free text that the server
 * geocodes. Exactly one shape is accepted per endpoint; the union with a
 * refinement keeps "both supplied" from silently winning.
 */
// `label` is an optional human-readable name for a coordinate pair (e.g. the
// place a user picked on the map) and is what gets stored on the booking.
const label = z.string().trim().min(1).max(200).optional();

const locationInput = z.union([
  z.object({ latitude, longitude, label }),
  z.object({ startLat: latitude, startLng: longitude }),
  z.object({ lat: latitude, lng: longitude }),
  z.string().min(1).max(200),
]);

const routeFields = z.object({
  startPoint: locationInput.optional(),
  endPoint: locationInput.optional(),
});

const hasEitherEndpoint = (value: { startPoint?: unknown; endPoint?: unknown }) =>
  value.startPoint != null || value.endPoint != null;

const nonNegative = z.number().min(0).finite();

/**
 * Price overrides are declared rather than merely checked in a refinement:
 * `z.object` strips unknown keys before `superRefine` ever sees them, so a
 * refinement that only inspects the parsed value would silently ignore exactly
 * the field it is trying to forbid.
 */
const clientPriceOverride = (field: string) =>
  z.unknown().superRefine((value, ctx) => {
    if (value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} cannot be supplied by a client; pricing is server-side only`,
      });
    }
  });

export const calculatePriceSchema = z
  .object({
    vehicleCategory: z.union([z.nativeEnum(VehicleCategory), z.string()]).optional(),
    distanceKm: nonNegative.optional(),
    durationMinutes: nonNegative.optional(),
    isPeakHour: z.boolean().optional(),
    surgeMultiplier: z.number().min(0).max(10).optional(),
    packageDiscount: nonNegative.optional(),
    referralDiscount: nonNegative.optional(),
    vehicleId: z.string().optional(),
    packageId: z.string().optional(),
    referralCode: z.string().optional(),
    customBasePrice: clientPriceOverride("customBasePrice").optional(),
    customPricePerKm: clientPriceOverride("customPricePerKm").optional(),
    customPricePerHour: clientPriceOverride("customPricePerHour").optional(),
  })
  .merge(routeFields)
  .superRefine((value, ctx) => {
    if (!hasEitherEndpoint(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startPoint"],
        message: "Provide startPoint and endPoint to compute a route",
      });
    }
  });

export const createBookingSchema = z
  .object({
    customerId: z.string().optional(),
    vehicleId: z.string().min(1, "vehicleId is required"),
    driverId: z.string().optional(),
    bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate must be in YYYY-MM-DD format"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime must be in HH:mm format"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime must be in HH:mm format"),
    distanceKm: nonNegative.optional(),
    durationMinutes: nonNegative.optional(),
    notes: z.string().max(2000).optional(),
    driverNotes: z.string().max(2000).optional(),
    packageId: z.string().optional(),
    eventType: z.string().max(100).optional(),
    isPeakHour: z.boolean().optional(),
    surgeMultiplier: z.number().min(0).max(10).optional(),
  })
  .merge(routeFields)
  .superRefine((value, ctx) => {
    if (value.startTime >= value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be later than startTime",
      });
    }
    // Without a resolvable route there is no trustworthy distance, and a
    // distance-less booking prices at base only - which is how the "confirm
    // booking" flow could be abused for free rides. Both endpoints are required.
    if (value.startPoint == null || value.endPoint == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.startPoint == null ? "startPoint" : "endPoint"],
        message: "Provide startPoint and endPoint (coordinates or place name) so the server can compute the route",
      });
    }
  });

export const estimateDistanceSchema = routeFields.superRefine((value, ctx) => {
  if (value.startPoint == null || value.endPoint == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.startPoint == null ? "startPoint" : "endPoint"],
      message: "Both startPoint and endPoint are required to compute a distance",
    });
  }
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
