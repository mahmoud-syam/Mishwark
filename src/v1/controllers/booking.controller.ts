import { Request, Response } from "express";
import BookingService, { ListBookingsParams, bookingPartyOf } from "../services/booking.service";
import prismaClient from "../utils/prismaClientHelper";
import { ForbiddenException, NotFoundException } from "../utils/errors";
import PricingService from "../services/pricing.service";
import MapsService from "../services/maps.service";
import { queryNum, queryStr } from "../utils/routeParams";
import {
  calculatePriceSchema,
  createBookingSchema,
  estimateDistanceSchema,
} from "../schemas/booking.schema";

export const calculatePrice = async (req: Request, res: Response) => {
  // Parsed rather than passed through: this endpoint is public, and the schema
  // is what rejects client-supplied price overrides.
  const input = calculatePriceSchema.parse(req.body);
  const quote = await PricingService.quote(input);

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
      limit: queryNum(req.query.limit, 10),
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

export const updateBookingStatus = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const booking = await BookingService.updateBookingStatus(id, status, req.user);
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
  const result = await BookingService.cancelBooking(id, req.user?.id);
  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
    data: result.booking,
    promotedWaitlistEntry: result.promotedWaitlistEntry,
  });
};
