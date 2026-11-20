import { NextFunction, Request, Response } from "express";

/**
 * Last line of defence: these columns never leave the server, whatever a
 * handler happens to return. Handlers should select only what they need; this
 * catches the day one forgets (a cancel used to return the customer's full row,
 * password hash and 2FA secret included).
 *
 * `temporaryPassword` (shown once to the super admin) and the 2FA setup's
 * `secret` are different keys and pass through on purpose.
 */
export const SECRET_KEYS = new Set([
  "password",
  "otpCode",
  "otpAttempts",
  "otpExpiresAt",
  "otpSentAt",
  "twoFactorSecret",
  "tokenVersion",
]);

export const stripSecrets = (value: unknown, depth = 0): unknown => {
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
  // Leave Dates, Buffers and other class instances alone; only plain objects are walked.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
};

export const stripSecretsMiddleware = (_req: Request, res: Response, next: NextFunction) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(stripSecrets(body))) as Response["json"];
  next();
};
