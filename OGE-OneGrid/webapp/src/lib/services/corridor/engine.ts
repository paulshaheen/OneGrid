// Transmission corridor analytics. Pure functions over (network × hourly weather):
//
//   • Wind / tree-fall outage risk — gust fragility scaled by corridor vegetation,
//     wetter soil and ice load, accumulated along the line into an outage probability.
//   • Ice accretion — CRREL "simple model" (Jones, 1998) radial ice from freezing rain
//     (sub-freezing surface under a warm layer aloft), with melt-off.
//   • Line ratings — IEEE 738 steady-state ampacity per sample point: the static rating
//     (40 °C, 0.61 m/s crosswind, full sun), the ambient-adjusted rating (FERC Order 881:
//     forecast temperature, day/night sun) and the dynamic line rating (forecast wind
//     speed and angle to the conductor, temperature and sunshine). The line rating is
//     its weakest point.
//   • Heat / load stress — temperature-driven loading against the ambient-adjusted rating.
//   • Crew pre-staging — expected faults per service area, the peak hour, crews needed
//     and mutual aid.
import {
  CONDUCTORS,
  SERVICE_AREAS,
  TX_LINES,
  cellKey,
  samplePoints,
  type AreaId,
  type Conductor,
  type ServiceArea,
  type TxLine,
} from "@/lib/data/se-transmission";
import type { CellSeries, CorridorWeather } from "@/lib/services/corridor/server";

// ── IEEE 738 (SI form) ───────────────────────────────────────────────────────
const STATIC = { ambientC: 40, windMs: 0.61, angleDeg: 90, solarWm2: 1000 };
/** Conductor height above ground used for air density (m above sea level, Southeast avg). */
const ELEVATION_M = 150;

function resistanceAt(c: Conductor, tc: number): number {
  return c.r25 + ((c.r75 - c.r25) / 50) * (tc - 25);
}

/** Steady-state ampacity of one sub-conductor (A). */
export function ampacity(
  c: Conductor,
  ambientC: number,
  windMs: number,
  angleDeg: number,
  solarWm2: number,
): number {
  const tc = c.motC;
  const tFilm = (tc + ambientC) / 2;
  const d = c.diameterM;
  const mu = (1.458e-6 * (tFilm + 273) ** 1.5) / (tFilm + 383.4);
  const rho = (1.293 - 1.525e-4 * ELEVATION_M + 6.379e-9 * ELEVATION_M ** 2) / (1 + 0.00367 * tFilm);
  const k = 2.424e-2 + 7.477e-5 * tFilm - 4.407e-9 * tFilm ** 2;
  const phi = (Math.min(90, Math.max(0, angleDeg)) * Math.PI) / 180;
  const kAngle = 1.194 - Math.cos(phi) + 0.194 * Math.cos(2 * phi) + 0.368 * Math.sin(2 * phi);
  const nre = (d * rho * Math.max(0, windMs)) / mu;
  const dT = tc - ambientC;
  const qc1 = kAngle * (1.01 + 1.35 * nre ** 0.52) * k * dT;
  const qc2 = kAngle * 0.754 * nre ** 0.6 * k * dT;
  const qcn = 3.645 * Math.sqrt(rho) * d ** 0.75 * dT ** 1.25;
  const qc = Math.max(qc1, qc2, qcn);
  const qr = 17.8 * d * c.emissivity * (((tc + 273) / 100) ** 4 - ((ambientC + 273) / 100) ** 4);
  const qs = c.absorptivity * solarWm2 * d;
  const heatOut = qc + qr - qs;
  return heatOut > 0 ? Math.sqrt(heatOut / resistanceAt(c, tc)) : 0;
}

export function staticRating(line: TxLine): number {
  return ampacity(CONDUCTORS[line.conductor], STATIC.ambientC, STATIC.windMs, STATIC.angleDeg, STATIC.solarWm2) * line.bundle;
}

/** Angle between the wind and the conductor axis (0–90°). */
function attackAngle(windFromDeg: number, conductorAzDeg: number): number {
  const d = Math.abs(((windFromDeg - conductorAzDeg) % 180 + 180) % 180);
  return d > 90 ? 180 - d : d;
}

// ── Ice accretion (CRREL simple model) ───────────────────────────────────────
const RHO_ICE = 0.9;
const RHO_WATER = 1.0;

/** Radial ice (mm) added in one hour of freezing rain. */
export function iceIncrement(precipMm: number, windMs: number): number {
  if (precipMm <= 0) return 0;
  const lwc = 0.067 * precipMm ** 0.846;
  return Math.sqrt((precipMm * RHO_WATER) ** 2 + (3.6 * windMs * lwc) ** 2) / (RHO_ICE * Math.PI);
}

const isFreezingRain = (t2m: number, t850: number, precip: number) =>
  precip >= 0.2 && t2m <= 0.5 && t2m >= -8 && t850 > 0;

export function iceClass(mm: number): { label: string; tone: Level } {
  if (mm >= 19) return { label: "Severe (≥ ¾ in)", tone: "critical" };
  if (mm >= 12.7) return { label: "Damaging (≥ ½ in)", tone: "high" };
  if (mm >= 6.35) return { label: "Significant (≥ ¼ in)", tone: "elevated" };
  if (mm >= 2) return { label: "Light glaze", tone: "monitor" };
  return { label: "None", tone: "normal" };
}

// ── Fault model ──────────────────────────────────────────────────────────────
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
/** Fault rate per km per hour of corridor. */
function faultRate(gustMs: number, iceMm: number, vegetation: number, soilWet: boolean): number {
  const gustMph = gustMs * 2.237;
  // Ice-laden conductors and trees fail at lower gusts. Below 40 mph gusts (and ¼ in
  // of ice) transmission corridors built to clearance standards essentially don't fault.
  const windTerm = gustMph < 40 ? 0 : logistic((gustMph - 62 + Math.min(15, iceMm * 0.8)) / 4.5);
  const iceTerm = iceMm < 6.35 ? 0 : logistic((iceMm - 14) / 2.5);
  const exposure = 0.25 + vegetation;
  return (0.0015 * windTerm * (soilWet ? 1.4 : 1) + 0.0008 * iceTerm) * exposure;
}

// ── Load model ───────────────────────────────────────────────────────────────
/** Loading as a share of the static rating, driven by temperature and time of day. */
function loadingPct(base: number, tempC: number, iso: string): number {
  const local = (new Date(iso).getUTCHours() - 5 + 24) % 24;
  const cooling = 0.03 * Math.max(0, tempC - 24);
  const heating = 0.02 * Math.max(0, 8 - tempC);
  const diurnal = 0.8 + 0.2 * Math.max(0, Math.sin(((local - 9) / 12) * Math.PI));
  return base * (1 + cooling + heating) * diurnal;
}

// ── Results ──────────────────────────────────────────────────────────────────
export type Level = "normal" | "monitor" | "elevated" | "high" | "critical";
export const levelFromScore = (s: number): Level =>
  s >= 80 ? "critical" : s >= 62 ? "high" : s >= 42 ? "elevated" : s >= 22 ? "monitor" : "normal";

export interface LineHour {
  gustMs: number;
  windMs: number;
  minTempC: number;
  maxTempC: number;
  iceMm: number;
  freezingRain: boolean;
  /** Dynamic line rating (A) and share of the static rating. */
  dlrA: number;
  dlrPct: number;
  /** Ambient-adjusted rating (A) and share of the static rating. */
  aarA: number;
  aarPct: number;
  /** Forecast loading as a share of the ambient-adjusted rating. */
  loadPctOfAar: number;
  /** Cumulative probability the line has faulted by this hour. */
  faultProb: number;
}

export interface LineResult {
  line: TxLine;
  lengthKm: number;
  staticA: number;
  hours: LineHour[];
  peakGust: { ms: number; hour: number };
  peakIce: { mm: number; hour: number };
  minDlr: { pct: number; hour: number };
  maxDlr: { pct: number; hour: number };
  peakLoad: { pct: number; hour: number };
  faultProb: number;
  scores: { wind: number; ice: number; rating: number; heat: number };
  score: number;
  level: Level;
  drivers: string[];
}

export interface AreaPlan {
  area: ServiceArea;
  expectedFaults: number;
  peakHour: number | null;
  linesAtRisk: { id: string; name: string; prob: number }[];
  crewsNeeded: number;
  crewsAvailable: number;
  mutualAid: number;
  stageByHour: number | null;
  primaryHazard: "wind" | "ice" | "heat" | "none";
}

export interface CorridorAnalysis {
  hours: string[];
  lines: LineResult[];
  areas: AreaPlan[];
  totals: {
    expectedFaults: number;
    crewsNeeded: number;
    mutualAid: number;
    linesAtRisk: number;
    /** Median extra capacity the dynamic rating gives over the ambient-adjusted rating. */
    dlrUpliftPct: number;
    /** Lines whose dynamic rating drops below the ambient-adjusted rating at some hour. */
    linesBelowAar: number;
  };
}

function nearestCell(cells: CellSeries[], lat: number, lon: number): CellSeries {
  let best = cells[0]!;
  let d = Infinity;
  for (const c of cells) {
    const dd = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (dd < d) {
      d = dd;
      best = c;
    }
  }
  return best;
}

const clamp100 = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export function analyzeCorridors(weather: CorridorWeather): CorridorAnalysis {
  const hours = weather.hours;
  const n = hours.length;
  const byKey = new Map(weather.cells.map((c) => [c.key, c]));
  const lines: LineResult[] = TX_LINES.map((line) => {
    const cond = CONDUCTORS[line.conductor];
    const staticA = staticRating(line);
    const pts = samplePoints(line).map((p) => ({
      ...p,
      cell: byKey.get(cellKey(p.lat, p.lon)) ?? nearestCell(weather.cells, p.lat, p.lon),
      ice: 0,
      wet: [] as number[],
    }));
    const lengthKm = pts.reduce((s, p) => s + p.km, 0);
    let survive = 1;
    const out: LineHour[] = [];
    for (let h = 0; h < n; h++) {
      let gust = 0, wind = 0, minT = Infinity, maxT = -Infinity, ice = 0, fz = false;
      let dlr = Infinity, aar = Infinity, rate = 0;
      for (const p of pts) {
        const c = p.cell;
        const t = c.t2m[h]!, w = c.wind[h]!, g = c.gust[h]!, pr = c.precip[h]!, sw = c.sw[h]!;
        if (isFreezingRain(t, c.t850[h]!, pr)) {
          p.ice += iceIncrement(pr, w);
          fz = true;
        } else if (p.ice > 0 && t > 1) {
          p.ice = Math.max(0, p.ice - 0.35 * (t - 1) - (sw > 200 ? 0.5 : 0));
        }
        p.wet.push(pr);
        const wet48 = p.wet.slice(-48).reduce((a, b) => a + b, 0) > 40;
        rate += faultRate(g, p.ice, line.vegetation, wet48) * p.km;
        const angle = attackAngle(c.windDir[h]!, p.azimuthDeg);
        // Sheltered conductor-height wind, floored so calm hours stay conservative.
        const vEff = Math.max(0.5, 0.8 * w);
        dlr = Math.min(dlr, ampacity(cond, t, vEff, angle, sw));
        aar = Math.min(aar, ampacity(cond, t, STATIC.windMs, STATIC.angleDeg, sw > 50 ? 1000 : 0));
        gust = Math.max(gust, g);
        wind = Math.max(wind, w);
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
        ice = Math.max(ice, p.ice);
      }
      survive *= Math.exp(-rate);
      const dlrA = dlr * line.bundle;
      const aarA = aar * line.bundle;
      const loadA = (staticA * loadingPct(line.baseLoadingPct, maxT, hours[h]!)) / 100;
      out.push({
        gustMs: gust,
        windMs: wind,
        minTempC: minT,
        maxTempC: maxT,
        iceMm: ice,
        freezingRain: fz,
        dlrA,
        dlrPct: (dlrA / staticA) * 100,
        aarA,
        aarPct: (aarA / staticA) * 100,
        loadPctOfAar: aarA > 0 ? (loadA / aarA) * 100 : 0,
        faultProb: 1 - survive,
      });
    }
    const argmax = (f: (x: LineHour) => number) =>
      out.reduce((b, x, i) => (f(x) > f(out[b]!) ? i : b), 0);
    const argmin = (f: (x: LineHour) => number) =>
      out.reduce((b, x, i) => (f(x) < f(out[b]!) ? i : b), 0);
    const gi = argmax((x) => x.gustMs);
    const ii = argmax((x) => x.iceMm);
    const di = argmin((x) => x.dlrPct);
    const dx = argmax((x) => x.dlrPct);
    const li = argmax((x) => x.loadPctOfAar);
    const faultProb = out[n - 1]?.faultProb ?? 0;
    const peakLoad = out[li]?.loadPctOfAar ?? 0;
    const minDlrPct = out[di]?.dlrPct ?? 100;
    const scores = {
      wind: clamp100(faultProb * 100 * (line.critical ? 1.15 : 1)),
      ice: clamp100(((out[ii]?.iceMm ?? 0) / 19) * 100),
      rating: clamp100(((100 - minDlrPct) / 40) * 100 * (minDlrPct < 100 ? 1 : 0)),
      heat: clamp100(((peakLoad - 70) / 30) * 100),
    };
    const score = Math.max(scores.wind, scores.ice, scores.heat, Math.round(scores.rating * 0.8));
    const drivers: string[] = [];
    const hourLabel = (i: number) => `+${i} h`;
    if (scores.wind >= 22)
      drivers.push(`${Math.round(faultProb * 100)}% chance of a wind/tree fault — gusts to ${Math.round((out[gi]?.gustMs ?? 0) * 2.237)} mph at ${hourLabel(gi)} through ${Math.round(line.vegetation * 100)}% vegetated corridor`);
    if (scores.ice >= 22) drivers.push(`${((out[ii]?.iceMm ?? 0) / 25.4).toFixed(2)} in radial ice by ${hourLabel(ii)} (${iceClass(out[ii]?.iceMm ?? 0).label.toLowerCase()})`);
    if (scores.rating >= 22) drivers.push(`Rating falls to ${Math.round(minDlrPct)}% of static at ${hourLabel(di)} (calm, hot or sunny)`);
    if (scores.heat >= 22) drivers.push(`Loading reaches ${Math.round(peakLoad)}% of the ambient-adjusted rating at ${hourLabel(li)}`);
    if (!drivers.length) drivers.push("No significant weather stress in the forecast window");
    return {
      line,
      lengthKm,
      staticA,
      hours: out,
      peakGust: { ms: out[gi]?.gustMs ?? 0, hour: gi },
      peakIce: { mm: out[ii]?.iceMm ?? 0, hour: ii },
      minDlr: { pct: minDlrPct, hour: di },
      maxDlr: { pct: out[dx]?.dlrPct ?? 100, hour: dx },
      peakLoad: { pct: peakLoad, hour: li },
      faultProb,
      scores,
      score,
      level: levelFromScore(score),
      drivers,
    };
  });

  const areas: AreaPlan[] = SERVICE_AREAS.map((area) => {
    const ls = lines.filter((l) => l.line.area === area.id);
    const expectedFaults = ls.reduce((s, l) => s + l.faultProb, 0);
    // Hour of fastest fault accumulation across the area = when the damage happens.
    let peakHour: number | null = null;
    let best = 0;
    for (let h = 1; h < n; h++) {
      const inc = ls.reduce((s, l) => s + l.hours[h]!.faultProb - l.hours[h - 1]!.faultProb, 0);
      if (inc > best) {
        best = inc;
        peakHour = h;
      }
    }
    if (best < 0.002) peakHour = null;
    // Two crews per expected fault (patrol + repair), keeping 40% of local crews on normal work.
    const crewsNeeded = Math.ceil(expectedFaults * 2 - 0.15);
    const crewsAvailable = Math.floor(area.crews * 0.6);
    const iceMax = Math.max(0, ...ls.map((l) => l.peakIce.mm));
    const gustMax = Math.max(0, ...ls.map((l) => l.peakGust.ms));
    const heatMax = Math.max(0, ...ls.map((l) => l.peakLoad.pct));
    const primaryHazard: AreaPlan["primaryHazard"] =
      iceMax >= 6.35 ? "ice" : gustMax * 2.237 >= 50 ? "wind" : heatMax >= 90 ? "heat" : "none";
    return {
      area,
      expectedFaults,
      peakHour,
      linesAtRisk: ls
        .filter((l) => l.faultProb >= 0.05)
        .sort((a, b) => b.faultProb - a.faultProb)
        .map((l) => ({ id: l.line.id, name: l.line.name, prob: l.faultProb })),
      crewsNeeded: Math.max(0, crewsNeeded),
      crewsAvailable,
      mutualAid: Math.max(0, crewsNeeded - crewsAvailable),
      stageByHour: peakHour === null ? null : Math.max(0, peakHour - 12),
      primaryHazard,
    };
  });

  const ratios = lines
    .flatMap((l) => l.hours.filter((h) => h.aarA > 0).map((h) => h.dlrA / h.aarA - 1))
    .sort((a, b) => a - b);
  const dlrUpliftPct = ratios.length ? ratios[Math.floor(ratios.length / 2)]! * 100 : 0;

  return {
    hours,
    lines,
    areas,
    totals: {
      expectedFaults: areas.reduce((s, a) => s + a.expectedFaults, 0),
      crewsNeeded: areas.reduce((s, a) => s + a.crewsNeeded, 0),
      mutualAid: areas.reduce((s, a) => s + a.mutualAid, 0),
      linesAtRisk: lines.filter((l) => l.level !== "normal").length,
      dlrUpliftPct,
      linesBelowAar: lines.filter((l) => l.hours.some((h) => h.dlrA < h.aarA)).length,
    },
  };
}

export const AREA_NAME: Record<AreaId, string> = Object.fromEntries(
  SERVICE_AREAS.map((a) => [a.id, a.name]),
) as Record<AreaId, string>;
