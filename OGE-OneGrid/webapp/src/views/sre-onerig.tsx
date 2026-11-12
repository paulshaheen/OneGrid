// OneRig SRE demo: a scripted, presenter-safe replay of an offshore equipment incident.
// An agent investigates a compressor alarm on Titan-1 with read-only tools and proposes a
// work order for a person to approve. Nothing is sent to equipment, SAP PM or Azure.
import { AlertTriangle, BellRing, Bot, CheckCircle2, ClipboardCheck, Play, RotateCcw, ShieldCheck, Siren, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { OpsLink } from "@/components/ops/ops-nav";
import { useAuth } from "@/lib/hooks/use-auth";
import { analyze } from "@/lib/services/offshore/engine";
import { syntheticRun } from "@/lib/services/offshore/synthetic";
import { cn } from "@/lib/utils";

type Phase = "idle" | "rising" | "investigating" | "awaiting" | "approved" | "rejected";

const VIB_ALARM = 7.1;
const VIB_TRIP = 9;
const RISE_MS = 7000;
const TOOL_MS = 1400;
const ASSET = "K-201B";

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BellRing, title: "Alarm fires", text: "Drive-end vibration on gas compressor K-201B crosses its alarm limit." },
  { icon: Bot, title: "Agent investigates", text: "Reads alarms, trends, asset history and the weather window. Read-only." },
  { icon: Wrench, title: "Proposes a work order", text: "Diagnosis, evidence and a plan that fits the weather." },
  { icon: ShieldCheck, title: "You approve", text: "Nothing is raised until a person approves it." },
];

/** 72 hours of drive-end vibration (mm/s): steady, then a bearing-wear rise over the last 36 h. */
function vibrationTrend(): number[] {
  return Array.from({ length: 73 }, (_, h) => {
    const wear = h < 36 ? 0 : ((h - 36) / 36) ** 1.6 * 4.2;
    return Math.round((3.2 + wear + 0.18 * Math.sin(h * 1.3) + 0.1 * Math.sin(h * 3.7)) * 100) / 100;
  });
}

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card/80 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/30", className)}>{children}</div>;
}

export function OneRigSreDemo({ cyberCard }: { cyberCard: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reveal, setReveal] = useState(0);
  const [tools, setTools] = useState(0);
  const [approver, setApprover] = useState("");
  const [decidedBy, setDecidedBy] = useState("");
  const { displayName } = useAuth();
  useEffect(() => {
    if (displayName && displayName !== "Signed in") setApprover((v) => v || displayName);
  }, [displayName]);

  const trend = useMemo(vibrationTrend, []);
  // The plan has to fit the same weather the Offshore Weather page shows.
  const weather = useMemo(() => {
    const run = syntheticRun("aurora");
    const a = analyze(run);
    const at = (op: string) => a.windows.find((w) => w.siteId === "PLT-T1" && w.opId === op)?.firstStop ?? null;
    const fmt = (h: number | null) =>
      h === null || !run.hours[h]
        ? "after this week"
        : `${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago" }).format(new Date(run.hours[h]!))} CT`;
    return { supply: fmt(at("supply")), crane: fmt(at("crane")) };
  }, []);

  const TOOLS = useMemo(
    () => [
      {
        call: `get_active_alarms(site="PLT-T1")`,
        result: `${ASSET} drive-end vibration HIGH ${trend[trend.length - 1]!.toFixed(1)} mm/s (alarm ${VIB_ALARM}, trip ${VIB_TRIP}). Drive-end bearing 96 °C, up 9 °C in 24 h.`,
      },
      {
        call: `get_sensor_trend(tag="T1.${ASSET}.VIB.DE", hours=72)`,
        result: "Flat at 3.2 mm/s until 36 h ago, then rising and accelerating. Non-drive end and train A are steady.",
      },
      {
        call: `get_asset_context(asset="${ASSET}")`,
        result: "Gas-turbine-driven centrifugal compressor, train B. 41,200 running hours; drive-end bearing last inspected 14 months ago. Train A can carry about 60% of the gas.",
      },
      {
        call: `list_work_orders(asset="${ASSET}", days=365)`,
        result: "No open work orders. Same pattern on K-201A in March: drive-end bearing replaced under WO-T1-2231, 18 h planned outage.",
      },
      {
        call: `get_weather_window(site="PLT-T1")`,
        result: `Cold front arriving. Supply offload possible until ${weather.supply}; crane lifts stop ${weather.crane} (Aurora).`,
      },
    ],
    [weather, trend],
  );

  const runId = useRef(0);
  const start = () => {
    const id = ++runId.current;
    setPhase("rising");
    setReveal(0);
    setTools(0);
    setDecidedBy("");
    const t0 = performance.now();
    const tick = (now: number) => {
      if (runId.current !== id) return;
      const p = Math.min(1, (now - t0) / RISE_MS);
      setReveal(p);
      if (p < 1) requestAnimationFrame(tick);
      else setPhase("investigating");
    };
    requestAnimationFrame(tick);
  };
  const reset = () => {
    runId.current++;
    setPhase("idle");
    setReveal(0);
    setTools(0);
    setDecidedBy("");
  };
  useEffect(() => {
    if (phase !== "investigating") return;
    if (tools >= TOOLS.length) {
      const t = window.setTimeout(() => setPhase("awaiting"), 900);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setTools((n) => n + 1), TOOL_MS);
    return () => window.clearTimeout(t);
  }, [phase, tools, TOOLS.length]);

  // Follow along as the replay moves down the page.
  const agentRef = useRef<HTMLDivElement>(null);
  const woRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "investigating") agentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (phase === "awaiting") woRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [phase]);

  const stage = { idle: -1, rising: 0, investigating: 1, awaiting: 2, approved: 4, rejected: 4 }[phase];
  const shown = Math.max(1, Math.round(reveal * (trend.length - 1)) + 1);
  const latest = trend[shown - 1]!;
  const alarmed = phase !== "idle" && latest >= VIB_ALARM;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1248px] space-y-4 px-6 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-red-500/12 text-red-500 ring-1 ring-inset ring-red-500/20">
              <Siren className="size-5" />
            </span>
            <div>
              <h1 className="flex items-center gap-2 text-[22px] font-semibold leading-[30px] tracking-tight">
                SRE demo
                <span className="rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">Simulated</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                Replay an offshore equipment incident and watch an agent investigate it and propose a work order that fits the weather.
              </p>
            </div>
          </div>
          {phase !== "idle" && (
            <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <RotateCcw className="size-4" /> Reset
            </button>
          )}
        </header>

        <Panel className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const done = stage > i;
            const current = stage === i;
            return (
              <div key={s.title} className={cn("flex items-start gap-3 rounded-xl p-3 transition-colors", current && "bg-primary/10 ring-1 ring-inset ring-primary/30")}>
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                    done ? "bg-emerald-500/12 text-emerald-500 ring-emerald-500/25" : current ? "bg-primary/15 text-primary ring-primary/30" : "bg-muted text-muted-foreground ring-border",
                  )}
                >
                  {done ? <CheckCircle2 className="size-4" /> : <s.icon className="size-4" />}
                </span>
                <div>
                  <div className="text-sm font-semibold">
                    {i + 1}. {s.title}
                  </div>
                  <div className="text-xs leading-4 text-muted-foreground">{s.text}</div>
                </div>
              </div>
            );
          })}
        </Panel>

        <Panel className="p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">Gas compressor bearing failure on Titan-1</span>
                {alarmed && (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500 ring-1 ring-inset ring-red-500/20">Alarm</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Compressor {ASSET} (train B) on Platform Titan-1, 110K bbl/d and 176 people on board. A trip would cut gas lift and defer about 22K bbl/d.
              </p>
            </div>
            {phase === "idle" && (
              <button
                onClick={start}
                className="og-primary-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Play className="size-4" /> Run the replay
              </button>
            )}
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <TrendChart points={trend.slice(0, shown)} total={trend.length} latest={latest} alarmed={alarmed} idle={phase === "idle"} />

            <div ref={agentRef} className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Bot className="size-4 text-primary" /> Agent investigation
                <span className="text-[11px] font-normal text-muted-foreground">read-only tools</span>
              </div>
              {phase === "idle" || phase === "rising" ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-muted-foreground">
                  {phase === "idle" ? "Run the replay to start." : "Watching the trend. The agent is paged when the alarm fires."}
                </div>
              ) : (
                TOOLS.slice(0, tools).map((t, i) => (
                  <div key={t.call} className="rounded-lg border bg-background/40 px-2.5 py-1.5">
                    <div className="font-mono text-[11px] text-primary">
                      {i + 1}. {t.call}
                    </div>
                    <div className="mt-0.5 leading-4">{t.result}</div>
                  </div>
                ))
              )}
              {phase === "investigating" && tools < TOOLS.length && <div className="animate-pulse px-1 text-muted-foreground">Calling the next tool…</div>}
            </div>
          </div>

          {(phase === "awaiting" || phase === "approved" || phase === "rejected") && (
            <div ref={woRef} className="mt-4">
              <WorkOrder
                weather={weather}
                phase={phase}
                approver={approver}
                decidedBy={decidedBy}
                onApprover={setApprover}
                onDecide={(d) => {
                  setDecidedBy(approver.trim());
                  setPhase(d);
                }}
              />
            </div>
          )}
        </Panel>

        {cyberCard}
        <p className="text-xs text-muted-foreground">
          Scripted replay with synthetic data. Tool calls are illustrative of what an agent would read through OneRig&apos;s data tools; nothing is sent to equipment, SAP PM or Azure. The weather window comes from the{" "}
          <OpsLink to="/offshore-weather" className="text-primary hover:underline">
            Offshore Weather
          </OpsLink>{" "}
          synthetic Aurora run.
        </p>
      </div>
    </AppShell>
  );
}

function TrendChart({ points, total, latest, alarmed, idle }: { points: number[]; total: number; latest: number; alarmed: boolean; idle: boolean }) {
  const W = 520;
  const H = 180;
  const max = 10;
  const x = (i: number) => (i / (total - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const path = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold">Drive-end vibration, {ASSET}</span>
        <span className="text-muted-foreground">last 72 h</span>
        <span className={cn("num ml-auto text-lg font-semibold", alarmed ? "text-red-500" : "text-foreground")}>{idle ? "–" : `${latest.toFixed(1)} mm/s`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-[180px] w-full" preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(VIB_TRIP)} y2={y(VIB_TRIP)} stroke="#ff4d5e" strokeDasharray="4 4" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(VIB_ALARM)} y2={y(VIB_ALARM)} stroke="#f0b429" strokeDasharray="4 4" strokeWidth={1} />
        {!idle && <path d={path} fill="none" stroke={alarmed ? "#ff4d5e" : "#38bdf8"} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex gap-3 text-[10.5px] text-muted-foreground">
        <span style={{ color: "#f0b429" }}>Alarm {VIB_ALARM} mm/s</span>
        <span style={{ color: "#ff4d5e" }}>Trip {VIB_TRIP} mm/s</span>
      </div>
    </div>
  );
}

function WorkOrder({
  weather,
  phase,
  approver,
  decidedBy,
  onApprover,
  onDecide,
}: {
  weather: { supply: string; crane: string };
  phase: Phase;
  approver: string;
  decidedBy: string;
  onApprover: (v: string) => void;
  onDecide: (d: "approved" | "rejected") => void;
}) {
  const wr = "WO-T1-24117";
  const body = (
    <>
      <div className="mt-2 text-sm font-semibold">Replace drive-end bearing on gas compressor {ASSET}, Titan-1</div>
      <div className="mt-1 text-sm">
        Likely drive-end bearing wear (high confidence): a steady rise only at the drive end, bearing temperature up with it, and the same pattern as K-201A in March.
      </div>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm">
        <li>Now: reduce {ASSET} to 70% load and shift gas to train A to slow the wear. Operations to confirm.</li>
        <li>Ship the spare bearing from the Fourchon warehouse on the next supply run, before offload stops {weather.supply}.</li>
        <li>Planned 18 h outage of {ASSET} for the bearing change, crew of three, with crane lifts finished before {weather.crane}.</li>
      </ol>
      <div className="mt-1.5 text-xs text-muted-foreground">
        If it trips instead: about 22K bbl/d deferred, roughly $64K per hour at $70/bbl, with spares and crew waiting out the front.
      </div>
    </>
  );
  if (phase !== "awaiting")
    return (
      <div className={cn("rounded-xl border p-4", phase === "approved" ? "border-emerald-500/30 bg-emerald-500/8" : "border-muted-foreground/30 bg-muted/30")}>
        <div className="flex flex-wrap items-center gap-2">
          {phase === "approved" ? <ClipboardCheck className="size-4 text-emerald-500" /> : <AlertTriangle className="size-4 text-muted-foreground" />}
          <span className="font-mono text-sm font-semibold">{wr}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{phase === "approved" ? "Approved" : "Rejected"}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {phase === "approved" ? "Approved" : "Rejected"} by {decidedBy || "—"} · simulated, not sent to SAP PM
          </span>
        </div>
        {body}
      </div>
    );
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 ring-1 ring-inset ring-primary/20">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-primary" />
        <span className="text-sm font-semibold">Proposed work order</span>
        <span className="font-mono text-xs text-muted-foreground">{wr}</span>
        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500 ring-1 ring-inset ring-red-500/20">P2 · High</span>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
          Awaiting your approval
        </span>
      </div>
      {body}
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (approver.trim()) onDecide("approved");
        }}
      >
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Decision by
          <input
            value={approver}
            onChange={(e) => onApprover(e.target.value)}
            placeholder="Your name"
            className="w-44 rounded-lg border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
          />
        </label>
        <button
          type="submit"
          disabled={!approver.trim()}
          className="og-primary-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ThumbsUp className="size-4" /> Approve &amp; raise
        </button>
        <button
          type="button"
          disabled={!approver.trim()}
          onClick={() => onDecide("rejected")}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ThumbsDown className="size-4" /> Reject
        </button>
        <span className="text-[11px] text-muted-foreground">Simulated: nothing is sent to SAP PM.</span>
      </form>
    </div>
  );
}
