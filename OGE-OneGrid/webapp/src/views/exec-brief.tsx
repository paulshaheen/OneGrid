import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  CloudLightning,
  CloudSun,
  Cog,
  Container,
  CornerDownLeft,
  Droplets,
  Fan,
  Flame,
  Gauge,
  Info,
  LayoutDashboard,
  ListChecks,
  Sparkles,
  User,
  Wind,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { AppShell } from "@/components/ops/AppShell";
import { PageLoading } from "@/components/ops/PageLoading";
import { useOpsBase } from "@/components/ops/ops-nav";
import {
  buildExecBrief,
  formatUsd,
  outageCostBasis,
  type Action,
  type BriefStatus,
  type ExposureRow,
  type FleetAssetRow,
  type FleetHealth,
  type PostureSummary,
  type RiskLevel3,
  type RiskRow,
  type Tone,
  type WorkOrderSummary,
} from "@/lib/exec/exec-brief";
import { relativeTime } from "@/lib/format";
import { postureQuery, useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { loadSapDataset } from "@/lib/sap/sap-data";
import { solutionBrand, useSolution, type Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { useApi } from "@/report/lib/api.js";
import { ExecActions } from "@/views/exec-actions";
import { subjectFromRow, type EvidenceSubject } from "@/lib/exec/evidence";
import { EvidenceModal } from "@/views/exec-evidence-modal";
import { RiskDetail } from "@/views/exec-risk-detail";
import { ExecScorecard } from "@/views/exec-scorecard";

const HORIZON_HOURS = 120;

const STATUS: Record<BriefStatus, { label: string; cls: string; dot: string }> = {
  act: {
    label: "Action needed",
    cls: "bg-red-500/10 text-red-500 ring-red-500/25",
    dot: "bg-red-500",
  },
  watch: {
    label: "Watch",
    cls: "bg-amber-500/10 text-amber-500 ring-amber-500/25",
    dot: "bg-amber-500",
  },
  clear: {
    label: "All clear",
    cls: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
};

// Icon chip tint per tone (background + icon colour).
const CHIP: Record<Tone, string> = {
  good: "bg-emerald-500/12 text-emerald-500 ring-emerald-500/20",
  warn: "bg-amber-500/12 text-amber-500 ring-amber-500/20",
  bad: "bg-red-500/12 text-red-500 ring-red-500/20",
  neutral: "bg-primary/12 text-primary ring-primary/20",
};

const BAR: Record<RiskLevel3, string> = {
  critical: "bg-gradient-to-r from-red-500/70 to-red-500",
  high: "bg-gradient-to-r from-amber-500/70 to-amber-500",
  watch: "bg-gradient-to-r from-sky-500/70 to-sky-500",
};
const LEVEL_TEXT: Record<RiskLevel3, string> = {
  critical: "text-red-500",
  high: "text-amber-500",
  watch: "text-sky-500",
};

function equipmentIcon(text: string): LucideIcon {
  const s = text.toLowerCase();
  if (s.includes("weather")) return CloudLightning;
  if (/boiler|fired|furnace|heater/.test(s)) return Flame;
  if (/compressor/.test(s)) return Wind;
  if (/turbine|fan|blower/.test(s)) return Fan;
  if (/generator|genset|alternator|electrical/.test(s)) return Zap;
  if (/pump|wellhead/.test(s)) return Droplets;
  if (/separator|skid|metering|process|vessel|tank|column|static/.test(s)) return Container;
  if (/motor|drive|gear|bearing|rotating/.test(s)) return Cog;
  return Gauge;
}

function ask(message: string) {
  // `direct` routes straight to the grounded model (no keyword shortcuts).
  window.dispatchEvent(new CustomEvent("onegrid-ask", { detail: { message, direct: true } }));
}

function IconChip({
  icon: Icon,
  tone,
  size = "md",
}: {
  icon: LucideIcon;
  tone: Tone;
  size?: "md" | "lg";
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl ring-1 ring-inset",
        size === "lg" ? "size-11" : "size-9",
        CHIP[tone],
      )}
    >
      <Icon className={size === "lg" ? "size-5" : "size-[18px]"} strokeWidth={2} />
    </span>
  );
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

function SectionTitle({
  icon: Icon,
  children,
  aside,
}: {
  icon: LucideIcon;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold leading-[22px]">
        <Icon className="size-4 text-muted-foreground" strokeWidth={2} />
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function ExecBriefPage() {
  const base = useOpsBase();
  const solution = useSolution();
  const brand = solutionBrand(solution);
  const snap = useOpsSnapshot(base, HORIZON_HOURS);
  const postures = useQuery(postureQuery(base));
  const exposure = useApi("/api/exposure") as { data: ExposureRow[] | null };
  const fleet = useApi("/api/fleet-assets") as {
    data: FleetAssetRow[] | null;
    loading: boolean;
    error: string | null;
  };
  const fleetHealth = useApi("/api/fleet-health") as {
    data: FleetHealth | null;
    error: string | null;
  };
  const wo = useApi("/api/work-orders-summary") as {
    data: WorkOrderSummary | null;
    error: string | null;
  };
  const sap = useQuery({
    queryKey: ["exec-sap-basis", solution],
    queryFn: async () => outageCostBasis((await loadSapDataset(solution)).outages),
    staleTime: 60 * 60 * 1000,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const search = useSearch({ strict: false }) as { layout?: string };
  const navigate = useNavigate();
  const layout: Layout =
    search.layout === "actions" || search.layout === "scorecard" ? search.layout : "dashboard";
  const setLayout = (next: Layout) =>
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        layout: next === "dashboard" ? undefined : next,
      }),
      replace: true,
    } as never);
  const [evidence, setEvidence] = useState<{
    subject: EvidenceSubject;
    action?: Action | null;
  } | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [question, setQuestion] = useState("");

  const loading = snap.isLoading || fleet.loading || sap.isLoading;
  const dataGaps = useMemo(
    () =>
      [
        fleet.error ? "equipment health" : null,
        fleetHealth.error ? "fleet health score" : null,
        wo.error ? "work orders" : null,
        sap.isError ? "SAP outage history" : null,
      ].filter((g): g is string => !!g),
    [fleet.error, fleetHealth.error, wo.error, sap.isError],
  );
  const brief = useMemo(
    () =>
      buildExecBrief({
        solution,
        assets: snap.assets,
        risks: snap.risks,
        event: snap.event,
        exposure: exposure.data,
        fleet: fleet.data,
        fleetHealth: fleetHealth.data,
        workOrders: wo.data,
        sap: sap.data ?? null,
        postures: postures.data ?? null,
        horizonHours: HORIZON_HOURS,
        nowIso: new Date().toISOString(),
        dataGaps,
      }),
    [
      solution,
      snap.assets,
      snap.risks,
      snap.event,
      exposure.data,
      fleet.data,
      fleetHealth.data,
      wo.data,
      sap.data,
      postures.data,
      dataGaps,
    ],
  );

  if (loading) {
    return (
      <AppShell variant="exec">
        <PageLoading label="Preparing the executive brief…" />
      </AppShell>
    );
  }

  const st = STATUS[brief.status];
  const equipmentGap = brief.dataGaps.some((g) => /equipment/i.test(g));
  const selected = brief.risks.find((r) => r.key === selectedKey) ?? brief.risks[0] ?? null;
  const placeholder = selected
    ? `Ask ${brand.name} — e.g. “${selected.action.question}”`
    : `Ask ${brand.name} about the ${solution === "og" ? "estate" : "grid"}, weather or equipment…`;

  return (
    <AppShell variant="exec">
      <div className="mx-auto w-full max-w-[1248px] space-y-3.5 px-6 py-5">
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold leading-[30px] tracking-tight">
                {brief.title}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                  st.cls,
                )}
              >
                <span className={cn("size-1.5 rounded-full", st.dot)} />
                {st.label}
              </span>
            </div>
            {layout === "dashboard" && (
              <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
                {brief.summary}
              </p>
            )}
          </div>
          <div className="relative flex shrink-0 items-center gap-3 pt-1 text-xs text-muted-foreground">
            <span
              className="inline-flex overflow-hidden rounded-full border"
              role="group"
              aria-label="Layout"
            >
              {(
                [
                  ["dashboard", "Dashboard", LayoutDashboard],
                  ["actions", "Actions", ListChecks],
                  ["scorecard", "Scorecard", BarChart3],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  onClick={() => setLayout(value)}
                  aria-pressed={layout === value}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 font-semibold transition-colors",
                    layout === value
                      ? "bg-foreground/90 text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" /> Updated {relativeTime(brief.asOfIso)}
            </span>
            <button
              onClick={() => setShowInfo((s) => !s)}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Info className="size-3.5" /> Sources
            </button>
            {showInfo && (
              <div className="absolute right-0 top-9 z-40 w-[420px] rounded-xl border bg-popover p-4 text-[13px] leading-5 text-popover-foreground shadow-2xl">
                <div className="mb-2 flex items-center justify-between font-semibold">
                  Where these numbers come from
                  <button
                    onClick={() => setShowInfo(false)}
                    aria-label="Close"
                    className="rounded p-0.5 hover:bg-accent"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {brief.sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                {brief.money && (
                  <>
                    <div className="mb-1 mt-3 font-semibold">How cost at risk is estimated</div>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                      {brief.money.basis.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                      <li>Demo estimate for discussion, not a financial forecast.</li>
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {brief.dataGaps.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <span className="font-semibold">Some data couldn&apos;t be loaded: </span>
              {brief.dataGaps.join(", ")}. Figures below may be incomplete — the operations team has
              been alerted.
            </div>
          </div>
        )}

        {layout === "actions" ? (
          <ExecActions brief={brief} brandName={brand.name} solution={solution} onAsk={ask} />
        ) : layout === "scorecard" ? (
          <ExecScorecard
            solution={solution}
            fleet={fleet.data ?? []}
            healthScore={brief.strip.health.score}
            onEvidence={(subject) => setEvidence({ subject })}
          />
        ) : (
          <>
            {/* ── status strip ───────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StripCell icon={Activity} tone={brief.strip.health.tone} label="Fleet health">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums leading-7">
                    {brief.strip.health.score ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <HealthBullet score={brief.strip.health.score} />
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {equipmentGap
                    ? "Data unavailable"
                    : `${brief.strip.health.critical} critical of ${brief.strip.health.monitored} assets monitored`}
                </div>
              </StripCell>
              <StripCell
                icon={brief.strip.weather.active ? CloudLightning : CloudSun}
                tone={brief.strip.weather.tone}
                label="Weather & response posture"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-2xl font-semibold leading-7">
                    {brief.strip.weather.value}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-semibold",
                      POSTURE_TEXT[brief.strip.weather.posture.level],
                    )}
                  >
                    {brief.strip.weather.posture.label}
                  </span>
                </div>
                <PostureLadder posture={brief.strip.weather.posture} />
                <div className="mt-1.5 truncate text-xs text-muted-foreground">
                  {brief.strip.weather.posture.next
                    ? `Next gate ${brief.strip.weather.posture.next.gate} at ${brief.strip.weather.posture.next.site} · ${brief.strip.weather.posture.next.label} · due in ${Math.round(brief.strip.weather.posture.next.dueHours)} h`
                    : `${brief.strip.weather.detail.replace(/ · \d+-day outlook$/, "")} · no gates active`}
                </div>
              </StripCell>
              <StripCell icon={Wrench} tone={brief.strip.readiness.tone} label="Crew readiness">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tabular-nums leading-7">
                    {brief.strip.readiness.p1}
                  </span>
                  <span className="text-sm text-muted-foreground">priority-1 work orders</span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {brief.strip.readiness.open} open · {brief.strip.readiness.backlog} in backlog
                </div>
              </StripCell>
            </div>

            {/* ── risk + recommended action ─────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel className="p-5 lg:col-span-8">
                <SectionTitle
                  icon={AlertTriangle}
                  aside={
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {(["critical", "high", "watch"] as const).map((l) => (
                        <span key={l} className="inline-flex items-center gap-1.5 capitalize">
                          <span className={cn("size-2 rounded-full", BAR[l])} />
                          {l}
                        </span>
                      ))}
                      <span className="hidden xl:inline">· select a row for the action</span>
                    </span>
                  }
                >
                  Where risk is concentrated
                </SectionTitle>
                {brief.risks.length ? (
                  <>
                    <div className="mt-4 grid grid-cols-[minmax(0,15rem)_1fr_5.5rem_1rem] items-center gap-x-4 px-3 pb-1.5 text-[11px] font-medium text-muted-foreground">
                      <span>Site · asset</span>
                      <span className="flex justify-between tabular-nums">
                        <span>0%</span>
                        <span>25%</span>
                        <span>50%</span>
                        <span>75%</span>
                        <span>100%</span>
                      </span>
                      <span className="text-right">Typical cost</span>
                      <span />
                    </div>
                    <ul className="space-y-1">
                      {brief.risks.map((r) => (
                        <RiskRowView
                          key={r.key}
                          row={r}
                          solution={solution}
                          selected={selected?.key === r.key}
                          expanded={expandedKey === r.key}
                          onSelect={() => {
                            setSelectedKey(r.key);
                            setExpandedKey((k) => (k === r.key ? null : r.key));
                          }}
                          onEvidence={() =>
                            setEvidence({ subject: subjectFromRow(r), action: r.action })
                          }
                        />
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="mt-6 flex items-center gap-3 rounded-xl bg-emerald-500/8 p-4 text-sm">
                    <IconChip
                      icon={equipmentGap ? AlertTriangle : Activity}
                      tone={equipmentGap ? "warn" : "good"}
                    />
                    {equipmentGap
                      ? "Equipment data is unavailable, so risks can't be ranked right now."
                      : "Nothing needs executive attention right now."}
                  </div>
                )}
              </Panel>

              <ActionPanel
                row={selected}
                followUp={brief.followUp}
                brandName={brand.name}
                onEvidence={(subject, action) => setEvidence({ subject, action })}
              />
            </div>

            {/* ── financial context ─────────────────────────────────── */}
            <Panel className="grid gap-5 px-5 py-4 md:grid-cols-12">
              <div className="flex items-start gap-3 md:col-span-4">
                <IconChip icon={CircleDollarSign} tone="neutral" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Cost at risk · {brief.money?.horizon ?? `next ${HORIZON_HOURS / 24} days`}
                  </div>
                  <div className="mt-0.5 text-2xl font-semibold tabular-nums leading-8">
                    {brief.money
                      ? `${formatUsd(brief.money.low)} – ${formatUsd(brief.money.high)}`
                      : equipmentGap
                        ? "Unavailable"
                        : "Minimal"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {brief.money
                      ? "Typical to severe outcome · model estimate"
                      : equipmentGap
                        ? "Equipment data could not be loaded"
                        : "No material exposure identified"}
                    {brief.money && (
                      <button
                        onClick={() => setShowInfo(true)}
                        className="ml-1.5 font-medium text-primary hover:underline"
                      >
                        How?
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="md:col-span-8">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Outage cost by month · SAP history</span>
                  <span>
                    12-month total{" "}
                    <span className="font-semibold text-foreground">
                      {formatUsd(brief.monthly.reduce((s, m) => s + m.usd, 0))}
                    </span>
                  </span>
                </div>
                <OutageTrend data={brief.monthly} />
              </div>
            </Panel>

            {/* ── ask ───────────────────────────────────────────────── */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const q = question.trim() || selected?.action.question || "";
                if (q) ask(q);
                setQuestion("");
              }}
              className="group flex items-center gap-3 rounded-2xl border bg-card/80 px-4 py-2.5 transition-colors focus-within:border-primary/50"
            >
              <Sparkles className="size-[18px] text-primary" />
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
              >
                Ask <CornerDownLeft className="size-3.5" />
              </button>
            </form>
          </>
        )}
      </div>
      {evidence && (
        <EvidenceModal
          subject={evidence.subject}
          action={evidence.action}
          solution={solution}
          onAsk={ask}
          onClose={() => setEvidence(null)}
        />
      )}
    </AppShell>
  );
}

type Layout = "dashboard" | "actions" | "scorecard";

function StripCell({
  icon,
  tone,
  label,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <Panel className="flex items-start gap-3 px-4 py-3.5">
      <IconChip icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
        {children}
      </div>
    </Panel>
  );
}

const POSTURE_STEP = ["Normal", "Watch", "Prepare", "Down-man", "Evacuate"];
const POSTURE_FILL = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-orange-500",
  "bg-red-500",
];
const POSTURE_TEXT = [
  "text-emerald-500",
  "text-sky-500",
  "text-amber-500",
  "text-orange-500",
  "text-red-500",
];

/** Five-step response-posture ladder: estate-wide level, with per-level asset counts on hover. */
function PostureLadder({ posture }: { posture: PostureSummary }) {
  return (
    <div className="mt-2 flex w-full gap-1" aria-label={`Response posture: ${posture.label}`}>
      {POSTURE_STEP.map((step, i) => (
        <span
          key={step}
          title={`${step}: ${posture.counts[i] ?? 0} ${(posture.counts[i] ?? 0) === 1 ? "asset" : "assets"}`}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i <= posture.level ? POSTURE_FILL[posture.level] : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

/** Bullet bar: health score against poor / fair / good bands. */
function HealthBullet({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <div className="relative mt-2 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full">
      <div className="absolute inset-y-0 left-0 w-[70%] bg-red-500/15" />
      <div className="absolute inset-y-0 left-[70%] w-[15%] bg-amber-500/20" />
      <div className="absolute inset-y-0 left-[85%] right-0 bg-emerald-500/20" />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500/60 to-emerald-500"
        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
      />
    </div>
  );
}

function RiskRowView({
  row,
  selected,
  expanded,
  solution,
  onSelect,
  onEvidence,
}: {
  row: RiskRow;
  selected: boolean;
  expanded: boolean;
  solution: Solution;
  onSelect: () => void;
  onEvidence: () => void;
}) {
  const Icon = equipmentIcon(row.category);
  return (
    <li className={cn("rounded-xl transition-colors", expanded && "bg-primary/[0.04]")}>
      <button
        onClick={onSelect}
        className={cn(
          "relative grid w-full grid-cols-[minmax(0,15rem)_1fr_5.5rem_1rem] items-center gap-x-4 rounded-xl px-3 py-2 text-left transition-colors",
          selected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-accent/60",
        )}
        aria-pressed={selected}
        aria-expanded={expanded}
      >
        {selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-inset ring-border",
              LEVEL_TEXT[row.level],
            )}
          >
            <Icon className="size-4" strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-5">{row.site}</span>
            <span className="block truncate text-xs leading-4 text-muted-foreground">
              {row.item}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 left-1/4 w-px bg-background/60" />
            <span className="absolute inset-y-0 left-1/2 w-px bg-background/60" />
            <span className="absolute inset-y-0 left-3/4 w-px bg-background/60" />
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full", BAR[row.level])}
              style={{ width: `${Math.max(2, row.pct)}%` }}
            />
          </span>
          <span className="w-[4.75rem] shrink-0 whitespace-nowrap text-right">
            <span
              className={cn(
                "block text-sm font-semibold tabular-nums leading-5",
                LEVEL_TEXT[row.level],
              )}
            >
              {row.kind === "weather" ? row.pct : `${row.pct}%`}
            </span>
            <span className="block text-[11px] leading-3 text-muted-foreground">
              {row.pctLabel}
            </span>
          </span>
        </span>
        <span className="text-right text-sm font-semibold tabular-nums">
          {row.usd ? `~${formatUsd(row.usd)}` : "—"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180 text-primary",
          )}
        />
      </button>
      {expanded && <RiskDetail row={row} solution={solution} onEvidence={onEvidence} />}
    </li>
  );
}

function ActionPanel({
  row,
  followUp,
  brandName,
  onEvidence,
}: {
  row: RiskRow | null;
  followUp: Action | null;
  brandName: string;
  onEvidence: (subject: EvidenceSubject, action: Action | null) => void;
}) {
  const action = row?.action ?? followUp;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.09] via-card/90 to-card/90 p-5 shadow-lg shadow-primary/5 dark:shadow-black/40 lg:col-span-4">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <IconChip icon={ClipboardCheck} tone="neutral" />
        <div>
          <div className="text-[15px] font-semibold leading-[22px]">Recommended action</div>
          <div className="text-xs text-muted-foreground">
            {row ? `For ${row.site}` : "This week"} · suggested by {brandName}
          </div>
        </div>
      </div>

      {action ? (
        <div className="relative mt-4 flex flex-1 flex-col">
          <div className="text-base font-semibold leading-6">{action.title}</div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{action.why}</p>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Fact icon={User} label="Owner" value={action.owner} />
            <Fact icon={CalendarClock} label="Decide by" value={action.due} />
            <Fact icon={CircleDollarSign} label="Benefit" value={action.benefit} />
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => onEvidence(row ? subjectFromRow(row) : { kind: "work" }, action)}
              className="og-primary-control inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              See the evidence <ArrowRight className="size-4" />
            </button>
            <button
              onClick={() => ask(action.question)}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Sparkles className="size-4 text-primary" /> Ask why
            </button>
          </div>
          {row && followUp && (
            <button
              onClick={() => onEvidence({ kind: "work" }, followUp)}
              className="mt-auto flex items-center gap-3 border-t pt-3 text-left text-sm transition-colors hover:text-primary"
            >
              <Wrench className="size-4 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-xs text-muted-foreground">Also this week</span>
                <span className="font-medium">{followUp.title}</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </button>
          )}
        </div>
      ) : (
        <p className="relative mt-4 text-sm text-muted-foreground">No decisions are pending.</p>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function OutageTrend({ data }: { data: Array<{ label: string; usd: number; month: string }> }) {
  if (!data.length)
    return <div className="mt-3 text-sm text-muted-foreground">No SAP history available.</div>;
  return (
    <div className="mt-1.5 h-[72px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="22%"
        >
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            height={18}
          />
          <Tooltip
            cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--color-popover-foreground)",
            }}
            formatter={(v) => [formatUsd(Number(v)), "Outage cost"]}
            labelFormatter={(_, p) =>
              (p?.[0]?.payload as { month?: string } | undefined)?.month ?? ""
            }
          />
          <Bar dataKey="usd" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={d.month} fill="#38bdf8" fillOpacity={i === data.length - 1 ? 0.95 : 0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
