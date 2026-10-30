// "Scorecard" layout of the executive brief: one screen of charts and a drillable table.
//   • KPI tiles (fleet health, critical assets, active alerts, forced outages)
//   • date range (drives the SAP outage chart, the KPIs and the outage columns)
//   • equipment table grouped by type → expand to assets → click an asset for the evidence
//   • outage activity by month (SAP)  • alert activity sunburst (region → site → equipment)
// Clicking a sunburst segment filters the tiles, chart and table. Uses data already cached
// for the brief (fleet assets, open work orders) plus the static SAP snapshot — no polling.
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  RotateCcw,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Spinner } from "@/components/ops/Spinner";
import { formatUsd, type FleetAssetRow } from "@/lib/exec/exec-brief";
import { AS_OF, loadSapDataset, type SapOutage } from "@/lib/sap/sap-data";
import type { Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { getJson } from "@/report/lib/api.js";
import type { EvidenceSubject } from "@/lib/exec/evidence";

type Asset = FleetAssetRow & {
  unit?: string;
  region?: string;
  condition?: number | null;
  anom_n?: number;
  watch_n?: number;
  stop_prob?: number | null;
};
interface WorkRow {
  asset_id?: string;
  priority_rank?: number;
}

type Status = "critical" | "watch" | "ok";
interface Line {
  id: string;
  name: string;
  where: string;
  status: Status;
  health: number | null;
  alerts: number;
  failurePct: number | null;
  lastRepair: string | null;
  lastOutage: string | null;
  outages: number;
  cost: number;
  workOrders: number;
}
type SortKey =
  "name" | "lastRepair" | "alerts" | "lastOutage" | "health" | "workOrders" | "failurePct";
interface Selection {
  region: string;
  site?: string;
  group?: string;
}

const DAY = 86_400_000;
const AS_OF_MS = new Date(`${AS_OF}T00:00:00Z`).getTime();
const TYPES = [
  { key: "FORCED", label: "Forced", color: "#ef4444" },
  { key: "DERATE", label: "Derate", color: "#f59e0b" },
  { key: "WEATHER", label: "Weather", color: "#38bdf8" },
  { key: "PLANNED", label: "Planned", color: "#34d399" },
] as const;
const REGION_COLORS = ["#3b82f6", "#f97316", "#14b8a6", "#a855f7", "#eab308", "#ec4899", "#1d4ed8"];
const STATUS_RANK: Record<Status, number> = { critical: 2, watch: 1, ok: 0 };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const plural = (g: string) => (/s$/i.test(g) ? title(g) : `${title(g)}s`);
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

function failurePct(a: Asset): number | null {
  if (a.survival_7d != null) return Math.round((1 - n(a.survival_7d)) * 100);
  if (a.stop_prob != null) return Math.round(n(a.stop_prob) * 100);
  return null;
}
const failureStatus = (p: number | null): Status =>
  p == null ? "ok" : p >= 30 ? "critical" : p >= 15 ? "watch" : "ok";

function monthsBetween(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  const d = new Date(startMs);
  d.setUTCDate(1);
  while (d.getTime() <= endMs) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function ExecScorecard({
  solution,
  fleet,
  healthScore,
  onEvidence,
}: {
  solution: Solution;
  fleet: FleetAssetRow[];
  healthScore: number | null;
  onEvidence: (subject: EvidenceSubject) => void;
}) {
  const sap = useQuery({
    queryKey: ["exec-sap-outages", solution],
    queryFn: async () => (await loadSapDataset(solution)).outages,
    staleTime: 60 * 60 * 1000,
  });
  const wos = useQuery({
    queryKey: ["exec-open-work"],
    queryFn: () => getJson("/api/work-orders?limit=100") as Promise<WorkRow[]>,
    staleTime: 5 * 60 * 1000,
  });

  // ── date range (month steps, SAP history → as-of date) ─────────────────────
  const allMonths = useMemo(() => {
    const first = (sap.data ?? []).reduce(
      (m, o) => Math.min(m, new Date(o.START_DATE).getTime()),
      AS_OF_MS - 365 * DAY,
    );
    return monthsBetween(first, AS_OF_MS);
  }, [sap.data]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const last = allMonths.length - 1;
  const [r0, r1] = range ?? [Math.max(0, last - 11), last];
  const fromMs = new Date(`${allMonths[r0] ?? AS_OF.slice(0, 7)}-01T00:00:00Z`).getTime();
  const toMonth = allMonths[r1] ?? AS_OF.slice(0, 7);
  const toMs = Math.min(
    AS_OF_MS + DAY - 1,
    Date.UTC(Number(toMonth.slice(0, 4)), Number(toMonth.slice(5, 7)), 0, 23, 59, 59),
  );

  // ── selection from the sunburst ─────────────────────────────────────────────
  const [sel, setSel] = useState<Selection | null>(null);
  const assets = fleet as Asset[];
  const regionOf = (a: Asset) => title(a.region || "Other");
  const inSel = (a: Asset) =>
    !sel ||
    (regionOf(a) === sel.region &&
      (!sel.site || a.plant === sel.site) &&
      (!sel.group || title(a.group || "Other") === sel.group));
  const visible = assets.filter(inSel);
  const visibleIds = new Set(visible.map((a) => a.asset_id));

  const outagesInRange = (sap.data ?? []).filter((o) => {
    const t = new Date(o.START_DATE).getTime();
    return t >= fromMs && t <= toMs && (!sel || visibleIds.has(o.ASSET_ID));
  });

  // ── table rows ──────────────────────────────────────────────────────────────
  const woByAsset = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wos.data ?? []) if (w.asset_id) m.set(w.asset_id, (m.get(w.asset_id) ?? 0) + 1);
    return m;
  }, [wos.data]);
  const outByAsset = useMemo(() => {
    const m = new Map<string, SapOutage[]>();
    for (const o of outagesInRange) m.set(o.ASSET_ID, [...(m.get(o.ASSET_ID) ?? []), o]);
    return m;
  }, [outagesInRange]);

  const lines: Line[] = visible.map((a) => {
    const outs = outByAsset.get(a.asset_id) ?? [];
    const latest = (types: string[]) =>
      outs
        .filter((o) => types.includes(o.OUTAGE_TYPE))
        .map((o) => o.START_DATE)
        .sort()
        .pop() ?? null;
    const fp = failurePct(a);
    const status: Status =
      a.status === "critical" ? "critical" : a.status === "watch" ? "watch" : "ok";
    return {
      id: a.asset_id,
      name: a.name ?? a.asset_id,
      where: [a.plant, a.unit].filter(Boolean).join(" · "),
      status,
      health: a.condition ?? null,
      alerts: n(a.anom_n) + n(a.watch_n),
      failurePct: fp,
      lastRepair: latest(["PLANNED"]),
      lastOutage: latest(["FORCED", "DERATE", "WEATHER"]),
      outages: outs.length,
      cost: outs.reduce((s, o) => s + n(o.TOTAL_IMPACT), 0),
      workOrders: woByAsset.get(a.asset_id) ?? 0,
    };
  });

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "failurePct",
    desc: true,
  });
  const val = (l: Line, k: SortKey): number | string =>
    k === "name"
      ? l.name
      : k === "lastRepair" || k === "lastOutage"
        ? (l[k] ?? "")
        : k === "health"
          ? (l.health ?? 999)
          : (l[k] ?? -1);
  const cmp = (a: Line, b: Line) => {
    const x = val(a, sort.key),
      y = val(b, sort.key);
    const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return sort.desc ? -c : c;
  };

  const groups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const a of visible) {
      const g = a.group || a.category || "Other";
      const line = lines.find((l) => l.id === a.asset_id)!;
      m.set(g, [...(m.get(g) ?? []), line]);
    }
    return [...m.entries()]
      .map(([g, ls]) => {
        const agg: Line = {
          id: `group:${g}`,
          name: plural(g),
          where: `${ls.length} assets`,
          status: ls.reduce<Status>(
            (w, l) => (STATUS_RANK[l.status] > STATUS_RANK[w] ? l.status : w),
            "ok",
          ),
          health: ls.some((l) => l.health != null)
            ? Math.min(...ls.map((l) => l.health ?? 100))
            : null,
          alerts: ls.reduce((s, l) => s + l.alerts, 0),
          failurePct: ls.some((l) => l.failurePct != null)
            ? Math.max(...ls.map((l) => l.failurePct ?? 0))
            : null,
          lastRepair:
            ls
              .map((l) => l.lastRepair ?? "")
              .sort()
              .pop() || null,
          lastOutage:
            ls
              .map((l) => l.lastOutage ?? "")
              .sort()
              .pop() || null,
          outages: ls.reduce((s, l) => s + l.outages, 0),
          cost: ls.reduce((s, l) => s + l.cost, 0),
          workOrders: ls.reduce((s, l) => s + l.workOrders, 0),
        };
        return { key: g, agg, lines: [...ls].sort(cmp) };
      })
      .sort((a, b) => cmp(a.agg, b.agg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length, sel, sort, outByAsset, woByAsset, fleet]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(g.key));
  const toggle = (k: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const conditions = visible.map((a) => a.condition).filter((c): c is number => c != null);
  const health = sel
    ? conditions.length
      ? Math.round(conditions.reduce((s, c) => s + c, 0) / conditions.length)
      : null
    : healthScore;
  const critical = visible.filter((a) => a.status === "critical").length;
  const alerts = lines.reduce((s, l) => s + l.alerts, 0);
  const forced = outagesInRange.filter((o) => o.OUTAGE_TYPE === "FORCED");
  const forcedCost = forced.reduce((s, o) => s + n(o.TOTAL_IMPACT), 0);

  // ── chart ───────────────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    const months = allMonths.slice(r0, r1 + 1);
    const rows = months.map((m) => ({
      month: m,
      label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      ...Object.fromEntries(TYPES.map((t) => [t.key, 0])),
    })) as Array<Record<string, number | string>>;
    const idx = new Map(months.map((m, i) => [m, i]));
    for (const o of outagesInRange) {
      const i = idx.get(monthKey(new Date(o.START_DATE).getTime()));
      if (i != null && rows[i] && o.OUTAGE_TYPE in rows[i]!)
        rows[i]![o.OUTAGE_TYPE] = n(rows[i]![o.OUTAGE_TYPE]) + 1;
    }
    return rows;
  }, [allMonths, r0, r1, outagesInRange]);

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* ── left: filters, KPIs, table ─────────────────────────────────────── */}
      <div className="space-y-4 lg:col-span-7">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr]">
          <Panel className="flex flex-col justify-between p-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <CalendarRange className="size-3.5" /> Date range
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MonthSelect
                  label="From"
                  months={allMonths}
                  value={r0}
                  max={r1}
                  onChange={(i) => setRange([i, r1])}
                />
                <MonthSelect
                  label="To"
                  months={allMonths}
                  value={r1}
                  min={r0}
                  onChange={(i) => setRange([r0, i])}
                />
              </div>
            </div>
            <DualSlider max={last} value={[r0, r1]} onChange={setRange} />
            <div className="text-[11px] text-muted-foreground">
              {sap.isLoading ? (
                <Spinner label="Loading SAP history…" size="sm" />
              ) : (
                `${r1 - r0 + 1} months · SAP history`
              )}
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-3">
            <Kpi
              label="Fleet health"
              value={health != null ? `${health}%` : "—"}
              tone={
                health == null ? "neutral" : health >= 80 ? "good" : health >= 60 ? "warn" : "bad"
              }
            />
            <Kpi
              label="Critical assets"
              value={String(critical)}
              sub={`of ${visible.length}`}
              tone={critical ? "bad" : "good"}
            />
            <Kpi label="Active alerts" value={String(alerts)} tone={alerts ? "warn" : "good"} />
            <Kpi
              label="Forced outages"
              value={String(forced.length)}
              loading={sap.isLoading}
              sub={forcedCost ? formatUsd(forcedCost) : undefined}
              tone={forced.length ? "bad" : "good"}
            />
          </div>
        </div>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <div className="text-[15px] font-semibold">
              Equipment
              {sel && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {[sel.region, sel.site, sel.group].filter(Boolean).join(" › ")}
                </span>
              )}
            </div>
            {(sap.isLoading || wos.isLoading) && (
              <Spinner
                size="sm"
                className="ml-auto"
                label={sap.isLoading ? "Loading outage history…" : "Loading work orders…"}
              />
            )}
            <button
              onClick={() => setExpanded(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}
              className="text-xs font-medium text-primary hover:underline"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-[0_1px_0_var(--color-border)]">
                <tr>
                  <Th k="name" sort={sort} onSort={sortBy} className="pl-4 text-left">
                    Equipment
                  </Th>
                  <Th
                    k="lastRepair"
                    sort={sort}
                    onSort={sortBy}
                    title="Most recent planned maintenance in the date range (SAP)"
                  >
                    Last repair
                  </Th>
                  <Th
                    k="alerts"
                    sort={sort}
                    onSort={sortBy}
                    title="Active anomaly and watchlist alerts"
                  >
                    Alerts
                  </Th>
                  <Th
                    k="lastOutage"
                    sort={sort}
                    onSort={sortBy}
                    title="Most recent forced, derate or weather outage in the date range (SAP)"
                  >
                    Last outage
                  </Th>
                  <Th k="health" sort={sort} onSort={sortBy}>
                    Condition
                  </Th>
                  <Th k="workOrders" sort={sort} onSort={sortBy} title="Open work orders">
                    Work orders
                  </Th>
                  <Th
                    k="failurePct"
                    sort={sort}
                    onSort={sortBy}
                    className="pr-4"
                    title="Chance of a breakdown in the next 7 days"
                  >
                    Failure %
                  </Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const open = expanded.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <Row line={g.agg} group open={open} onClick={() => toggle(g.key)} />
                      {open &&
                        g.lines.map((l) => (
                          <Row
                            key={l.id}
                            line={l}
                            onClick={() =>
                              onEvidence({
                                kind: "equipment",
                                assetId: l.id,
                                site: l.where.split(" · ")[0] ?? "",
                                item: l.name,
                                pct: l.failurePct,
                              })
                            }
                          />
                        ))}
                    </Fragment>
                  );
                })}
                {!groups.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No equipment data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            Expand a type to see its assets · click an asset for the evidence · green = recent
            planned repair, red = outage in the last 90 days
          </div>
        </Panel>
      </div>

      {/* ── right: charts ──────────────────────────────────────────────────── */}
      <div className="space-y-4 lg:col-span-5">
        <Panel className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Outage activity</h3>
            <span className="text-xs text-muted-foreground">
              {outagesInRange.length} outages ·{" "}
              {formatUsd(outagesInRange.reduce((s, o) => s + n(o.TOTAL_IMPACT), 0))}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {TYPES.map((t) => (
              <span key={t.key} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: t.color }} /> {t.label}
              </span>
            ))}
          </div>
          <div className="mt-2 h-[190px]">
            {sap.isLoading ? (
              <Spinner label="Loading outage history…" className="h-full justify-center" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    {TYPES.map((t) => (
                      <linearGradient key={t.key} id={`sc-${t.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={t.color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={t.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeOpacity={0.6}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={18}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "var(--color-popover-foreground)",
                    }}
                  />
                  {[...TYPES].reverse().map((t) => (
                    <Area
                      key={t.key}
                      type="monotone"
                      dataKey={t.key}
                      name={t.label}
                      stroke={t.color}
                      strokeWidth={1.8}
                      fill={`url(#sc-${t.key})`}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Alert activity</h3>
            {sel ? (
              <button
                onClick={() => setSel(null)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <RotateCcw className="size-3" /> Show all
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">click to drill in</span>
            )}
          </div>
          <Sunburst
            assets={assets}
            selection={sel}
            onSelect={setSel}
            onAsset={(a) =>
              onEvidence({ kind: "equipment", assetId: a.assetId, site: a.site, item: a.name })
            }
          />
        </Panel>
      </div>
    </div>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────────
function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

const KPI_TONE = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  bad: "text-red-500",
  neutral: "text-foreground",
} as const;

function Kpi({
  label,
  value,
  sub,
  tone,
  loading,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  tone: keyof typeof KPI_TONE;
  loading?: boolean;
}) {
  return (
    <Panel className="flex flex-col items-center justify-center px-3 py-3 text-center">
      <div
        className={cn(
          "text-[32px] font-semibold tabular-nums leading-10 tracking-tight",
          KPI_TONE[tone],
        )}
      >
        {loading ? <Spinner label="" className="h-10 justify-center [&_svg]:size-6" /> : value}
      </div>
      <div className="text-sm text-muted-foreground">
        {label}
        {sub && <span className="ml-1 text-xs">· {sub}</span>}
      </div>
    </Panel>
  );
}

function MonthSelect({
  label,
  months,
  value,
  min = 0,
  max = Infinity,
  onChange,
}: {
  label: string;
  months: string[];
  value: number;
  min?: number;
  max?: number;
  onChange: (i: number) => void;
}) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 block w-full rounded-lg border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary/60"
      >
        {months.map((m, i) => (
          <option key={m} value={i} disabled={i < min || i > max}>
            {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Two-thumb slider built from overlapping range inputs. */
function DualSlider({
  max,
  value,
  onChange,
}: {
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [a, b] = value;
  const pct = (i: number) => (max ? (i / max) * 100 : 0);
  const thumb =
    "pointer-events-none absolute inset-0 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card";
  return (
    <div className="relative my-3 h-5">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }}
      />
      <input
        aria-label="Start month"
        type="range"
        min={0}
        max={max}
        value={a}
        onChange={(e) => onChange([Math.min(Number(e.target.value), b), b])}
        className={thumb}
      />
      <input
        aria-label="End month"
        type="range"
        min={0}
        max={max}
        value={b}
        onChange={(e) => onChange([a, Math.max(Number(e.target.value), a)])}
        className={thumb}
      />
    </div>
  );
}

function Th({
  k,
  sort,
  onSort,
  className,
  title: tip,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th
      className={cn("whitespace-nowrap px-2 py-2 text-center font-medium", className)}
      title={tip}
    >
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        {active ? (
          <ChevronDown className={cn("size-3 transition-transform", !sort.desc && "rotate-180")} />
        ) : (
          <ChevronsUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function StatusIcon({ status }: { status: Status }) {
  return status === "critical" ? (
    <span className="inline-grid size-5 place-items-center rounded-full bg-red-500/15 text-red-500 ring-1 ring-red-500/60">
      <X className="size-3" strokeWidth={3} />
    </span>
  ) : status === "watch" ? (
    <span className="inline-grid size-5 place-items-center rounded-full bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/60">
      <CircleAlert className="size-3.5" strokeWidth={2.5} />
    </span>
  ) : (
    <Check className="inline size-4 text-emerald-500" strokeWidth={3} />
  );
}

function dateCell(iso: string | null, kind: "repair" | "outage") {
  if (!iso) return "";
  const ageDays = (AS_OF_MS - new Date(iso).getTime()) / DAY;
  if (kind === "repair") return ageDays <= 180 ? "bg-emerald-500/15" : "";
  return ageDays <= 90 ? "bg-red-500/20" : ageDays <= 365 ? "bg-amber-500/15" : "";
}

function Row({
  line: l,
  group,
  open,
  onClick,
}: {
  line: Line;
  group?: boolean;
  open?: boolean;
  onClick: () => void;
}) {
  const fs = failureStatus(l.failurePct);
  return (
    <tr
      onClick={onClick}
      className={cn(
        "cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50",
        group ? "bg-muted/30 font-semibold" : "text-[13px]",
      )}
    >
      <td className={cn("py-1.5 pr-2", group ? "pl-3" : "pl-9")}>
        <span className="flex min-w-0 items-center gap-1.5">
          {group &&
            (open ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            ))}
          <span className="min-w-0">
            <span className="block truncate">{l.name}</span>
            <span className="block truncate text-[11px] font-normal text-muted-foreground">
              {l.where}
            </span>
          </span>
        </span>
      </td>
      <td className={cn("px-2 py-1.5 text-center tabular-nums", dateCell(l.lastRepair, "repair"))}>
        {fmtDate(l.lastRepair)}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums">{l.alerts || ""}</td>
      <td
        className={cn("px-2 py-1.5 text-center tabular-nums", dateCell(l.lastOutage, "outage"))}
        title={l.outages ? `${l.outages} outages · ${formatUsd(l.cost)}` : undefined}
      >
        {fmtDate(l.lastOutage)}
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="inline-flex items-center gap-1.5">
          <StatusIcon status={l.status} />
          <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
            {l.health ?? ""}
          </span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums">{l.workOrders || ""}</td>
      <td className="py-1.5 pl-2 pr-4 text-right">
        {l.failurePct != null ? (
          <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
            {l.failurePct}%<StatusIcon status={fs} />
          </span>
        ) : (
          ""
        )}
      </td>
    </tr>
  );
}

// ── half sunburst, zoomable: regions → sites → equipment types → assets ────────
// Two labelled rings at a time. Clicking a segment drills in (and filters the page);
// the centre goes back up one level; clicking an asset opens its evidence.
interface Node {
  name: string;
  value: number;
  sel: Selection;
  assetId?: string;
  children: Node[];
}

function buildTree(assets: Asset[]): Node[] {
  const regions = new Map<string, Map<string, Map<string, Asset[]>>>();
  for (const a of assets) {
    if (n(a.anom_n) + n(a.watch_n) <= 0) continue;
    const r = title(a.region || "Other"),
      s = a.plant || "Other",
      g = title(a.group || "Other");
    const sites = regions.get(r) ?? new Map<string, Map<string, Asset[]>>();
    const groups = sites.get(s) ?? new Map<string, Asset[]>();
    groups.set(g, [...(groups.get(g) ?? []), a]);
    sites.set(s, groups);
    regions.set(r, sites);
  }
  const sum = (xs: Node[]) => xs.reduce((t, x) => t + x.value, 0);
  const byValue = (x: Node, y: Node) => y.value - x.value;
  return [...regions.entries()]
    .map(([r, sites]): Node => {
      const siteNodes = [...sites.entries()]
        .map(([s, groups]): Node => {
          const groupNodes = [...groups.entries()]
            .map(([g, list]): Node => {
              const leaves = list
                .map((a): Node => ({
                  name: a.name ?? a.asset_id,
                  value: n(a.anom_n) + n(a.watch_n),
                  sel: { region: r, site: s, group: g },
                  assetId: a.asset_id,
                  children: [],
                }))
                .sort(byValue);
              return {
                name: g,
                value: sum(leaves),
                sel: { region: r, site: s, group: g },
                children: leaves,
              };
            })
            .sort(byValue);
          return {
            name: s,
            value: sum(groupNodes),
            sel: { region: r, site: s },
            children: groupNodes,
          };
        })
        .sort(byValue);
      return { name: r, value: sum(siteNodes), sel: { region: r }, children: siteNodes };
    })
    .sort(byValue);
}

function Sunburst({
  assets,
  selection,
  onSelect,
  onAsset,
}: {
  assets: Asset[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onAsset: (node: { assetId: string; name: string; site: string }) => void;
}) {
  const tree = useMemo(() => buildTree(assets), [assets]);
  const [hover, setHover] = useState<Node | null>(null);

  // The zoom root follows the selection: region → its sites, site/group → its types.
  const region = selection ? tree.find((r) => r.name === selection.region) : undefined;
  const site = selection?.site
    ? region?.children.find((s) => s.name === selection.site)
    : undefined;
  const root: Node | null = site ?? region ?? null;
  const ring0 = root ? root.children : tree;
  const total = ring0.reduce((t, x) => t + x.value, 0);
  const up = () =>
    onSelect(!selection ? null : selection.site ? { region: selection.region } : null);

  const W = 460,
    H = 250,
    cx = W / 2,
    cy = H - 14;
  const rings = [
    [58, 138],
    [141, 218],
  ] as const;
  const colorOf = new Map(ring0.map((x, i) => [x.name, REGION_COLORS[i % REGION_COLORS.length]!]));

  const segs: ReactNode[] = [];
  const draw = (nodes: Node[], depth: 0 | 1, a0: number, a1: number, color?: string) => {
    const sum = nodes.reduce((t, x) => t + x.value, 0) || 1;
    let a = a0;
    nodes.forEach((node, i) => {
      const span = ((a1 - a0) * node.value) / sum;
      const [ri, ro] = rings[depth];
      const fill = color ?? colorOf.get(node.name)!;
      const dim = selection?.group && node.sel.group && node.sel.group !== selection.group;
      const arcLen = Math.abs(span) * ((ri + ro) / 2);
      segs.push(
        <g
          key={`${depth}:${node.assetId ?? node.name}:${i}`}
          onClick={() =>
            node.assetId
              ? onAsset({ assetId: node.assetId, name: node.name, site: node.sel.site ?? "" })
              : onSelect(node.sel)
          }
          onMouseEnter={() => setHover(node)}
          onMouseLeave={() => setHover(null)}
          className="cursor-pointer"
        >
          <title>{`${node.name}: ${node.value} alerts`}</title>
          <path
            d={arcPath(cx, cy, ri, ro, a, a + span)}
            fill={fill}
            fillOpacity={(dim ? 0.3 : 1) * (depth === 0 ? 1 : 0.7)}
            stroke="var(--color-card)"
            strokeWidth={1.5}
            className="transition-opacity hover:opacity-80"
          />
          {arcLen > 18 && (
            <SegLabel
              cx={cx}
              cy={cy}
              r={(ri + ro) / 2}
              angle={a + span / 2}
              maxLen={ro - ri - 10}
              text={depth === 0 ? node.name : `${node.name} (${node.value})`}
            />
          )}
        </g>,
      );
      if (depth === 0) draw(node.children, 1, a, a + span, fill);
      a += span;
    });
  };
  draw(ring0, 0, Math.PI, 0);

  const crumbs: Array<{ label: string; sel: Selection | null }> = [{ label: "All", sel: null }];
  if (region) crumbs.push({ label: region.name, sel: { region: region.name } });
  if (site) crumbs.push({ label: site.name, sel: { region: region!.name, site: site.name } });
  if (selection?.group) crumbs.push({ label: selection.group, sel: selection });

  return (
    <div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((c, i) => (
          <Fragment key={c.label}>
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
            <button
              onClick={() => onSelect(c.sel)}
              className={cn(
                "rounded px-1 font-medium",
                i === crumbs.length - 1 ? "text-foreground" : "text-primary hover:underline",
              )}
            >
              {c.label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {ring0.map((x) => (
          <span key={x.name} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: colorOf.get(x.name) }} />{" "}
            {x.name}
          </span>
        ))}
      </div>
      {total ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-1 w-full"
          role="img"
          aria-label="Alert activity"
        >
          {segs}
          <g onClick={up} className={selection ? "cursor-pointer" : ""}>
            <path
              d={arcPath(cx, cy, 0, 55, Math.PI, 0)}
              fill="var(--color-muted)"
              fillOpacity={0.6}
            />
            <text
              x={cx}
              y={cy - 20}
              textAnchor="middle"
              className="fill-foreground text-[18px] font-semibold"
            >
              {hover ? hover.value : total}
            </text>
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {hover ? truncate(hover.name, 16) : selection ? "↑ back" : "alerts"}
            </text>
          </g>
        </svg>
      ) : (
        <div className="grid h-40 place-items-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" /> No active alerts
          </span>
        </div>
      )}
    </div>
  );
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Annular sector between angles a0→a1 (radians, 0 = right, π = left, upper half). */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 < a0 ? 1 : 0;
  if (r0 <= 0)
    return `M ${cx} ${cy} L ${p(r1, a0)} A ${r1} ${r1} 0 ${large} ${sweep} ${p(r1, a1)} Z`;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 ${large} ${sweep} ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} ${1 - sweep} ${p(r0, a0)} Z`;
}

/** Radial label centred in a segment, kept upright. */
function SegLabel({
  cx,
  cy,
  r,
  angle,
  maxLen,
  text,
}: {
  cx: number;
  cy: number;
  r: number;
  angle: number;
  maxLen: number;
  text: string;
}) {
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  let deg = (-angle * 180) / Math.PI;
  if (deg < -90) deg += 180;
  const chars = Math.max(3, Math.floor(maxLen / 5.4));
  return (
    <text
      x={x}
      y={y}
      transform={`rotate(${deg} ${x} ${y})`}
      textAnchor="middle"
      dominantBaseline="central"
      className="pointer-events-none fill-white text-[9px] font-semibold uppercase tracking-wide"
    >
      {truncate(text, chars)}
    </text>
  );
}
