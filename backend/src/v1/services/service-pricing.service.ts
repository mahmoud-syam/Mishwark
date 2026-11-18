import { ServiceType, VehicleCategory } from "../../../generated/prisma";
import prismaClient from "../utils/prismaClientHelper";
import { BadRequestException, NotFoundException } from "../utils/errors";
import MapsService, { LocationInput } from "./maps.service";
import SettingsService, { BusinessSettings, mergeCategoryPrices } from "./settings.service";
import DiscountService from "./discount.service";
import { tripMinutes } from "../utils/slots";

/**
 * Prices by service type (the owner's model, edited on the Pricing page):
 *
 * - WEDDING: the car's own wedding price (or the default). It covers a number
 *   of hours and kilometres; every started hour and every km beyond them is
 *   charged at the extra rates.
 * - TRIP: private trip from the company (Sharqia). A listed destination has a
 *   fixed price per car category; any other place has a price per category
 *   from Settings. The price covers `includedKm` (150 by default); each km
 *   beyond is extra. No hour limit.
 * - VIP: like a wedding, with its own prices and limits.
 *
 * Then the customer's package %, the first-booking referral amount, and the
 * deposit (a % of the total), as for every booking.
 */

export type PriceLineCode = "wedding" | "vip" | "trip" | "trip_other" | "extra_hours" | "extra_km" | "package_discount" | "referral_discount";

export interface PriceLine {
  code: PriceLineCode;
  amount: number;
  /** Extra hours or km charged. */
  quantity?: number;
  /** Price per extra hour or km. */
  unitPrice?: number;
  /** Hours or km included in the base price. */
  included?: number;
  /** Destination name for a trip line. */
  name?: string;
  /** On the base line: the hours and km its price covers. */
  includedHours?: number;
  includedKm?: number;
}

export interface ServicePriceInput {
  basePrice: number;
  baseCode: "wedding" | "vip" | "trip" | "trip_other";
  destinationName?: string;
  includedHours: number | null;
  extraHourPrice: number;
  bookedMinutes: number | null;
  includedKm: number;
  extraKmPrice: number;
  distanceKm: number;
  packageDiscountPercent?: number;
  referralDiscount?: number;
  depositRate: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure price calculation: no database, no network. */
export function priceService(i: ServicePriceInput) {
  const lines: PriceLine[] = [
    {
      code: i.baseCode,
      amount: r2(i.basePrice),
      ...(i.destinationName && { name: i.destinationName }),
      ...(i.includedHours != null && { includedHours: i.includedHours }),
      includedKm: i.includedKm,
    },
  ];

  let extraHours = 0;
  if (i.includedHours != null && i.bookedMinutes != null) {
    const over = i.bookedMinutes - i.includedHours * 60;
    // Every started hour beyond the included ones.
    extraHours = over > 0 ? Math.ceil(over / 60) : 0;
    if (extraHours > 0) lines.push({ code: "extra_hours", quantity: extraHours, unitPrice: i.extraHourPrice, included: i.includedHours, amount: r2(extraHours * i.extraHourPrice) });
  }

  const overKm = Math.max(0, i.distanceKm) - i.includedKm;
  // Whole km, rounded up.
  const extraKm = overKm > 0 ? Math.ceil(overKm - 1e-9) : 0;
  if (extraKm > 0) lines.push({ code: "extra_km", quantity: extraKm, unitPrice: i.extraKmPrice, included: i.includedKm, amount: r2(extraKm * i.extraKmPrice) });

  const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  const pct = Math.max(0, Math.min(100, i.packageDiscountPercent || 0));
  const packageDiscount = r2(Math.min(gross, gross * (pct / 100)));
  const referralDiscount = r2(Math.min(gross - packageDiscount, Math.max(0, i.referralDiscount || 0)));
  if (packageDiscount > 0) lines.push({ code: "package_discount", amount: -packageDiscount });
  if (referralDiscount > 0) lines.push({ code: "referral_discount", amount: -referralDiscount });

  const totalPrice = Math.max(0, r2(gross - packageDiscount - referralDiscount));
  const depositRequired = r2(totalPrice * (i.depositRate / 100));
  const hourAmount = lines.find((l) => l.code === "extra_hours")?.amount ?? 0;
  const kmAmount = lines.find((l) => l.code === "extra_km")?.amount ?? 0;
  return {
    lines,
    gross,
    totalPrice,
    packageDiscount,
    referralDiscount,
    depositRequired,
    // The older breakdown fields, so existing screens and apps keep working.
    breakdown: {
      basePrice: r2(i.basePrice),
      distancePrice: kmAmount,
      timePrice: hourAmount,
      surgeMultiplier: 1,
      discountAmount: r2(packageDiscount + referralDiscount),
      packageDiscount,
      referralDiscount,
      totalPrice,
      depositRequired,
      depositPaid: depositRequired,
    },
  };
}

export interface ServiceQuoteParams {
  serviceType: ServiceType;
  vehicleId: string;
  destinationId?: string;
  startPoint?: LocationInput;
  endPoint?: LocationInput;
  startTime?: string;
  endTime?: string;
  packageId?: string;
}

type Db = typeof prismaClient | Parameters<Parameters<typeof prismaClient.$transaction>[0]>[0];

export class ServicePricing {
  /** The base price, limits and points a service type uses for a car (no route yet). */
  public static async resolve(db: Db, p: ServiceQuoteParams, settings: BusinessSettings) {
    const vehicle = await db.vehicles.findUnique({ where: { id: p.vehicleId } });
    if (!vehicle) throw new NotFoundException(`Vehicle with ID ${p.vehicleId} not found`);
    if (vehicle.retiredAt) throw new BadRequestException("This car is no longer available");
    const category = vehicle.category as VehicleCategory;

    if (p.serviceType === ServiceType.TRIP) {
      const origin = { latitude: settings.originLat, longitude: settings.originLng, label: settings.originLabel };
      let destination: { id: string; name: string; latitude: number; longitude: number; includedKm: number | null; prices: unknown } | null = null;
      if (p.destinationId) {
        destination = await db.destinations.findFirst({ where: { id: p.destinationId, active: true } });
        if (!destination) throw new BadRequestException("This destination isn't available");
      }
      const prices = destination ? mergeCategoryPrices(destination.prices, settings.tripOtherPrices) : settings.tripOtherPrices;
      const endPoint = p.endPoint ?? (destination ? { latitude: destination.latitude, longitude: destination.longitude, label: destination.name } : undefined);
      if (!endPoint) throw new BadRequestException("Choose a destination or a place on the map");
      return {
        vehicle,
        destination,
        startPoint: p.startPoint ?? origin,
        endPoint,
        input: {
          basePrice: prices[category],
          baseCode: destination ? ("trip" as const) : ("trip_other" as const),
          destinationName: destination?.name,
          includedHours: null,
          extraHourPrice: 0,
          includedKm: destination?.includedKm ?? settings.tripIncludedKm,
          extraKmPrice: settings.tripExtraKmPrice,
        },
      };
    }

    const vip = p.serviceType === ServiceType.VIP;
    if (!p.startPoint || !p.endPoint) throw new BadRequestException("Provide startPoint and endPoint");
    return {
      vehicle,
      destination: null,
      startPoint: p.startPoint,
      endPoint: p.endPoint,
      input: {
        basePrice: (vip ? vehicle.vipPrice : vehicle.weddingPrice) ?? (vip ? settings.vipDefaultPrice : settings.weddingDefaultPrice),
        baseCode: vip ? ("vip" as const) : ("wedding" as const),
        includedHours: vip ? settings.vipIncludedHours : settings.weddingIncludedHours,
        extraHourPrice: vip ? settings.vipExtraHourPrice : settings.weddingExtraHourPrice,
        includedKm: vip ? settings.vipIncludedKm : settings.weddingIncludedKm,
        extraKmPrice: vip ? settings.vipExtraKmPrice : settings.weddingExtraKmPrice,
      },
    };
  }

  /** A full quote: route, hours, discounts for `customerId`, itemised lines. */
  public static async quote(p: ServiceQuoteParams, customerId?: string, db: Db = prismaClient) {
    const settings = await SettingsService.get();
    const r = await this.resolve(db, p, settings);
    const route = await MapsService.route(r.startPoint, r.endPoint);
    let packageDiscountPercent = 0;
    let referralDiscount = 0;
    if (customerId) {
      const pkg = await DiscountService.resolvePackage(db as any, p.packageId, customerId, false);
      packageDiscountPercent = pkg?.discountPercentage ?? 0;
      referralDiscount = await DiscountService.referralDiscount(db as any, customerId);
    }
    const bookedMinutes = p.startTime && p.endTime && p.startTime !== p.endTime ? tripMinutes(p.startTime, p.endTime) : null;
    const price = priceService({
      ...r.input,
      bookedMinutes,
      distanceKm: route.distanceKm,
      packageDiscountPercent,
      referralDiscount,
      depositRate: settings.depositRate,
    });
    return {
      serviceType: p.serviceType,
      ...price,
      bookedMinutes,
      destination: r.destination ? { id: r.destination.id, name: r.destination.name } : null,
      startPoint: r.startPoint,
      endPoint: r.endPoint,
      route,
      depositRate: settings.depositRate,
    };
  }
}

export default ServicePricing;
