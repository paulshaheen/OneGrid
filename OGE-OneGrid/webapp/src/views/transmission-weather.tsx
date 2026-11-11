import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Feature, FeatureCollection } from "geojson";
import { CloudSnow, Gauge, Loader2, Pause, Play, Thermometer, Truck, Wind, Zap } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { RiskBadge, StatCell } from "@/components/ops/RiskBadge";
import {
  CONDUCTORS,
  SERVICE_AREAS,
  SUBSTATIONS,
  TX_LINES,
  linePath,
} from "@/lib/data/se-transmission";
import {
  analyzeCorridors,
  iceClass,
  levelFromScore,
  type CorridorAnalysis,
  type Level,
  type LineHour,
  type LineResult,
} from "@/lib/services/corridor/engine";
import { getCorridorWeather, type CorridorSource, type CorridorWeather } from "@/lib/services/corridor/server";
import type { RiskLevel } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const CorridorMap = lazy(() => import("@/components/transmission/CorridorMap"));

type Tab = "outage" | "ice" | "rating" | "heat" | "crews";
type SourceSel = CorridorSource | "compare";

const SOURCES: { id: SourceSel; label: string; hint: string }[] = [
  { id: "gfs", label: "NOAA GFS", hint: "Public baseline forecast" },
  { id: "aurora", label: "Aurora", hint: "Microsoft Aurora AI forecast" },
  { id: "compare", label: "Compare", hint: "Aurora vs NOAA GFS, line by line" },
  { id: "scenario-ice", label: "Ice storm", hint: "Synthetic demo scenario" },
  { id: "scenario-heat", label: "Heat dome", hint: "Synthetic demo scenario" },
];

const TABS: { id: Tab; label: string; icon: typeof Wind }[] = [
  { id: "outage", label: "Outage risk", icon: Wind },
  { id: "ice", label: "Ice accretion", icon: CloudSnow },
  { id: "rating", label: "Line ratings", icon: Gauge },
  { id: "heat", label: "Heat & load", icon: Thermometer },
  { id: "crews", label: "Crew staging", icon: Truck },
];

const LEVEL_HEX: Record<Level, string> = {
  normal: "#5f7fa6",
  monitor: "#4aa3ff",
  elevated: "#f0b429",
  high: "#ff8a3d",
  critical: "#ff4d5e",
};

const mph = (ms: number) => ms * 2.237;
const inches = (mm: number) => mm / 25.4;
const pct = (x: number) => `${Math.round(x)}%`;
const lvl = (l: Level) => l as RiskLevel;

function hourLabel(iso: string | undefined, h: number): string {
  if (!iso) return `+${h} h`;
  const d = new Date(iso);
  return `${d.toLocaleString(undefined, { weekday: "short", hour: "numeric" })} (+${h} h)`;
}

function lineColor(tab: Tab, x: LineHour | undefined): string {
  if (!x) return LEVEL_HEX.normal;
  switch (tab) {
    case "ice":
      return x.iceMm < 0.5 ? "#5f7fa6" : x.iceMm < 2 ? "#9be7ff" : x.iceMm < 6.35 ? "#4fd1ff" : x.iceMm < 12.7 ? "#7c6cff" : x.iceMm < 19 ? "#c04dff" : "#ff4dd2";
    case "rating":
      return x.dlrPct < 90 ? "#ff4d5e" : x.dlrPct < 100 ? "#ff8a3d" : x.dlrPct < 120 ? "#f0b429" : x.dlrPct < 150 ? "#2fbf71" : "#00d1b2";
    case "heat":
      return x.loadPctOfAar < 70 ? "#5f7fa6" : x.loadPctOfAar < 85 ? "#f0b429" : x.loadPctOfAar < 100 ? "#ff8a3d" : "#ff4d5e";
    default:
      return LEVEL_HEX[levelFromScore(x.faultProb * 100)];
  }
}

function cellStyle(tab: Tab, w: CorridorWeather, i: number, h: number): { color: string; opacity: number } {
  const c = w.cells[i]!;
  const t = c.t2m[h] ?? 0, g = mph(c.gust[h] ?? 0), pr = c.precip[h] ?? 0, t8 = c.t850[h] ?? 0;
  if (tab === "ice") {
    if (pr < 0.2) return { color: "#000", opacity: 0 };
    if (t <= 0.5 && t8 > 0) return { color: "#ff4dd2", opacity: Math.min(0.75, 0.25 + pr / 5) };
    if (t <= 0.5) return { color: "#ffffff", opacity: Math.min(0.6, 0.2 + pr / 6) };
    return { color: "#3b82f6", opacity: Math.min(0.45, 0.1 + pr / 12) };
  }
  if (tab === "rating" || tab === "heat") {
    const hot = Math.min(1, Math.max(0, (t - 10) / 30));
    const color = t < 5 ? "#60a5fa" : t < 25 ? "#f0b429" : t < 33 ? "#ff8a3d" : "#ff4d5e";
    return { color, opacity: tab === "heat" ? 0.15 + 0.45 * hot : 0.18 };
  }
  if (g < 25) return { color: "#000", opacity: 0 };
  const color = g < 40 ? "#f0b429" : g < 55 ? "#ff8a3d" : "#ff4d5e";
  return { color, opacity: Math.min(0.7, ((g - 25) / 40) * 0.7) };
}

export function TransmissionWeatherPage() {
  const [source, setSource] = useState<SourceSel>("gfs");
  const [tab, setTab] = useState<Tab>("outage");
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const primary: CorridorSource = source === "compare" ? "aurora" : source;
  const q = useQuery({
    queryKey: ["corridor-weather", primary],
    queryFn: () => getCorridorWeather({ data: { source: primary } }),
    staleTime: 10 * 60_000,
  });
  const gfsQ = useQuery({
    queryKey: ["corridor-weather", "gfs"],
    queryFn: () => getCorridorWeather({ data: { source: "gfs" } }),
    staleTime: 10 * 60_000,
    enabled: source === "compare",
  });
  const weather = q.data;
  const analysis = useMemo(() => (weather?.available ? analyzeCorridors(weather) : null), [weather]);
  const baseline = useMemo(
    () => (source === "compare" && gfsQ.data?.available ? analyzeCorridors(gfsQ.data) : null),
    [source, gfsQ.data],
  );
  const n = analysis?.hours.length ?? 0;
  const h = Math.min(hour, Math.max(0, n - 1));

  useEffect(() => {
    if (!playing || !n) return;
    const t = window.setInterval(() => setHour((x) => (x + 1) % n), 350);
    return () => window.clearInterval(t);
  }, [playing, n]);

  const fc = useMemo(() => buildFeatures(analysis, weather, tab, h), [analysis, weather, tab, h]);
  const sel = analysis?.lines.find((l) => l.line.id === selected) ?? null;
  const loading = q.isLoading || (source === "compare" && gfsQ.isLoading);

  return (
    <AppShell>
      <PageHeader
        title="Transmission weather"
        description="Corridor-level weather risk for the Southeast 500/230/115 kV network: tree-fall and wind faults, ice loading, dynamic line ratings, heat-driven loading and where to pre-stage crews."
        actions={
          <div className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                title={s.hint}
                onClick={() => setSource(s.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  source === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <SourceBanner weather={weather} loading={loading} compare={source === "compare"} baseline={gfsQ.data} />

        {analysis && <Kpis a={analysis} />}

        <div className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium",
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="relative h-[560px] overflow-hidden rounded-md border bg-card">
              {mounted ? (
                <Suspense fallback={<MapPlaceholder />}>
                  <CorridorMap {...fc} selectedId={selected} onSelect={setSelected} className="absolute inset-0" />
                </Suspense>
              ) : (
                <MapPlaceholder />
              )}
              <Legend tab={tab} />
              {sel && <LineCard r={sel} hour={h} onClose={() => setSelected(null)} hours={analysis?.hours ?? []} />}
            </div>
            {n > 0 && (
              <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="rounded border p-1 text-muted-foreground hover:text-foreground"
                  title={playing ? "Pause" : "Play the forecast"}
                >
                  {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={n - 1}
                  value={h}
                  onChange={(e) => setHour(Number(e.target.value))}
                  className="flex-1 accent-[var(--primary)]"
                />
                <span className="num w-44 text-right text-xs text-muted-foreground">
                  {hourLabel(analysis?.hours[h], h)}
                </span>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            {analysis ? (
              <>
                {source === "compare" && <ComparePanel aurora={analysis} gfs={baseline} />}
                <TabPanel tab={tab} a={analysis} hour={h} onSelect={setSelected} selected={selected} />
              </>
            ) : (
              <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                {loading ? "Loading forecast…" : "No forecast to analyse for this source."}
              </div>
            )}
          </div>
        </div>
        <Method />
      </div>
    </AppShell>
  );
}

function MapPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="label-xs text-muted-foreground">Loading map…</span>
    </div>
  );
}

function buildFeatures(a: CorridorAnalysis | null, w: CorridorWeather | undefined, tab: Tab, h: number) {
  const byId = new Map(a?.lines.map((l) => [l.line.id, l]) ?? []);
  const lines: FeatureCollection = {
    type: "FeatureCollection",
    features: TX_LINES.map((line) => ({
      type: "Feature",
      properties: {
        id: line.id,
        color: lineColor(tab, byId.get(line.id)?.hours[h]),
        width: line.kv === 500 ? 4.5 : line.kv === 230 ? 2.8 : 1.8,
      },
      geometry: { type: "LineString", coordinates: linePath(line) },
    })),
  };
  const substations: FeatureCollection = {
    type: "FeatureCollection",
    features: SUBSTATIONS.map((s) => ({
      type: "Feature",
      properties: { name: s.name, kv: s.kv },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
  const cells: FeatureCollection = {
    type: "FeatureCollection",
    features:
      w?.available && w.cells.length
        ? w.cells.map((c, i): Feature => ({
            type: "Feature",
            properties: cellStyle(tab, w, i, h),
            geometry: { type: "Point", coordinates: [c.lon, c.lat] },
          }))
        : [],
  };
  const depots: FeatureCollection = {
    type: "FeatureCollection",
    features:
      tab === "crews" && a
        ? a.areas.map((p) => ({
            type: "Feature",
            properties: {
              need: p.crewsNeeded,
              color: p.mutualAid > 0 ? "#ff4d5e" : p.crewsNeeded > 0 ? "#f0b429" : "#2fbf71",
              label: p.crewsNeeded > 0 ? `${p.crewsNeeded} crews${p.mutualAid ? ` (+${p.mutualAid} aid)` : ""}` : "",
            },
            geometry: { type: "Point", coordinates: [p.area.depot.lon, p.area.depot.lat] },
          }))
        : [],
  };
  return { lines, substations, cells, depots };
}

function SourceBanner({
  weather,
  loading,
  compare,
  baseline,
}: {
  weather: CorridorWeather | undefined;
  loading: boolean;
  compare: boolean;
  baseline: CorridorWeather | undefined;
}) {
  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Fetching corridor forecast…
      </div>
    );
  if (!weather) return null;
  const scenario = weather.source.startsWith("scenario");
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        !weather.available ? "border-amber-500/40 bg-amber-500/10" : scenario ? "border-violet-500/40 bg-violet-500/10" : "bg-card",
      )}
    >
      <span className="font-semibold">{weather.label}</span>
      {compare && baseline?.available && <span className="font-semibold"> vs {baseline.label}</span>}
      <span className="text-muted-foreground"> · {weather.detail}</span>
      {weather.available && !scenario && (
        <span className="text-muted-foreground"> · issued {new Date(weather.issuedIso).toLocaleString()}</span>
      )}
    </div>
  );
}

function Kpis({ a }: { a: CorridorAnalysis }) {
  const peakIce = Math.max(0, ...a.lines.map((l) => l.peakIce.mm));
  const peakLoad = Math.max(0, ...a.lines.map((l) => l.peakLoad.pct));
  const worst = a.lines.reduce((w, l) => (l.score > w.score ? l : w), a.lines[0]!);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <StatCell label="Lines at risk" value={a.totals.linesAtRisk} sub={`of ${a.lines.length} corridors`} tone={lvl(worst.level)} />
      <StatCell label="Expected faults (5 d)" value={a.totals.expectedFaults.toFixed(1)} sub="wind, tree-fall and ice" tone={lvl(levelFromScore(a.totals.expectedFaults * 12))} />
      <StatCell label="Peak radial ice" value={`${inches(peakIce).toFixed(2)} in`} sub={iceClass(peakIce).label} tone={lvl(iceClass(peakIce).tone)} />
      <StatCell label="DLR uplift vs AAR" value={`${a.totals.dlrUpliftPct >= 0 ? "+" : ""}${Math.round(a.totals.dlrUpliftPct)}%`} sub={`median; ${a.totals.linesBelowAar} lines dip below AAR`} />
      <StatCell label="Peak loading" value={pct(peakLoad)} sub="of ambient-adjusted rating" tone={lvl(levelFromScore(((peakLoad - 70) / 30) * 100))} />
      <StatCell label="Crews to pre-stage" value={a.totals.crewsNeeded} sub={a.totals.mutualAid ? `${a.totals.mutualAid} via mutual aid` : "covered by local crews"} {...(a.totals.mutualAid ? { tone: "high" as const } : {})} />
    </div>
  );
}

function Legend({ tab }: { tab: Tab }) {
  const items: [string, string][] =
    tab === "ice"
      ? [["#5f7fa6", "No ice"], ["#4fd1ff", "< ¼ in"], ["#7c6cff", "¼–½ in"], ["#c04dff", "½–¾ in"], ["#ff4dd2", "≥ ¾ in"]]
      : tab === "rating"
        ? [["#ff4d5e", "< 90% of static"], ["#ff8a3d", "90–100%"], ["#f0b429", "100–120%"], ["#2fbf71", "120–150%"], ["#00d1b2", "> 150%"]]
        : tab === "heat"
          ? [["#5f7fa6", "< 70% of AAR"], ["#f0b429", "70–85%"], ["#ff8a3d", "85–100%"], ["#ff4d5e", "> 100%"]]
          : [["#5f7fa6", "Normal"], ["#4aa3ff", "Monitor"], ["#f0b429", "Elevated"], ["#ff8a3d", "High"], ["#ff4d5e", "Critical"]];
  const cells =
    tab === "ice" ? "Cells: freezing rain (pink), snow (white), rain (blue)" : tab === "rating" || tab === "heat" ? "Cells: air temperature" : "Cells: wind gusts ≥ 25 mph";
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border bg-card/90 px-2.5 py-2 text-[10.5px] backdrop-blur">
      <div className="mb-1 font-semibold">{TABS.find((t) => t.id === tab)?.label}</div>
      {items.map(([c, l]) => (
        <div key={l} className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded" style={{ background: c }} /> {l}
        </div>
      ))}
      <div className="mt-1 text-muted-foreground">{cells}</div>
    </div>
  );
}

function Spark({ values, hour, color, label, unit, fmt }: { values: number[]; hour: number; color: string; label: string; unit: string; fmt: (v: number) => string }) {
  const W = 300, H = 34;
  const max = Math.max(...values, 1e-6), min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div>
      <div className="flex justify-between text-[10.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="num" style={{ color }}>
          {fmt(values[hour] ?? 0)} {unit} <span className="text-muted-foreground">(max {fmt(max)})</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" preserveAspectRatio="none">
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={x(hour)} x2={x(hour)} y1={0} y2={H} stroke="#ffffff55" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function LineCard({ r, hour, hours, onClose }: { r: LineResult; hour: number; hours: string[]; onClose: () => void }) {
  const x = r.hours[hour];
  const c = CONDUCTORS[r.line.conductor];
  return (
    <div className="absolute top-2 right-2 w-[330px] rounded-md border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{r.line.name}</div>
          <div className="text-[10.5px] text-muted-foreground">
            {r.line.bundle > 1 ? `${r.line.bundle}× ` : ""}
            {c.name} · {Math.round(r.lengthKm * 0.621)} mi · vegetation {Math.round(r.line.vegetation * 100)}%
            {r.line.critical ? " · critical path" : ""}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <RiskBadge level={lvl(r.level)} score={r.score} />
        <span className="text-[10.5px] text-muted-foreground">Static rating {Math.round(r.staticA).toLocaleString()} A</span>
      </div>
      <ul className="mb-2 list-disc space-y-0.5 pl-4 text-[11px]">
        {r.drivers.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <div className="space-y-1">
        <Spark values={r.hours.map((v) => mph(v.gustMs))} hour={hour} color="#ff8a3d" label="Max gust on corridor" unit="mph" fmt={(v) => v.toFixed(0)} />
        <Spark values={r.hours.map((v) => inches(v.iceMm))} hour={hour} color="#c04dff" label="Radial ice" unit="in" fmt={(v) => v.toFixed(2)} />
        <Spark values={r.hours.map((v) => v.dlrPct)} hour={hour} color="#2fbf71" label="Dynamic rating" unit="% static" fmt={(v) => v.toFixed(0)} />
        <Spark values={r.hours.map((v) => v.loadPctOfAar)} hour={hour} color="#f0b429" label="Loading" unit="% of AAR" fmt={(v) => v.toFixed(0)} />
        <Spark values={r.hours.map((v) => v.faultProb * 100)} hour={hour} color="#ff4d5e" label="Cumulative fault probability" unit="%" fmt={(v) => v.toFixed(0)} />
      </div>
      {x && (
        <div className="mt-2 border-t pt-1.5 text-[10.5px] text-muted-foreground">
          At {hourLabel(hours[hour], hour)}: DLR {Math.round(x.dlrA).toLocaleString()} A · AAR {Math.round(x.aarA).toLocaleString()} A · {x.minTempC.toFixed(0)}–{x.maxTempC.toFixed(0)} °C
        </div>
      )}
    </div>
  );
}

function Row({ r, selected, onSelect, children }: { r: LineResult; selected: boolean; onSelect: (id: string) => void; children: React.ReactNode }) {
  return (
    <tr
      onClick={() => onSelect(r.line.id)}
      className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40", selected && "bg-primary/10")}
    >
      <td className="py-1.5 pr-2">
        <div className="font-medium">{r.line.name}</div>
        <div className="text-[10px] text-muted-foreground">{SERVICE_AREAS.find((a) => a.id === r.line.area)?.name}</div>
      </td>
      {children}
    </tr>
  );
}

function TabPanel({ tab, a, hour, onSelect, selected }: { tab: Tab; a: CorridorAnalysis; hour: number; onSelect: (id: string) => void; selected: string | null }) {
  const at = (i: number) => hourLabel(a.hours[i], i);
  const th = "py-1.5 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
  const wrap = (title: string, sub: string, body: React.ReactNode) => (
    <div className="flex max-h-[640px] flex-col rounded-md border bg-card">
      <div className="border-b px-3 py-2">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="overflow-auto px-3 py-1 text-xs">{body}</div>
    </div>
  );

  if (tab === "crews") {
    const areas = [...a.areas].sort((x, y) => y.expectedFaults - x.expectedFaults);
    return wrap(
      "Crew pre-staging by service area",
      "Two crews per expected line fault (patrol + repair), keeping 40% of local crews on normal work. Stage 12 hours before the area's peak damage hour.",
      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Area</th>
            <th className={th}>Hazard</th>
            <th className={th}>Exp. faults</th>
            <th className={th}>Peak / stage by</th>
            <th className={th}>Crews</th>
          </tr>
        </thead>
        <tbody>
          {areas.map((p) => (
            <tr key={p.area.id} className="border-b align-top last:border-0">
              <td className="py-1.5 pr-2">
                <div className="font-medium">{p.area.name}</div>
                <div className="text-[10px] text-muted-foreground">{p.area.depot.name}</div>
                {p.linesAtRisk.slice(0, 3).map((l) => (
                  <button key={l.id} onClick={() => onSelect(l.id)} className="block text-left text-[10px] text-primary hover:underline">
                    {l.name} · {Math.round(l.prob * 100)}%
                  </button>
                ))}
              </td>
              <td className="py-1.5 pr-2 capitalize">{p.primaryHazard === "none" ? "—" : p.primaryHazard}</td>
              <td className="num py-1.5 pr-2">{p.expectedFaults.toFixed(1)}</td>
              <td className="py-1.5 pr-2 text-[11px]">
                {p.peakHour === null ? "—" : (
                  <>
                    <div>{at(p.peakHour)}</div>
                    <div className="text-muted-foreground">stage by {at(p.stageByHour ?? 0)}</div>
                  </>
                )}
              </td>
              <td className="py-1.5 pr-2">
                <span className="num font-semibold">{p.crewsNeeded}</span>
                <span className="text-muted-foreground"> / {p.crewsAvailable} local</span>
                {p.mutualAid > 0 && <div className="text-[10.5px] font-semibold text-[#ff4d5e]">+{p.mutualAid} mutual aid</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>,
    );
  }

  const sorted = [...a.lines].sort((x, y) =>
    tab === "ice" ? y.peakIce.mm - x.peakIce.mm : tab === "rating" ? x.minDlr.pct - y.minDlr.pct : tab === "heat" ? y.peakLoad.pct - x.peakLoad.pct : y.faultProb - x.faultProb,
  );

  if (tab === "ice")
    return wrap(
      "Ice accretion by corridor",
      "Radial ice from freezing rain (sub-freezing surface under a warm layer aloft), CRREL simple model. ¼ in triggers an NWS ice storm warning; ½ in brings down limbs and conductors.",
      <table className="w-full">
        <thead><tr><th className={th}>Line</th><th className={th}>Peak ice</th><th className={th}>Class</th><th className={th}>Now</th></tr></thead>
        <tbody>
          {sorted.map((r) => (
            <Row key={r.line.id} r={r} selected={selected === r.line.id} onSelect={onSelect}>
              <td className="num py-1.5 pr-2">{inches(r.peakIce.mm).toFixed(2)} in<div className="text-[10px] text-muted-foreground">{r.peakIce.mm > 0.5 ? at(r.peakIce.hour) : ""}</div></td>
              <td className="py-1.5 pr-2"><RiskBadge level={lvl(iceClass(r.peakIce.mm).tone)} /></td>
              <td className="num py-1.5 pr-2">{inches(r.hours[hour]?.iceMm ?? 0).toFixed(2)}{r.hours[hour]?.freezingRain ? " ❄" : ""}</td>
            </Row>
          ))}
        </tbody>
      </table>,
    );

  if (tab === "rating")
    return wrap(
      "Line ratings: static vs ambient-adjusted vs dynamic",
      "IEEE 738 at each corridor point, limited by the weakest span. AAR (FERC Order 881) uses forecast temperature and day/night sun with an assumed 2 ft/s crosswind; DLR also uses forecast wind speed and its angle to the conductor.",
      <table className="w-full">
        <thead><tr><th className={th}>Line</th><th className={th}>Static</th><th className={th}>AAR now</th><th className={th}>DLR now</th><th className={th}>5-day range</th></tr></thead>
        <tbody>
          {sorted.map((r) => {
            const x = r.hours[hour];
            const below = x && x.dlrA < x.aarA;
            return (
              <Row key={r.line.id} r={r} selected={selected === r.line.id} onSelect={onSelect}>
                <td className="num py-1.5 pr-2">{Math.round(r.staticA).toLocaleString()} A</td>
                <td className="num py-1.5 pr-2">{pct(x?.aarPct ?? 0)}</td>
                <td className={cn("num py-1.5 pr-2 font-semibold", below ? "text-[#ff8a3d]" : "text-[#2fbf71]")}>{pct(x?.dlrPct ?? 0)}</td>
                <td className="num py-1.5 pr-2 text-[11px]">{pct(r.minDlr.pct)}–{pct(r.maxDlr.pct)}<div className="text-[10px] text-muted-foreground">low {at(r.minDlr.hour)}</div></td>
              </Row>
            );
          })}
        </tbody>
      </table>,
    );

  if (tab === "heat")
    return wrap(
      "Heat-driven loading vs ambient-adjusted rating",
      "Temperature-driven load forecast (cooling above 24 °C, heating below 8 °C, afternoon peak) against the rating at the forecast temperature. Above 100% the line needs re-dispatch or a dynamic rating.",
      <table className="w-full">
        <thead><tr><th className={th}>Line</th><th className={th}>Peak load</th><th className={th}>When</th><th className={th}>DLR then</th></tr></thead>
        <tbody>
          {sorted.map((r) => (
            <Row key={r.line.id} r={r} selected={selected === r.line.id} onSelect={onSelect}>
              <td className={cn("num py-1.5 pr-2 font-semibold", r.peakLoad.pct >= 100 ? "text-[#ff4d5e]" : r.peakLoad.pct >= 85 ? "text-[#ff8a3d]" : "")}>{pct(r.peakLoad.pct)}</td>
              <td className="py-1.5 pr-2 text-[11px]">{at(r.peakLoad.hour)}</td>
              <td className="num py-1.5 pr-2">{pct(r.hours[r.peakLoad.hour]?.dlrPct ?? 0)} of static</td>
            </Row>
          ))}
        </tbody>
      </table>,
    );

  return wrap(
    "Wind & tree-fall outage risk",
    "Probability each line faults over the next 5 days: gust fragility × corridor vegetation, raised by saturated soil and ice-laden trees.",
    <table className="w-full">
      <thead><tr><th className={th}>Line</th><th className={th}>Risk</th><th className={th}>Fault prob.</th><th className={th}>Peak gust</th></tr></thead>
      <tbody>
        {sorted.map((r) => (
          <Row key={r.line.id} r={r} selected={selected === r.line.id} onSelect={onSelect}>
            <td className="py-1.5 pr-2"><RiskBadge level={lvl(levelFromScore(r.scores.wind))} /></td>
            <td className="num py-1.5 pr-2 font-semibold">{pct(r.faultProb * 100)}</td>
            <td className="num py-1.5 pr-2">{Math.round(mph(r.peakGust.ms))} mph<div className="text-[10px] text-muted-foreground">{at(r.peakGust.hour)}</div></td>
          </Row>
        ))}
      </tbody>
    </table>,
  );
}

function ComparePanel({ aurora, gfs }: { aurora: CorridorAnalysis; gfs: CorridorAnalysis | null }) {
  if (!gfs) return null;
  const g = new Map(gfs.lines.map((l) => [l.line.id, l]));
  const rows = aurora.lines
    .map((l) => {
      const b = g.get(l.line.id)!;
      return {
        l,
        dGust: mph(l.peakGust.ms) - mph(b.peakGust.ms),
        dIce: inches(l.peakIce.mm) - inches(b.peakIce.mm),
        dDlr: l.minDlr.pct - b.minDlr.pct,
        dP: (l.faultProb - b.faultProb) * 100,
        b,
      };
    })
    .sort((x, y) => Math.abs(y.dGust) + Math.abs(y.dDlr) / 3 + Math.abs(y.dP) - (Math.abs(x.dGust) + Math.abs(x.dDlr) / 3 + Math.abs(x.dP)))
    .slice(0, 8);
  const sign = (v: number, d = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
  return (
    <div className="rounded-md border border-primary/40 bg-card">
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold"><Zap className="size-3.5 text-primary" /> Aurora vs NOAA GFS</div>
        <div className="text-[11px] text-muted-foreground">
          Expected faults {aurora.totals.expectedFaults.toFixed(1)} vs {gfs.totals.expectedFaults.toFixed(1)} · crews {aurora.totals.crewsNeeded} vs {gfs.totals.crewsNeeded} · median DLR uplift {Math.round(aurora.totals.dlrUpliftPct)}% vs {Math.round(gfs.totals.dlrUpliftPct)}%. Largest line-level differences:
        </div>
      </div>
      <table className="w-full px-3 text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-1 text-left">Line</th><th className="py-1 text-left">Δ gust</th><th className="py-1 text-left">Δ ice</th><th className="py-1 text-left">Δ min DLR</th><th className="py-1 text-left">Δ fault</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.l.line.id} className="border-t">
              <td className="px-3 py-1">{r.l.line.name}</td>
              <td className="num py-1">{sign(r.dGust)} mph</td>
              <td className="num py-1">{sign(r.dIce, 2)} in</td>
              <td className="num py-1">{sign(r.dDlr)} pts</td>
              <td className="num py-1">{sign(r.dP)} pts</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Method() {
  return (
    <details className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">How these numbers are produced</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>Weather is taken at every 0.25° grid cell the corridors cross (the native GFS and Aurora resolution, about 28 km) and applied to sample points every ~12 km along each line.</li>
        <li><b>Outage risk:</b> a gust fragility curve (no faults below 40 mph gusts; steep above ~60 mph) scaled by corridor vegetation, ×1.4 when 48-hour rain exceeds 40 mm (saturated soil), with lower thresholds for ice-laden trees and a separate ice-load failure term above ¼ in.</li>
        <li><b>Ice:</b> CRREL simple freezing-rain model (Jones, 1998) whenever the surface is at or below 0.5 °C with a warm layer (&gt; 0 °C) at 850 hPa; ice melts off above 1 °C.</li>
        <li><b>Ratings:</b> IEEE 738 steady-state heat balance per point at the conductor's maximum operating temperature; the line rating is its weakest point. Static rating assumes 40 °C, 2 ft/s crosswind and full sun.</li>
        <li><b>Aurora:</b> Aurora forecasts temperature, wind and the 850 hPa profile; precipitation, the gust-to-wind ratio and sunshine come from GFS at the same time because Aurora does not predict them.</li>
        <li>The network, its loadings and crew counts are synthetic. Calibrate the fragility curves against the utility's own outage history before operational use.</li>
      </ul>
    </details>
  );
}
