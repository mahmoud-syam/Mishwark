/**
 * Business-calendar helpers.
 *
 * Bookings store `bookingDate` ("YYYY-MM-DD") and `startTime` ("HH:mm") as
 * local wall-clock values in the business time zone. Using `new Date()` +
 * `toISOString()` gives the UTC date, which is the wrong day for the first
 * hours after midnight in Cairo. Everything the dashboard computes ("today",
 * "this month", "is this trip late") goes through these helpers instead.
 */

export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Africa/Cairo";

const partsFormatter = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

const zonedParts = (date: Date, tz: string) => {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for the given instant in the business time zone. */
export const dateKey = (date: Date = new Date(), tz: string = BUSINESS_TZ): string => {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** Offset of `tz` from UTC at the given instant, in milliseconds. */
const tzOffsetMs = (date: Date, tz: string): number => {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** The instant at which local `date` + `time` ("HH:mm") happens in `tz`. */
export const zonedToInstant = (date: string, time = "00:00", tz: string = BUSINESS_TZ): Date => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  // Re-evaluate once so instants next to a DST switch land on the right side.
  return new Date(guess - tzOffsetMs(new Date(first), tz));
};

/** Calendar arithmetic on "YYYY-MM-DD" keys (time-zone independent). */
export const addDays = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const addMonths = (key: string, months: number): string => {
  const [y, m] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
};

export const monthStart = (key: string): string => `${key.slice(0, 7)}-01`;
export const yearStart = (key: string): string => `${key.slice(0, 4)}-01-01`;

/** Number of days between two keys (b - a). */
export const diffDays = (a: string, b: string): number => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

export const isDateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Current business time as "HH:mm" (Cairo by default). */
export const timeKey = (date: Date = new Date(), tz: string = BUSINESS_TZ): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
