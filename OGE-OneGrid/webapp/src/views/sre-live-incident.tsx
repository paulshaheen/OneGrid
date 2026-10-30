import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Thermometer,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Point {
  e: number;
  ts: string;
  vib: number;
  temp: number;
}

interface AgentWorkOrder {
  wr_id: string;
  problem_descr: string;
  recommendation?: string;
  evidence?: string;
  priority: string;
  wr_status: string;
  site_name?: string;
  asset_id: string;
  create_date: string;
  created_by?: string;
  approved_by?: string;
}

interface LiveStatus {
  running: boolean;
  stage: "idle" | "normal" | "rising" | "alarm" | "work-order";
  asset: { id: string; name: string };
  tags: { vibration: string; bearingTemp: string };
  thresholds: { vibAlarm: number; vibTrip: number; tempAlarm: number };
  baseline?: { vib: number; temp: number };
  latest?: Point | null;
  points: Point[];
  startedAt?: string;
  stoppedAt?: string | null;
  stopReason?: string | null;
  elapsedSec?: number;
  alarmAt?: string | null;
  alarmAfterSec?: number | null;
  workOrders: AgentWorkOrder[];
  writeError?: string | null;
}

export interface LiveAlertEvent {
  name: string;
  state: string;
  firedAt: string | null;
}

const STAGES: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "normal", label: "Normal", icon: Activity },
  { id: "rising", label: "Rising", icon: TrendingUp },
  { id: "alarm", label: "Alarm", icon: BellRing },
  { id: "agent", label: "Agent investigating", icon: Bot },
  { id: "work-order", label: "Work order", icon: ClipboardCheck },
];

const WINDOW_SEC = 120;

export function LiveIncidentPanel({
  alertEvents,
  agentUrl,
  busy,
  otherActive,
  onStart,
  onReset,
}: {
  alertEvents: LiveAlertEvent[];
  agentUrl?: string | undefined;
  busy: string | null;
  otherActive: boolean;
  onStart: () => void;
  onReset: () => void;
}) {
  const [live, setLive] = useState<LiveStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sre/live", { headers: { Accept: "application/json" } });
      if (res.ok) setLive((await res.json()) as LiveStatus);
    } catch {
      /* keep last state */
    }
  }, []);

  const fast = !!live && (live.running || (live.stage !== "idle" && live.stage !== "work-order"));
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), fast ? 1500 : 8000);
    return () => window.clearInterval(t);
  }, [load, fast]);
  useEffect(() => {
    if (!busy?.endsWith(":bearing") && busy !== "reset:all") void load();
  }, [busy, load]);

  const runStart = live?.startedAt ? new Date(live.startedAt).getTime() - 60_000 : 0;
  const alertFiring = alertEvents.some(
    (a) => a.state === "Fired" && (!a.firedAt || new Date(a.firedAt).getTime() >= runStart),
  );
  const wo = live?.workOrders?.[0] ?? null;
  const stageIdx =
    !live || live.stage === "idle"
      ? -1
      : live.stage === "work-order"
        ? 4
        : live.stage === "alarm"
          ? alertFiring
            ? 3
            : 2
          : live.stage === "rising"
            ? 1
            : 0;
  const working = busy === "inject:bearing" || busy === "reset:bearing" || busy === "reset:all";
  const latest = live?.latest;
  const th = live?.thresholds;
  const vibHot = !!latest && !!th && latest.vib >= th.vibAlarm;
  const tempHot = !!latest && !!th && latest.temp >= th.tempAlarm;
  const idle = !live || live.stage === "idle";

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 p-5 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/30",
        vibHot && "border-red-500/50 ring-1 ring-inset ring-red-500/25",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
            vibHot
              ? "bg-red-500/12 text-red-500 ring-red-500/25"
              : "bg-primary/12 text-primary ring-primary/20",
          )}
        >
          <Gauge className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground">
            Scenario 05 · Live · {live?.asset.name ?? "Fairview Unit 1 steam turbine"}
          </div>
          <div className="text-base font-semibold leading-6">
            Bearing failure in real time → agent raises the work order
          </div>
          <div className="text-xs text-muted-foreground">
            Vibration and bearing temperature climb together; the alarm trips in about 30 seconds.
            Azure SRE Agent investigates through the OneGrid MCP server, asks you to approve, then
            creates the work order.
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onStart}
            disabled={!!busy || otherActive || (!!live && live.running)}
            title={otherActive ? "Another scenario is active — reset it first." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "inject:bearing" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Start live incident
          </button>
          <button
            onClick={onReset}
            disabled={!!busy || (idle && !wo)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working && busy?.startsWith("reset") ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reset
          </button>
        </div>
      </div>

      {/* stage strip */}
      <ol className="mt-4 grid grid-cols-5 gap-2">
        {STAGES.map((s, i) => {
          const done = stageIdx > i;
          const current = stageIdx === i;
          const hot = current && (s.id === "alarm" || s.id === "agent");
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium ring-1 ring-inset",
                done &&
                  "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
                current && !hot && "bg-primary/10 text-primary ring-primary/30",
                hot && "bg-red-500/12 text-red-500 ring-red-500/30",
                !done && !current && "text-muted-foreground ring-border",
              )}
            >
              {current && s.id === "agent" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
              ) : done ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : (
                <s.icon className={cn("size-3.5 shrink-0", hot && "animate-pulse")} />
              )}
              <span className="truncate">{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Readout
            icon={Activity}
            label="Vibration"
            tag={live?.tags.vibration ?? "FV1:STM.VIBR"}
            value={latest?.vib}
            units="mm/s"
            digits={2}
            alarm={th?.vibAlarm}
            baseline={live?.baseline?.vib}
            hot={vibHot}
          />
          <Readout
            icon={Thermometer}
            label="Bearing temperature"
            tag={live?.tags.bearingTemp ?? "FV1:STM.BRG_TEMP"}
            value={latest?.temp}
            units="°C"
            digits={1}
            alarm={th?.tempAlarm}
            baseline={live?.baseline?.temp}
            hot={tempHot}
          />
        </div>
        <div className="min-w-0 rounded-xl border bg-background/40 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-red-500" /> Vibration (mm/s)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-amber-500" /> Bearing temp (°C)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t border-dashed border-red-500" /> Alarm
              </span>
            </span>
            <span>
              {live?.running ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-500">
                  <span className="size-1.5 animate-pulse rounded-full bg-red-500" /> LIVE ·{" "}
                  {fmtElapsed(live.elapsedSec)}
                </span>
              ) : live?.stoppedAt ? (
                `Stream stopped · ${live.stopReason ?? ""}`
              ) : (
                "Waiting to start"
              )}
              {live?.alarmAfterSec != null && <> · alarm after {live.alarmAfterSec}s</>}
            </span>
          </div>
          <LiveChart live={live} />
          {live?.writeError && live.running && (
            <p className="mt-1 text-xs text-muted-foreground">
              Eventhouse is busy — readings are buffered and will be written shortly.
            </p>
          )}
        </div>
      </div>

      {/* outcome */}
      <div className="mt-4 border-t pt-3">
        {wo ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardCheck className="size-4 text-emerald-500" />
              <span className="font-mono text-sm font-semibold">{wo.wr_id}</span>
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500 ring-1 ring-inset ring-red-500/20">
                {wo.priority}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {wo.wr_status}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Created by {wo.created_by ?? "Azure SRE Agent"} · approved by{" "}
                {wo.approved_by ?? "—"} · {relativeTime(wo.create_date)}
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold">{wo.problem_descr}</div>
            {wo.recommendation && <p className="mt-1 text-sm leading-5">{wo.recommendation}</p>}
            {wo.evidence && (
              <p className="mt-1 text-xs leading-4 text-muted-foreground">
                Evidence: {wo.evidence}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link
                to="/app/maintenance"
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-medium hover:bg-accent"
              >
                Open in Maintenance <ArrowUpRight className="size-3" />
              </Link>
              <Link
                to="/app/exec"
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-medium hover:bg-accent"
              >
                Executive brief <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <ClipboardCheck className="size-4" />
              {stageIdx >= 2
                ? alertFiring
                  ? "Alert fired — the agent is investigating. Approve its proposed work order in the SRE Agent chat."
                  : "Alarm tripped — Azure Monitor raises the alert within 1–3 minutes."
                : "No agent work order yet."}
            </span>
            {agentUrl && stageIdx >= 2 && (
              <a
                href={agentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Open SRE Agent <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtElapsed(s?: number) {
  if (s == null) return "0:00";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Readout({
  icon: Icon,
  label,
  tag,
  value,
  units,
  digits,
  alarm,
  baseline,
  hot,
}: {
  icon: LucideIcon;
  label: string;
  tag: string;
  value?: number | undefined;
  units: string;
  digits: number;
  alarm?: number | undefined;
  baseline?: number | undefined;
  hot: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3", hot && "border-red-500/40 bg-red-500/8")}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums tracking-tight",
          hot && "text-red-500",
        )}
      >
        {value == null ? "—" : value.toFixed(digits)}
        <span className="ml-1 text-sm font-medium text-muted-foreground">{units}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{tag}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Alarm {alarm ?? "—"} {units}
        {baseline != null && <> · baseline {baseline.toFixed(digits)}</>}
      </div>
    </div>
  );
}

function LiveChart({ live }: { live: LiveStatus | null }) {
  const W = 640,
    H = 210,
    PL = 34,
    PR = 38,
    PT = 10,
    PB = 22;
  const geo = useMemo(() => {
    const pts = live?.points ?? [];
    const th = live?.thresholds ?? { vibAlarm: 11, vibTrip: 14, tempAlarm: 107 };
    const lastE = pts.at(-1)?.e ?? 0;
    const x1 = Math.max(WINDOW_SEC, lastE);
    const x0 = x1 - WINDOW_SEC;
    const view = pts.filter((p) => p.e >= x0);
    const vMin = Math.min(6, ...view.map((p) => p.vib)) - 0.5;
    const vMax = Math.max(th.vibTrip + 0.5, ...view.map((p) => p.vib + 0.5));
    const tMin = Math.min((live?.baseline?.temp ?? 80) - 6, ...view.map((p) => p.temp - 2));
    const tMax = Math.max(th.tempAlarm + 12, ...view.map((p) => p.temp + 2));
    const X = (e: number) => PL + ((e - x0) / (x1 - x0)) * (W - PL - PR);
    const Yv = (v: number) => PT + (1 - (v - vMin) / (vMax - vMin)) * (H - PT - PB);
    const Yt = (v: number) => PT + (1 - (v - tMin) / (tMax - tMin)) * (H - PT - PB);
    const path = (f: (p: Point) => number) =>
      view.map((p, i) => `${i ? "L" : "M"}${X(p.e).toFixed(1)},${f(p).toFixed(1)}`).join(" ");
    const vTicks = [Math.ceil(vMin), Math.round((vMin + vMax) / 2), Math.floor(vMax)];
    const tTicks = [Math.ceil(tMin), Math.round((tMin + tMax) / 2), Math.floor(tMax)];
    return {
      view,
      th,
      x0,
      x1,
      X,
      Yv,
      Yt,
      vibPath: path((p) => Yv(p.vib)),
      tempPath: path((p) => Yt(p.temp)),
      vTicks,
      tTicks,
    };
  }, [live]);
  const { view, th, x0, x1, X, Yv, Yt, vibPath, tempPath, vTicks, tTicks } = geo;
  const last = view[view.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[210px] w-full"
      role="img"
      aria-label="Live vibration and bearing temperature"
    >
      {vTicks.map((v) => (
        <g key={`v${v}`}>
          <line
            x1={PL}
            x2={W - PR}
            y1={Yv(v)}
            y2={Yv(v)}
            className="stroke-border"
            strokeWidth={0.6}
          />
          <text
            x={PL - 6}
            y={Yv(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {v}
          </text>
        </g>
      ))}
      {tTicks.map((v) => (
        <text key={`t${v}`} x={W - PR + 6} y={Yt(v) + 3} className="fill-amber-500/80 text-[10px]">
          {v}°
        </text>
      ))}
      <line
        x1={PL}
        x2={W - PR}
        y1={Yv(th.vibAlarm)}
        y2={Yv(th.vibAlarm)}
        stroke="#ef4444"
        strokeDasharray="5 4"
        strokeWidth={1.2}
      />
      <text
        x={W - PR - 4}
        y={Yv(th.vibAlarm) + 13}
        textAnchor="end"
        className="fill-red-500 text-[10px] font-semibold"
      >
        Vibration alarm {th.vibAlarm} mm/s
      </text>
      <line
        x1={PL}
        x2={W - PR}
        y1={Yt(th.tempAlarm)}
        y2={Yt(th.tempAlarm)}
        stroke="#f59e0b"
        strokeOpacity={0.6}
        strokeDasharray="2 4"
        strokeWidth={1}
      />
      {[0, 30, 60, 90, 120].map((d) => {
        const e = x0 + d;
        return (
          <text
            key={d}
            x={X(e)}
            y={H - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {fmtElapsed(Math.max(0, Math.round(e)))}
          </text>
        );
      })}
      {view.length > 1 && (
        <>
          <path
            d={tempPath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <path d={vibPath} fill="none" stroke="#ef4444" strokeWidth={2.2} strokeLinejoin="round" />
        </>
      )}
      {last && (
        <>
          <circle cx={X(last.e)} cy={Yv(last.vib)} r={3.5} fill="#ef4444" />
          <circle cx={X(last.e)} cy={Yt(last.temp)} r={3} fill="#f59e0b" />
        </>
      )}
      {!view.length && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-muted-foreground text-[12px]">
          Press “Start live incident” — readings stream here every second
        </text>
      )}
      <title>{`Window ${fmtElapsed(Math.round(x0))}–${fmtElapsed(Math.round(x1))}`}</title>
    </svg>
  );
}
