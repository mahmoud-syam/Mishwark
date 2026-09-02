import { Request, Response } from "express";
import PackageService from "../services/package.service";
import { paramStr } from "../utils/routeParams";

export const createPackage = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const pkg = await PackageService.createPackage({
    customerId: userId,
    packageName: req.body.packageName,
    packageType: req.body.packageType,
    discountPercentage: req.body.discountPercentage,
  });
  res.status(201).json({ success: true, data: pkg });
};

export const addBookingToPackage = async (req: Request, res: Response) => {
  const booking = await PackageService.addBookingToPackage(req.body.packageId, paramStr(req.params.id));
  res.status(200).json({ success: true, data: booking });
};

export const removeBookingFromPackage = async (req: Request, res: Response) => {
  const result = await PackageService.removeBookingFromPackage(paramStr(req.params.id));
  res.status(200).json({ success: true, data: result });
};

export const getPackageById = async (req: Request, res: Response) => {
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
  const result = await PackageService.cancelPackage(paramStr(req.params.id));
  res.status(200).json({ success: true, data: result });
};
