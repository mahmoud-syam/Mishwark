import { BadRequestException } from "../utils/errors";

/**
 * Place search and "what is at this pin?" for the booking map, on
 * OpenStreetMap data (free, no account):
 *
 * - search as you type: Photon (photon.komoot.io), which is built for
 *   autocomplete, limited to Egypt.
 * - reverse (pin -> address): Nominatim, whose public server allows a few
 *   requests per second with an identifying User-Agent. Photon reverse is the
 *   fallback.
 *
 * The API calls them on the clients' behalf so the apps and the dashboard need
 * no third-party access, answers are cached, and both providers can be swapped
 * for self-hosted instances with PHOTON_URL / NOMINATIM_URL.
 */

const PHOTON_URL = () => (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");
const NOMINATIM_URL = () => (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.PLACES_TIMEOUT_MS || 6000);
const USER_AGENT = () => process.env.PLACES_USER_AGENT || "Mishwark/1.0 (event car booking; https://mishwark.mahmoud-syam.me)";

/** Egypt, as minLon,minLat,maxLon,maxLat. */
const EGYPT_BBOX = [24.6, 21.9, 37.1, 31.8] as const;
const inEgypt = (lat: number, lng: number) => lng >= EGYPT_BBOX[0] && lng <= EGYPT_BBOX[2] && lat >= EGYPT_BBOX[1] && lat <= EGYPT_BBOX[3];

export interface Place {
  /** Short name to show first ("قاعة الماسة"). */
  name: string;
  /** Area, city and governorate ("مدينة نصر، القاهرة"). */
  detail: string;
  /** name + detail, what gets stored on the booking. */
  label: string;
  latitude: number;
  longitude: number;
  /** OSM category, e.g. "amenity:hospital", "place:suburb". */
  kind: string;
}

// ------------------------------------------------------------------ cache
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { at: number; value: unknown }>();
/** `keep` decides whether an answer is worth caching (a fallback after an outage isn't). */
const cached = async <T>(key: string, load: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (keep(value)) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), value });
  }
  return value;
};

// Nominatim's public server: at most one request per second from us.
let nominatimNext = 0;
const nominatimTurn = async () => {
  const wait = nominatimNext - Date.now();
  nominatimNext = Math.max(Date.now(), nominatimNext) + 1000;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

const getJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT(), "Accept-Language": "ar,en" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const uniq = (parts: (string | undefined | null)[]) => {
  const out: string[] = [];
  for (const p of parts) {
    const v = (p ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
};
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ----------------------------------------------------------------- photon
interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

const fromPhoton = (f: PhotonFeature): Place | null => {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const street = uniq([p.street, p.housenumber]).join(" ");
  const name = p.name || street || p.district || p.city || "";
  if (!name) return null;
  const detail = uniq([p.name ? street : "", p.district, p.locality, p.city, p.state].filter((x) => x !== name)).join("، ");
  return {
    name,
    detail,
    label: detail ? `${name}، ${detail}` : name,
    latitude: round6(lat),
    longitude: round6(lng),
    kind: [p.osm_key, p.osm_value].filter(Boolean).join(":"),
  };
};

// -------------------------------------------------------------- nominatim
interface NominatimReverse {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  error?: string;
}

const fromNominatim = (r: NominatimReverse, lat: number, lng: number): Place | null => {
  if (!r || r.error) return null;
  const a = r.address ?? {};
  const street = uniq([a.road, a.house_number]).join(" ");
  const area = a.neighbourhood || a.quarter || a.suburb || a.city_district || a.village || a.town;
  const city = a.city || a.town || a.state_district;
  const name = r.name || street || area || city || "";
  if (!name) return null;
  const detail = uniq([r.name ? street : "", area, city, a.state].filter((x) => x !== name)).join("، ");
  return {
    name,
    detail,
    label: detail ? `${name}، ${detail}` : name,
    // The pin's own position: the address is a description of it.
    latitude: round6(lat),
    longitude: round6(lng),
    kind: [r.category, r.type].filter(Boolean).join(":"),
  };
};

export class PlacesService {
  /** Search inside Egypt, nearest to (lat, lng) first when given. */
  public static async search(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
    const query = (q ?? "").trim().replace(/\s+/g, " ");
    if (query.length < 2) return [];
    if (query.length > 120) throw new BadRequestException("Search text is too long");
    const bias = near && inEgypt(near.lat, near.lng) ? `&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}` : "";
    // Arabic text: local names (Arabic in Egypt). Otherwise English names,
    // which match English queries far better ("Cairo Tower").
    const lang = /[\u0600-\u06FF]/.test(query) ? "default" : "en";
    const key = `s|${lang}|${query.toLowerCase()}|${bias}`;
    return cached(key, async () => {
      const url = `${PHOTON_URL()}/api/?q=${encodeURIComponent(query)}&limit=8&lang=${lang}&bbox=${EGYPT_BBOX.join(",")}${bias}`;
      const json = await getJson<{ features?: PhotonFeature[] }>(url);
      const seen = new Set<string>();
      const out: Place[] = [];
      for (const f of json.features ?? []) {
        if (f.properties?.countrycode && f.properties.countrycode.toUpperCase() !== "EG") continue;
        const p = fromPhoton(f);
        if (!p || seen.has(p.label)) continue;
        seen.add(p.label);
        out.push(p);
      }
      return out;
    });
  }

  /** The address at a pin. Never fails for a valid point: worst case the coordinates are the label. */
  public static async reverse(lat: number, lng: number): Promise<Place> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException("lat and lng must be valid coordinates");
    }
    if (!inEgypt(lat, lng)) throw new BadRequestException("This point is outside Egypt");
    const plain: Place = {
      name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      detail: "",
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      latitude: round6(lat),
      longitude: round6(lng),
      kind: "",
    };
    // ~11 m grid: pins dropped on the same spot share the answer.
    const key = `r|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    return cached(key, async () => {
      try {
        await nominatimTurn();
        const r = await getJson<NominatimReverse>(
          `${NOMINATIM_URL()}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`
        );
        const p = fromNominatim(r, lat, lng);
        if (p) return p;
      } catch (err) {
        console.warn("[places] nominatim reverse failed:", (err as Error).message);
      }
      try {
        const json = await getJson<{ features?: PhotonFeature[] }>(`${PHOTON_URL()}/reverse?lat=${lat}&lon=${lng}`);
        const p = json.features?.[0] && fromPhoton(json.features[0]);
        if (p) return { ...p, latitude: round6(lat), longitude: round6(lng) };
      } catch (err) {
        console.warn("[places] photon reverse failed:", (err as Error).message);
      }
      return plain;
    }, (p) => p !== plain);
  }

  /** Tests only. */
  public static clearCache() {
    cache.clear();
    nominatimNext = 0;
  }
}

export default PlacesService;
