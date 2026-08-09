/// <reference path="../types/express/index.d.ts" />
import { ErrorCodes } from "../exceptions/root";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../secrets";
import { UnauthorizedException } from "../exceptions/unauthorized";
import { Users } from "../../../generated/prisma/client";
import prismaClient from "../utils/prismaClientHelper";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            throw new UnauthorizedException("Unauthorized", ErrorCodes.UNAUTHORIZED);
        }
        const decodedToken = jwt.verify(token, JWT_SECRET) as any;
        
        const user = await prismaClient.users.findUnique({
            where: { id: decodedToken.user.id },
            select: { id: true, email: true, tokenVersion: true }
        });

        if (!user || user.tokenVersion !== decodedToken.user.tokenVersion) {
            throw new UnauthorizedException("Session invalidated. Please login again.", ErrorCodes.UNAUTHORIZED);
        }

        req.user = decodedToken.user;
        next();
    } catch (error) {
        next(error);
    }
}