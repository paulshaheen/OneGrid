import type { WeatherEvent } from "@/lib/domain/types";

// Ops region we surface storms for: the East Pacific + Gulf + Caribbean + western
// North Atlantic waters around North America. Storms outside it (open/central
// Pacific, eastern Atlantic near Africa) smear across the US-centric maps and skew
// the camera framing, so we drop them on every data plane. Keep in sync with the
// report-app filter (report-app/server/dataApi.js) and the Aurora DETECTION_BBOX
// (planetary-computer-pro-poc): -125,7,-55,50.
export const STORM_DOMAIN = { minLon: -125, minLat: 7, maxLon: -55, maxLat: 50 };

export function inStormDomain(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= STORM_DOMAIN.minLon &&
    lon <= STORM_DOMAIN.maxLon &&
    lat >= STORM_DOMAIN.minLat &&
    lat <= STORM_DOMAIN.maxLat
  );
}

/** Keep an event if its current position or any track / forecast point is inside the
 * domain, so systems approaching the region still appear as they enter it. */
export function eventInStormDomain(ev: WeatherEvent): boolean {
  if (inStormDomain(ev.lon, ev.lat)) return true;
  if (Array.isArray(ev.forecast) && ev.forecast.some((p) => inStormDomain(p.lon, p.lat))) return true;
  if (Array.isArray(ev.history) && ev.history.some(([lon, lat]) => inStormDomain(lon, lat))) return true;
  return false;
}
