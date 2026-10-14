import { useMemo } from "react";
import { Gauge, Zap, ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSETS,
  PERF_RECS,
  CATEGORY_META,
  ASSET_BY_ID,
  KIND_LABEL,
  type InfraAsset,
  type PerfRec,
} from "@/lib/infra/infra-data";
import { useLiveTick, liveValue } from "@/lib/infra/infra-live";
import { KindIcon, Sparkline } from "./infra-ui";
import { fmtNum } from "./infra-format";

const IMPACT_COLOR: Record<PerfRec["impact"], string> = {
  high: "#ff5a5f",
  medium: "#f0b429",
  low: "#4f8cff",
};
const IMPACT_RANK: Record<PerfRec["impact"], number> = { high: 0, medium: 1, low: 2 };

type Action = { label: string; color: string; icon: typeof TrendingUp };
function rightSize(cpu: number, mem: number): Action {
  if (mem >= 85 || cpu >= 85) return { label: "Scale up", color: "#ff5a5f", icon: TrendingUp };
  if (mem >= 75 || cpu >= 75) return { label: "Add headroom", color: "#f0b429", icon: TrendingUp };
  if (cpu < 20 && mem < 35) return { label: "Downsize", color: "#3fb950", icon: TrendingDown };
  return { label: "Optimal", color: "#7d8597", icon: Minus };
}

export function InfraPerformance({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const recs = useMemo(
    () => [...PERF_RECS].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]),
    [],
  );
  const counts = useMemo(
    () => ({
      high: PERF_RECS.filter((r) => r.impact === "high").length,
      medium: PERF_RECS.filter((r) => r.impact === "medium").length,
      low: PERF_RECS.filter((r) => r.impact === "low").length,
    }),
    [],
  );
  const computeAssets = useMemo(
    () =>
      ASSETS.filter(
        (a) =>
          ["vmhost", "vm", "aks-node", "container-app"].includes(a.kind) && a.status !== "offline",
      ),
    [],
  );

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-3">
        <Summary label="High impact" value={counts.high} accent="#ff5a5f" />
        <Summary label="Medium impact" value={counts.medium} accent="#f0b429" />
        <Summary label="Low impact" value={counts.low} accent="#4f8cff" />
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">
            Performance recommendations
          </span>
        </div>
        <div className="space-y-2">
          {recs.map((r) => {
            const asset = ASSET_BY_ID.get(r.assetId);
            const col = IMPACT_COLOR[r.impact];
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase"
                      style={{ background: `${col}22`, color: col }}
                    >
                      {r.impact} impact
                    </span>
                    <span className="text-[13px] font-semibold text-foreground">{r.title}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{r.detail}</p>
                  {asset && (
                    <button
                      onClick={() => onOpenAsset?.(asset.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      {asset.name}{" "}
                      <span className="text-muted-foreground">· {KIND_LABEL[asset.kind]}</span>{" "}
                      <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
                {asset && (
                  <div className="shrink-0 rounded-lg border bg-card p-2">
                    <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                      {asset.metrics.find((m) => m.key === r.metricKey)?.label ?? "metric"}
                    </div>
                    <Sparkline
                      assetId={asset.id}
                      metricKey={r.metricKey}
                      color={col}
                      width={120}
                      height={32}
                      points={34}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">Compute right-sizing</span>
          <span className="text-[11px] text-muted-foreground">· live utilization</span>
        </div>
        <RightSizeTable assets={computeAssets} onOpenAsset={onOpenAsset} />
      </div>
    </div>
  );
}

function RightSizeTable({
  assets,
  onOpenAsset,
}: {
  assets: InfraAsset[];
  onOpenAsset?: ((id: string) => void) | undefined;
}) {
  useLiveTick();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">Asset</th>
            <th className="py-1.5 pr-3 font-semibold">SKU</th>
            <th className="w-40 py-1.5 pr-3 font-semibold">CPU</th>
            <th className="w-40 py-1.5 pr-3 font-semibold">Memory</th>
            <th className="py-1.5 pr-1 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const cpu = liveValue(a.id, "cpu");
            const mem = liveValue(a.id, "mem");
            const act = rightSize(cpu, mem);
            return (
              <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                <td className="py-2 pr-3">
                  <button
                    onClick={() => onOpenAsset?.(a.id)}
                    className="flex items-center gap-2 text-left"
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-md"
                      style={{
                        background: `${CATEGORY_META[a.category].color}1f`,
                        color: CATEGORY_META[a.category].color,
                      }}
                    >
                      <KindIcon kind={a.kind} className="size-3.5" />
                    </span>
                    <span className="font-medium text-foreground hover:underline">{a.name}</span>
                  </button>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{a.sku ?? "—"}</td>
                <td className="py-2 pr-3">
                  <MeterCell value={cpu} />
                </td>
                <td className="py-2 pr-3">
                  <MeterCell value={mem} />
                </td>
                <td className="py-2 pr-1 text-right">
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: `${act.color}18`, color: act.color }}
                  >
                    <act.icon className="size-3" /> {act.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MeterCell({ value }: { value: number }) {
  const col = value >= 85 ? "#ff5a5f" : value >= 75 ? "#f0b429" : "#3fb950";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700")}
          style={{ width: `${Math.min(100, value)}%`, background: col }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-foreground">
        {fmtNum(value)}%
      </span>
    </div>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-bold tabular-nums leading-none"
        style={{ color: accent ?? "var(--color-foreground)" }}
      >
        {value}
      </div>
    </div>
  );
}
