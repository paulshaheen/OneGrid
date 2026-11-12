// Offshore weather for OneRig: wind and sea state at each Gulf of Mexico site.
//   live          Public NOAA GFS winds and GFS-Wave seas via Open-Meteo, hourly, 5 days.
//   aurora / gfs  A synthetic Aurora/GFS pair of the same November cold front ("norther"),
//                 used until a real Aurora marine run is published. The two runs differ the
//                 way forecasters often see them differ: GFS brings the front about 6 hours
//                 later and its post-frontal winds and seas about 15-20% lower.
import { createServerFn } from "@tanstack/react-start";

import { OFFSHORE_SITES, type OffshoreSource, type OffshoreWeather, type SiteSeries } from "./sites";
import { syntheticRun } from "./synthetic";

const HOURS = 120;

// ── Live NOAA via Open-Meteo ─────────────────────────────────────────────────
type OmHourly = Record<string, (number | null)[]> & { time: string[] };
let liveCache: { at: number; val: OffshoreWeather } | null = null;
const LIVE_TTL_MS = 30 * 60_000;

async function om(url: string): Promise<OmHourly[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  const body = (await res.json()) as unknown;
  return ((Array.isArray(body) ? body : [body]) as { hourly: OmHourly }[]).map((r) => r.hourly);
}

async function fetchLive(): Promise<OffshoreWeather> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.val;
  const common = {
    latitude: OFFSHORE_SITES.map((s) => s.lat).join(","),
    longitude: OFFSHORE_SITES.map((s) => s.lon).join(","),
    forecast_days: "6",
    timezone: "GMT",
  };
  const [winds, seas] = await Promise.all([
    om(
      "https://api.open-meteo.com/v1/gfs?" +
        new URLSearchParams({ ...common, hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m", wind_speed_unit: "kn" }).toString(),
    ),
    om("https://marine-api.open-meteo.com/v1/marine?" + new URLSearchParams({ ...common, hourly: "wave_height", models: "ncep_gfswave025" }).toString()),
  ]);
  const times = winds[0]?.time ?? [];
  const now = Date.now() - 3_600_000;
  const start = Math.max(0, times.findIndex((t) => Date.parse(`${t}Z`) >= now));
  const slice = (h: OmHourly | undefined, k: string, from = start) =>
    (h?.[k] ?? []).slice(from, from + HOURS).map((v) => (typeof v === "number" ? v : 0));
  const sites = OFFSHORE_SITES.map((s, i): SiteSeries => {
    const seaRow = seas[i];
    const seaStart = seaRow ? Math.max(0, seaRow.time.indexOf(times[start] ?? "")) : 0;
    return {
      id: s.id,
      wind: slice(winds[i], "wind_speed_10m"),
      gust: slice(winds[i], "wind_gusts_10m"),
      windDir: slice(winds[i], "wind_direction_10m"),
      hs: slice(seaRow, "wave_height", seaStart),
    };
  });
  const val: OffshoreWeather = {
    source: "live",
    available: true,
    label: "NOAA GFS + GFS-Wave (live)",
    detail: "Public NOAA GFS 0.25° winds and GFS-Wave 0.25° significant wave height, hourly, via Open-Meteo.",
    synthetic: false,
    issuedIso: new Date().toISOString(),
    hours: times.slice(start, start + HOURS).map((t) => `${t}:00Z`),
    sites,
  };
  liveCache = { at: Date.now(), val };
  return val;
}

export const getOffshoreWeather = createServerFn({ method: "GET" })
  .validator((data: { source: OffshoreSource }) => data)
  .handler(async ({ data }): Promise<OffshoreWeather> => {
    if (data.source !== "live") return syntheticRun(data.source);
    try {
      return await fetchLive();
    } catch (e) {
      return {
        source: "live",
        available: false,
        label: "NOAA GFS + GFS-Wave (live)",
        detail: `Forecast unavailable: ${e instanceof Error ? e.message : String(e)}`,
        synthetic: false,
        issuedIso: new Date().toISOString(),
        hours: [],
        sites: [],
      };
    }
  });
