import { TIME_RE } from "../utils/slots";
import { z } from "zod";
import { VehicleCategory, BookingStatus, TripStatus, ServiceType } from "../../../generated/prisma";

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

/**
 * How the booking is priced (wedding, private trip, VIP). A private trip to a
 * listed destination needs no points: it starts at the company and ends at the
 * destination. Without serviceType it is priced as a private trip.
 */
const serviceFields = z.object({
  serviceType: z.nativeEnum(ServiceType).default(ServiceType.TRIP),
  destinationId: z.string().min(1).optional(),
});
/** True when the points can be left out (a trip to a listed destination). */
export const pointsOptional = (v: { serviceType?: ServiceType; destinationId?: string }) => v.serviceType === ServiceType.TRIP && !!v.destinationId;

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
    vehicleId: z.string().min(1, "vehicleId is required"),
    packageId: z.string().optional(),
    /** Admins only: quote with this customer's discounts. Ignored for others. */
    customerId: z.string().optional(),
    customBasePrice: clientPriceOverride("customBasePrice").optional(),
    customPricePerKm: clientPriceOverride("customPricePerKm").optional(),
    customPricePerHour: clientPriceOverride("customPricePerHour").optional(),
    /** The booked hours (wedding / VIP extra hours). */
    startTime: z.string().regex(TIME_RE).optional(),
    endTime: z.string().regex(TIME_RE).optional(),
  })
  .merge(routeFields)
  .merge(serviceFields)
  .superRefine((value, ctx) => {
    if (value.serviceType === ServiceType.TRIP) {
      if (!value.destinationId && value.endPoint == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationId"], message: "Choose a destination or send endPoint" });
      }
      return;
    }
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
    startTime: z.string().regex(TIME_RE, "startTime must be in HH:mm format"),
    endTime: z.string().regex(TIME_RE, "endTime must be in HH:mm format"),
    distanceKm: nonNegative.optional(),
    durationMinutes: nonNegative.optional(),
    notes: z.string().max(2000).optional(),
    driverNotes: z.string().max(2000).optional(),
    packageId: z.string().optional(),
    eventType: z.string().max(100).optional(),
  })
  .merge(routeFields)
  .merge(serviceFields)
  .superRefine((value, ctx) => {
    // An earlier end time means the trip ends the next morning (checked
    // against the overnight limit in Settings); the same time is no trip.
    if (value.startTime === value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be different from startTime",
      });
    }
    // Without a resolvable route there is no trustworthy distance, and a
    // distance-less booking prices at base only - which is how the "confirm
    // booking" flow could be abused for free rides. Both endpoints are required.
    if (value.serviceType === ServiceType.TRIP && !value.destinationId && value.endPoint == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationId"], message: "Choose a destination or send endPoint" });
    } else if (!pointsOptional(value) && value.serviceType !== ServiceType.TRIP && (value.startPoint == null || value.endPoint == null)) {
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
  // Admin only: refund the deposit (true) or keep it (false) whatever the policy says.
  refundDeposit: z.boolean().optional(),
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
