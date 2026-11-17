/// <reference path="../types/express/index.d.ts" />
import { ErrorCodes } from "../exceptions/root";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../secrets";
import { UnauthorizedException } from "../exceptions/unauthorized";
import prismaClient from "../utils/prismaClientHelper";
import { normalizePermissions } from "../constants/roles";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        let token = req.cookies.token;

        if (!token && authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.slice(7);
        }

        if (!token) {
            throw new UnauthorizedException("Unauthorized", ErrorCodes.UNAUTHORIZED);
        }
        let decodedToken: any;
        try {
            decodedToken = jwt.verify(token, JWT_SECRET) as any;
        } catch (err) {
            // jsonwebtoken throws a bare JsonWebTokenError/TokenExpiredError.
            // Without this the error reaches the error middleware with no
            // statusCode and the client gets a 500 for what is a 401.
            const expired = err instanceof jwt.TokenExpiredError;
            throw new UnauthorizedException(
                expired ? "Token expired. Please login again." : "Invalid token",
                ErrorCodes.UNAUTHORIZED
            );
        }

        if (!decodedToken?.user?.id) {
            throw new UnauthorizedException("Invalid token", ErrorCodes.UNAUTHORIZED);
        }

        // The role is re-read from the database rather than trusted from the JWT
        // payload, so a role change via PATCH /admin/users/role takes effect
        // immediately instead of waiting for the token to expire. tokenVersion is
        // still compared against the claim to invalidate revoked sessions.
        const user = await prismaClient.users.findUnique({
            where: { id: decodedToken.user?.id },
            select: {
                id: true,
                name: true,
                email: true,
                phoneNumber: true,
                isDeleted: true,
                disabledAt: true,
                tokenVersion: true,
                role: {
                    select: {
                        id: true,
                        name: true,
                        permissions: { select: { name: true } },
                    },
                },
            },
        });

        if (!user || user.isDeleted || user.disabledAt || user.tokenVersion !== decodedToken.user.tokenVersion) {
            throw new UnauthorizedException("Session invalidated. Please login again.", ErrorCodes.UNAUTHORIZED);
        }

        req.user = {
            ...user,
            role: user.role
                ? {
                    id: user.role.id,
                    name: user.role.name,
                    permissions: normalizePermissions(user.role.permissions),
                }
                : null,
        } as typeof req.user;

        next();
    } catch (error) {
        next(error);
    }
}
/**
 * For public endpoints that answer better when they know the caller (the price
 * estimate applies the caller's own discounts). A valid token sets req.user
 * exactly like authMiddleware; a missing or bad token just leaves the request
 * anonymous instead of failing.
 */
export const optionalAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const hasToken = !!req.cookies?.token || (req.headers.authorization ?? "").startsWith("Bearer ");
    if (!hasToken) return next();
    await authMiddleware(req, res, (err?: unknown) => {
        if (err) req.user = undefined as any;
        next();
    });
};
