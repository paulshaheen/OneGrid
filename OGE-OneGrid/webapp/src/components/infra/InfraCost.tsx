import { useMemo } from "react";
import {
  CircleDollarSign,
  TrendingDown,
  Lightbulb,
  ArrowRight,
  Scaling,
  PowerOff,
  CalendarClock,
  Trash2,
  Snowflake,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  ASSETS,
  SITES,
  COST_RECS,
  CATEGORY_META,
  ASSET_BY_ID,
  KIND_LABEL,
  type InfraCategory,
  type CostRec,
} from "@/lib/infra/infra-data";
import { KindIcon } from "./infra-ui";
import { fmtCost } from "./infra-format";

const CAT_ICON: Record<CostRec["category"], LucideIcon> = {
  rightsize: Scaling,
  idle: PowerOff,
  reservation: CalendarClock,
  orphaned: Trash2,
  "storage-tier": Snowflake,
};
const CAT_LABEL: Record<CostRec["category"], string> = {
  rightsize: "Right-size",
  idle: "Shut down idle",
  reservation: "Reservation",
  orphaned: "Orphaned",
  "storage-tier": "Storage tier",
};
const EFFORT_COLOR: Record<CostRec["effort"], string> = {
  low: "#3fb950",
  medium: "#f0b429",
  high: "#ff5a5f",
};

export function InfraCost({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const totalCost = useMemo(() => ASSETS.reduce((s, a) => s + a.costMonthly, 0), []);
  const savings = useMemo(() => COST_RECS.reduce((s, r) => s + r.monthlySaving, 0), []);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of ASSETS) m[a.category] = (m[a.category] ?? 0) + a.costMonthly;
    return m;
  }, []);
  const bySite = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of ASSETS) m[a.siteId] = (m[a.siteId] ?? 0) + a.costMonthly;
    return m;
  }, []);
  const topAssets = useMemo(
    () =>
      [...ASSETS]
        .filter((a) => a.costMonthly > 0)
        .sort((a, b) => b.costMonthly - a.costMonthly)
        .slice(0, 8),
    [],
  );
  const maxCat = Math.max(...Object.values(byCategory));
  const maxSite = Math.max(...Object.values(bySite));
  const maxAsset = topAssets[0]?.costMonthly ?? 1;
  const recs = useMemo(() => [...COST_RECS].sort((a, b) => b.monthlySaving - a.monthlySaving), []);

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary
          icon={CircleDollarSign}
          label="Monthly run-rate"
          value={fmtCost(totalCost)}
          sub={`${fmtCost(totalCost * 12)}/yr`}
        />
        <Summary
          icon={TrendingDown}
          label="Savings identified"
          value={`${fmtCost(savings)}/mo`}
          sub={`${Math.round((savings / totalCost) * 100)}% of spend`}
          accent="#3fb950"
        />
        <Summary
          icon={Lightbulb}
          label="Recommendations"
          value={COST_RECS.length}
          sub="Azure Advisor-style"
        />
        <Summary
          icon={CalendarClock}
          label="Annualised saving"
          value={fmtCost(savings * 12)}
          sub="if all applied"
          accent="#3fb950"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Spend by category">
          <div className="space-y-2.5">
            {(Object.keys(CATEGORY_META) as InfraCategory[]).map((c) => (
              <BarRow
                key={c}
                label={CATEGORY_META[c].label}
                color={CATEGORY_META[c].color}
                value={byCategory[c] ?? 0}
                max={maxCat}
              />
            ))}
          </div>
        </Panel>
        <Panel title="Spend by site">
          <div className="space-y-2.5">
            {SITES.map((s) => (
              <BarRow
                key={s.id}
                label={s.name}
                color="#4f8cff"
                value={bySite[s.id] ?? 0}
                max={maxSite}
              />
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Top assets by run-rate">
        <div className="space-y-2">
          {topAssets.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenAsset?.(a.id)}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-accent/50"
            >
              <span
                className="grid size-6 shrink-0 place-items-center rounded-md"
                style={{
                  background: `${CATEGORY_META[a.category].color}1f`,
                  color: CATEGORY_META[a.category].color,
                }}
              >
                <KindIcon kind={a.kind} className="size-3.5" />
              </span>
              <span className="w-40 shrink-0 truncate text-[12px] font-medium text-foreground">
                {a.name}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(a.costMonthly / maxAsset) * 100}%`,
                    background: CATEGORY_META[a.category].color,
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums text-foreground">
                {fmtCost(a.costMonthly)}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Cost recommendations">
        <div className="space-y-2">
          {recs.map((r) => {
            const Icon = CAT_ICON[r.category];
            const asset = ASSET_BY_ID.get(r.assetId);
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{r.title}</span>
                    <span className="rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-muted-foreground">
                      {CAT_LABEL[r.category]}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase"
                      style={{
                        background: `${EFFORT_COLOR[r.effort]}22`,
                        color: EFFORT_COLOR[r.effort],
                      }}
                    >
                      {r.effort} effort
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{r.detail}</p>
                  {asset && (
                    <button
                      onClick={() => onOpenAsset?.(asset.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      {asset.name}{" "}
                      <span className="text-muted-foreground">· {KIND_LABEL[asset.kind]}</span>{" "}
                      <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums text-emerald-400">
                    {fmtCost(r.monthlySaving)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    per month
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" style={{ color: accent }} /> {label}
      </div>
      <div
        className="mt-1 text-2xl font-bold tabular-nums leading-none"
        style={{ color: accent ?? "var(--color-foreground)" }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 text-[13px] font-semibold text-foreground">{title}</div>
      {children}
    </div>
  );
}
function BarRow({
  label,
  color,
  value,
  max,
}: {
  label: string;
  color: string;
  value: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 truncate text-[12px] text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full rounded-full"
          style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }}
        />
      </div>
      <div className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums text-foreground">
        {fmtCost(value)}
      </div>
    </div>
  );
}
