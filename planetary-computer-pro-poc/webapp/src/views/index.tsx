import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, Filter, Sparkles, TrendingUp, X } from "lucide-react";

import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { AppShell } from "@/components/ops/AppShell";
import { OpsMap } from "@/components/ops/OpsMap";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { DataOnboarding } from "@/components/ops/DataOnboarding";
import { RiskBadge, StatCell } from "@/components/ops/RiskBadge";
import { SkeletonRows } from "@/components/ops/Skeleton";
import {
  alertsQuery,
  postureQuery,
  thresholdRulesQuery,
  useOpsSnapshot,
} from "@/lib/hooks/use-ops-data";
import { POSTURE_LEVEL_LABEL } from "@/lib/services/posture";
import { evaluateRules } from "@/lib/services/thresholds";
import { ASSET_TYPE_LABEL, RISK_LABEL, relativeTime, riskColorVar } from "@/lib/format";
import type { AssetType, PostureLevel, RiskLevel } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const LEVEL_FILTERS: RiskLevel[] = ["critical", "high", "elevated", "monitor"];
const TYPE_FILTERS: AssetType[] = [
  "offshore_platform",
  "pipeline",
  "well",
  "refinery",
  "lng_terminal",
  "port",
];

const POSTURE_TONE: Record<PostureLevel, RiskLevel> = {
  0: "normal",
  1: "monitor",
  2: "elevated",
  3: "high",
  4: "critical",
};

function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-sm border px-2 py-1 text-[11px] whitespace-nowrap transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
      )}
      style={active && color ? { borderColor: color, color } : undefined}
    >
      {children}
    </button>
  );
}

export function OverviewPage() {
  const base = useOpsBase();
  const { assets, risks, riskMap, event, metrics, isLoading } = useOpsSnapshot(base, 72);
  const alerts = useQuery(alertsQuery(base)).data ?? [];
  const postures = useQuery(postureQuery(base)).data ?? [];
  const rules = useQuery(thresholdRulesQuery(base)).data ?? [];

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<Set<RiskLevel>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<AssetType>>(new Set());
  const [coneOnly, setConeOnly] = useState(false);

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const filtersActive = levelFilter.size > 0 || typeFilter.size > 0 || coneOnly;
  const clearFilters = () => {
    setLevelFilter(new Set());
    setTypeFilter(new Set());
    setConeOnly(false);
  };

  /** One filter predicate feeds both the map and every table on the page. */
  const filteredAssets = useMemo(
    () =>
      assets.filter((a) => {
        const r = riskMap.get(a.id);
        if (typeFilter.size && !typeFilter.has(a.type)) return false;
        if (levelFilter.size && !(r && levelFilter.has(r.level))) return false;
        if (coneOnly && !r?.insideCone) return false;
        return true;
      }),
    [assets, riskMap, typeFilter, levelFilter, coneOnly],
  );
  const filteredIds = useMemo(() => new Set(filteredAssets.map((a) => a.id)), [filteredAssets]);

  const ranked = useMemo(
    () => risks.filter((r) => filteredIds.has(r.assetId)).sort((a, b) => b.score - a.score),
    [risks, filteredIds],
  );

  const postureById = useMemo(() => new Map(postures.map((p) => [p.assetId, p])), [postures]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const selectedAsset = selected ? (assetById.get(selected) ?? null) : null;

  const breaches = useMemo(() => evaluateRules(rules, assets, risks), [rules, assets, risks]);
  const breachCritical = breaches.filter((b) => b.severity === "critical").length;

  const postureRollup = ([4, 3, 2] as PostureLevel[]).map((lvl) => ({
    lvl,
    n: postures.filter((p) => p.level === lvl && filteredIds.has(p.assetId)).length,
  }));
  const pob = postures
    .filter((p) => filteredIds.has(p.assetId))
    .reduce(
      (acc, p) => ({
        current: acc.current + (p.pobCurrent ?? 0),
        normal: acc.normal + (p.pobNormal ?? 0),
      }),
      { current: 0, normal: 0 },
    );

  const openAlerts = alerts.filter((a) => a.status !== "resolved");

  return (
    <AppShell fullHeight>
      <div className="flex min-h-0 flex-col xl:h-full">
        {/* Metric strip */}
        <div className="shrink-0 border-b bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3">
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                {event?.name ?? "No active event"} — 72 hour outlook
              </h1>
              {event ? (
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {event.status} · moving {Math.round(event.movementMph)} mph · {event.cycleId}{" "}
                  updated {relativeTime(event.updatedAtIso)}
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  No active system in the current forecast cycle
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {event?.cycleShift && (
                <span className="num inline-flex items-center gap-1.5 rounded-sm border border-risk-high/40 bg-risk-high/10 px-2 py-1 text-[11px] text-risk-high">
                  <TrendingUp className="size-3.5" />
                  {event.cycleShift.shiftMi} mi {event.cycleShift.shiftDirection} since{" "}
                  {event.cycleShift.previousCycle}
                </span>
              )}
              <OpsLink
                to="/copilot"
                className="inline-flex items-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15"
              >
                <Sparkles className="size-3.5" /> Operations assistant
              </OpsLink>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 border-t sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <StatCell
              label="Assets monitored"
              value={metrics.monitored}
              sub="Across the asset register"
            />
            <StatCell
              label="Assets exposed"
              value={metrics.exposed}
              sub="Elevated risk or higher"
            />
            <StatCell
              label="Inside forecast cone"
              value={metrics.insideCone}
              sub="Projected impact corridor"
            />
            <StatCell label="High risk" value={metrics.high} tone="high" sub="Score 62–79" />
            <StatCell label="Critical" value={metrics.critical} tone="critical" sub="Score 80+" />
            <StatCell
              label="Threshold breaches"
              value={breaches.length}
              tone={breachCritical > 0 ? "critical" : "high"}
              sub={`${breachCritical} at critical severity`}
            />
            <StatCell
              label="First expected impact"
              value={metrics.firstImpactHours === null ? "—" : `${metrics.firstImpactHours} h`}
              sub="Earliest asset onset"
            />
          </div>
        </div>

        {/* Filter bar — drives the map and every table below */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-panel px-4 py-2">
          <Filter className="size-3.5 text-muted-foreground" />
          {LEVEL_FILTERS.map((l) => (
            <Chip
              key={l}
              active={levelFilter.has(l)}
              color={riskColorVar(l)}
              onClick={() => setLevelFilter((s) => toggle(s, l))}
            >
              {RISK_LABEL[l]}
              <span className="num ml-1 opacity-70">
                {risks.filter((r) => r.level === l).length}
              </span>
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {TYPE_FILTERS.map((t) => (
            <Chip
              key={t}
              active={typeFilter.has(t)}
              onClick={() => setTypeFilter((s) => toggle(s, t))}
            >
              {ASSET_TYPE_LABEL[t]}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Chip active={coneOnly} onClick={() => setConeOnly((v) => !v)}>
            Inside cone only
          </Chip>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Clear
            </button>
          )}
          <span className="num ml-auto text-[11px] text-muted-foreground">
            {filteredAssets.length} of {assets.length} assets in view
          </span>
        </div>

        {/* Command-center body — every pane scrolls inside itself */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-h-0 grid-rows-[auto_auto] gap-px bg-border xl:grid-rows-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="relative h-[440px] min-h-0 bg-background lg:h-[520px] xl:h-auto">
              <OpsMap
                className="h-full w-full"
                assets={filteredAssets}
                risks={riskMap}
                event={event}
                layers={{ assets: true, track: true, wind: true, uncertainty: true }}
                selectedId={selected}
                highlightIds={hovered ? [hovered] : []}
                onSelect={setSelected}
              />
              {assets.length === 0 && (
                <div className="absolute inset-0 z-10">
                  <DataOnboarding className="h-full bg-background/35 backdrop-blur-[1px]" />
                </div>
              )}
            </div>

            <div className="flex h-[420px] min-h-0 flex-col bg-background xl:h-auto">
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
                <span className="label-xs">Highest exposure — ranked</span>
                <OpsLink to="/risk" className="text-[11px] text-primary hover:underline">
                  Full asset risk register
                </OpsLink>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Risk</th>
                      <th className="px-3 py-2 font-medium">Posture</th>
                      <th className="px-3 py-2 font-medium">ETA</th>
                      <th className="px-4 py-2 font-medium">Primary threat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && ranked.length === 0 && <SkeletonRows rows={8} cols={6} />}
                    {ranked.slice(0, 80).map((r) => {
                      const asset = assetById.get(r.assetId);
                      if (!asset) return null;
                      const p = postureById.get(r.assetId);
                      return (
                        <tr
                          key={r.assetId}
                          className={cn(
                            "cursor-pointer border-t hover:bg-accent/50",
                            selected === r.assetId && "bg-accent/70",
                          )}
                          onClick={() => setSelected(r.assetId)}
                          onMouseEnter={() => setHovered(r.assetId)}
                          onMouseLeave={() => setHovered(null)}
                        >
                          <td className="px-4 py-1.5 font-medium">{asset.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {ASSET_TYPE_LABEL[asset.type]}
                          </td>
                          <td className="px-3 py-1.5">
                            <RiskBadge level={r.level} score={r.score} />
                          </td>
                          <td className="px-3 py-1.5">
                            {p && p.level > 0 ? (
                              <span
                                className="text-[11px]"
                                style={{ color: riskColorVar(POSTURE_TONE[p.level]) }}
                              >
                                {POSTURE_LEVEL_LABEL[p.level]}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="num px-3 py-1.5">{r.hoursToImpact ?? "—"} h</td>
                          <td className="px-4 py-1.5 text-muted-foreground">
                            {r.forecastWindMph >= 74
                              ? `${r.forecastWindMph} mph sustained wind`
                              : `${r.rainfallIn} in rainfall`}
                          </td>
                        </tr>
                      );
                    })}
                    {!isLoading && ranked.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                          No assets match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right rail */}
          <div className="min-h-0 bg-background xl:overflow-y-auto">
            {selectedAsset ? (
              <AssetDetailPanel
                asset={selectedAsset}
                risk={riskMap.get(selectedAsset.id)}
                event={event}
                allAssets={assets}
                onClose={() => setSelected(null)}
                onSelect={setSelected}
              />
            ) : (
              <div className="divide-y">
                <div className="p-4">
                  <div className="label-xs mb-2 flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-primary" /> Operational summary
                  </div>
                  {event ? (
                    <>
                      <p className="text-xs leading-relaxed">
                        <strong>{event.name}</strong> is the active system for the current forecast
                        cycle. <strong>{metrics.insideCone} facilities</strong> sit inside the
                        projected corridor and <strong>{metrics.exposed} assets</strong> carry
                        elevated risk or higher.{" "}
                        <strong>{breaches.length} configured thresholds</strong> are breached this
                        cycle
                        {metrics.firstImpactHours !== null
                          ? `, with first onset in ${metrics.firstImpactHours} hours`
                          : ""}
                        .
                      </p>
                      {event.cycleShift && (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          {event.cycleShift.summary}
                        </p>
                      )}
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        Grounded in the {event.cycleId} forecast cycle, asset register, threshold
                        rules and risk model.
                      </div>
                    </>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      No active weather event in the current forecast cycle. When the weather
                      provider reports a system in the operating region, a grounded summary of
                      exposed facilities and breached thresholds appears here.
                    </p>
                  )}
                </div>

                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label-xs">Response posture</span>
                    <OpsLink to="/posture" className="text-[11px] text-primary hover:underline">
                      Open gate board
                    </OpsLink>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {postureRollup.map((p) => (
                      <div key={p.lvl} className="rounded-sm border px-2 py-2">
                        <div
                          className="text-[10px]"
                          style={{ color: riskColorVar(POSTURE_TONE[p.lvl]) }}
                        >
                          {POSTURE_LEVEL_LABEL[p.lvl]}
                        </div>
                        <div className="num mt-0.5 text-lg leading-none font-semibold">{p.n}</div>
                      </div>
                    ))}
                  </div>
                  <div className="num mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Personnel on board</span>
                    <span className="text-foreground">
                      {pob.current} / {pob.normal}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label-xs">Threshold breaches</span>
                    <OpsLink to="/thresholds" className="text-[11px] text-primary hover:underline">
                      Configure
                    </OpsLink>
                  </div>
                  <ul className="space-y-1.5">
                    {breaches.slice(0, 5).map((b, i) => (
                      <li
                        key={`${b.ruleId}-${b.assetId}-${i}`}
                        className="text-[11px] leading-snug"
                      >
                        <button
                          className="text-left hover:underline"
                          onClick={() => setSelected(b.assetId)}
                          onMouseEnter={() => setHovered(b.assetId)}
                          onMouseLeave={() => setHovered(null)}
                        >
                          <span className="font-medium">
                            {assetById.get(b.assetId)?.name ?? b.assetId}
                          </span>
                          <span className="text-muted-foreground"> — {b.ruleName}</span>
                        </button>
                      </li>
                    ))}
                    {breaches.length === 0 && (
                      <li className="text-[11px] text-muted-foreground">
                        No thresholds breached this cycle.
                      </li>
                    )}
                  </ul>
                </div>

                <div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="label-xs">Active alerts</span>
                    <OpsLink to="/alerts" className="text-[11px] text-primary hover:underline">
                      All alerts
                    </OpsLink>
                  </div>
                  <ul className="divide-y border-t">
                    {openAlerts.slice(0, 6).map((a) => (
                      <li key={a.id} className="px-4 py-2.5">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1.5 size-1.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: riskColorVar(
                                a.severity === "critical"
                                  ? "critical"
                                  : a.severity === "warning"
                                    ? "high"
                                    : "monitor",
                              ),
                            }}
                          />
                          <div>
                            <div className="text-xs leading-snug font-medium">{a.title}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {a.owner} · {relativeTime(a.createdAtIso)}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                    {openAlerts.length === 0 && (
                      <li className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                        No active alerts.
                      </li>
                    )}
                  </ul>
                </div>

                <OpsLink
                  to="/timeline"
                  className="flex items-center gap-1 px-4 py-3 text-[11px] text-primary hover:underline"
                >
                  Scrub the forecast timeline <ArrowRight className="size-3" />
                </OpsLink>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
