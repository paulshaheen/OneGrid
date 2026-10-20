import { useMemo } from "react";
import {
  Boxes,
  ShieldCheck,
  Activity,
  CloudDownload as DownloadCloud,
  Radio,
  ChartLine as LineChart,
  TicketCheck,
  RefreshCw,
  CircleCheckBig as CheckCircle2,
  TriangleAlert as AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSETS,
  SOURCES,
  CATEGORY_META,
  KIND_LABEL,
  type SourceSystem,
} from "@/lib/infra/infra-data";
import { KindIcon } from "./infra-ui";

const KIND_ICON: Record<SourceSystem["kind"], LucideIcon> = {
  inventory: Boxes,
  monitoring: Activity,
  security: ShieldCheck,
  patching: DownloadCloud,
  telemetry: Radio,
  itsm: TicketCheck,
  ai: LineChart,
};
const STATUS_META: Record<
  SourceSystem["status"],
  { color: string; icon: LucideIcon; label: string }
> = {
  connected: { color: "#3fb950", icon: CheckCircle2, label: "Connected" },
  degraded: { color: "#f0b429", icon: AlertTriangle, label: "Degraded" },
  syncing: { color: "#4f8cff", icon: RefreshCw, label: "Syncing" },
};

export function InfraSources({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const bySource = useMemo(() => {
    const m: Record<string, typeof ASSETS> = {};
    for (const s of SOURCES) m[s.id] = ASSETS.filter((a) => a.sources.includes(s.id));
    return m;
  }, []);
  const avgCoverage = Math.round(
    (SOURCES.reduce((s, x) => s + x.coverage, 0) / SOURCES.length) * 100,
  );

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Source systems" value={SOURCES.length} />
        <Summary
          label="Connected"
          value={SOURCES.filter((s) => s.status === "connected").length}
          accent="#3fb950"
        />
        <Summary
          label="Needs attention"
          value={SOURCES.filter((s) => s.status !== "connected").length}
          accent="#f0b429"
        />
        <Summary label="Avg coverage" value={`${avgCoverage}%`} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
        {SOURCES.map((s) => {
          const Icon = KIND_ICON[s.kind];
          const sm = STATUS_META[s.status];
          const assets = bySource[s.id] ?? [];
          return (
            <div key={s.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/50 text-foreground">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-foreground">
                      {s.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.vendor} · <span className="capitalize">{s.kind}</span>
                    </div>
                  </div>
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
                  style={{ background: `${sm.color}22`, color: sm.color }}
                >
                  <sm.icon className={cn("size-3", s.status === "syncing" && "animate-spin")} />{" "}
                  {sm.label}
                </span>
              </div>

              <p className="mt-2 text-[11.5px] text-muted-foreground">{s.description}</p>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Estate coverage</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {Math.round(s.coverage * 100)}% · {assets.length} assets
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${s.coverage * 100}%`, background: sm.color }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                  <span>Last sync {s.lastSyncMin < 1 ? "just now" : `${s.lastSyncMin}m ago`}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                {assets.slice(0, 8).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onOpenAsset?.(a.id)}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 text-[10.5px] text-foreground hover:border-primary/40 hover:bg-accent"
                    title={KIND_LABEL[a.kind]}
                  >
                    <span style={{ color: CATEGORY_META[a.category].color }}>
                      <KindIcon kind={a.kind} className="size-3" />
                    </span>
                    {a.name}
                  </button>
                ))}
                {assets.length > 8 && (
                  <span className="self-center text-[10.5px] text-muted-foreground">
                    +{assets.length - 8} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
