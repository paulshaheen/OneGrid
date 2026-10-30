// "See the evidence" pop-up for the executive brief. Executives never leave the exec view:
// everything behind a recommendation (sensor trend, root cause, failure prediction, SAP
// failure history and open work) is shown here instead of deep-linking into Operations.
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  ClipboardList,
  FileSearch,
  History,
  Sparkles,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Spinner } from "@/components/ops/Spinner";
import { formatUsd, type Action } from "@/lib/exec/exec-brief";
import { firstRootCause, type EvidenceSubject } from "@/lib/exec/evidence";
import { AS_OF, loadSapDataset, type SapOutage } from "@/lib/sap/sap-data";
import type { Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { getJson } from "@/report/lib/api.js";
import { OutageHistory, WeatherDetail } from "@/views/exec-risk-detail";

interface RootCause {
  tag?: string;
  failure_mechanism?: string;
  root_cause?: string;
  recommended_action?: string;
  confidence?: number;
}
interface AssetDetail {
  asset?: { name?: string; asset_display_name?: string; plant?: string; unit?: string } | null;
  rootCause?: RootCause | RootCause[] | null;
  anomalies?: Array<{
    Tag?: string;
    severity?: string;
    latest_value?: number;
    baseline_median?: number;
  }>;
  predShort?: Array<{ prediction_horizon?: string; stop_probability?: number }>;
  predLong?: Array<{
    risk_level?: string;
    survival_probability_7d?: number;
    predicted_median_survival_days?: number;
  }>;
  tags?: Array<{ tag: string; desc?: string; units?: string }>;
}
interface WorkRow {
  wr_id: string;
  status?: string;
  wr_status?: string;
  problem?: string;
  problem_descr?: string;
  priority?: number | string;
  priority_rank?: number;
  create_date?: string;
  open?: boolean;
  site_name?: string;
  location?: string;
  entity_descr?: string;
}

const DAY = 86_400_000;
const PRIORITY_CLS: Record<number, string> = {
  1: "bg-red-500/12 text-red-500 ring-red-500/25",
  2: "bg-amber-500/12 text-amber-500 ring-amber-500/25",
  3: "bg-sky-500/12 text-sky-500 ring-sky-500/25",
};

const fmt = (v: number) =>
  Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
const age = (iso?: string) => {
  if (!iso) return "—";
  const d = Math.round((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "today" : `${d} d`;
};
const rank = (w: WorkRow) => Number(w.priority_rank ?? w.priority) || 9;

export function ExecModal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  wide = true,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl",
          wide ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start gap-3 border-b px-6 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
            <FileSearch className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>}
            <h2 className="text-lg font-semibold leading-6">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card/70 p-4", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" strokeWidth={2} /> {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Loading({ label }: { label: string }) {
  return <Spinner label={label} className="min-h-24 justify-center" />;
}

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
};

export function EvidenceModal({
  subject,
  action,
  solution,
  onAsk,
  onClose,
}: {
  subject: EvidenceSubject;
  action?: Action | null | undefined;
  solution: Solution;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const title =
    subject.kind === "equipment"
      ? `${subject.item} · ${subject.site}`
      : subject.kind === "weather"
        ? `${subject.row.site} · ${subject.row.item}`
        : "Urgent work backlog";
  const question =
    action?.question ??
    (subject.kind === "equipment"
      ? `Why is the ${subject.item} at ${subject.site} at risk, and what should we do?`
      : "What is driving the urgent work backlog?");
  return (
    <ExecModal
      eyebrow="The evidence"
      title={title}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Sensor data, the predictive maintenance model, open work orders and SAP outage history.
            Dollar figures are estimates.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onAsk(question);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Sparkles className="size-4 text-primary" /> Ask a question
            </button>
            <button
              onClick={onClose}
              className="og-primary-control rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              Done
            </button>
          </div>
        </div>
      }
    >
      {action && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-sm">
          <span className="font-semibold">{action.title}</span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <User className="size-3.5" /> {action.owner}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="size-3.5" /> {action.due}
          </span>
        </div>
      )}
      {subject.kind === "equipment" ? (
        <EquipmentEvidence assetId={subject.assetId} solution={solution} />
      ) : subject.kind === "weather" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <WeatherDetail row={subject.row} />
        </div>
      ) : (
        <BacklogEvidence />
      )}
    </ExecModal>
  );
}

function EquipmentEvidence({ assetId, solution }: { assetId: string; solution: Solution }) {
  const detail = useQuery({
    queryKey: ["exec-asset-detail", solution, assetId],
    queryFn: () => getJson(`/api/asset/${encodeURIComponent(assetId)}`) as Promise<AssetDetail>,
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  });
  const rc = firstRootCause(detail.data?.rootCause);
  const topAnomaly = detail.data?.anomalies?.[0];
  const trendTag = rc?.tag ?? topAnomaly?.Tag ?? "";
  const trend = useQuery({
    queryKey: ["exec-tag-trend", solution, trendTag],
    queryFn: () =>
      getJson(`/api/tag-trend?tag=${encodeURIComponent(trendTag)}&hours=720&bin=1440`) as Promise<
        Array<{ ts: string; v: number }>
      >,
    enabled: !!trendTag,
    staleTime: 5 * 60 * 1000,
  });
  const work = useQuery({
    queryKey: ["exec-asset-work", solution, assetId],
    queryFn: () =>
      getJson(`/api/asset-workorders/${encodeURIComponent(assetId)}`) as Promise<{
        rows?: WorkRow[];
      }>,
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  });
  const sap = useQuery({
    queryKey: ["exec-sap-outages", solution],
    queryFn: async () => (await loadSapDataset(solution)).outages,
    staleTime: 60 * 60 * 1000,
  });

  const tagInfo = detail.data?.tags?.find((t) => t.tag === trendTag);
  const anomaly = detail.data?.anomalies?.find((a) => a.Tag === trendTag) ?? topAnomaly;
  const outages = (sap.data ?? []).filter((o) => o.ASSET_ID === assetId);
  const open = (work.data?.rows ?? [])
    .filter((r) => r.open !== false)
    .sort((a, b) => rank(a) - rank(b));
  const pl = detail.data?.predLong?.[0];
  const curve = (detail.data?.predShort ?? [])
    .filter((p) => p.stop_probability != null)
    .map((p) => ({
      h: p.prediction_horizon ?? "",
      pct: Math.round((p.stop_probability ?? 0) * 100),
    }));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card icon={Activity} title="Why it's at risk">
        {detail.isLoading ? (
          <Loading label="Reading the sensors…" />
        ) : rc || anomaly ? (
          <>
            <div className="text-[15px] font-semibold leading-6">
              {rc?.failure_mechanism ?? "Abnormal sensor deviation"}
              {rc?.confidence != null && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {Math.round(rc.confidence * 100)}% confidence
                </span>
              )}
            </div>
            {rc?.root_cause && (
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{rc.root_cause}</p>
            )}
            <div className="mt-3 h-28">
              {trend.isLoading ? (
                <Spinner
                  label="Loading the 30-day trend…"
                  className="h-full justify-center rounded-lg bg-muted/40"
                />
              ) : (trend.data?.length ?? 0) > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={trend.data ?? []}
                    margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="ev-trend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="ts"
                      tickFormatter={(t: string) => t.slice(5, 10)}
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={["dataMin", "dataMax"]}
                      width={36}
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmt(v)}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [fmt(Number(v)), tagInfo?.desc ?? trendTag]}
                      labelFormatter={(l) => String(l).slice(0, 10)}
                    />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#f43f5e"
                      strokeWidth={1.6}
                      fill="url(#ev-trend)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
            <div className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{tagInfo?.desc ?? trendTag} · last 30 days</span>
              {anomaly?.latest_value != null && anomaly.baseline_median != null && (
                <span className="shrink-0 tabular-nums">
                  now <b className="text-foreground">{fmt(anomaly.latest_value)}</b> vs{" "}
                  {fmt(anomaly.baseline_median)} normal
                </span>
              )}
            </div>
            {rc?.recommended_action && (
              <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-4">
                <b>Engineering recommends:</b> {rc.recommended_action}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No root-cause analysis on record.</p>
        )}
      </Card>

      <Card icon={TrendingUp} title="Chance of a breakdown">
        {detail.isLoading ? (
          <Loading label="Loading the failure prediction…" />
        ) : curve.length || pl ? (
          <>
            {pl && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat
                  label="Survives 7 days"
                  value={
                    pl.survival_probability_7d != null
                      ? `${Math.round(pl.survival_probability_7d * 100)}%`
                      : "—"
                  }
                />
                <Stat
                  label="Expected life"
                  value={
                    pl.predicted_median_survival_days != null
                      ? `${pl.predicted_median_survival_days} d`
                      : "—"
                  }
                />
                <Stat label="Risk level" value={pl.risk_level ?? "—"} capitalize />
              </div>
            )}
            {curve.length > 0 && (
              <>
                <div className="mt-4 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={curve} margin={{ top: 14, right: 0, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="h"
                        tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [`${v}%`, "Chance it stops"]}
                        cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
                      />
                      <Bar
                        dataKey="pct"
                        radius={[4, 4, 0, 0]}
                        fill="#f59e0b"
                        label={{
                          position: "top",
                          fontSize: 10,
                          fill: "var(--color-muted-foreground)",
                          formatter: (v: unknown) => `${v}%`,
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Chance the unit stops, by time ahead
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No prediction for this asset.</p>
        )}
      </Card>

      <Card
        icon={History}
        title="Failure history · SAP"
        className="md:col-span-2"
        aside={<span className="text-xs text-muted-foreground">to {AS_OF}</span>}
      >
        {sap.isLoading ? (
          <Loading label="Loading SAP failure history…" />
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <OutageHistory outages={outages} />
            </div>
            <OutageTable outages={outages} />
          </div>
        )}
      </Card>

      <Card
        icon={ClipboardList}
        title="Open work orders"
        className="md:col-span-2"
        aside={
          !work.isLoading && (
            <span className="text-xs text-muted-foreground">{open.length} open</span>
          )
        }
      >
        {work.isLoading ? (
          <Loading label="Loading work orders…" />
        ) : (
          <WorkTable rows={open.slice(0, 8)} empty="No open work orders on this asset." />
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2">
      <div
        className={cn("text-lg font-semibold tabular-nums leading-6", capitalize && "capitalize")}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function OutageTable({ outages }: { outages: SapOutage[] }) {
  const rows = [...outages].sort((a, b) => (a.START_DATE < b.START_DATE ? 1 : -1)).slice(0, 6);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No outages recorded.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-1.5 font-medium">Date</th>
          <th className="pb-1.5 font-medium">Type</th>
          <th className="pb-1.5 font-medium">Cause</th>
          <th className="pb-1.5 text-right font-medium">Hours</th>
          <th className="pb-1.5 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((o) => (
          <tr key={o.OUTAGE_ID}>
            <td className="py-1.5 tabular-nums">{o.START_DATE.slice(0, 10)}</td>
            <td className="py-1.5 capitalize">{o.OUTAGE_TYPE.toLowerCase()}</td>
            <td className="max-w-[200px] truncate py-1.5" title={o.CAUSE_TEXT}>
              {o.CAUSE_TEXT}
            </td>
            <td className="py-1.5 text-right tabular-nums">{Math.round(o.DURATION_H)}</td>
            <td className="py-1.5 text-right font-medium tabular-nums">
              {formatUsd(Number(o.TOTAL_IMPACT) || 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkTable({
  rows,
  empty,
  showSite,
}: {
  rows: WorkRow[];
  empty: string;
  showSite?: boolean;
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-1.5 font-medium">Priority</th>
          <th className="pb-1.5 font-medium">Work order</th>
          <th className="pb-1.5 font-medium">Problem</th>
          {showSite && <th className="pb-1.5 font-medium">Where</th>}
          <th className="pb-1.5 font-medium">Status</th>
          <th className="pb-1.5 text-right font-medium">Open for</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((w) => {
          const p = rank(w);
          return (
            <tr key={w.wr_id}>
              <td className="py-1.5">
                <span
                  className={cn(
                    "inline-grid size-6 place-items-center rounded-md text-[11px] font-bold ring-1 ring-inset",
                    PRIORITY_CLS[p] ?? "bg-muted text-muted-foreground ring-border",
                  )}
                >
                  P{p === 9 ? "–" : p}
                </span>
              </td>
              <td className="py-1.5 font-mono">{w.wr_id}</td>
              <td className="max-w-[320px] truncate py-1.5" title={w.problem ?? w.problem_descr}>
                {w.problem ?? w.problem_descr}
              </td>
              {showSite && (
                <td className="py-1.5 text-muted-foreground">{w.location ?? w.site_name ?? "—"}</td>
              )}
              <td className="py-1.5 text-muted-foreground">{w.status ?? w.wr_status ?? "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{age(w.create_date)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BacklogEvidence() {
  const wos = useQuery({
    queryKey: ["exec-open-work"],
    queryFn: () => getJson("/api/work-orders?limit=100") as Promise<WorkRow[]>,
    staleTime: 5 * 60 * 1000,
  });
  const rows = (wos.data ?? []).sort((a, b) => rank(a) - rank(b));
  const urgent = rows.filter((w) => rank(w) <= 2);
  const bySite = Object.entries(
    urgent.reduce<Record<string, number>>((m, w) => {
      const s = w.site_name ?? "Other";
      m[s] = (m[s] ?? 0) + 1;
      return m;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card icon={ClipboardList} title="Urgent work by site">
        {wos.isLoading ? (
          <Loading label="Loading work orders…" />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {bySite.map(([site, n]) => (
              <li key={site} className="flex items-center gap-2">
                <span className="w-24 truncate">{site}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-amber-500"
                    style={{ width: `${(n / (bySite[0]?.[1] ?? 1)) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right font-semibold tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        icon={ClipboardList}
        title={`Priority 1–2 work orders`}
        className="md:col-span-2"
        aside={
          <span className="text-xs text-muted-foreground">
            {urgent.length} of {rows.length} open
          </span>
        }
      >
        {wos.isLoading ? (
          <Loading label="Loading urgent work orders…" />
        ) : (
          <WorkTable rows={urgent.slice(0, 12)} empty="No urgent work orders." showSite />
        )}
      </Card>
    </div>
  );
}
