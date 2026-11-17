import prismaClient from "../utils/prismaClientHelper";
import { VehicleCategory } from "../../../generated/prisma";
import MapsService, { LocationInput } from "./maps.service";
import SettingsService, { CategoryRate, DEFAULT_CATEGORY_RATES } from "./settings.service";
import DiscountService from "./discount.service";

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
  /** Part of discountAmount from the customer's package. */
  packageDiscount: number;
  /** Part of discountAmount from the first-booking referral discount. */
  referralDiscount: number;
  totalPrice: number;
  /** Deposit needed to confirm the booking. */
  depositRequired: number;
  /** @deprecated same value as depositRequired, kept for older app builds. */
  depositPaid: number;
}

/** Built-in defaults; the live values come from Settings (SettingsService). */
export const CATEGORY_DEFAULT_RATES: Record<string, CategoryRate> = DEFAULT_CATEGORY_RATES;

/** Settings the pure price function needs. Omitted = built-in defaults. */
export interface PricingSettings {
  /** Deposit in percent of the total (20 = 20%). */
  depositRate?: number;
  /** Package discount as a percent of the price (the package's discountPercentage). */
  packageDiscountPercent?: number;
  /** Surge used for peak hours when no explicit multiplier is given. */
  peakSurgeMultiplier?: number;
  categoryRates?: Record<string, CategoryRate>;
}

export function calculateEstimatedPrice(params: CalculatePriceParams & TrustedRates & PricingSettings): PriceBreakdown {
  const categoryKey = (params.vehicleCategory as string) || VehicleCategory.CAR;
  const table = params.categoryRates ?? CATEGORY_DEFAULT_RATES;
  const rates = table[categoryKey] || table[VehicleCategory.CAR] || CATEGORY_DEFAULT_RATES[VehicleCategory.CAR];

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
    surge = params.surgeMultiplier && params.surgeMultiplier > 0 ? params.surgeMultiplier : (params.peakSurgeMultiplier ?? 1.25);
  } else if (params.surgeMultiplier && params.surgeMultiplier > 0) {
    surge = params.surgeMultiplier;
  }

  const surchargedTotal = subtotal * surge;
  // Package first (a % of the price, or a fixed amount), then the referral
  // amount on what is left; together they never exceed the price.
  const packagePct = Math.max(0, Math.min(100, params.packageDiscountPercent || 0));
  const packageAmount = Math.min(surchargedTotal, Math.max(0, (params.packageDiscount || 0) + surchargedTotal * (packagePct / 100)));
  const referralAmount = Math.min(surchargedTotal - packageAmount, Math.max(0, params.referralDiscount || 0));
  const discountAmount = packageAmount + referralAmount;

  const totalPrice = Math.max(0, Math.round((surchargedTotal - discountAmount) * 100) / 100);
  const depositPaid = Math.round(totalPrice * ((params.depositRate ?? 20) / 100) * 100) / 100;

  return {
    basePrice,
    distancePrice: Math.round(distancePrice * 100) / 100,
    timePrice: Math.round(timePrice * 100) / 100,
    surgeMultiplier: surge,
    discountAmount: Math.round(discountAmount * 100) / 100,
    packageDiscount: Math.round(packageAmount * 100) / 100,
    referralDiscount: Math.round(referralAmount * 100) / 100,
    totalPrice,
    depositRequired: depositPaid,
    depositPaid,
  };
}

export class PricingService {
  /**
   * Resolves a quote. When endpoints are supplied the distance and duration are
   * recomputed server-side and the client's own figures are reported back for
   * comparison; they are never priced.
   */
  public static async quote(params: CalculatePriceParams, customerId?: string): Promise<PriceQuote> {
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

    const breakdown = await this.calculatePrice(
      {
        ...params,
        distanceKm,
        durationMinutes,
      },
      customerId
    );

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

  public static async calculatePrice(params: CalculatePriceParams, customerId?: string): Promise<PriceBreakdown> {
    // Rates are read from the vehicle row, never from the request. These start
    // undefined and are only filled from the database.
    let basePrice: number | undefined;
    let pricePerKm: number | undefined;
    let pricePerHour: number | undefined;
    let category = params.vehicleCategory;
    // Surge and discounts are never taken from the request: a client could
    // otherwise send surgeMultiplier 0.01 or a large discount. They come from
    // Settings (peak surge) and from DiscountService (package %, referral).
    let referralDiscount = 0;
    const settings = await SettingsService.get();
    const pricing: PricingSettings = {
      depositRate: settings.depositRate,
      peakSurgeMultiplier: settings.peakSurgeMultiplier,
      categoryRates: settings.categoryRates,
    };

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

    // Discounts depend on who the quote is for: their own active package and
    // their first-booking referral discount. Anonymous quotes get none.
    let packageDiscountPercent = 0;
    if (customerId) {
      const pkg = await DiscountService.resolvePackage(prismaClient, params.packageId, customerId, false);
      packageDiscountPercent = pkg?.discountPercentage ?? 0;
      referralDiscount = await DiscountService.referralDiscount(prismaClient, customerId);
    }

    return calculateEstimatedPrice({
      vehicleCategory: category,
      distanceKm: params.distanceKm,
      durationMinutes: params.durationMinutes,
      isPeakHour: params.isPeakHour,
      basePrice,
      pricePerKm,
      pricePerHour,
      packageDiscountPercent,
      referralDiscount,
      ...pricing,
    });
  }
}

export default PricingService;
