import prismaClient from "../utils/prismaClientHelper";
import { VehicleCategory } from "../../../generated/prisma";
import MapsService, { LocationInput } from "./maps.service";

export interface CalculatePriceParams {
  vehicleCategory?: VehicleCategory | string;
  distanceKm?: number;
  durationMinutes?: number;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  packageDiscount?: number;
  referralDiscount?: number;
  vehicleId?: string;
  packageId?: string;
  referralCode?: string;
  /** When present, the route is recomputed and overrides distance/duration. */
  startPoint?: LocationInput;
  endPoint?: LocationInput;
}

/**
 * Rates resolved from a trusted source (the vehicle row, or the category
 * table). Kept out of `CalculatePriceParams` on purpose: that interface is
 * populated from a request body, and `custom*` on a public endpoint is exactly
 * how a caller could once ask for `customPricePerKm: 0.01` and be quoted a
 * near-free trip.
 */
export interface TrustedRates {
  basePrice?: number;
  pricePerKm?: number;
  pricePerHour?: number;
}
/**
 * The client's own figures, echoed back for auditing only. They never reach the
 * price formula.
 */
export interface PriceComparison {
  claimedDistanceKm: number | null;
  claimedDurationMinutes: number | null;
  distanceDifferenceKm: number | null;
  withinTolerance: boolean;
}

export interface PriceQuote {
  breakdown: PriceBreakdown;
  route: {
    distanceKm: number;
    durationMinutes: number;
    source: string;
    start: { latitude: number; longitude: number } | null;
    end: { latitude: number; longitude: number } | null;
    warning?: string;
  } | null;
  comparison: PriceComparison | null;
}

export interface PriceBreakdown {
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  surgeMultiplier: number;
  discountAmount: number;
  totalPrice: number;
  depositPaid: number;
}

export const CATEGORY_DEFAULT_RATES: Record<string, { basePrice: number; pricePerKm: number; pricePerHour: number }> = {
  [VehicleCategory.CAR]: { basePrice: 50, pricePerKm: 10, pricePerHour: 25 },
  [VehicleCategory.VAN]: { basePrice: 150, pricePerKm: 15, pricePerHour: 40 },
  [VehicleCategory.BUS]: { basePrice: 300, pricePerKm: 25, pricePerHour: 60 },
  [VehicleCategory.TRUCK]: { basePrice: 250, pricePerKm: 20, pricePerHour: 50 },
  [VehicleCategory.CLASSIC]: { basePrice: 200, pricePerKm: 18, pricePerHour: 45 },
  [VehicleCategory.LUXURY]: { basePrice: 350, pricePerKm: 30, pricePerHour: 75 },
};

export function calculateEstimatedPrice(params: CalculatePriceParams & TrustedRates): PriceBreakdown {
  const categoryKey = (params.vehicleCategory as string) || VehicleCategory.CAR;
  const rates = CATEGORY_DEFAULT_RATES[categoryKey] || CATEGORY_DEFAULT_RATES[VehicleCategory.CAR];

  const basePrice = params.basePrice ?? rates.basePrice;
  const pricePerKm = params.pricePerKm ?? rates.pricePerKm;
  const pricePerHour = params.pricePerHour ?? rates.pricePerHour;

  const validDistance = Math.max(0, params.distanceKm || 0);
  const validDuration = Math.max(0, params.durationMinutes || 0);

  const distancePrice = validDistance * pricePerKm;
  const timePrice = (validDuration / 60) * pricePerHour;
  const subtotal = basePrice + distancePrice + timePrice;

  let surge = 1.0;
  if (params.isPeakHour) {
    surge = params.surgeMultiplier && params.surgeMultiplier > 0 ? params.surgeMultiplier : 1.25;
  } else if (params.surgeMultiplier && params.surgeMultiplier > 0) {
    surge = params.surgeMultiplier;
  }

  const surchargedTotal = subtotal * surge;
  const rawDiscount = (params.packageDiscount || 0) + (params.referralDiscount || 0);
  const discountAmount = Math.min(surchargedTotal, Math.max(0, rawDiscount));

  const totalPrice = Math.max(0, Math.round((surchargedTotal - discountAmount) * 100) / 100);
  const depositPaid = Math.round(totalPrice * 0.20 * 100) / 100;

  return {
    basePrice,
    distancePrice: Math.round(distancePrice * 100) / 100,
    timePrice: Math.round(timePrice * 100) / 100,
    surgeMultiplier: surge,
    discountAmount: Math.round(discountAmount * 100) / 100,
    totalPrice,
    depositPaid,
  };
}

export class PricingService {
  /**
   * Resolves a quote. When endpoints are supplied the distance and duration are
   * recomputed server-side and the client's own figures are reported back for
   * comparison; they are never priced.
   */
  public static async quote(params: CalculatePriceParams): Promise<PriceQuote> {
    const wantsRoute = params.startPoint != null || params.endPoint != null;

    const route = wantsRoute
      ? await MapsService.route(params.startPoint, params.endPoint)
      : null;

    const distanceKm = route ? route.distanceKm : params.distanceKm;
    const durationMinutes = route ? route.durationMinutes : params.durationMinutes;

    const claimedDistanceKm = typeof params.distanceKm === "number" ? params.distanceKm : null;
    const claimedDurationMinutes = typeof params.durationMinutes === "number" ? params.durationMinutes : null;

    // With no route available the client's numbers are the only ones on offer.
    // Flagging that here is what makes the fallback visible to the caller
    // instead of looking like a verified price.
    const comparison: PriceComparison | null = route
      ? {
          claimedDistanceKm,
          claimedDurationMinutes,
          distanceDifferenceKm:
            claimedDistanceKm === null
              ? null
              : Math.round((claimedDistanceKm - route.distanceKm) * 100) / 100,
          withinTolerance:
            claimedDistanceKm === null ||
            route.distanceKm < 0.05 ||
            Math.abs(claimedDistanceKm - route.distanceKm) <= route.distanceKm * 0.1,
        }
      : null;

    const breakdown = await this.calculatePrice({
      ...params,
      distanceKm,
      durationMinutes,
    });

    return {
      breakdown,
      route: route
        ? {
            distanceKm: route.distanceKm,
            durationMinutes: route.durationMinutes,
            source: route.source,
            start: route.start,
            end: route.end,
            warning: route.warning,
          }
        : null,
      comparison,
    };
  }

  public static async calculatePrice(params: CalculatePriceParams): Promise<PriceBreakdown> {
    // Rates are read from the vehicle row, never from the request. These start
    // undefined and are only filled from the database.
    let basePrice: number | undefined;
    let pricePerKm: number | undefined;
    let pricePerHour: number | undefined;
    let category = params.vehicleCategory;
    let packageDiscount = params.packageDiscount || 0;
    let referralDiscount = params.referralDiscount || 0;

    if (params.vehicleId) {
      try {
        const vehicle = await prismaClient.vehicles.findUnique({
          where: { id: params.vehicleId },
        });
        if (vehicle) {
          if (!category) category = vehicle.category;
          if (basePrice === undefined && vehicle.basePrice > 0) basePrice = vehicle.basePrice;
          if (pricePerKm === undefined && vehicle.pricePerKm > 0) pricePerKm = vehicle.pricePerKm;
          if (pricePerHour === undefined && vehicle.pricePerHour > 0) pricePerHour = vehicle.pricePerHour;
        }
      } catch (err) {
        // Fallback to defaults if DB unavailable or vehicle not found
      }
    }

    if (params.packageId && params.packageDiscount === undefined) {
      try {
        const pkg = await prismaClient.packages.findUnique({
          where: { id: params.packageId },
        });
        if (pkg && pkg.discountPercentage > 0) {
          // If discount percentage is provided in package
          const tempEst = calculateEstimatedPrice({
            vehicleCategory: category,
            distanceKm: params.distanceKm,
            durationMinutes: params.durationMinutes,
            isPeakHour: params.isPeakHour,
            surgeMultiplier: params.surgeMultiplier,
            basePrice,
            pricePerKm,
            pricePerHour,
          });
          packageDiscount = tempEst.totalPrice * (pkg.discountPercentage / 100);
        }
      } catch (err) {
        // Fallback
      }
    }

    if (params.referralCode && params.referralDiscount === undefined) {
      try {
        const ref = await prismaClient.referrals.findFirst({
          where: { referralCode: params.referralCode },
        });
        if (ref && ref.rewardAmount > 0) {
          referralDiscount = ref.rewardAmount;
        }
      } catch (err) {
        // Fallback
      }
    }

    return calculateEstimatedPrice({
      ...params,
      vehicleCategory: category,
      basePrice,
      pricePerKm,
      pricePerHour,
      packageDiscount,
      referralDiscount,
    });
  }
}

export default PricingService;
