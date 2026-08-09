import { NextFunction, Request, Response } from "express";
import { ErrorCodes } from "../exceptions/root";
import { ForbiddenException } from "../exceptions/forbidden";

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

            // Super Admins bypass all permission checks
            // const isAdmin = user.isAdmin === true || user.role?.name?.toLowerCase() === "super admin";
            // if (isAdmin) {
            //     return next();
            // }

            const userPermissions = (user.role?.permissions || []).map(p => p.toLowerCase());
            const requiredPermissions = Array.isArray(permissionNames) 
                ? permissionNames.map(p => p.toLowerCase()) 
                : [permissionNames.toLowerCase()];
            
            let hasPermission = false;

            if (mode === 'any') {
                hasPermission = requiredPermissions.some(p => userPermissions.includes(p));
            } else {
                hasPermission = requiredPermissions.every(p => userPermissions.includes(p));
            }

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
