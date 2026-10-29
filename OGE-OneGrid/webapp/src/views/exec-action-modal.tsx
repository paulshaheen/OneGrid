// Plain-language analysis pop-up for an item on the executive brief's "Actions" layout.
// Written so anyone can follow it: what we see → what it means → what it could cost → what to do.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Lightbulb,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";

import { useOpsBase } from "@/components/ops/ops-nav";
import { formatUsd, type Action, type ExecBrief, type RiskRow } from "@/lib/exec/exec-brief";
import { AS_OF, loadSapDataset } from "@/lib/sap/sap-data";
import type { Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { getJson } from "@/report/lib/api.js";

interface AssetDetail {
  rootCause?: { tag?: string; failure_mechanism?: string } | null;
  anomalies?: Array<{
    Tag?: string;
    latest_value?: number;
    baseline_median?: number;
    anomaly_direction?: string;
  }>;
  tags?: Array<{ tag: string; desc?: string }>;
}

const DAY = 86_400_000;

function Step({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone)}>
        <Icon className="size-4" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-0.5 text-[15px] leading-6">{children}</div>
      </div>
    </li>
  );
}

/** "4 in 10" shown as ten dots. */
function ChanceDots({ pct }: { pct: number }) {
  const n = Math.max(1, Math.min(10, Math.round(pct / 10)));
  return (
    <div className="mt-2 flex items-center gap-1.5" aria-label={`About ${n} in 10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-3.5 rounded-full",
            i < n ? "bg-red-500" : "bg-muted ring-1 ring-inset ring-border",
          )}
        />
      ))}
      <span className="ml-2 text-sm font-semibold">about {n} in 10</span>
    </div>
  );
}

function hoursText(h: number | null | undefined) {
  if (h == null) return "soon";
  return h < 48 ? `in about ${Math.round(h)} hours` : `in about ${Math.round(h / 24)} days`;
}

export function ActionModal({
  action,
  row,
  brief,
  solution,
  number,
  onAsk,
  onClose,
}: {
  action: Action;
  row: RiskRow | null;
  brief: ExecBrief;
  solution: Solution;
  number: number;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const base = useOpsBase();
  const AnyLink = Link as unknown as (props: Record<string, unknown>) => ReactElement;
  const assetId = row?.kind === "equipment" ? (row.assetId ?? "") : "";

  const detail = useQuery({
    queryKey: ["exec-asset-detail", solution, assetId],
    queryFn: () => getJson(`/api/asset/${encodeURIComponent(assetId)}`) as Promise<AssetDetail>,
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000,
  });
  const sap = useQuery({
    queryKey: ["exec-sap-outages", solution],
    queryFn: async () => (await loadSapDataset(solution)).outages,
    enabled: !!assetId,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── plain-language story ────────────────────────────────────────────────
  let see: ReactNode;
  let means: ReactNode;
  let cost: ReactNode = null;

  if (row?.kind === "equipment") {
    const rc = detail.data?.rootCause ?? null;
    const tag = rc?.tag ?? detail.data?.anomalies?.[0]?.Tag;
    const anomaly =
      detail.data?.anomalies?.find((a) => a.Tag === tag) ?? detail.data?.anomalies?.[0];
    const desc = detail.data?.tags?.find((t) => t.tag === tag)?.desc;
    const now = anomaly?.latest_value;
    const normal = anomaly?.baseline_median;
    const diff =
      now != null && normal ? Math.round((Math.abs(now - normal) / Math.abs(normal)) * 100) : null;
    see = detail.isLoading ? (
      <span className="inline-flex items-center gap-2 text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin text-sky-500" /> Checking the sensors…
      </span>
    ) : desc && diff != null && diff > 0 ? (
      <>
        The <b>{desc.toLowerCase()}</b> on the {row.item} at {row.site} is{" "}
        <b>
          {diff}% {now! < normal! ? "lower" : "higher"} than normal
        </b>
        .
      </>
    ) : (
      <>
        Sensors on the {row.item} at {row.site} are showing <b>unusual readings</b>.
      </>
    );

    const end = new Date(`${AS_OF}T00:00:00Z`).getTime();
    const breakdowns = (sap.data ?? []).filter(
      (o) =>
        o.ASSET_ID === assetId &&
        o.OUTAGE_TYPE === "FORCED" &&
        new Date(o.START_DATE).getTime() >= end - 730 * DAY,
    ).length;
    means = (
      <>
        Our computer model says there is a <b>{row.pct}% chance it breaks down</b> in the next week.
        {rc?.failure_mechanism && <> The likely cause is {rc.failure_mechanism.toLowerCase()}.</>}
        {breakdowns > 0 && (
          <>
            {" "}
            It has broken down{" "}
            <b>
              {breakdowns} {breakdowns === 1 ? "time" : "times"}
            </b>{" "}
            in the last 2 years.
          </>
        )}
        {(detail.isLoading || sap.isLoading) && (
          <span
            className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin text-amber-500" />{" "}
            {sap.isLoading ? "Looking at past breakdowns…" : "Finding the likely cause…"}
          </span>
        )}
        <ChanceDots pct={row.pct} />
      </>
    );
    if (row.usd && row.pct > 0) {
      const typical = row.typicalCost ?? row.usd / (row.pct / 100);
      cost = (
        <>
          When a machine like this breaks without warning, it usually costs about{" "}
          <b>{formatUsd(typical)}</b> in repairs and lost output. With a {row.pct}% chance, about{" "}
          <b className="text-emerald-500">{formatUsd(row.usd)} is at stake</b> right now.
        </>
      );
    }
  } else if (row?.kind === "weather") {
    const w = row.weather;
    see = (
      <>
        A storm is expected to bring <b>{Math.round(w?.windMph ?? 0)} mph winds</b> to {row.site}{" "}
        {row.item.includes(" in ") ? row.item.slice(row.item.indexOf(" in ") + 1) : "soon"}.
      </>
    );
    means = (
      <>
        Winds that strong can <b>damage equipment and knock out service</b>. Our storm model rates
        the risk at <b>{row.pct} out of 100</b>.
      </>
    );
    if (row.usd)
      cost = (
        <>
          If the storm hits as forecast, we could lose about{" "}
          <b className="text-emerald-500">{formatUsd(row.usd)}</b>. Getting ready early lowers that.
        </>
      );
  } else {
    const r = brief.strip.readiness;
    see = (
      <>
        <b>
          {r.p1} urgent repair {r.p1 === 1 ? "job is" : "jobs are"}
        </b>{" "}
        still open, and {r.backlog} more are waiting in line.
      </>
    );
    means = (
      <>
        Crews busy with old jobs <b>may not be free</b> when something new breaks — or when a storm
        comes.
      </>
    );
  }

  const doIt = (
    <>
      <b>{action.title}.</b> {action.owner} should decide{" "}
      {action.due.charAt(0).toLowerCase() + action.due.slice(1)}.
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={action.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/25">
            {number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">The simple version</div>
            <h2 className="text-lg font-semibold leading-6">{action.title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <ol className="mt-5 space-y-4">
          <Step icon={Eye} title="What we see" tone="bg-sky-500/12 text-sky-500">
            {see}
          </Step>
          <Step icon={Lightbulb} title="What it means" tone="bg-amber-500/12 text-amber-500">
            {means}
          </Step>
          {cost && (
            <Step
              icon={CircleDollarSign}
              title="What it could cost"
              tone="bg-emerald-500/12 text-emerald-500"
            >
              {cost}
            </Step>
          )}
          <Step icon={CheckCircle2} title="What to do" tone="bg-primary/12 text-primary">
            {doIt}
          </Step>
        </ol>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <button
            onClick={() => {
              onAsk(action.question);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Sparkles className="size-4 text-primary" /> Ask a question
          </button>
          <AnyLink
            to={`${base}${action.to}`}
            search={action.search}
            className="og-primary-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            See the full detail <ArrowRight className="size-4" />
          </AnyLink>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Based on sensor data, the predictive maintenance model and past outages in SAP. Dollar
          figures are estimates.
        </p>
      </div>
    </div>
  );
}
