import prismaClient from "../utils/prismaClientHelper";
import { lockKeys } from "../utils/locks";
import {
  BookingStatus,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
} from "../../../generated/prisma";
import {
  BadRequestException,
  NotFoundException,
} from "../utils/errors";

export class PaymentService {
  public static async initiatePayment(data: {
    bookingId: string;
    amount: number;
    paymentMethod: PaymentMethod;
  }) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: data.bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${data.bookingId} not found`);
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException("Cannot pay for a cancelled booking");
    }
    if (!(data.amount > 0)) {
      throw new BadRequestException("Payment amount must be positive");
    }
    // depositPaid is the sum of confirmed payments, so the customer can pay the
    // deposit first and the rest later, or everything at once.
    const remaining = Math.round((booking.totalPrice - booking.depositPaid) * 100) / 100;
    if (data.amount > remaining + 0.001) {
      throw new BadRequestException(`Payment amount exceeds remaining balance (${remaining})`);
    }

    const payment = await prismaClient.payments.create({
      data: {
        bookingId: data.bookingId,
        userId: booking.customerId,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        status: PaymentRecordStatus.PENDING,
      },
      include: {
        booking: true,
      },
    });

    return payment;
  }

  public static async updatePaymentStatus(
    paymentId: string,
    status: PaymentRecordStatus,
    transactionRef?: string
  ) {
    const updatedPayment = await prismaClient.$transaction(async (tx) => {
      const found = await tx.payments.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
      if (!found) {
        throw new NotFoundException(`Payment with ID ${paymentId} not found`);
      }
      // One confirmation at a time per booking, then check against what is
      // already confirmed: several pending payments (each within the balance
      // when created) could all be confirmed and the booking paid twice over.
      await lockKeys(tx, [`booking-money:${found.bookingId}`]);
      const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } });
      if (status === PaymentRecordStatus.SUCCESS && payment.status !== PaymentRecordStatus.SUCCESS) {
        const booking = await tx.bookings.findUniqueOrThrow({ where: { id: payment.bookingId }, select: { totalPrice: true, status: true } });
        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException("This booking is cancelled; the payment can't be confirmed");
        }
        const confirmed = await tx.payments.aggregate({
          where: { bookingId: payment.bookingId, status: PaymentRecordStatus.SUCCESS },
          _sum: { amount: true },
        });
        const already = confirmed._sum.amount ?? 0;
        if (already + payment.amount > booking.totalPrice + 0.001) {
          const left = Math.max(0, Math.round((booking.totalPrice - already) * 100) / 100);
          throw new BadRequestException(`This payment would go over the booking's price: ${left} left to pay`);
        }
      }
      return tx.payments.update({
        where: { id: paymentId },
        data: {
          status,
          ...(transactionRef && { transactionRef }),
          ...(status === PaymentRecordStatus.SUCCESS && { paidAt: new Date() }),
        },
      });
    });
    const payment = updatedPayment;

    await this.recalculateBookingPaymentStatus(payment.bookingId);

    return updatedPayment;
  }

  public static async recalculateBookingPaymentStatus(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
      include: { payments: true },
    });

    if (!booking) return;

    const successfulPayments = booking.payments.filter(
      (p) => p.status === PaymentRecordStatus.SUCCESS
    );
    const totalPaid = successfulPayments.reduce((sum, p) => sum + p.amount, 0);

    let paymentStatus: PaymentStatus;
    if (totalPaid >= booking.totalPrice) {
      paymentStatus = PaymentStatus.PAID;
    } else if (totalPaid > 0) {
      paymentStatus = PaymentStatus.PARTIALLY_PAID;
    } else {
      paymentStatus = PaymentStatus.UNPAID;
    }

    // Paying the required deposit confirms a pending booking automatically.
    const depositCovered = totalPaid > 0 && totalPaid + 0.001 >= booking.depositRequired;
    const autoConfirm = booking.status === BookingStatus.PENDING && depositCovered;

    await prismaClient.bookings.update({
      where: { id: bookingId },
      data: {
        paymentStatus,
        depositPaid: Math.round(totalPaid * 100) / 100,
        ...(autoConfirm && { status: BookingStatus.CONFIRMED }),
      },
    });
  }

  public static async getBookingPayments(bookingId: string) {
    const payments = await prismaClient.payments.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
    });

    return payments;
  }

  public static async getPaymentById(paymentId: string) {
    const payment = await prismaClient.payments.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          select: { id: true, totalPrice: true, status: true },
        },
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    return payment;
  }

  public static async refundPayment(paymentId: string) {
    const payment = await prismaClient.payments.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    if (payment.status !== PaymentRecordStatus.SUCCESS) {
      throw new BadRequestException("Only successful payments can be refunded");
    }

    const updatedPayment = await prismaClient.payments.update({
      where: { id: paymentId },
      data: { status: PaymentRecordStatus.REFUNDED },
    });

    await this.recalculateBookingPaymentStatus(payment.bookingId);

    return updatedPayment;
  }

  public static async getPaymentSummary(bookingId: string) {
    const booking = await prismaClient.bookings.findUnique({
      where: { id: bookingId },
      include: { payments: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const successfulPayments = booking.payments.filter(
      (p) => p.status === PaymentRecordStatus.SUCCESS
    );
    const totalPaid = successfulPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, booking.totalPrice - totalPaid);

    return {
      totalPrice: booking.totalPrice,
      depositRequired: booking.depositRequired,
      depositDue: Math.max(0, Math.round((booking.depositRequired - totalPaid) * 100) / 100),
      totalPaid,
      remaining,
      paymentStatus: booking.paymentStatus,
      payments: booking.payments,
    };
  }
}

export default PaymentService;
