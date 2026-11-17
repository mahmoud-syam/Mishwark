import { Request, Response } from "express";
import PackageService from "../services/package.service";
import { paramStr } from "../utils/routeParams";
import prismaClient from "../utils/prismaClientHelper";
import { assertOwnerOrAdmin } from "../utils/ownership";
import { BadRequestException, NotFoundException } from "../utils/errors";
import { addBookingToPackageSchema, createPackageSchema } from "../schemas/package.schema";

/** Packages belong to one customer; only they (or an admin) can see or change them. */
const ownPackage = async (packageId: string, user: any) => {
  const pkg = await prismaClient.packages.findUnique({ where: { id: packageId }, select: { customerId: true } });
  if (!pkg) throw new NotFoundException("Package not found");
  assertOwnerOrAdmin(user, [pkg.customerId], "Package");
  return pkg;
};
const ownBooking = async (bookingId: string, user: any) => {
  const b = await prismaClient.bookings.findUnique({ where: { id: bookingId }, select: { customerId: true, packageId: true } });
  if (!b) throw new NotFoundException("Booking not found");
  assertOwnerOrAdmin(user, [b.customerId], "Booking");
  return b;
};

export const createPackage = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const input = createPackageSchema.parse(req.body);
  const pkg = await PackageService.createPackage({ customerId: userId, ...input });
  res.status(201).json({ success: true, data: pkg });
};

export const addBookingToPackage = async (req: Request, res: Response) => {
  const { packageId } = addBookingToPackageSchema.parse(req.body);
  const pkg = await ownPackage(packageId, req.user);
  const b = await ownBooking(paramStr(req.params.id), req.user);
  if (b.customerId !== pkg.customerId) throw new BadRequestException("Booking and package belong to different customers");
  const booking = await PackageService.addBookingToPackage(packageId, paramStr(req.params.id));
  res.status(200).json({ success: true, data: booking });
};

export const removeBookingFromPackage = async (req: Request, res: Response) => {
  await ownBooking(paramStr(req.params.id), req.user);
  const result = await PackageService.removeBookingFromPackage(paramStr(req.params.id));
  res.status(200).json({ success: true, data: result });
};

export const getPackageById = async (req: Request, res: Response) => {
  await ownPackage(paramStr(req.params.id), req.user);
  const pkg = await PackageService.getPackageById(paramStr(req.params.id));
  res.status(200).json({ success: true, data: pkg });
};

export const getCustomerPackages = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const packages = await PackageService.getCustomerPackages(userId);
  res.status(200).json({ success: true, data: packages });
};

export const cancelPackage = async (req: Request, res: Response) => {
  await ownPackage(paramStr(req.params.id), req.user);
  const result = await PackageService.cancelPackage(paramStr(req.params.id));
  res.status(200).json({ success: true, data: result });
};
