import prismaClient from "../utils/prismaClientHelper";
import { NotificationRecipientType, NotificationStatus, NotificationType } from "../../../generated/prisma";
import { zonedToInstant } from "../utils/businessTime";
import { bookingRef } from "../utils/bookingRef";
import PushService from "./push.service";

/**
 * Every notification a customer or driver gets: saved in their inbox
 * (GET /notifications) and pushed to their phones when push is set up.
 *
 * Nothing here may break the action that caused it (a booking, a payment...):
 * failures are logged and swallowed. Pushes go out in the background; tests
 * can wait for them with Notify.idle().
 */

type Lang = "ar" | "en";
type Text = { title: string; body: string };
type Params = Record<string, string | number>;

const fmtTime = (hhmm: string, lang: Lang) => {
  const [h, m] = hhmm.split(":").map(Number);
  const pm = h >= 12;
  const h12 = h % 12 || 12;
  return lang === "ar" ? `${h12}:${String(m).padStart(2, "0")} ${pm ? "م" : "ص"}` : `${h12}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
};

/** Short, plain texts. {ref} = MW-XXXXXX, {when} = date and time. */
const TEXTS: Record<string, Record<Lang, (p: Params) => Text>> = {
  NEW_TRIP: {
    ar: (p) => ({ title: "رحلة جديدة", body: `عندك رحلة ${p.when}. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "New trip", body: `You have a trip on ${p.when}. Booking ${p.ref}.` }),
  },
  BOOKED_FOR_YOU: {
    ar: (p) => ({ title: "اتحجزلك رحلة", body: `حجزنالك رحلة ${p.when}. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "A trip was booked for you", body: `We booked your trip on ${p.when}. Booking ${p.ref}.` }),
  },
  BOOKING_CONFIRMED: {
    ar: (p) => ({ title: "حجزك اتأكد", body: `رحلتك ${p.when} اتأكدت. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "Booking confirmed", body: `Your trip on ${p.when} is confirmed. Booking ${p.ref}.` }),
  },
  DRIVER_TRIP_CONFIRMED: {
    ar: (p) => ({ title: "رحلة اتأكدت", body: `الرحلة ${p.when} اتأكدت. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "Trip confirmed", body: `The trip on ${p.when} is confirmed. Booking ${p.ref}.` }),
  },
  BOOKING_CANCELLED: {
    ar: (p) => ({ title: "الحجز اتلغى", body: `رحلة ${p.when} اتلغت. الحجز ${p.ref}.${p.refund ? ` رجعنالك ${p.refund} ج.م في المحفظة.` : ""}` }),
    en: (p) => ({ title: "Booking cancelled", body: `The trip on ${p.when} was cancelled. Booking ${p.ref}.${p.refund ? ` ${p.refund} EGP is back in your wallet.` : ""}` }),
  },
  TRIP_STARTED: {
    ar: () => ({ title: "السواق اتحرك", body: "السواق في الطريق ليك." }),
    en: () => ({ title: "Your driver is on the way", body: "The driver has started the trip." }),
  },
  DRIVER_ARRIVED: {
    ar: () => ({ title: "السواق وصل", body: "السواق مستنيك في مكان التحرك." }),
    en: () => ({ title: "Your driver has arrived", body: "The driver is waiting at the pickup point." }),
  },
  RATE_TRIP: {
    ar: () => ({ title: "وصلت بالسلامة", body: "قيّم الرحلة والسواق، رأيك بيفرق معانا." }),
    en: () => ({ title: "You've arrived", body: "Rate your trip and driver: it helps us." }),
  },
  PAYMENT_RECEIVED: {
    ar: (p) => ({ title: "استلمنا الدفع", body: `استلمنا ${p.amount} ج.م للحجز ${p.ref}.${p.confirmed ? " وحجزك اتأكد." : ""}` }),
    en: (p) => ({ title: "Payment received", body: `We received ${p.amount} EGP for booking ${p.ref}.${p.confirmed ? " Your booking is confirmed." : ""}` }),
  },
  DOCUMENT_APPROVED: {
    ar: (p) => ({ title: "ورقة اتقبلت", body: `${p.doc} اتقبلت.` }),
    en: (p) => ({ title: "Document approved", body: `${p.doc} was approved.` }),
  },
  DOCUMENT_REJECTED: {
    ar: (p) => ({ title: "ورقة محتاجة تترفع تاني", body: `${p.doc} اترفضت: ${p.reason}` }),
    en: (p) => ({ title: "Please upload a document again", body: `${p.doc} was rejected: ${p.reason}` }),
  },
  WAITLIST_AVAILABLE: {
    ar: (p) => ({ title: "العربية بقت متاحة", body: `العربية اللي كنت مستنيها بقت متاحة ${p.when}. احجز خلال 24 ساعة.` }),
    en: (p) => ({ title: "The car is available", body: `The car you were waiting for is free on ${p.when}. Book within 24 hours.` }),
  },
  REMINDER_24H: {
    ar: (p) => ({ title: "رحلتك بكرة", body: `فاكرك برحلتك ${p.when}. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "Your trip is tomorrow", body: `A reminder of your trip on ${p.when}. Booking ${p.ref}.` }),
  },
  REMINDER_2H: {
    ar: (p) => ({ title: "رحلتك كمان ساعتين", body: `رحلتك الساعة ${p.time}. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "Your trip is in 2 hours", body: `Your trip starts at ${p.time}. Booking ${p.ref}.` }),
  },
  DRIVER_REMINDER_2H: {
    ar: (p) => ({ title: "عندك رحلة كمان ساعتين", body: `الرحلة الساعة ${p.time}. الحجز ${p.ref}.` }),
    en: (p) => ({ title: "Trip in 2 hours", body: `Your trip starts at ${p.time}. Booking ${p.ref}.` }),
  },
};

const DOC_NAME: Record<string, Record<Lang, string>> = {
  NATIONAL_ID_FRONT: { ar: "البطاقة (وش)", en: "ID card (front)" },
  NATIONAL_ID_BACK: { ar: "البطاقة (ضهر)", en: "ID card (back)" },
  LICENSE_FRONT: { ar: "الرخصة (وش)", en: "Licence (front)" },
  LICENSE_BACK: { ar: "الرخصة (ضهر)", en: "Licence (back)" },
  CRIMINAL_RECORD: { ar: "الفيش والتشبيه", en: "Criminal record" },
};

type Booking = { id: string; bookingDate: string; startTime: string; customerId: string; driverId: string | null };

const inFlight = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>) => {
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
};

export const Notify = {
  /** Runs a notification step in the background so the request doesn't wait for it. */
  later(fn: () => Promise<unknown>) {
    track(fn().catch((e) => console.error("[notify]", (e as Error).message)));
  },

  /** Waits for pushes started so far (tests). */
  async idle() {
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  },

  async langOf(userId: string): Promise<Lang> {
    const u = await prismaClient.users.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
    return u?.preferredLanguage === "en" ? "en" : "ar";
  },

  /**
   * Saves one notification for a user and, if it is due, pushes it now.
   * `text` picks the wording (TEXTS key); `type` is what the app sees.
   */
  async send(o: {
    userId: string;
    type: NotificationType;
    text: keyof typeof TEXTS;
    params?: Params;
    bookingId?: string | null;
    recipientType?: NotificationRecipientType;
    at?: Date;
  }) {
    try {
      const lang = await this.langOf(o.userId);
      const { title, body } = TEXTS[o.text][lang](o.params ?? {});
      const row = await prismaClient.scheduledNotifications.create({
        data: {
          bookingId: o.bookingId ?? null,
          recipientId: o.userId,
          recipientType: o.recipientType ?? NotificationRecipientType.CUSTOMER,
          notificationType: o.type,
          title,
          body,
          scheduledAt: o.at ?? new Date(),
          status: NotificationStatus.SCHEDULED,
        },
      });
      if (row.scheduledAt.getTime() <= Date.now()) track(this.deliver(row.id));
      return row;
    } catch (e) {
      console.error("[notify] couldn't save a notification:", (e as Error).message);
      return null;
    }
  },

  /** Claims a due notification (once, even with several servers) and pushes it. */
  async deliver(id: string) {
    try {
      const claimed = await prismaClient.scheduledNotifications.updateMany({
        where: { id, status: NotificationStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
      if (claimed.count !== 1) return;
      const n = await prismaClient.scheduledNotifications.findUniqueOrThrow({ where: { id } });
      const r = await PushService.sendToUser(n.recipientId, {
        title: n.title ?? "",
        body: n.body ?? "",
        data: { type: n.notificationType, notificationId: n.id, ...(n.bookingId ? { bookingId: n.bookingId } : {}) },
      });
      if (r.failed > 0 && r.sent === 0) {
        await prismaClient.scheduledNotifications.update({ where: { id }, data: { status: NotificationStatus.FAILED } });
      }
    } catch (e) {
      console.error("[notify] delivery failed:", (e as Error).message);
    }
  },

  /** Due reminders, every minute from the server (index.ts). */
  async processDue(limit = 100) {
    const due = await prismaClient.scheduledNotifications.findMany({
      where: { status: NotificationStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    });
    await Promise.all(due.map((d) => this.deliver(d.id)));
    return due.length;
  },

  // ------------------------------------------------------------ events
  async whenOf(b: Booking, userId: string) {
    const lang = await this.langOf(userId);
    return { when: `${b.bookingDate} ${fmtTime(b.startTime, lang)}`, time: fmtTime(b.startTime, lang), ref: bookingRef(b.id) };
  },

  async driverUserId(driverId: string | null) {
    if (!driverId) return null;
    const d = await prismaClient.drivers.findUnique({ where: { id: driverId }, select: { userId: true } });
    return d?.userId ?? null;
  },

  /** A new booking: its driver hears of it; the customer too when the office booked it for them. */
  async bookingCreated(b: Booking, actorId?: string) {
    const driverUser = await this.driverUserId(b.driverId);
    if (driverUser) await this.send({ userId: driverUser, type: NotificationType.NEW_TRIP, text: "NEW_TRIP", params: await this.whenOf(b, driverUser), bookingId: b.id, recipientType: NotificationRecipientType.DRIVER });
    if (actorId && actorId !== b.customerId) {
      await this.send({ userId: b.customerId, type: NotificationType.SYSTEM, text: "BOOKED_FOR_YOU", params: await this.whenOf(b, b.customerId), bookingId: b.id });
    }
  },

  /** Confirmed (by the driver, the office, or the deposit): customer and driver told, reminders set. */
  async bookingConfirmed(b: Booking, opts: { quietCustomer?: boolean } = {}) {
    if (!opts.quietCustomer) {
      await this.send({ userId: b.customerId, type: NotificationType.BOOKING_CONFIRMED, text: "BOOKING_CONFIRMED", params: await this.whenOf(b, b.customerId), bookingId: b.id });
    }
    const driverUser = await this.driverUserId(b.driverId);
    if (driverUser) await this.send({ userId: driverUser, type: NotificationType.BOOKING_CONFIRMED, text: "DRIVER_TRIP_CONFIRMED", params: await this.whenOf(b, driverUser), bookingId: b.id, recipientType: NotificationRecipientType.DRIVER });
    await this.scheduleReminders(b);
  },

  /** Cancelled: whoever didn't cancel it is told; pending reminders are dropped. */
  async bookingCancelled(b: Booking, cancelledBy: string | undefined, refund: number) {
    await this.cancelReminders(b.id);
    if (cancelledBy !== b.customerId) {
      await this.send({ userId: b.customerId, type: NotificationType.BOOKING_CANCELLED, text: "BOOKING_CANCELLED", params: { ...(await this.whenOf(b, b.customerId)), ...(refund > 0 ? { refund } : {}) }, bookingId: b.id });
    }
    const driverUser = await this.driverUserId(b.driverId);
    if (driverUser && driverUser !== cancelledBy) {
      await this.send({ userId: driverUser, type: NotificationType.BOOKING_CANCELLED, text: "BOOKING_CANCELLED", params: await this.whenOf(b, driverUser), bookingId: b.id, recipientType: NotificationRecipientType.DRIVER });
    }
  },

  async tripStatus(b: Booking, tripStatus: string) {
    const map: Record<string, [NotificationType, keyof typeof TEXTS]> = {
      INPROGRESS: [NotificationType.TRIP_STARTED, "TRIP_STARTED"],
      ARRIVED: [NotificationType.DRIVER_ARRIVED, "DRIVER_ARRIVED"],
      COMPLETED: [NotificationType.RATE_TRIP, "RATE_TRIP"],
    };
    const m = map[tripStatus];
    if (m) await this.send({ userId: b.customerId, type: m[0], text: m[1], bookingId: b.id });
    if (tripStatus === "COMPLETED") await this.cancelReminders(b.id);
  },

  async paymentReceived(b: Booking, amount: number, confirmed: boolean) {
    await this.send({ userId: b.customerId, type: NotificationType.PAYMENT_RECEIVED, text: "PAYMENT_RECEIVED", params: { ref: bookingRef(b.id), amount: Math.round(amount * 100) / 100, ...(confirmed ? { confirmed: 1 } : {}) }, bookingId: b.id });
  },

  async documentReviewed(driverUserId: string, docType: string, status: "APPROVED" | "REJECTED", reason?: string | null) {
    const lang = await this.langOf(driverUserId);
    await this.send({
      userId: driverUserId,
      type: NotificationType.DOCUMENT_REVIEWED,
      text: status === "APPROVED" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
      params: { doc: DOC_NAME[docType]?.[lang] ?? docType, reason: reason ?? "" },
      recipientType: NotificationRecipientType.DRIVER,
    });
  },

  async waitlistAvailable(customerId: string, b: Booking) {
    await this.send({ userId: customerId, type: NotificationType.WAITLIST_AVAILABLE, text: "WAITLIST_AVAILABLE", params: await this.whenOf(b, customerId), bookingId: b.id });
  },

  // ------------------------------------------------------------ reminders
  /** 24 hours and 2 hours before (Cairo time) for the customer, 2 hours before for the driver. */
  async scheduleReminders(b: Booking) {
    try {
      const startsAt = zonedToInstant(b.bookingDate, b.startTime).getTime();
      const driverUser = await this.driverUserId(b.driverId);
      const plan: { userId: string; type: NotificationType; text: keyof typeof TEXTS; hours: number; recipientType: NotificationRecipientType }[] = [
        { userId: b.customerId, type: NotificationType.REMINDER_24H, text: "REMINDER_24H", hours: 24, recipientType: NotificationRecipientType.CUSTOMER },
        { userId: b.customerId, type: NotificationType.REMINDER_2H, text: "REMINDER_2H", hours: 2, recipientType: NotificationRecipientType.CUSTOMER },
        ...(driverUser ? [{ userId: driverUser, type: NotificationType.REMINDER_2H, text: "DRIVER_REMINDER_2H" as const, hours: 2, recipientType: NotificationRecipientType.DRIVER }] : []),
      ];
      for (const r of plan) {
        const at = new Date(startsAt - r.hours * 3_600_000);
        if (at.getTime() <= Date.now()) continue;
        const exists = await prismaClient.scheduledNotifications.findFirst({
          where: { bookingId: b.id, recipientId: r.userId, notificationType: r.type, status: { not: NotificationStatus.CANCELLED } },
          select: { id: true },
        });
        if (!exists) await this.send({ userId: r.userId, type: r.type, text: r.text, params: await this.whenOf(b, r.userId), bookingId: b.id, recipientType: r.recipientType, at });
      }
    } catch (e) {
      console.error("[notify] couldn't schedule reminders:", (e as Error).message);
    }
  },

  async cancelReminders(bookingId: string) {
    await prismaClient.scheduledNotifications
      .updateMany({
        where: { bookingId, status: NotificationStatus.SCHEDULED, scheduledAt: { gt: new Date() } },
        data: { status: NotificationStatus.CANCELLED },
      })
      .catch((e) => console.error("[notify] couldn't cancel reminders:", e.message));
  },

  /** Runs processDue every minute until stopped. Started by the server, not by tests. */
  startWorker(everyMs = 60_000) {
    const tick = () => {
      track(this.processDue().catch((e) => console.error("[notify] worker:", e.message)));
    };
    const t = setInterval(tick, everyMs);
    t.unref?.();
    tick();
    return () => clearInterval(t);
  },
};

export default Notify;
