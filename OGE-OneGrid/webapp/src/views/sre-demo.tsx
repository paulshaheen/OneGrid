import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  Bot,
  CheckCircle2,
  Database,
  Eye,
  KeyRound,
  Loader2,
  PackageX,
  RotateCcw,
  ServerCrash,
  ShieldCheck,
  Siren,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AlertEvent {
  name: string;
  state: string;
  severity: string;
  firedAt: string | null;
  resolvedAt: string | null;
}

interface Scenario {
  id: "storage" | "deploy" | "capacity" | "sensor";
  number: string;
  name: string;
  component: string;
  breaks: string;
  symptom: string;
  fix: string;
  warning?: string;
  broken?: boolean | null;
  detail?: string;
  alertEvents?: AlertEvent[];
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
};

const ALERT_LABEL: Record<string, string> = {
  "sre-demo-01-storage-config-change": "Storage configuration changed",
  "sre-demo-01-storage-failed-requests": "Storage requests rejected",
  "sre-demo-02-pcpro-http-5xx": "HTTP 5xx errors",
  "sre-demo-03-capacity-paused": "Capacity status check failing",
  "sre-demo-04-sensor-fault": "Sensor health check failing",
};

/** Activity-log alerts are one-off events: they never resolve, so don't show them as "firing". */
const isEvent = (a: AlertEvent) => a.name.includes("config-change");

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

export function SreDemoPage() {
  const [status, setStatus] = useState<SreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Scenario | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<null | (() => void)>(null);
  const [keyInput, setKeyInput] = useState("");

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

  const active = status?.active?.split("@")[0] ?? null;
  const activeSince = status?.active?.split("@")[1];
  const activeScenario = status?.scenarios.find((s) => s.id === active);
  const firing = (activeScenario?.alertEvents ?? []).some((a) => a.state === "Fired");
  const stage = !active ? -1 : firing ? 2 : 1;

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
          {STEPS.map((s, i) => {
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
          <div className="grid gap-4 lg:grid-cols-2">
            {status.scenarios.map((s) => (
              <ScenarioCard
                key={s.id}
                s={s}
                active={active === s.id}
                otherActive={!!active && active !== s.id}
                busy={busy}
                onBreak={() => setConfirm(s)}
                onReset={() => void call("reset", s.id)}
              />
            ))}
          </div>
        )}
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500"
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

function ScenarioCard({
  s,
  active,
  otherActive,
  busy,
  onBreak,
  onReset,
}: {
  s: Scenario;
  active: boolean;
  otherActive: boolean;
  busy: string | null;
  onBreak: () => void;
  onReset: () => void;
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
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
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
