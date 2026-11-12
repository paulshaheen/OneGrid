// Shared offshore-weather types, sites and synthetic front geometry. Safe for the client bundle.
export type OffshoreSource = "live" | "aurora" | "gfs";

export interface OffshoreSite {
  id: string;
  name: string;
  short: string;
  kind: "platform" | "drillship" | "base";
  lat: number;
  lon: number;
  pob: number;
  /** Synthetic run scaling: sheltered or shallow sites see smaller seas. */
  seaFactor: number;
}

export const OFFSHORE_SITES: OffshoreSite[] = [
  { id: "PLT-T1", name: "Platform Titan-1", short: "Titan-1", kind: "platform", lat: 27.05, lon: -88.7, pob: 176, seaFactor: 1 },
  { id: "PLT-D7", name: "Platform Delta-7", short: "Delta-7", kind: "platform", lat: 27.62, lon: -90.35, pob: 148, seaFactor: 1 },
  { id: "RIG-N5", name: "Drillship Nautilus-5", short: "Nautilus-5", kind: "drillship", lat: 27.9, lon: -90.9, pob: 132, seaFactor: 1 },
  { id: "PLT-M4", name: "Platform Mercury-4", short: "Mercury-4", kind: "platform", lat: 28.41, lon: -89.42, pob: 96, seaFactor: 0.95 },
  { id: "PLT-B2", name: "Facility Bravo-2", short: "Bravo-2", kind: "platform", lat: 26.88, lon: -91.6, pob: 58, seaFactor: 1 },
  { id: "PLT-A9", name: "Platform Atlas-9", short: "Atlas-9", kind: "platform", lat: 28.05, lon: -92.4, pob: 41, seaFactor: 0.8 },
  { id: "PLT-K3", name: "Platform Kestrel-3", short: "Kestrel-3", kind: "platform", lat: 26.1, lon: -93.2, pob: 22, seaFactor: 0.85 },
  { id: "BASE-PF", name: "Port Fourchon supply base", short: "Fourchon", kind: "base", lat: 29.11, lon: -90.2, pob: 0, seaFactor: 0.45 },
];
export const SITE_BY_ID = new Map(OFFSHORE_SITES.map((s) => [s.id, s]));

export interface SiteSeries {
  id: string;
  /** Knots. */
  wind: number[];
  gust: number[];
  /** Degrees the wind blows from. */
  windDir: number[];
  /** Significant wave height, metres. */
  hs: number[];
}

export interface OffshoreWeather {
  source: OffshoreSource;
  available: boolean;
  label: string;
  detail: string;
  synthetic: boolean;
  issuedIso: string;
  hours: string[];
  sites: SiteSeries[];
}

// ── Synthetic front geometry ─────────────────────────────────────────────────
/** The front moves towards the SE; this is how far (degrees) a point lies along that track. */
const along = (lat: number, lon: number) => (29.5 - lat + (lon + 94)) / Math.SQRT2;
/** Hour the front crosses the reference point (29.5N, 94W), per model, and its speed. */
export const FRONT = { aurora: 24, gfs: 30, degPerHour: 0.22 } as const;

export function frontArrival(model: "aurora" | "gfs", s: { lat: number; lon: number }): number {
  return FRONT[model] + along(s.lat, s.lon) / FRONT.degPerHour;
}

/** The front as a line across the Gulf at hour `h`, or null before it enters the map. */
export function frontLine(model: "aurora" | "gfs", h: number): [number, number][] | null {
  const d = (h - FRONT[model]) * FRONT.degPerHour * Math.SQRT2;
  if (d < -3) return null;
  // Points where (29.5 - lat) + (lon + 94) = d.
  return [-98, -82].map((lon) => [lon, 29.5 + lon + 94 - d] as [number, number]);
}
