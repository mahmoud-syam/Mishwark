import { Request, Response, NextFunction } from 'express';
import prismaClient from '../utils/prismaClientHelper';
import { generate2FASecret, verify2FAToken } from '../services/two-factor.service';
import { BadRequestsException } from '../exceptions/bad-requests';
import { ErrorCodes } from '../exceptions/root';

export const setup2FA = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        const { secret, qrCodeDataURL } = await generate2FASecret(user.email);

        // Store temporary secret in user (or just return it for confirmation)
        // For security, we don't enable it until verified
        res.status(200).json({ secret, qrCodeDataURL });
    } catch (error) {
        next(error);
    }
};

export const verifyAndEnable2FA = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token, secret } = req.body ?? {};
        const userId = (req as any).user.id;

        // otplib throws on an empty secret; without this guard the client got a
        // 500 for what is a plain bad request.
        if (!token || !secret) {
            throw new BadRequestsException("token and secret are required", ErrorCodes.UNPROCESSABLE_ENTITY);
        }

        const isValid = await verify2FAToken(token, secret);

        if (!isValid) {
            throw new BadRequestsException("Invalid 2FA token", ErrorCodes.INVALID_CREDENTIALS);
        }

        await prismaClient.users.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret,
                twoFactorEnabled: true
            }
        });

        res.status(200).json({ message: "2FA enabled successfully" });
    } catch (error) {
        next(error);
    }
};

export const disable2FA = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        // Needs a current code: a stolen session alone must not switch 2FA off.
        const { token } = req.body ?? {};
        const user = await prismaClient.users.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorEnabled: true } });
        if (user?.twoFactorEnabled) {
            if (typeof token !== "string" || !user.twoFactorSecret || !(await verify2FAToken(token, user.twoFactorSecret))) {
                throw new BadRequestsException("Enter the current 6-digit code to turn 2FA off", ErrorCodes.INVALID_CREDENTIALS);
            }
        }

        await prismaClient.users.update({
            where: { id: userId },
            data: {
                twoFactorSecret: "",
                twoFactorEnabled: false
            }
        });

        res.status(200).json({ message: "2FA disabled successfully" });
    } catch (error) {
        next(error);
    }
};
