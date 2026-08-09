import { Request, Response } from "express";
import BookingService from "../services/booking.service";
import PricingService from "../services/pricing.service";

export const calculatePrice = async (req: Request, res: Response) => {
  const breakdown = await PricingService.calculatePrice(req.body);
  res.status(200).json({
    success: true,
    data: breakdown,
  });
};

export const createBooking = async (req: Request, res: Response) => {
  const booking = await BookingService.createBooking(req.body, req.user);
  res.status(201).json({
    success: true,
    data: booking,
  });
};

export const getBookings = async (req: Request, res: Response) => {
  const result = await BookingService.listBookings(req.query as any, req.user);
  res.status(200).json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
};

export const getBookingById = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const booking = await BookingService.getBookingById(id);
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
  const result = await BookingService.cancelBooking(id, req.user?.id);
  res.status(200).json({
    success: true,
    message: "Booking cancelled successfully",
    data: result.booking,
    promotedWaitlistEntry: result.promotedWaitlistEntry,
  });
};
