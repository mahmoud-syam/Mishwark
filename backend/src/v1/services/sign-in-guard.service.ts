import { Request } from "express";
import { HttpException } from "../exceptions/root";

/**
 * Stops password and code guessing at sign-in.
 *
 * Wrong attempts are counted per device (IP address) AND account: after 5
 * wrong passwords or codes for one account within 15 minutes, that device is
 * blocked from that account for 15 minutes. The real owner signing in from
 * their own device is not affected, so nobody can lock someone else out by
 * typing a wrong password on purpose. A device that fails across many accounts
 * (password spraying) is blocked from signing in altogether.
 *
 * Kept in memory: right for one API instance. Several instances behind a load
 * balancer would need a shared store (Redis).
 */
export const MAX_FAILURES = 5;
export const MAX_DEVICE_FAILURES = 30;
export const WINDOW_MS = 15 * 60 * 1000;
export const BLOCK_MS = 15 * 60 * 1000;

type Entry = { count: number; since: number; blockedUntil: number };
const entries = new Map<string, Entry>();

export class TooManyAttemptsException extends HttpException {
  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(`Too many wrong attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}`, 4290, 429, { retryAfterSeconds });
  }
}

const now = () => Date.now();
const fresh = (key: string) => {
  const e = entries.get(key);
  if (!e) return undefined;
  if (e.blockedUntil <= now() && now() - e.since > WINDOW_MS) {
    entries.delete(key);
    return undefined;
  }
  return e;
};

/** The client's address. Behind Cloudflare or a proxy, set TRUST_PROXY so Express reads it from the forwarded headers. */
export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || "unknown";

const keys = (req: Request, account: string) => {
  const ip = clientIp(req);
  return { pair: `pair|${ip}|${account.trim().toLowerCase()}`, device: `device|${ip}` };
};

export default class SignInGuard {
  /** Throws 429 if this device is blocked for this account (or blocked altogether). */
  public static check(req: Request, account: string) {
    const { pair, device } = keys(req, account);
    for (const key of [device, pair]) {
      const e = fresh(key);
      if (e && e.blockedUntil > now()) throw new TooManyAttemptsException(Math.ceil((e.blockedUntil - now()) / 1000));
    }
  }

  /** Records a wrong password or code. Blocks once the limit is reached. */
  public static fail(req: Request, account: string) {
    const { pair, device } = keys(req, account);
    for (const [key, limit] of [[pair, MAX_FAILURES], [device, MAX_DEVICE_FAILURES]] as const) {
      const e = fresh(key) ?? { count: 0, since: now(), blockedUntil: 0 };
      e.count += 1;
      if (e.count >= limit) e.blockedUntil = now() + BLOCK_MS;
      entries.set(key, e);
    }
  }

  /** A successful step clears this device's count for the account. */
  public static succeed(req: Request, account: string) {
    entries.delete(keys(req, account).pair);
  }

  /** Tests only. */
  public static reset() {
    entries.clear();
  }
}

// Drop stale entries every 10 minutes so the map can't grow without bound.
setInterval(() => {
  for (const key of entries.keys()) fresh(key);
}, 10 * 60 * 1000).unref();
