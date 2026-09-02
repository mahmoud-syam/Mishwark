import prismaClient from "../utils/prismaClientHelper";
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

    const where: any = { recipientId: userId };
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
      items,
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

    return await prismaClient.scheduledNotifications.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.SENT, sentAt: new Date() },
    });
  }

  public static async markAllAsRead(userId: string) {
    await prismaClient.scheduledNotifications.updateMany({
      where: {
        recipientId: userId,
        status: NotificationStatus.SCHEDULED,
      },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    return { message: "All notifications marked as read" };
  }

  public static async getUnreadCount(userId: string) {
    const count = await prismaClient.scheduledNotifications.count({
      where: {
        recipientId: userId,
        status: NotificationStatus.SCHEDULED,
      },
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

  public static async scheduleBookingReminders(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
    });

    if (!booking) return;

    const bookingDateTime = new Date(`${booking.bookingDate}T${booking.startTime}:00.000Z`);
    const now = new Date();

    const reminders = [
      { hours: 24, type: "REMINDER_24H" as const, label: "24 hours" },
      { hours: 2, type: "REMINDER_2H" as const, label: "2 hours" },
      { minutes: 30, type: "REMINDER_30M" as const, label: "30 minutes" },
    ];

    for (const reminder of reminders) {
      const scheduledAt = new Date(bookingDateTime.getTime() - (reminder.hours || reminder.minutes!) * 60 * 60 * 1000);

      if (scheduledAt > now) {
        const existing = await prismaClient.scheduledNotifications.findFirst({
          where: {
            bookingId,
            recipientId: booking.customerId,
            notificationType: reminder.type,
          },
        });

        if (!existing) {
          await prismaClient.scheduledNotifications.create({
            data: {
              bookingId,
              recipientId: booking.customerId,
              recipientType: "CUSTOMER",
              notificationType: reminder.type,
              channel: "PUSH",
              title: `Trip Reminder`,
              body: `Your trip is in ${reminder.label}. Get ready!`,
              scheduledAt,
              status: NotificationStatus.SCHEDULED,
            },
          });
        }
      }
    }
  }
}

export default NotificationService;
