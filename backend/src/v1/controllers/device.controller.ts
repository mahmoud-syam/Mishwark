import { Request, Response } from "express";
import { z } from "zod";
import prismaClient from "../utils/prismaClientHelper";
import { DevicePlatform } from "../../../generated/prisma";

const MAX_DEVICES_PER_USER = 10;

const registerSchema = z.object({
  token: z.string().trim().min(20, "token looks too short").max(4096),
  platform: z.enum(["android", "ios", "web", "ANDROID", "IOS", "WEB"]).transform((p) => p.toUpperCase() as DevicePlatform),
  appVersion: z.string().trim().max(40).optional(),
});
const tokenSchema = z.object({ token: z.string().trim().min(1).max(4096) });

/**
 * POST /devices: the app registers its Firebase token after sign-in and
 * whenever Firebase gives it a new one. A token belongs to one account: if the
 * phone signs in as someone else, it moves to that account.
 */
export const registerDevice = async (req: Request, res: Response) => {
  const { token, platform, appVersion } = registerSchema.parse(req.body ?? {});
  const userId = req.user!.id;
  const device = await prismaClient.deviceTokens.upsert({
    where: { token },
    create: { token, platform, appVersion, userId },
    update: { platform, appVersion, userId, lastSeenAt: new Date() },
    select: { id: true, platform: true, appVersion: true, lastSeenAt: true, createdAt: true },
  });
  // Keep the newest few per account (old phones that never said goodbye).
  const extra = await prismaClient.deviceTokens.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, skip: MAX_DEVICES_PER_USER, select: { id: true } });
  if (extra.length) await prismaClient.deviceTokens.deleteMany({ where: { id: { in: extra.map((d) => d.id) } } });
  res.status(201).json({ success: true, data: device });
};

/** DELETE /devices: stop pushing to this phone (body or ?token=). Only your own tokens. */
export const removeDevice = async (req: Request, res: Response) => {
  const { token } = tokenSchema.parse({ token: req.body?.token ?? req.query.token });
  const r = await prismaClient.deviceTokens.deleteMany({ where: { token, userId: req.user!.id } });
  res.json({ success: true, data: { removed: r.count } });
};

/** GET /devices: the account's registered phones (no tokens shown). */
export const listDevices = async (req: Request, res: Response) => {
  const devices = await prismaClient.deviceTokens.findMany({
    where: { userId: req.user!.id },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, platform: true, appVersion: true, lastSeenAt: true, createdAt: true },
  });
  res.json({ success: true, data: devices });
};
