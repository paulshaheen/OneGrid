import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useRouter } from "@tanstack/react-router";

import { AppShell } from "@/components/ops/AppShell";
import { useOpsBase } from "@/components/ops/ops-nav";
import { MODES } from "@/report/lib/themes.js";

// Asset Explorer — the faithful report-app "Executive" fleet-intelligence dashboard:
// fleet-health sunburst, KPI tiles, priority-watch list, and the full asset modal
// (3D model · root cause · watchlist · anomalies · predictions · simulation · work orders).
export function AssetExplorerPage() {
  const router = useRouter();
  const base = useOpsBase();
  const [C, setC] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    import("@/report/personas/Executive.jsx")
      .then((m) => ok && setC(() => m.default))
      .catch((e) => ok && setErr(String(e && (e.stack || e.message || e))));
    return () => {
      ok = false;
    };
  }, []);

  const onNavigate = (id: string) => {
    const to = id === "controlroom" ? "/control-room" : id === "maintenance" ? "/maintenance" : "/";
    router.navigate({ to: `${base}${to}` });
  };
  const onOpenGovernance = () => router.navigate({ to: `${base}/governance` });

  return (
    <AppShell fullHeight>
      <div className="h-full min-h-[calc(100vh-3.5rem)] bg-[#0a0f1a] text-[#aeb9cd]">
        {C ? (
          <C theme={MODES.dark} onNavigate={onNavigate} onOpenGovernance={onOpenGovernance} />
        ) : (
          <div className="grid h-full min-h-[60vh] place-items-center px-6 text-center text-sm text-slate-400">
            {err ? (
              <pre className="max-w-3xl whitespace-pre-wrap text-left text-[11px] text-rose-300">
                {err}
              </pre>
            ) : (
              "Loading Asset Explorer…"
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
