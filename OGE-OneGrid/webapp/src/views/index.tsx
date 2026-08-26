import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight, Boxes, Cpu, Sparkles, Waves, Wrench } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { StatCell } from "@/components/ops/RiskBadge";
import { postureQuery, useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { RISK_LABEL, RISK_ORDER, relativeTime, riskColorVar } from "@/lib/format";
import type { PostureLevel, RiskLevel } from "@/lib/domain/types";

// Overview — the OneGrid Estate Command deck: the single highest-level read that fuses
// BOTH intelligence domains (weather storm-exposure + digital-twin equipment condition)
// into one situational picture. Above Asset Explorer: no per-asset register — a synthesized
// status, combined KPIs, a summary card per domain (real data), and the blended top actions.

const EQUIP_COLOR = { critical: "#ff5470", watch: "#ffcc4d", ok: "#2fd07a" } as const;
const STATUS_COLOR = {
  critical: "#ff5470",
  high: "#ff8c42",
  elevated: "#ffcc4d",
  normal: "#2fd07a",
};

type TwinAsset = {
  asset_id: string;
  name: string;
  plant: string;
  unit: string;
  status: "ok" | "watch" | "critical";
  health: number;
  anom_n: number;
  max_z: number;
};
type Twin = {
  healthAvg: number;
  crit: number;
  watch: number;
  ok: number;
  tags: number;
  anomalies: number;
  trips: number;
  openWo: number;
  assets: TwinAsset[];
};

function StackBar({ segments }: { segments: { value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-border">
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ) : null,
      )}
    </div>
  );
}

export function OverviewPage() {
  const router = useRouter();
  const base = useOpsBase();
  const { assets, risks, event, metrics } = useOpsSnapshot(base, 72);
  const postures = useQuery(postureQuery(base)).data ?? [];
  const [twin, setTwin] = useState<Twin | null>(null);

  useEffect(() => {
    let ok = true;
    import("@/report/lib/sample.js").then((m) => {
      if (!ok) return;
      const fh = m.fleetHealth();
      const fa = m.fleetAssets() as TwinAsset[];
      const pd = m.predictionsDetail();
      const wo = m.workOrdersSummary();
      const fm = m.facilityModel();
      setTwin({
        healthAvg: Math.round(fh.health.avg),
        crit: fa.filter((a) => a.status === "critical").length,
        watch: fa.filter((a) => a.status === "watch").length,
        ok: fa.filter((a) => a.status === "ok").length,
        tags: fm.counts.tags,
        anomalies: fh.anomalies.rows ?? 0,
        trips: pd.counts.critical + pd.counts.high,
        openWo: wo.open,
        assets: fa,
      });
    });
    return () => {
      ok = false;
    };
  }, []);

  // ---- estate-wide synthesis --------------------------------------------
  const stormCrit = metrics.critical;
  const equipCrit = twin?.crit ?? 0;
  const equipRisk = (twin?.crit ?? 0) + (twin?.watch ?? 0);
  const totalAssets = assets.length + (twin?.assets.length ?? 0);
  const estateCritical = stormCrit + equipCrit;

  const statusKey: keyof typeof STATUS_COLOR =
    estateCritical > 0 ? "critical" : metrics.exposed > 0 || equipRisk > 0 ? "elevated" : "normal";
  const statusLabel =
    statusKey === "critical" ? "Critical" : statusKey === "elevated" ? "Elevated" : "All clear";
  const statusColor = STATUS_COLOR[statusKey];

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (event) {
      parts.push(
        `${event.name} (Cat ${event.currentCategory}) is tracking the estate — ${metrics.exposed} assets exposed, first impact ${metrics.firstImpactHours != null ? `in ${metrics.firstImpactHours} h` : "pending"}.`,
      );
    } else {
      parts.push("No active weather system in the current forecast cycle.");
    }
    if (twin) {
      const worst = [...twin.assets]
        .filter((a) => a.status !== "ok")
        .sort((a, b) => a.health - b.health)[0];
      parts.push(
        `Digital twin: fleet health ${twin.healthAvg}%, ${twin.crit} critical asset${twin.crit === 1 ? "" : "s"}${worst ? ` (${worst.unit} ${worst.name})` : ""}, ${twin.trips} predicted trip${twin.trips === 1 ? "" : "s"} over 14 days.`,
      );
    }
    return parts.join(" ");
  }, [event, metrics, twin]);

  // ---- blended top-of-estate priorities ---------------------------------
  type Prio = {
    key: string;
    name: string;
    domain: "infrastructure" | "equipment";
    color: string;
    levelLabel: string;
    concern: string;
    rank: number;
    to: string;
  };
  const priorities = useMemo<Prio[]>(() => {
    const infra: Prio[] = risks
      .filter((r) => r.level === "critical" || r.level === "high")
      .map((r) => {
        const a = assets.find((x) => x.id === r.assetId);
        return {
          key: `i:${r.assetId}`,
          name: a?.name ?? r.assetId,
          domain: "infrastructure" as const,
          color: riskColorVar(r.level),
          levelLabel: RISK_LABEL[r.level],
          concern:
            r.forecastWindMph >= 74
              ? `${r.forecastWindMph} mph wind${r.hoursToImpact != null ? ` · ${r.hoursToImpact}h to impact` : ""}`
              : `${a?.region ?? ""} · ${r.hoursToImpact != null ? `${r.hoursToImpact}h to impact` : "monitoring"}`,
          rank: r.level === "critical" ? 4 : 3,
          to: `${base}/risk`,
        };
      });
    const equip: Prio[] = (twin?.assets ?? [])
      .filter((a) => a.status !== "ok")
      .map((a) => ({
        key: `e:${a.asset_id}`,
        name: `${a.unit} ${a.name}`,
        domain: "equipment" as const,
        color: EQUIP_COLOR[a.status],
        levelLabel: a.status === "critical" ? "Critical" : "Watch",
        concern: `${a.plant} · ${a.anom_n} anomalies · peak z ${a.max_z} · ${a.health}% health`,
        rank: a.status === "critical" ? 4 : 2,
        to: `${base}/asset-explorer?open=${encodeURIComponent(a.asset_id)}`,
      }));
    return [...infra, ...equip].sort((a, b) => b.rank - a.rank).slice(0, 8);
  }, [risks, assets, twin, base]);

  // ---- weather posture rollup -------------------------------------------
  const postureRollup = ([4, 3, 2] as PostureLevel[]).map((lvl) => ({
    lvl,
    n: postures.filter((p) => p.level === lvl).length,
  }));
  const pob = postures.reduce(
    (acc, p) => ({
      current: acc.current + (p.pobCurrent ?? 0),
      normal: acc.normal + (p.pobNormal ?? 0),
    }),
    { current: 0, normal: 0 },
  );

  const weatherSegs = RISK_ORDER.map((l) => ({
    value: risks.filter((r) => r.level === l).length,
    color: riskColorVar(l),
    level: l,
  }));
  const equipSegs = (["critical", "watch", "ok"] as const).map((s) => ({
    value: twin ? (s === "critical" ? twin.crit : s === "watch" ? twin.watch : twin.ok) : 0,
    color: EQUIP_COLOR[s],
    level: s,
  }));

  return (
    <AppShell fullHeight>
      <div className="flex h-full min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] space-y-4 p-5">
            {/* hero status band */}
            <div
              className="flex flex-wrap items-center gap-4 rounded-lg border p-4"
              style={{
                background: `linear-gradient(90deg, ${statusColor}14, transparent 60%)`,
                borderLeft: `3px solid ${statusColor}`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="relative flex size-3">
                  {statusKey !== "normal" && (
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                      style={{ background: statusColor }}
                    />
                  )}
                  <span
                    className="relative inline-flex size-3 rounded-full"
                    style={{ background: statusColor }}
                  />
                </span>
                <div>
                  <div className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                    Estate Command
                  </div>
                  <div
                    className="text-xl leading-tight font-semibold"
                    style={{ color: statusColor }}
                  >
                    {statusLabel}
                  </div>
                </div>
              </div>
              <p className="min-w-[280px] flex-1 text-[13px] text-muted-foreground">{summary}</p>
              <div className="flex items-center gap-2">
                {event?.cycleShift && (
                  <span className="num rounded-sm border px-2 py-1 text-[11px] text-muted-foreground">
                    {event.cycleShift.shiftMi} mi {event.cycleShift.shiftDirection} ·{" "}
                    {event.cycleId} {event ? relativeTime(event.updatedAtIso) : ""}
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

            {/* combined estate KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCell
                label="Total Assets"
                value={totalAssets}
                sub={`${assets.length} infra · ${twin?.assets.length ?? "—"} equipment`}
              />
              <StatCell
                label="Estate Critical"
                value={estateCritical}
                tone="critical"
                sub={`${stormCrit} storm · ${equipCrit} equipment`}
              />
              <StatCell
                label="Storm-Exposed"
                value={metrics.exposed}
                tone="high"
                sub="elevated or higher"
              />
              <StatCell
                label="Equipment At-Risk"
                value={equipRisk}
                tone="elevated"
                sub="watch or critical"
              />
              <StatCell
                label="Open Work Orders"
                value={twin?.openWo ?? "—"}
                sub="digital-twin fleet"
              />
              <StatCell
                label="First Storm Impact"
                value={metrics.firstImpactHours != null ? `${metrics.firstImpactHours} h` : "—"}
                sub="earliest asset onset"
              />
            </div>

            {/* two domains at a glance */}
            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              {/* weather / storm exposure */}
              <div className="panel overflow-hidden">
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Waves className="size-4" style={{ color: "#5aa9ff" }} /> Storm Exposure ·
                    Weather
                  </div>
                  <OpsLink to="/map" className="text-[11px] text-primary hover:underline">
                    Live Map →
                  </OpsLink>
                </div>
                <div className="p-4">
                  <div className="space-y-3">
                    {event && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md border bg-card px-2 py-2">
                          <div className="num text-lg leading-none font-semibold">
                            Cat {event.currentCategory}
                          </div>
                          <div className="label-xs mt-1">{event.name}</div>
                        </div>
                        <div className="rounded-md border bg-card px-2 py-2">
                          <div className="num text-lg leading-none font-semibold">
                            {event.currentWindMph}
                          </div>
                          <div className="label-xs mt-1">mph wind</div>
                        </div>
                        <div className="rounded-md border bg-card px-2 py-2">
                          <div className="num text-lg leading-none font-semibold">
                            {Math.round(event.movementMph)}
                          </div>
                          <div className="label-xs mt-1">mph {event.movementDeg}°</div>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Exposure across {assets.length} infrastructure assets</span>
                        <span className="num">{metrics.exposed} exposed</span>
                      </div>
                      <StackBar segments={weatherSegs} />
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {weatherSegs.map((s) => (
                          <span
                            key={s.level}
                            className="inline-flex items-center gap-1 text-[11px]"
                          >
                            <span className="size-2 rounded-full" style={{ background: s.color }} />
                            <span className="text-muted-foreground">{RISK_LABEL[s.level]}</span>
                            <span className="num">{s.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      {postureRollup.map((p) => (
                        <span
                          key={p.lvl}
                          className="num rounded-sm border px-2 py-1 text-[11px]"
                          style={{
                            color:
                              STATUS_COLOR[
                                p.lvl === 4 ? "critical" : p.lvl === 3 ? "high" : "elevated"
                              ],
                          }}
                        >
                          {p.lvl === 4 ? "Evacuate" : p.lvl === 3 ? "Down-man" : "Prepare"} {p.n}
                        </span>
                      ))}
                      <span className="num ml-auto text-[11px] text-muted-foreground">
                        POB {pob.current.toLocaleString()} / {pob.normal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* digital twin / equipment health */}
              <div className="panel overflow-hidden">
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Boxes className="size-4" style={{ color: "#a986ff" }} /> Equipment Health ·
                    Digital Twin
                  </div>
                  <OpsLink to="/control-room" className="text-[11px] text-primary hover:underline">
                    Control Room →
                  </OpsLink>
                </div>
                <div className="space-y-3 p-4">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-md border bg-card px-2 py-2">
                      <div className="num text-lg leading-none font-semibold">
                        {twin?.healthAvg ?? "—"}%
                      </div>
                      <div className="label-xs mt-1">fleet health</div>
                    </div>
                    <div className="rounded-md border bg-card px-2 py-2">
                      <div className="num text-lg leading-none font-semibold">
                        {twin?.tags ?? "—"}
                      </div>
                      <div className="label-xs mt-1">tags live</div>
                    </div>
                    <div className="rounded-md border bg-card px-2 py-2">
                      <div className="num text-lg leading-none font-semibold text-risk-high">
                        {twin?.anomalies ?? "—"}
                      </div>
                      <div className="label-xs mt-1">anomalies</div>
                    </div>
                    <div className="rounded-md border bg-card px-2 py-2">
                      <div className="num text-lg leading-none font-semibold">
                        {twin?.trips ?? "—"}
                      </div>
                      <div className="label-xs mt-1">trips · 14d</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Condition across {twin?.assets.length ?? 0} equipment assets</span>
                      <span className="num">{equipRisk} at risk</span>
                    </div>
                    <StackBar segments={equipSegs} />
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {equipSegs.map((s) => (
                        <span key={s.level} className="inline-flex items-center gap-1 text-[11px]">
                          <span className="size-2 rounded-full" style={{ background: s.color }} />
                          <span className="text-muted-foreground capitalize">
                            {s.level === "ok" ? "Healthy" : s.level}
                          </span>
                          <span className="num">{s.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <OpsLink
                      to="/control-room"
                      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-medium hover:bg-accent/50"
                    >
                      <Cpu className="size-3.5" /> Control Room
                    </OpsLink>
                    <OpsLink
                      to="/maintenance"
                      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-medium hover:bg-accent/50"
                    >
                      <Wrench className="size-3.5" /> Maintenance
                    </OpsLink>
                    <OpsLink
                      to="/simulation"
                      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-medium hover:bg-accent/50"
                    >
                      <Sparkles className="size-3.5" /> Simulation
                    </OpsLink>
                  </div>
                </div>
              </div>
            </div>

            {/* blended top-of-estate priorities */}
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="text-[13px] font-semibold">Top of estate — act now</span>
                <OpsLink to="/asset-explorer" className="text-[11px] text-primary hover:underline">
                  Asset Explorer →
                </OpsLink>
              </div>
              <div className="divide-y">
                {priorities.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => router.navigate({ to: p.to })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: p.color }}
                    />
                    <span className="w-52 shrink-0 truncate text-[13px] font-medium">{p.name}</span>
                    <span
                      className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                      style={{
                        color: p.domain === "infrastructure" ? "#5aa9ff" : "#a986ff",
                        background: `${p.domain === "infrastructure" ? "#5aa9ff" : "#a986ff"}1a`,
                      }}
                    >
                      {p.domain === "infrastructure" ? "Infrastructure" : "Equipment"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                      {p.concern}
                    </span>
                    <span
                      className="num shrink-0 text-[11px] font-semibold"
                      style={{ color: p.color }}
                    >
                      {p.levelLabel}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {priorities.length === 0 && (
                  <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                    Estate stable — no critical or high-severity items across either domain.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
