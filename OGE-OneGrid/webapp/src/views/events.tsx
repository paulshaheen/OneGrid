import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/ops/AppShell";
import { MapModeSwitch } from "@/components/ops/MapModeSwitch";
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
 * Forecast Timeline — the merged weather page. It combines the per-storm briefing
 * (pills, storm info, affected assets) with the forward-moving forecast timeline
 * (playhead scrubber + estate exposure over the horizon). Layout top→bottom:
 * pills → storm info (collapsible) → map → forecast timeline (collapsible). The
 * storm info and the forecast timeline accordion against each other: expanding one
 * collapses the other. In "storm" mode the map shows current positions; in
 * "timeline" mode it animates forward along the scrubbed hour. The page scrolls.
 */
export function EventsPage() {
  const base = useOpsBase();
  const assets = useQuery(assetsQuery(base)).data ?? [];
  const events = useQuery(eventsQuery(base)).data ?? [];
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"storm" | "timeline">("storm");
  const [hour, setHour] = useState(48);
  const [playing, setPlaying] = useState(false);
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

  // Storm mode — exposure vs the SELECTED storm (current positions).
  const stormRisks = useMemo(
    () => (event ? assets.map((a) => scoreAsset(a, event, 120)) : []),
    [assets, event],
  );

  // Timeline mode — highest exposure across ALL systems (an asset is exposed if ANY
  // storm threatens it), so every storm on the map contributes to the curve.
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

  const activeRisks = mode === "timeline" ? timelineRisks : stormRisks;
  const riskMap = useMemo(() => new Map(activeRisks.map((r) => [r.assetId, r])), [activeRisks]);

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

  // Playhead only runs in timeline mode.
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
  // Entering the forecast timeline auto-plays the forward animation so the storm
  // visibly advances along the forecast; returning to the storm view pauses it.
  useEffect(() => {
    setPlaying(mode === "timeline");
  }, [mode]);

  const affected = useMemo(
    () => [...stormRisks].filter((r) => r.score >= 42).sort((a, b) => b.score - a.score),
    [stormRisks],
  );
  const exposedNow = useMemo(
    () =>
      [...timelineRisks]
        .filter((r) => (r.hoursToImpact ?? 999) <= hour)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20),
    [timelineRisks, hour],
  );
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

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

  const sideList = mode === "timeline" ? exposedNow : affected;

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
            {/* storm info (collapsible) */}
            <div className="panel">
              <button
                onClick={() => setMode("storm")}
                aria-expanded={mode === "storm"}
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
                    · {event.currentWindMph} mph · {affected.length} affected
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${mode === "storm" ? "rotate-180" : ""}`}
                />
              </button>
              {mode === "storm" && (
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

            {/* map — under the storm info */}
            <div className="panel overflow-hidden">
              <div className="relative h-[58vh] min-h-[420px]">
                <MapModeSwitch
                  className="h-full w-full"
                  assets={assets}
                  risks={riskMap}
                  event={event}
                  events={events}
                  initialFocusEventId={event.id}
                  hour={mode === "timeline" ? hour : 0}
                  layers={{ assets: true, track: mode === "timeline", wind: true }}
                  selectedId={selected}
                  onSelect={setSelected}
                />
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-popover/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
                  {mode === "timeline" ? (
                    <span className="font-medium">Forecast +{hour} h</span>
                  ) : (
                    <>
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                      </span>
                      <span className="font-medium">Current position</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* forecast timeline (collapsible) */}
            <div className="panel">
              <button
                onClick={() => setMode("timeline")}
                aria-expanded={mode === "timeline"}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-accent/40"
              >
                <span className="label-xs">Forecast timeline</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {mode === "timeline" ? `peak ${maxExposed} exposed` : "scrub the 120 h horizon"}
                  <ChevronDown
                    className={`size-4 transition-transform ${mode === "timeline" ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {mode === "timeline" && (
                <div className="space-y-2 border-t p-3">
                  {/* playhead scrubber */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs hover:bg-accent"
                    >
                      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      {playing ? "Pause" : "Play"}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={3}
                      value={hour}
                      onChange={(e) => setHour(Number(e.target.value))}
                      className="h-1 min-w-[180px] flex-1 accent-[var(--color-primary)]"
                      aria-label="Forecast hour"
                    />
                    <span className="num w-16 text-right text-sm font-semibold">+{hour} h</span>
                    <div className="flex gap-1">
                      {STOPS.map((s) => (
                        <button
                          key={s}
                          onClick={() => setHour(s)}
                          className={`rounded-sm border px-2 py-1 text-[11px] ${hour === s ? "bg-accent" : "hover:bg-accent/60"}`}
                        >
                          {s}h
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* estate exposure over the horizon */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="label-xs">Exposure over the forecast horizon</span>
                    <span className="text-[10px] text-muted-foreground">click a bar to jump</span>
                  </div>
                  <div className="flex h-40 items-end gap-1">
                    {series.map((s) => (
                      <button
                        key={s.hour}
                        onClick={() => setHour(s.hour)}
                        className="group flex h-full flex-1 flex-col justify-end gap-0.5"
                        title={`+${s.hour} h — ${s.exposed} exposed`}
                      >
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t-sm transition-opacity"
                            style={{
                              height: `${(s.exposed / maxExposed) * 100}%`,
                              backgroundColor: riskColorVar(
                                s.critical > 0 ? "critical" : "elevated",
                              ),
                              opacity: s.hour <= hour ? 1 : 0.3,
                            }}
                          />
                        </div>
                        <span className="num text-[9px] leading-none text-muted-foreground">
                          {s.hour % 24 === 0 ? s.hour : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                  {/* per-hour forecast detail for the selected storm */}
                  <div className="pt-1">
                    <div className="label-xs mb-1">{event.name} — forecast detail</div>
                    <div className="max-h-[320px] overflow-y-auto rounded-sm border">
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
                              onClick={() => setHour(p.hour)}
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

          {/* right list: affected (storm) / exposed (timeline) */}
          <div className="panel h-fit">
            <div className="border-b px-4 py-2.5 label-xs">
              {mode === "timeline"
                ? `Exposed at +${hour} h`
                : `Affected assets (${affected.length})`}
            </div>
            <ul className="max-h-[640px] divide-y overflow-y-auto">
              {sideList.length === 0 && (
                <li className="px-4 py-4 text-xs text-muted-foreground">
                  {mode === "timeline"
                    ? "No assets reach impact onset before this hour."
                    : "No assets at elevated risk from this system."}
                </li>
              )}
              {sideList.map((r) => (
                <li key={r.assetId}>
                  <button
                    onClick={() => setSelected(r.assetId)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-accent"
                  >
                    <span>
                      <span className="text-xs font-medium">{nameOf(r.assetId)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {r.distanceMi} mi · {r.forecastWindMph} mph ·{" "}
                        {mode === "timeline"
                          ? `onset ${r.hoursToImpact} h`
                          : `impact in ${r.hoursToImpact} h`}
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
