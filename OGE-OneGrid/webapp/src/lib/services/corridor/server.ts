// Corridor weather for the Transmission Weather view: hourly weather at every 0.25°
// grid cell the Southeast network crosses, from one of four sources.
//
//   gfs           NOAA GFS 0.25° (via the Open-Meteo GFS API): the free public baseline.
//   aurora        Microsoft Aurora's forecast (corridor-fields.json published by the
//                 Aurora pipeline), interpolated to hourly. Aurora predicts temperature,
//                 wind and the 850 hPa thermal profile but not precipitation, gusts or
//                 sunshine, so those come from GFS at the same valid time (labelled hybrid).
//   scenario-ice  Synthetic Southeast ice storm (cold-air damming) + a squall line.
//   scenario-heat Synthetic heat dome with afternoon pop-up thunderstorms.
import { createServerFn } from "@tanstack/react-start";

import { weatherCells } from "@/lib/data/se-transmission";

export type CorridorSource = "gfs" | "aurora" | "scenario-ice" | "scenario-heat";

export interface CellSeries {
  key: string;
  lat: number;
  lon: number;
  /** 2 m air temperature (°C). */
  t2m: number[];
  /** 10 m wind speed (m/s). */
  wind: number[];
  /** Direction the wind blows from (degrees). */
  windDir: number[];
  /** 10 m wind gust (m/s). */
  gust: number[];
  /** Precipitation in the hour (mm). */
  precip: number[];
  /** Shortwave (solar) radiation (W/m²). */
  sw: number[];
  /** 850 hPa temperature (°C) — a warm layer aloft over sub-freezing air means freezing rain. */
  t850: number[];
}

export interface CorridorWeather {
  source: CorridorSource;
  available: boolean;
  label: string;
  detail: string;
  issuedIso: string;
  hours: string[];
  cells: CellSeries[];
}

const HOURS = 120;
const GFS_TTL_MS = 30 * 60_000;
let gfsCache: { at: number; val: CorridorWeather } | null = null;
let auroraCache: { at: number; val: CorridorWeather } | null = null;

const GFS_VARS =
  "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,shortwave_radiation,temperature_850hPa";

type OmHourly = Record<string, (number | null)[]> & { time: string[] };

async function fetchGfs(): Promise<CorridorWeather> {
  if (gfsCache && Date.now() - gfsCache.at < GFS_TTL_MS) return gfsCache.val;
  const cells = weatherCells();
  const batches: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 50) batches.push(cells.slice(i, i + 50));
  const rows: OmHourly[] = [];
  for (const b of batches) {
    const url =
      "https://api.open-meteo.com/v1/gfs?" +
      new URLSearchParams({
        latitude: b.map((c) => c.lat).join(","),
        longitude: b.map((c) => c.lon).join(","),
        hourly: GFS_VARS,
        forecast_days: "6",
        wind_speed_unit: "ms",
        timezone: "GMT",
      }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GFS request failed (${res.status})`);
    const body = (await res.json()) as unknown;
    const list = (Array.isArray(body) ? body : [body]) as { hourly: OmHourly }[];
    for (const r of list) rows.push(r.hourly);
  }
  const now = Date.now() - 3_600_000;
  const times = rows[0]?.time ?? [];
  const start = Math.max(0, times.findIndex((t) => Date.parse(`${t}Z`) >= now));
  const hours = times.slice(start, start + HOURS).map((t) => `${t}:00Z`);
  const pick = (h: OmHourly, k: string) =>
    (h[k] ?? []).slice(start, start + HOURS).map((v) => (typeof v === "number" ? v : 0));
  const series: CellSeries[] = cells.map((c, i) => {
    const h = rows[i]!;
    return {
      ...c,
      t2m: pick(h, "temperature_2m"),
      wind: pick(h, "wind_speed_10m"),
      windDir: pick(h, "wind_direction_10m"),
      gust: pick(h, "wind_gusts_10m"),
      precip: pick(h, "precipitation"),
      sw: pick(h, "shortwave_radiation"),
      t850: pick(h, "temperature_850hPa"),
    };
  });
  const val: CorridorWeather = {
    source: "gfs",
    available: true,
    label: "NOAA GFS 0.25°",
    detail: `Public NOAA Global Forecast System, hourly, ${series.length} grid cells along the corridors (via Open-Meteo).`,
    issuedIso: new Date().toISOString(),
    hours,
    cells: series,
  };
  gfsCache = { at: Date.now(), val };
  return val;
}

interface AuroraCorridorFile {
  analysisTimeIso: string;
  model: string;
  lats: number[];
  lons: number[];
  steps: number[];
  fields: { t2m_c: number[][][]; u10: number[][][]; v10: number[][][]; t850_c: number[][][] };
}

/** Storage token for the app identity: Container Apps / App Service managed identity,
 * else the developer's Azure CLI login (localhost). Node modules load lazily so this
 * file stays safe to import from client code (only the server-function handler runs it). */
async function storageToken(): Promise<string | null> {
  const resource = "https://storage.azure.com";
  const endpoint = process.env["IDENTITY_ENDPOINT"];
  const header = process.env["IDENTITY_HEADER"];
  try {
    if (endpoint && header) {
      const res = await fetch(`${endpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`, {
        headers: { "X-IDENTITY-HEADER": header },
      });
      return res.ok ? (((await res.json()) as { access_token?: string }).access_token ?? null) : null;
    }
    const { execFile } = await import("node:child_process");
    const shell = process.platform === "win32";
    const out = await new Promise<string>((resolve, reject) =>
      execFile(
        "az",
        ["account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        { shell, timeout: 30_000 },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
      ),
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function readAuroraFile(): Promise<AuroraCorridorFile | null> {
  const container = process.env["UPLOAD_CONTAINER_URL"];
  if (!container) return null;
  const token = await storageToken();
  if (!token) return null;
  const res = await fetch(`${container.replace(/\/$/, "")}/corridor-fields.json`, {
    headers: { Authorization: `Bearer ${token}`, "x-ms-version": "2021-08-06" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as AuroraCorridorFile;
}

/** Index and fraction of `v` within a monotonic axis (either direction). */
function bracket(axis: number[], v: number): [number, number] {
  const asc = axis[axis.length - 1]! > axis[0]!;
  let i = 0;
  while (i < axis.length - 2 && (asc ? axis[i + 1]! < v : axis[i + 1]! > v)) i++;
  const f = (v - axis[i]!) / (axis[i + 1]! - axis[i]!);
  return [i, Math.min(1, Math.max(0, f))];
}

/** Bilinear sample of one grid at (lat, lon); grids are [latIndex][lonIndex]. */
function bilinear(grid: number[][], lats: number[], lons: number[], lat: number, lon: number): number {
  const [i, fy] = bracket(lats, lat);
  const [j, fx] = bracket(lons, lon);
  const g = (a: number, b: number) => grid[a]![b]!;
  const top = g(i, j) * (1 - fx) + g(i, j + 1) * fx;
  const bot = g(i + 1, j) * (1 - fx) + g(i + 1, j + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

async function fetchAurora(): Promise<CorridorWeather> {
  if (auroraCache && Date.now() - auroraCache.at < GFS_TTL_MS) return auroraCache.val;
  const [file, gfs] = await Promise.all([readAuroraFile().catch(() => null), fetchGfs()]);
  if (!file) {
    return {
      source: "aurora",
      available: false,
      label: "Microsoft Aurora",
      detail:
        "No Aurora corridor forecast has been published yet. Deploy the Aurora GPU endpoint and run the forecast pipeline to generate corridor-fields.json.",
      issuedIso: new Date().toISOString(),
      hours: [],
      cells: [],
    };
  }
  const t0 = Date.parse(file.analysisTimeIso);
  const validMs = file.steps.map((s) => t0 + s * 3_600_000);
  // Keep only the GFS hours the Aurora run covers, so the two sources line up hour for hour.
  const keep = gfs.hours
    .map((iso, i) => ({ i, ms: Date.parse(iso) }))
    .filter(({ ms }) => ms >= validMs[0]! && ms <= validMs[validMs.length - 1]!);
  const interp = (arr: number[], ms: number) => {
    let k = 0;
    while (k < validMs.length - 2 && validMs[k + 1]! < ms) k++;
    const f = Math.min(1, Math.max(0, (ms - validMs[k]!) / (validMs[k + 1]! - validMs[k]!)));
    return arr[k]! * (1 - f) + arr[k + 1]! * f;
  };
  const cells: CellSeries[] = gfs.cells.map((c) => {
    const at = (field: number[][][]) =>
      file.steps.map((_, s) => bilinear(field[s]!, file.lats, file.lons, c.lat, c.lon));
    const t2 = at(file.fields.t2m_c);
    const u = at(file.fields.u10);
    const v = at(file.fields.v10);
    const t8 = at(file.fields.t850_c);
    const out: CellSeries = { key: c.key, lat: c.lat, lon: c.lon, t2m: [], wind: [], windDir: [], gust: [], precip: [], sw: [], t850: [] };
    for (const { i, ms } of keep) {
      const uu = interp(u, ms);
      const vv = interp(v, ms);
      const w = Math.hypot(uu, vv);
      const ratio = Math.min(2.2, Math.max(1.2, c.gust[i]! / Math.max(1, c.wind[i]!)));
      out.t2m.push(interp(t2, ms));
      out.wind.push(w);
      out.windDir.push((((270 - (Math.atan2(vv, uu) * 180) / Math.PI) % 360) + 360) % 360);
      out.gust.push(w * ratio);
      out.precip.push(c.precip[i]!);
      out.sw.push(c.sw[i]!);
      out.t850.push(interp(t8, ms));
    }
    return out;
  });
  const val: CorridorWeather = {
    source: "aurora",
    available: cells.length > 0 && keep.length > 0,
    label: "Microsoft Aurora",
    detail: `Aurora ${file.model} run from the ${file.analysisTimeIso.slice(0, 13)}Z analysis: temperature, wind and 850 hPa profile from Aurora; precipitation, gust ratio and sunshine from GFS at the same time.`,
    issuedIso: file.analysisTimeIso,
    hours: keep.map(({ i }) => gfs.hours[i]!),
    cells,
  };
  auroraCache = { at: Date.now(), val };
  return val;
}

function scenarioHours(): string[] {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  return Array.from({ length: HOURS }, (_, h) => new Date(start.getTime() + h * 3_600_000).toISOString());
}

const gauss = (x: number, w: number) => Math.exp(-((x / w) ** 2));

/** Deterministic synthetic weather. Hour 0 is now. */
function buildScenario(kind: "scenario-ice" | "scenario-heat"): CorridorWeather {
  const hours = scenarioHours();
  const cells: CellSeries[] = weatherCells().map((c) => {
    const s: CellSeries = { ...c, t2m: [], wind: [], windDir: [], gust: [], precip: [], sw: [], t850: [] };
    hours.forEach((iso, h) => {
      const localHour = (new Date(iso).getUTCHours() - 5 + 24) % 24;
      const sun = Math.max(0, Math.sin(((localHour - 6) / 12) * Math.PI));
      if (kind === "scenario-ice") {
        // Wedge of sub-freezing air dammed against the Appalachians: coldest to the north.
        const wedge = Math.min(1, Math.max(0, (c.lat - 32.4) / 1.8)) * (h >= 10 && h <= 66 ? 1 : 0.25);
        let t2 = 7 + 3 * sun - wedge * 9.5;
        // Warm, moist air overrunning the wedge: a precipitation shield sweeping west to east.
        const bandLon = -89.5 + (h - 10) * 0.25;
        const inBand = h >= 10 && h <= 66 ? gauss(c.lon - bandLon, 1.2) * (c.lat > 31.6 ? 1 : 0.35) : 0;
        let precip = 3.5 * inBand;
        let t850 = 4 + 3 * inBand;
        let wind = 4.5 + 3.5 * inBand;
        let dir = 60;
        let gust = wind * 1.5;
        // Day 4: a squall line races across south Alabama and south Georgia.
        const lineLon = -89 + (h - 76) * 0.42 + (c.lat - 30.5) * 0.6;
        if (h >= 72 && h <= 98 && c.lat < 33.6) {
          const near = gauss(c.lon - lineLon, 0.45);
          precip += 18 * near;
          wind = Math.max(wind, 9 + 12 * near);
          gust = Math.max(gust, 12 + 22 * near);
          dir = 240;
          t2 = Math.max(t2, 19 - 6 * near);
          t850 = 12;
        }
        s.t2m.push(t2);
        s.wind.push(wind);
        s.windDir.push(dir);
        s.gust.push(gust);
        s.precip.push(precip);
        s.sw.push(780 * sun * (1 - Math.min(1, inBand * 1.4)));
        s.t850.push(t850);
      } else {
        // Heat dome: hottest inland, light wind, strong sun, scattered afternoon storms.
        const inland = Math.min(1, Math.max(0, (c.lon + 81) / -5));
        const day = Math.floor(h / 24);
        const cellPhase = Math.abs(Math.sin(c.lat * 12.9898 + c.lon * 78.233 + day * 3.1));
        const storm = localHour >= 15 && localHour <= 19 && cellPhase > 0.86 ? (cellPhase - 0.86) / 0.14 : 0;
        const wind = 1.4 + 1.2 * (1 - sun) + 7 * storm;
        s.t2m.push(27 + 11 * sun + 2.5 * inland + Math.min(3, h / 30) - 8 * storm);
        s.wind.push(wind);
        s.windDir.push(200);
        s.gust.push(wind * 1.4 + 8 * storm);
        s.precip.push(22 * storm);
        s.sw.push(950 * sun * (1 - 0.8 * storm));
        s.t850.push(21);
      }
    });
    return s;
  });
  return {
    source: kind,
    available: true,
    label: kind === "scenario-ice" ? "Scenario: ice storm + squall line" : "Scenario: heat dome",
    detail:
      kind === "scenario-ice"
        ? "Synthetic demo: cold-air damming with freezing rain across north Georgia and Alabama (days 1–3), then a squall line through the south (day 4)."
        : "Synthetic demo: 38–41 °C afternoons with light winds and scattered afternoon thunderstorms.",
    issuedIso: hours[0]!,
    hours,
    cells,
  };
}

export const getCorridorWeather = createServerFn({ method: "GET" })
  .validator((data: { source: CorridorSource }) => data)
  .handler(async ({ data }): Promise<CorridorWeather> => {
    if (data.source === "scenario-ice" || data.source === "scenario-heat") return buildScenario(data.source);
    try {
      return data.source === "aurora" ? await fetchAurora() : await fetchGfs();
    } catch (e) {
      return {
        source: data.source,
        available: false,
        label: data.source === "aurora" ? "Microsoft Aurora" : "NOAA GFS 0.25°",
        detail: `Forecast unavailable: ${e instanceof Error ? e.message : String(e)}`,
        issuedIso: new Date().toISOString(),
        hours: [],
        cells: [],
      };
    }
  });
