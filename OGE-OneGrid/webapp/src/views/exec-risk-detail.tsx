// Expandable detail for a row on the executive brief's "Where risk is concentrated" list:
// why it's at risk (root cause + 30-day sensor trend), failure history from SAP, and open work.
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, CloudLightning, History, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { Spinner } from "@/components/ops/Spinner";
import { formatUsd, type RiskRow } from "@/lib/exec/exec-brief";
import { AS_OF, loadSapDataset, type SapOutage } from "@/lib/sap/sap-data";
import type { Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { getJson } from "@/report/lib/api.js";

interface RootCause {
  tag?: string;
  failure_mechanism?: string;
  root_cause?: string;
  confidence?: number;
}

interface AssetDetail {
  rootCause?: RootCause | RootCause[] | null;
  anomalies?: Array<{
    Tag?: string;
    severity?: string;
    latest_value?: number;
    baseline_median?: number;
  }>;
  tags?: Array<{ tag: string; desc?: string; units?: string }>;
}

interface AssetWork {
  open?: number;
  rows?: Array<{
    wr_id: string;
    status?: string;
    problem?: string;
    priority?: number;
    create_date?: string;
    open?: boolean;
  }>;
}

const HISTORY_MONTHS = 24;
const DAY = 86_400_000;

const OUTAGE_COLOR: Record<string, string> = {
  FORCED: "bg-red-500",
  WEATHER: "bg-sky-500",
};
const OTHER_OUTAGE = "bg-muted-foreground/60";

function Mini({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card/70 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={2} /> {title}
      </div>
      {children}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <Spinner label={label} size="sm" className="min-h-16 justify-center" />;
}

const fmt = (v: number) =>
  Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function RiskDetail({
  row,
  solution,
  onEvidence,
}: {
  row: RiskRow;
  solution: Solution;
  onEvidence?: () => void;
}) {
  return (
    <div className="mx-3 mb-2 mt-1 grid gap-3 md:grid-cols-3">
      {row.kind === "weather" ? (
        <WeatherDetail row={row} />
      ) : (
        <EquipmentDetail row={row} solution={solution} onEvidence={onEvidence} />
      )}
    </div>
  );
}

function EquipmentDetail({
  row,
  solution,
  onEvidence,
}: {
  row: RiskRow;
  solution: Solution;
  onEvidence?: (() => void) | undefined;
}) {
  const id = row.assetId ?? "";
  const detail = useQuery({
    queryKey: ["exec-asset-detail", solution, id],
    queryFn: () => getJson(`/api/asset/${encodeURIComponent(id)}`) as Promise<AssetDetail>,
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
  const rawRc = detail.data?.rootCause;
  const rc = (Array.isArray(rawRc) ? rawRc[0] : rawRc) ?? null;
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
    queryKey: ["exec-asset-work", solution, id],
    queryFn: () => getJson(`/api/asset-workorders/${encodeURIComponent(id)}`) as Promise<AssetWork>,
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
  const sap = useQuery({
    queryKey: ["exec-sap-outages", solution],
    queryFn: async () => (await loadSapDataset(solution)).outages,
    staleTime: 60 * 60 * 1000,
  });

  const tagInfo = detail.data?.tags?.find((t) => t.tag === trendTag);
  const anomaly = detail.data?.anomalies?.find((a) => a.Tag === trendTag) ?? topAnomaly;
  const outages = (sap.data ?? []).filter((o) => o.ASSET_ID === id);

  return (
    <>
      <Mini icon={Activity} title="Why it's at risk">
        {detail.isLoading ? (
          <Loading label="Reading the sensors…" />
        ) : rc || anomaly ? (
          <>
            <div className="text-sm font-semibold leading-5">
              {rc?.failure_mechanism ??
                `${sentence(anomaly?.severity ?? "Abnormal")} sensor deviation`}
              {rc?.confidence != null && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {Math.round(rc.confidence * 100)}% confidence
                </span>
              )}
            </div>
            {rc?.root_cause && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                {rc.root_cause}
              </p>
            )}
            <Sparkline data={trend.data ?? []} loading={trend.isLoading} />
            <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{tagInfo?.desc ?? trendTag} · 30 days</span>
              {anomaly?.latest_value != null && anomaly.baseline_median != null && (
                <span className="shrink-0 tabular-nums">
                  now <b className="text-foreground">{fmt(anomaly.latest_value)}</b> vs{" "}
                  {fmt(anomaly.baseline_median)} normal
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No root-cause analysis on record.</p>
        )}
      </Mini>

      <Mini icon={History} title={`Failure history · SAP, ${HISTORY_MONTHS} months`}>
        {sap.isLoading ? (
          <Loading label="Loading SAP history…" />
        ) : (
          <OutageHistory outages={outages} />
        )}
      </Mini>

      <Mini icon={Wrench} title="Open work">
        {work.isLoading ? (
          <Loading label="Loading work orders…" />
        ) : (
          <OpenWork work={work.data ?? null} onViewAll={onEvidence} />
        )}
      </Mini>
    </>
  );
}

function Sparkline({
  data,
  loading,
}: {
  data: Array<{ ts: string; v: number }>;
  loading: boolean;
}) {
  if (loading)
    return <Spinner label="Loading trend…" size="sm" className="my-1.5 h-10 justify-center" />;
  if (data.length < 2) return <div className="my-1.5 h-10" />;
  return (
    <div className="my-1.5 h-10">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="exec-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke="#f43f5e"
            strokeWidth={1.5}
            fill="url(#exec-spark)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OutageHistory({ outages }: { outages: SapOutage[] }) {
  const end = new Date(`${AS_OF}T00:00:00Z`).getTime();
  const start = end - HISTORY_MONTHS * 30.44 * DAY;
  const inRange = outages
    .filter((o) => {
      const t = new Date(o.START_DATE).getTime();
      return t >= start && t <= end;
    })
    .sort((a, b) => (a.START_DATE < b.START_DATE ? 1 : -1));
  if (!inRange.length)
    return <p className="text-sm text-muted-foreground">No outages recorded for this asset.</p>;
  const total = inRange.reduce((s, o) => s + (Number(o.TOTAL_IMPACT) || 0), 0);
  const maxCost = Math.max(...inRange.map((o) => Number(o.TOTAL_IMPACT) || 0), 1);
  const last = inRange[0]!;
  const lastDate = new Date(last.START_DATE).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <div className="text-sm font-semibold leading-5">
        {inRange.length} {inRange.length === 1 ? "outage" : "outages"} ·{" "}
        <span className="tabular-nums">{formatUsd(total)}</span>
      </div>
      <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
        Last: {lastDate} · {last.OUTAGE_TYPE.toLowerCase()} · {Math.round(last.DURATION_H)} h ·{" "}
        {formatUsd(Number(last.TOTAL_IMPACT) || 0)}
      </p>
      {/* timeline: one dot per outage, sized by cost */}
      <div className="relative my-2 h-10">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {inRange.map((o) => {
          const x = ((new Date(o.START_DATE).getTime() - start) / (end - start)) * 100;
          const size = 6 + Math.sqrt((Number(o.TOTAL_IMPACT) || 0) / maxCost) * 14;
          return (
            <span
              key={o.OUTAGE_ID}
              title={`${o.START_DATE.slice(0, 10)} · ${o.OUTAGE_TYPE} · ${formatUsd(Number(o.TOTAL_IMPACT) || 0)}`}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                OUTAGE_COLOR[o.OUTAGE_TYPE] ?? OTHER_OUTAGE,
              )}
              style={{ left: `${Math.min(98, Math.max(2, x))}%`, width: size, height: size }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>2 yrs ago</span>
        <span>today</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-red-500" /> forced
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-sky-500" /> weather
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={cn("size-1.5 rounded-full", OTHER_OUTAGE)} /> other
        </span>
      </div>
    </>
  );
}

function OpenWork({
  work,
  onViewAll,
}: {
  work: AssetWork | null;
  onViewAll?: (() => void) | undefined;
}) {
  const open = (work?.rows ?? []).filter((r) => r.open !== false);
  if (!open.length)
    return <p className="text-sm text-muted-foreground">No open work orders on this asset.</p>;
  const top = [...open].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))[0]!;
  const oldest = open
    .map((r) => (r.create_date ? new Date(r.create_date).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];
  const ageDays = oldest != null ? Math.round((Date.now() - oldest) / DAY) : null;
  const p1 = open.filter((r) => r.priority === 1).length;
  return (
    <>
      <div className="text-sm font-semibold leading-5">
        {open.length} open{p1 ? ` · ${p1} priority-1` : ""}
      </div>
      {ageDays != null && (
        <div className="text-xs text-muted-foreground">Oldest opened {ageDays} days ago</div>
      )}
      <div className="mt-2 rounded-lg bg-muted/50 p-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          P{top.priority ?? "–"} · {top.wr_id} · {top.status}
        </div>
        <div className="line-clamp-2 text-xs leading-4">{top.problem}</div>
      </div>
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          See all the evidence <ArrowRight className="size-3" />
        </button>
      )}
    </>
  );
}

export function WeatherDetail({ row }: { row: RiskRow }) {
  const w = row.weather;
  if (!w) return null;
  return (
    <>
      <Mini icon={CloudLightning} title="Forecast at this site">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Peak wind</dt>
          <dd className="font-semibold tabular-nums">{Math.round(w.windMph)} mph</dd>
          <dt className="text-muted-foreground">Rainfall</dt>
          <dd className="font-semibold tabular-nums">{w.rainIn.toFixed(1)} in</dd>
          <dt className="text-muted-foreground">Distance to track</dt>
          <dd className="font-semibold tabular-nums">{Math.round(w.distanceMi)} mi</dd>
          <dt className="text-muted-foreground">Inside cone</dt>
          <dd className="font-semibold">{w.insideCone ? "Yes" : "No"}</dd>
        </dl>
      </Mini>
      <Mini icon={Activity} title="Why it's at risk">
        <ul className="space-y-1 text-xs">
          {w.factors.slice(0, 4).map((f) => (
            <li key={f.label}>
              <span className="font-semibold">{f.label}:</span>{" "}
              <span className="text-muted-foreground">{f.detail}</span>
            </li>
          ))}
        </ul>
      </Mini>
      <Mini icon={Wrench} title="Recommended preparations">
        {w.recommendations.length ? (
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {w.recommendations.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No specific preparations recorded.</p>
        )}
      </Mini>
    </>
  );
}
