import { Request, Response } from "express";
import BookingService, { ListBookingsParams, bookingPartyOf } from "../services/booking.service";
import prismaClient from "../utils/prismaClientHelper";
import { ForbiddenException, NotFoundException } from "../utils/errors";
import PricingService from "../services/pricing.service";
import ServicePricing from "../services/service-pricing.service";
import { isAdminRole, normalizeRoleName } from "../constants/roles";
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
  if (input.serviceType) {
    // Wedding / private trip / VIP: fixed prices with itemised lines.
    const q = await ServicePricing.quote(
      { serviceType: input.serviceType, vehicleId: input.vehicleId!, destinationId: input.destinationId, startPoint: input.startPoint, endPoint: input.endPoint, startTime: input.startTime, endTime: input.endTime, packageId: input.packageId },
      forCustomer
    );
    return res.status(200).json({
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
      comparison: null,
    });
  }
  const quote = await PricingService.quote(input, forCustomer);

  res.status(200).json({
    success: true,
    data: quote.breakdown,
    route: quote.route,
    comparison: quote.comparison,
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
  res.status(200).json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
};

export const getBookingById = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const booking = await BookingService.getBookingById(id);
  // Only the booking's customer, its assigned driver or an admin may see it.
  // Others get the same 404 as a missing booking, so ids can't be probed.
  if ((await bookingPartyOf(booking, req.user)) === null) {
    throw new NotFoundException(`Booking with ID ${id} not found`);
  }
  res.status(200).json({
    success: true,
    data: booking,
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
  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
    data: result.booking,
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
