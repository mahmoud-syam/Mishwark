import { NextFunction, Request, Response } from "express";
import prismaClient from "../utils/prismaClientHelper";
import { VehicleQuerySchema, VehicleAvailabilityQuerySchema } from "../schemas/vehicles.schema";
import { BadRequestsException } from "../exceptions/bad-requests";
import { ErrorCodes } from "../exceptions/root";
import { VehicleCategory } from "../../../generated/prisma";
import FleetService from "../services/fleet.service";
import { NotFoundException } from "../utils/errors";

/**
 * What the customer app may see: cars in service (not retired) that have at
 * least one driver assigned (only a car's own drivers can drive it). Status is
 * derived for today: AVAILABLE, BOOKED or MAINTENANCE.
 */
const PUBLIC_CAR = { retiredAt: null, vehicleDrivers: { some: {} } };
const IMAGE_ORDER = [{ isCover: "desc" as const }, { sortOrder: "asc" as const }, { createdAt: "asc" as const }];

export const getVehicles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { category, status } = VehicleQuerySchema.parse(req.query);

        const vehicles = await prismaClient.vehicles.findMany({
            where: {
                ...PUBLIC_CAR,
                ...(category && { category: category.toUpperCase() as VehicleCategory }),
            },
            include: { images: { orderBy: IMAGE_ORDER } },
            orderBy: { createdAt: "asc" },
        });
        const statuses = await FleetService.statuses(vehicles.map((v) => v.id));
        const data = vehicles
            .map(({ retiredAt, retiredReason, ...v }) => ({ ...v, status: statuses.get(v.id) ?? "AVAILABLE" }))
            .filter((v) => !status || v.status === status.toUpperCase());

        res.status(200).json({ message: "Vehicles fetched successfully", data });
    } catch (error) {
        next(error);
    }
};

export const getVehicleById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const vehicle = await prismaClient.vehicles.findFirst({
            where: { id, ...PUBLIC_CAR },
            include: { images: { orderBy: IMAGE_ORDER } },
        });

        if (!vehicle) {
            throw new NotFoundException("Vehicle not found");
        }
        const { retiredAt, retiredReason, ...rest } = vehicle;
        const status = (await FleetService.statuses([vehicle.id])).get(vehicle.id) ?? "AVAILABLE";

        res.status(200).json({ message: "Vehicle fetched successfully", data: { ...rest, status } });
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

        // Maintenance days carry an internal "#<id>" marker; the app only needs the label.
        const data = availability.map((a) => ({ ...a, reason: a.reason.replace(/ #[\w-]+$/, "") }));

        res.status(200).json({ message: "Availability fetched successfully", data });
    } catch (error) {
        next(error);
    }
};
