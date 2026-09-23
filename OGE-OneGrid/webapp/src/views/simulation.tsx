import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { useMode } from "@/lib/theme-mode";

type Asset = { asset_id: string; name: string; plant: string; unit: string; status: string };

// Digital Twin · Simulation — the report-app what-if forward simulation (also embedded as a
// tab in the asset modal). Renders the 3D degradation twin + survival curve + sensor
// projections for a chosen at-risk asset. Client-only (pulls in the three.js engine).
export function SimulationPage() {
  const [Sim, setSim] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const sampleRef = useRef<typeof import("@/report/lib/sample.js") | null>(null);

  useEffect(() => {
    let ok = true;
    Promise.all([
      import("@/report/components/Simulation.jsx"),
      import("@/report/lib/sample.js"),
    ]).then(([sim, sample]) => {
      if (!ok) return;
      sampleRef.current = sample;
      setSim(() => sim.Simulation);
      const fa = (sample.fleetAssets() as Asset[]).filter((a) => a.status !== "ok");
      setAssets(fa);
      const first = fa[0]?.asset_id ?? null;
      setSelId(first);
    });
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    if (!selId || !sampleRef.current) return;
    setDetail(sampleRef.current.assetDetail(selId) as Record<string, unknown>);
  }, [selId]);

  const theme = useMode();
  const sel = assets.find((a) => a.asset_id === selId) || null;

  return (
    <AppShell fullHeight>
      <div className={`h-full min-h-[calc(100vh-3.5rem)] overflow-y-auto px-5 py-5 ${theme.app}`} style={theme.appStyle}>
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Failure Simulation — Predictive Digital Twin
              </h1>
              <div className="text-xs text-muted-foreground">
                Forward what-if from the live stop model + survival curve. Also available inside
                each asset&apos;s modal (Simulation tab).
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Asset</span>
              <select
                value={selId ?? ""}
                onChange={(e) => setSelId(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none"
              >
                {assets.map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>
                    {a.plant} · {a.unit} · {a.name} ({a.status})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {Sim && sel && detail ? (
            <Sim theme={theme} asset={sel} detail={detail} />
          ) : (
            <div className="grid h-[60vh] place-items-center text-sm text-muted-foreground">
              Loading simulation…
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
