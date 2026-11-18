import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import { AuditAction, Prisma, ReviewerType } from "../../../generated/prisma";
import { bookingRef } from "../utils/bookingRef";
import { BadRequestException, NotFoundException } from "../utils/errors";
import AuditService, { AuditActor } from "./audit.service";
import SettingsService from "./settings.service";

/**
 * Reviews for the dashboard: who wrote each one, about whom, on which trip.
 *
 * A complaint is a customer's review of a driver at or below the
 * `complaintMaxRating` setting. The office marks a complaint as handled (with
 * what was done); open complaints feed the home alerts and the menu badge.
 */

export const REVIEW_KINDS = ["complaints", "all"] as const;
export const COMPLAINT_STATES = ["open", "handled", "all"] as const;

export const reviewListSchema = z.object({
  kind: z.enum(REVIEW_KINDS).catch("complaints"),
  state: z.enum(COMPLAINT_STATES).catch("open"),
  /** CUSTOMER_TO_DRIVER (customers rating drivers) or DRIVER_TO_CUSTOMER. Only with kind=all. */
  direction: z.nativeEnum(ReviewerType).optional().catch(undefined),
  rating: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
  driverId: z.string().trim().min(1).max(64).optional().catch(undefined),
  customerId: z.string().trim().min(1).max(64).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
});
export type ReviewListParams = z.infer<typeof reviewListSchema>;

export const handleReviewSchema = z
  .object({
    handled: z.boolean(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => !v.handled || (v.note ?? "").length >= 3, { message: "Write what was done (3 characters or more)", path: ["note"] });

const PERSON = {
  select: { id: true, name: true, phoneNumber: true, isDeleted: true, drivers: { select: { id: true, fullName: true } } },
} as const;

const ROW = {
  reviewer: PERSON,
  reviewee: PERSON,
  handledBy: { select: { id: true, name: true } },
  booking: {
    select: {
      id: true,
      bookingDate: true,
      startTime: true,
      endTime: true,
      serviceType: true,
      vehicle: { select: { id: true, make: true, model: true, plateNumber: true } },
    },
  },
} as const;

type Row = Prisma.ReviewsGetPayload<{ include: typeof ROW }>;
type Person = Row["reviewer"];

/** A customer is opened by user id, a driver by driver id. */
const person = (p: Person) => ({
  userId: p.id,
  driverId: p.drivers?.id ?? null,
  name: p.drivers?.fullName || p.name,
  phone: p.phoneNumber,
  deleted: p.isDeleted,
});

const complaintWhere = (maxRating: number): Prisma.ReviewsWhereInput => ({
  reviewerType: ReviewerType.CUSTOMER_TO_DRIVER,
  overallRating: { lte: maxRating },
});

/** 01012345678 is stored as +201012345678. */
const phoneDigits = (q: string) => {
  const digits = q.replace(/\D/g, "");
  return digits.length >= 4 ? digits.replace(/^0020/, "").replace(/^20(?=1)/, "").replace(/^0(?=1)/, "") : null;
};

export default class ReviewAdminService {
  private static shape(r: Row, maxRating: number) {
    const complaint = r.reviewerType === ReviewerType.CUSTOMER_TO_DRIVER && r.overallRating <= maxRating;
    const v = r.booking?.vehicle;
    return {
      id: r.id,
      direction: r.reviewerType,
      overallRating: r.overallRating,
      vehicleRating: r.vehicleRating,
      punctualityRating: r.punctualityRating,
      comment: r.comment ?? "",
      createdAt: r.createdAt,
      isComplaint: complaint,
      handled: r.handledAt ? { at: r.handledAt, by: r.handledBy ? { id: r.handledBy.id, name: r.handledBy.name } : null, note: r.handlingNote ?? "" } : null,
      reviewer: person(r.reviewer),
      reviewee: person(r.reviewee),
      booking: r.booking
        ? {
            id: r.booking.id,
            ref: bookingRef(r.booking.id),
            date: r.booking.bookingDate,
            startTime: r.booking.startTime,
            endTime: r.booking.endTime,
            serviceType: r.booking.serviceType,
            vehicle: v ? { id: v.id, name: `${v.make} ${v.model}`.trim(), plate: v.plateNumber } : null,
          }
        : null,
    };
  }

  public static async list(p: ReviewListParams) {
    const { complaintMaxRating: max } = await SettingsService.get();
    // A driver is on either side (rated by customers, rating them); so is a customer.
    const scope: Prisma.ReviewsWhereInput[] = [];
    if (p.driverId) scope.push({ OR: [{ reviewee: { drivers: { id: p.driverId } } }, { reviewer: { drivers: { id: p.driverId } } }] });
    if (p.customerId) scope.push({ OR: [{ reviewerId: p.customerId }, { revieweeId: p.customerId }] });
    const and: Prisma.ReviewsWhereInput[] = [...scope];
    if (p.kind === "complaints") {
      and.push(complaintWhere(max));
      if (p.state === "open") and.push({ handledAt: null });
      if (p.state === "handled") and.push({ handledAt: { not: null } });
    } else if (p.direction) {
      and.push({ reviewerType: p.direction });
    }
    if (p.rating) and.push({ overallRating: p.rating });
    if (p.q) {
      const or: Prisma.ReviewsWhereInput[] = [
        { reviewer: { name: { contains: p.q, mode: "insensitive" } } },
        { reviewee: { name: { contains: p.q, mode: "insensitive" } } },
        { reviewee: { drivers: { fullName: { contains: p.q, mode: "insensitive" } } } },
        { comment: { contains: p.q, mode: "insensitive" } },
      ];
      const ref = p.q.replace(/^#?MW-?/i, "");
      if (/^[0-9a-f]{3,8}$/i.test(ref)) or.push({ bookingId: { startsWith: ref.toLowerCase() } });
      const local = phoneDigits(p.q);
      if (local) or.push({ reviewer: { phoneNumber: { contains: local } } }, { reviewee: { phoneNumber: { contains: local } } });
      and.push({ OR: or });
    }
    const where: Prisma.ReviewsWhereInput = and.length ? { AND: and } : {};

    // The tab counts follow the driver/customer filter, not the search or the rating.
    const within = (w: Prisma.ReviewsWhereInput): Prisma.ReviewsWhereInput => ({ AND: [...scope, w] });

    const [rows, total, open, handled, all, avg] = await Promise.all([
      prismaClient.reviews.findMany({
        where,
        include: ROW,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (p.page - 1) * p.limit,
        take: p.limit,
      }),
      prismaClient.reviews.count({ where }),
      prismaClient.reviews.count({ where: within({ ...complaintWhere(max), handledAt: null }) }),
      prismaClient.reviews.count({ where: within({ ...complaintWhere(max), handledAt: { not: null } }) }),
      prismaClient.reviews.count({ where: within({}) }),
      prismaClient.reviews.aggregate({ where: within({ reviewerType: ReviewerType.CUSTOMER_TO_DRIVER }), _avg: { overallRating: true } }),
    ]);

    return {
      items: rows.map((r) => this.shape(r, max)),
      counts: {
        openComplaints: open,
        handledComplaints: handled,
        all,
        averageDriverRating: avg._avg.overallRating != null ? Math.round(avg._avg.overallRating * 10) / 10 : null,
      },
      complaintMaxRating: max,
      pagination: { total, page: p.page, limit: p.limit, totalPages: Math.max(1, Math.ceil(total / p.limit)) },
    };
  }

  public static async get(id: string) {
    const { complaintMaxRating: max } = await SettingsService.get();
    const r = await prismaClient.reviews.findUnique({ where: { id }, include: ROW });
    if (!r) throw new NotFoundException("Review not found");
    return this.shape(r, max);
  }

  /** Marks a complaint as handled (with what was done), or opens it again. */
  public static async setHandled(id: string, input: z.infer<typeof handleReviewSchema>, actor: AuditActor) {
    const { complaintMaxRating: max } = await SettingsService.get();
    const r = await prismaClient.reviews.findUnique({ where: { id }, include: ROW });
    if (!r) throw new NotFoundException("Review not found");
    if (!(r.reviewerType === ReviewerType.CUSTOMER_TO_DRIVER && r.overallRating <= max)) {
      throw new BadRequestException("Only complaints (a customer's low rating of a driver) can be marked as handled");
    }
    const updated = await prismaClient.reviews.update({
      where: { id },
      data: input.handled
        ? { handledAt: new Date(), handledById: actor.id, handlingNote: input.note ?? "" }
        : { handledAt: null, handledById: null, handlingNote: null },
      include: ROW,
    });
    const who = person(r.reviewer).name;
    const driver = person(r.reviewee).name;
    await AuditService.record(actor, {
      action: AuditAction.UPDATE,
      entityType: "review",
      entityId: id,
      entityLabel: `شكوى: ${who} على ${driver} (${r.overallRating}★)`,
      details: input.handled ? `handled: ${input.note}` : "reopened",
    });
    return this.shape(updated, max);
  }

  /** Open complaints, for the home alerts and the menu badge. */
  public static async openComplaints(take = 5) {
    const { complaintMaxRating: max } = await SettingsService.get();
    const where: Prisma.ReviewsWhereInput = { ...complaintWhere(max), handledAt: null };
    const [rows, count] = await Promise.all([
      prismaClient.reviews.findMany({ where, include: ROW, orderBy: { createdAt: "desc" }, take }),
      prismaClient.reviews.count({ where }),
    ]);
    return { rows: rows.map((r) => this.shape(r, max)), count };
  }
}
