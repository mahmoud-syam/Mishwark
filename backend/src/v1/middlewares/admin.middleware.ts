import { ErrorCodes } from "../exceptions/root";
import { NextFunction, Request, Response } from "express";
import { ForbiddenException } from "../exceptions/forbidden";
import { isAdminRole } from "../constants/roles";

export const adminMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user;

        // Role names are compared through normalizeRoleName, so legacy
        // "Super Admin" tokens and canonical SUPER_ADMIN behave identically.
        if (!user || !isAdminRole(user.role?.name)) {
            throw new ForbiddenException("You are not authorized to perform this action", ErrorCodes.FORBIDDEN);
        }

        next();
    } catch (error) {
        next(error);
    }
}