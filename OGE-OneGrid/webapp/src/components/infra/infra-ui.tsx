import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Server,
  Database,
  HardDrive,
  Router,
  Cpu,
  Box,
  Boxes,
  Container,
  Shield,
  Activity,
  Waypoints,
  Antenna,
  Radio,
  Sparkles,
  Cable,
  CircuitBoard,
  Share2,
  RadioTower,
  Layers,
  Network,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type InfraAsset,
  type InfraKind,
  type InfraMetric,
  type InfraStatus,
  STATUS_COLOR,
  metricStatus,
} from "@/lib/infra/infra-data";
import { useLiveTick, liveValue } from "@/lib/infra/infra-live";
import { fmtNum } from "./infra-format";

// ── icons per asset kind ─────────────────────────────────────────────────────
const KIND_ICON: Record<InfraKind, LucideIcon> = {
  vmhost: Server,
  vm: Box,
  "aks-node": Boxes,
  "container-app": Container,
  "fabric-capacity": Layers,
  "sql-db": Database,
  postgres: Database,
  cosmos: Database,
  eventhouse: Activity,
  storage: HardDrive,
  "sdn-controller": Waypoints,
  firewall: Shield,
  "load-balancer": Share2,
  router: Router,
  switch: Network,
  expressroute: Cable,
  "scada-gateway": RadioTower,
  plc: CircuitBoard,
  rtu: Cpu,
  "iot-edge": Antenna,
  sensor: Radio,
  historian: Database,
  "arc-server": Server,
  "ai-foundry": Sparkles,
};

export function KindIcon({ kind, className }: { kind: InfraKind; className?: string }) {
  const Ic = KIND_ICON[kind] ?? Server;
  return <Ic className={className} />;
}

// ── status dot ───────────────────────────────────────────────────────────────
export function StatusDot({
  status,
  pulse,
  size = 8,
}: {
  status: InfraStatus;
  pulse?: boolean;
  size?: number;
}) {
  const color = STATUS_COLOR[status];
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {pulse && status !== "healthy" && status !== "offline" && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-block rounded-full"
        style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${color}99` }}
      />
    </span>
  );
}

export function StatusPill({ status, className }: { status: InfraStatus; className?: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        className,
      )}
      style={{ background: `${color}22`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}

// ── threshold bar ────────────────────────────────────────────────────────────
function barPct(m: InfraMetric, value: number): number {
  const span = m.max - m.min || 1;
  return Math.max(2, Math.min(100, ((value - m.min) / span) * 100));
}

/** One live metric row: label, animated bar colored by threshold, value+unit. */
export function LiveMetricRow({ asset, metric }: { asset: InfraAsset; metric: InfraMetric }) {
  useLiveTick();
  const v = liveValue(asset.id, metric.key);
  const status = metricStatus(metric, v);
  const color = STATUS_COLOR[status];
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-24 shrink-0 truncate text-[11px] text-muted-foreground"
        title={metric.label}
      >
        {metric.label}
      </div>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${barPct(metric, v)}%`, background: color }}
        />
      </div>
      <div
        className="w-20 shrink-0 text-right text-[12px] font-semibold tabular-nums"
        style={{ color: status === "healthy" ? "var(--color-foreground)" : color }}
      >
        {fmtNum(v)}
        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{metric.unit}</span>
      </div>
    </div>
  );
}

// ── sparkline (per-component rolling history) ─────────────────────────────────
export function Sparkline({
  assetId,
  metricKey,
  color = "var(--color-primary)",
  width = 120,
  height = 30,
  points = 40,
}: {
  assetId: string;
  metricKey: string;
  color?: string;
  width?: number;
  height?: number;
  points?: number;
}) {
  useLiveTick();
  const hist = useRef<number[]>([]);
  const v = liveValue(assetId, metricKey);
  hist.current.push(v);
  if (hist.current.length > points) hist.current.shift();
  const data = hist.current;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / Math.max(1, points - 1);
  const path = data
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - ((d - min) / span) * (height - 4) - 2).toFixed(1)}`,
    )
    .join(" ");
  const lastV = data.length ? data[data.length - 1]! : min;
  const last = data.length ? height - ((lastV - min) / span) * (height - 4) - 2 : height / 2;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={(data.length - 1) * step} cy={last} r={2} fill={color} />
    </svg>
  );
}

// ── radial gauge ──────────────────────────────────────────────────────────────
export function RadialGauge({
  value,
  max = 100,
  size = 120,
  label,
  sub,
  color = "var(--color-primary)",
  thickness = 9,
}: {
  value: number;
  max?: number;
  size?: number;
  label?: string;
  sub?: string;
  color?: string;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={thickness}
          opacity={0.5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 900ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-bold tabular-nums leading-none text-foreground">
            {label ?? fmtNum(value)}
          </div>
          {sub && (
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {sub}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── small stat tile ────────────────────────────────────────────────────────────
export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors",
        onClick && "hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="size-3.5" style={{ color: accent }} />} {label}
      </div>
      <div
        className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: accent ?? "var(--color-foreground)" }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </button>
  );
}
