import jwt from "jsonwebtoken";
import { BadRequestException } from "../utils/errors";

/**
 * A short-lived pass that links the steps of an email sign-in together.
 *
 * `POST /auth/login` checks the password and hands out a `loginToken` for the
 * next step only: changing a temporary password, setting up 2FA, or entering
 * the 2FA code. The later steps used to accept a bare `userId` (and, for 2FA
 * setup, a secret chosen by the caller), so anyone who knew an account's id
 * could attach their own authenticator to it and sign in without the password.
 *
 * The pass is signed with a key derived from JWT_SECRET (so it can never be
 * used as a session token), expires after 5 minutes, and carries the account's
 * tokenVersion: completing a step bumps the version, which makes the pass
 * single-use.
 */
export type LoginStep = "set-password" | "2fa-setup" | "2fa";

interface TicketPayload {
  sub: string;
  step: LoginStep;
  tv: number;
  /** The 2FA secret being set up (the user already sees it to scan the QR). */
  secret?: string;
}

const TTL_SECONDS = 5 * 60;
const AUDIENCE = "mishwark-login";
const key = () => `${process.env.JWT_SECRET as string}:login-ticket`;

export const issueLoginTicket = (userId: string, step: LoginStep, tokenVersion: number, secret?: string) =>
  jwt.sign({ step, tv: tokenVersion, ...(secret && { secret }) }, key(), { subject: userId, audience: AUDIENCE, expiresIn: TTL_SECONDS });

/** Returns the pass's content, or throws 400 asking to sign in again. */
export const readLoginTicket = (token: unknown, step: LoginStep): TicketPayload => {
  if (typeof token !== "string" || !token) {
    throw new BadRequestException("Sign in again: loginToken is required");
  }
  let payload: TicketPayload;
  try {
    payload = jwt.verify(token, key(), { audience: AUDIENCE }) as TicketPayload;
  } catch {
    throw new BadRequestException("Your sign-in expired. Sign in again");
  }
  if (payload.step !== step) {
    throw new BadRequestException("Sign in again: this step doesn't match your sign-in");
  }
  return payload;
};
