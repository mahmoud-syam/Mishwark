import { NextFunction, Request, Response } from "express";
import { LoginSchema, SignupSchema, OtpRequestSchema, OtpVerifySchema, NewPasswordSchema, PasswordRule } from "../schemas/auth.schema";
import { issueLoginTicket, readLoginTicket } from "../services/login-ticket.service";
import SignInGuard from "../services/sign-in-guard.service";
import prismaClient from "../utils/prismaClientHelper";
import { compareSync, hashSync } from "bcrypt";
import { BadRequestsException } from "../exceptions/bad-requests";
import { ConflictException } from "../utils/errors";
import { ErrorCodes } from "../exceptions/root";
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import SmsService from "../services/sms.service";
import SettingsService from "../services/settings.service";
import { ReferralStatus } from "../../../generated/prisma";
import { authCookieOptions, clearAuthCookieOptions } from "../utils/authCookie";

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES ?? 5);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS ?? 60);
import { generate2FASecret, verify2FAToken } from "../services/two-factor.service";
import { buildTokenUser, findOrCreateRole } from "../services/role.service";
import { isAdminRole, isSuperAdminRole, normalizeRoleName, USER_ROLES } from "../constants/roles";
import { ForbiddenException } from "../utils/errors";
import { z } from "zod";

export const signup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const safePayload = SignupSchema.safeParse(req.body);

        if (!safePayload.success) {
            throw new BadRequestsException("Invalid signup data", ErrorCodes.INVALID_CREDENTIALS, safePayload.error.issues);
        }
        const {
            name,
            email,
            pic,
            code,
            password,
            phoneNumbers,
            role,
            referralCode,
            licenseNumber,
            licenseExpiry,
        } = safePayload.data;

        const files = req.files as Express.Multer.File[] | undefined;
        const pictureFile = files?.find(f => f.fieldname === "pic");
        const uploadedPicPath = pictureFile ? `/uploads/employees/${pictureFile.filename}` : pic;

        const normalizedEmail = email.toLowerCase().trim();
        const normalizedCode = code?.trim() || null;

        // The unique scalar column that OTP login looks users up by. Previously
        // only the PhoneNumbers relation was written, so signup users could never
        // log in again via OTP and got a duplicate user row instead.
        const phoneNumbersList = (phoneNumbers ?? []).map(p => p.number.trim());
        const primaryPhoneNumber = phoneNumbersList[0] ?? null;

        const orFilters: Record<string, string>[] = [{ email: normalizedEmail }];
        if (primaryPhoneNumber) orFilters.push({ phoneNumber: primaryPhoneNumber });
        if (normalizedCode) orFilters.push({ code: normalizedCode });

        const existingUser = await prismaClient.users.findFirst({
            where: { OR: orFilters },
            select: { id: true },
        });

        if (existingUser) {
            throw new ConflictException("User with this email, phone number or code already exists", ErrorCodes.USER_ALREADY_EXISTS);
        }

        // Users.referralCode is the code this account shares and is @unique, so
        // the incoming code must resolve to the referrer's id rather than being
        // copied onto the new row - that would collide with the referrer.
        let referredById: string | null = null;
        if (referralCode) {
            const referrer = await prismaClient.users.findUnique({
                where: { referralCode },
                select: { id: true },
            });
            if (!referrer) {
                throw new BadRequestsException("Invalid referral code", ErrorCodes.INVALID_CREDENTIALS);
            }
            referredById = referrer.id;
        }

        // The role flag. Self-signup is limited to CUSTOMER and DRIVER by the
        // schema; admin roles can only be granted through PATCH /admin/users/role.
        const requestedRole = normalizeRoleName(role) ?? USER_ROLES.CUSTOMER;
        const roleRecord = await findOrCreateRole(requestedRole);

        const user = await prismaClient.$transaction(async (prisma) => {
            const createdUser = await prisma.users.create({
                data: {
                    name,
                    email: normalizedEmail,
                    password: hashSync(password, 10),
                    pic: uploadedPicPath ? uploadedPicPath : undefined,
                    code: normalizedCode ?? "",
                    roleId: roleRecord.id,
                    phoneNumber: primaryPhoneNumber,
                    referredById,
                    phoneNumbers: phoneNumbersList.length
                        ? {
                            create: phoneNumbersList.map((number) => ({ number })),
                        }
                        : undefined,
                },
                select: { id: true, name: true, email: true },
            });

            // A driver needs a Drivers row: Bookings.driverId and
            // Conversations.driverId both reference Drivers.id, so a user with
            // the Driver role but no profile 404s on every /driver/* endpoint.
            if (requestedRole === USER_ROLES.DRIVER) {
                await prisma.drivers.create({
                    data: {
                        userId: createdUser.id,
                        commissionRate: (await SettingsService.get()).defaultCommissionRate,
                        fullName: name,
                        licenseNumber: licenseNumber ?? "",
                        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
                        pic: uploadedPicPath ? uploadedPicPath : "",
                        phoneNumbers: phoneNumbersList.length
                            ? {
                                create: phoneNumbersList.map((number) => ({ number })),
                            }
                            : undefined,
                    },
                });
            }

            // Signing up with a code used to set referredById only, so no
            // Referrals row existed and the referrer was never rewarded.
            if (referredById && referralCode) {
                await prisma.referrals.create({
                    data: {
                        referrerId: referredById,
                        referredId: createdUser.id,
                        referralCode,
                        status: ReferralStatus.PENDING,
                        rewardAmount: (await SettingsService.get()).referralRewardAmount,
                    },
                });
            }

            return createdUser;
        });

        res.status(201).json({
            message: "User created successfully",
            user: { ...user, role: requestedRole },
        });

    } catch (error) {
        next(error);
    }
}

const withRole = { role: { include: { permissions: true } }, phoneNumbers: true } as const;

/**
 * What comes after the password: changing a temporary password, setting up
 * 2FA (mandatory), or entering the 2FA code. Every step carries a signed,
 * short-lived `loginToken` (see login-ticket.service).
 */
const nextSignInStep = async (user: { id: string; email: string | null; name: string; tokenVersion: number; twoFactorEnabled: boolean; mustChangePassword: boolean }) => {
    if (user.mustChangePassword) {
        return {
            message: "Choose a new password",
            passwordChangeRequired: true,
            userId: user.id,
            loginToken: issueLoginTicket(user.id, "set-password", user.tokenVersion),
        };
    }
    if (!user.twoFactorEnabled) {
        const { secret, qrCodeDataURL } = await generate2FASecret(user.email || user.name);
        return {
            message: "2FA setup required",
            twoFactorSetupRequired: true,
            userId: user.id,
            secret,
            qrCodeDataURL,
            loginToken: issueLoginTicket(user.id, "2fa-setup", user.tokenVersion, secret),
        };
    }
    return {
        message: "2FA required",
        twoFactorRequired: true,
        userId: user.id,
        loginToken: issueLoginTicket(user.id, "2fa", user.tokenVersion),
    };
};

/** Finds the account a pass belongs to; the pass is void once the account changed. */
const ticketUser = async (userId: string, tokenVersion: number) => {
    const user = await prismaClient.users.findUnique({ where: { id: userId }, include: withRole });
    if (!user || user.isDeleted || user.disabledAt || user.tokenVersion !== tokenVersion) {
        throw new BadRequestsException("Your sign-in expired. Sign in again", ErrorCodes.INVALID_CREDENTIALS);
    }
    return user;
};

/** Ends a successful sign-in: new session cookie, previous sessions signed out. */
const completeSignIn = async (res: Response, userId: string, data: { twoFactorSecret?: string; twoFactorEnabled?: boolean } = {}) => {
    const updatedUser = await prismaClient.users.update({
        where: { id: userId },
        data: { ...data, tokenVersion: { increment: 1 }, lastLoginAt: new Date() },
        include: withRole,
    });
    delete (updatedUser as any).password;
    delete (updatedUser as any).twoFactorSecret;
    const optimizedUser = buildTokenUser(updatedUser);
    const token = jwt.sign({ user: optimizedUser }, process.env.JWT_SECRET as string, { expiresIn: "24h" });
    res.cookie("token", token, authCookieOptions());
    // `optimizedUser` kept for clients written against the old verify-2fa reply.
    res.status(200).json({ message: "Login successful", user: optimizedUser, optimizedUser });
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = LoginSchema.parse(req.body);
        SignInGuard.check(req, email);

        const user = await prismaClient.users.findUnique({
            where: {
                email: email.toLowerCase().trim(),
                isDeleted: false
            }
        });

        if (!user || !compareSync(password, user.password)) {
            SignInGuard.fail(req, email);
            throw new BadRequestsException("Invalid email or password", ErrorCodes.INVALID_CREDENTIALS);
        }
        if (user.disabledAt) {
            throw new ForbiddenException("This account is disabled. Contact your Super Admin");
        }
        SignInGuard.succeed(req, email);

        // Mandatory: a temporary password is replaced, then 2FA is set up or checked.
        return res.status(200).json(await nextSignInStep(user));
    } catch (error) {
        next(error);
    }
}

/** Step after a temporary password: the user picks their own. */
export const setPasswordLogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loginToken, newPassword } = NewPasswordSchema.parse(req.body ?? {});
        const ticket = readLoginTicket(loginToken, "set-password");
        const user = await ticketUser(ticket.sub, ticket.tv);
        if (compareSync(newPassword, user.password)) {
            throw new BadRequestsException("Choose a password different from the temporary one", ErrorCodes.UNPROCESSABLE_ENTITY);
        }
        const updated = await prismaClient.users.update({
            where: { id: user.id },
            data: { password: hashSync(newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
        });
        return res.status(200).json(await nextSignInStep(updated));
    } catch (error) {
        next(error);
    }
};

/** First 2FA setup during sign-in. The secret comes from the signed pass, never from the caller. */
export const verifyAndEnable2FALogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loginToken, token: totpToken } = req.body ?? {};
        const ticket = readLoginTicket(loginToken, "2fa-setup");
        const user = await ticketUser(ticket.sub, ticket.tv);

        if (user.twoFactorEnabled || !ticket.secret) {
            throw new BadRequestsException("Your sign-in expired. Sign in again", ErrorCodes.INVALID_CREDENTIALS);
        }
        const account = user.email ?? user.id;
        SignInGuard.check(req, account);
        if (typeof totpToken !== "string" || !(await verify2FAToken(totpToken, ticket.secret))) {
            SignInGuard.fail(req, account);
            throw new BadRequestsException("Invalid 2FA token", ErrorCodes.INVALID_CREDENTIALS);
        }
        SignInGuard.succeed(req, account);

        await completeSignIn(res, user.id, { twoFactorSecret: ticket.secret, twoFactorEnabled: true });
    } catch (error) {
        next(error);
    }
};

export const verify2FALogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { loginToken, token: totpToken } = req.body ?? {};
        const ticket = readLoginTicket(loginToken, "2fa");
        const user = await ticketUser(ticket.sub, ticket.tv);

        if (!user.twoFactorEnabled || !user.twoFactorSecret) {
            throw new BadRequestsException("Your sign-in expired. Sign in again", ErrorCodes.INVALID_CREDENTIALS);
        }
        // A wrong code changes nothing (live sessions stay signed in), but counts as a wrong attempt.
        const account = user.email ?? user.id;
        SignInGuard.check(req, account);
        if (typeof totpToken !== "string" || !(await verify2FAToken(totpToken, user.twoFactorSecret))) {
            SignInGuard.fail(req, account);
            throw new BadRequestsException("Invalid 2FA token", ErrorCodes.INVALID_CREDENTIALS);
        }
        SignInGuard.succeed(req, account);

        await completeSignIn(res, user.id);
    } catch (error) {
        next(error);
    }
};

/** The signed-in user, as resolved by authMiddleware (role re-read from the DB). */
export const me = async (req: Request, res: Response) => {
    const u = req.user!;
    res.status(200).json({
        id: u.id,
        name: u.name,
        email: u.email,
        phoneNumber: u.phoneNumber,
        role: u.role,
    });
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.clearCookie("token", clearAuthCookieOptions());
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

        res.clearCookie("token", clearAuthCookieOptions());
        res.status(200).json({ message: "Successfully logged out from all devices" });
    } catch (error) {
        next(error);
    }
}

const AdminPasswordSchema = z.object({ newPassword: PasswordRule, reset2FA: z.boolean().optional() });

/**
 * Dashboard accounts (Admin, Super Admin) are reset by a Super Admin only, from
 * the Team page. These older endpoints let anyone holding user_password:manage
 * reset any account, the Super Admin's included.
 */
const guardTeamAccount = (req: Request, targetRole: string | undefined) => {
    if (isAdminRole(targetRole) && !isSuperAdminRole(req.user?.role?.name)) {
        throw new ForbiddenException("Only a Super Admin can reset a dashboard account");
    }
};

export const reset2FAOnly = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params as { userId: string };

        // Check first: updating a missing id raised a raw Prisma error (500).
        const user = await prismaClient.users.findUnique({
            where: { id: userId },
            select: { id: true, role: { select: { name: true } } }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }
        guardTeamAccount(req, user.role?.name);

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
        const { newPassword, reset2FA } = AdminPasswordSchema.parse(req.body ?? {});
        const user = await prismaClient.users.findUnique({
            where: {
                id: userId
            },
            include: { role: { select: { name: true } } }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }
        guardTeamAccount(req, user.role?.name);

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
            res.clearCookie("token", clearAuthCookieOptions());
        }

        res.status(200).json({ message: `Password changed successfully${reset2FA ? " and 2FA reset" : ""}` });
    } catch (error) {
        next(error);
    }
}

export const otpRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phoneNumber, role, name, licenseNumber } = OtpRequestSchema.parse(req.body);

        const existingUser = await prismaClient.users.findUnique({
            where: { phoneNumber },
            select: { id: true, otpSentAt: true },
        });

        if (existingUser?.otpSentAt && Date.now() - existingUser.otpSentAt.getTime() < OTP_RESEND_SECONDS * 1000) {
            return res.status(429).json({
                message: `Please wait ${OTP_RESEND_SECONDS} seconds before requesting a new code`,
                errorCode: ErrorCodes.INVALID_CREDENTIALS,
                errors: null,
            });
        }

        // 4 digits to match the app's OTP screen; crypto RNG, expiry, attempt cap
        // and resend throttle make it safe to deliver by SMS.
        const otpCode = randomInt(1000, 10000).toString();
        const now = new Date();
        const otpFields = {
            otpCode,
            otpExpiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
            otpAttempts: 0,
            otpSentAt: now,
        };

        let userId: string;

        if (!existingUser) {
            const requestedRole = normalizeRoleName(role) ?? USER_ROLES.CUSTOMER;
            const roleRecord = await findOrCreateRole(requestedRole);

            if (requestedRole === USER_ROLES.DRIVER && !licenseNumber) {
                throw new BadRequestsException("licenseNumber is required when registering as a driver", ErrorCodes.INVALID_CREDENTIALS);
            }

            const created = await prismaClient.$transaction(async (prisma) => {
                const createdUser = await prisma.users.create({
                    data: {
                        phoneNumber,
                        name: name ?? phoneNumber,
                        email: null,
                        ...otpFields,
                        roleId: roleRecord.id,
                        phoneNumbers: { create: [{ number: phoneNumber }] },
                    },
                    select: { id: true, name: true, phoneNumber: true },
                });

                if (requestedRole === USER_ROLES.DRIVER) {
                    await prisma.drivers.create({
                        data: {
                            userId: createdUser.id,
                            commissionRate: (await SettingsService.get()).defaultCommissionRate,
                            fullName: createdUser.name,
                            licenseNumber: licenseNumber ?? "",
                            pic: "",
                            phoneNumbers: { create: [{ number: phoneNumber }] },
                        },
                    });
                }

                return createdUser;
            });

            userId = created.id;
        } else {
            await prismaClient.users.update({
                where: { id: existingUser.id },
                data: otpFields
            });

            userId = existingUser.id;
        }

        // With an SMS provider configured the code only travels by SMS. Without
        // one (local dev) it is returned as dev_otp so the apps keep working.
        try {
            await SmsService.send(phoneNumber, `كود الدخول لمشوارك: ${otpCode}\nصالح لمدة ${OTP_TTL_MINUTES} دقائق. متشاركوش مع حد.`);
        } catch (err) {
            console.error("[sms] OTP delivery failed", err);
            // Let the user retry right away instead of waiting out the throttle.
            await prismaClient.users.update({ where: { id: userId }, data: { otpSentAt: null } });
            return res.status(502).json({ message: "Couldn't send the SMS. Please try again.", errorCode: ErrorCodes.INTERNAL_EXCEPTION, errors: null });
        }
        res.status(200).json({
            message: "OTP sent successfully",
            userId,
            ...(!SmsService.isConfigured() && { dev_otp: otpCode }),
        });
    } catch (error) {
        next(error);
    }
};

export const otpVerify = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phoneNumber, code } = OtpVerifySchema.parse(req.body);
        SignInGuard.check(req, phoneNumber);

        const user = await prismaClient.users.findUnique({
            where: { phoneNumber },
            include: { role: true }
        });

        if (!user) {
            throw new BadRequestsException("User not found", ErrorCodes.USER_NOT_FOUND);
        }

        // "0000" is a testing bypass. It must never work in production, where it
        // would let anyone sign in as any phone number. Set OTP_TEST_BYPASS=true
        // to keep it on a non-production server used by the app testers.
        const bypassAllowed = process.env.NODE_ENV !== "production" || process.env.OTP_TEST_BYPASS === "true";
        const isBypass = bypassAllowed && code === "0000";
        if (!isBypass) {
            const expired = !user.otpCode || !user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now();
            if (expired || user.otpAttempts >= OTP_MAX_ATTEMPTS) {
                throw new BadRequestsException("OTP code expired. Request a new one.", ErrorCodes.INVALID_CREDENTIALS);
            }
            if (user.otpCode !== code) {
                // Count the miss; after OTP_MAX_ATTEMPTS the code is dead.
                await prismaClient.users.update({ where: { id: user.id }, data: { otpAttempts: { increment: 1 } } });
                SignInGuard.fail(req, phoneNumber);
                throw new BadRequestsException("Invalid OTP code", ErrorCodes.INVALID_CREDENTIALS);
            }
        }
        if (user.disabledAt) {
            throw new ForbiddenException("This account is disabled. Contact your Super Admin");
        }
        SignInGuard.succeed(req, phoneNumber);

        const updatedUser = await prismaClient.users.update({
            where: { id: user.id },
            data: {
                otpVerified: true,
                otpCode: null,
                otpExpiresAt: null,
                otpAttempts: 0,
                tokenVersion: { increment: 1 }
            },
            include: { role: { include: { permissions: true } } }
        });

        // Flatten permissions to names so requirePermission does not receive
        // raw Prisma Permission objects.
        const tokenUser = buildTokenUser(updatedUser);
        const token = jwt.sign({ user: tokenUser }, process.env.JWT_SECRET as string, { expiresIn: "24h" });

        res.cookie("token", token, authCookieOptions());

        res.status(200).json({
            message: "OTP verified successfully",
            token,
            role: tokenUser.role?.name ?? null,
            user: tokenUser
        });
    } catch (error) {
        next(error);
    }
};
