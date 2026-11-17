import { addDays } from "./businessTime";

/**
 * Trip time windows.
 *
 * A booking stores its day ("YYYY-MM-DD") and two wall-clock times ("HH:mm").
 * When the end time is earlier than the start, the trip ends the next morning
 * (a wedding from 22:00 to 01:00). Comparing raw "HH:mm" strings gets those
 * wrong, so every clash check goes through absolute minutes instead.
 */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const minutesOf = (hhmm: string): number => {
  const [h, m] = (hhmm || "00:00").split(":").map((x) => parseInt(x || "0", 10));
  return (h || 0) * 60 + (m || 0);
};

/** True when the trip ends the next day. */
export const isOvernight = (start: string, end: string): boolean => minutesOf(end) < minutesOf(start);

/** Length of the trip in minutes (a trip past midnight counts the hours after it). */
export const tripMinutes = (start: string, end: string): number =>
  minutesOf(end) - minutesOf(start) + (isOvernight(start, end) ? 1440 : 0);

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
};

export type Span = { start: number; end: number };

/** Absolute minutes covered by a trip. `date` may be omitted to compare times on one day. */
export const slotSpan = (date: string | null, start: string, end: string): Span => {
  const base = date ? dayNumber(date) * 1440 : 0;
  const s = base + minutesOf(start);
  return { start: s, end: s + tripMinutes(start, end) };
};

/** Do two trips clash, keeping `buffer` minutes free between them? */
export const spansClash = (a: Span, b: Span, buffer = 0): boolean => a.start < b.end + buffer && b.start < a.end + buffer;

/** Days whose trips can clash with a trip on `date`: the day before can run past midnight into it. */
export const nearbyDays = (date: string): string[] => [addDays(date, -1), date, addDays(date, 1)];
