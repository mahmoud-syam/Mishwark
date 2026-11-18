import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import { VehicleCategory } from "../../../generated/prisma/client";

/**
 * Business settings edited from the dashboard's Settings page.
 *
 * Stored on the single SystemSettings row ("global"). Reads go through a short
 * in-memory cache because pricing and booking checks read them on every
 * request; an update clears it, so a change applies to the next request.
 * Running several API instances means another instance may serve the old
 * value for up to CACHE_TTL_MS.
 */

export type CategoryRate = { basePrice: number; pricePerKm: number; pricePerHour: number };
export type CategoryRates = Record<VehicleCategory, CategoryRate>;

export const DEFAULT_CATEGORY_RATES: CategoryRates = {
  [VehicleCategory.CAR]: { basePrice: 50, pricePerKm: 10, pricePerHour: 25 },
  [VehicleCategory.VAN]: { basePrice: 150, pricePerKm: 15, pricePerHour: 40 },
  [VehicleCategory.BUS]: { basePrice: 300, pricePerKm: 25, pricePerHour: 60 },
  [VehicleCategory.TRUCK]: { basePrice: 250, pricePerKm: 20, pricePerHour: 50 },
  [VehicleCategory.CLASSIC]: { basePrice: 200, pricePerKm: 18, pricePerHour: 45 },
  [VehicleCategory.LUXURY]: { basePrice: 350, pricePerKm: 30, pricePerHour: 75 },
};

/** Trip to a place that isn't on the destinations list, per category (Pricing page). */
export const DEFAULT_TRIP_OTHER_PRICES: Record<VehicleCategory, number> = {
  [VehicleCategory.CAR]: 1000,
  [VehicleCategory.VAN]: 1500,
  [VehicleCategory.BUS]: 2500,
  [VehicleCategory.TRUCK]: 2000,
  [VehicleCategory.CLASSIC]: 2000,
  [VehicleCategory.LUXURY]: 2500,
};

export interface BusinessSettings {
  depositRate: number;
  bookingBufferMinutes: number;
  tripEarlyStartMinutes: number;
  maxAdvanceBookingDays: number;
  minTripMinutes: number;
  overnightLatestEndHour: number;
  freeCancellationHours: number;
  tempPasswordDays: number;
  weddingDefaultPrice: number;
  weddingIncludedHours: number;
  weddingIncludedKm: number;
  weddingExtraHourPrice: number;
  weddingExtraKmPrice: number;
  vipDefaultPrice: number;
  vipIncludedHours: number;
  vipIncludedKm: number;
  vipExtraHourPrice: number;
  vipExtraKmPrice: number;
  tripIncludedKm: number;
  tripExtraKmPrice: number;
  originLat: number;
  originLng: number;
  /** Price of a trip to a place not on the destinations list, per car category. */
  tripOtherPrices: Record<VehicleCategory, number>;
  /** Where private trips start. */
  originLabel: string;
  defaultCommissionRate: number;
  referralRewardAmount: number;
  referredDiscountAmount: number;
  peakSurgeMultiplier: number;
  vipSpendThreshold: number;
  delayAlertMinutes: number;
  punctualityGraceMinutes: number;
  complaintMaxRating: number;
  maintenanceAlertDays: number;
  categoryRates: CategoryRates;
}

/** The values the API used before they became settings. */
export const DEFAULT_SETTINGS: BusinessSettings = {
  depositRate: 20,
  bookingBufferMinutes: 60,
  tripEarlyStartMinutes: 120,
  maxAdvanceBookingDays: 365,
  minTripMinutes: 30,
  overnightLatestEndHour: 6,
  freeCancellationHours: 48,
  tempPasswordDays: 7,
  weddingDefaultPrice: 1500,
  weddingIncludedHours: 4,
  weddingIncludedKm: 50,
  weddingExtraHourPrice: 300,
  weddingExtraKmPrice: 50,
  vipDefaultPrice: 3000,
  vipIncludedHours: 4,
  vipIncludedKm: 50,
  vipExtraHourPrice: 500,
  vipExtraKmPrice: 75,
  tripIncludedKm: 150,
  tripExtraKmPrice: 50,
  originLat: 30.5877,
  originLng: 31.502,
  tripOtherPrices: DEFAULT_TRIP_OTHER_PRICES,
  originLabel: "الزقازيق، الشرقية",
  defaultCommissionRate: 20,
  referralRewardAmount: 25,
  referredDiscountAmount: 25,
  peakSurgeMultiplier: 1.25,
  vipSpendThreshold: 15000,
  delayAlertMinutes: 5,
  punctualityGraceMinutes: 10,
  complaintMaxRating: 2,
  maintenanceAlertDays: 7,
  categoryRates: DEFAULT_CATEGORY_RATES,
};

export const SETTING_KEYS = [
  "depositRate",
  "bookingBufferMinutes",
  "tripEarlyStartMinutes",
  "maxAdvanceBookingDays",
  "minTripMinutes",
  "overnightLatestEndHour",
  "freeCancellationHours",
  "tempPasswordDays",
  "weddingDefaultPrice",
  "weddingIncludedHours",
  "weddingIncludedKm",
  "weddingExtraHourPrice",
  "weddingExtraKmPrice",
  "vipDefaultPrice",
  "vipIncludedHours",
  "vipIncludedKm",
  "vipExtraHourPrice",
  "vipExtraKmPrice",
  "tripIncludedKm",
  "tripExtraKmPrice",
  "originLat",
  "originLng",
  "defaultCommissionRate",
  "referralRewardAmount",
  "referredDiscountAmount",
  "peakSurgeMultiplier",
  "vipSpendThreshold",
  "delayAlertMinutes",
  "punctualityGraceMinutes",
  "complaintMaxRating",
  "maintenanceAlertDays",
] as const;

const money = z.number().min(0).max(1_000_000);
const rateSchema = z.object({ basePrice: money, pricePerKm: money, pricePerHour: money }).strict();

/** PUT /admin/settings body. Every field optional; unknown keys refused. */
export const updateSettingsSchema = z
  .object({
    depositRate: z.number().min(0).max(100),
    bookingBufferMinutes: z.number().int().min(0).max(720),
    tripEarlyStartMinutes: z.number().int().min(0).max(1440),
    maxAdvanceBookingDays: z.number().int().min(1).max(1095),
    minTripMinutes: z.number().int().min(0).max(720),
    overnightLatestEndHour: z.number().int().min(0).max(12),
    freeCancellationHours: z.number().int().min(0).max(720),
    tempPasswordDays: z.number().int().min(1).max(90),
    weddingDefaultPrice: money,
    weddingIncludedHours: z.number().int().min(0).max(24),
    weddingIncludedKm: z.number().int().min(0).max(2000),
    weddingExtraHourPrice: money,
    weddingExtraKmPrice: money,
    vipDefaultPrice: money,
    vipIncludedHours: z.number().int().min(0).max(24),
    vipIncludedKm: z.number().int().min(0).max(2000),
    vipExtraHourPrice: money,
    vipExtraKmPrice: money,
    tripIncludedKm: z.number().int().min(0).max(2000),
    tripExtraKmPrice: money,
    originLat: z.number().min(21.9).max(31.8),
    originLng: z.number().min(24.6).max(37.1),
    tripOtherPrices: z.partialRecord(z.nativeEnum(VehicleCategory), money),
    originLabel: z.string().trim().min(2).max(200),
    defaultCommissionRate: z.number().min(0).max(100),
    referralRewardAmount: money,
    referredDiscountAmount: money,
    peakSurgeMultiplier: z.number().min(1).max(5),
    vipSpendThreshold: money,
    delayAlertMinutes: z.number().int().min(1).max(240),
    punctualityGraceMinutes: z.number().int().min(0).max(240),
    complaintMaxRating: z.number().int().min(1).max(4),
    maintenanceAlertDays: z.number().int().min(1).max(90),
    categoryRates: z.partialRecord(z.nativeEnum(VehicleCategory), rateSchema),
    // Older toggles kept on the same row.
    performanceHistoryVisible: z.boolean(),
    evaluationsVisible: z.boolean(),
    selfAppraisalsVisible: z.boolean(),
  })
  .partial()
  .strict();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

const CACHE_TTL_MS = 30_000;
let cache: { value: BusinessSettings; at: number } | null = null;

/** Merges stored category rates over the defaults, ignoring anything malformed. */
const mergeRates = (stored: unknown): CategoryRates => {
  const merged = { ...DEFAULT_CATEGORY_RATES };
  if (stored && typeof stored === "object") {
    for (const cat of Object.values(VehicleCategory)) {
      const parsed = rateSchema.safeParse((stored as Record<string, unknown>)[cat]);
      if (parsed.success) merged[cat] = parsed.data;
    }
  }
  return merged;
};

/** A { CATEGORY: price } map over defaults, ignoring anything that isn't a price. */
export const mergeCategoryPrices = (stored: unknown, defaults: Record<VehicleCategory, number>): Record<VehicleCategory, number> => {
  const out = { ...defaults };
  if (stored && typeof stored === "object") {
    for (const cat of Object.values(VehicleCategory)) {
      const v = (stored as Record<string, unknown>)[cat];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[cat] = v;
    }
  }
  return out;
};

const toBusiness = (row: any): BusinessSettings => {
  const out: any = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (typeof row?.[key] === "number" && Number.isFinite(row[key])) out[key] = row[key];
  }
  out.categoryRates = mergeRates(row?.categoryRates);
  out.tripOtherPrices = mergeCategoryPrices(row?.tripOtherPrices, DEFAULT_TRIP_OTHER_PRICES);
  if (typeof row?.originLabel === "string" && row.originLabel.trim()) out.originLabel = row.originLabel;
  return out;
};

export class SettingsService {
  /** The raw row, created with defaults on first use. */
  public static async getRow() {
    return prismaClient.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global" },
      update: {},
    });
  }

  /** Business values, cached. Falls back to defaults if the database is unreachable. */
  public static async get(): Promise<BusinessSettings> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
    try {
      const value = toBusiness(await this.getRow());
      cache = { value, at: Date.now() };
      return value;
    } catch (err) {
      console.error("[settings] read failed, using defaults", err);
      return cache?.value ?? DEFAULT_SETTINGS;
    }
  }

  /** Full view for the dashboard: business values + the older toggles. */
  public static async getForAdmin() {
    const row = await this.getRow();
    return {
      ...toBusiness(row),
      performanceHistoryVisible: row.performanceHistoryVisible,
      evaluationsVisible: row.evaluationsVisible,
      selfAppraisalsVisible: row.selfAppraisalsVisible,
      defaults: DEFAULT_SETTINGS,
      updatedAt: row.updatedAt,
    };
  }

  public static async update(input: UpdateSettingsInput) {
    const data: any = { ...input };
    if (input.categoryRates) {
      // A partial map updates only the categories sent.
      const current = mergeRates((await this.getRow()).categoryRates);
      data.categoryRates = { ...current, ...input.categoryRates };
    }
    if (input.tripOtherPrices) {
      const current = mergeCategoryPrices((await this.getRow()).tripOtherPrices, DEFAULT_TRIP_OTHER_PRICES);
      data.tripOtherPrices = { ...current, ...input.tripOtherPrices };
    }
    await prismaClient.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...data },
      update: data,
    });
    this.clearCache();
    return this.getForAdmin();
  }

  public static clearCache() {
    cache = null;
  }
}

export default SettingsService;
