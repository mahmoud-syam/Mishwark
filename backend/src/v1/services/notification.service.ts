import prismaClient from "../utils/prismaClientHelper";
import Notify from "./notify.service";
import {
  NotificationStatus,
} from "../../../generated/prisma";
import {
  NotFoundException,
} from "../utils/errors";

export class NotificationService {
  public static async getUserNotifications(
    userId: string,
    params: { page?: number; limit?: number; status?: NotificationStatus }
  ) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 20;
    const skip = (page - 1) * limit;

    // The inbox shows what is due (a reminder appears at its time), never cancelled ones.
    const where: any = { recipientId: userId, scheduledAt: { lte: new Date() }, status: { not: NotificationStatus.CANCELLED } };
    if (params.status) where.status = params.status;

    const [items, total] = await Promise.all([
      prismaClient.scheduledNotifications.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          booking: {
            select: { id: true, bookingDate: true, vehicle: { select: { make: true, model: true } } },
          },
        },
      }),
      prismaClient.scheduledNotifications.count({ where }),
    ]);

    return {
      items: items.map((n) => ({ ...n, read: n.readAt !== null })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  public static async markAsRead(notificationId: string, userId: string) {
    const notification = await prismaClient.scheduledNotifications.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${notificationId} not found`);
    }

    if (notification.recipientId !== userId) {
      throw new NotFoundException("Notification not found");
    }

    const updated = await prismaClient.scheduledNotifications.update({
      where: { id: notificationId },
      data: { readAt: notification.readAt ?? new Date() },
    });
    return { ...updated, read: true };
  }

  public static async markAllAsRead(userId: string) {
    await prismaClient.scheduledNotifications.updateMany({
      where: { recipientId: userId, readAt: null, scheduledAt: { lte: new Date() } },
      data: { readAt: new Date() },
    });

    return { message: "All notifications marked as read" };
  }

  public static async getUnreadCount(userId: string) {
    const count = await prismaClient.scheduledNotifications.count({
      where: { recipientId: userId, readAt: null, scheduledAt: { lte: new Date() }, status: { not: NotificationStatus.CANCELLED } },
    });

    return { unreadCount: count };
  }

  public static async scheduleNotification(data: {
    bookingId?: string;
    recipientId: string;
    recipientType?: any;
    notificationType: any;
    channel?: any;
    title: string;
    body: string;
    scheduledAt: Date;
  }) {
    return await prismaClient.scheduledNotifications.create({
      data: {
        bookingId: data.bookingId || null,
        recipientId: data.recipientId,
        recipientType: data.recipientType || "CUSTOMER",
        notificationType: data.notificationType,
        channel: data.channel || "PUSH",
        title: data.title,
        body: data.body,
        scheduledAt: data.scheduledAt,
        status: NotificationStatus.SCHEDULED,
      },
    });
  }

  /** Kept for older callers: reminders now come from Notify (Cairo time, 24h and 2h before). */
  public static async scheduleBookingReminders(bookingId: string) {
    const b = await prismaClient.bookings.findUnique({ where: { id: bookingId }, select: { id: true, bookingDate: true, startTime: true, customerId: true, driverId: true } });
    if (b) await Notify.scheduleReminders(b);
  }

}

export default NotificationService;
