import prismaClient from "../utils/prismaClientHelper";
import {
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

    if (data.amount > booking.totalPrice - booking.depositPaid) {
      throw new BadRequestException("Payment amount exceeds remaining balance");
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
    const payment = await prismaClient.payments.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    const updatedPayment = await prismaClient.payments.update({
      where: { id: paymentId },
      data: {
        status,
        ...(transactionRef && { transactionRef }),
        ...(status === PaymentRecordStatus.SUCCESS && { paidAt: new Date() }),
      },
    });

    if (status === PaymentRecordStatus.SUCCESS) {
      await this.recalculateBookingPaymentStatus(payment.bookingId);
    }

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

    await prismaClient.bookings.update({
      where: { id: bookingId },
      data: {
        paymentStatus,
        depositPaid: totalPaid,
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
      totalPaid,
      remaining,
      paymentStatus: booking.paymentStatus,
      payments: booking.payments,
    };
  }
}

export default PaymentService;
