import { NextFunction, Request, Response } from "express";
import { ErrorCodes } from "../exceptions/root";
import { ForbiddenException } from "../exceptions/forbidden";
import { isSuperAdminRole, normalizePermissions } from "../constants/roles";

/**
 * Middleware to check if the user has specific permission(s).
 * @param permissionNames A single permission name or an array of permission names.
 * @param mode 'any' (default) means the user needs at least one match. 'all' means the user needs every permission listed.
 */
export const requirePermission = (permissionNames: string | string[], mode: 'any' | 'all' = 'any') => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user;

            if (!user) {
                throw new ForbiddenException("Authentication required", ErrorCodes.UNAUTHORIZED);
            }

            // Super Admin holds every permission by definition.
            if (isSuperAdminRole(user.role?.name)) {
                return next();
            }

            // normalizePermissions tolerates legacy tokens that carried raw
            // Prisma Permission objects instead of names.
            const userPermissions = normalizePermissions(user.role?.permissions);
            const requiredPermissions = (Array.isArray(permissionNames)
                ? permissionNames
                : [permissionNames]
            ).map(p => p.toLowerCase());

            const hasPermission = mode === 'any'
                ? requiredPermissions.some(p => userPermissions.includes(p))
                : requiredPermissions.every(p => userPermissions.includes(p));

            if (!hasPermission) {
                throw new ForbiddenException(
                    `You do not have the required permission(s) to perform this action. Required: ${requiredPermissions.join(', ')} (${mode})`,
                    ErrorCodes.FORBIDDEN
                );
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};