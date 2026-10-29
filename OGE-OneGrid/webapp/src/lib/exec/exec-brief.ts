// Executive brief model. Turns the same live data the operations console uses into a short,
// decision-oriented summary: a title, a three-part status strip, the assets/sites where risk is
// concentrated (each with one recommended action), a labeled cost-at-risk range and the SAP
// outage-cost trend for context.
//
// Everything here is deterministic and derived from structured data (no LLM text), so every
// number on the exec page can be traced back to its source.
import type {
  Asset,
  AssetPosture,
  AssetRisk,
  PostureLevel,
  WeatherEvent,
} from "@/lib/domain/types";
import { POSTURE_GATES, POSTURE_LEVEL_LABEL } from "@/lib/services/posture";
import type { Solution } from "@/lib/solution";

export type BriefStatus = "clear" | "watch" | "act";
export type RiskLevel3 = "critical" | "high" | "watch";
export type Tone = "good" | "warn" | "bad" | "neutral";

/** Equipment row from /api/fleet-assets (live Fabric) or the OneRig sample estate. */
export interface FleetAssetRow {
  asset_id: string;
  name?: string;
  plant?: string;
  site_id?: string;
  category?: string;
  group?: string;
  status?: string;
  risk_level?: string;
  risk_score?: number | null;
  survival_7d?: number | null;
}

/** Equipment-level weather exposure from /api/exposure (Energy only). */
export interface ExposureRow {
  assetId: string;
  siteId?: string;
  level: string;
  expectedLossUsd?: number | null;
}

export interface FleetHealth {
  health?: { avg?: number; scoredAssets?: number; totalAssets?: number };
}

export interface WorkOrderSummary {
  open?: number;
  backlog?: number;
  byPriority?: Array<{ rank: number; n: number }>;
}

/** Outage history from SAP (ZOUT_EVT) used to put a cost on risk. */
export interface OutageCostBasis {
  forcedCosts: number[];
  weatherCosts: number[];
  weatherHours: number[];
  /** Realized price per unit of lost output (OneRig: $/boe). */
  pricePerUom: number | null;
  outputUom: string | null;
  /** Total outage cost per calendar month, oldest first (last 12 months of history). */
  monthly: Array<{ month: string; label: string; usd: number }>;
}

export interface BriefInput {
  solution: Solution;
  assets: Asset[];
  risks: AssetRisk[];
  event: WeatherEvent | undefined;
  exposure: ExposureRow[] | null;
  fleet: FleetAssetRow[] | null;
  fleetHealth: FleetHealth | null;
  workOrders: WorkOrderSummary | null;
  sap: OutageCostBasis | null;
  /** Response posture per asset (lead-time gates). */
  postures: AssetPosture[] | null;
  horizonHours: number;
  nowIso: string;
  /** Data sources that failed to load (e.g. "equipment health"); shown instead of hiding gaps. */
  dataGaps?: string[];
}

export interface Action {
  title: string;
  why: string;
  owner: string;
  due: string;
  benefit: string;
  to: string;
  search?: Record<string, string> | undefined;
  question: string;
}

export interface RiskRow {
  key: string;
  kind: "equipment" | "weather";
  /** Equipment asset id (drives the expandable detail: root cause, SAP history, work). */
  assetId?: string;
  /** Storm exposure detail for weather rows. */
  weather?: {
    windMph: number;
    rainIn: number;
    distanceMi: number;
    insideCone: boolean;
    factors: Array<{ label: string; detail: string }>;
    recommendations: string[];
  };
  site: string;
  item: string;
  /** Equipment category/group used to pick an icon. */
  category: string;
  /** 0–100 on a shared scale: 7-day failure probability, or the storm risk score. */
  pct: number;
  pctLabel: string;
  level: RiskLevel3;
  usd: number | null;
  /** Typical cost if the risk materialises (SAP median forced outage), before probability. */
  typicalCost?: number | null;
  action: Action;
}

export interface PostureSummary {
  /** Highest posture level across the estate (0 normal … 4 evacuate). */
  level: PostureLevel;
  label: string;
  /** Number of assets at each level, index 0–4. */
  counts: number[];
  /** The soonest open lead-time gate across active assets. */
  next: { gate: string; label: string; dueHours: number; owner: string; site: string } | null;
}

export interface StatusStrip {
  health: { score: number | null; monitored: number; critical: number; tone: Tone };
  weather: { value: string; detail: string; active: boolean; tone: Tone; posture: PostureSummary };
  readiness: { p1: number; open: number; backlog: number; tone: Tone };
}

export interface MoneyEstimate {
  /** Typical outcome (median costs). */
  low: number;
  /** Severe outcome (90th-percentile costs). */
  high: number;
  horizon: string;
  basis: string[];
}

export interface ExecBrief {
  status: BriefStatus;
  title: string;
  summary: string;
  strip: StatusStrip;
  risks: RiskRow[];
  followUp: Action | null;
  money: MoneyEstimate | null;
  monthly: OutageCostBasis["monthly"];
  sources: string[];
  asOfIso: string;
  dataGaps: string[];
}

const EXPOSED = new Set(["elevated", "high", "critical"]);
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
const key = (s: string | undefined | null) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

export function percentile(values: number[], p: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (idx - lo);
}

export function formatUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function formatHours(h: number): string {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Tropical Storm Vance" / "Hurricane Vance" — unless the name already carries the kind. */
function stormLabel(e: WeatherEvent): string {
  const kind =
    e.kind === "hurricane" ? "Hurricane" : e.kind === "tropical_storm" ? "Tropical Storm" : "";
  return kind && !e.name.toLowerCase().includes(kind.toLowerCase()) ? `${kind} ${e.name}` : e.name;
}

function failureProbability(r: FleetAssetRow): number {
  if (r.survival_7d != null && Number.isFinite(r.survival_7d))
    return Math.max(0, Math.min(1, 1 - r.survival_7d));
  if (r.risk_score != null && Number.isFinite(r.risk_score))
    return Math.max(0, Math.min(1, r.risk_score));
  return r.status === "critical" ? 0.25 : 0.05;
}

const isCriticalEquipment = (r: FleetAssetRow) =>
  r.status === "critical" || r.risk_level === "critical";

function vocab(solution: Solution) {
  return solution === "og"
    ? {
        estate: "estate",
        site: "facility",
        sites: "facilities",
        weatherOwner: "Offshore Operations",
        maintOwner: "Asset Integrity",
        fieldOwner: "Field Services",
      }
    : {
        estate: "grid",
        site: "site",
        sites: "sites",
        weatherOwner: "Grid Operations",
        maintOwner: "Plant Maintenance",
        fieldOwner: "Field Services",
      };
}

export function buildExecBrief(input: BriefInput): ExecBrief {
  const { solution, assets, risks, event, exposure, fleet, workOrders, sap, horizonHours } = input;
  const v = vocab(solution);
  const days = Math.round(horizonHours / 24);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // ── weather: sites in the forecast path ───────────────────────────────────
  const inPath = risks
    .filter(
      (r) => EXPOSED.has(r.level) && (r.hoursToImpact == null || r.hoursToImpact <= horizonHours),
    )
    .map((r) => ({ risk: r, asset: assetById.get(r.assetId) }))
    .filter((x): x is { risk: AssetRisk; asset: Asset } => !!x.asset)
    .sort((a, b) => (a.risk.hoursToImpact ?? 999) - (b.risk.hoursToImpact ?? 999));
  const firstImpact = inPath
    .map((x) => x.risk.tsWindEtaH ?? x.risk.hoursToImpact)
    .filter((h): h is number => h != null)
    .sort((a, b) => a - b)[0];
  const businessCritical = inPath.filter((x) => x.asset.criticality === "business_critical").length;
  const prodInPath = inPath.reduce((s, x) => s + num(x.asset.metadata["production_boepd"]), 0);
  const stormName = event?.name ? stormLabel(event) : "The forecast storm";

  // ── equipment: critical predictions ──────────────────────────────────────
  const equip = (fleet ?? [])
    .filter(isCriticalEquipment)
    .sort((a, b) => failureProbability(b) - failureProbability(a));

  // ── dollars: typical (median) to severe (90th percentile) ────────────────
  // Per-row figures use the typical outcome, so they sum to the low end of the range.
  const basis: string[] = [];
  let low = 0;
  let high = 0;
  const weatherBySite = new Map<string, number>();
  const forcedTypical = sap?.forcedCosts.length ? percentile(sap.forcedCosts, 0.5) : null;

  if (sap && forcedTypical && equip.length) {
    const severe = percentile(sap.forcedCosts, 0.9);
    for (const r of equip) {
      const p = failureProbability(r);
      low += p * forcedTypical;
      high += p * severe;
    }
    basis.push(
      `Equipment: 7-day failure probability from the predictive model × the cost of a forced outage in SAP history (${sap.forcedCosts.length} outages; typical = median ${formatUsd(forcedTypical)}, severe = 90th percentile ${formatUsd(severe)}).`,
    );
  }
  if (inPath.length) {
    if (solution === "og" && sap?.pricePerUom && sap.weatherHours.length && prodInPath > 0) {
      const shutDays = (p: number) => percentile(sap.weatherHours, p) / 24;
      const price = sap.pricePerUom;
      low += prodInPath * price * shutDays(0.5);
      high += prodInPath * price * shutDays(0.9);
      for (const x of inPath)
        weatherBySite.set(
          x.asset.id,
          num(x.asset.metadata["production_boepd"]) * price * shutDays(0.5),
        );
      basis.push(
        `Weather: production in the forecast path (${Math.round(prodInPath).toLocaleString()} boe/d) × realized price ($${Math.round(price)}/${sap.outputUom ?? "boe"}) × weather shut-in duration from SAP history (typical ${Math.round(shutDays(0.5) * 10) / 10} days, severe ${Math.round(shutDays(0.9) * 10) / 10} days).`,
      );
    } else if (exposure?.length) {
      const plantBySite = new Map((fleet ?? []).map((f) => [f.site_id ?? "", key(f.plant)]));
      const exposed = exposure.filter((e) => EXPOSED.has(e.level));
      const expected = exposed.reduce((s, e) => s + num(e.expectedLossUsd), 0);
      if (expected > 0) {
        const wc = sap?.weatherCosts ?? [];
        const tail = wc.length ? percentile(wc, 0.9) / (percentile(wc, 0.5) || 1) : 2;
        low += expected;
        high += expected * Math.min(3, Math.max(1, tail));
        for (const x of inPath) {
          const plant = key(x.asset.name);
          const siteLoss = exposed
            .filter((e) => plantBySite.get(e.siteId ?? "") === plant)
            .reduce((s, e) => s + num(e.expectedLossUsd), 0);
          if (siteLoss) weatherBySite.set(x.asset.id, siteLoss);
        }
        basis.push(
          "Weather: forecast exposure × equipment fragility model (probability-weighted expected loss); severe case scaled by the spread of weather-outage costs in SAP history (90th percentile vs median, capped at 3×).",
        );
      }
    }
  }
  const money: MoneyEstimate | null =
    low > 0 ? { low, high, horizon: `next ${days} days`, basis } : null;

  // ── risk rows (weather first, by time to impact; then equipment by probability) ──
  const rows: RiskRow[] = [];
  for (const x of inPath) {
    const h = x.risk.tsWindEtaH ?? x.risk.hoursToImpact;
    const pob = num(x.asset.metadata["poB"]);
    const usd = weatherBySite.get(x.asset.id) ?? null;
    const decideBy = x.risk.evacWindowH ?? (h != null ? Math.max(1, h - 24) : null);
    rows.push({
      key: `w:${x.asset.id}`,
      kind: "weather",
      weather: {
        windMph: x.risk.forecastWindMph,
        rainIn: x.risk.rainfallIn,
        distanceMi: x.risk.distanceMi,
        insideCone: x.risk.insideCone,
        factors: x.risk.factors.map((f) => ({ label: f.label, detail: f.detail })),
        recommendations: x.risk.recommendations,
      },
      site: x.asset.name,
      item: `${Math.round(x.risk.forecastWindMph)} mph winds${h != null ? ` in ${formatHours(h)}` : ""}`,
      category: "weather",
      pct: Math.max(0, Math.min(100, Math.round(x.risk.score))),
      pctLabel: "storm risk score",
      level: x.risk.level === "critical" ? "critical" : x.risk.level === "high" ? "high" : "watch",
      usd,
      action:
        solution === "og" && pob > 0
          ? {
              title: `Decide on de-manning ${x.asset.name}`,
              why: `${pob} people on board; storm-force winds forecast in ${formatHours(h ?? 0)}.`,
              owner: v.weatherOwner,
              due: decideBy != null ? `Within ${formatHours(decideBy)}` : "Today",
              benefit: usd ? `Protects ~${formatUsd(usd)} of production` : "Keeps crews safe",
              to: "/posture",
              question: `Should we de-man ${x.asset.name} ahead of ${stormName}?`,
            }
          : {
              title: `Pre-position crews and spares at ${x.asset.name}`,
              why: `${stormName} brings ${Math.round(x.risk.forecastWindMph)} mph winds${h != null ? ` in ${formatHours(h)}` : ""}.`,
              owner: v.weatherOwner,
              due: decideBy != null ? `Within ${formatHours(decideBy)}` : "Today",
              benefit: usd ? `Limits ~${formatUsd(usd)} of expected loss` : "Faster restoration",
              to: "/posture",
              question: `How exposed is ${x.asset.name} to ${stormName}, and what should we do now?`,
            },
    });
  }
  for (const r of equip) {
    const p = failureProbability(r);
    const pct = Math.round(p * 100);
    const label = `${r.plant ? `${r.plant} ` : ""}${r.name ?? r.asset_id}`;
    rows.push({
      key: `e:${r.asset_id}`,
      assetId: r.asset_id,
      kind: "equipment",
      site: r.plant ?? "",
      item: r.name ?? r.asset_id,
      category: `${r.group ?? ""} ${r.category ?? ""} ${r.name ?? ""}`,
      pct,
      pctLabel: "7-day failure",
      level: p >= 0.2 ? "critical" : "high",
      usd: forcedTypical ? p * forcedTypical : null,
      typicalCost: forcedTypical,
      action: {
        title: `Approve repair of ${label}`,
        why: `${pct}% chance of failure in the next 7 days, from the predictive maintenance model.`,
        owner: v.maintOwner,
        due: p >= 0.2 ? "This week" : "Within 2 weeks",
        benefit: forcedTypical
          ? `Avoids a forced outage (typically ~${formatUsd(forcedTypical)})`
          : "Avoids an unplanned outage",
        to: "/control-room",
        search: r.plant ? { plant: r.plant } : undefined,
        question: `Why is the ${label} at risk of failing, and what should we do?`,
      },
    });
  }
  const shownRisks = rows.slice(0, 5);
  // Fill remaining rows with the next-highest "watch" equipment so the critical items are
  // read against the rest of the fleet on the same scale.
  if (shownRisks.length < 5) {
    const watch = (fleet ?? [])
      .filter((r) => !isCriticalEquipment(r) && failureProbability(r) >= 0.05)
      .sort((a, b) => failureProbability(b) - failureProbability(a))
      .slice(0, 5 - shownRisks.length);
    for (const r of watch) {
      const p = failureProbability(r);
      const label = `${r.plant ? `${r.plant} ` : ""}${r.name ?? r.asset_id}`;
      shownRisks.push({
        key: `e:${r.asset_id}`,
        assetId: r.asset_id,
        kind: "equipment",
        site: r.plant ?? "",
        item: r.name ?? r.asset_id,
        category: `${r.group ?? ""} ${r.category ?? ""} ${r.name ?? ""}`,
        pct: Math.round(p * 100),
        pctLabel: "7-day failure",
        level: "watch",
        usd: forcedTypical ? p * forcedTypical : null,
        typicalCost: forcedTypical,
        action: {
          title: `Schedule an inspection of ${label}`,
          why: `${Math.round(p * 100)}% chance of failure in the next 7 days — below the critical threshold, trending worth watching.`,
          owner: v.maintOwner,
          due: "Within 30 days",
          benefit: "Catches degradation before it becomes critical",
          to: "/control-room",
          search: r.plant ? { plant: r.plant } : undefined,
          question: `What is driving the failure risk on the ${label}?`,
        },
      });
    }
  }

  // ── status strip ─────────────────────────────────────────────────────────
  const healthScore = input.fleetHealth?.health?.avg;
  const p1 = num(workOrders?.byPriority?.find((p) => p.rank === 1)?.n);
  const postures = input.postures ?? [];
  const postureLevel = postures.reduce<PostureLevel>(
    (m, p) => (p.level > m ? p.level : m),
    0 as PostureLevel,
  );
  const nextGate = postures
    .filter((p) => p.level > 0 && p.nextGate && p.nextGateDueHours != null)
    .sort((a, b) => a.nextGateDueHours! - b.nextGateDueHours!)[0];
  const posture: PostureSummary = {
    level: postureLevel,
    label: POSTURE_LEVEL_LABEL[postureLevel],
    counts: [0, 1, 2, 3, 4].map((l) => postures.filter((p) => p.level === l).length),
    next: nextGate
      ? {
          gate: nextGate.nextGate!,
          label: POSTURE_GATES.find((g) => g.id === nextGate.nextGate)?.label ?? nextGate.nextGate!,
          dueHours: nextGate.nextGateDueHours!,
          owner: nextGate.decisionOwner,
          site: assetById.get(nextGate.assetId)?.name ?? nextGate.assetId,
        }
      : null,
  };
  const strip: StatusStrip = {
    health: {
      score: healthScore != null ? Math.round(healthScore) : null,
      monitored: num(input.fleetHealth?.health?.totalAssets) || (fleet?.length ?? 0),
      critical: equip.length,
      tone:
        healthScore == null
          ? "neutral"
          : healthScore >= 85
            ? "good"
            : healthScore >= 70
              ? "warn"
              : "bad",
    },
    weather: inPath.length
      ? {
          value: stormName,
          detail: `${inPath.length} of ${assets.length} ${v.sites} in path${firstImpact != null ? ` · impact in ${formatHours(firstImpact)}` : ""}`,
          active: true,
          tone: "bad",
          posture,
        }
      : {
          value: event?.name ? "No sites in path" : "Clear",
          detail: event?.name
            ? `${stormName} tracked · ${days}-day outlook`
            : `No storms tracked · ${days}-day outlook`,
          active: false,
          tone: posture.level >= 3 ? "bad" : posture.level >= 1 ? "warn" : "good",
          posture,
        },
    readiness: {
      p1,
      open: num(workOrders?.open),
      backlog: num(workOrders?.backlog),
      tone: p1 > 0 ? "warn" : "good",
    },
  };

  // ── title + summary ──────────────────────────────────────────────────────
  const urgentWeather = inPath.some(
    (x) =>
      (x.risk.level === "critical" || x.risk.level === "high") &&
      (x.risk.hoursToImpact ?? 999) <= 72,
  );
  const urgentEquip = equip.some((r) => failureProbability(r) >= 0.2);
  const dataGaps = input.dataGaps ?? [];
  const equipmentUnavailable = dataGaps.some((g) => /equipment/i.test(g));
  const status: BriefStatus =
    urgentWeather || urgentEquip
      ? "act"
      : inPath.length || equip.length || dataGaps.length
        ? "watch"
        : "clear";
  const count = (n: number) => WORDS[n] ?? String(n);
  const top = shownRisks[0];

  let title: string;
  let summary: string;
  if (inPath.length) {
    title = `${stormName} could reach ${count(inPath.length).toLowerCase()} ${inPath.length === 1 ? v.site : v.sites}`;
    summary =
      (firstImpact != null ? `First impact in ${formatHours(firstImpact)}` : "Impact expected") +
      (businessCritical ? `; ${businessCritical} business-critical.` : ".") +
      (equip.length
        ? ` ${count(equip.length)} ${equip.length === 1 ? "asset also has" : "assets also have"} elevated failure risk.`
        : "");
  } else if (equip.length) {
    title = `${count(equip.length)} ${equip.length === 1 ? "asset needs" : "assets need"} attention this week`;
    summary =
      (top
        ? `Highest risk: ${top.site} ${top.item}, ${top.pct}% chance of failure in 7 days. `
        : "") +
      (event?.name
        ? `${stormName} poses no threat to the ${v.estate}.`
        : `No storm threat to the ${v.estate}.`);
  } else if (equipmentUnavailable) {
    // Never report "all clear" when the equipment data could not be loaded.
    title = "Equipment data is unavailable";
    summary = `Equipment health could not be loaded, so risks may be missing. ${
      event?.name
        ? `${stormName} poses no threat to the ${v.estate}.`
        : `No storm threat to the ${v.estate}.`
    }`;
  } else {
    title = "All clear";
    summary = `No storm threat and no critical equipment issues across the ${v.estate}.`;
  }

  const followUp: Action | null =
    p1 > 0
      ? {
          title: `Clear ${p1} priority-1 work ${p1 === 1 ? "order" : "orders"}`,
          why: `${num(workOrders?.open)} open, ${num(workOrders?.backlog)} in backlog.`,
          owner: v.fieldOwner,
          due: inPath.length ? "Before the storm" : "This week",
          benefit: "Restores full crew readiness",
          to: "/maintenance",
          question: "Which priority-1 work orders are open and what is blocking them?",
        }
      : null;

  const sources =
    solution === "og"
      ? [
          "OneRig sample estate (Gulf of Mexico)",
          "Storm forecast and exposure model",
          "Predictive maintenance model",
          "SAP S/4HANA outage history",
        ]
      : [
          `Aurora AI forecast${event?.updatedAtIso ? ` (cycle ${shortDate(event.updatedAtIso)})` : ""}`,
          "Fabric Eventhouse telemetry and predictive model",
          "Power BI semantic model",
          "SAP S/4HANA via Fabric mirroring",
        ];

  return {
    status,
    title,
    summary,
    strip,
    risks: shownRisks,
    followUp,
    money,
    monthly: sap?.monthly ?? [],
    sources,
    asOfIso: input.nowIso,
    dataGaps,
  };
}

/** Extract the outage cost basis + monthly trend from SAP outage events (ZOUT_EVT). */
export function outageCostBasis(
  outages: Array<{
    OUTAGE_TYPE: string;
    TOTAL_IMPACT: number;
    DURATION_H: number;
    PRICE_PER_UOM: number;
    OUTPUT_UOM: string;
    START_DATE: string;
  }>,
): OutageCostBasis {
  const forced = outages.filter((o) => o.OUTAGE_TYPE === "FORCED");
  const weather = outages.filter((o) => o.OUTAGE_TYPE === "WEATHER");
  const prices = outages.map((o) => num(o.PRICE_PER_UOM)).filter((p) => p > 0);

  const byMonth = new Map<string, number>();
  for (const o of outages) {
    const m = String(o.START_DATE ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) byMonth.set(m, (byMonth.get(m) ?? 0) + num(o.TOTAL_IMPACT));
  }
  const latest = [...byMonth.keys()].sort().pop();
  const monthly: OutageCostBasis["monthly"] = [];
  if (latest) {
    const [y, mo] = latest.split("-").map(Number) as [number, number];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, mo - 1 - i, 1));
      const m = d.toISOString().slice(0, 7);
      monthly.push({
        month: m,
        label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
        usd: byMonth.get(m) ?? 0,
      });
    }
  }

  return {
    forcedCosts: forced.map((o) => num(o.TOTAL_IMPACT)).filter((x) => x > 0),
    weatherCosts: weather.map((o) => num(o.TOTAL_IMPACT)).filter((x) => x > 0),
    weatherHours: weather.map((o) => num(o.DURATION_H)).filter((x) => x > 0),
    pricePerUom: prices.length ? percentile(prices, 0.5) : null,
    outputUom: outages.find((o) => o.OUTPUT_UOM)?.OUTPUT_UOM ?? null,
    monthly,
  };
}
