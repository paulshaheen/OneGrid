import { useEffect } from "react";
import {
  X,
  AlertTriangle,
  Activity,
  Wrench,
  ArrowRight,
  Clock,
  Users,
  ShieldAlert,
  FileText,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSET_BY_ID,
  CATEGORY_META,
  STATUS_COLOR,
  KIND_LABEL,
  OUTAGE_STATUS_META,
  TICKETS,
  seedLogs,
  type Outage,
  type OutageEvent,
} from "@/lib/infra/infra-data";
import { useLiveTick, liveValue } from "@/lib/infra/infra-live";
import { KindIcon, StatusDot } from "./infra-ui";
import { fmtNum } from "./infra-format";

const SEV_COLOR: Record<string, string> = {
  sev1: "#ff5a5f",
  sev2: "#f0803c",
  sev3: "#f0b429",
  sev4: "#7d8597",
};
const EVENT_META: Record<OutageEvent["kind"], { color: string; label: string }> = {
  signal: { color: "#4f8cff", label: "Signal" },
  event: { color: "#ff5a5f", label: "Event" },
  action: { color: "#3fb950", label: "Action" },
};

function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function OutageRca({
  outage,
  onOpenAsset,
  onClose,
}: {
  outage: Outage;
  onOpenAsset?: ((id: string) => void) | undefined;
  onClose: () => void;
}) {
  useLiveTick();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sev = SEV_COLOR[outage.severity];
  const sm = OUTAGE_STATUS_META[outage.status];
  const rootCause = ASSET_BY_ID.get(outage.rootCauseAssetId);
  const ticket = outage.relatedTicketId
    ? TICKETS.find((t) => t.id === outage.relatedTicketId)
    : undefined;
  const logs = seedLogs()
    .filter((l) => outage.impactedAssetIds.includes(l.assetId) || outage.chain.includes(l.assetId))
    .slice(0, 5);

  const openAsset = (id: string) => {
    onOpenAsset?.(id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* header */}
        <div
          className="flex items-start justify-between gap-3 border-b p-4"
          style={{ background: `linear-gradient(90deg, ${sev}14, transparent)` }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: `${sev}22`, color: sev }}
              >
                {outage.severity}
              </span>
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: `${sm.color}22`, color: sm.color }}
              >
                {outage.status === "active" && (
                  <span
                    className="size-1.5 animate-pulse rounded-full"
                    style={{ background: sm.color }}
                  />
                )}
                {sm.label}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{outage.id}</span>
            </div>
            <h2 className="mt-1 text-[16px] font-semibold text-foreground">{outage.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> Started {fmtMin(outage.startedMinAgo)} ago
                {outage.durationMin ? ` · ${fmtMin(outage.durationMin)} to resolve` : " · ongoing"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" /> ~{outage.estUsers} users
              </span>
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="size-3" /> SLA {fmtMin(outage.slaMin)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* impact */}
          <div className="flex flex-wrap gap-1.5">
            {outage.affectedServices.map((s) => (
              <span
                key={s}
                className="rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
              >
                {s}
              </span>
            ))}
          </div>

          {/* root cause */}
          <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
              <AlertTriangle className="size-3.5" /> Probable root cause
            </div>
            {rootCause && (
              <button
                onClick={() => openAsset(rootCause.id)}
                className="mb-1.5 inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1 hover:border-primary/40"
              >
                <span
                  className="grid size-6 place-items-center rounded-md"
                  style={{
                    background: `${CATEGORY_META[rootCause.category].color}1f`,
                    color: CATEGORY_META[rootCause.category].color,
                  }}
                >
                  <KindIcon kind={rootCause.kind} className="size-3.5" />
                </span>
                <span className="text-[12.5px] font-semibold text-foreground">
                  {rootCause.name}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  {KIND_LABEL[rootCause.kind]}
                </span>
              </button>
            )}
            <p className="text-[12px] leading-relaxed text-foreground/90">
              {outage.rootCauseSummary}
            </p>
          </section>

          {/* causal chain */}
          <section>
            <SectionTitle icon={ArrowRight}>Causal chain · blast radius</SectionTitle>
            <div className="flex flex-wrap items-stretch gap-1.5">
              {outage.chain.map((id, i) => {
                const a = ASSET_BY_ID.get(id);
                if (!a) return null;
                const isRoot = i === 0;
                const isImpact = i === outage.chain.length - 1;
                return (
                  <div key={id} className="flex items-center gap-1.5">
                    <button
                      onClick={() => openAsset(id)}
                      className={cn(
                        "flex w-36 flex-col gap-1 rounded-lg border bg-muted/20 p-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
                      )}
                      style={{
                        borderColor: isRoot ? "#ff5a5f55" : isImpact ? "#f0b42955" : undefined,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="grid size-5 place-items-center rounded"
                          style={{
                            background: `${CATEGORY_META[a.category].color}1f`,
                            color: CATEGORY_META[a.category].color,
                          }}
                        >
                          <KindIcon kind={a.kind} className="size-3" />
                        </span>
                        <StatusDot status={a.status} size={6} />
                        {isRoot && (
                          <span className="ml-auto text-[8.5px] font-bold uppercase text-red-400">
                            cause
                          </span>
                        )}
                        {isImpact && (
                          <span className="ml-auto text-[8.5px] font-bold uppercase text-amber-400">
                            impact
                          </span>
                        )}
                      </div>
                      <span className="truncate text-[11.5px] font-semibold text-foreground">
                        {a.name}
                      </span>
                      <span className="truncate text-[9.5px] text-muted-foreground">
                        {KIND_LABEL[a.kind]}
                      </span>
                    </button>
                    {i < outage.chain.length - 1 && (
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* timeline */}
            <section>
              <SectionTitle icon={Activity}>Timeline</SectionTitle>
              <ol className="relative space-y-2.5 border-l border-border pl-4">
                {outage.timeline.map((e, i) => {
                  const em = EVENT_META[e.kind];
                  const a = e.assetId ? ASSET_BY_ID.get(e.assetId) : undefined;
                  return (
                    <li key={i} className="relative">
                      <span
                        className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-card"
                        style={{ background: em.color }}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                          T-{fmtMin(e.tMinAgo)}
                        </span>
                        <span
                          className="rounded px-1 py-0.5 text-[8.5px] font-bold uppercase"
                          style={{ background: `${em.color}1f`, color: em.color }}
                        >
                          {em.label}
                        </span>
                        {a && (
                          <button
                            onClick={() => openAsset(a.id)}
                            className="truncate text-[10.5px] font-medium text-primary hover:underline"
                          >
                            {a.name}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-foreground/90">{e.message}</p>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* evidence */}
            <section>
              <SectionTitle icon={ShieldAlert}>Evidence</SectionTitle>
              <div className="space-y-1.5">
                {outage.evidence.map((ev, i) => {
                  const a = ASSET_BY_ID.get(ev.assetId);
                  const metric =
                    a && ev.metricKey ? a.metrics.find((m) => m.key === ev.metricKey) : undefined;
                  const live = metric ? liveValue(ev.assetId, metric.key) : null;
                  return (
                    <div key={i} className="rounded-lg border bg-muted/20 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => a && openAsset(a.id)}
                          className="truncate text-[11.5px] font-medium text-foreground hover:underline"
                        >
                          {a?.name ?? ev.assetId}
                        </button>
                        {metric && live !== null && (
                          <span
                            className="shrink-0 text-[12px] font-bold tabular-nums"
                            style={{ color: STATUS_COLOR.warning }}
                          >
                            {fmtNum(live)}
                            <span className="ml-0.5 text-[9.5px] font-normal text-muted-foreground">
                              {metric.unit}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground">{ev.note}</div>
                    </div>
                  );
                })}
                {logs.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-muted/10 p-2">
                    <div className="mb-1 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <FileText className="size-3" /> Correlated log lines
                    </div>
                    <div className="space-y-0.5 font-mono text-[10px]">
                      {logs.map((l) => (
                        <div key={l.id} className="truncate text-muted-foreground">
                          <span
                            style={{
                              color:
                                l.level === "critical" || l.level === "error"
                                  ? "#ff5a5f"
                                  : l.level === "warn"
                                    ? "#f0b429"
                                    : "#7d8597",
                            }}
                          >
                            [{l.level}]
                          </span>{" "}
                          {l.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* remediation */}
          <section className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <SectionTitle icon={Wrench}>Recommended remediation</SectionTitle>
            <ul className="space-y-1.5">
              {outage.remediation.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/90">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
                    {i + 1}
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* footer */}
        {ticket && (
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <button
              onClick={() => openAsset(ticket.assetId)}
              className="text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              Linked incident <span className="font-mono text-foreground">{ticket.id}</span> ·{" "}
              {ticket.assignee}
            </button>
            <button
              onClick={onClose}
              className="rounded-md border px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-accent"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" /> {children}
    </div>
  );
}
