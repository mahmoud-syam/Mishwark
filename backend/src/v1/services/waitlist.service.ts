import SettingsService from "./settings.service";
import { addDays, dateKey } from "../utils/businessTime";
import prismaClient from "../utils/prismaClientHelper";
import {
  WaitlistStatus,
  BookingStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "../utils/errors";

export class WaitlistService {
  public static async joinWaitlist(data: {
    customerId: string;
    vehicleId: string;
    requestedDate: string;
    requestedTime?: string;
  }) {
    // Same window as a booking: not in the past, not beyond the advance limit.
    const today = dateKey();
    if (typeof data.requestedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.requestedDate) || Number.isNaN(Date.parse(data.requestedDate))) {
      throw new BadRequestException("requestedDate must be a date (YYYY-MM-DD)");
    }
    if (data.requestedDate < today) {
      throw new BadRequestException("You can't join the waitlist for a past date");
    }
    const { maxAdvanceBookingDays } = await SettingsService.get();
    if (data.requestedDate > addDays(today, maxAdvanceBookingDays)) {
      throw new BadRequestException(`Trips can be booked up to ${maxAdvanceBookingDays} days ahead`);
    }
    if (data.requestedTime !== undefined && data.requestedTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.requestedTime))) {
      throw new BadRequestException("requestedTime must be HH:mm");
    }
    if (typeof data.vehicleId !== "string" || !data.vehicleId) {
      throw new BadRequestException("vehicleId is required");
    }

    const vehicle = await prismaClient.vehicles.findUnique({
      where: { id: data.vehicleId },
    });
    if (!vehicle || vehicle.retiredAt) {
      throw new NotFoundException(`Vehicle with ID ${data.vehicleId} not found`);
    }

    const existingWaitlist = await prismaClient.waitlist.findFirst({
      where: {
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        requestedDate: data.requestedDate,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.NOTIFIED] },
      },
    });

    if (existingWaitlist) {
      throw new ConflictException("You are already on the waitlist for this vehicle and date");
    }

    const maxPosition = await prismaClient.waitlist.aggregate({
      where: {
        vehicleId: data.vehicleId,
        requestedDate: data.requestedDate,
        status: WaitlistStatus.WAITING,
      },
      _max: { position: true },
    });

    const nextPosition = (maxPosition._max.position || 0) + 1;

    const entry = await prismaClient.waitlist.create({
      data: {
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        requestedDate: data.requestedDate,
        requestedTime: data.requestedTime || null,
        position: nextPosition,
        status: WaitlistStatus.WAITING,
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true } },
      },
    });

    return entry;
  }

  public static async getWaitlistEntry(waitlistId: string) {
    const entry = await prismaClient.waitlist.findUnique({
      where: { id: waitlistId },
      include: {
        vehicle: { select: { id: true, make: true, model: true, category: true } },
        customer: { select: { id: true, name: true, phoneNumber: true } },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Waitlist entry with ID ${waitlistId} not found`);
    }

    return entry;
  }

  public static async getCustomerWaitlist(customerId: string) {
    const entries = await prismaClient.waitlist.findMany({
      where: {
        customerId,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.NOTIFIED] },
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true, category: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return entries;
  }

  public static async cancelWaitlist(waitlistId: string, customerId: string) {
    const entry = await prismaClient.waitlist.findUnique({
      where: { id: waitlistId },
    });

    if (!entry) {
      throw new NotFoundException(`Waitlist entry with ID ${waitlistId} not found`);
    }

    // Someone else's entry: not found, so the error doesn't confirm it exists.
    if (entry.customerId !== customerId) {
      throw new NotFoundException(`Waitlist entry with ID ${waitlistId} not found`);
    }

    await prismaClient.waitlist.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.EXPIRED },
    });

    return { message: "Waitlist entry cancelled" };
  }

  public static async expireStaleNotifications() {
    const now = new Date();
    const expired = await prismaClient.waitlist.updateMany({
      where: {
        status: WaitlistStatus.NOTIFIED,
        expiresAt: { lt: now },
      },
      data: { status: WaitlistStatus.EXPIRED },
    });

    return expired.count;
  }

  public static async convertWaitlistToBooking(waitlistId: string) {
    const entry = await prismaClient.waitlist.findUnique({
      where: { id: waitlistId },
    });

    if (!entry) {
      throw new NotFoundException(`Waitlist entry with ID ${waitlistId} not found`);
    }

    if (entry.status !== WaitlistStatus.NOTIFIED) {
      throw new BadRequestException("Only notified entries can be converted to bookings");
    }

    await prismaClient.waitlist.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.CONVERTED },
    });

    return entry;
  }
}

export default WaitlistService;
