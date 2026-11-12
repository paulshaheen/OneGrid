// Synthetic Aurora/GFS pair of the same November cold front ("norther") crossing the Gulf.
// GFS brings the front about 6 hours later and its post-frontal winds and seas about
// 15-20% lower. Pure and deterministic; safe for the client bundle.
import { OFFSHORE_SITES, frontArrival, type OffshoreWeather, type SiteSeries } from "./sites";

const HOURS = 120;

// ── Synthetic norther ────────────────────────────────────────────────────────
const MODEL = {
  aurora: { peakWind: 36, peakHs: 3.7, label: "Microsoft Aurora (synthetic)" },
  gfs: { peakWind: 30, peakHs: 3.0, label: "NOAA GFS (synthetic)" },
} as const;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function syntheticRun(model: keyof typeof MODEL): OffshoreWeather {
  const m = MODEL[model];
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const hours = Array.from({ length: HOURS }, (_, h) => new Date(start.getTime() + h * 3_600_000).toISOString());
  const sites = OFFSHORE_SITES.map((s, si): SiteSeries => {
    const arrive = frontArrival(model, s);
    const wind: number[] = [];
    const gust: number[] = [];
    const windDir: number[] = [];
    const hs: number[] = [];
    for (let h = 0; h < HOURS; h++) {
      const dt = h - arrive;
      const wiggle = 1 + 0.04 * Math.sin(h * 0.9 + si * 1.7);
      let w: number;
      let dir: number;
      if (dt < 0) {
        // Southeasterly ahead of the front, veering southwesterly as it nears.
        w = 11 + 7 * smooth(-18, 0, dt);
        dir = 140 + 60 * smooth(-18, 0, dt);
      } else {
        // Sharp northerly surge behind the front, easing over the next day.
        w = 15 + (m.peakWind - 15) * smooth(0, 5, dt) * (dt > 5 ? Math.exp(-(dt - 5) / 20) : 1);
        dir = 200 + 140 * smooth(0, 3, dt);
      }
      // Seas lag the wind by several hours.
      const wave = dt < 0 ? 0.9 + 0.5 * smooth(-18, 0, dt) : 1.4 + (m.peakHs - 1.4) * smooth(0, 10, dt) * (dt > 10 ? Math.exp(-(dt - 10) / 26) : 1);
      wind.push(round(w * wiggle, 1));
      gust.push(round(w * wiggle * 1.3, 1));
      windDir.push(Math.round(dir % 360));
      hs.push(round(wave * s.seaFactor * wiggle, 2));
    }
    return { id: s.id, wind, gust, windDir, hs };
  });
  return {
    source: model,
    available: true,
    label: m.label,
    detail: "Synthetic run of a November cold front crossing the Gulf, generated until a real Aurora marine run is published.",
    synthetic: true,
    issuedIso: start.toISOString(),
    hours,
    sites,
  };
}
