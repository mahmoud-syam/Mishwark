import fs from "fs";
import jwt from "jsonwebtoken";
import prismaClient from "../utils/prismaClientHelper";

/**
 * Push notifications through Firebase Cloud Messaging (HTTP v1), which reaches
 * both Android and iPhone (Firebase forwards to Apple).
 *
 * Set up with a Firebase service account (Project settings > Service accounts >
 * Generate new private key), given as one of:
 *   FCM_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
 *   FCM_SERVICE_ACCOUNT_JSON=<the JSON, or the JSON in base64>
 * Without it nothing is pushed: notifications still land in the app's inbox.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
export type PushMessage = { title: string; body: string; data?: Record<string, string> };
export type PushResult = { sent: number; failed: number; removed: number };

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 10_000;

let override: { account: ServiceAccount; apiUrl: string } | null | undefined;
let cachedAccount: ServiceAccount | null | undefined;
let accessToken: { value: string; expiresAt: number } | null = null;

const readAccount = (): ServiceAccount | null => {
  if (cachedAccount !== undefined) return cachedAccount;
  let raw = "";
  try {
    if (process.env.FCM_SERVICE_ACCOUNT_FILE) raw = fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, "utf8");
    else if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
      const v = process.env.FCM_SERVICE_ACCOUNT_JSON.trim();
      raw = v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8");
    }
    const a = raw ? JSON.parse(raw) : null;
    cachedAccount = a?.project_id && a?.client_email && a?.private_key ? a : null;
    if (raw && !cachedAccount) console.warn("[push] the Firebase service account is incomplete (project_id, client_email, private_key); push is off.");
  } catch (e) {
    console.warn("[push] couldn't read the Firebase service account; push is off.", (e as Error).message);
    cachedAccount = null;
  }
  return cachedAccount;
};

const config = () => {
  if (override !== undefined) return override;
  const account = readAccount();
  return account ? { account, apiUrl: process.env.FCM_API_URL || "https://fcm.googleapis.com" } : null;
};

async function post(url: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getAccessToken(account: ServiceAccount) {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }, account.private_key, { algorithm: "RS256" });
  const res = await post(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`token request failed (${res.status})`);
  accessToken = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return accessToken.value;
}

/** FCM says the app was uninstalled or the token is no longer valid. */
const isDeadToken = (status: number, json: any) => {
  const code = json?.error?.status;
  const detail = JSON.stringify(json?.error?.details ?? "");
  return status === 404 || code === "NOT_FOUND" || detail.includes("UNREGISTERED") || (status === 400 && detail.includes("registration token"));
};

export const PushService = {
  isConfigured: () => config() !== null,

  /** Tests only: point at a fake FCM (null = push off; undefined = back to the environment). */
  configureForTests(o: { account: ServiceAccount; apiUrl: string } | null | undefined) {
    override = o;
    accessToken = null;
  },

  /**
   * Sends to every registered device of the user. Never throws: a push is a
   * convenience on top of the inbox. Tokens FCM reports dead are removed.
   */
  async sendToUser(userId: string, msg: PushMessage): Promise<PushResult> {
    const result: PushResult = { sent: 0, failed: 0, removed: 0 };
    const cfg = config();
    if (!cfg) return result;
    const devices = await prismaClient.deviceTokens.findMany({ where: { userId }, select: { id: true, token: true } });
    if (!devices.length) return result;
    let bearer: string;
    try {
      bearer = await getAccessToken(cfg.account);
    } catch (e) {
      console.error("[push] couldn't get a Firebase access token:", (e as Error).message);
      result.failed = devices.length;
      return result;
    }
    const url = `${cfg.apiUrl.replace(/\/$/, "")}/v1/projects/${cfg.account.project_id}/messages:send`;
    await Promise.all(
      devices.map(async (d) => {
        try {
          const res = await post(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: d.token,
                notification: { title: msg.title, body: msg.body },
                data: msg.data ?? {},
                android: { priority: "high", notification: { channel_id: "mishwark", sound: "default" } },
                apns: { payload: { aps: { sound: "default" } } },
              },
            }),
          });
          if (res.ok) {
            result.sent++;
            return;
          }
          const json: any = await res.json().catch(() => ({}));
          if (isDeadToken(res.status, json)) {
            await prismaClient.deviceTokens.deleteMany({ where: { id: d.id } });
            result.removed++;
          } else {
            result.failed++;
            console.error(`[push] send failed (${res.status}):`, json?.error?.message ?? "");
          }
        } catch (e) {
          result.failed++;
          console.error("[push] send failed:", (e as Error).message);
        }
      })
    );
    return result;
  },
};

export default PushService;
