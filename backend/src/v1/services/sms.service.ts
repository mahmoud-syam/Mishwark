/**
 * Outgoing SMS, provider-agnostic.
 *
 *   SMS_PROVIDER=twilio   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *   SMS_PROVIDER=http     SMS_HTTP_URL (+ optional SMS_HTTP_TOKEN, SMS_SENDER)
 *                         POSTs JSON { to, message, sender } — use this to plug
 *                         in a local Egyptian gateway (SMS Misr, Victory Link…)
 *                         through a small adapter, or swap in a direct client.
 *   (unset)               nothing is sent; codes are logged and returned to the
 *                         app as dev_otp so development keeps working.
 *
 * Once a provider is configured, OTP codes are only ever delivered by SMS.
 */
export interface SmsProvider {
  name: string;
  send(to: string, message: string): Promise<void>;
}

const TIMEOUT_MS = Number(process.env.SMS_TIMEOUT_MS ?? 8000);

async function post(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SMS provider responded ${res.status}: ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

const twilio = (): SmsProvider | null => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return null;
  return {
    name: "twilio",
    send: (to, message) =>
      post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
      }),
  };
};

const http = (): SmsProvider | null => {
  const url = process.env.SMS_HTTP_URL;
  if (!url) return null;
  return {
    name: "http",
    send: (to, message) =>
      post(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.SMS_HTTP_TOKEN && { Authorization: `Bearer ${process.env.SMS_HTTP_TOKEN}` }),
        },
        body: JSON.stringify({ to, message, sender: process.env.SMS_SENDER || "Mishwark" }),
      }),
  };
};

let cached: SmsProvider | null | undefined;
export const smsProvider = (): SmsProvider | null => {
  if (cached !== undefined) return cached;
  const kind = (process.env.SMS_PROVIDER || "").toLowerCase();
  cached = kind === "twilio" ? twilio() : kind === "http" ? http() : null;
  if (kind && !cached) console.warn(`[sms] SMS_PROVIDER=${kind} is set but its settings are incomplete; SMS is disabled.`);
  if (!cached && process.env.NODE_ENV === "production") {
    console.warn("[sms] No SMS provider configured in production: OTP codes are returned in the API response (dev_otp). Configure SMS_PROVIDER before launch.");
  }
  return cached;
};

export const SmsService = {
  isConfigured: () => smsProvider() !== null,
  /** Sends an SMS; throws if the provider rejects it. No-op (logged) when unconfigured. */
  async send(to: string, message: string) {
    const p = smsProvider();
    if (!p) {
      console.info(`[sms:dev] to ${to}: ${message}`);
      return;
    }
    await p.send(to, message);
  },
  /** Test hook: forget the cached provider after changing env vars. */
  reset() {
    cached = undefined;
  },
};

export default SmsService;
