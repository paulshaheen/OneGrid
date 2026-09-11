import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Boxes,
  ChevronDown,
  Cog,
  Container,
  Cpu,
  CloudLightning,
  CloudRain,
  Droplets,
  Fan,
  Flame,
  Gauge,
  Layers,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Pause,
  Play,
  Sparkles,
  Wind,
  X,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { WeatherHoloMap } from "@/components/ops/WeatherHoloMap";
import { PageLoading } from "@/components/ops/PageLoading";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
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
  panel: "var(--og-panel-background, rgba(255,255,255,0.035))",
  border: "var(--og-panel-border, rgba(255,255,255,0.08))",
  sub: "#93a4bf",
};

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

// Map an equipment description to a representative icon (boiler, compressor, …).
function equipIcon(text: string) {
  const s = (text || "").toLowerCase();
  if (/boiler|fired|furnace|heater/.test(s)) return Flame;
  if (/compressor/.test(s)) return Wind;
  if (/turbine|fan|blower/.test(s)) return Fan;
  if (/generator|genset|alternator/.test(s)) return Zap;
  if (/pump/.test(s)) return Droplets;
  if (/separator|skid|metering|process|vessel|tank|column/.test(s)) return Container;
  if (/motor|drive|gear|bearing|rotating/.test(s)) return Cog;
  return Gauge;
}

type ModalData = {
  title: string;
  subtitle?: string;
  badge?: { label: string; color: string };
  fields: Array<{ label: string; value: string }>;
  list?: Array<{ label: string; value: string; color?: string }>;
  listTitle?: string;
  to?: string;
  search?: Record<string, string>;
  toLabel?: string;
  onFocus?: () => void;
  focusLabel?: string;
};

// ───────────────────────────── page ───────────────────────────────────────
export function CommandCenterPage() {
  const base = useOpsBase();
  const snap = useOpsSnapshot(base, 48);
  const { assets, riskMap, event, metrics } = snap;
  const allEvents = useQuery(eventsQuery(base));
  const layerDefs = useQuery(layersQuery(base));

  const fleetHealth = useApi("/api/fleet-health") as { data: FleetHealth | null; loading: boolean };
  const fleetAssets = useApi("/api/fleet-assets") as {
    data: Array<{ plant?: string; status?: string; health?: number }> | null;
    loading: boolean;
  };
  const woSummary = useApi("/api/work-orders-summary") as { data: WoSummary | null; loading: boolean };
  const workOrders = useApi("/api/work-orders?limit=8") as { data: WorkOrder[] | null; loading: boolean };
  const exposure = useApi("/api/exposure") as { data: Exposure[] | null; loading: boolean };

  const [tab, setTab] = useState<"twin" | "weather">("twin");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedStorm, setSelectedStorm] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState<Record<string, boolean>>({
    assets: true,
    wind: true,
    track: true,
    links: true,
    outages: false,
  });
  const [simHour, setSimHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [modal, setModal] = useState<ModalData | null>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  // Defer mounting the heavy 3D map until AFTER the dashboard has painted and is
  // interactive — the scene build (procedural terrain + shader compile) is synchronous
  // and would otherwise freeze the whole page. The map box shows a status meanwhile.
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMapReady(true), { timeout: 1200 });
      return () => (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setMapReady(true), 250);
    return () => window.clearTimeout(t);
  }, []);

  const events = allEvents.data ?? (event ? [event] : []);
  const storm = useMemo(
    () => events.find((e) => e.kind === "hurricane") ?? events.find((e) => e.status === "active") ?? event,
    [events, event],
  );
  // The storm currently driving the weather panels + map focus: the one picked
  // in the Weather selector, else the primary active system.
  const activeStorm = useMemo(
    () => events.find((e) => e.id === selectedStorm) ?? storm,
    [events, selectedStorm, storm],
  );
  // Playhead horizon = furthest forecast hour we have data for (min 24 h).
  const horizon = useMemo(() => {
    const hrs = events.map((e) => e.forecast?.[e.forecast.length - 1]?.hour ?? 0);
    return Math.max(24, ...hrs);
  }, [events]);
  // Weather runs in forecast HOURS; the Digital-Twin failure model runs in DAYS
  // (0–120). The playhead value (`simHour`) is interpreted per the active tab.
  const simMax = tab === "weather" ? horizon : 120;

  // Play button: advance the simulation playhead smoothly (time-based rAF, ~30fps)
  // so the storm and tiles animate fluidly instead of jumping. The full horizon
  // plays over ~24s regardless of its length.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const rate = simMax / 24000; // playhead units per millisecond
    const tick = (now: number) => {
      const dt = now - last;
      if (dt >= 33) {
        last = now;
        setSimHour((h) => {
          const nh = h + rate * dt;
          return nh >= simMax ? 0 : nh;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, simMax]);
  // Reset the playhead when switching between Weather and Twin simulations.
  useEffect(() => {
    setSimHour(0);
    setPlaying(false);
  }, [tab]);

  const toggleFullscreen = () => {
    const el = mapWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const exp = exposure.data ?? [];
  const expByLevel = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of exp) m[e.level] = (m[e.level] ?? 0) + 1;
    return m;
  }, [exp]);
  const critCount = (expByLevel["critical"] ?? 0) + (expByLevel["high"] ?? 0);
  const exposedCount = exp.filter((e) => e.level !== "normal" && e.level !== "monitor").length;

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

  // Orb colouring depends on the active scenario:
  //  • Weather  → storm exposure (the live `riskMap`), so Gulf sites glow red.
  //  • Digital Twin → equipment condition: a site is red only if it has any
  //    critical equipment; otherwise neutral (independent of the storm).
  const criticalSites = useMemo(() => {
    const s = new Set<string>();
    for (const e of fleetAssets.data ?? [])
      if ((e.status || "") === "critical" && e.plant) s.add(String(e.plant).toLowerCase());
    return s;
  }, [fleetAssets.data]);
  // Per-site twin summary (equipment health + critical count) keyed by site name.
  const twinSiteMap = useMemo(() => {
    const acc = new Map<string, { sum: number; n: number; crit: number }>();
    for (const e of fleetAssets.data ?? []) {
      const p = String(e.plant || "").toLowerCase();
      if (!p) continue;
      const a = acc.get(p) ?? { sum: 0, n: 0, crit: 0 };
      a.sum += num(e.health);
      a.n += 1;
      if ((e.status || "") === "critical") a.crit += 1;
      acc.set(p, a);
    }
    const m = new Map<string, { health: number; critical: boolean; critCount: number; count: number }>();
    for (const [p, a] of acc)
      m.set(p, {
        health: a.n ? Math.round(a.sum / a.n) : 0,
        critical: a.crit > 0,
        critCount: a.crit,
        count: a.n,
      });
    return m;
  }, [fleetAssets.data]);
  const twinRiskMap = useMemo(() => {
    const m = new Map<string, { level: string; score: number }>();
    for (const a of assets) {
      const crit = criticalSites.has(String(a.name || "").toLowerCase());
      m.set(a.id, { level: crit ? "critical" : "normal", score: crit ? 92 : 8 });
    }
    return m as unknown as typeof riskMap;
  }, [assets, criticalSites, riskMap]);
  const mapRisks = tab === "twin" ? twinRiskMap : riskMap;

  // ── simulation snapshots (drive the tiles as the playhead advances) ────────
  // Storm intensity ramps toward a mid-horizon peak, so exposure/impact grow
  // then ease as the system passes — the same bell used by the impact chart.
  const stormIntensity = useMemo(() => {
    const t = horizon ? Math.min(1, simHour / horizon) : 0;
    const bell = Math.exp(-Math.pow((t - 0.55) * 2.3, 2));
    return Math.max(0.08, bell);
  }, [simHour, horizon]);
  const weatherSim = useMemo(() => {
    const maxExposed = Math.max(exposedCount, Math.round((assets.length || 60) * 0.45));
    const exposedNow = Math.round(exposedCount * 0.35 + (maxExposed - exposedCount * 0.35) * stormIntensity);
    const critNow = Math.round(critCount * (0.3 + 0.7 * stormIntensity));
    const woNow = woOpen + Math.round(critNow * 0.6);
    const resilienceNow = Math.max(35, Math.round(100 - (exposedNow / (assets.length || 60)) * 90));
    return { exposedNow, critNow, woNow, resilienceNow };
  }, [exposedCount, critCount, woOpen, assets.length, stormIntensity]);
  // Twin simulation runs over 120 DAYS: failures and availability degrade slowly
  // at first, then accelerate past the mid-point (~60 days) — an ease-in wear /
  // cascade curve.
  const twinSim = useMemo(() => {
    const t = Math.min(1, simHour / 120);
    const ease = Math.pow(t, 2.2);
    const base = Math.max(2, critAssets);
    // No failures at day 0 — they only accumulate as the model runs forward.
    const failedNow = Math.round(base * 3.6 * ease);
    const degradedNow = Math.round((critCount || base * 3) * (0.15 + 1.6 * ease));
    const availNow = Math.max(45, Math.round(availability - failedNow * 1.3 - degradedNow * 0.25));
    const downtimeNow = Math.round(failedNow * 8 + degradedNow * 1.5);
    return { failedNow, degradedNow, availNow, downtimeNow };
  }, [simHour, critAssets, critCount, availability]);

  // ── selection context: when a site is picked (map click or an alert), the
  // left column drills into that specific location. ────────────────────────
  const selectedAsset = useMemo(
    () => (selected ? (assets.find((a) => a.id === selected) ?? null) : null),
    [assets, selected],
  );
  const selectedRisk = selected ? riskMap.get(selected) : undefined;
  const selectedExp = useMemo(
    () => (selected ? (exp.find((e) => e.assetId === selected) ?? null) : null),
    [exp, selected],
  );
  // The selected site's health + level follow the ACTIVE scenario so the panel
  // colour matches its orb:
  //  • Weather → storm exposure (risk map).
  //  • Digital Twin → equipment condition (critical if it has any critical asset).
  const twinSel = selectedAsset
    ? twinSiteMap.get(String(selectedAsset.name || "").toLowerCase())
    : undefined;
  const siteLevel = (
    tab === "twin"
      ? twinSel?.critical
        ? "critical"
        : "normal"
      : (selectedRisk?.level ?? selectedExp?.level ?? "normal")
  ) as string;
  const siteScore =
    tab === "twin"
      ? twinSel?.critical
        ? 92
        : Math.max(0, 100 - (twinSel?.health ?? 100))
      : num(selectedRisk?.score ?? selectedExp?.score);
  const siteHealth = !selectedAsset
    ? 0
    : tab === "twin"
      ? (twinSel?.health ?? 0)
      : Math.max(6, Math.round(100 - Math.min(82, siteScore * 0.7)));
  const siteAlerts = useMemo(
    () =>
      selectedAsset
        ? buildSiteAlerts(selectedAsset, siteLevel, siteScore, storm, workOrders.data ?? [])
        : [],
    [selectedAsset, siteLevel, siteScore, storm, workOrders.data],
  );

  // ── detail-modal builders: each pulls data SPECIFIC to the clicked item
  // (risk breakdown, category asset list, full work-order record) rather than
  // echoing the tile. ────────────────────────────────────────────────────
  const nameOfAsset = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  const assetRiskModal = (assetId: string): ModalData => {
    const a = assets.find((x) => x.id === assetId);
    const r = riskMap.get(assetId);
    const e = exp.find((x) => x.assetId === assetId);
    const twin = tab === "twin" ? twinSiteMap.get(String(a?.name || "").toLowerCase()) : undefined;
    const level = (
      tab === "twin"
        ? twin?.critical
          ? "critical"
          : "normal"
        : (r?.level ?? e?.level ?? "normal")
    ) as string;
    const color =
      level === "critical" ? C.red : level === "high" || level === "elevated" ? C.amber : level === "monitor" ? C.cyan : C.ok;
    const fields =
      tab === "twin"
        ? [
            { label: "Type", value: (a?.type ?? "—").replace(/_/g, " ") },
            { label: "Condition", value: twin?.critical ? "Critical" : "Nominal" },
            { label: "Site health", value: twin ? `${twin.health}%` : "—" },
            { label: "Critical assets", value: twin ? `${twin.critCount} of ${twin.count}` : "—" },
          ]
        : [
            { label: "Type", value: (a?.type ?? "—").replace(/_/g, " ") },
            { label: "Risk level", value: level },
            { label: "Risk score", value: String(Math.round(num(r?.score ?? e?.score))) },
          ];
    if (tab !== "twin" && r) {
      fields.push(
        { label: "Distance to storm", value: `${Math.round(r.distanceMi)} mi` },
        { label: "Forecast wind", value: `${Math.round(r.forecastWindMph)} mph` },
        { label: "Rainfall", value: `${r.rainfallIn.toFixed(1)} in` },
        { label: "Hours to impact", value: r.hoursToImpact != null ? `${r.hoursToImpact} h` : "—" },
      );
    }
    if (a?.lat != null && a?.lon != null)
      fields.push({ label: "Coordinates", value: `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}` });
    // Scenario-aware drill-target: Digital Twin opens the site's 3D equipment
    // train in the Control Room; Weather opens the live storm map.
    const nav =
      tab === "twin"
        ? { to: "/control-room", search: { plant: a?.name ?? "" }, toLabel: "Open in Digital Twin →" }
        : { to: "/map", search: undefined, toLabel: "Open Live Map →" };
    return {
      title: a?.name ?? assetId,
      subtitle: (a?.type ?? "asset").replace(/_/g, " "),
      badge: { label: level.toUpperCase(), color },
      fields,
      to: nav.to,
      search: nav.search,
      toLabel: nav.toLabel,
      onFocus: () => setSelected(assetId),
      focusLabel: "Focus on map",
    };
  };
  const stormModal = (s: typeof storm): ModalData => ({
    title: s?.name ?? "Weather system",
    subtitle: (s?.region ?? "").replace(/_/g, " ") || "Active weather",
    badge: {
      label:
        s?.kind === "hurricane"
          ? `Cat ${Math.max(1, num(s?.currentCategory))}`
          : (s?.hazardKind ?? s?.kind ?? "weather").replace(/_/g, " "),
      color: C.purple,
    },
    fields: [
      { label: "Sustained wind", value: `${num(s?.currentWindMph)} mph` },
      { label: "Gusts", value: `${num(s?.gustMph)} mph` },
      { label: "Pressure", value: `${num(s?.pressureMb)} mb` },
      { label: "Region", value: (s?.region ?? "—").replace(/_/g, " ") },
      { label: "Status", value: s?.status ?? "active" },
    ],
    to: "/map",
    toLabel: "Open Live Map →",
  });
  const alertModal = (a: AlertRowProps): ModalData => {
    if (a.assetId) return assetRiskModal(a.assetId);
    if (a.icon === "weather" && storm) return stormModal(storm);
    return {
      title: a.title,
      subtitle: a.sub,
      badge: a.ago ? { label: a.ago, color: a.tone } : undefined,
      fields: [{ label: "Detail", value: a.sub }],
      to: "/alerts",
      toLabel: "View in Alerts →",
    };
  };
  const categoryModal = (label: string): ModalData => {
    const rowsAll = exp
      .filter((e) => categoryOf(e.assetId) === label)
      .map((e) => ({
        name: nameOfAsset(e.assetId),
        health: Math.round(100 - Math.min(60, num(e.score) * 0.4)),
        level: e.level,
      }))
      .sort((x, y) => x.health - y.health);
    const atRisk = rowsAll.filter((r) => r.level !== "normal" && r.level !== "monitor").length;
    const avg = rowsAll.length ? Math.round(rowsAll.reduce((s, r) => s + r.health, 0) / rowsAll.length) : 0;
    return {
      title: label,
      subtitle: "Asset category",
      badge: { label: `${avg}% avg`, color: avg >= 85 ? C.ok : avg >= 70 ? C.amber : C.red },
      fields: [
        { label: "Assets in category", value: String(rowsAll.length) },
        { label: "At-risk / degraded", value: String(atRisk) },
        { label: "Average health", value: `${avg}%` },
      ],
      listTitle: "Lowest-health assets",
      list: rowsAll.slice(0, 6).map((r) => ({
        label: r.name,
        value: `${r.health}%`,
        color: r.health >= 92 ? C.ok : r.health >= 75 ? C.amber : C.red,
      })),
      to: "/asset-explorer",
      search: { category: label },
      toLabel: "View in Asset Explorer →",
    };
  };
  const woModal = (wo: WorkOrder): ModalData => {
    const st = scheduleStatus(wo);
    return {
      title: wo.entity_descr || wo.problem_descr.slice(0, 48),
      subtitle: `${wo.site_name || wo.location} · ${wo.wr_id}`,
      badge: { label: st.label, color: st.color },
      fields: [
        { label: "Work order", value: wo.wr_id },
        { label: "Problem", value: wo.problem_descr || "—" },
        { label: "Equipment", value: wo.entity_descr || "—" },
        { label: "Site", value: wo.site_name || "—" },
        { label: "Location", value: wo.location || "—" },
        { label: "Priority", value: `P${num(wo.priority)}` },
        { label: "Status", value: wo.wr_status || "—" },
      ],
      to: "/maintenance",
      search: { wo: wo.wr_id },
      toLabel: "View in Maintenance →",
    };
  };

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
      <div className="og-command-skin min-h-full" style={{ background: `var(--og-skin-gradient, radial-gradient(1200px 600px at 60% -10%, #101a33 0%, ${C.ink} 55%))`, color: "#e6eef8" }}>
        <style>{`
          @keyframes ccFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
          @keyframes ccFlash { from { opacity: 0.6; } to { opacity: 0; } }
          @keyframes ccSlideIn { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
        `}</style>
        {/* main grid */}
        <div className="grid gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
          {/* ── left column ── */}
          <div className="flex flex-col gap-4">
            {selectedAsset && (
              <SelectedSitePanel
                id={selectedAsset.id}
                name={selectedAsset.name ?? selectedAsset.id}
                type={selectedAsset.type}
                lat={selectedAsset.lat}
                lon={selectedAsset.lon}
                health={siteHealth}
                level={siteLevel}
                score={siteScore}
                onClear={() => setSelected(null)}
                onOpen={() => selected && setModal(assetRiskModal(selected))}
              />
            )}
            <Panel title="GRID HEALTH" action="Fleet health" actionTo="/control-room" loading={fleetHealth.loading && !fleetHealth.data}>
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

            <Panel title={selectedAsset ? "SITE ALERTS" : "ALERTS"} action="View all" actionTo="/alerts" className="min-h-0 flex-1" loading={!selectedAsset && (exposure.loading || workOrders.loading) && !exposure.data}>
              <div className="space-y-1.5">
                {(selectedAsset ? siteAlerts : buildAlerts(activeStorm, exp, workOrders.data ?? [])).map((a, i) => (
                  <AlertRow key={i} {...a} onOpen={() => setModal(alertModal(a))} />
                ))}
              </div>
            </Panel>

            <Panel title="WEATHER OVERVIEW" action="Live map" actionTo="/map" className="min-h-0 flex-1" loading={allEvents.isLoading && !activeStorm}>
              <WeatherCard event={activeStorm} />
            </Panel>
          </div>

          {/* ── center column ── */}
          <div className="flex flex-col gap-4">
            <div
              ref={mapWrapRef}
              className={`relative flex flex-col overflow-hidden rounded-xl border ${isFs ? "h-screen" : "min-h-0 flex-1"}`}
              style={{
                borderColor: C.border,
                background: "#020617",
              }}
            >
              {/* map header */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex rounded-lg bg-white/[0.05] p-0.5">
                  {(
                    [
                      ["twin", "Digital Twin"],
                      ["weather", "Weather"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${tab === k ? "og-primary-control" : ""}`}
                      aria-pressed={tab === k}
                      style={tab === k ? { backgroundColor: C.blue, color: "#fff" } : { color: C.sub }}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {/* storm selector — only on the Weather view */}
                {tab === "weather" && (
                  <div className="relative ml-1">
                    <select
                      value={selectedStorm ?? ""}
                      onChange={(e) => setSelectedStorm(e.target.value || null)}
                      className="appearance-none rounded-md border py-1.5 pr-7 pl-3 text-[12px] font-medium outline-none"
                      style={{ borderColor: C.border, background: "#0d1526", color: "#e6eef8" }}
                    >
                      <option value="" style={{ background: "#0d1526", color: "#e6eef8" }}>
                        All storms · centered
                      </option>
                      {events.map((e) => (
                        <option key={e.id} value={e.id} style={{ background: "#0d1526", color: "#e6eef8" }}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-2 right-2 size-3.5 text-slate-400" />
                  </div>
                )}

                <div className="relative ml-auto flex items-center gap-1.5 text-slate-400">
                  <IconBtn active={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
                    <Layers className="size-4" />
                  </IconBtn>
                  <IconBtn onClick={toggleFullscreen}>
                    <Maximize2 className="size-4" />
                  </IconBtn>
                  {/* layers popover, anchored to the layers icon */}
                  {layersOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setLayersOpen(false)} />
                      <div
                        className="absolute right-0 top-10 z-40 w-52 rounded-lg border p-2 shadow-2xl backdrop-blur"
                        style={{ borderColor: C.border, background: "rgba(10,15,30,0.94)" }}
                      >
                        <div className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider text-slate-400">
                          {tab === "weather" ? "WEATHER LAYERS" : "GRID LAYERS"}
                        </div>
                        {(tab === "weather"
                          ? ([
                              ["assets", "Assets"],
                              ["wind", "Weather"],
                              ["track", "Storm Path"],
                              ["outages", "Outages"],
                            ] as const)
                          : ([
                              ["assets", "Assets"],
                              ["links", "Site Links"],
                              ["outages", "Outages"],
                            ] as const)
                        ).map(([k, l]) => (
                          <button
                            key={k}
                            onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12px] hover:bg-white/[0.06]"
                          >
                            <span className={layers[k] ? "text-slate-100" : "text-slate-400"}>{l}</span>
                            <span
                              className="grid h-4 w-7 place-items-center rounded-full px-0.5 transition"
                              style={{
                                background: layers[k] ? C.blue : "rgba(255,255,255,0.12)",
                                justifyItems: layers[k] ? "end" : "start",
                              }}
                            >
                              <span className="size-3 rounded-full bg-white" />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* the hero map */}
              <div
                className={`relative w-full ${isFs ? "flex-1" : "min-h-[440px] flex-1"}`}
                style={{
                  background:
                    "var(--og-map-gradient, radial-gradient(ellipse 80% 70% at 50% 45%, #1b273d 0%, #0f172a 45%, #080d1a 75%, #020617 100%))",
                }}
              >
                {mapReady ? (
                  <WeatherHoloMap
                    className="h-full w-full"
                    assets={assets}
                    risks={mapRisks}
                    event={tab === "weather" ? activeStorm : undefined}
                    events={tab === "weather" ? events : []}
                    layers={layers}
                    catalogLayers={layerDefs.data ?? []}
                    selectedId={selected}
                    hour={tab === "weather" ? simHour : 0}
                    initialFocusEventId={tab === "weather" && selectedStorm ? selectedStorm : undefined}
                    failures={tab === "twin" ? twinSim.failedNow : 0}
                    skipGlobe
                    flat
                    onSelect={setSelected}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="size-7 animate-spin" style={{ color: C.cyan }} />
                    <div className="text-[13px] font-medium text-slate-300">Rendering holographic map…</div>
                    <div className="text-[11px] text-slate-500">Dashboard is ready — the 3D map is building</div>
                  </div>
                )}
                {/* Site drill-in flyout: on selecting a site, a menu slides in over
                    the map with a scenario-aware CTA — Digital Twin opens the site's
                    3D equipment train (Control Room · second level); Weather opens
                    the live storm map. */}
                {selectedAsset && (
                  <SiteFlyout
                    name={selectedAsset.name ?? selectedAsset.id}
                    type={selectedAsset.type}
                    level={siteLevel}
                    health={siteHealth}
                    tab={tab}
                    base={base}
                    onDetails={() => selected && setModal(assetRiskModal(selected))}
                    onClose={() => setSelected(null)}
                  />
                )}
                {/* cross-dissolve when switching Weather ↔ Digital Twin */}
                <div
                  key={tab}
                  className="pointer-events-none absolute inset-0 z-10"
                  style={{ background: "#070b16", opacity: 0, animation: "ccFlash 0.5s ease" }}
                />
              </div>
            </div>

            {/* simulation panel — Storm (Weather) or Twin (Digital Twin) */}
            <div key={tab} style={{ animation: "ccFade 0.5s ease" }}>
            {tab === "weather" ? (
              <Panel>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold tracking-wide text-slate-200">STORM SIMULATION</span>
                  <span className="text-[12px] text-slate-400">{activeStorm?.name ?? "No active event"}</span>
                  {activeStorm && (
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${C.purple}22`, color: "#d8b4fe" }}>
                      {activeStorm.kind === "hurricane" ? `Category ${Math.max(1, num(activeStorm.currentCategory))}` : (activeStorm.hazardKind ?? activeStorm.kind)?.replace(/_/g, " ")}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setSimHour(0);
                      setPlaying(true);
                    }}
                    className="og-primary-control ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                    style={{ backgroundColor: C.blue }}
                  >
                    <Sparkles className="size-3.5" /> Run Simulation
                  </button>
                </div>
                <SimTimeline hour={simHour} setHour={setSimHour} max={horizon} unit="h" playing={playing} onTogglePlay={() => setPlaying((p) => !p)} />
                <div className="mt-3 grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
                  <BigStat label="Assets Exposed" value={String(weatherSim.exposedNow)} tone={C.amber} />
                  <BigStat label="Critical / High" value={String(weatherSim.critNow)} tone={C.red} />
                  <BigStat label="Open Work Orders" value={String(weatherSim.woNow)} tone={C.cyan} />
                  <BigStat label="System Resilience" value={`${weatherSim.resilienceNow}%`} tone={C.ok} />
                  <div className="rounded-lg border p-3" style={{ borderColor: C.border, background: C.panel }}>
                    <div className="mb-1 text-[10px] tracking-wider text-slate-400">IMPACT OVER TIME</div>
                    <ImpactChart forecast={activeStorm?.forecast ?? []} exposure={exp} hour={simHour} max={horizon} />
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold tracking-wide text-slate-200">TWIN SIMULATION</span>
                  <span className="text-[12px] text-slate-400">Equipment failure projection</span>
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${C.cyan}22`, color: "#bae6fd" }}>
                    {`+${Math.round(simHour)}d horizon`}
                  </span>
                  <button
                    onClick={() => {
                      setSimHour(0);
                      setPlaying(true);
                    }}
                    className="og-primary-control ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                    style={{ backgroundColor: C.blue }}
                  >
                    <Cpu className="size-3.5" /> Run Failure Model
                  </button>
                </div>
                <SimTimeline hour={simHour} setHour={setSimHour} max={120} unit="d" playing={playing} onTogglePlay={() => setPlaying((p) => !p)} />
                <div className="mt-3 grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
                  <BigStat label="Failed Assets" value={String(twinSim.failedNow)} tone={C.red} />
                  <BigStat label="Degraded" value={String(twinSim.degradedNow)} tone={C.amber} />
                  <BigStat label="Availability" value={`${twinSim.availNow}%`} tone={C.ok} />
                  <BigStat label="Downtime (hrs)" value={String(twinSim.downtimeNow)} tone={C.purple} />
                  <div className="rounded-lg border p-3" style={{ borderColor: C.border, background: C.panel }}>
                    <div className="mb-1 text-[10px] tracking-wider text-slate-400">FAILURES OVER TIME</div>
                    <FailureChart hour={simHour} max={120} peak={twinSim.failedNow} />
                  </div>
                </div>
              </Panel>
            )}
            </div>
          </div>

          {/* ── right column ── */}
          <div className="flex flex-col gap-4">
            <Panel title="MAINTENANCE OVERVIEW" action="Schedule" actionTo="/maintenance" loading={woSummary.loading && !woSummary.data}>
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

            <Panel title="MAINTENANCE SCHEDULE" action="View all" actionTo="/maintenance" loading={workOrders.loading && !workOrders.data}>
              <div className="space-y-2">
                {(workOrders.data ?? []).slice(0, 4).map((w) => (
                  <ScheduleRow key={w.wr_id} wo={w} onOpen={() => setModal(woModal(w))} />
                ))}
              </div>
            </Panel>

            <Panel title="ASSET HEALTH" action="View all" actionTo="/asset-explorer" loading={exposure.loading && !exposure.data}>
              <div className="space-y-2.5">
                {catHealth.map((c) => (
                  <HBar key={c.label} label={c.label} pct={c.pct} onOpen={() => setModal(categoryModal(c.label))} />
                ))}
              </div>
            </Panel>
          </div>
        </div>
        {modal && <DetailModal data={modal} onClose={() => setModal(null)} />}
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
  rows.sort((a, b) => a.pct - b.pct);
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
  if (topCrit) out.push({ tone: C.amber, icon: "warn", title: "Asset at critical exposure", sub: `${topCrit.assetId} · score ${topCrit.score}`, ago: "8m ago", assetId: topCrit.assetId });
  const veg = wos.find((w) => /veget|line|patrol/i.test(w.problem_descr));
  if (veg) out.push({ tone: C.amber, icon: "warn", title: veg.entity_descr || "Vegetation Management", sub: veg.location, ago: "15m ago" });
  const due = wos.find((w) => /(schedul|inspect|maint)/i.test(w.wr_status) || /inspect/i.test(w.problem_descr));
  if (due) out.push({ tone: C.cyan, icon: "info", title: "Maintenance Due", sub: `${due.problem_descr.slice(0, 34)} · ${due.site_name}`, ago: "1h ago" });
  return out.slice(0, 4);
}
// Site-scoped alerts shown when a specific location is selected on the map.
function buildSiteAlerts(
  asset: { id: string; name?: string },
  level: string,
  score: number,
  storm: { name?: string } | undefined,
  wos: WorkOrder[],
): AlertRowProps[] {
  const out: AlertRowProps[] = [];
  if (level === "critical" || level === "high")
    out.push({ tone: level === "critical" ? C.red : C.amber, icon: "warn", title: `${level === "critical" ? "Critical" : "Elevated"} exposure`, sub: `${asset.name ?? asset.id} · score ${Math.round(score)}`, ago: "live", assetId: asset.id });
  if (storm)
    out.push({ tone: C.cyan, icon: "weather", title: "Weather in range", sub: `${storm.name} tracking near site`, ago: "live" });
  const wo = wos.find((w) => (w.site_name || "").toLowerCase().includes((asset.name ?? "").toLowerCase().split(" ")[0] || "~none~"));
  if (wo)
    out.push({ tone: C.amber, icon: "info", title: wo.entity_descr || "Open work order", sub: `${wo.problem_descr.slice(0, 30)} · ${wo.site_name}`, ago: "2h ago" });
  if (out.length === 0)
    out.push({ tone: C.ok, icon: "info", title: "No active alerts", sub: `${asset.name ?? asset.id} is operating normally`, ago: "" });
  return out.slice(0, 4);
}

// ───────────────────────────── UI atoms ───────────────────────────────────
function DetailModal({ data, onClose }: { data: ModalData; onClose: () => void }) {
  const base = useOpsBase();
  const router = useRouter();
  const view = () => {
    onClose();
    if (data.to)
      (router.navigate as (o: { to: string; search?: Record<string, string> }) => void)({
        to: `${base}${data.to}`,
        search: data.search,
      });
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: C.border, background: "#0c1424" }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-slate-100">{data.title}</div>
            {data.subtitle && <div className="truncate text-[12px] text-slate-400">{data.subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.badge && (
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: `${data.badge.color}22`, color: data.badge.color }}
              >
                {data.badge.label}
              </span>
            )}
            <button
              onClick={onClose}
              className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-white/10"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: C.border, background: C.panel }}>
          {data.fields.map((f) => (
            <div key={f.label} className="flex items-start justify-between gap-4 text-[12.5px]">
              <span className="shrink-0 text-slate-400">{f.label}</span>
              <span className="text-right font-medium text-slate-200">{f.value}</span>
            </div>
          ))}
        </div>
        {data.list && data.list.length > 0 && (
          <div className="mt-2 rounded-lg border p-3" style={{ borderColor: C.border, background: C.panel }}>
            {data.listTitle && (
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {data.listTitle}
              </div>
            )}
            <div className="space-y-1.5">
              {data.list.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-slate-300">{r.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums" style={{ color: r.color ?? "#dbe6f5" }}>
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {data.onFocus && (
            <button
              onClick={() => {
                data.onFocus!();
                onClose();
              }}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: "rgba(255,255,255,0.06)", color: "#dbeafe" }}
            >
              {data.focusLabel ?? "Focus on map"}
            </button>
          )}
          {data.to && (
            <button
              onClick={view}
              className="og-primary-control rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ backgroundColor: C.blue }}
            >
              {data.toLabel ?? "View full record →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function SiteFlyout({
  name,
  type,
  level,
  health,
  tab,
  base,
  onDetails,
  onClose,
}: {
  name: string;
  type?: string;
  level: string;
  health: number;
  tab: "twin" | "weather";
  base: string;
  onDetails: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const color =
    level === "critical" ? C.red : level === "high" || level === "elevated" ? C.amber : level === "monitor" ? C.cyan : C.ok;
  const go = (to: string, search?: Record<string, string>) =>
    (router.navigate as (o: { to: string; search?: Record<string, string> }) => void)({
      to: `${base}${to}`,
      search,
    });
  const primary =
    tab === "twin"
      ? {
          label: "Enter Digital Twin",
          sub: "3D equipment train · Control Room",
          Icon: Boxes,
          onClick: () => go("/control-room", { plant: name }),
        }
      : {
          label: "Open Live Map",
          sub: "Storm track · cone · wind field",
          Icon: MapIcon,
          onClick: () => go("/map"),
        };
  return (
    <div
      className="pointer-events-none absolute top-3 right-3 z-[55] w-[250px]"
      style={{ animation: "ccSlideIn 0.28s ease" }}
    >
      <div
        className="pointer-events-auto rounded-xl border p-3 shadow-2xl"
        style={{ borderColor: `${color}66`, background: "rgba(10,17,30,0.94)", backdropFilter: "blur(6px)" }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-slate-100">{name}</div>
            <div className="text-[11px] text-slate-400">{(type ?? "site").replace(/_/g, " ")}</div>
          </div>
          <button
            onClick={onClose}
            className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ background: `${color}22`, color }}
          >
            {level.toUpperCase()}
          </span>
          <span className="text-[11px] text-slate-400">
            Health <span className="font-semibold" style={{ color }}>{health}%</span>
          </span>
        </div>
        <button
          onClick={primary.onClick}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:brightness-110"
          style={{ background: `${color}1f`, border: `1px solid ${color}55` }}
        >
          <primary.Icon className="size-5 shrink-0" style={{ color }} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-slate-100">{primary.label}</div>
            <div className="truncate text-[10.5px] text-slate-400">{primary.sub}</div>
          </div>
          <ArrowUpRight className="size-4 shrink-0" style={{ color }} />
        </button>
        <button
          onClick={onDetails}
          className="mt-1.5 block w-full rounded-lg px-3 py-1.5 text-center text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.06]"
        >
          View site details
        </button>
      </div>
    </div>
  );
}
function SelectedSitePanel({
  id,
  name,
  type,
  lat,
  lon,
  health,
  level,
  score,
  onClear,
  onOpen,
}: {
  id: string;
  name: string;
  type?: string;
  lat?: number;
  lon?: number;
  health: number;
  level: string;
  score: number;
  onClear: () => void;
  onOpen: () => void;
}) {
  const color =
    level === "critical" ? C.red : level === "high" || level === "elevated" ? C.amber : level === "monitor" ? C.cyan : C.ok;
  void id;
  return (
    <div
      className="rounded-xl border p-3.5"
      style={{ borderColor: `${C.blue}55`, background: `linear-gradient(160deg, ${C.blue}18, ${C.panel})` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-slate-300">SELECTED SITE</div>
        <button
          onClick={onClear}
          className="grid size-6 place-items-center rounded-md text-slate-400 hover:bg-white/10"
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <button onClick={onOpen} className="flex w-full items-center gap-2 text-left transition hover:opacity-90">
        <ArcGauge value={health} color={color} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-slate-100">{name}</div>
          <div className="text-[11px] text-slate-400">{(type ?? "site").replace(/_/g, " ")}</div>
          <span
            className="mt-1 inline-block rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ background: `${color}22`, color }}
          >
            {level.toUpperCase()}
          </span>
        </div>
      </button>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Risk Score" value={String(Math.round(score))} tone={color} />
        <MiniStat label="Site Health" value={`${health}%`} tone={color} />
        <MiniStat
          label="Coordinates"
          value={lat != null && lon != null ? `${lat.toFixed(1)}, ${lon.toFixed(1)}` : "—"}
        />
      </div>
      <button
        onClick={onOpen}
        className="mt-3 block w-full text-center text-[11px] font-medium hover:underline"
        style={{ color: C.cyan }}
      >
        View details →
      </button>
    </div>
  );
}
function Panel({
  title,
  action,
  actionTo,
  className,
  loading,
  children,
}: {
  title?: string;
  action?: string;
  actionTo?: string;
  className?: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`og-panel rounded-xl border p-3.5 ${className ?? ""}`}
      style={{ borderColor: C.border, background: C.panel, backdropFilter: "blur(4px)" }}
    >
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-slate-400">{title}</div>
          {action &&
            (actionTo ? (
              <OpsLink
                to={actionTo}
                className="text-[11px] font-medium hover:underline"
                style={{ color: C.cyan }}
              >
                {action}
              </OpsLink>
            ) : (
              <div className="text-[11px] font-medium" style={{ color: C.cyan }}>{action}</div>
            ))}
        </div>
      )}
      {loading ? <Spinner /> : children}
    </div>
  );
}
function Spinner() {
  return (
    <div className="flex min-h-[84px] flex-1 items-center justify-center py-6">
      <Loader2 className="size-5 animate-spin" style={{ color: C.cyan }} />
    </div>
  );
}
function IconBtn({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-md hover:bg-white/10 ${active ? "og-nav-selected bg-white/10 text-white" : ""}`}
    >
      {children}
    </button>
  );
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
type AlertRowProps = {
  tone: string;
  icon: "weather" | "warn" | "info";
  title: string;
  sub: string;
  ago: string;
  /** When set, clicking the alert selects/zooms this asset instead of navigating. */
  assetId?: string;
};
function AlertRow({
  tone,
  icon,
  title,
  sub,
  ago,
  onOpen,
}: AlertRowProps & { onOpen: () => void }) {
  const Icon = icon === "weather" ? CloudLightning : icon === "warn" ? AlertTriangle : Bell;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition hover:brightness-125"
      style={{ borderColor: `${tone}33`, background: `${tone}0f` }}
    >
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color: tone }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-slate-100">{title}</div>
        <div className="truncate text-[11px] text-slate-400">{sub}</div>
      </div>
      <div className="shrink-0 text-[10px] text-slate-500">{ago}</div>
    </button>
  );
}
function ScheduleRow({ wo, onOpen }: { wo: WorkOrder; onOpen: () => void }) {
  const status = scheduleStatus(wo);
  const Icon = equipIcon(`${wo.entity_descr ?? ""} ${wo.problem_descr ?? ""}`);
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-md p-1 text-left transition hover:bg-white/[0.05]"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white/[0.05]">
        <Icon className="size-4" style={{ color: status.color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-slate-100">{wo.problem_descr || wo.entity_descr}</div>
        <div className="truncate text-[11px] text-slate-400">
          {[wo.entity_descr, wo.location].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span className="shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: `${status.color}22`, color: status.color }}>
        {status.label}
      </span>
    </button>
  );
}
function scheduleStatus(wo: WorkOrder): { label: string; color: string } {
  if (num(wo.priority) <= 1) return { label: "Overdue", color: C.red };
  if (/ready|planning|new/i.test(wo.wr_status) || num(wo.priority) === 2) return { label: "At-Risk", color: C.amber };
  return { label: "On-Time", color: C.ok };
}
function HBar({ label, pct, onOpen }: { label: string; pct: number; onOpen: () => void }) {
  const color = pct >= 92 ? C.ok : pct >= 85 ? "#8fd14f" : pct >= 75 ? C.amber : C.red;
  return (
    <button
      onClick={onOpen}
      className="block w-full rounded-md p-1 text-left transition hover:bg-white/[0.05]"
    >
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold tabular-nums text-slate-200">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}bb)` }} />
      </div>
    </button>
  );
}

// ── SVG widgets ────────────────────────────────────────────────────────────
function ArcGauge({ value, color: colorOverride }: { value: number; color?: string }) {
  const r = 52;
  const circ = Math.PI * r; // half circle
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = colorOverride ?? healthColor(value);
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
function SimTimeline({
  hour,
  setHour,
  max,
  playing,
  onTogglePlay,
  unit = "h",
}: {
  hour: number;
  setHour: (h: number) => void;
  max: number;
  playing: boolean;
  onTogglePlay: () => void;
  unit?: string;
}) {
  const ticks = useMemo(() => {
    const n = 8;
    return Array.from({ length: n + 1 }, (_, i) => Math.round((i / n) * max));
  }, [max]);
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onTogglePlay}
        className="og-primary-control grid size-8 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: C.blue }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: C.blue }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          {ticks.map((h, i) => (
            <span key={i} style={{ color: h <= hour ? C.cyan : undefined }}>+{h}{unit}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
function ImpactChart({ forecast, exposure, hour = 0, max = 24 }: { forecast: Array<{ hour: number; windMph?: number }>; exposure: Exposure[]; hour?: number; max?: number }) {
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
  const playX = max ? Math.max(0, Math.min(1, hour / max)) * W : 0;
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
      {hour > 0 && <line x1={playX} y1="0" x2={playX} y2={H} stroke={C.cyan} strokeWidth="1.2" strokeDasharray="3 3" />}
    </svg>
  );
}
function FailureChart({ hour, max, peak }: { hour: number; max: number; peak: number }) {
  const W = 240;
  const H = 66;
  const N = 24;
  const pts = useMemo(
    () => Array.from({ length: N + 1 }, (_, i) => {
      const t = i / N;
      return 0.05 + (0.2 + 1.75 * t * t) / (0.2 + 1.75); // normalized cumulative-failure curve
    }),
    [],
  );
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / N) * W} ${H - p * H}`).join(" ");
  const area = `${path} L ${W} ${H} L 0 ${H} Z`;
  const playX = max ? Math.max(0, Math.min(1, hour / max)) * W : 0;
  const playFrac = max ? Math.max(0, Math.min(1, hour / max)) : 0;
  const playY = H - (0.05 + (0.2 + 1.75 * playFrac * playFrac) / (0.2 + 1.75)) * H;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="failgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.red} stopOpacity="0.5" />
          <stop offset="100%" stopColor={C.red} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#failgrad)" />
      <path d={path} fill="none" stroke={C.red} strokeWidth="2" style={{ filter: `drop-shadow(0 0 4px ${C.red}aa)` }} />
      <circle cx={playX} cy={playY} r="3" fill="#fff" />
      <line x1={playX} y1="0" x2={playX} y2={H} stroke={C.cyan} strokeWidth="1.2" strokeDasharray="3 3" />
      <text x={playX < W - 40 ? playX + 4 : playX - 34} y="12" fontSize="9" fill="#fca5a5">{peak}</text>
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
