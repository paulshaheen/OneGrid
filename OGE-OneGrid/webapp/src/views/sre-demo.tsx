import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronDown,
  Database,
  Eye,
  Gauge,
  KeyRound,
  Loader2,
  PackageX,
  RotateCcw,
  ServerCrash,
  ShieldCheck,
  ShieldHalf,
  Siren,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { OpsLink } from "@/components/ops/ops-nav";
import { relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  AgentWorkOrderCard,
  LiveIncidentPanel,
  type AgentWorkOrder,
  type LiveStep,
} from "@/views/sre-live-incident";

interface AlertEvent {
  name: string;
  state: string;
  severity: string;
  firedAt: string | null;
  resolvedAt: string | null;
}

/** The agent's progress on the active scenario (from its investigation thread). */
interface ScenarioAgent {
  status: "waiting" | "paging" | "investigating" | "complete";
  threadUrl: string | null;
  updatedAt: string | null;
  proposal: AgentWorkOrder | null;
  decided: AgentWorkOrder | null;
}

interface Scenario {
  id: "storage" | "deploy" | "capacity" | "sensor" | "bearing";
  number: string;
  name: string;
  component: string;
  live?: boolean;
  /** HTTP trigger OneGrid uses to page the agent for this scenario, if any. */
  trigger?: string;
  breaks: string;
  symptom: string;
  fix: string;
  warning?: string;
  broken?: boolean | null;
  detail?: string;
  alertEvents?: AlertEvent[];
  agent?: ScenarioAgent;
}

interface SreStatus {
  enabled: boolean;
  canControl?: boolean;
  agentUrl?: string;
  active?: string | null;
  alertsError?: string | null;
  scenarios: Scenario[];
  checkedAt?: string;
}

const KEY_STORAGE = "og.sreDemoKey";
const ICON: Record<Scenario["id"], LucideIcon> = {
  storage: Database,
  deploy: PackageX,
  capacity: Zap,
  sensor: Activity,
  bearing: Gauge,
};

const ALERT_LABEL: Record<string, string> = {
  "sre-demo-01-storage-config-change": "Storage configuration changed",
  "sre-demo-01-storage-failed-requests": "Storage requests rejected",
  "sre-demo-02-pcpro-http-5xx": "HTTP 5xx errors",
  "sre-demo-03-capacity-paused": "Capacity status check failing",
  "sre-demo-04-sensor-fault": "Sensor health check failing",
  "sre-demo-05-bearing-vibration": "Turbine vibration above alarm",
};

/** Activity-log alerts are one-off events: they never resolve, so don't show them as "firing". */
const isEvent = (a: AlertEvent) => a.name.includes("config-change");

/** Scenarios shown on the page, in order. The others stay available via sre-demo.ps1. */
const VISIBLE: Scenario["id"][] = ["sensor", "bearing"];
const PRIMARY_BUTTON =
  "og-primary-control inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40";

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

const STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Zap, title: "Break it", text: "Inject one real, reversible fault into the dev site." },
  {
    icon: BellRing,
    title: "Alert fires",
    text: "Azure Monitor detects the symptom within ~5 minutes.",
  },
  {
    icon: Bot,
    title: "Agent investigates",
    text: "Azure SRE Agent gathers evidence and finds the root cause.",
  },
  {
    icon: ShieldCheck,
    title: "You approve the fix",
    text: "Review mode: nothing changes until a human approves.",
  },
];

/** Scenarios that page the agent directly from OneGrid instead of waiting for an alert. */
const STEPS_LIVE = STEPS.map((s, i) =>
  i === 1
    ? {
        ...s,
        title: "OneGrid pages the agent",
        text: "OneGrid detects it and calls Azure SRE Agent directly — seconds, not minutes.",
      }
    : i === 3
      ? {
          ...s,
          title: "You approve the work order",
          text: "Approve or reject it right on this page.",
        }
      : s,
);

export function SreDemoPage() {
  const [status, setStatus] = useState<SreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Scenario | null>(null);
  // While one scenario is running the others collapse to a one-line summary.
  const [peek, setPeek] = useState<string | null>(null);
  const [liveStep, setLiveStep] = useState<LiveStep>("idle");
  const [keyPrompt, setKeyPrompt] = useState<null | (() => void)>(null);
  const [keyInput, setKeyInput] = useState("");
  const { displayName } = useAuth();
  const approverName = displayName && displayName !== "Signed in" ? displayName : "";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sre/status", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as SreStatus);
      setError(null);
    } catch {
      // The dev site restarts during the bad-deployment scenario; keep the last status.
      setError("Reconnecting to the dev site… (it restarts during the deployment scenario)");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  const call = async (action: "inject" | "reset", scenario: string) => {
    const key = readKey();
    if (!key) {
      setKeyPrompt(() => () => void call(action, scenario));
      return;
    }
    setBusy(`${action}:${scenario}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/sre/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sre-demo-key": key },
        body: JSON.stringify({ scenario }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_STORAGE);
        setKeyPrompt(() => () => void call(action, scenario));
        setMessage({ ok: false, text: "That demo key was not accepted." });
      } else {
        setMessage({
          ok: !!body.ok,
          text: body.message ?? (res.ok ? "Done." : `Failed (${res.status}).`),
        });
      }
    } catch {
      setMessage({
        ok: true,
        text: "Request sent — the dev site is restarting. Status will refresh in a moment.",
      });
    } finally {
      setBusy(null);
      window.setTimeout(() => void load(), 2500);
    }
  };

  const decide = async (wrId: string, decision: "approve" | "reject", name: string) => {
    const key = readKey();
    if (!key) {
      setKeyPrompt(() => () => void decide(wrId, decision, name));
      return;
    }
    setBusy(`decide:${decision}`);
    setMessage(null);
    try {
      const res = await fetch("/api/sre/work-order/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sre-demo-key": key },
        body: JSON.stringify({ wr_id: wrId, decision, decided_by: name }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_STORAGE);
        setKeyPrompt(() => () => void decide(wrId, decision, name));
        setMessage({ ok: false, text: "That demo key was not accepted." });
      } else {
        setMessage({ ok: !!body.ok, text: body.message ?? `Failed (${res.status}).` });
      }
    } catch {
      setMessage({ ok: false, text: "Could not reach OneGrid — try again." });
    } finally {
      setBusy(null);
    }
  };

  const active = status?.active?.split("@")[0] ?? null;
  const activeSince = status?.active?.split("@")[1];
  useEffect(() => setPeek(null), [active]);
  const activeScenario = status?.scenarios.find((s) => s.id === active);
  const firing = (activeScenario?.alertEvents ?? []).some((a) => a.state === "Fired");
  // The live scenario knows its own progress (alert for this run, proposal, approval).
  const LIVE_STAGE: Record<LiveStep, number> = {
    idle: 0,
    running: 1,
    investigating: 2,
    awaiting: 3,
    done: 4,
  };
  const stage = !active
    ? -1
    : activeScenario?.live
      ? LIVE_STAGE[liveStep]
      : scenarioStage(firing, activeScenario?.agent);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1248px] space-y-4 px-6 py-5">
        {/* header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-red-500/12 text-red-500 ring-1 ring-inset ring-red-500/20">
              <Siren className="size-5" />
            </span>
            <div>
              <h1 className="text-[22px] font-semibold leading-[30px] tracking-tight">SRE demo</h1>
              <p className="text-sm text-muted-foreground">
                Break the dev site on purpose and watch Azure SRE Agent detect, investigate and fix
                it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.agentUrl && (
              <a
                href={status.agentUrl}
                target="_blank"
                rel="noreferrer"
                className="og-primary-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Bot className="size-4" /> Open SRE Agent <ArrowUpRight className="size-3.5" />
              </a>
            )}
            {status?.enabled && (
              <button
                onClick={() => void call("reset", "all")}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                <RotateCcw className="size-4" /> Reset everything
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
            <Loader2 className="size-4 animate-spin text-amber-500" /> {error}
          </div>
        )}
        {message && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm",
              message.ok
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-red-500/30 bg-red-500/10",
            )}
          >
            {message.ok ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="size-4 text-red-500" />
            )}
            {message.text}
          </div>
        )}

        {/* flow */}
        <Panel className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          {(activeScenario?.live || activeScenario?.trigger ? STEPS_LIVE : STEPS).map((s, i) => {
            const done = stage > i;
            const current = stage === i;
            return (
              <div
                key={s.title}
                className={cn(
                  "flex items-start gap-3 rounded-xl p-3 transition-colors",
                  current && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                    done
                      ? "bg-emerald-500/12 text-emerald-500 ring-emerald-500/25"
                      : current
                        ? "bg-primary/15 text-primary ring-primary/30"
                        : "bg-muted text-muted-foreground ring-border",
                  )}
                >
                  {current ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <s.icon className="size-4" />
                  )}
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {active ? (
              <>
                Active scenario: <b className="text-foreground">{activeScenario?.name ?? active}</b>
                {activeSince && <> · started {relativeTime(activeSince)}</>}
              </>
            ) : (
              "No scenario active — everything should be healthy."
            )}
          </span>
          {status?.checkedAt && (
            <span>Checked {relativeTime(status.checkedAt)} · refreshes every 15 s</span>
          )}
        </div>

        {!status ? (
          <Panel className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the SRE demo…
          </Panel>
        ) : !status.enabled ? (
          <Panel className="p-6 text-sm text-muted-foreground">
            The SRE demo isn&apos;t enabled on this deployment. It runs on the dev site only.
          </Panel>
        ) : (
          <div className="space-y-4">
            {VISIBLE.map((id) => status.scenarios.find((s) => s.id === id))
              .filter((s): s is Scenario => !!s)
              .sort((a, b) => Number(b.id === active) - Number(a.id === active))
              .map((s) =>
                active && active !== s.id && peek !== s.id ? (
                  <CollapsedScenario key={s.id} s={s} onExpand={() => setPeek(s.id)} />
                ) : s.live ? (
                  <LiveIncidentPanel
                    key={s.id}
                    alertEvents={s.alertEvents ?? []}
                    busy={busy}
                    otherActive={!!active && active !== s.id}
                    defaultApprover={approverName}
                    onStart={() => void call("inject", s.id)}
                    onReset={() => void call("reset", s.id)}
                    onDecide={(wrId, decision, name) => void decide(wrId, decision, name)}
                    onProgress={setLiveStep}
                  />
                ) : (
                  <ScenarioCard
                    key={s.id}
                    s={s}
                    active={active === s.id}
                    otherActive={!!active && active !== s.id}
                    busy={busy}
                    defaultApprover={approverName}
                    onBreak={() => setConfirm(s)}
                    onReset={() => void call("reset", s.id)}
                    onDecide={(wrId, decision, name) => void decide(wrId, decision, name)}
                  />
                ),
              )}
          </div>
        )}
        <CyberTabletopCard />
        {status?.alertsError && (
          <p className="text-xs text-muted-foreground">Alerts unavailable: {status.alertsError}</p>
        )}
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)} title={`Break: ${confirm.name}`}>
          <p className="text-sm leading-6">{confirm.breaks}</p>
          {confirm.warning && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> {confirm.warning}
            </div>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            You can reset it at any time from this page.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setConfirm(null)}
              className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const s = confirm;
                setConfirm(null);
                void call("inject", s.id);
              }}
              className={PRIMARY_BUTTON}
            >
              <Zap className="size-4" /> Break it
            </button>
          </div>
        </Modal>
      )}

      {keyPrompt && (
        <Modal onClose={() => setKeyPrompt(null)} title="Demo key required">
          <p className="text-sm text-muted-foreground">
            Breaking or resetting the dev site needs the SRE demo key. It is kept for this browser
            tab only.
          </p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!keyInput.trim()) return;
              sessionStorage.setItem(KEY_STORAGE, keyInput.trim());
              setKeyInput("");
              const next = keyPrompt;
              setKeyPrompt(null);
              next();
            }}
          >
            <span className="relative flex-1">
              <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="password"
                autoFocus
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/60"
                placeholder="Demo key"
              />
            </span>
            <button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              Continue
            </button>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}

function CollapsedScenario({ s, onExpand }: { s: Scenario; onExpand: () => void }) {
  const Icon = ICON[s.id];
  return (
    <Panel className="flex items-center gap-3 px-5 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <span className="text-xs text-muted-foreground">Scenario {s.number} · </span>
        <span className="font-medium">{s.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          Paused while another scenario runs
        </span>
      </div>
      <button
        onClick={onExpand}
        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
      >
        Show <ChevronDown className="size-3.5" />
      </button>
    </Panel>
  );
}

/** Steps for alert-driven scenarios: alert → agent investigates → you decide → done. */
function scenarioStage(firing: boolean, agent?: ScenarioAgent): number {
  if (agent?.decided) return 4;
  if (agent?.proposal || agent?.status === "complete") return 3;
  if (firing || agent?.status === "investigating") return 2;
  return 1;
}

/** Cyber scenario: a scripted tabletop on the Cyber Readiness page (it doesn't touch Azure). */
function CyberTabletopCard() {
  return (
    <Panel className="flex flex-wrap items-center gap-3 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <ShieldHalf className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Cyber: historian tampering</span>
          <span className="rounded border border-violet-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
            Tabletop
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Fourteen plant sensors freeze in the same second. OneGrid weighs tampering against equipment and network
          failures, operators approve every action, and the incident commander gets a handoff package for outside
          responders. Synthetic exercise; no Microsoft engagement is initiated and nothing in Azure is changed.
        </p>
      </div>
      <OpsLink to="/cyber-readiness" hash="tabletop" className={PRIMARY_BUTTON}>
        Run the tabletop
      </OpsLink>
    </Panel>
  );
}

function ScenarioCard({
  s,
  active,
  otherActive,
  busy,
  defaultApprover,
  onBreak,
  onReset,
  onDecide,
}: {
  s: Scenario;
  active: boolean;
  otherActive: boolean;
  busy: string | null;
  defaultApprover: string;
  onBreak: () => void;
  onReset: () => void;
  onDecide: (wrId: string, decision: "approve" | "reject", name: string) => void;
}) {
  const Icon = ICON[s.id];
  const state = s.broken == null ? "unknown" : s.broken ? "broken" : "healthy";
  const working = busy?.endsWith(`:${s.id}`) || busy === "reset:all";
  const alerts = (s.alertEvents ?? []).slice(0, 4);
  return (
    <Panel
      className={cn(
        "flex flex-col p-5",
        state === "broken" && "border-red-500/40 ring-1 ring-inset ring-red-500/20",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
            state === "broken"
              ? "bg-red-500/12 text-red-500 ring-red-500/25"
              : "bg-primary/12 text-primary ring-primary/20",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground">
            Scenario {s.number} · {s.component}
          </div>
          <div className="text-base font-semibold leading-6">{s.name}</div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
            state === "broken"
              ? "bg-red-500/10 text-red-500 ring-red-500/25"
              : state === "healthy"
                ? "bg-emerald-500/10 text-emerald-500 ring-emerald-500/25"
                : "bg-muted text-muted-foreground ring-border",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "broken"
                ? "bg-red-500"
                : state === "healthy"
                  ? "bg-emerald-500"
                  : "bg-muted-foreground",
            )}
          />
          {state === "broken" ? "Broken" : state === "healthy" ? "Healthy" : "Unknown"}
        </span>
      </div>
      <div className="mt-1 pl-[52px] text-xs text-muted-foreground">{s.detail}</div>

      <dl className="mt-4 space-y-2.5 text-sm">
        <Fact icon={ServerCrash} label="What breaks" text={s.breaks} />
        <Fact icon={Eye} label="What you'll see" text={s.symptom} />
        <Fact icon={Wrench} label="Expected fix" text={s.fix} />
      </dl>
      {s.warning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> {s.warning}
        </div>
      )}

      {active && s.agent && (
        <AgentProgress
          agent={s.agent}
          firing={(s.alertEvents ?? []).some((a) => a.state === "Fired")}
          busy={busy}
          defaultApprover={defaultApprover}
          onDecide={onDecide}
        />
      )}

      <div className="mt-4 border-t pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <BellRing className="size-3.5" /> Alerts (last 24 h)
        </div>
        {alerts.length ? (
          <ul className="space-y-1">
            {alerts.map((a, i) => (
              <li key={`${a.name}-${a.firedAt}-${i}`} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    isEvent(a)
                      ? "bg-amber-500"
                      : a.state === "Fired"
                        ? "bg-red-500"
                        : "bg-emerald-500",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{ALERT_LABEL[a.name] ?? a.name}</span>
                <span
                  className={
                    isEvent(a)
                      ? "text-amber-500"
                      : a.state === "Fired"
                        ? "font-semibold text-red-500"
                        : "text-muted-foreground"
                  }
                >
                  {isEvent(a) ? "Logged" : a.state === "Fired" ? "Firing" : "Resolved"}
                </span>
                <span className="w-16 shrink-0 text-right text-muted-foreground">
                  {a.firedAt ? relativeTime(a.firedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No alerts.</p>
        )}
      </div>

      <div className="mt-auto flex gap-2 pt-4">
        <button
          onClick={onBreak}
          disabled={!!busy || otherActive || state === "broken"}
          title={otherActive ? "Another scenario is active — reset it first." : undefined}
          className={cn(PRIMARY_BUTTON, "flex-1")}
        >
          {working && busy?.startsWith("inject") ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          Break it
        </button>
        <button
          onClick={onReset}
          disabled={!!busy || (state === "healthy" && !active)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {working && busy?.startsWith("reset") ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Reset
        </button>
      </div>
    </Panel>
  );
}

/** What Azure SRE Agent is doing about the active scenario, and its work order if any. */
function AgentProgress({
  agent,
  firing,
  busy,
  defaultApprover,
  onDecide,
}: {
  agent: ScenarioAgent;
  firing: boolean;
  busy: string | null;
  defaultApprover: string;
  onDecide: (wrId: string, decision: "approve" | "reject", name: string) => void;
}) {
  const wo = agent.decided && agent.decided.wr_status !== "Rejected" ? agent.decided : null;
  const rejected = agent.decided?.wr_status === "Rejected" ? agent.decided : null;
  const text = rejected
    ? `Proposed work order ${rejected.wr_id} was rejected by ${rejected.approved_by || "a reviewer"}.`
    : agent.status === "complete"
      ? agent.proposal
        ? "Investigation complete — the agent proposed a work order for your approval."
        : "Investigation complete — review the agent's findings and recommended fix."
      : agent.status === "investigating"
        ? "Azure SRE Agent is investigating…"
        : agent.status === "paging"
          ? "OneGrid paged Azure SRE Agent — it is opening the investigation…"
          : firing
            ? "Alert fired — the agent picks it up within a minute."
            : "Waiting for Azure Monitor to raise the alert (up to ~5 minutes).";
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Bot className="size-3.5" /> Azure SRE Agent
      </div>
      {wo || agent.proposal ? (
        <AgentWorkOrderCard
          wo={wo}
          proposal={agent.proposal}
          threadUrl={agent.threadUrl}
          busy={busy}
          defaultApprover={defaultApprover}
          onDecide={onDecide}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            {agent.status === "complete" ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <Loader2 className="size-4 animate-spin text-primary" />
            )}
            {text}
          </span>
          {agent.threadUrl && (
            <a
              href={agent.threadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              View agent investigation <ArrowUpRight className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, text }: { icon: LucideIcon; label: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
        <dd className="leading-5">{text}</dd>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-accent">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
