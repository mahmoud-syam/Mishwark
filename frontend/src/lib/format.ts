/**
 * Display formatting. The Figma uses Arabic words with Western digits
 * ("14 أغسطس", "7:00 م", "184K"), so every formatter pins `nu-latn`.
 */
export const BUSINESS_TZ = "Africa/Cairo";
const LOCALE = "ar-EG-u-nu-latn";

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const num = (n: number | null | undefined) => (n == null ? "—" : intFmt.format(Math.round(n)));
export const egp = (n: number | null | undefined) => (n == null ? "—" : `${num(n)} ج.م`);

/** 950 → "950", 16_400 → "16.4K", 184_000 → "184K", 1_250_000 → "1.25M". */
export const compact = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (a >= 100_000) return `${Math.round(n / 1000)}K`;
  if (a >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return num(n);
};

export const percentDelta = (current: number, previous: number): number | null => {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
};

// ---------------------------------------------------------------- dates
/** "YYYY-MM-DD" for today in Cairo. */
export const todayKey = () => dateKeyOf(new Date());
export const dateKeyOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Date-key arithmetic (calendar days; time-zone independent). */
export const addDays = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
};
const keyToUtcNoon = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** Colloquial Egyptian weekday names used throughout the Figma. */
const WEEKDAYS = ["حد", "اتنين", "تلات", "أربع", "خميس", "جمعة", "سبت"];
const WEEKDAYS_FULL = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
export const weekdayShort = (key: string) => WEEKDAYS[keyToUtcNoon(key).getUTCDay()];
export const weekdayFull = (key: string) => WEEKDAYS_FULL[keyToUtcNoon(key).getUTCDay()];
export const dayOfWeek = (key: string) => keyToUtcNoon(key).getUTCDay();

const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", timeZone: "UTC" });
export const monthName = (key: string) => monthFmt.format(keyToUtcNoon(key.length === 7 ? `${key}-01` : key));
/** "14 أغسطس" */
export const dayMonth = (key: string) => `${Number(key.slice(8, 10))} ${monthName(key)}`;
/** "14 أغسطس 2026" */
export const fullDate = (key: string) => `${dayMonth(key)} ${key.slice(0, 4)}`;
/** "أغسطس 2026" */
export const monthYear = (key: string) => `${monthName(key)} ${key.slice(0, 4)}`;

/** "19:30" → "7:30 م" */
export const time12 = (hhmm: string) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "م" : "ص";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

/** "اليوم، 2:41 م" / "أمس، 6:15 م" / "10 أغسطس، 9:30 ص" for an ISO instant. */
export const relativeStamp = (iso: string) => {
  const d = new Date(iso);
  const key = dateKeyOf(d);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const today = todayKey();
  const label = key === today ? "اليوم" : key === addDays(today, -1) ? "أمس" : dayMonth(key);
  return `${label}، ${time12(hm)}`;
};

export const minutesLabel = (m: number) => {
  if (m <= 0) return "أقل من دقيقة";
  if (m === 1) return "دقيقة";
  if (m === 2) return "دقيقتين";
  if (m <= 10) return `${m} دقائق`;
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hours = h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${h} ساعات`;
  return r ? `${hours} و${r} د` : hours;
};

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0][0];
  return `${parts[0][0]}.${parts[1][0]}`;
};

/** "+201012345678" → "01012●●●678" */
export const maskPhone = (phone?: string | null) => {
  if (!phone) return "";
  const local = phone.replace(/^\+20/, "0");
  if (local.length < 8) return local;
  return `${local.slice(0, 5)}●●●${local.slice(-3)}`;
};
export const telHref = (phone?: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined);
export const whatsappHref = (phone?: string | null) => (phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : undefined);

/** "MW-1D8E30" style booking reference (matches the API's bookingRef). */
export const bookingRef = (id: string) => `MW-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
