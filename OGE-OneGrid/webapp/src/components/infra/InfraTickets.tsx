import { useMemo, useState } from "react";
import { Ticket as TicketIcon, Clock, User } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  TICKETS,
  ASSET_BY_ID,
  SOURCE_BY_ID,
  CATEGORY_META,
  KIND_LABEL,
  type Ticket,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/infra/infra-data";
import { KindIcon } from "./infra-ui";
import { fmtRelTime } from "./infra-format";

const SEV_COLOR: Record<TicketSeverity, string> = {
  sev1: "#ff5a5f",
  sev2: "#f0803c",
  sev3: "#f0b429",
  sev4: "#7d8597",
};
const SEV_LABEL: Record<TicketSeverity, string> = {
  sev1: "Sev 1",
  sev2: "Sev 2",
  sev3: "Sev 3",
  sev4: "Sev 4",
};
const COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "ack", label: "Acknowledged" },
  { id: "in-progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];

export function InfraTickets({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const [sev, setSev] = useState<TicketSeverity | "all">("all");
  const filtered = useMemo(
    () => (sev === "all" ? TICKETS : TICKETS.filter((t) => t.severity === sev)),
    [sev],
  );

  const open = TICKETS.filter((t) => t.status !== "resolved");
  const breaching = open.filter((t) => t.openedMinAgo / t.slaMin >= 0.8).length;
  const sevCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of open) c[t.severity] = (c[t.severity] ?? 0) + 1;
    return c;
  }, [open]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Summary label="Open" value={open.length} />
        <Summary
          label="Breaching SLA"
          value={breaching}
          accent={breaching ? "#ff5a5f" : undefined}
        />
        {(["sev1", "sev2", "sev3", "sev4"] as TicketSeverity[]).map((s) => (
          <button
            key={s}
            onClick={() => setSev((v) => (v === s ? "all" : s))}
            className={cn(
              "rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40",
              sev === s && "ring-1 ring-primary/50",
            )}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: SEV_COLOR[s] }}
            >
              {SEV_LABEL[s]}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums leading-none text-foreground">
              {sevCounts[s] ?? 0}
            </div>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = filtered.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="flex min-h-0 flex-col rounded-xl border bg-muted/20">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-[12px] font-semibold text-foreground">{col.label}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {items.map((t) => (
                  <TicketCard key={t.id} ticket={t} onOpenAsset={onOpenAsset} />
                ))}
                {items.length === 0 && (
                  <div className="py-6 text-center text-[11px] text-muted-foreground">None</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({
  ticket: t,
  onOpenAsset,
}: {
  ticket: Ticket;
  onOpenAsset?: ((id: string) => void) | undefined;
}) {
  const asset = ASSET_BY_ID.get(t.assetId);
  const slaPct = Math.min(100, (t.openedMinAgo / t.slaMin) * 100);
  const breach = slaPct >= 100;
  const warn = slaPct >= 80;
  const slaColor =
    t.status === "resolved" ? "#3fb950" : breach ? "#ff5a5f" : warn ? "#f0b429" : "#4f8cff";
  return (
    <div
      className="rounded-lg border bg-card p-2.5"
      style={{ borderLeft: `3px solid ${SEV_COLOR[t.severity]}` }}
    >
      <div className="flex items-center gap-1.5">
        <TicketIcon className="size-3 shrink-0" style={{ color: SEV_COLOR[t.severity] }} />
        <span
          className="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
          style={{ background: `${SEV_COLOR[t.severity]}22`, color: SEV_COLOR[t.severity] }}
        >
          {SEV_LABEL[t.severity]}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-muted-foreground">{t.id}</span>
      </div>
      <div className="mt-1.5 text-[12px] font-semibold leading-snug text-foreground">{t.title}</div>
      <p className="mt-1 line-clamp-2 text-[10.5px] text-muted-foreground">{t.detail}</p>

      {asset && (
        <button
          onClick={() => onOpenAsset?.(asset.id)}
          className="mt-2 inline-flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 text-[10.5px] hover:border-primary/40 hover:bg-accent"
        >
          <span style={{ color: CATEGORY_META[asset.category].color }}>
            <KindIcon kind={asset.kind} className="size-3" />
          </span>
          <span className="text-foreground">{asset.name}</span>
          <span className="text-muted-foreground">· {KIND_LABEL[asset.kind]}</span>
        </button>
      )}

      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <User className="size-2.5" /> {t.assignee}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-2.5" /> {fmtRelTime(t.openedMinAgo)}
        </span>
        <span className="ml-auto">
          {SOURCE_BY_ID.get(t.source)?.name.split(" · ")[0] ?? t.source}
        </span>
      </div>

      {t.status !== "resolved" && (
        <div className="mt-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${slaPct}%`, background: slaColor }}
            />
          </div>
          <div className="mt-0.5 text-right text-[9px] font-medium" style={{ color: slaColor }}>
            {breach ? "SLA breached" : `${Math.round(slaPct)}% of SLA`}
          </div>
        </div>
      )}
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
  accent?: string | undefined;
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
