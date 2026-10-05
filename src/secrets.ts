import dotenv from 'dotenv';

dotenv.config({
    path: ".env"
});

export const PORT = process.env.PORT;
export const JWT_SECRET = process.env.JWT_SECRET

// OpenRouteService: geocoding (place name -> coordinates) and driving
// directions (coordinates -> distance/duration). Without a key the backend
// still prices bookings, falling back to a straight-line haversine estimate,
// so this is optional in development but required for accurate figures.
export const ORS_API_KEY = process.env.ORS_API_KEY;
export const ORS_BASE_URL = process.env.ORS_BASE_URL || "https://api.openrouteservice.org";
export const ORS_TIMEOUT_MS = Number(process.env.ORS_TIMEOUT_MS || 5000);
