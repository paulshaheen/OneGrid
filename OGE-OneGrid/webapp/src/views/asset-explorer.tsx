import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowUpDown, Cog, Cpu, Layers, MapPin, Search, Waves, Wrench } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { OpsMap } from "@/components/ops/OpsMap";
import { RiskBadge, StatCell } from "@/components/ops/RiskBadge";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { ASSET_TYPE_LABEL, RISK_LABEL, RISK_ORDER, riskColorVar } from "@/lib/format";
import type { RiskLevel } from "@/lib/domain/types";
import { MODES } from "@/report/lib/themes.js";

// Asset Explorer — the single pane for the ENTIRE estate across both OneGrid intelligence
// domains: "Energy Infrastructure" (weather-scored GoM platforms/wells/pipelines) and
// "Rotating & Fired Equipment" (condition-scored digital-twin plant fleet). A unified
// register routes each asset to its own intelligence: infrastructure → storm-exposure
// drawer; equipment → the full 3D asset modal (model · root cause · Simulation · work orders).
// The original Executive fleet dashboard stays reachable via the "Fleet Overview" tab.

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
  size = 108,
  thickness = 13,
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
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="num text-lg font-semibold">{centerTop}</span>
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

export function AssetExplorerPage() {
  const router = useRouter();
  const base = useOpsBase();
  const { assets, risks, riskMap, event, isLoading, metrics } = useOpsSnapshot(base, 120);

  const [view, setView] = useState<"register" | "fleet">("register");
  const [domain, setDomain] = useState<Domain | "all">("all");
  const [q, setQ] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selInfra, setSelInfra] = useState<string | null>(null);
  const [selEquip, setSelEquip] = useState<EquipAsset | null>(null);

  // Client-only report bits: equipment sample list + the 3D asset modal + exec dashboard.
  const [equip, setEquip] = useState<EquipAsset[]>([]);
  const [AssetModal, setAssetModal] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [Exec, setExec] = useState<ComponentType<Record<string, unknown>> | null>(null);

  useEffect(() => {
    let ok = true;
    import("@/report/lib/sample.js").then((m) => ok && setEquip(m.fleetAssets() as EquipAsset[]));
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

  // Deep-link support: ?view=fleet opens the Fleet Overview; ?open=<assetId> opens an
  // equipment asset's 3D modal directly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("view") === "fleet") setView("fleet");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !equip.length) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) {
      const a = equip.find((x) => x.asset_id === id);
      if (a) setSelEquip(a);
    }
  }, [equip]);

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
  const allCritical = metrics.critical + equipCrit;

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
        {/* header + view toggle */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            <div>
              <h1 className="text-sm font-semibold">Asset Explorer</h1>
              <p className="text-[11px] text-muted-foreground">
                One estate, two intelligence lenses — storm exposure and equipment condition.
              </p>
            </div>
          </div>
          <div className="ml-auto inline-flex overflow-hidden rounded-md border">
            {(["register", "fleet"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {v === "register" ? "Unified Register" : "Fleet Overview"}
              </button>
            ))}
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
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-4">
                {/* combined KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatCell
                    label="Total Assets"
                    value={totalAssets}
                    sub={`${assets.length} infra · ${equip.length} equipment`}
                  />
                  <StatCell
                    label="Critical — All Domains"
                    value={allCritical}
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
                    label="First Storm Impact"
                    value={metrics.firstImpactHours != null ? `${metrics.firstImpactHours} h` : "—"}
                    sub="earliest asset onset"
                  />
                </div>

                {/* two lenses */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="panel flex items-center gap-4 p-4">
                    <MiniDonut
                      segments={weatherSegs}
                      centerTop={String(metrics.exposed)}
                      centerSub="exposed"
                    />
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
                        <Waves className="size-3.5" style={{ color: "#5aa9ff" }} /> Weather Exposure
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
                  <div className="max-h-[560px] overflow-y-auto">
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
                                  <MapPin className="size-3.5 text-muted-foreground" />
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

              {/* right rail: weather map + storm-exposure drawer (infrastructure lens) */}
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
                    <div className="flex gap-2 border-t p-3">
                      <button
                        onClick={() => router.navigate({ to: `${base}/map` })}
                        className="flex-1 rounded-sm border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent/50"
                      >
                        View on Live Map
                      </button>
                      <button
                        onClick={() => router.navigate({ to: `${base}/risk` })}
                        className="flex-1 rounded-sm border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent/50"
                      >
                        Storm Exposure
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="panel space-y-3 p-4 text-xs text-muted-foreground">
                    <p>
                      Select an{" "}
                      <span className="font-semibold" style={{ color: "#5aa9ff" }}>
                        infrastructure
                      </span>{" "}
                      asset for its storm-exposure detail, or an{" "}
                      <span className="font-semibold" style={{ color: "#a986ff" }}>
                        equipment
                      </span>{" "}
                      asset for its 3D twin, root cause, predictions, simulation and work orders.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => router.navigate({ to: `${base}/control-room` })}
                        className="flex items-center gap-1.5 rounded-sm border px-2 py-1.5 font-semibold hover:bg-accent/50"
                      >
                        <Cpu className="size-3.5" /> Control Room
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
        )}
      </div>

      {/* equipment 3D asset modal (digital-twin lens) */}
      {AssetModal && (
        <AssetModal theme={MODES.dark} asset={selEquip} onClose={() => setSelEquip(null)} />
      )}
    </AppShell>
  );
}
