import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/ops/AppShell";
import { MapModeSwitch } from "@/components/ops/MapModeSwitch";
import { PageLoading } from "@/components/ops/PageLoading";
import { RiskBadge } from "@/components/ops/RiskBadge";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { assetsQuery, eventsQuery } from "@/lib/hooks/use-ops-data";
import { scoreAsset } from "@/lib/services/risk-engine";
import { coords, riskColorVar } from "@/lib/format";
import type { Asset, WeatherEvent } from "@/lib/domain/types";

const STOPS = [24, 48, 72, 120];

/** Pill dot colour by storm severity. */
function stormDot(e: WeatherEvent): string {
  if (e.currentCategory >= 3) return "#ff5470";
  if (e.currentCategory >= 1) return "#ff8c42";
  return "#38bdf8";
}

/**
 * Forecast Timeline — the merged weather page. On land the map auto-plays the
 * forecast forward (the storms advance along their tracks); a play/scrub control
 * lives on the map. Below it, two collapsible panels: storm info (open by
 * default) and the forecast timeline detail (exposure strip + per-hour grid,
 * collapsed by default — expand when you want it). The page scrolls.
 */
export function EventsPage() {
  const base = useOpsBase();
  const assetsQ = useQuery(assetsQuery(base));
  const eventsQ = useQuery(eventsQuery(base));
  const assets = assetsQ.data ?? [];
  const events = eventsQ.data ?? [];
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [stormOpen, setStormOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(true); // auto-play forward on page land
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Storms ordered by significance (category, then wind) so the pills read
  // strongest-first and the default selection is the most consequential system.
  const ordered = useMemo(
    () =>
      [...events].sort(
        (a, b) => b.currentCategory - a.currentCategory || b.currentWindMph - a.currentWindMph,
      ),
    [events],
  );
  const event = ordered.find((e) => e.id === selectedEventId) ?? ordered[0];

  // Highest exposure across ALL systems (an asset is exposed if ANY storm threatens
  // it) at a given hour — the map plays all storms forward together.
  const scoreAcross = useMemo(
    () => (a: Asset, h: number) => {
      let best = scoreAsset(a, events[0]!, Math.max(6, h));
      for (let i = 1; i < events.length; i++) {
        const r = scoreAsset(a, events[i]!, Math.max(6, h));
        if (r.score > best.score) best = r;
      }
      return best;
    },
    [events],
  );
  const timelineRisks = useMemo(
    () => (events.length ? assets.map((a) => scoreAcross(a, hour)) : []),
    [assets, events, hour, scoreAcross],
  );
  const riskMap = useMemo(() => new Map(timelineRisks.map((r) => [r.assetId, r])), [timelineRisks]);

  // Affected count for the SELECTED storm (header stat).
  const affectedCount = useMemo(
    () =>
      event
        ? assets.filter((a) => scoreAsset(a, event, 120).score >= 42).length
        : 0,
    [assets, event],
  );

  const series = useMemo(() => {
    if (!events.length) return [];
    return Array.from({ length: 21 }, (_, i) => {
      const h = i * 6;
      const scored = assets.filter((a) => a.type !== "well").map((a) => scoreAcross(a, h));
      return {
        hour: h,
        exposed: scored.filter((r) => r.score >= 42 && (r.hoursToImpact ?? 999) <= h).length,
        critical: scored.filter((r) => r.level === "critical" && (r.hoursToImpact ?? 999) <= h)
          .length,
      };
    });
  }, [assets, events, scoreAcross]);
  const maxExposed = Math.max(1, ...series.map((s) => s.exposed));

  // Playhead: auto-advances while `playing`. Loops the 120 h horizon.
  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => setHour((h) => (h >= 120 ? 0 : h + 3)), 220);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const exposedNow = useMemo(
    () =>
      [...timelineRisks]
        .filter((r) => (r.hoursToImpact ?? 999) <= hour)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20),
    [timelineRisks, hour],
  );
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  if ((assetsQ.isLoading && !assets.length) || (eventsQ.isLoading && !events.length)) {
    return (
      <AppShell>
        <PageLoading label="Loading forecast & exposure…" />
      </AppShell>
    );
  }

  if (!event) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <div className="max-w-sm rounded-sm border bg-background/90 px-4 py-3 text-center">
            <h2 className="text-sm font-semibold">No active weather events</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              New systems and exposed assets will appear automatically when the forecast provider
              updates.
            </p>
            {assets.length === 0 && (
              <OpsLink
                to="/"
                className="mt-2 inline-flex text-[11px] font-medium text-primary hover:underline"
              >
                Add operational data
              </OpsLink>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        {/* storm selector pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-xs mr-1">Active systems</span>
          {ordered.map((e) => {
            const active = e.id === event.id;
            return (
              <button
                key={e.id}
                onClick={() => setSelectedEventId(e.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary/10 font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: stormDot(e) }} />
                {e.name}
                <span className="text-[10px] text-muted-foreground">
                  {e.currentCategory > 0 ? `Cat ${e.currentCategory}` : `${e.currentWindMph} mph`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {/* storm info (collapsible, open by default) */}
            <div className="panel">
              <button
                onClick={() => setStormOpen((o) => !o)}
                aria-expanded={stormOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/40"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{event.name}</span>
                  <span className="rounded-sm border border-risk-critical/40 bg-risk-critical/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-risk-critical uppercase">
                    {event.status}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {event.currentCategory > 0
                      ? `Category ${event.currentCategory}`
                      : "Tropical storm"}{" "}
                    · {event.currentWindMph} mph · {affectedCount} affected
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${stormOpen ? "rotate-180" : ""}`}
                />
              </button>
              {stormOpen && (
                <div className="grid grid-cols-2 border-t sm:grid-cols-4">
                  {(
                    [
                      ["Current position", coords(event.lat, event.lon)],
                      ["Sustained wind", `${event.currentWindMph} mph`],
                      ["Gusts", `${event.gustMph} mph`],
                      ["Minimum pressure", `${event.pressureMb} mb`],
                      ["Movement", `${event.movementDeg}° at ${event.movementMph} mph`],
                      ["Category", `Category ${event.currentCategory}`],
                      ["Expected landfall", event.expectedLandfall],
                      ["Forecast confidence", event.confidence],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="px-4 py-2.5">
                      <div className="label-xs">{label}</div>
                      <div className="num mt-1 text-xs capitalize">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* map — auto-playing the forecast forward, with an inline play/scrub */}
            <div className="panel overflow-hidden">
              <div className="relative h-[46vh] min-h-[340px]">
                <MapModeSwitch
                  className="h-full w-full"
                  assets={assets}
                  risks={riskMap}
                  event={event}
                  events={events}
                  initialFocusEventId={event.id}
                  hour={hour}
                  layers={{ assets: true, track: true, wind: true }}
                  selectedId={selected}
                  onSelect={setSelected}
                />
                <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-popover/90 px-3 py-1.5 shadow-lg backdrop-blur">
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    className="inline-flex items-center gap-1.5 text-xs hover:text-primary"
                    aria-label={playing ? "Pause forecast" : "Play forecast"}
                  >
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={3}
                    value={hour}
                    onChange={(e) => {
                      setPlaying(false);
                      setHour(Number(e.target.value));
                    }}
                    className="h-1 w-36 accent-[var(--color-primary)] sm:w-52"
                    aria-label="Forecast hour"
                  />
                  <span className="num w-14 text-right text-xs font-semibold">+{hour} h</span>
                </div>
              </div>
            </div>

            {/* forecast timeline detail (collapsible, closed by default) */}
            <div className="panel">
              <button
                onClick={() => setTimelineOpen((o) => !o)}
                aria-expanded={timelineOpen}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-accent/40"
              >
                <span className="label-xs">Forecast timeline detail</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  peak {maxExposed} exposed · {event.forecast.length} steps
                  <ChevronDown
                    className={`size-4 transition-transform ${timelineOpen ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {timelineOpen && (
                <div className="space-y-2 border-t p-3">
                  {/* jump stops */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="label-xs">Jump to</span>
                    {STOPS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setPlaying(false);
                          setHour(s);
                        }}
                        className={`rounded-sm border px-2 py-1 text-[11px] ${hour === s ? "bg-accent" : "hover:bg-accent/60"}`}
                      >
                        {s}h
                      </button>
                    ))}
                  </div>
                  {/* compact exposure strip */}
                  <div className="flex items-center justify-between">
                    <span className="label-xs">Exposure over horizon · peak {maxExposed}</span>
                    <span className="text-[10px] text-muted-foreground">click to jump</span>
                  </div>
                  <div className="flex h-14 items-end gap-1">
                    {series.map((s) => (
                      <button
                        key={s.hour}
                        onClick={() => {
                          setPlaying(false);
                          setHour(s.hour);
                        }}
                        className="flex h-full flex-1 items-end"
                        title={`+${s.hour} h — ${s.exposed} exposed`}
                      >
                        <div
                          className="w-full rounded-t-sm transition-opacity"
                          style={{
                            height: `${(s.exposed / maxExposed) * 100}%`,
                            backgroundColor: riskColorVar(s.critical > 0 ? "critical" : "elevated"),
                            opacity: s.hour <= hour ? 1 : 0.3,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  {/* per-hour forecast detail for the selected storm */}
                  <div className="pt-1">
                    <div className="label-xs mb-1">{event.name} — forecast detail</div>
                    <div className="overflow-x-auto rounded-sm border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-panel">
                          <tr className="text-left text-[11px] text-muted-foreground">
                            <th className="px-3 py-2 font-medium">Hour</th>
                            <th className="px-3 py-2 font-medium">Position</th>
                            <th className="px-3 py-2 font-medium">Category</th>
                            <th className="px-3 py-2 font-medium">Sustained wind</th>
                            <th className="px-3 py-2 font-medium">Pressure</th>
                            <th className="px-3 py-2 font-medium">Cone radius</th>
                          </tr>
                        </thead>
                        <tbody>
                          {event.forecast.map((p) => (
                            <tr
                              key={p.hour}
                              onClick={() => {
                                setPlaying(false);
                                setHour(p.hour);
                              }}
                              className={`cursor-pointer border-t hover:bg-accent/50 ${
                                Math.abs(p.hour - hour) <= 3 ? "bg-primary/10" : ""
                              }`}
                            >
                              <td className="num px-3 py-1.5">+{p.hour} h</td>
                              <td className="num px-3 py-1.5 text-muted-foreground">
                                {coords(p.lat, p.lon)}
                              </td>
                              <td className="px-3 py-1.5">
                                {p.category > 0 ? `Category ${p.category}` : "Tropical storm"}
                              </td>
                              <td className="num px-3 py-1.5">{p.windMph} mph</td>
                              <td className="num px-3 py-1.5">{p.pressureMb} mb</td>
                              <td className="num px-3 py-1.5">{p.coneRadiusMi} mi</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* right list: assets exposed at the current playhead hour */}
          <div className="panel h-fit">
            <div className="border-b px-4 py-2.5 label-xs">Exposed at +{hour} h</div>
            <ul className="max-h-[640px] divide-y overflow-y-auto">
              {exposedNow.length === 0 && (
                <li className="px-4 py-4 text-xs text-muted-foreground">
                  No assets reach impact onset before this hour.
                </li>
              )}
              {exposedNow.map((r) => (
                <li key={r.assetId}>
                  <button
                    onClick={() => setSelected(r.assetId)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-accent"
                  >
                    <span>
                      <span className="text-xs font-medium">{nameOf(r.assetId)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {r.distanceMi} mi · {r.forecastWindMph} mph · onset {r.hoursToImpact} h
                      </span>
                    </span>
                    <RiskBadge level={r.level} score={r.score} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
