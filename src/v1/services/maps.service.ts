import { BadRequestException } from "../utils/errors";

const ORS_BASE_URL = process.env.ORS_BASE_URL || "https://api.openrouteservice.org";
const GEOCODE_TIMEOUT_MS = Number(process.env.ORS_TIMEOUT_MS || 5000);

// Average ratio of real road distance to straight-line distance. Used only when
// OpenRouteService is unreachable, so that a booking can still be priced
// instead of failing outright.
const ROAD_DETOUR_FACTOR = 1.3;
// Fallback average speed in km/h, urban. Only used with the haversine path.
const FALLBACK_SPEED_KMH = 30;
// Geocoding for free text is a guess; anything below this match quality is not
// worth pricing a trip on.
const MIN_GEOCODE_CONFIDENCE = 0.5;
const EARTH_RADIUS_KM = 6371;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteResult extends RouteLeg {
  source: "openrouteservice" | "haversine";
  start: Coordinates;
  end: Coordinates;
  waypoints: Coordinates[];
  /** Populated when the provider failed and we fell back to haversine. */
  warning?: string;
}

export interface GeocodeResult {
  coordinates: Coordinates;
  displayName: string;
  confidence: number;
}

export type LocationInput =
  | { latitude: number; longitude: number }
  | { startLat: number; startLng: number }
  | { lat: number; lng: number }
  | string;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const assertValidCoordinates = (coords: Coordinates, label: string): Coordinates => {
  if (!isFiniteNumber(coords.latitude) || !isFiniteNumber(coords.longitude)) {
    throw new BadRequestException(`${label} coordinates must be finite numbers`);
  }
  if (coords.latitude < -90 || coords.latitude > 90) {
    throw new BadRequestException(`${label} latitude must be between -90 and 90`);
  }
  if (coords.longitude < -180 || coords.longitude > 180) {
    throw new BadRequestException(`${label} longitude must be between -180 and 180`);
  }
  return coords;
};

/**
 * Normalises the several coordinate shapes a client may send into a single
 * `{ latitude, longitude }`. Returns null for anything that is not usable as a
 * location, so the caller can fall back to geocoding.
 */
export const toCoordinates = (input: LocationInput | undefined | null): Coordinates | null => {
  if (input == null) return null;

  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const latitude = record.latitude ?? record.lat ?? record.startLat;
    const longitude = record.longitude ?? record.lng ?? record.lon ?? record.startLng;
    if (isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
      return { latitude, longitude };
    }
    return null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // "30.0444,31.2357" - the only numeric form worth accepting from a text
    // field, since a free-text place name has to go through geocoding.
    const pair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
    if (pair) {
      return { latitude: Number(pair[1]), longitude: Number(pair[2]) };
    }
  }

  return null;
};

const haversineKm = (from: Coordinates, to: Coordinates): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

const roundKm = (value: number) => Math.round(value * 100) / 100;
const roundMinutes = (value: number) => Math.max(1, Math.round(value));

const withTimeout = async <T>(url: string, init: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

interface OrsGeocodeFeature {
  geometry: { coordinates: [number, number] };
  properties?: { name?: string; confidence?: number };
}

interface OrsRouteResponse {
  routes?: Array<{ summary: { distance: number; duration: number }; geometry?: { coordinates: [number, number][] } }>;
}

export class MapsService {
  /** True when an OpenRouteService key is configured; gates the network path. */
  public static get isConfigured(): boolean {
    return Boolean(process.env.ORS_API_KEY);
  }

  public static async geocode(query: string): Promise<GeocodeResult> {
    const trimmed = (query || "").trim();
    if (!trimmed) {
      throw new BadRequestException("Cannot geocode an empty location");
    }
    if (!this.isConfigured) {
      throw new BadRequestException(
        "Geocoding is unavailable: ORS_API_KEY is not configured. Send lat/lng instead."
      );
    }

    const url =
      `${ORS_BASE_URL}/v1/geocode/search` +
      `?api_key=${encodeURIComponent(process.env.ORS_API_KEY as string)}` +
      `&text=${encodeURIComponent(trimmed)}&size=1`;

    const body = await withTimeout<{ features?: OrsGeocodeFeature[] }>(url, {
      headers: { Accept: "application/json" },
    });
    const feature = body.features?.[0];
    if (!feature?.geometry?.coordinates) {
      throw new BadRequestException(`No location found for "${trimmed}"`);
    }

    // GeoJSON order is [longitude, latitude] - the reverse of our own shape.
    const [longitude, latitude] = feature.geometry.coordinates;
    const confidence = feature.properties?.confidence ?? 0;
    if (confidence < MIN_GEOCODE_CONFIDENCE) {
      throw new BadRequestException(`"${trimmed}" could not be matched confidently enough`);
    }

    return {
      coordinates: assertValidCoordinates({ latitude, longitude }, "Geocoded"),
      displayName: feature.properties?.name || trimmed,
      confidence,
    };
  }

  /**
   * Resolves one endpoint: coordinates pass straight through, free text is
   * geocoded. Mirrors the same "never trust the client" rule as pricing, but
   * coordinates are a location, not a price, so they are accepted as given.
   */
  private static async resolve(input: LocationInput | undefined | null, label: string): Promise<Coordinates> {
    const direct = toCoordinates(input);
    if (direct) return assertValidCoordinates(direct, label);
    if (typeof input === "string" && input.trim()) {
      const result = await this.geocode(input);
      return result.coordinates;
    }
    throw new BadRequestException(`${label} is required (lat/lng or a place name)`);
  }

  public static async route(
    startInput: LocationInput | undefined | null,
    endInput: LocationInput | undefined | null
  ): Promise<RouteResult> {
    const start = await this.resolve(startInput, "startPoint");
    const end = await this.resolve(endInput, "endPoint");

    const straightLineKm = haversineKm(start, end);
    // A zero-length route is legitimate (same pickup and drop-off) and needs no
    // provider round-trip.
    if (straightLineKm < 0.05) {
      return { distanceKm: 0, durationMinutes: 0, source: "haversine", start, end, waypoints: [] };
    }

    if (!this.isConfigured) {
      return this.haversineRoute(
        start,
        end,
        straightLineKm,
        "ORS_API_KEY is not configured; distance is a straight-line estimate."
      );
    }

    // OpenRouteService takes GeoJSON order: [longitude, latitude] per point.
    const coordinates = [
      [start.longitude, start.latitude],
      [end.longitude, end.latitude],
    ];

    const url = `${ORS_BASE_URL}/v2/directions/driving?api_key=${encodeURIComponent(process.env.ORS_API_KEY as string)}`;

    try {
      const body = await withTimeout<OrsRouteResponse>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ coordinates }),
      });

      const route = body.routes?.[0];
      if (!route) throw new Error("empty routes array");

      return {
        // OpenRouteService reports metres and seconds.
        distanceKm: roundKm(route.summary.distance / 1000),
        durationMinutes: roundMinutes(route.summary.duration / 60),
        source: "openrouteservice",
        start,
        end,
        waypoints: (route.geometry?.coordinates || []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      // A booking that cannot be priced is worse than a booking priced from a
      // conservative estimate, so degrade instead of 500-ing. The reason travels
      // with the result so the caller can surface it.
      return this.haversineRoute(
        start,
        end,
        straightLineKm,
        `Routing provider unavailable (${error?.message || "unknown error"}); distance is a straight-line estimate.`
      );
    }
  }

  private static haversineRoute(start: Coordinates, end: Coordinates, straightLineKm: number, warning?: string): RouteResult {
    const distanceKm = roundKm(straightLineKm * ROAD_DETOUR_FACTOR);
    return {
      distanceKm,
      durationMinutes: roundMinutes((distanceKm / FALLBACK_SPEED_KMH) * 60),
      source: "haversine",
      start,
      end,
      waypoints: [start, end],
      warning,
    };
  }
}

export default MapsService;
