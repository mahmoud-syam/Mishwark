import { NextFunction, Request, Response } from "express";
import { LoginSchema, SignupSchema, OtpRequestSchema, OtpVerifySchema } from "../schemas/auth.schema";
import prismaClient from "../utils/prismaClientHelper";
import { compareSync, hashSync } from "bcrypt";
import { BadRequestsException } from "../exceptions/bad-requests";
import { ErrorCodes } from "../exceptions/root";
import jwt from "jsonwebtoken";
import { generate2FASecret, verify2FAToken } from "../services/two-factor.service";

export const signup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const safePayload = SignupSchema.safeParse(req.body);

        if (!safePayload.success) {
            console.error("Validation errors during signup:", JSON.stringify(safePayload.error.format(), null, 2));
            throw new BadRequestsException("Invalid signup data", ErrorCodes.INVALID_CREDENTIALS, safePayload.error.issues);
        }
        const { name, email, pic, code, password, phoneNumbers } = safePayload.data as any;

        const files = req.files as Express.Multer.File[] | undefined;
        const pictureFile = files?.find(f => f.fieldname === "pic");
        const uploadedPicPath = pictureFile ? `/uploads/employees/${pictureFile.filename}` : pic;

        const existingUser = await prismaClient.users.findFirst({
            where: {
                OR: [
                    { email: email ? email.toLowerCase().trim() : undefined },
                    { code: code ? code.toLowerCase().trim() : undefined }
                ]
            }
        });

        if (existingUser) {
            throw new Error("User with this email or code already exists");
        } else {
            await prismaClient.$transaction(async (prisma) => {
                await prisma.users.create({
                    data: {
                        name,
                        email: email ? email.toLowerCase().trim() : null,
                        password: hashSync(password || "test1234", 10),
                        pic: uploadedPicPath ? uploadedPicPath : undefined,
                        code: code || "",
                        phoneNumbers: phoneNumbers ? {
                            create: phoneNumbers.map((phone: any) => ({
                                number: phone.number
                            }))
                        } : undefined
                    },
                });
            }).catch((error) => {                
                console.error("Error during user creation transaction:", error);
                throw new Error("Failed to create user");
            });

            res.status(201).json({ message: "User created successfully" });
        }

    } catch (error) {
        next(error);
    }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = LoginSchema.parse(req.body);

        const user = await prismaClient.users.findUnique({
            where: {
                email: email.toLowerCase().trim(),
                isDeleted: false
            },
            include: {
                role: {
                    include: {
                        permissions: true
                    }
                },
                phoneNumbers: true
            }
        });

        if (!user || !compareSync(password, user.password)) {
            throw new BadRequestsException("Invalid email or password", ErrorCodes.INVALID_CREDENTIALS);
        }

        // --- MANDATORY 2FA ENFORCEMENT ---
        // If 2FA is NOT enabled, force setup before allowing login.
        if (!user.twoFactorEnabled) {
            const { secret, qrCodeDataURL } = await generate2FASecret(user.email || user.name);
            return res.status(200).json({
                message: "2FA setup required",
                twoFactorSetupRequired: true,
                userId: user.id,
                secret,
                qrCodeDataURL
            });
        }

        // If 2FA is enabled, force verification before allowing login.
        return res.status(200).json({
            message: "2FA required",
            twoFactorRequired: true,
            userId: user.id
        });
    } catch (error) {
        next(error);
    }
}

export const verifyAndEnable2FALogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, token: totpToken, secret } = req.body;

        const user = await prismaClient.users.findUnique({
            where: { id: userId },
            include: {
                role: {
                    include: {
                        permissions: true
                    }
                },
                phoneNumbers: true
            }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }

        const isValid = await verify2FAToken(totpToken, secret);

        if (!isValid) {
            throw new BadRequestsException("Invalid 2FA token", ErrorCodes.INVALID_CREDENTIALS);
        }

        const updatedUser = await prismaClient.users.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret,
                twoFactorEnabled: true,
                tokenVersion: { increment: 1 }
            },
            include: {
                role: {
                    include: {
                        permissions: true
                    }
                },
                phoneNumbers: true
            }
        });

        delete (updatedUser as any).password;
        delete (updatedUser as any).twoFactorSecret;

        const userRole = (updatedUser as any).role;
        const optimizedUser = {
            ...updatedUser,
            tokenVersion: updatedUser.tokenVersion,
            role: userRole ? {
                ...userRole,
                permissions: userRole.permissions ? userRole.permissions.map((p: any) => p.name) : []
            } : null
        };

        const token = jwt.sign({ user: optimizedUser }, process.env.JWT_SECRET as string, { expiresIn: "24h" });

        res.cookie("token", token, {
            httpOnly: false,
            secure: false,
            sameSite: "lax",
            path: "/",
            maxAge: 1000 * 60 * 60 * 24 * 7
        });

        res.status(200).json({ message: "Login successful", user: updatedUser });
    } catch (error) {
        next(error);
    }
};

export const verify2FALogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, token: totpToken } = req.body;

        const updatedUser = await prismaClient.users.update({
            where: { id: userId },
            data: {
                tokenVersion: { increment: 1 }
            },
            include: {
                role: {
                    include: {
                        permissions: true
                    }
                },
                phoneNumbers: true
            }
        });

        if (!updatedUser || !updatedUser.twoFactorSecret) {
            throw new BadRequestsException("User not found or 2FA not enabled", ErrorCodes.USER_NOT_FOUND);
        }

        const isValid = await verify2FAToken(totpToken, updatedUser.twoFactorSecret);

        if (!isValid) {
            throw new BadRequestsException("Invalid 2FA token", ErrorCodes.INVALID_CREDENTIALS);
        }

        delete (updatedUser as any).password;
        delete (updatedUser as any).twoFactorSecret;

        const userRole = (updatedUser as any).role;
        const optimizedUser = {
            ...updatedUser,
            tokenVersion: (updatedUser as any).tokenVersion,
            role: userRole ? {
                ...userRole,
                permissions: userRole.permissions ? userRole.permissions.map((p: any) => p.name) : []
            } : null
        };

        const token = jwt.sign({ user: optimizedUser }, process.env.JWT_SECRET as string, { expiresIn: "24h" });

        res.cookie("token", token, {
            httpOnly: false,
            secure: false,
            sameSite: "lax",
            path: "/",
            maxAge: 1000 * 60 * 60 * 24 * 7
        });

        res.status(200).json({ message: "Login successful", optimizedUser });
    } catch (error) {
        next(error);
    }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.clearCookie("token");
        res.status(200).json({ message: "Logout successful" });
    } catch (error) {
        next(error);
    }
}

export const logoutAllDevices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req.user as any).id;
        
        await prismaClient.users.update({
            where: { id: userId },
            data: {
                tokenVersion: { increment: 1 }
            }
        });

        res.clearCookie("token");
        res.status(200).json({ message: "Successfully logged out from all devices" });
    } catch (error) {
        next(error);
    }
}

export const reset2FAOnly = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params as { userId: string };
        await prismaClient.users.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: "",
                tokenVersion: { increment: 1 } // Invalidate current session as security measure
            }
        });
        res.status(200).json({ message: "Two-factor authentication has been reset successfully" });
    } catch (error) {
        next(error);
    }
}

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params as { userId: string };
        const { newPassword, reset2FA } = req.body as { newPassword: string, reset2FA?: boolean };
        const user = await prismaClient.users.findUnique({
            where: {
                id: userId
            }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }

        await prismaClient.users.update({
            where: {
                id: userId
            },
            data: {
                password: hashSync(newPassword, 10),
                tokenVersion: { increment: 1 },
                ...(reset2FA ? {
                    twoFactorEnabled: false,
                    twoFactorSecret: ""
                } : {})
            }
        });

        if ((req.user as any).id === userId) {
            res.clearCookie("token");
        }

        res.status(200).json({ message: `Password changed successfully${reset2FA ? " and 2FA reset" : ""}` });
    } catch (error) {
        next(error);
    }
}

export const otpRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phoneNumber } = OtpRequestSchema.parse(req.body);

        let user = await prismaClient.users.findUnique({
            where: { phoneNumber }
        });

        const otpCode = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit code

        if (!user) {
            // Find or create customer role
            let role = await prismaClient.role.findUnique({ where: { name: "Customer" } });
            if (!role) {
                role = await prismaClient.role.create({ data: { name: "Customer", description: "Default customer role" } });
            }

            user = await prismaClient.users.create({
                data: {
                    phoneNumber,
                    name: "Customer", // default
                    email: null,
                    otpCode,
                    roleId: role.id
                }
            });
        } else {
            user = await prismaClient.users.update({
                where: { id: user.id },
                data: { otpCode }
            });
        }

        // In a real app, send SMS here. For now, we return it in dev.
        res.status(200).json({ message: "OTP sent successfully", dev_otp: otpCode });
    } catch (error) {
        next(error);
    }
};

export const otpVerify = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phoneNumber, code } = OtpVerifySchema.parse(req.body);

        const user = await prismaClient.users.findUnique({
            where: { phoneNumber },
            include: { role: true }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }

        if (user.otpCode !== code && code !== "0000") { // 0000 as universal bypass for testing
            throw new BadRequestsException("Invalid OTP code", ErrorCodes.INVALID_CREDENTIALS);
        }

        const updatedUser = await prismaClient.users.update({
            where: { id: user.id },
            data: {
                otpVerified: true,
                otpCode: null,
                tokenVersion: { increment: 1 }
            },
            include: { role: { include: { permissions: true } } }
        });

        const token = jwt.sign({ user: updatedUser }, process.env.JWT_SECRET || "default_secret", { expiresIn: "24h" });

        res.cookie("token", token, {
            httpOnly: false,
            secure: false,
            sameSite: "lax",
            path: "/",
            maxAge: 1000 * 60 * 60 * 24 * 7
        });

        res.status(200).json({
            message: "OTP verified successfully",
            token,
            role: updatedUser.role?.name || "customer",
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
};
