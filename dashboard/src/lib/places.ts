/**
 * Frequently used venues with known coordinates. Picking one sends exact
 * coordinates (plus the label) to the API, so pricing works even without an
 * OpenRouteService key. Any other free-text place is geocoded server-side.
 */
export const SAVED_PLACES = [
  { label: "قاعة الأفراح، مدينة نصر", latitude: 30.0566, longitude: 31.3301 },
  { label: "فندق فيرمونت، القاهرة", latitude: 30.0911, longitude: 31.3253 },
  { label: "مطار القاهرة الدولي", latitude: 30.1219, longitude: 31.4056 },
  { label: "فندق نايل ريتز كارلتون", latitude: 30.0459, longitude: 31.2329 },
  { label: "فيلا التجمع الخامس", latitude: 30.0074, longitude: 31.4913 },
  { label: "قاعة الماسة", latitude: 30.0749, longitude: 31.3462 },
  { label: "دار الأوبرا المصرية", latitude: 30.0425, longitude: 31.2241 },
  { label: "نادي الجزيرة", latitude: 30.0566, longitude: 31.2195 },
  { label: "مدينتي", latitude: 30.1066, longitude: 31.6385 },
  { label: "كنيسة الكاتدرائية، العباسية", latitude: 30.0726, longitude: 31.2756 },
  { label: "فندق الماسة كابيتال", latitude: 30.0236, longitude: 31.6995 },
];

export type PlaceValue = string | { latitude: number; longitude: number; label: string };

export const toPlaceValue = (text: string): PlaceValue | null => {
  const t = text.trim();
  if (!t) return null;
  const saved = SAVED_PLACES.find((p) => p.label === t);
  return saved ?? t;
};

export const EVENT_TYPES = ["زفة فرح 💍", "خطوبة", "استقبال مطار", "حفلة تخرج", "مناسبة VIP", "كتب كتاب"];
