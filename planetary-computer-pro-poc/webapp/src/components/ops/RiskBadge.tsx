import type { RiskLevel } from "@/lib/domain/types";
import { RISK_LABEL, riskColorVar } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RiskBadge({
  level,
  score,
  className,
  size = "sm",
}: {
  level: RiskLevel;
  score?: number;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border font-medium uppercase tracking-wider",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        className,
      )}
      style={{
        color: riskColorVar(level),
        borderColor: `color-mix(in oklch, ${riskColorVar(level)} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${riskColorVar(level)} 12%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: riskColorVar(level) }} />
      {RISK_LABEL[level]}
      {score !== undefined && <span className="num opacity-80">{score}</span>}
    </span>
  );
}

export function StatCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: RiskLevel;
}) {
  return (
    <div className="flex flex-col gap-1 border-l px-4 py-3 first:border-l-0">
      <span className="label-xs">{label}</span>
      <span
        className="num text-2xl leading-none font-semibold"
        style={tone ? { color: riskColorVar(tone) } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
