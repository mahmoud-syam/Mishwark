import { Request, Response } from "express";
import PaymentService from "../services/payment.service";
import { paramStr } from "../utils/routeParams";

export const initiatePayment = async (req: Request, res: Response) => {
  const payment = await PaymentService.initiatePayment(req.body);
  res.status(201).json({ success: true, data: payment });
};

export const updatePaymentStatus = async (req: Request, res: Response) => {
  const payment = await PaymentService.updatePaymentStatus(
    paramStr(req.params.id),
    req.body.status,
    req.body.transactionRef
  );
  res.status(200).json({ success: true, data: payment });
};

export const getBookingPayments = async (req: Request, res: Response) => {
  const payments = await PaymentService.getBookingPayments(paramStr(req.params.bookingId));
  res.status(200).json({ success: true, data: payments });
};

export const getPaymentById = async (req: Request, res: Response) => {
  const payment = await PaymentService.getPaymentById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: payment });
};

export const refundPayment = async (req: Request, res: Response) => {
  const payment = await PaymentService.refundPayment(paramStr(req.params.id));
  res.status(200).json({ success: true, data: payment });
};

export const getPaymentSummary = async (req: Request, res: Response) => {
  const summary = await PaymentService.getPaymentSummary(paramStr(req.params.bookingId));
  res.status(200).json({ success: true, data: summary });
};
