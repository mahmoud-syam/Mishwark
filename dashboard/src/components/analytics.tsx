import type { Period } from "../lib/types";
import { monthName, weekdayShort } from "../lib/format";

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "day", label: "يومي" },
  { value: "month", label: "شهري" },
  { value: "year", label: "سنوي" },
];

/** "اليوم" / "الشهر" / "السنة" — suffix for period-scoped stat labels. */
export const PERIOD_WORD: Record<Period, string> = { day: "اليوم", month: "الشهر", year: "السنة" };

export const CHART_TAG: Record<Period, string> = { day: "آخر 7 أيام", month: "آخر 6 شهور", year: "آخر 3 سنين" };

export const chartLabel = (period: Period, key: string) => (period === "day" ? weekdayShort(key) : period === "month" ? monthName(key) : key);
