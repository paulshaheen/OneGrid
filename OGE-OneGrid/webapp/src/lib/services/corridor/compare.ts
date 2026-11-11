// Aurora vs NOAA GFS: hour alignment, the illustrative baseline used when no Aurora
// corridor run has been published, and the decision-level differences between two
// analyses. Pure functions, safe for the client bundle.
import type { CellSeries, CorridorWeather } from "@/lib/services/corridor/server";
import { focusItems, type CorridorAnalysis, type FocusItem, type Level } from "@/lib/services/corridor/engine";

const RANK: Record<Level, number> = { normal: 0, monitor: 1, elevated: 2, high: 3, critical: 4 };

/** Trim `base` to the valid times in `hours`, so both forecasts cover the same window. */
export function alignHours(base: CorridorWeather, hours: string[]): CorridorWeather {
  const idx = hours.map((iso) => base.hours.indexOf(iso)).filter((i) => i >= 0);
  if (idx.length === base.hours.length) return base;
  const pick = (s: CellSeries): CellSeries => ({
    ...s,
    t2m: idx.map((i) => s.t2m[i]!),
    wind: idx.map((i) => s.wind[i]!),
    windDir: idx.map((i) => s.windDir[i]!),
    gust: idx.map((i) => s.gust[i]!),
    precip: idx.map((i) => s.precip[i]!),
    sw: idx.map((i) => s.sw[i]!),
    t850: idx.map((i) => s.t850[i]!),
  });
  return {
    ...base,
    hours: idx.map((i) => base.hours[i]!),
    cells: base.cells.map(pick),
    grid: base.grid ? { ...base.grid, cells: base.grid.cells.map(pick) } : null,
  };
}

export const ILLUSTRATIVE_NOTE =
  "Illustrative: both forecasts are synthetic. “Aurora” is the ice-storm scenario; “NOAA GFS” is the same storm with two differences forecasters often see between models in Southeast ice events: the cold-air wedge eroding about 2 °C too fast, and the day-4 squall line arriving 6 hours later and 15% weaker. It shows how a forecast difference becomes a different line, crew and rating decision. It is not a measured Aurora result; a live comparison replaces it as soon as an Aurora corridor run is published.";

/** The baseline for the illustrative comparison, derived from the ice-storm scenario. */
export function illustrativeGfs(w: CorridorWeather): CorridorWeather {
  const LAG = 6;
  const SQUALL_FROM = 70;
  const shift = (s: CellSeries): CellSeries => {
    const out: CellSeries = { ...s, t2m: [], wind: [], windDir: [], gust: [], precip: [], sw: [...s.sw], t850: [] };
    for (let h = 0; h < s.t2m.length; h++) {
      const src = h >= SQUALL_FROM ? Math.max(0, h - LAG) : h;
      const lateSquall = h >= SQUALL_FROM;
      const t = s.t2m[src]!;
      // Warm bias in the shallow cold wedge: largest near freezing, gone by 5 °C.
      const warm = t < 5 ? 2 * Math.min(1, (5 - t) / 4) : 0;
      out.t2m.push(t + warm);
      out.wind.push(s.wind[src]! * (lateSquall ? 0.85 : 1));
      out.windDir.push(s.windDir[src]!);
      out.gust.push(s.gust[src]! * (lateSquall ? 0.85 : 1));
      out.precip.push(s.precip[src]!);
      out.t850.push(s.t850[src]!);
    }
    return out;
  };
  return {
    ...w,
    source: "gfs",
    label: "NOAA GFS (illustrative)",
    detail: "Synthetic baseline for the illustrative comparison.",
    cells: w.cells.map(shift),
    grid: w.grid ? { ...w.grid, cells: w.grid.cells.map(shift) } : null,
  };
}

/** Hour when the network's fault probability rises fastest, or null if it never rises. */
function peakDamageHour(a: CorridorAnalysis): number | null {
  let best = 0;
  let at: number | null = null;
  for (let h = 1; h < a.hours.length; h++) {
    let inc = 0;
    for (const l of a.lines) inc += (l.hours[h]?.faultProb ?? 0) - (l.hours[h - 1]?.faultProb ?? 0);
    if (inc > best) {
      best = inc;
      at = h;
    }
  }
  return best > 0.02 ? at : null;
}

export interface DecisionDiff {
  /** Lines at High or worse in Aurora but not in GFS: GFS would leave them unprotected. */
  onlyAurora: { name: string; aurora: Level; gfs: Level; kind: FocusItem["kind"] }[];
  /** Lines at High or worse in GFS but not in Aurora: crews GFS would send for nothing. */
  onlyGfs: { name: string; aurora: Level; gfs: Level; kind: FocusItem["kind"] }[];
  crews: { area: string; aurora: number; gfs: number }[];
  faults: { aurora: number; gfs: number };
  crewTotal: { aurora: number; gfs: number };
  iceLines: { aurora: number; gfs: number };
  peakHour: { aurora: number | null; gfs: number | null };
  /** Baseline level for each focus item id, to tag the Where-to-focus cards. */
  baselineLevel: Map<string, Level>;
}

export function decisionDiff(aurora: CorridorAnalysis, gfs: CorridorAnalysis): DecisionDiff {
  const aAll = focusItems(aurora);
  const gAll = focusItems(gfs);
  const ai = aAll.filter((i) => i.lineId);
  const gi = gAll.filter((i) => i.lineId);
  const gMap = new Map(gAll.map((i) => [i.id, i.level]));
  const aMap = new Map(aAll.map((i) => [i.id, i.level]));
  const lvl = (m: Map<string, Level>, id: string): Level => m.get(id) ?? "normal";
  const onlyAurora = ai
    .filter((i) => RANK[i.level] >= RANK.high && RANK[lvl(gMap, i.id)] < RANK.high)
    .map((i) => ({ name: i.title, aurora: i.level, gfs: lvl(gMap, i.id), kind: i.kind }));
  const onlyGfs = gi
    .filter((i) => RANK[i.level] >= RANK.high && RANK[lvl(aMap, i.id)] < RANK.high)
    .map((i) => ({ name: i.title, aurora: lvl(aMap, i.id), gfs: i.level, kind: i.kind }));
  const gAreas = new Map(gfs.areas.map((p) => [p.area.id, p.crewsNeeded]));
  const crews = aurora.areas
    .map((p) => ({ area: p.area.name, aurora: p.crewsNeeded, gfs: gAreas.get(p.area.id) ?? 0 }))
    .filter((c) => c.aurora !== c.gfs)
    .sort((x, y) => Math.abs(y.aurora - y.gfs) - Math.abs(x.aurora - x.gfs));
  const iced = (a: CorridorAnalysis) => a.lines.filter((l) => l.peakIce.mm >= 6.35).length;
  const baselineLevel = new Map<string, Level>();
  for (const i of aAll) baselineLevel.set(i.id, lvl(gMap, i.id));
  return {
    onlyAurora,
    onlyGfs,
    crews,
    faults: { aurora: aurora.totals.expectedFaults, gfs: gfs.totals.expectedFaults },
    crewTotal: { aurora: aurora.totals.crewsNeeded, gfs: gfs.totals.crewsNeeded },
    iceLines: { aurora: iced(aurora), gfs: iced(gfs) },
    peakHour: { aurora: peakDamageHour(aurora), gfs: peakDamageHour(gfs) },
    baselineLevel,
  };
}
