import { Request, Response } from "express";
import ReviewService from "../services/review.service";
import BookingService, { ListBookingsParams, bookingPartyOf } from "../services/booking.service";
import prismaClient from "../utils/prismaClientHelper";
import { ForbiddenException, NotFoundException } from "../utils/errors";
import ServicePricing from "../services/service-pricing.service";
import { isAdminRole, normalizeRoleName, USER_ROLES } from "../constants/roles";
import MapsService from "../services/maps.service";
import AuditService from "../services/audit.service";
import { AuditAction } from "../../../generated/prisma";
import { bookingRef } from "../utils/bookingRef";
import { queryNum, queryStr, queryLimit } from "../utils/routeParams";
import {
  calculatePriceSchema,
  createBookingSchema,
  cancelBookingSchema,
  estimateDistanceSchema,
} from "../schemas/booking.schema";

export const calculatePrice = async (req: Request, res: Response) => {
  // Parsed rather than passed through: this endpoint is public, and the schema
  // is what rejects client-supplied price overrides.
  const input = calculatePriceSchema.parse(req.body);
  // Discounts are for the caller. An admin quoting for a customer (booking on
  // their behalf) passes customerId to see that customer's discounts.
  const user: any = (req as any).user;
  const roleName = normalizeRoleName(user?.role?.name);
  const forCustomer = input.customerId && roleName && isAdminRole(roleName) ? input.customerId : user?.id;
  // Wedding / private trip / VIP: fixed prices with itemised lines (a private
  // trip when no service is given).
  const q = await ServicePricing.quote(
    { serviceType: input.serviceType, vehicleId: input.vehicleId, destinationId: input.destinationId, startPoint: input.startPoint, endPoint: input.endPoint, startTime: input.startTime, endTime: input.endTime, packageId: input.packageId },
    forCustomer
  );
  res.status(200).json({
    success: true,
    data: q.breakdown,
    serviceType: q.serviceType,
    lines: q.lines,
    bookedMinutes: q.bookedMinutes,
    depositRate: q.depositRate,
    destination: q.destination,
    startPoint: q.startPoint,
    endPoint: q.endPoint,
    route: { distanceKm: q.route.distanceKm, durationMinutes: q.route.durationMinutes, source: q.route.source, start: q.route.start, end: q.route.end, warning: q.route.warning },
  });
};

export const estimateDistance = async (req: Request, res: Response) => {
  const { startPoint, endPoint } = estimateDistanceSchema.parse(req.body);
  const route = await MapsService.route(startPoint, endPoint);

  res.status(200).json({
    success: true,
    data: {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      source: route.source,
      start: route.start,
      end: route.end,
      ...(route.warning ? { warning: route.warning } : {}),
    },
  });
};

export const createBooking = async (req: Request, res: Response) => {
  const input = createBookingSchema.parse(req.body);
  const booking = await BookingService.createBooking(input, req.user);

  res.status(201).json({
    success: true,
    data: booking,
  });
};

export const getBookings = async (req: Request, res: Response) => {
  // req.query is stringly typed; page/limit must be coerced before they reach
  // Prisma's `take`/`skip`, which reject a string with a 500.
  const result = await BookingService.listBookings(
    {
      page: queryNum(req.query.page, 1),
      limit: queryLimit(req.query.limit, 10),
      status: queryStr(req.query.status) as ListBookingsParams["status"],
      tripStatus: queryStr(req.query.tripStatus) as ListBookingsParams["tripStatus"],
      bookingDate: queryStr(req.query.bookingDate),
      customerId: queryStr(req.query.customerId),
      driverId: queryStr(req.query.driverId),
      vehicleId: queryStr(req.query.vehicleId),
    },
    req.user
  );
  // A driver's list only carries what he needs to reach the customer (no email);
  // the list is already limited to his own trips, or the customer's own bookings.
  const role = normalizeRoleName(typeof req.user?.role === "string" ? req.user.role : req.user?.role?.name);
  const items = role === USER_ROLES.DRIVER
    ? result.items.map((b) => ({ ...b, customer: { id: b.customer.id, name: b.customer.name, phoneNumber: b.customer.phoneNumber } }))
    : result.items;
  res.status(200).json({
    success: true,
    data: items,
    pagination: result.pagination,
  });
};

/**
 * What each side of a booking sees. The customer gets the driver's phone once
 * the booking is confirmed (to reach him on the day), the driver doesn't get the
 * customer's email, and nobody sees the other side's review before it is
 * released (blind reviews). The office sees everything.
 */
const shapeForParty = (b: Awaited<ReturnType<typeof BookingService.getBookingById>>, party: string, userId: string) => {
  if (party === "admin") return b;
  const reviews = b.reviews.filter((r) => ReviewService.isReleased(r) || r.reviewerId === userId);
  const { user: driverUser, ...driver } = b.driver;
  const reachable = b.status === "CONFIRMED" && b.tripStatus !== "COMPLETED";
  const driverView = {
    ...driver,
    pic: driverUser?.pic || driver.pic || "",
    ...(party === "customer" ? { phoneNumber: reachable ? driverUser?.phoneNumber ?? null : null } : {}),
  };
  const customer = party === "driver" ? { id: b.customer.id, name: b.customer.name, phoneNumber: b.customer.phoneNumber } : b.customer;
  return { ...b, driver: driverView, customer, reviews };
};

export const getBookingById = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const booking = await BookingService.getBookingById(id);
  // Only the booking's customer, its assigned driver or an admin may see it.
  // Others get the same 404 as a missing booking, so ids can't be probed.
  const party = await bookingPartyOf(booking, req.user);
  if (party === null) {
    throw new NotFoundException(`Booking with ID ${id} not found`);
  }
  res.status(200).json({
    success: true,
    data: shapeForParty(booking, party, req.user!.id),
  });
};

const byAdmin = (req: Request) => {
  const role = req.user?.role;
  return isAdminRole(normalizeRoleName(typeof role === "string" ? role : role?.name));
};

export const updateBookingStatus = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const before = await prismaClient.bookings.findUnique({ where: { id }, select: { status: true } });
  const booking = await BookingService.updateBookingStatus(id, status, req.user);
  if (byAdmin(req) && before && before.status !== booking.status) {
    await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
      action: AuditAction.UPDATE,
      entityType: "booking",
      entityId: id,
      entityLabel: `حجز #${bookingRef(id)}`,
      details: `status: ${before.status} → ${booking.status}`,
    });
  }
  res.status(200).json({
    success: true,
    data: booking,
  });
};

export const updateTripStatus = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { tripStatus } = req.body;
  const booking = await BookingService.updateTripStatus(id, tripStatus, req.user);
  res.status(200).json({
    success: true,
    data: booking,
  });
};

export const cancelBooking = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = await prismaClient.bookings.findUnique({ where: { id }, select: { customerId: true, driverId: true } });
  const party = existing ? await bookingPartyOf(existing, req.user) : null;
  if (party === null) throw new NotFoundException(`Booking with ID ${id} not found`);
  // Drivers can't cancel a customer's booking; admins and the customer can.
  if (party === "driver") throw new ForbiddenException("Drivers cannot cancel bookings");
  // Only an admin may decide the deposit either way; a customer gets the policy.
  const { refundDeposit } = cancelBookingSchema.parse(req.body ?? {});
  const result = await BookingService.cancelBooking(id, req.user?.id, party === "admin" ? { refundDeposit } : {});
  if (party === "admin" && result.cancellation) {
    const c = result.cancellation;
    await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
      action: AuditAction.UPDATE,
      entityType: "booking",
      entityId: id,
      entityLabel: `حجز #${bookingRef(id)}`,
      details: `cancelled · paid ${c.paid}, refunded ${c.refund}, kept ${c.kept}${c.overridden ? " (admin decision)" : " (policy)"}`,
    });
  }
  // Same per-party view as GET /bookings/:id.
  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
    data: shapeForParty(await BookingService.getBookingById(result.booking.id), party, req.user!.id),
    cancellation: result.cancellation,
    promotedWaitlistEntry: result.promotedWaitlistEntry,
  });
};

/** What cancelling now would do to the money paid (shown before confirming). */
export const getCancellationTerms = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = await prismaClient.bookings.findUnique({ where: { id }, select: { customerId: true, driverId: true } });
  const party = existing ? await bookingPartyOf(existing, req.user) : null;
  if (party === null || party === "driver") throw new NotFoundException(`Booking with ID ${id} not found`);
  res.status(200).json({ success: true, data: await BookingService.getCancellationTerms(id) });
};
