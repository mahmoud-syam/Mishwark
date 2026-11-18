import type { CookieOptions } from "express";

/**
 * Options for the `token` auth cookie used by the web dashboard.
 *
 * - httpOnly: the dashboard never reads the cookie from JavaScript (it calls
 *   /auth/me), so scripts on the page can't steal the token.
 * - secure: on in production (HTTPS only). COOKIE_SECURE=true|false overrides
 *   it, e.g. for a staging server that runs over plain HTTP.
 * - maxAge matches the JWT lifetime (24h), so the browser drops the cookie
 *   when the token inside it expires.
 *
 * The mobile apps get the token in the JSON body and send it as a Bearer
 * header, so these flags don't affect them.
 */
export const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

const isSecure = (): boolean => {
    const override = process.env.COOKIE_SECURE;
    if (override === "true") return true;
    if (override === "false") return false;
    return process.env.NODE_ENV === "production";
};

const baseOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
});

export const authCookieOptions = (ttlMs: number = TOKEN_TTL_MS): CookieOptions => ({ ...baseOptions(), maxAge: ttlMs });

/**
 * Customers and drivers (OTP sign-in in the apps) stay signed in for
 * APP_SESSION_DAYS (default 30): asking for an SMS code every day drives
 * people away. Logout, a new sign-in or a disabled account still end the
 * session at once (tokenVersion). Dashboard accounts keep 24 hours.
 */
export const appSessionDays = (): number => {
    const n = Number(process.env.APP_SESSION_DAYS);
    return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : 30;
};

/** Must match the options the cookie was set with, or browsers keep it. */
export const clearAuthCookieOptions = (): CookieOptions => baseOptions();
