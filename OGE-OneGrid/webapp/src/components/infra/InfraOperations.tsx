import { useMemo, useState } from "react";
import {
  Activity,
  TriangleAlert as AlertTriangle,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Cloud,
  Server,
  RadioTower,
  ShieldCheck,
  Gauge,
  Cpu,
  Signal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSETS,
  ASSET_BY_ID,
  SITES,
  SOURCES,
  TICKETS,
  OUTAGES,
  OUTAGE_STATUS_META,
  CATEGORY_META,
  STATUS_COLOR,
  STATUS_LABEL,
  SITE_BY_ID,
  fleetStats,
  type InfraStatus,
  type InfraCategory,
  type Outage,
} from "@/lib/infra/infra-data";
import { useLiveTick, liveValue, liveAssetStatus } from "@/lib/infra/infra-live";
import { KindIcon, RadialGauge, Sparkline, StatusDot, StatTile } from "./infra-ui";
import { fmtCost, fmtNum, fmtRelTime } from "./infra-format";
import { OutageRca } from "./OutageRca";

const SITE_ICON: Record<string, typeof Cloud> = {
  cloud: Cloud,
  datacenter: Server,
  edge: RadioTower,
};
const SEV_COLOR: Record<string, string> = {
  sev1: "#ff5a5f",
  sev2: "#f0803c",
  sev3: "#f0b429",
  sev4: "#7d8597",
};

function aggMetric(keyName: string, mode: "avg" | "sum"): number {
  let total = 0;
  let count = 0;
  for (const a of ASSETS) {
    if (a.status === "offline") continue;
    const m = a.metrics.find((mm) => mm.key === keyName);
    if (!m) continue;
    total += liveValue(a.id, keyName);
    count += 1;
  }
  if (count === 0) return 0;
  return mode === "avg" ? total / count : total;
}

export function InfraOperations({
  onOpenAsset,
  onGoTab,
}: {
  onOpenAsset?: (id: string) => void;
  onGoTab?: (tab: string) => void;
}) {
  useLiveTick();
  const stats = useMemo(() => fleetStats(), []);
  const healthColor =
    stats.healthScore >= 90 ? "#3fb950" : stats.healthScore >= 75 ? "#f0b429" : "#ff5a5f";

  // live aggregates
  const avgCpu = aggMetric("cpu", "avg");
  const totalReq = aggMetric("rps", "sum");
  const otTags = aggMetric("tagsps", "sum");
  const ingest = liveValue("eventhouse-eh", "ingest");

  // live watchlist: worst assets first
  const watch = useMemo(
    () =>
      [...ASSETS]
        .map((a) => ({ a, s: liveAssetStatus(a) }))
        .filter((x) => x.s === "critical" || x.s === "warning")
        .sort((x, y) => (x.s === "critical" ? -1 : 1) - (y.s === "critical" ? -1 : 1)),
    [],
  );

  const openTickets = useMemo(
    () =>
      TICKETS.filter((t) => t.status !== "resolved").sort(
        (a, b) => a.openedMinAgo - b.openedMinAgo,
      ),
    [],
  );

  const [rcaOutage, setRcaOutage] = useState<Outage | null>(null);
  const outages = useMemo(() => {
    const rank = (o: Outage) => (o.status === "active" ? 0 : o.status === "mitigated" ? 1 : 2);
    return [...OUTAGES].sort((a, b) => rank(a) - rank(b) || a.startedMinAgo - b.startedMinAgo);
  }, []);
  const activeOutages = OUTAGES.filter((o) => o.status === "active").length;

  return (
    <div className="space-y-4 p-4">
      {/* ── hero: health + key tiles ── */}
      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
          <RadialGauge
            value={stats.healthScore}
            max={100}
            size={128}
            color={healthColor}
            sub="Fleet health"
          />
          <div className="space-y-2">
            {(["healthy", "warning", "critical", "offline"] as InfraStatus[]).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <StatusDot status={s} />
                <span className="w-16 text-[12px] text-muted-foreground">{STATUS_LABEL[s]}</span>
                <span className="text-[13px] font-semibold tabular-nums text-foreground">
                  {stats.byStatus[s]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            icon={Boxes}
            label="Assets"
            value={stats.total}
            sub={`${SITES.length} sites`}
            onClick={() => onGoTab?.("assets")}
          />
          <StatTile
            icon={AlertTriangle}
            label="Open incidents"
            value={stats.openIncidents}
            sub={stats.sev1 ? `${stats.sev1} Sev1 active` : "no Sev1"}
            accent={stats.sev1 ? STATUS_COLOR.critical : undefined}
            onClick={() => onGoTab?.("tickets")}
          />
          <StatTile
            icon={CircleDollarSign}
            label="Monthly run-rate"
            value={fmtCost(stats.monthlyCost)}
            sub={`${fmtCost(stats.potentialSavings)}/mo savings found`}
            onClick={() => onGoTab?.("cost")}
          />
          <LiveTile
            icon={Cpu}
            label="Avg CPU"
            value={`${fmtNum(avgCpu)}%`}
            assetId="aks-prod-1"
            metricKey="cpu"
            color="#4f8cff"
          />
          <LiveTile
            icon={Activity}
            label="App requests"
            value={`${fmtNum(totalReq)}/s`}
            assetId="ca-onegrid"
            metricKey="rps"
            color="#19c3d3"
          />
          <LiveTile
            icon={Signal}
            label="OT tags ingested"
            value={`${fmtNum(otTags)}/s`}
            assetId="scada-gw-plant"
            metricKey="tagsps"
            color="#ff6fb5"
          />
        </div>
      </div>

      {/* ── outages (click to investigate) ── */}
      {outages.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-primary" />
              <span className="text-[13px] font-semibold text-foreground">Outages</span>
              {activeOutages > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
                  <span className="size-1.5 animate-pulse rounded-full bg-red-400" />{" "}
                  {activeOutages} active
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              click to investigate root cause
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {outages.map((o) => {
              const sev = SEV_COLOR[o.severity];
              const sm = OUTAGE_STATUS_META[o.status];
              const root = ASSET_BY_ID.get(o.rootCauseAssetId);
              return (
                <button
                  key={o.id}
                  onClick={() => setRcaOutage(o)}
                  className="flex flex-col gap-1.5 rounded-xl border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                  style={{ borderLeft: `3px solid ${sev}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                      style={{ background: `${sev}22`, color: sev }}
                    >
                      {o.severity}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                      style={{ background: `${sm.color}1f`, color: sm.color }}
                    >
                      {o.status === "active" && (
                        <span
                          className="size-1.5 animate-pulse rounded-full"
                          style={{ background: sm.color }}
                        />
                      )}
                      {sm.label}
                    </span>
                    <span className="ml-auto font-mono text-[9.5px] text-muted-foreground">
                      {o.id}
                    </span>
                  </div>
                  <div className="text-[12.5px] font-semibold leading-snug text-foreground">
                    {o.title}
                  </div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {o.affectedServices[0]}
                    {o.affectedServices.length > 1 ? ` +${o.affectedServices.length - 1}` : ""} · ~
                    {o.estUsers} users
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-muted-foreground">
                      {root && (
                        <>
                          <span style={{ color: CATEGORY_META[root.category].color }}>
                            <KindIcon kind={root.kind} className="size-3" />
                          </span>
                          <span className="truncate">{root.name}</span>
                        </>
                      )}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-primary">
                      Root cause <ArrowRight className="size-3" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── category + sources ── */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border bg-card p-4">
          <SectionHead icon={Gauge} title="Estate by category" />
          <div className="space-y-2.5">
            {(Object.keys(CATEGORY_META) as InfraCategory[]).map((c) => {
              const count = stats.byCategory[c];
              const pct = (count / stats.total) * 100;
              return (
                <div key={c} className="flex items-center gap-3">
                  <div
                    className="w-20 shrink-0 text-[12px] font-medium"
                    style={{ color: CATEGORY_META[c].color }}
                  >
                    {CATEGORY_META[c].label}
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: CATEGORY_META[c].color }}
                    />
                  </div>
                  <div className="w-7 shrink-0 text-right text-[12px] font-semibold tabular-nums text-foreground">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <SectionHead
            icon={ShieldCheck}
            title="Source systems"
            action={onGoTab ? { label: "View all", onClick: () => onGoTab("sources") } : undefined}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SOURCES.map((s) => {
              const col =
                s.status === "connected"
                  ? "#3fb950"
                  : s.status === "degraded"
                    ? "#f0b429"
                    : "#4f8cff";
              return (
                <div key={s.id} className="rounded-lg border bg-muted/30 p-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: col, boxShadow: `0 0 6px ${col}` }}
                    />
                    <span
                      className="truncate text-[11px] font-medium text-foreground"
                      title={s.name}
                    >
                      {s.name.split(" · ")[0]}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] capitalize text-muted-foreground">
                    {s.status} · {Math.round(s.coverage * 100)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── sites ── */}
      <div className="rounded-xl border bg-card p-4">
        <SectionHead
          icon={Cloud}
          title="Sites"
          action={
            onGoTab ? { label: "Open 3D explorer", onClick: () => onGoTab("assets") } : undefined
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SITES.map((site) => {
            const SiteIcon = SITE_ICON[site.kind] ?? Server;
            const rollup = stats.bySite[site.id];
            const siteAssets = ASSETS.filter((a) => a.siteId === site.id);
            const worst = rollup?.worst ?? "healthy";
            return (
              <button
                key={site.id}
                onClick={() => onGoTab?.("assets")}
                className="rounded-xl border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                style={{ borderLeft: `3px solid ${STATUS_COLOR[worst]}` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <SiteIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {site.name}
                    </span>
                  </div>
                  <StatusDot status={worst} pulse />
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {site.location}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  {siteAssets.map((a) => (
                    <span
                      key={a.id}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: STATUS_COLOR[liveAssetStatus(a)] }}
                      title={a.name}
                    />
                  ))}
                </div>
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                  {siteAssets.length} assets
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── watchlist + incidents ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <SectionHead
            icon={Activity}
            title="Live watchlist"
            sub={`${watch.length} assets off-nominal`}
          />
          <div className="space-y-1.5">
            {watch.length === 0 && (
              <div className="py-6 text-center text-[12px] text-muted-foreground">
                All assets nominal.
              </div>
            )}
            {watch.map(({ a, s }) => {
              const m = a.metrics[0];
              if (!m) return null;
              return (
                <button
                  key={a.id}
                  onClick={() => onOpenAsset?.(a.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-left hover:border-primary/40 hover:bg-accent/40"
                >
                  <StatusDot status={s} pulse />
                  <div
                    className="grid size-7 shrink-0 place-items-center rounded-md"
                    style={{
                      background: `${CATEGORY_META[a.category].color}1f`,
                      color: CATEGORY_META[a.category].color,
                    }}
                  >
                    <KindIcon kind={a.kind} className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-foreground">
                      {a.name}
                    </div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {SITE_BY_ID.get(a.siteId)?.name}
                    </div>
                  </div>
                  <Sparkline
                    assetId={a.id}
                    metricKey={m.key}
                    color={STATUS_COLOR[s]}
                    width={64}
                    height={22}
                    points={30}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <SectionHead
            icon={AlertTriangle}
            title="Active incidents"
            action={
              onGoTab ? { label: "All tickets", onClick: () => onGoTab("tickets") } : undefined
            }
          />
          <div className="space-y-1.5">
            {openTickets.slice(0, 6).map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenAsset?.(t.assetId)}
                className="flex w-full items-start gap-2 rounded-lg border bg-muted/20 p-2 text-left hover:border-primary/40 hover:bg-accent/40"
              >
                <span
                  className="mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                  style={{ background: `${SEV_COLOR[t.severity]}22`, color: SEV_COLOR[t.severity] }}
                >
                  {t.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-foreground">{t.title}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {t.id} · {t.assignee} · {fmtRelTime(t.openedMinAgo)}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold capitalize",
                    t.status === "in-progress"
                      ? "bg-blue-500/15 text-blue-400"
                      : t.status === "ack"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {rcaOutage && (
        <OutageRca
          outage={rcaOutage}
          onOpenAsset={onOpenAsset}
          onClose={() => setRcaOutage(null)}
        />
      )}
    </div>
  );
}

function LiveTile({
  icon: Icon,
  label,
  value,
  assetId,
  metricKey,
  color,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  assetId: string;
  metricKey: string;
  color: string;
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" style={{ color }} /> {label}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> live
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-2xl font-bold tabular-nums leading-none text-foreground">{value}</div>
        <Sparkline
          assetId={assetId}
          metricKey={metricKey}
          color={color}
          width={80}
          height={28}
          points={30}
        />
      </div>
    </div>
  );
}

function SectionHead({
  icon: Icon,
  title,
  sub,
  action,
}: {
  icon: typeof Cloud;
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {sub && <span className="text-[11px] text-muted-foreground">· {sub}</span>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
