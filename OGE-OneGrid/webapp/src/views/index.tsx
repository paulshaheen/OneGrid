import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowUpDown, Cog, Cpu, Search, Sparkles, Waves, Wrench } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { OpsMap } from "@/components/ops/OpsMap";
import { RiskBadge, StatCell } from "@/components/ops/RiskBadge";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { ASSET_TYPE_LABEL, RISK_LABEL, RISK_ORDER, riskColorVar } from "@/lib/format";
import type { RiskLevel } from "@/lib/domain/types";
import { MODES } from "@/report/lib/themes.js";

// Overview — the OneGrid estate home: a synthesized executive read across BOTH intelligence
// domains (weather storm-exposure + digital-twin equipment condition) on top of a single,
// clickable unified asset register. Infrastructure rows open the storm-exposure drawer;
// equipment rows open the full 3D asset modal. A "Fleet Overview" toggle surfaces the
// Executive fleet dashboard (health sunburst + priority watch).

type Domain = "infrastructure" | "equipment";

type EquipAsset = {
  asset_id: string;
  name: string;
  plant: string;
  unit: string;
  category: string;
  status: "ok" | "watch" | "critical";
  health: number;
  condition: number;
  anom_n: number;
  watch_n: number;
  max_z: number;
  risk_level: string;
};

const EQUIP_COLOR = { critical: "#ff5470", watch: "#ffcc4d", ok: "#2fd07a" } as const;
const STATUS_COLOR = {
  critical: "#ff5470",
  high: "#ff8c42",
  elevated: "#ffcc4d",
  normal: "#2fd07a",
};

function DomainBadge({ domain }: { domain: Domain }) {
  const infra = domain === "infrastructure";
  const color = infra ? "#5aa9ff" : "#a986ff";
  const Icon = infra ? Waves : Cog;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}33` }}
    >
      <Icon className="size-3" />
      {infra ? "Infrastructure" : "Equipment"}
    </span>
  );
}

function CondBadge({ status, condition }: { status: EquipAsset["status"]; condition: number }) {
  const color = EQUIP_COLOR[status];
  const label = status === "critical" ? "Critical" : status === "watch" ? "Watch" : "Healthy";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase whitespace-nowrap"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}1f` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
      <span className="num opacity-80">{condition}</span>
    </span>
  );
}

function MiniDonut({
  segments,
  size = 96,
  thickness = 12,
  centerTop,
  centerSub,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerTop: string;
  centerSub: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
          opacity={0.4}
        />
        {segments.map((s, i) => {
          const dash = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="num text-base font-semibold">{centerTop}</span>
        <span className="mt-0.5 text-[9px] tracking-wide text-muted-foreground uppercase">
          {centerSub}
        </span>
      </div>
    </div>
  );
}

type Row = {
  id: string;
  domain: Domain;
  name: string;
  typeLabel: string;
  location: string;
  rank: number;
  badge: ReactNode;
  signal: string;
  concern: string;
};

const INFRA_RANK: Record<RiskLevel, number> = {
  critical: 4,
  high: 3,
  elevated: 2,
  monitor: 1,
  normal: 0,
};
const EQUIP_RANK: Record<EquipAsset["status"], number> = { critical: 4, watch: 2, ok: 0 };

export function OverviewPage() {
  const router = useRouter();
  const base = useOpsBase();
  const { assets, risks, riskMap, event, isLoading, metrics } = useOpsSnapshot(base, 120);

  const [view, setView] = useState<"register" | "fleet">("register");
  const [domain, setDomain] = useState<Domain | "all">("all");
  const [q, setQ] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selInfra, setSelInfra] = useState<string | null>(null);
  const [selEquip, setSelEquip] = useState<EquipAsset | null>(null);

  const [equip, setEquip] = useState<EquipAsset[]>([]);
  const [twinMeta, setTwinMeta] = useState<{
    healthAvg: number;
    trips: number;
    worst: string | null;
  } | null>(null);
  const [AssetModal, setAssetModal] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [Exec, setExec] = useState<ComponentType<Record<string, unknown>> | null>(null);

  useEffect(() => {
    let ok = true;
    import("@/report/lib/sample.js").then((m) => {
      if (!ok) return;
      const fa = m.fleetAssets() as EquipAsset[];
      setEquip(fa);
      const pd = m.predictionsDetail();
      const worst = [...fa].filter((a) => a.status !== "ok").sort((a, b) => a.health - b.health)[0];
      setTwinMeta({
        healthAvg: Math.round(m.fleetHealth().health.avg),
        trips: pd.rows.filter((r: { surv14?: number }) => (r.surv14 ?? 1) < 0.6).length,
        worst: worst ? `${worst.unit} ${worst.name}` : null,
      });
    });
    import("@/report/components/FleetGrid.jsx").then(
      (m) => ok && setAssetModal(() => m.AssetModal),
    );
    return () => {
      ok = false;
    };
  }, []);
  useEffect(() => {
    if (view !== "fleet" || Exec) return;
    let ok = true;
    import("@/report/personas/Executive.jsx").then((m) => ok && setExec(() => m.default));
    return () => {
      ok = false;
    };
  }, [view, Exec]);

  const rows = useMemo<Row[]>(() => {
    const infraRows: Row[] = risks
      .map((r) => ({ risk: r, asset: assets.find((a) => a.id === r.assetId) }))
      .filter(
        (x): x is { risk: (typeof risks)[number]; asset: NonNullable<typeof x.asset> } => !!x.asset,
      )
      .map(({ risk, asset }) => ({
        id: asset.id,
        domain: "infrastructure" as const,
        name: asset.name,
        typeLabel: ASSET_TYPE_LABEL[asset.type],
        location: asset.region,
        rank: INFRA_RANK[risk.level],
        badge: <RiskBadge level={risk.level} score={risk.score} />,
        signal: risk.hoursToImpact != null ? `${risk.hoursToImpact}h to impact` : "—",
        concern:
          risk.forecastWindMph >= 74
            ? `${risk.forecastWindMph} mph sustained wind`
            : risk.rainfallIn >= 4
              ? `${risk.rainfallIn} in rainfall`
              : "Monitoring only",
      }));
    const equipRows: Row[] = equip.map((a) => ({
      id: a.asset_id,
      domain: "equipment" as const,
      name: a.name,
      typeLabel: a.category,
      location: `${a.plant} · Unit ${a.unit}`,
      rank: EQUIP_RANK[a.status],
      badge: <CondBadge status={a.status} condition={a.condition} />,
      signal: `${a.health}% health · z ${a.max_z}`,
      concern:
        a.status === "ok"
          ? "Nominal — no active anomalies"
          : `${a.anom_n} anomalies · ${a.watch_n} watchlist`,
    }));
    let all = [...infraRows, ...equipRows];
    if (domain !== "all") all = all.filter((r) => r.domain === domain);
    if (criticalOnly) all = all.filter((r) => r.rank >= 4);
    if (q) {
      const s = q.toLowerCase();
      all = all.filter((r) => `${r.name} ${r.location} ${r.typeLabel}`.toLowerCase().includes(s));
    }
    all.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
    return all;
  }, [risks, assets, equip, domain, criticalOnly, q]);

  const equipCrit = equip.filter((a) => a.status === "critical").length;
  const equipRisk = equip.filter((a) => a.status !== "ok").length;
  const totalAssets = assets.length + equip.length;
  const estateCritical = metrics.critical + equipCrit;

  const statusKey: keyof typeof STATUS_COLOR =
    estateCritical > 0 ? "critical" : metrics.exposed > 0 || equipRisk > 0 ? "elevated" : "normal";
  const statusLabel =
    statusKey === "critical" ? "Critical" : statusKey === "elevated" ? "Elevated" : "All clear";
  const statusColor = STATUS_COLOR[statusKey];
  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      event
        ? `${event.name} (Cat ${event.currentCategory}) is tracking the estate — ${metrics.exposed} assets exposed, first impact ${metrics.firstImpactHours != null ? `in ${metrics.firstImpactHours} h` : "pending"}.`
        : "No active weather system in the current forecast cycle.",
    );
    if (twinMeta) {
      parts.push(
        `Digital twin: fleet health ${twinMeta.healthAvg}%, ${equipCrit} critical asset${equipCrit === 1 ? "" : "s"}${twinMeta.worst ? ` (${twinMeta.worst})` : ""}, ${twinMeta.trips} predicted trip${twinMeta.trips === 1 ? "" : "s"} over 14 days.`,
      );
    }
    return parts.join(" ");
  }, [event, metrics, twinMeta, equipCrit]);

  const weatherSegs = RISK_ORDER.map((l) => ({
    value: risks.filter((r) => r.level === l).length,
    color: riskColorVar(l),
    level: l,
  }));
  const equipSegs = (["critical", "watch", "ok"] as const).map((s) => ({
    value: equip.filter((a) => a.status === s).length,
    color: EQUIP_COLOR[s],
    level: s,
  }));

  const selectedAsset = assets.find((a) => a.id === selInfra) ?? null;
  const openRow = (r: Row) => {
    if (r.domain === "infrastructure") {
      setSelEquip(null);
      setSelInfra(r.id);
    } else {
      setSelInfra(null);
      setSelEquip(equip.find((a) => a.asset_id === r.id) ?? null);
    }
  };

  return (
    <AppShell fullHeight>
      <div className="flex h-full min-h-[calc(100vh-3.5rem)] flex-col">
        {/* header + view toggle — boxed to match the tile column width */}
        <div className="shrink-0 pt-4">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4">
            <div>
              <h1 className="text-sm font-semibold">Overview</h1>
              <p className="text-[11px] text-muted-foreground">
                The estate at a glance — click any asset to drill in.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => window.dispatchEvent(new Event("onegrid-ask"))}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15"
              >
                <Sparkles className="size-3.5" /> Operations assistant
              </button>
              <div className="inline-flex overflow-hidden rounded-md border">
                {(["register", "fleet"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
                  >
                    {v === "register" ? "Register" : "Fleet Overview"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {view === "fleet" ? (
          <div className="min-h-0 flex-1 bg-[#0a0f1a] text-[#aeb9cd]">
            {Exec ? (
              <Exec
                theme={MODES.dark}
                onNavigate={(id: string) =>
                  router.navigate({
                    to: `${base}${id === "controlroom" ? "/control-room" : id === "maintenance" ? "/maintenance" : "/"}`,
                  })
                }
                onOpenGovernance={() => router.navigate({ to: `${base}/governance` })}
              />
            ) : (
              <div className="grid h-full min-h-[60vh] place-items-center text-sm text-slate-400">
                Loading Fleet Overview…
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1600px] space-y-4 px-4 pt-3 pb-4">
              {/* estate-command hero */}
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
              </div>

              {/* combined estate KPIs */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatCell
                  label="Total Assets"
                  value={totalAssets}
                  sub={`${assets.length} infra · ${equip.length} equipment`}
                />
                <StatCell
                  label="Estate Critical"
                  value={estateCritical}
                  tone="critical"
                  sub={`${metrics.critical} storm · ${equipCrit} equipment`}
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
                  label="Predicted Trips"
                  value={twinMeta?.trips ?? "—"}
                  sub="equipment · 14 days"
                />
                <StatCell
                  label="First Storm Impact"
                  value={metrics.firstImpactHours != null ? `${metrics.firstImpactHours} h` : "—"}
                  sub="earliest asset onset"
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-4">
                  {/* two lenses */}
                  <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                    <div className="panel flex items-center gap-4 p-4">
                      <MiniDonut
                        segments={weatherSegs}
                        centerTop={String(metrics.exposed)}
                        centerSub="exposed"
                      />
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
                          <Waves className="size-3.5" style={{ color: "#5aa9ff" }} /> Weather
                          Exposure
                        </div>
                        <div className="space-y-0.5">
                          {weatherSegs.map((s) => (
                            <div key={s.level} className="flex items-center gap-2 text-[11px]">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="flex-1 text-muted-foreground">
                                {RISK_LABEL[s.level]}
                              </span>
                              <span className="num">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="panel flex items-center gap-4 p-4">
                      <MiniDonut
                        segments={equipSegs}
                        centerTop={String(equipRisk)}
                        centerSub="at risk"
                      />
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
                          <Cog className="size-3.5" style={{ color: "#a986ff" }} /> Equipment Health
                        </div>
                        <div className="space-y-0.5">
                          {equipSegs.map((s) => (
                            <div key={s.level} className="flex items-center gap-2 text-[11px]">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="flex-1 text-muted-foreground capitalize">
                                {s.level === "ok" ? "Healthy" : s.level}
                              </span>
                              <span className="num">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* unified register */}
                  <div className="panel">
                    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                      <div className="inline-flex overflow-hidden rounded-sm border text-[11px]">
                        {(["all", "infrastructure", "equipment"] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setDomain(d)}
                            className={`px-2.5 py-1 font-medium capitalize transition-colors ${domain === d ? "bg-accent/70" : "text-muted-foreground hover:bg-accent/40"}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <div className="relative">
                        <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
                        <input
                          value={q}
                          onChange={(e) => setQ(e.target.value)}
                          placeholder="Search assets, locations, types"
                          className="w-56 rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <button
                        onClick={() => setCriticalOnly((v) => !v)}
                        className={`rounded-sm border px-2 py-1.5 text-[11px] font-medium transition-colors ${criticalOnly ? "bg-accent/70" : "text-muted-foreground hover:bg-accent/40"}`}
                      >
                        Critical only
                      </button>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {rows.length} assets
                      </span>
                    </div>
                    <div className="max-h-[520px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                          <tr className="text-left text-[11px] text-muted-foreground">
                            <th className="px-4 py-2 font-medium">Asset</th>
                            <th className="px-4 py-2 font-medium">Domain</th>
                            <th className="px-4 py-2 font-medium">Location</th>
                            <th className="px-4 py-2 font-medium">
                              <span className="inline-flex items-center gap-1">
                                Status <ArrowUpDown className="size-3" />
                              </span>
                            </th>
                            <th className="px-4 py-2 font-medium">Key signal</th>
                            <th className="px-4 py-2 font-medium">Primary concern</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr
                              key={`${r.domain}:${r.id}`}
                              onClick={() => openRow(r)}
                              className={`cursor-pointer border-t hover:bg-accent/50 ${selInfra === r.id || selEquip?.asset_id === r.id ? "bg-accent/60" : ""}`}
                            >
                              <td className="px-4 py-2 font-medium">
                                <span className="flex items-center gap-1.5">
                                  {r.domain === "equipment" ? (
                                    <Cpu className="size-3.5 text-muted-foreground" />
                                  ) : (
                                    <Waves className="size-3.5 text-muted-foreground" />
                                  )}
                                  {r.name}
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                <DomainBadge domain={r.domain} />
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">{r.location}</td>
                              <td className="px-4 py-2">{r.badge}</td>
                              <td className="num px-4 py-2 text-muted-foreground">{r.signal}</td>
                              <td className="px-4 py-2 text-muted-foreground">{r.concern}</td>
                            </tr>
                          ))}
                          {rows.length === 0 && (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-4 py-10 text-center text-muted-foreground"
                              >
                                {isLoading && equip.length === 0
                                  ? "Loading the estate…"
                                  : "No assets match the current filters."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* right rail: weather map + storm-exposure drawer */}
                <div className="space-y-4">
                  <div className="panel h-[320px] overflow-hidden">
                    <OpsMap
                      className="h-full w-full"
                      assets={assets}
                      risks={riskMap}
                      event={event}
                      layers={{ assets: true, track: true, wind: true }}
                      selectedId={selInfra}
                      onSelect={(id) => {
                        setSelEquip(null);
                        setSelInfra(id);
                      }}
                    />
                  </div>
                  {selectedAsset ? (
                    <div className="panel max-h-[480px] overflow-hidden">
                      <AssetDetailPanel
                        asset={selectedAsset}
                        risk={riskMap.get(selectedAsset.id)}
                        event={event}
                        allAssets={assets}
                        onClose={() => setSelInfra(null)}
                        onSelect={(id) => {
                          setSelEquip(null);
                          setSelInfra(id);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="panel space-y-3 p-4 text-xs text-muted-foreground">
                      <p>
                        Click an{" "}
                        <span className="font-semibold" style={{ color: "#5aa9ff" }}>
                          infrastructure
                        </span>{" "}
                        asset for its storm-exposure detail, or an{" "}
                        <span className="font-semibold" style={{ color: "#a986ff" }}>
                          equipment
                        </span>{" "}
                        asset for its 3D twin.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => router.navigate({ to: `${base}/asset-explorer` })}
                          className="flex items-center gap-1.5 rounded-sm border px-2 py-1.5 font-semibold hover:bg-accent/50"
                        >
                          <Cpu className="size-3.5" /> Asset Explorer
                        </button>
                        <button
                          onClick={() => router.navigate({ to: `${base}/maintenance` })}
                          className="flex items-center gap-1.5 rounded-sm border px-2 py-1.5 font-semibold hover:bg-accent/50"
                        >
                          <Wrench className="size-3.5" /> Maintenance
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {AssetModal && (
        <AssetModal theme={MODES.dark} asset={selEquip} onClose={() => setSelEquip(null)} />
      )}
    </AppShell>
  );
}
