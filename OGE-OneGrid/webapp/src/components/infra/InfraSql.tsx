import { useMemo } from "react";
import {
  Database,
  ShieldAlert,
  CircleDollarSign,
  CalendarClock,
  ArrowRight,
  Lightbulb,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SQL_INSTANCES,
  SQL_LIFECYCLE,
  SQL_STATE_META,
  ESU_META,
  sqlState,
  sqlDaysToEol,
  sqlMonthlyCost,
  SITE_BY_ID,
  type SqlAsset,
  type SqlVersion,
  type SqlState,
} from "@/lib/infra/infra-data";
import { StatusDot } from "./infra-ui";
import { fmtCost, fmtNum } from "./infra-format";

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function relDays(days: number | null): string {
  if (days === null) return "evergreen";
  const a = Math.abs(days);
  const s = a >= 365 ? `${(a / 365).toFixed(a >= 730 ? 0 : 1)}y` : `${a}d`;
  return days < 0 ? `${s} ago` : `in ${s}`;
}

export function InfraSql({ onOpenAsset }: { onOpenAsset?: (id: string) => void }) {
  const rows = useMemo(
    () =>
      SQL_INSTANCES.map((a) => ({
        a,
        state: sqlState(a.sql.version),
        days: sqlDaysToEol(a.sql.version),
        cost: sqlMonthlyCost(a),
      })).sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9)),
    [],
  );

  const totals = useMemo(() => {
    const databases = SQL_INSTANCES.reduce((s, a) => s + a.sql.databases, 0);
    const sqlCost = SQL_INSTANCES.reduce((s, a) => s + sqlMonthlyCost(a), 0);
    const esuCost = SQL_INSTANCES.reduce((s, a) => s + a.sql.esuMonthly, 0);
    const pastEol = rows.filter((r) => r.state === "eol" || r.state === "eol-esu").length;
    const exposure = SQL_INSTANCES.filter(
      (a) => a.sql.esuStatus === "eligible" || a.sql.esuStatus === "expired",
    ).length;
    const compliant = rows.filter(
      (r) => r.state === "current" || r.state === "mainstream" || r.state === "extended",
    ).length;
    return {
      databases,
      sqlCost,
      esuCost,
      pastEol,
      exposure,
      compliance: Math.round((compliant / SQL_INSTANCES.length) * 100),
    };
  }, [rows]);

  // version lifecycle lane: distinct versions present, worst (soonest EOL) first
  const versions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of SQL_INSTANCES) counts[a.sql.version] = (counts[a.sql.version] ?? 0) + 1;
    return (Object.keys(counts) as SqlVersion[])
      .map((v) => ({
        v,
        count: counts[v]!,
        state: sqlState(v),
        days: sqlDaysToEol(v),
        info: SQL_LIFECYCLE[v],
      }))
      .sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9));
  }, []);

  const esuByStatus = useMemo(() => {
    let enrolled = 0;
    let eligible = 0;
    let expired = 0;
    for (const a of SQL_INSTANCES) {
      if (a.sql.esuStatus === "enrolled") enrolled += 1;
      else if (a.sql.esuStatus === "eligible") eligible += 1;
      else if (a.sql.esuStatus === "expired") expired += 1;
    }
    return { enrolled, eligible, expired };
  }, []);

  const recs = useMemo(() => buildRecs(rows), [rows]);

  return (
    <div className="space-y-4 p-4">
      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Summary
          icon={Database}
          label="SQL instances"
          value={SQL_INSTANCES.length}
          sub={`${totals.databases} databases`}
        />
        <Summary
          icon={CircleDollarSign}
          label="SQL run-rate"
          value={fmtCost(totals.sqlCost)}
          sub={`incl. ${fmtCost(totals.esuCost)}/mo ESU`}
        />
        <Summary
          icon={CalendarClock}
          label="Past end of life"
          value={totals.pastEol}
          accent={totals.pastEol ? "#ff5a5f" : undefined}
          sub="EOL or in ESU"
        />
        <Summary
          icon={ShieldAlert}
          label="ESU exposure"
          value={totals.exposure}
          accent={totals.exposure ? "#f0b429" : undefined}
          sub="eligible / expired, not covered"
        />
        <Summary
          icon={Database}
          label="Compliance"
          value={`${totals.compliance}%`}
          accent={totals.compliance >= 70 ? "#3fb950" : "#f0b429"}
          sub="supported versions"
        />
        <Summary
          icon={ShieldAlert}
          label="ESU enrolled"
          value={esuByStatus.enrolled}
          accent="#3fb950"
          sub="covered via Arc"
        />
      </div>

      {/* lifecycle + ESU */}
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">Version lifecycle</span>
            <span className="text-[11px] text-muted-foreground">· Microsoft support dates</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-semibold">Version</th>
                  <th className="py-1.5 pr-3 text-center font-semibold">#</th>
                  <th className="py-1.5 pr-3 font-semibold">Mainstream</th>
                  <th className="py-1.5 pr-3 font-semibold">Extended / EOL</th>
                  <th className="py-1.5 pr-3 font-semibold">ESU ends</th>
                  <th className="py-1.5 pr-1 text-right font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(({ v, count, state, days, info }) => (
                  <tr key={v} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground">{info.label}</td>
                    <td className="py-2 pr-3 text-center tabular-nums text-muted-foreground">
                      {count}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {fmtDate(info.mainstreamEnd)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-foreground">{fmtDate(info.extendedEnd)}</span>
                      {info.extendedEnd && (
                        <span
                          className="ml-1.5 text-[10.5px]"
                          style={{ color: SQL_STATE_META[state].color }}
                        >
                          {relDays(days)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{fmtDate(info.esuEnd)}</td>
                    <td className="py-2 pr-1 text-right">
                      <StatePill state={state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">
              Extended Security Updates
            </span>
          </div>
          <div className="space-y-2.5">
            <EsuRow
              label="Enrolled (covered via Arc)"
              value={esuByStatus.enrolled}
              color="#3fb950"
            />
            <EsuRow label="Eligible — not enrolled" value={esuByStatus.eligible} color="#f0b429" />
            <EsuRow label="Expired — unsupported" value={esuByStatus.expired} color="#ff5a5f" />
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              SQL spend by host
            </div>
            <SpendByHost />
          </div>
        </div>
      </div>

      {/* instance grid */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Database className="size-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">SQL instances</span>
          <span className="text-[11px] text-muted-foreground">· {SQL_INSTANCES.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-semibold">Instance</th>
                <th className="py-1.5 pr-3 font-semibold">Host</th>
                <th className="py-1.5 pr-3 font-semibold">Edition</th>
                <th className="py-1.5 pr-3 font-semibold">Version</th>
                <th className="py-1.5 pr-3 font-semibold">EOL</th>
                <th className="py-1.5 pr-3 font-semibold">ESU</th>
                <th className="py-1.5 pr-3 text-right font-semibold">$/mo</th>
                <th className="py-1.5 pr-1 text-right font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, state, days, cost }) => (
                <tr
                  key={a.id}
                  className="border-b border-border/40 last:border-0 hover:bg-accent/40"
                >
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => onOpenAsset?.(a.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <StatusDot status={a.status} size={7} />
                      <span className="font-medium text-foreground hover:underline">{a.name}</span>
                    </button>
                    <div className="pl-[15px] text-[10px] text-muted-foreground">
                      {SITE_BY_ID.get(a.siteId)?.name} · {a.sql.databases} DBs
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <HostBadge host={a.sql.hostType} arc={a.sql.arcEnabled} />
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{a.sql.edition}</td>
                  <td className="py-2 pr-3">
                    <span className="text-foreground">
                      {a.sql.engine === "SQL Server" ? `SQL ${a.sql.version}` : a.sql.engine}
                    </span>
                    {a.sql.build && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {a.sql.build}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-foreground">
                      {fmtDate(SQL_LIFECYCLE[a.sql.version].extendedEnd)}
                    </span>
                    {a.sql.version !== "Azure" && (
                      <span
                        className="ml-1.5 text-[10px]"
                        style={{ color: SQL_STATE_META[state].color }}
                      >
                        {relDays(days)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: `${ESU_META[a.sql.esuStatus].color}1f`,
                        color: ESU_META[a.sql.esuStatus].color,
                      }}
                    >
                      {ESU_META[a.sql.esuStatus].label}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums text-foreground">
                    {cost ? fmtCost(cost) : "—"}
                  </td>
                  <td className="py-2 pr-1 text-right">
                    <StatePill state={state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* recommendations */}
      {recs.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="size-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">
              Lifecycle recommendations
            </span>
          </div>
          <div className="space-y-2">
            {recs.map((r) => (
              <div
                key={r.assetId}
                className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center"
              >
                <div
                  className="grid size-9 shrink-0 place-items-center rounded-lg"
                  style={{ background: `${r.color}18`, color: r.color }}
                >
                  <CalendarClock className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">{r.title}</div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{r.detail}</p>
                  <button
                    onClick={() => onOpenAsset?.(r.assetId)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  >
                    {r.assetName} <ArrowRight className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatePill({ state }: { state: SqlState }) {
  const m = SQL_STATE_META[state];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
      style={{ background: `${m.color}22`, color: m.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

const HOST_COLOR: Record<string, string> = {
  VM: "#8b9dff",
  Arc: "#4f8cff",
  "Azure Local": "#19c3d3",
  "Azure SQL": "#3fb950",
  "Azure SQL MI": "#3fb950",
};
function HostBadge({ host, arc }: { host: string; arc: boolean }) {
  const color = HOST_COLOR[host] ?? "#7d8597";
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] text-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {host}
      {arc && host !== "Arc" && (
        <span className="text-[9px] font-semibold text-primary">· Arc</span>
      )}
    </span>
  );
}

function EsuRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-2">
      <span className="inline-flex items-center gap-2 text-[11.5px] text-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} /> {label}
      </span>
      <span
        className="text-[14px] font-bold tabular-nums"
        style={{ color: value ? color : "var(--color-muted-foreground)" }}
      >
        {value}
      </span>
    </div>
  );
}

function SpendByHost() {
  const byHost = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of SQL_INSTANCES) m[a.sql.hostType] = (m[a.sql.hostType] ?? 0) + sqlMonthlyCost(a);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, []);
  const max = Math.max(...byHost.map(([, v]) => v), 1);
  return (
    <div className="space-y-2">
      {byHost.map(([host, v]) => (
        <div key={host} className="flex items-center gap-2.5">
          <div className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">{host}</div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${(v / max) * 100}%`, background: HOST_COLOR[host] ?? "#7d8597" }}
            />
          </div>
          <div className="w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
            {v ? fmtCost(v) : "—"}
          </div>
        </div>
      ))}
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
  accent?: string | undefined;
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
      {sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

type Rec = { assetId: string; assetName: string; title: string; detail: string; color: string };
function buildRecs(
  rows: { a: SqlAsset; state: SqlState; days: number | null; cost: number }[],
): Rec[] {
  const out: Rec[] = [];
  for (const { a, state } of rows) {
    const s = a.sql;
    if (state === "eol" || (state === "eol-esu" && s.esuStatus !== "enrolled")) {
      out.push({
        assetId: a.id,
        assetName: a.name,
        color: "#ff5a5f",
        title: `Remediate ${a.name} — SQL ${s.version} ${state === "eol" ? "end of life" : "past support"}`,
        detail:
          s.esuStatus === "expired"
            ? "ESU window has closed. Migrate to Azure SQL MI (free ESUs in Azure) or decommission; it is running unpatched."
            : "Past end of support. Enroll Extended Security Updates via Azure Arc now, or migrate to Azure SQL MI to remove the exposure.",
      });
    } else if (state === "eol-approaching") {
      out.push({
        assetId: a.id,
        assetName: a.name,
        color: "#f0b429",
        title: `Plan upgrade for ${a.name} — SQL ${s.version} EOL approaching`,
        detail:
          "Extended support ends within a year. Schedule an in-place upgrade to 2022 or migrate to Azure SQL MI before the ESU clock starts.",
      });
    } else if (state === "eol-esu" && s.esuStatus === "enrolled") {
      out.push({
        assetId: a.id,
        assetName: a.name,
        color: "#f0803c",
        title: `Exit ESU for ${a.name} — SQL ${s.version}`,
        detail: `Covered by ESU (${fmtNum(s.esuMonthly)}/mo) but still unsupported long-term. Target a migration to remove recurring ESU spend.`,
      });
    }
  }
  return out;
}
