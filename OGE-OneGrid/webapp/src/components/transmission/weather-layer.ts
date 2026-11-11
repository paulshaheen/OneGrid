// Client-side weather layer for the Transmission Weather map: bilinearly interpolates
// the regional 0.5° forecast grid into a smooth, semi-transparent image (precipitation
// by type, temperature or wind gusts) and builds wind-arrow features.
import type { FeatureCollection } from "geojson";

import type { CorridorWeather } from "@/lib/services/corridor/server";

export type WxLayer = "precip" | "temp" | "gust" | "off";
type Rgba = [number, number, number, number];
type Stop = [number, Rgba];

const TEMP: Stop[] = [
  [-10, [107, 63, 160, 150]],
  [0, [59, 130, 246, 150]],
  [10, [34, 195, 195, 140]],
  [20, [240, 212, 58, 140]],
  [30, [255, 138, 61, 155]],
  [40, [214, 47, 47, 170]],
];
const GUST: Stop[] = [
  [0, [40, 90, 170, 45]],
  [12, [74, 163, 255, 100]],
  [22, [47, 191, 113, 140]],
  [32, [240, 180, 41, 165]],
  [45, [255, 138, 61, 185]],
  [60, [255, 77, 94, 205]],
  [80, [192, 38, 211, 220]],
];
const RAIN: Stop[] = [
  [0.05, [34, 160, 90, 0]],
  [0.3, [34, 160, 90, 90]],
  [1, [60, 200, 90, 140]],
  [3, [240, 212, 58, 175]],
  [8, [255, 138, 61, 195]],
  [15, [255, 60, 60, 210]],
  [30, [192, 38, 211, 225]],
];
const FZRA: Stop[] = [
  [0.05, [255, 140, 220, 0]],
  [0.3, [255, 140, 220, 120]],
  [1, [255, 90, 200, 170]],
  [4, [214, 40, 170, 215]],
];
const SNOW: Stop[] = [
  [0.05, [225, 232, 255, 0]],
  [0.3, [225, 232, 255, 100]],
  [1, [240, 244, 255, 160]],
  [4, [255, 255, 255, 210]],
];

function ramp(stops: Stop[], v: number): Rgba {
  if (v <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]!;
    if (v <= b) {
      const [a, ca] = stops[i - 1]!;
      const f = (v - a) / (b - a);
      return [0, 1, 2, 3].map((k) => ca[k]! + (cb[k]! - ca[k]!) * f) as Rgba;
    }
  }
  return stops[stops.length - 1]![1];
}

export const WX_LEGEND: Record<Exclude<WxLayer, "off">, { title: string; stops: [string, string][] }> = {
  precip: {
    title: "Precipitation (mm/h)",
    stops: [["rgb(60,200,90)", "Rain 1"], ["rgb(240,212,58)", "3"], ["rgb(255,60,60)", "15+"], ["rgb(255,90,200)", "Freezing rain"], ["rgb(240,244,255)", "Snow"]],
  },
  temp: {
    title: "Air temperature (°C)",
    stops: [["rgb(59,130,246)", "0"], ["rgb(34,195,195)", "10"], ["rgb(240,212,58)", "20"], ["rgb(255,138,61)", "30"], ["rgb(214,47,47)", "40"]],
  },
  gust: {
    title: "Wind gusts (mph)",
    stops: [["rgb(74,163,255)", "12"], ["rgb(47,191,113)", "22"], ["rgb(240,180,41)", "32"], ["rgb(255,138,61)", "45"], ["rgb(255,77,94)", "60+"]],
  },
};

const PX_PER_CELL = 18;

/** Smooth weather image for hour `h` and the map corners it covers, or null. */
export function renderWeather(
  w: CorridorWeather | undefined,
  layer: WxLayer,
  h: number,
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null {
  const g = w?.grid;
  if (!g || layer === "off" || typeof document === "undefined") return null;
  const nLat = g.lats.length;
  const nLon = g.lons.length;
  const W = (nLon - 1) * PX_PER_CELL;
  const H = (nLat - 1) * PX_PER_CELL;
  const at = (k: "t2m" | "gust" | "precip" | "t850", i: number, j: number) => g.cells[i * nLon + j]?.[k][h] ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const gy = (y / (H - 1)) * (nLat - 1);
    const i = Math.min(nLat - 2, Math.floor(gy));
    const fy = gy - i;
    for (let x = 0; x < W; x++) {
      const gx = (x / (W - 1)) * (nLon - 1);
      const j = Math.min(nLon - 2, Math.floor(gx));
      const fx = gx - j;
      const bi = (k: "t2m" | "gust" | "precip" | "t850") =>
        (at(k, i, j) * (1 - fx) + at(k, i, j + 1) * fx) * (1 - fy) +
        (at(k, i + 1, j) * (1 - fx) + at(k, i + 1, j + 1) * fx) * fy;
      let c: Rgba;
      if (layer === "temp") c = ramp(TEMP, bi("t2m"));
      else if (layer === "gust") c = ramp(GUST, bi("gust") * 2.237);
      else {
        const p = bi("precip");
        if (p < 0.05) c = [0, 0, 0, 0];
        else {
          const t = bi("t2m");
          c = t <= 0.5 ? ramp(bi("t850") > 0 ? FZRA : SNOW, p) : ramp(RAIN, p);
        }
      }
      // Feather the outer edge so the field fades into the basemap instead of ending in a box.
      const edge = Math.min(x, W - 1 - x, y, H - 1 - y) / (PX_PER_CELL * 1.5);
      const o = (y * W + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = c[3] * Math.min(1, edge);
    }
  }
  ctx.putImageData(img, 0, 0);
  const west = g.lons[0]!, east = g.lons[nLon - 1]!, north = g.lats[0]!, south = g.lats[nLat - 1]!;
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/** Wind arrows every 1° (every other grid point), pointing where the wind blows to. */
export function windArrows(w: CorridorWeather | undefined, h: number): FeatureCollection {
  const g = w?.grid;
  if (!g) return { type: "FeatureCollection", features: [] };
  const nLon = g.lons.length;
  return {
    type: "FeatureCollection",
    features: g.cells
      .map((c, k) => ({ c, i: Math.floor(k / nLon), j: k % nLon }))
      .filter(({ i, j }) => i % 2 === 0 && j % 2 === 0)
      .map(({ c }) => ({
        type: "Feature" as const,
        properties: {
          rot: ((c.windDir[h] ?? 0) + 180) % 360,
          mph: Math.round((c.wind[h] ?? 0) * 2.237),
        },
        geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
      })),
  };
}

/** Region-wide readout of the weather at hour `h`. */
export function weatherSummary(w: CorridorWeather | undefined, h: number) {
  const cells = w?.grid?.cells ?? w?.cells ?? [];
  if (!cells.length) return null;
  let maxGust = 0, minT = Infinity, maxT = -Infinity, maxP = 0, fz = 0, sn = 0, rain = 0;
  for (const c of cells) {
    const t = c.t2m[h] ?? 0, p = c.precip[h] ?? 0;
    maxGust = Math.max(maxGust, c.gust[h] ?? 0);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    maxP = Math.max(maxP, p);
    if (p >= 0.1) {
      if (t <= 0.5) (c.t850[h] ?? 0) > 0 ? fz++ : sn++;
      else rain++;
    }
  }
  const share = (n: number) => Math.round((n / cells.length) * 100);
  return { maxGustMph: maxGust * 2.237, minT, maxT, maxP, rainPct: share(rain), fzPct: share(fz), snowPct: share(sn) };
}
