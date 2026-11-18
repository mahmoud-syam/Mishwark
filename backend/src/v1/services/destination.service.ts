import { z } from "zod";
import { Prisma, VehicleCategory } from "../../../generated/prisma";
import prismaClient from "../utils/prismaClientHelper";
import { NotFoundException } from "../utils/errors";
import SettingsService, { mergeCategoryPrices } from "./settings.service";

const money = z.number().min(0).max(1_000_000);
const prices = z.partialRecord(z.nativeEnum(VehicleCategory), money);

export const destinationCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    latitude: z.number().min(21.9).max(31.8),
    longitude: z.number().min(24.6).max(37.1),
    includedKm: z.number().int().min(0).max(2000).nullable().default(null),
    prices: prices.default({}),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

export const destinationUpdateSchema = destinationCreateSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

/**
 * Private-trip destinations (Pricing page). Each has a fixed price per car
 * category; a category without one uses the "another place" price from
 * Settings. Used destinations are switched off rather than deleted so past
 * bookings keep their link.
 */
export class DestinationService {
  public static async list(includeInactive = false) {
    const [rows, settings] = await Promise.all([
      prismaClient.destinations.findMany({
        where: includeInactive ? {} : { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { bookings: true } } },
      }),
      SettingsService.get(),
    ]);
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      latitude: d.latitude,
      longitude: d.longitude,
      active: d.active,
      sortOrder: d.sortOrder,
      /** What the owner entered (a missing category falls back). */
      prices: d.prices as Partial<Record<VehicleCategory, number>>,
      /** The price each category actually gets. */
      effectivePrices: mergeCategoryPrices(d.prices, settings.tripOtherPrices),
      includedKm: d.includedKm,
      effectiveIncludedKm: d.includedKm ?? settings.tripIncludedKm,
      bookings: d._count.bookings,
    }));
  }

  public static async create(input: z.infer<typeof destinationCreateSchema>) {
    return prismaClient.destinations.create({ data: { ...input, prices: input.prices as Prisma.InputJsonValue } });
  }

  public static async update(id: string, input: z.infer<typeof destinationUpdateSchema>) {
    const before = await prismaClient.destinations.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Destination not found");
    const data: Prisma.DestinationsUpdateInput = { ...input, prices: undefined };
    // A partial price map updates only the categories sent.
    if (input.prices) data.prices = { ...(before.prices as object), ...input.prices } as Prisma.InputJsonValue;
    const after = await prismaClient.destinations.update({ where: { id }, data });
    return { before, after };
  }

  /** Deleted when never booked; otherwise switched off (history keeps it). */
  public static async remove(id: string) {
    const d = await prismaClient.destinations.findUnique({ where: { id }, include: { _count: { select: { bookings: true } } } });
    if (!d) throw new NotFoundException("Destination not found");
    if (d._count.bookings > 0) {
      await prismaClient.destinations.update({ where: { id }, data: { active: false } });
      return { removed: false, deactivated: true, name: d.name };
    }
    await prismaClient.destinations.delete({ where: { id } });
    return { removed: true, deactivated: false, name: d.name };
  }

  /** Everything the apps need to show prices before booking. */
  public static async catalog() {
    const s = await SettingsService.get();
    return {
      origin: { label: s.originLabel, latitude: s.originLat, longitude: s.originLng },
      depositRate: s.depositRate,
      wedding: { defaultPrice: s.weddingDefaultPrice, includedHours: s.weddingIncludedHours, includedKm: s.weddingIncludedKm, extraHourPrice: s.weddingExtraHourPrice, extraKmPrice: s.weddingExtraKmPrice },
      vip: { defaultPrice: s.vipDefaultPrice, includedHours: s.vipIncludedHours, includedKm: s.vipIncludedKm, extraHourPrice: s.vipExtraHourPrice, extraKmPrice: s.vipExtraKmPrice },
      trip: { includedKm: s.tripIncludedKm, extraKmPrice: s.tripExtraKmPrice, otherPrices: s.tripOtherPrices },
      destinations: (await this.list(false)).map(({ id, name, latitude, longitude, effectivePrices, effectiveIncludedKm }) => ({
        id,
        name,
        latitude,
        longitude,
        prices: effectivePrices,
        includedKm: effectiveIncludedKm,
      })),
    };
  }
}

export default DestinationService;
