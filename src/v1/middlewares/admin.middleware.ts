import { ErrorCodes } from "../exceptions/root";
import { NextFunction, Request, Response } from "express";
import { UnauthorizedException } from "../exceptions/unauthorized";

export const adminMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user as any;

        if (!user || (!user.isAdmin && user.role?.name !== "Super Admin" && user.role?.name !== "Admin")) {
            throw new UnauthorizedException("You are not authorized to perform this action", ErrorCodes.UNAUTHORIZED);
        }

        next();
    } catch (error) {
        next(error);
    }
}