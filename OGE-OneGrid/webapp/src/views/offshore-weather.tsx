import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { ChevronDown, ExternalLink, Loader2, Pause, Play, Radio, Sparkles } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { getOffshoreWeather } from "@/lib/services/offshore/server";
import { OFFSHORE_SITES, SITE_BY_ID, frontArrival, frontLine, type OffshoreSource, type OffshoreWeather } from "@/lib/services/offshore/sites";
import { OPERATIONS, OP_BY_ID, analyze, changedDecisions, sitesStopped, type ChangedDecision, type Go, type OffshoreAnalysis } from "@/lib/services/offshore/engine";
import { cn } from "@/lib/utils";

const OffshoreMap = lazy(() => import("@/components/offshore/OffshoreMap"));

type View = "compare" | "live";
const GO_HEX: Record<Go, string> = { go: "#2fbf71", marginal: "#f0b429", stop: "#ff4d5e" };
const GO_LABEL: Record<Go, string> = { go: "Go", marginal: "Near limit", stop: "Stop" };
const AURORA_HEX = "#7dd3fc";
const NOAA_HEX = "#94a3b8";
const NATURE_URL = "https://www.nature.com/articles/s41586-025-09005-y";
const MSR_URL = "https://www.microsoft.com/en-us/research/blog/introducing-aurora-the-first-large-scale-foundation-model-of-the-atmosphere/";

const CT = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago" });
const when = (hours: string[], h: number | null) => (h === null || !hours[h] ? "–" : `${CT.format(new Date(hours[h]!))} CT`);

const ACTION: Record<string, string> = {
  riser: "Start pulling the riser",
  heli: "Fly the crew change",
  supply: "Finish the supply offload",
  crane: "Finish crane lifts",
  transfer: "Finish boat transfers",
};

export function OffshoreWeatherPage() {
  const [view, setView] = useState<View>("compare");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const compare = view === "compare";
  const q = (source: OffshoreSource, enabled: boolean) => ({
    queryKey: ["offshore-weather", source],
    queryFn: () => getOffshoreWeather({ data: { source } }),
    staleTime: 10 * 60_000,
    enabled,
  });
  const auroraQ = useQuery(q("aurora", compare));
  const gfsQ = useQuery(q("gfs", compare));
  const liveQ = useQuery(q("live", !compare));
  const primary: OffshoreWeather | undefined = compare ? auroraQ.data : liveQ.data;
  const loading = compare ? auroraQ.isLoading || gfsQ.isLoading : liveQ.isLoading;

  const a = useMemo(() => (primary?.available ? analyze(primary) : null), [primary]);
  const g = useMemo(() => (compare && gfsQ.data?.available ? analyze(gfsQ.data) : null), [compare, gfsQ.data]);
  const decisions = useMemo<ChangedDecision[]>(() => {
    if (!a) return [];
    if (g) return changedDecisions(a, g);
    return a.windows
      .filter((w) => w.firstStop !== null)
      .map((w) => {
        const act = Math.max(0, w.firstStop! - OP_BY_ID.get(w.opId)!.leadH);
        return { siteId: w.siteId, opId: w.opId, aurora: act, baseline: null, leadH: 0 };
      })
      .sort((x, y) => x.aurora! - y.aurora!);
  }, [a, g]);

  const titan = SITE_BY_ID.get("PLT-T1")!;
  const [hour, setHour] = useState(0);
  const [site, setSite] = useState<string>("RIG-N5");
  const [playing, setPlaying] = useState(false);
  // Open on the moment that matters: the Aurora front reaching the biggest platform.
  useEffect(() => {
    setPlaying(false);
    setHour(compare ? Math.round(frontArrival("aurora", titan)) : 0);
  }, [compare, titan]);
  const nHours = a?.hours.length ?? 0;
  useEffect(() => {
    if (!playing) return;
    if (hour >= nHours - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setHour((h) => h + 1), 140);
    return () => window.clearTimeout(t);
  }, [playing, hour, nHours]);

  const sitesFc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: OFFSHORE_SITES.map((s) => {
        const st = a?.siteStatus.get(s.id)?.[hour] ?? "go";
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { id: s.id, label: s.short, kind: s.kind, color: GO_HEX[st] },
        };
      }),
    }),
    [a, hour],
  );
  const frontsFc = useMemo<FeatureCollection>(() => {
    const features: FeatureCollection["features"] = [];
    if (compare && a) {
      for (const [model, color, label] of [
        ["gfs", NOAA_HEX, "NOAA front"],
        ["aurora", AURORA_HEX, "Aurora front"],
      ] as const) {
        const line = frontLine(model, hour);
        if (line) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { color, label } });
      }
    }
    return { type: "FeatureCollection", features };
  }, [compare, a, hour]);

  const pick = (d: ChangedDecision) => {
    setSite(d.siteId);
    if (d.aurora !== null) setHour(d.aurora);
  };

  return (
    <AppShell>
      <PageHeader
        title="Offshore weather"
        description="Wind and seas at every platform, the drillship and the supply base: when each marine operation's weather window closes, and what to do before it does."
        actions={
          <div className="flex gap-1 rounded-md border bg-card p-1">
            {(
              [
                ["compare", "Aurora vs NOAA", Sparkles],
                ["live", "Live NOAA", Radio],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" /> {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <SourceLine weather={primary} loading={loading} compare={compare} />

        {compare && a && g && <OpsPlan a={a} g={g} decisions={decisions} />}
        {!compare && a && <LiveSummary a={a} />}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="relative h-[460px] overflow-hidden rounded-md border bg-card">
              {mounted ? (
                <Suspense fallback={<MapPlaceholder />}>
                  <OffshoreMap sites={sitesFc} fronts={frontsFc} selectedId={site} onSelect={(id) => id && setSite(id)} className="absolute inset-0" />
                </Suspense>
              ) : (
                <MapPlaceholder />
              )}
              <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md border bg-card/90 px-2 py-1 text-[10.5px] backdrop-blur">
                {(["go", "marginal", "stop"] as Go[]).map((k) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: GO_HEX[k] }} /> {GO_LABEL[k]}
                  </span>
                ))}
                {compare && (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="h-0.5 w-3" style={{ background: AURORA_HEX }} /> Aurora front
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-0.5 w-3" style={{ background: NOAA_HEX }} /> NOAA front
                    </span>
                  </>
                )}
              </div>
            </div>
            {a && (
              <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs">
                <button
                  onClick={() => {
                    if (hour >= nHours - 1) setHour(0);
                    setPlaying((p) => !p);
                  }}
                  className="flex items-center gap-1 rounded border px-2 py-0.5 text-muted-foreground hover:text-foreground"
                >
                  {playing ? <Pause className="size-3" /> : <Play className="size-3" />} {playing ? "Pause" : "Play"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, nHours - 1)}
                  value={hour}
                  onChange={(e) => {
                    setPlaying(false);
                    setHour(Number(e.target.value));
                  }}
                  className="flex-1 accent-[var(--primary)]"
                  aria-label="Forecast hour"
                />
                <span className="num w-[150px] text-right font-medium">
                  {when(a.hours, hour)} <span className="text-muted-foreground">+{hour} h</span>
                </span>
              </div>
            )}
          </div>

          <Decisions decisions={decisions} hours={a?.hours ?? []} compare={compare} selected={site} onPick={pick} />
        </div>

        {a && <SiteWindows siteId={site} a={a} g={g} hour={hour} onHour={setHour} />}
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

function SourceLine({ weather, loading, compare }: { weather: OffshoreWeather | undefined; loading: boolean; compare: boolean }) {
  const [more, setMore] = useState(false);
  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Fetching offshore forecast…
      </div>
    );
  if (!weather) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {weather.synthetic && (
          <span className="rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">Synthetic</span>
        )}
        <span className="font-medium">
          {compare ? "Both forecasts are synthetic runs of the same cold front, not measured model performance." : weather.label}
        </span>
        {!weather.synthetic && weather.available && <span className="text-muted-foreground">issued {new Date(weather.issuedIso).toLocaleString()}</span>}
        <button onClick={() => setMore((m) => !m)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {more ? "Less" : "Details"}
        </button>
      </div>
      {more && (
        <p className="mt-1 text-muted-foreground">
          {compare
            ? "A November norther crossing the Gulf, generated until a real Aurora marine run is published. The runs differ the way forecasters often see the models differ: GFS brings the front about 6 hours later and its northerly surge and seas about 15–20% lower. Use it to show how a forecast difference becomes a different operations decision. "
            : `${weather.detail} `}
          Operating limits are illustrative; real limits come from each asset&apos;s marine operations manual. Gusts are wind × 1.3 in the synthetic runs.
        </p>
      )}
    </div>
  );
}

/** Aurora vs NOAA headline: what changes in the operations plan. */
function OpsPlan({ a, g, decisions }: { a: OffshoreAnalysis; g: OffshoreAnalysis; decisions: ChangedDecision[] }) {
  const [why, setWhy] = useState(false);
  const titan = SITE_BY_ID.get("PLT-T1")!;
  const fa = Math.round(frontArrival("aurora", titan));
  const fg = Math.round(frontArrival("gfs", titan));
  const riser = decisions.find((d) => d.opId === "riser");
  const stats: { label: string; noaa: string; aurora: string; note?: string }[] = [
    { label: "Front reaches Titan-1", noaa: when(g.hours, fg), aurora: when(a.hours, fa), note: `${fg - fa} h earlier` },
    { label: "Peak seas", noaa: `${g.peak.hs.toFixed(1)} m`, aurora: `${a.peak.hs.toFixed(1)} m` },
    { label: "Sites grounding helicopters", noaa: `${sitesStopped(g, "heli")}`, aurora: `${sitesStopped(a, "heli")}` },
  ];
  if (riser) stats.push({ label: "Start pulling riser, Nautilus-5", noaa: when(g.hours, riser.baseline), aurora: when(a.hours, riser.aurora) });
  return (
    <div className="rounded-md border border-primary/40 bg-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2">
        <div className="min-w-[180px]">
          <div className="text-sm font-semibold">What changes in the operations plan</div>
          <div className="text-[11px] text-muted-foreground">NOAA GFS → Microsoft Aurora, same front, same limits</div>
        </div>
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="num text-base">
              <span className="text-muted-foreground">{s.noaa}</span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className="font-semibold text-primary">{s.aurora}</span>
              {s.note && <span className="ml-1 text-[11px] text-muted-foreground">{s.note}</span>}
            </div>
          </div>
        ))}
        <button
          onClick={() => setWhy((w) => !w)}
          className="ml-auto flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Why Aurora? <ChevronDown className={cn("size-3 transition-transform", why && "rotate-180")} />
        </button>
      </div>
      {why && <AboutAurora />}
    </div>
  );
}

function AboutAurora() {
  const pillars: [string, string][] = [
    ["86% of targets", "where Aurora's 10-day ocean-wave forecast beat ECMWF's HRES-WAM, the operational wave model."],
    ["92% of targets", "where Aurora's 10-day weather forecast beat ECMWF HRES. Its 5-day hurricane tracks beat 7 operational centres."],
    ["~5,000× faster", "than ECMWF's IFS. A run takes minutes on one GPU, so you can rerun as each new analysis arrives."],
    ["Runs in your tenant", "over the Gulf, on your schedule. Results land in Fabric beside the asset model."],
  ];
  return (
    <div className="border-t px-3 py-2 text-[11.5px]">
      <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
        {pillars.map(([h, b]) => (
          <div key={h}>
            <span className="font-semibold text-primary">{h}</span> <span className="text-muted-foreground">{b}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] text-muted-foreground">
        Published benchmarks are against ECMWF and operational centres, not this demo. The 0.25° model does not forecast gusts; they come from GFS or a gust factor.{" "}
        <a href={NATURE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
          Nature 2025 <ExternalLink className="size-2.5" />
        </a>{" "}
        ·{" "}
        <a href={MSR_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
          Microsoft Research <ExternalLink className="size-2.5" />
        </a>
      </div>
    </div>
  );
}

function LiveSummary({ a }: { a: OffshoreAnalysis }) {
  const stopped = a.windows.filter((w) => w.firstStop !== null).length;
  const cells: [string, string, string | undefined][] = [
    ["Peak seas", `${a.peak.hs.toFixed(1)} m`, SITE_BY_ID.get(a.peak.hsSite)?.short],
    ["Peak gust", `${Math.round(a.peak.gust)} kt`, SITE_BY_ID.get(a.peak.gustSite)?.short],
    ["Operations that must stop", `${stopped}`, `of ${a.windows.length} this week`],
  ];
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border bg-card px-3 py-2">
      {cells.map(([label, value, sub]) => (
        <div key={label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="num text-lg font-semibold">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Decisions({
  decisions,
  hours,
  compare,
  selected,
  onPick,
}: {
  decisions: ChangedDecision[];
  hours: string[];
  compare: boolean;
  selected: string;
  onPick: (d: ChangedDecision) => void;
}) {
  // One card per operation: the sites it affects, and the earliest time to act.
  const groups = OPERATIONS.map((op) => {
    const items = decisions.filter((d) => d.opId === op.id).sort((x, y) => (x.aurora ?? 1e9) - (y.aurora ?? 1e9));
    const base = items.map((d) => d.baseline).filter((b): b is number => b !== null);
    const missed = items.filter((d) => d.baseline === null).length;
    const finite = items.map((d) => d.leadH).filter((l) => Number.isFinite(l) && l > 0);
    const badge = missed === items.length ? "NOAA misses it" : finite.length ? `${finite.length > 1 ? "up to " : ""}${Math.max(...finite)} h earlier` : missed ? `NOAA misses ${missed} sites` : "";
    return { op, items, first: items[0], noaa: base.length ? Math.min(...base) : null, badge };
  }).filter((g) => g.first);
  return (
    <div className="flex flex-col rounded-md border bg-card">
      <div className="flex items-baseline justify-between px-3 pt-2">
        <span className="text-sm font-semibold">{compare ? "Decisions that change with Aurora" : "Weather windows closing"}</span>
        <span className="text-[11px] text-muted-foreground">click a site to see it on the map</span>
      </div>
      {groups.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">All operations can run through the forecast.</div>}
      <div className="flex flex-col gap-1.5 p-2">
        {groups.map(({ op, items, first, noaa, badge }) => (
          <div
            key={op.id}
            onClick={() => onPick(first!)}
            className={cn("cursor-pointer rounded border px-2.5 py-1.5 text-xs hover:bg-muted/40", items.some((d) => d.siteId === selected) && "border-primary/60 bg-muted/30")}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">{op.label}</span>
              <span className="text-muted-foreground">
                · {items.length} site{items.length > 1 ? "s" : ""}
              </span>
              {compare && badge && <span className="ml-auto rounded border border-primary/50 px-1.5 text-[10px] font-semibold text-primary">{badge}</span>}
            </div>
            <div className="mt-0.5">
              {ACTION[op.id]} {op.id === "riser" ? "by" : "before"} <span className="num font-medium text-primary">{when(hours, first!.aurora)}</span>
              {compare && <span className="text-muted-foreground"> · NOAA plan: {noaa === null ? "no stop this week" : when(hours, noaa)}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {items.map((d) => (
                <button
                  key={d.siteId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(d);
                  }}
                  title={`${when(hours, d.aurora)}${compare ? ` · NOAA: ${d.baseline === null ? "no stop" : when(hours, d.baseline)}` : ""}`}
                  className={cn("rounded border px-1.5 text-[10.5px] hover:border-primary/60", selected === d.siteId ? "border-primary/70 text-foreground" : "text-muted-foreground")}
                >
                  {SITE_BY_ID.get(d.siteId)!.short}
                </button>
              ))}
              <span className="ml-auto text-[10.5px] text-muted-foreground">Limit: {op.limitText}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hour-by-hour go/stop strips for every operation at one site; Aurora above NOAA when comparing. */
function SiteWindows({ siteId, a, g, hour, onHour }: { siteId: string; a: OffshoreAnalysis; g: OffshoreAnalysis | null; hour: number; onHour: (h: number) => void }) {
  const s = SITE_BY_ID.get(siteId)!;
  const ops = OPERATIONS.filter((o) => o.applies(s));
  const n = a.hours.length;
  const days = a.hours.map((iso, h) => ({ h, iso })).filter(({ iso }) => CT.format(new Date(iso)).endsWith("00:00"));
  const Strip = ({ status, label, color }: { status: Go[]; label: string; color: string }) => (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-right text-[10px] font-semibold" style={{ color }}>
        {label}
      </span>
      <div className="relative flex h-3 flex-1 overflow-hidden rounded-sm">
        {status.map((st, h) => (
          <div key={h} onClick={() => onHour(h)} className="h-full flex-1 cursor-pointer" style={{ background: GO_HEX[st], opacity: st === "go" ? 0.45 : 0.9 }} />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(hour / n) * 100}%` }} />
      </div>
    </div>
  );
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">{s.name}</span>
        {s.pob > 0 && <span className="text-muted-foreground">{s.pob} people on board</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">Weather windows, next {Math.round(n / 24)} days · click a strip to move the map</span>
      </div>
      {ops.length === 0 && <div className="mt-1 text-muted-foreground">Supply base: no offshore operations limits. Vessels sail from here.</div>}
      <div className="mt-1.5 flex flex-col gap-2">
        {ops.map((op) => {
          const wa = a.windows.find((w) => w.siteId === siteId && w.opId === op.id)!;
          const wg = g?.windows.find((w) => w.siteId === siteId && w.opId === op.id);
          return (
            <div key={op.id}>
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="font-medium">{op.label}</span>
                <span className="text-[10.5px] text-muted-foreground">{op.limitText}</span>
              </div>
              <Strip status={wa.status} label={g ? "Aurora" : "NOAA"} color={g ? AURORA_HEX : NOAA_HEX} />
              {wg && <Strip status={wg.status} label="NOAA" color={NOAA_HEX} />}
            </div>
          );
        })}
      </div>
      <div className="relative ml-14 mt-1 h-3 text-[9.5px] text-muted-foreground">
        {days.map(({ h, iso }) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / n) * 100}%` }}>
            {CT.format(new Date(iso)).slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  );
}
