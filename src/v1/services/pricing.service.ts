import prismaClient from "../utils/prismaClientHelper";
import { VehicleCategory } from "../../../generated/prisma";

export interface CalculatePriceParams {
  vehicleCategory?: VehicleCategory | string;
  distanceKm?: number;
  durationMinutes?: number;
  isPeakHour?: boolean;
  surgeMultiplier?: number;
  packageDiscount?: number;
  referralDiscount?: number;
  customBasePrice?: number;
  customPricePerKm?: number;
  customPricePerHour?: number;
  vehicleId?: string;
  packageId?: string;
  referralCode?: string;
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

export function calculateEstimatedPrice(params: CalculatePriceParams): PriceBreakdown {
  const categoryKey = (params.vehicleCategory as string) || VehicleCategory.CAR;
  const rates = CATEGORY_DEFAULT_RATES[categoryKey] || CATEGORY_DEFAULT_RATES[VehicleCategory.CAR];

  const basePrice = params.customBasePrice ?? rates.basePrice;
  const pricePerKm = params.customPricePerKm ?? rates.pricePerKm;
  const pricePerHour = params.customPricePerHour ?? rates.pricePerHour;

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
  public static async calculatePrice(params: CalculatePriceParams): Promise<PriceBreakdown> {
    let customBasePrice = params.customBasePrice;
    let customPricePerKm = params.customPricePerKm;
    let customPricePerHour = params.customPricePerHour;
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
          if (customBasePrice === undefined && vehicle.basePrice > 0) customBasePrice = vehicle.basePrice;
          if (customPricePerKm === undefined && vehicle.pricePerKm > 0) customPricePerKm = vehicle.pricePerKm;
          if (customPricePerHour === undefined && vehicle.pricePerHour > 0) customPricePerHour = vehicle.pricePerHour;
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
            customBasePrice,
            customPricePerKm,
            customPricePerHour,
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
      customBasePrice,
      customPricePerKm,
      customPricePerHour,
      packageDiscount,
      referralDiscount,
    });
  }
}

export default PricingService;
