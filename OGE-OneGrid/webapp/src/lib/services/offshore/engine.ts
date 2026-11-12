// Offshore operations engine: which marine operations can run each hour at each site,
// when each window closes, and which decisions change between two forecasts.
// Limits are illustrative; real limits come from each asset's marine operations manual.
// Pure functions, safe for the client bundle.
import { OFFSHORE_SITES, type OffshoreSite, type OffshoreWeather, type SiteSeries } from "./sites";

export type Go = "go" | "marginal" | "stop";

export interface Operation {
  id: "riser" | "heli" | "supply" | "crane" | "transfer";
  label: string;
  limitText: string;
  /** Hours of notice the operation needs before the window closes. */
  leadH: number;
  applies: (s: OffshoreSite) => boolean;
  /** Worst ratio of a weather value to its limit; 1 or more means stop. */
  ratio: (w: { wind: number; gust: number; hs: number }) => number;
}

export const OPERATIONS: Operation[] = [
  {
    id: "riser",
    label: "Riser running",
    limitText: "wind < 30 kt, seas < 2.5 m",
    leadH: 12,
    applies: (s) => s.kind === "drillship",
    ratio: (w) => Math.max(w.wind / 30, w.hs / 2.5),
  },
  {
    id: "heli",
    label: "Helicopter crew change",
    limitText: "gusts < 45 kt",
    leadH: 0,
    applies: (s) => s.kind !== "base",
    ratio: (w) => w.gust / 45,
  },
  {
    id: "supply",
    label: "Supply vessel offload",
    limitText: "seas < 3 m",
    leadH: 0,
    applies: (s) => s.kind !== "base",
    ratio: (w) => w.hs / 3,
  },
  {
    id: "crane",
    label: "Crane lifts",
    limitText: "wind < 30 kt, seas < 2.5 m",
    leadH: 0,
    applies: (s) => s.kind === "platform",
    ratio: (w) => Math.max(w.wind / 30, w.hs / 2.5),
  },
  {
    id: "transfer",
    label: "Personnel transfer by boat",
    limitText: "wind < 25 kt, seas < 2 m",
    leadH: 0,
    applies: (s) => s.kind !== "base",
    ratio: (w) => Math.max(w.wind / 25, w.hs / 2),
  },
];
export const OP_BY_ID = new Map(OPERATIONS.map((o) => [o.id, o]));

const goFor = (r: number): Go => (r >= 1 ? "stop" : r >= 0.85 ? "marginal" : "go");

export interface OpWindow {
  siteId: string;
  opId: Operation["id"];
  status: Go[];
  /** First hour the operation must stop, or null if it can run all week. */
  firstStop: number | null;
  stopHours: number;
}

export interface OffshoreAnalysis {
  hours: string[];
  windows: OpWindow[];
  /** Worst status at each site, each hour. */
  siteStatus: Map<string, Go[]>;
  peak: { hs: number; hsSite: string; gust: number; gustSite: string };
}

export function analyze(w: OffshoreWeather): OffshoreAnalysis {
  const series = new Map(w.sites.map((s) => [s.id, s]));
  const windows: OpWindow[] = [];
  const siteStatus = new Map<string, Go[]>();
  let peak = { hs: 0, hsSite: "", gust: 0, gustSite: "" };
  for (const site of OFFSHORE_SITES) {
    const s: SiteSeries | undefined = series.get(site.id);
    if (!s) continue;
    const worst: Go[] = w.hours.map(() => "go");
    for (const op of OPERATIONS.filter((o) => o.applies(site))) {
      const status = w.hours.map((_, h) => goFor(op.ratio({ wind: s.wind[h] ?? 0, gust: s.gust[h] ?? 0, hs: s.hs[h] ?? 0 })));
      status.forEach((g, h) => {
        if (g === "stop" || (g === "marginal" && worst[h] === "go")) worst[h] = g;
      });
      const first = status.indexOf("stop");
      windows.push({ siteId: site.id, opId: op.id, status, firstStop: first >= 0 ? first : null, stopHours: status.filter((g) => g === "stop").length });
    }
    siteStatus.set(site.id, worst);
    s.hs.forEach((v) => {
      if (v > peak.hs) peak = { ...peak, hs: v, hsSite: site.id };
    });
    if (site.kind !== "base")
      s.gust.forEach((v) => {
        if (v > peak.gust) peak = { ...peak, gust: v, gustSite: site.id };
      });
  }
  return { hours: w.hours, windows, siteStatus, peak };
}

export interface ChangedDecision {
  siteId: string;
  opId: Operation["id"];
  /** Hour the action must happen by under each forecast (null: not needed). */
  aurora: number | null;
  baseline: number | null;
  /** How many hours earlier Aurora says to act (Infinity if the baseline never stops). */
  leadH: number;
}

const PRIORITY: Operation["id"][] = ["riser", "heli", "supply", "crane", "transfer"];

/** Decisions whose timing changes by 3 hours or more between the two forecasts. */
export function changedDecisions(aurora: OffshoreAnalysis, baseline: OffshoreAnalysis): ChangedDecision[] {
  const base = new Map(baseline.windows.map((w) => [`${w.siteId}|${w.opId}`, w]));
  const out: ChangedDecision[] = [];
  for (const a of aurora.windows) {
    const g = base.get(`${a.siteId}|${a.opId}`);
    const lead = OP_BY_ID.get(a.opId)!.leadH;
    const actA = a.firstStop === null ? null : Math.max(0, a.firstStop - lead);
    const actG = !g || g.firstStop === null ? null : Math.max(0, g.firstStop - lead);
    if (actA === null && actG === null) continue;
    const diff = actA === null ? -Infinity : actG === null ? Infinity : actG - actA;
    if (Math.abs(diff) < 3) continue;
    out.push({ siteId: a.siteId, opId: a.opId, aurora: actA, baseline: actG, leadH: diff });
  }
  const pob = (id: string) => OFFSHORE_SITES.find((s) => s.id === id)?.pob ?? 0;
  return out.sort((x, y) => PRIORITY.indexOf(x.opId) - PRIORITY.indexOf(y.opId) || pob(y.siteId) - pob(x.siteId));
}

/** Sites where at least one operation must stop for the given operation id. */
export function sitesStopped(a: OffshoreAnalysis, opId: Operation["id"]): number {
  return a.windows.filter((w) => w.opId === opId && w.firstStop !== null).length;
}
