import { useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { MapModeSwitch } from "@/components/ops/MapModeSwitch";
import { RiskBadge } from "@/components/ops/RiskBadge";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { assetsQuery, eventsQuery } from "@/lib/hooks/use-ops-data";
import { useQuery } from "@tanstack/react-query";
import { scoreAsset } from "@/lib/services/risk-engine";
import { riskColorVar } from "@/lib/format";

const STOPS = [24, 48, 72, 120];

export function TimelinePage() {
  const base = useOpsBase();
  const assets = useQuery(assetsQuery(base)).data ?? [];
  const events = useQuery(eventsQuery(base)).data ?? [];
  // Frame + label off the most significant system, but score exposure across ALL
  // of them so every storm on the map contributes to the exposure curve.
  const event = useMemo(
    () =>
      [...events].sort(
        (a, b) => b.currentCategory - a.currentCategory || b.currentWindMph - a.currentWindMph,
      )[0],
    [events],
  );
  const [hour, setHour] = useState(48);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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

  // Highest-risk storm per asset (an asset is exposed if ANY active system threatens it).
  const risks = useMemo(() => {
    if (!events.length) return [];
    return assets.map((a) => {
      let best = scoreAsset(a, events[0]!, Math.max(6, hour));
      for (let i = 1; i < events.length; i++) {
        const r = scoreAsset(a, events[i]!, Math.max(6, hour));
        if (r.score > best.score) best = r;
      }
      return best;
    });
  }, [assets, events, hour]);

  const riskMap = useMemo(() => new Map(risks.map((r) => [r.assetId, r])), [risks]);
  const series = useMemo(() => {
    if (!events.length) return [];
    const scoreAcross = (a: (typeof assets)[number], h: number) => {
      let best = scoreAsset(a, events[0]!, Math.max(6, h));
      for (let i = 1; i < events.length; i++) {
        const r = scoreAsset(a, events[i]!, Math.max(6, h));
        if (r.score > best.score) best = r;
      }
      return best;
    };
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
  }, [assets, events]);

  const maxExposed = Math.max(1, ...series.map((s) => s.exposed));
  const topNow = [...risks]
    .filter((r) => (r.hoursToImpact ?? 999) <= hour)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  return (
    <AppShell>
      <PageHeader
        title="Forecast Timeline"
        description="Move through the forecast horizon to see storm movement and the corresponding change in asset exposure."
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
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
                className="h-1 min-w-[220px] flex-1 accent-[var(--color-primary)]"
              />
              <span className="num w-20 text-right text-sm font-semibold">+{hour} h</span>
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
            <div className="relative h-[420px]">
              <MapModeSwitch
                className="h-full w-full"
                assets={assets}
                risks={riskMap}
                event={event}
                events={events}
                initialFocusEventId={event?.id}
                hour={hour}
                layers={{ assets: true, track: true, wind: true }}
                selectedId={selected}
                onSelect={setSelected}
              />
              {!event && (
                <div className="pointer-events-none absolute top-3 left-1/2 z-10 w-[min(90%,24rem)] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur">
                  <p className="text-[11px] text-muted-foreground">
                    Basemap ready. Forecast movement will appear when weather data is available.
                  </p>
                  {assets.length === 0 && (
                    <OpsLink
                      to="/"
                      className="pointer-events-auto mt-1 inline-flex text-[11px] font-medium text-primary hover:underline"
                    >
                      Add operational data
                    </OpsLink>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Exposure over the forecast horizon</div>
            <div className="flex h-40 items-end gap-1">
              {series.map((s) => (
                <button
                  key={s.hour}
                  onClick={() => setHour(s.hour)}
                  className="group flex flex-1 flex-col items-center justify-end gap-1"
                  title={`+${s.hour} h — ${s.exposed} exposed`}
                >
                  <div
                    className="w-full rounded-t-sm transition-opacity"
                    style={{
                      height: `${(s.exposed / maxExposed) * 100}%`,
                      backgroundColor: riskColorVar(s.critical > 0 ? "critical" : "elevated"),
                      opacity: s.hour <= hour ? 1 : 0.28,
                    }}
                  />
                  <span className="num text-[9px] text-muted-foreground">
                    {s.hour % 24 === 0 ? s.hour : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel h-fit">
          <div className="border-b px-4 py-2.5 label-xs">Exposed at +{hour} h</div>
          <ul className="divide-y">
            {topNow.length === 0 && (
              <li className="px-4 py-4 text-xs text-muted-foreground">
                No assets reach impact onset before this hour.
              </li>
            )}
            {topNow.map((r) => (
              <li key={r.assetId} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <span className="text-xs font-medium">{nameOf(r.assetId)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.distanceMi} mi · {r.forecastWindMph} mph · onset {r.hoursToImpact} h
                  </span>
                </span>
                <RiskBadge level={r.level} score={r.score} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
