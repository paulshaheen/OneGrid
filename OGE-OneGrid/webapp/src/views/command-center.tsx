import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CloudLightning,
  CloudRain,
  Gauge,
  Layers,
  Maximize2,
  Play,
  Search,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { CommandMap, type MapSite } from "@/components/command/CommandMap";
import { PageLoading } from "@/components/ops/PageLoading";
import { useOpsBase } from "@/components/ops/ops-nav";
import { eventsQuery, layersQuery, useOpsSnapshot } from "@/lib/hooks/use-ops-data";
// report-app backed data (client-side, same-origin /api)
import { useApi } from "@/report/lib/api.js";

// ── palette (matched to the Volterra command-center mock) ──────────────────
const C = {
  ok: "#2fd07a",
  cyan: "#38bdf8",
  blue: "#3b82f6",
  amber: "#f5b942",
  red: "#ff5470",
  purple: "#a855f7",
  ink: "#0a0f1e",
  panel: "rgba(255,255,255,0.035)",
  border: "rgba(255,255,255,0.08)",
  sub: "#93a4bf",
};

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ───────────────────────────── page ───────────────────────────────────────
export function CommandCenterPage() {
  const base = useOpsBase();
  const snap = useOpsSnapshot(base, 48);
  const { assets, riskMap, event, metrics } = snap;
  const allEvents = useQuery(eventsQuery(base));
  const layerDefs = useQuery(layersQuery(base));

  const fleetHealth = useApi("/api/fleet-health") as { data: FleetHealth | null };
  const woSummary = useApi("/api/work-orders-summary") as { data: WoSummary | null };
  const workOrders = useApi("/api/work-orders?limit=8") as { data: WorkOrder[] | null };
  const exposure = useApi("/api/exposure") as { data: Exposure[] | null };

  const [tab, setTab] = useState<"live" | "twin" | "sim">("twin");
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>({
    assets: true,
    wind: true,
    track: false,
    rain: false,
    flood: false,
  });
  const [simHour, setSimHour] = useState(12);

  const events = allEvents.data ?? (event ? [event] : []);
  const storm = useMemo(
    () => events.find((e) => e.kind === "hurricane") ?? events.find((e) => e.status === "active") ?? event,
    [events, event],
  );

  const exp = exposure.data ?? [];
  const expByLevel = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of exp) m[e.level] = (m[e.level] ?? 0) + 1;
    return m;
  }, [exp]);
  const critCount = (expByLevel["critical"] ?? 0) + (expByLevel["high"] ?? 0);
  const exposedCount = exp.filter((e) => e.level !== "normal" && e.level !== "monitor").length;
  const resilience = exp.length ? Math.round(((exp.length - exposedCount) / exp.length) * 100) : 100;

  const gridHealth = Math.round(num(fleetHealth.data?.health.avg) || 0);
  const scored = num(fleetHealth.data?.health.scoredAssets);
  const totalAssets = num(fleetHealth.data?.health.totalAssets) || assets.length;
  const critAssets = num(fleetHealth.data?.anomalies.critical);
  const availability = totalAssets ? ((scored - critAssets) / totalAssets) * 100 : 0;
  const reliability = 100 - critAssets * 0.05;
  const lossFactor = totalAssets ? (num(fleetHealth.data?.anomalies.rows) / totalAssets) * 0.9 : 0;

  const wo = woSummary.data;
  const woOpen = num(wo?.open);
  const overdue = num(wo?.byPriority?.find((p) => p.rank === 1)?.n);
  const atRisk = num(wo?.byPriority?.find((p) => p.rank === 2)?.n);
  const onTime = Math.max(0, woOpen - overdue - atRisk);
  const onTimePct = woOpen ? Math.round((onTime / woOpen) * 100) : 0;

  const catHealth = useMemo(() => healthByCategory(exp, riskMap), [exp, riskMap]);

  const sites: MapSite[] = useMemo(
    () =>
      assets
        .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
        .map((a) => {
          const r = riskMap.get(a.id);
          const lvl = (r?.level ?? "normal") as MapSite["level"];
          const h = Math.abs(hashStr(a.id));
          return {
            id: a.id,
            name: a.name,
            lat: a.lat,
            lon: a.lon,
            level: lvl,
            status: lvl === "normal" ? "Operational" : lvl === "critical" ? "Critical" : "Watch",
            loadPct: 58 + (h % 40),
            voltageKv: [115, 230, 345, 500][h % 4],
            tempF: 60 + (h % 22),
          };
        }),
    [assets, riskMap],
  );

  const loading = snap.isLoading && assets.length === 0;
  if (loading) {
    return (
      <AppShell fullHeight>
        <PageLoading label="Booting the command center…" />
      </AppShell>
    );
  }

  return (
    <AppShell fullHeight>
      <div className="min-h-full" style={{ background: `radial-gradient(1200px 600px at 60% -10%, #101a33 0%, ${C.ink} 55%)`, color: "#e6eef8" }}>
        {/* command bar */}
        <div className="flex items-center gap-4 border-b px-5 py-2.5" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md" style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})` }}>
              <Zap className="size-4 text-white" />
            </div>
            <div className="text-[15px] font-bold tracking-wide">
              ONE<span style={{ color: C.cyan }}>GRID</span>
            </div>
            <div className="ml-3 text-sm text-slate-300">Energy Grid Command Center</div>
          </div>
          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {["Overview", "Assets", "Analytics", "Simulation", "Maintenance", "Reports"].map((t, i) => (
              <span key={t} className={`rounded-md px-3 py-1.5 text-[13px] ${i === 0 ? "bg-white/10 text-white" : "text-slate-400"}`}>
                {t}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute top-2 left-2.5 size-3.5 text-slate-500" />
              <input
                placeholder="Search assets, locations…"
                className="w-56 rounded-md border bg-white/[0.04] py-1.5 pr-2 pl-8 text-[12px] outline-none"
                style={{ borderColor: C.border }}
              />
            </div>
            <Bell className="size-4 text-slate-400" />
            <div className="grid size-7 place-items-center rounded-full text-[11px] font-bold" style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.purple})` }}>
              AD
            </div>
          </div>
        </div>

        {/* main grid */}
        <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
          {/* ── left column ── */}
          <div className="flex flex-col gap-4">
            <Panel title="GRID HEALTH">
              <div className="flex flex-col items-center pt-1">
                <ArcGauge value={gridHealth} />
                <div className="mt-1 text-[13px] font-semibold" style={{ color: healthColor(gridHealth) }}>
                  {gridHealth >= 85 ? "Excellent" : gridHealth >= 70 ? "Healthy" : gridHealth >= 55 ? "Watch" : "Degraded"}
                </div>
                <div className="text-[11px] text-slate-400">Fleet condition is {gridHealth >= 85 ? "optimal" : "stable"}</div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <MiniStat label="System Reliability" value={`${reliability.toFixed(2)}%`} />
                <MiniStat label="Loss Factor" value={`${lossFactor.toFixed(2)}%`} />
                <MiniStat label="Asset Availability" value={`${availability.toFixed(1)}%`} />
              </div>
            </Panel>

            <Panel title="ALERTS" action="View all">
              <div className="space-y-1.5">
                {buildAlerts(storm, exp, workOrders.data ?? []).map((a, i) => (
                  <AlertRow key={i} {...a} />
                ))}
              </div>
            </Panel>

            <Panel title="WEATHER OVERVIEW">
              <WeatherCard event={storm} />
            </Panel>
          </div>

          {/* ── center column ── */}
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: C.border, background: "#070b16" }}>
              {/* map header */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex rounded-lg bg-white/[0.05] p-0.5">
                  {(
                    [
                      ["live", "Live Grid"],
                      ["twin", "Digital Twin"],
                      ["sim", "Simulation"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition"
                      style={tab === k ? { background: C.blue, color: "#fff" } : { color: C.sub }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-slate-400">
                  <IconBtn><Layers className="size-4" /></IconBtn>
                  <IconBtn><Settings2 className="size-4" /></IconBtn>
                  <IconBtn><Maximize2 className="size-4" /></IconBtn>
                </div>
              </div>
              {/* the hero map */}
              <div className="relative h-[440px] w-full">
                <CommandMap
                  sites={sites}
                  storm={storm ? { name: storm.name } : undefined}
                  selectedId={selected}
                  onSelect={setSelected}
                />
                {/* grid-layers toggle bar */}
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5 backdrop-blur"
                  style={{ borderColor: C.border, background: "rgba(10,15,30,0.72)" }}>
                  <span className="px-2 text-[10px] font-semibold tracking-wider text-slate-400">GRID LAYERS</span>
                  {(
                    [
                      ["assets", "Assets"],
                      ["wind", "Weather"],
                      ["rain", "Terrain"],
                      ["track", "Load"],
                      ["flood", "Outages"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium transition"
                      style={layers[k] ? { background: `${C.blue}33`, color: "#dbeafe", border: `1px solid ${C.blue}66` } : { color: C.sub, border: "1px solid transparent" }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* storm simulation */}
            <Panel>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold tracking-wide text-slate-200">STORM SIMULATION</span>
                <span className="text-[12px] text-slate-400">{storm?.name ?? "No active event"}</span>
                {storm && (
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${C.purple}22`, color: "#d8b4fe" }}>
                    {storm.kind === "hurricane" ? `Category ${Math.max(1, num(storm.currentCategory))}` : (storm.hazardKind ?? storm.kind)?.replace(/_/g, " ")}
                  </span>
                )}
                <button className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: C.blue }}>
                  <Sparkles className="size-3.5" /> Run New Simulation
                </button>
              </div>
              <StormTimeline hour={simHour} setHour={setSimHour} forecast={storm?.forecast ?? []} />
              <div className="mt-3 grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
                <BigStat label="Assets Exposed" value={String(exposedCount)} tone={C.amber} />
                <BigStat label="Critical / High" value={String(critCount)} tone={C.red} />
                <BigStat label="Open Work Orders" value={String(woOpen)} tone={C.cyan} />
                <BigStat label="System Resilience" value={`${resilience}%`} tone={C.ok} />
                <div className="rounded-lg border p-3" style={{ borderColor: C.border, background: C.panel }}>
                  <div className="mb-1 text-[10px] tracking-wider text-slate-400">IMPACT OVER TIME</div>
                  <ImpactChart forecast={storm?.forecast ?? []} exposure={exp} />
                </div>
              </div>
            </Panel>
          </div>

          {/* ── right column ── */}
          <div className="flex flex-col gap-4">
            <Panel title="MAINTENANCE OVERVIEW">
              <div className="flex items-center gap-4">
                <Donut pct={onTimePct} />
                <div className="flex-1 space-y-1.5 text-[12px]">
                  <LegendRow color={C.ok} label="On-Time" value={`${onTimePct}%`} />
                  <LegendRow color={C.amber} label="At-Risk" value={pctOf(atRisk, woOpen)} />
                  <LegendRow color={C.red} label="Overdue" value={pctOf(overdue, woOpen)} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center" style={{ borderColor: C.border }}>
                <MiniStat label="Work Orders" value={String(woOpen)} />
                <MiniStat label="At-Risk" value={String(atRisk)} tone={C.amber} />
                <MiniStat label="Overdue" value={String(overdue)} tone={C.red} />
              </div>
            </Panel>

            <Panel title="MAINTENANCE SCHEDULE" action="View all">
              <div className="space-y-2">
                {(workOrders.data ?? []).slice(0, 4).map((w) => (
                  <ScheduleRow key={w.wr_id} wo={w} />
                ))}
              </div>
            </Panel>

            <Panel title="ASSET HEALTH" action="View all">
              <div className="space-y-2.5">
                {catHealth.map((c) => (
                  <HBar key={c.label} label={c.label} pct={c.pct} />
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ───────────────────────────── helpers / types ────────────────────────────
type FleetHealth = {
  health: { avg: number; scoredAssets: number; totalAssets: number };
  anomalies: { rows: number; critical: number };
};
type WoSummary = { open: number; byPriority?: Array<{ rank: number; n: number }> };
type WorkOrder = {
  wr_id: string;
  problem_descr: string;
  location: string;
  wr_status: string;
  priority: number;
  site_name: string;
  entity_descr: string;
};
type Exposure = { assetId: string; score: number; level: string; siteId?: string };

function healthColor(v: number) {
  return v >= 85 ? C.ok : v >= 70 ? C.cyan : v >= 55 ? C.amber : C.red;
}
function pctOf(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : "0%";
}
function healthByCategory(exp: Exposure[], riskMap: Map<string, { score: number }>) {
  void riskMap;
  const groups: Record<string, { sum: number; n: number }> = {};
  for (const e of exp) {
    const cat = categoryOf(e.assetId);
    const health = 100 - Math.min(60, num(e.score) * 0.4);
    (groups[cat] ??= { sum: 0, n: 0 }).sum += health;
    groups[cat].n += 1;
  }
  const rows = Object.entries(groups).map(([label, g]) => ({ label, pct: Math.round(g.sum / g.n) }));
  rows.sort((a, b) => b.pct - a.pct);
  return rows.slice(0, 6);
}
function categoryOf(assetId: string): string {
  const s = assetId.toLowerCase();
  if (/turbine/.test(s)) return "Turbines";
  if (/gen/.test(s)) return "Generators";
  if (/boiler/.test(s)) return "Boilers";
  if (/compressor/.test(s)) return "Compressors";
  if (/pump/.test(s)) return "Pumps";
  if (/separator|skid|metering/.test(s)) return "Process Skids";
  return "Balance of Plant";
}
function buildAlerts(
  storm: { name?: string; region?: string } | undefined,
  exp: Exposure[],
  wos: WorkOrder[],
) {
  const out: AlertRowProps[] = [];
  if (storm) out.push({ tone: C.red, icon: "weather", title: "Severe Weather Approaching", sub: `${storm.name} · ${storm.region ?? "region"}`, ago: "live" });
  const topCrit = [...exp].filter((e) => e.level === "critical").sort((a, b) => b.score - a.score)[0];
  if (topCrit) out.push({ tone: C.amber, icon: "warn", title: "Asset at critical exposure", sub: `${topCrit.assetId} · score ${topCrit.score}`, ago: "8m ago" });
  const veg = wos.find((w) => /veget|line|patrol/i.test(w.problem_descr));
  if (veg) out.push({ tone: C.amber, icon: "warn", title: veg.entity_descr || "Vegetation Management", sub: veg.location, ago: "15m ago" });
  const due = wos.find((w) => /(schedul|inspect|maint)/i.test(w.wr_status) || /inspect/i.test(w.problem_descr));
  if (due) out.push({ tone: C.cyan, icon: "info", title: "Maintenance Due", sub: `${due.problem_descr.slice(0, 34)} · ${due.site_name}`, ago: "1h ago" });
  return out.slice(0, 4);
}

// ───────────────────────────── UI atoms ───────────────────────────────────
function Panel({ title, action, children }: { title?: string; action?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: C.border, background: C.panel, backdropFilter: "blur(4px)" }}>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-slate-400">{title}</div>
          {action && <div className="text-[11px] font-medium" style={{ color: C.cyan }}>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
function IconBtn({ children }: { children: React.ReactNode }) {
  return <button className="grid size-8 place-items-center rounded-md hover:bg-white/10">{children}</button>;
}
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[15px] font-bold tabular-nums" style={{ color: tone ?? "#dbe6f5" }}>{value}</div>
      <div className="mt-0.5 text-[9.5px] leading-tight text-slate-500">{label}</div>
    </div>
  );
}
function BigStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${tone}44`, background: `linear-gradient(160deg, ${tone}1c, transparent)` }}>
      <div className="text-[22px] font-bold tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="mt-0.5 text-[10px] text-slate-400">{label}</div>
    </div>
  );
}
function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 rounded-full" style={{ background: color }} />
      <span className="text-slate-300">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-slate-200">{value}</span>
    </div>
  );
}
type AlertRowProps = { tone: string; icon: "weather" | "warn" | "info"; title: string; sub: string; ago: string };
function AlertRow({ tone, icon, title, sub, ago }: AlertRowProps) {
  const Icon = icon === "weather" ? CloudLightning : icon === "warn" ? AlertTriangle : Bell;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border p-2.5" style={{ borderColor: `${tone}33`, background: `${tone}0f` }}>
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color: tone }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-slate-100">{title}</div>
        <div className="truncate text-[11px] text-slate-400">{sub}</div>
      </div>
      <div className="shrink-0 text-[10px] text-slate-500">{ago}</div>
    </div>
  );
}
function ScheduleRow({ wo }: { wo: WorkOrder }) {
  const status = scheduleStatus(wo);
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white/[0.05]">
        <Gauge className="size-4 text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-slate-100">{wo.entity_descr || wo.problem_descr.slice(0, 28)}</div>
        <div className="truncate text-[11px] text-slate-400">{wo.location}</div>
      </div>
      <span className="shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: `${status.color}22`, color: status.color }}>
        {status.label}
      </span>
    </div>
  );
}
function scheduleStatus(wo: WorkOrder): { label: string; color: string } {
  if (num(wo.priority) <= 1) return { label: "Overdue", color: C.red };
  if (/ready|planning|new/i.test(wo.wr_status) || num(wo.priority) === 2) return { label: "At-Risk", color: C.amber };
  return { label: "On-Time", color: C.ok };
}
function HBar({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 92 ? C.ok : pct >= 85 ? "#8fd14f" : pct >= 75 ? C.amber : C.red;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold tabular-nums text-slate-200">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}bb)` }} />
      </div>
    </div>
  );
}

// ── SVG widgets ────────────────────────────────────────────────────────────
function ArcGauge({ value }: { value: number }) {
  const r = 52;
  const circ = Math.PI * r; // half circle
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = healthColor(value);
  return (
    <div className="relative" style={{ width: 150, height: 92 }}>
      <svg width="150" height="92" viewBox="0 0 150 92">
        <path d={`M 15 82 A ${r} ${r} 0 0 1 135 82`} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" strokeLinecap="round" />
        <path
          d={`M 15 82 A ${r} ${r} 0 0 1 135 82`}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ filter: `drop-shadow(0 0 6px ${color}aa)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <div className="text-[34px] font-bold leading-none tabular-nums">{value}</div>
        <div className="text-[10px] text-slate-500">/100</div>
      </div>
    </div>
  );
}
function Donut({ pct }: { pct: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const seg = (frac: number) => circ * frac;
  const onT = pct / 100;
  const rest = 1 - onT;
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={C.ok} strokeWidth="10" strokeDasharray={`${seg(onT)} ${circ}`} strokeLinecap="round" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={C.amber} strokeWidth="10" strokeDasharray={`${seg(rest * 0.6)} ${circ}`} strokeDashoffset={-seg(onT)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[20px] font-bold tabular-nums">{pct}%</div>
        <div className="text-[9px] text-slate-500">On-Time</div>
      </div>
    </div>
  );
}
function StormTimeline({ hour, setHour, forecast }: { hour: number; setHour: (h: number) => void; forecast: Array<{ hour: number }> }) {
  const hours = forecast.length ? forecast.map((f) => f.hour) : [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const max = hours[hours.length - 1] || 24;
  return (
    <div className="flex items-center gap-3">
      <button className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ background: C.blue }}>
        <Play className="size-4" />
      </button>
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={max}
          step={3}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="w-full accent-[var(--tw-accent,#3b82f6)]"
          style={{ accentColor: C.blue }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          {hours.map((h) => (
            <span key={h} style={{ color: h === hour ? C.cyan : undefined }}>+{h}h</span>
          ))}
        </div>
      </div>
    </div>
  );
}
function ImpactChart({ forecast, exposure }: { forecast: Array<{ hour: number; windMph?: number }>; exposure: Exposure[] }) {
  const pts = useMemo(() => {
    const base = forecast.length ? forecast : Array.from({ length: 9 }, (_, i) => ({ hour: i * 3, windMph: 60 }));
    const expFactor = Math.min(1, (exposure.filter((e) => e.level !== "normal").length || 20) / 60);
    return base.map((f, i) => {
      const t = i / (base.length - 1 || 1);
      // bell-ish impact curve peaking mid-horizon, scaled by wind + exposure
      const bell = Math.exp(-Math.pow((t - 0.55) * 2.4, 2));
      const w = (num(f.windMph) || 60) / 90;
      return 0.15 + bell * (0.55 + 0.3 * w) * (0.6 + 0.4 * expFactor);
    });
  }, [forecast, exposure]);
  const W = 240;
  const H = 66;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * W} ${H - p * H}`).join(" ");
  const area = `${path} L ${W} ${H} L 0 ${H} Z`;
  const peakI = pts.indexOf(Math.max(...pts));
  const peakX = (peakI / (pts.length - 1)) * W;
  const peakY = H - pts[peakI] * H;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="impgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.purple} stopOpacity="0.5" />
          <stop offset="100%" stopColor={C.purple} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#impgrad)" />
      <path d={path} fill="none" stroke={C.purple} strokeWidth="2" style={{ filter: `drop-shadow(0 0 4px ${C.purple}aa)` }} />
      <circle cx={peakX} cy={peakY} r="3" fill="#fff" />
    </svg>
  );
}
function WeatherCard({ event }: { event: { name?: string; region?: string; currentWindMph?: number; gustMph?: number; pressureMb?: number; hazardKind?: string; forecast?: Array<{ hour: number; windMph?: number }> } | undefined }) {
  if (!event) return <div className="text-[12px] text-slate-400">No active weather system.</div>;
  const rain = /rain|hurricane|convective/i.test(event.hazardKind ?? "");
  return (
    <div>
      <div className="text-[12px] font-medium text-slate-300">{event.region?.replace(/_/g, " ") ?? "Region"}</div>
      <div className="mt-2 flex items-start gap-3">
        {rain ? <CloudRain className="size-9" style={{ color: C.cyan }} /> : <CloudLightning className="size-9" style={{ color: C.amber }} />}
        <div>
          <div className="text-[26px] font-bold leading-none">{num(event.currentWindMph)}<span className="text-[14px] font-medium text-slate-400"> mph</span></div>
          <div className="text-[11px] text-slate-400">{(event.hazardKind ?? "wind").replace(/_/g, " ")}</div>
        </div>
        <div className="ml-auto space-y-0.5 text-right text-[11px] text-slate-400">
          <div>Gust <span className="font-semibold text-slate-200">{num(event.gustMph)} mph</span></div>
          <div>Pressure <span className="font-semibold text-slate-200">{num(event.pressureMb)} mb</span></div>
        </div>
      </div>
      <div className="mt-3 flex justify-between border-t pt-2.5" style={{ borderColor: C.border }}>
        {(event.forecast ?? []).slice(0, 5).map((f) => (
          <div key={f.hour} className="flex flex-col items-center gap-1">
            <div className="text-[10px] text-slate-500">+{f.hour}h</div>
            <CloudRain className="size-4 text-slate-400" />
            <div className="text-[10px] font-medium text-slate-300">{num(f.windMph)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
