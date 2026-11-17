/**
 * Thin fetch wrapper for the Mishwark API.
 *
 * Auth is the `token` cookie the API sets after 2FA. The dashboard is served
 * from the API's own origin (or proxied in dev), so the cookie is first-party
 * and no token is ever stored in JS.
 */
export const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  errorCode?: number;
  errors?: unknown[] | null;
  constructor(status: number, message: string, errorCode?: number, errors?: unknown[] | null) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.errors = errors;
  }
}

type Envelope<T> = { success: true; data: T; pagination?: Pagination };
export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    const message = (json && typeof json === "object" && "message" in json && String(json.message)) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, json?.errorCode, json?.errors);
  }
  return json as T;
}

const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const api = {
  raw: request,
  get: <T>(path: string) => request<Envelope<T>>("GET", path).then((r) => r.data),
  page: <T>(path: string) => request<Envelope<T[]>>("GET", path).then((r) => ({ items: r.data, pagination: r.pagination! })),
  post: <T>(path: string, body?: unknown) => request<Envelope<T>>("POST", path, body ?? {}).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => request<Envelope<T>>("PATCH", path, body ?? {}).then((r) => r.data),
  put: <T>(path: string, body?: unknown) => request<Envelope<T>>("PUT", path, body ?? {}).then((r) => r.data),
  del: <T>(path: string) => request<Envelope<T>>("DELETE", path).then((r) => r.data),
  /** multipart/form-data (photos). The browser sets the boundary header itself. */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(API_BASE + path, { method: "POST", credentials: "include", body: form });
    const json = safeJson(await res.text());
    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(res.status, (json && json.message) || `HTTP ${res.status}`, json?.errorCode, json?.errors);
    }
    return json.data as T;
  },
};

/** Bookings a 409 refused over (retire a car / schedule maintenance). */
export type ClashBooking = { id: string; ref: string; date: string; startTime: string; endTime: string; customer: string };
export const clashBookings = (e: unknown): ClashBooking[] => {
  const errs = e instanceof ApiError ? (e.errors as unknown as { bookings?: ClashBooking[] } | null) : null;
  return errs && !Array.isArray(errs) && Array.isArray(errs.bookings) ? errs.bookings : [];
};

/** Downloads a binary endpoint (e.g. an Excel export) with the session cookie. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(API_BASE + path, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Human message for an error thrown by the API layer. */
export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status >= 500) return "حصلت مشكلة في السيرفر. جرّب تاني بعد شوية.";
    if (e.status === 403) return "معندكش صلاحية للعملية دي.";
    return e.message;
  }
  if (e instanceof TypeError) return "مش قادر أوصل للسيرفر. اتأكد من الاتصال.";
  return "حصل خطأ غير متوقع.";
};
