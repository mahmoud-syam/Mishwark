import { NextFunction, Request, Response } from "express";
import prismaClient from "../utils/prismaClientHelper";
import { VehicleQuerySchema, VehicleAvailabilityQuerySchema } from "../schemas/vehicles.schema";
import { BadRequestsException } from "../exceptions/bad-requests";
import { ErrorCodes } from "../exceptions/root";
import { VehicleCategory, VehicleStatus } from "@prisma/client";

export const getVehicles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { category, status } = VehicleQuerySchema.parse(req.query);

        const vehicles = await prismaClient.vehicles.findMany({
            where: {
                ...(category && { category: category.toUpperCase() as VehicleCategory }),
                ...(status && { status: status.toUpperCase() as VehicleStatus })
            },
            include: {
                images: true
            }
        });

        res.status(200).json({ message: "Vehicles fetched successfully", data: vehicles });
    } catch (error) {
        next(error);
    }
};

export const getVehicleById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const vehicle = await prismaClient.vehicles.findUnique({
            where: { id },
            include: { images: true }
        });

        if (!vehicle) {
            throw new BadRequestsException("Vehicle not found", ErrorCodes.USER_NOT_FOUND);
        }

        res.status(200).json({ message: "Vehicle fetched successfully", data: vehicle });
    } catch (error) {
        next(error);
    }
};

export const getVehicleAvailability = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { month } = VehicleAvailabilityQuerySchema.parse(req.query);

        // month is YYYY-MM
        const startDate = new Date(`${month}-01T00:00:00.000Z`);
        const nextMonth = new Date(startDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const availability = await prismaClient.vehicleAvailability.findMany({
            where: {
                vehicleId: id,
                date: {
                    gte: startDate,
                    lt: nextMonth
                }
            }
        });

        res.status(200).json({ message: "Availability fetched successfully", data: availability });
    } catch (error) {
        next(error);
    }
};
