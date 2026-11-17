import { Request, Response } from "express";
import PaymentService from "../services/payment.service";
import { paramStr } from "../utils/routeParams";
import prismaClient from "../utils/prismaClientHelper";
import { bookingPartyOf } from "../services/booking.service";
import { ForbiddenException, NotFoundException } from "../utils/errors";
import { isAdminRole } from "../constants/roles";
import AuditService from "../services/audit.service";
import { AuditAction } from "../../../generated/prisma";
import { bookingRef } from "../services/admin-dashboard.service";

/**
 * Payments belong to a booking; only that booking's customer, its driver or an
 * admin may see or act on them. Previously any signed-in user could list,
 * settle or refund any payment by id.
 */
const assertBookingParty = async (bookingId: string, user: any) => {
  const booking = await prismaClient.bookings.findUnique({ where: { id: bookingId }, select: { customerId: true, driverId: true } });
  const party = booking ? await bookingPartyOf(booking, user) : null;
  if (party === null) throw new NotFoundException(`Booking with ID ${bookingId} not found`);
  return party;
};
const assertPaymentParty = async (paymentId: string, user: any) => {
  const payment = await prismaClient.payments.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
  if (!payment) throw new NotFoundException(`Payment with ID ${paymentId} not found`);
  return assertBookingParty(payment.bookingId, user);
};

export const initiatePayment = async (req: Request, res: Response) => {
  await assertBookingParty(String(req.body?.bookingId ?? ""), req.user);
  const payment = await PaymentService.initiatePayment(req.body);
  res.status(201).json({ success: true, data: payment });
};

export const updatePaymentStatus = async (req: Request, res: Response) => {
  // Money is confirmed by whoever actually received it: an admin (transfers,
  // anything) or the assigned driver (cash handed to him). A customer can't
  // mark their own payment as paid. A gateway webhook would also settle here.
  const party = await assertPaymentParty(paramStr(req.params.id), req.user);
  if (party === "customer") {
    throw new ForbiddenException("Payments are confirmed by the driver or an admin");
  }
  if (party === "driver") {
    const payment = await prismaClient.payments.findUnique({ where: { id: paramStr(req.params.id) }, select: { paymentMethod: true } });
    const status = String(req.body?.status ?? "");
    if (payment?.paymentMethod !== "CASH" || !["SUCCESS", "FAILED"].includes(status)) {
      throw new ForbiddenException("Drivers can only confirm or reject cash payments");
    }
  }
  const before = await prismaClient.payments.findUnique({ where: { id: paramStr(req.params.id) }, select: { status: true, amount: true, paymentMethod: true, bookingId: true } });
  const payment = await PaymentService.updatePaymentStatus(
    paramStr(req.params.id),
    req.body.status,
    req.body.transactionRef
  );
  if (before && before.status !== payment.status) {
    await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
      action: AuditAction.UPDATE,
      entityType: "payment",
      entityId: payment.id,
      entityLabel: `دفعة حجز #${bookingRef(before.bookingId)}`,
      details: `status: ${before.status} → ${payment.status} · ${before.amount} (${before.paymentMethod})`,
    });
  }
  res.status(200).json({ success: true, data: payment });
};

export const getBookingPayments = async (req: Request, res: Response) => {
  await assertBookingParty(paramStr(req.params.bookingId), req.user);
  const payments = await PaymentService.getBookingPayments(paramStr(req.params.bookingId));
  res.status(200).json({ success: true, data: payments });
};

export const getPaymentById = async (req: Request, res: Response) => {
  await assertPaymentParty(paramStr(req.params.id), req.user);
  const payment = await PaymentService.getPaymentById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: payment });
};

export const refundPayment = async (req: Request, res: Response) => {
  // Refunds move money back; only admins can issue them.
  if (!isAdminRole(req.user?.role?.name)) {
    throw new ForbiddenException("Only admins can refund payments");
  }
  const payment = await PaymentService.refundPayment(paramStr(req.params.id));
  await AuditService.record({ id: req.user!.id, name: req.user!.name }, {
    action: AuditAction.UPDATE,
    entityType: "payment",
    entityId: payment.id,
    entityLabel: `دفعة حجز #${bookingRef(payment.bookingId)}`,
    details: `refund: ${payment.amount} (${payment.paymentMethod})`,
  });
  res.status(200).json({ success: true, data: payment });
};

export const getPaymentSummary = async (req: Request, res: Response) => {
  await assertBookingParty(paramStr(req.params.bookingId), req.user);
  const summary = await PaymentService.getPaymentSummary(paramStr(req.params.bookingId));
  res.status(200).json({ success: true, data: summary });
};
