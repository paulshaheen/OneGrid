import { useState } from "react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { OpsMap } from "@/components/ops/OpsMap";
import { RiskBadge } from "@/components/ops/RiskBadge";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { coords, relativeTime } from "@/lib/format";

export function EventsPage() {
  const base = useOpsBase();
  const { assets, risks, riskMap, event } = useOpsSnapshot(base, 120);
  const [selected, setSelected] = useState<string | null>(null);

  if (!event) {
    return (
      <AppShell>
        <PageHeader
          title="Weather Events"
          description="Active tropical and severe-weather systems affecting the operating region, with forecast trajectory and asset exposure."
        />
        <div className="p-4">
          <div className="panel relative h-[min(68vh,620px)] overflow-hidden">
            <OpsMap
              className="h-full w-full"
              assets={assets}
              risks={riskMap}
              event={event}
              layers={{ assets: true, track: true, wind: true }}
              selectedId={selected}
              onSelect={setSelected}
            />
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 w-[min(90%,28rem)] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur">
              <h2 className="text-xs font-semibold">No active weather events</h2>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                The basemap is ready. New systems and exposed assets will appear automatically when
                the forecast provider updates.
              </p>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const affected = [...risks].filter((r) => r.score >= 42).sort((a, b) => b.score - a.score);
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  return (
    <AppShell>
      <PageHeader
        title="Weather Events"
        description="Active tropical and severe-weather systems affecting the operating region, with forecast trajectory and asset exposure."
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{event.name}</h2>
                  <span className="rounded-sm border border-risk-critical/40 bg-risk-critical/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-risk-critical uppercase">
                    {event.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {event.basin} · {event.modelSource} · updated {relativeTime(event.updatedAtIso)}
                </p>
              </div>
              <div className="text-right text-[11px] text-muted-foreground">
                Forecast confidence
                <div className="text-sm font-medium text-foreground capitalize">
                  {event.confidence}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4">
              {[
                ["Current position", coords(event.lat, event.lon)],
                ["Sustained wind", `${event.currentWindMph} mph`],
                ["Gusts", `${event.gustMph} mph`],
                ["Minimum pressure", `${event.pressureMb} mb`],
                ["Movement", `${event.movementDeg}° at ${event.movementMph} mph`],
                ["Category", `Category ${event.currentCategory}`],
                ["Expected landfall", event.expectedLandfall],
                ["Assets affected", `${affected.length} at elevated risk+`],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-3">
                  <div className="label-xs">{label}</div>
                  <div className="num mt-1 text-xs">{value}</div>
                </div>
              ))}
            </div>
            <div className="h-[360px] border-t">
              <OpsMap
                className="h-full w-full"
                assets={assets}
                risks={riskMap}
                event={event}
                layers={{ assets: true, track: true, wind: true }}
                selectedId={selected}
                onSelect={setSelected}
              />
            </div>
          </div>

          <div className="panel">
            <div className="border-b px-4 py-2.5 label-xs">Forecast timeline</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Hour</th>
                  <th className="px-4 py-2 font-medium">Position</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Sustained wind</th>
                  <th className="px-4 py-2 font-medium">Pressure</th>
                  <th className="px-4 py-2 font-medium">Cone radius</th>
                </tr>
              </thead>
              <tbody>
                {event.forecast.map((p) => (
                  <tr key={p.hour} className="border-t">
                    <td className="num px-4 py-2">+{p.hour} h</td>
                    <td className="num px-4 py-2 text-muted-foreground">{coords(p.lat, p.lon)}</td>
                    <td className="px-4 py-2">
                      {p.category > 0 ? `Category ${p.category}` : "Tropical storm"}
                    </td>
                    <td className="num px-4 py-2">{p.windMph} mph</td>
                    <td className="num px-4 py-2">{p.pressureMb} mb</td>
                    <td className="num px-4 py-2">{p.coneRadiusMi} mi</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel h-fit">
          <div className="border-b px-4 py-2.5 label-xs">Affected assets ({affected.length})</div>
          <ul className="max-h-[720px] divide-y overflow-y-auto">
            {affected.map((r) => (
              <li key={r.assetId}>
                <button
                  onClick={() => setSelected(r.assetId)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-accent"
                >
                  <span>
                    <span className="text-xs font-medium">{nameOf(r.assetId)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {r.distanceMi} mi · {r.forecastWindMph} mph · impact in {r.hoursToImpact} h
                    </span>
                  </span>
                  <RiskBadge level={r.level} score={r.score} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
