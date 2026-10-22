import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleDollarSign,
  Database,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { getSolution } from "@/lib/solution";
import { AppShell } from "@/components/ops/AppShell";
import {
  AS_OF,
  COST_LABEL,
  daysUntil,
  loadSapDataset,
  type SapDataset,
  type SapTableInfo,
} from "@/lib/sap/sap-data";

type TabId = "sync" | "warranty" | "outages";
const TAB_IDS = new Set<TabId>(["sync", "warranty", "outages"]);

const SAP_BLUE = "#0a6ed1";
const OK = "#3fb950";
const WARN = "#f0b429";
const BAD = "#ff5a5f";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdShort = (n: number) => {
  const a = Math.abs(n);
  const s =
    a >= 1e9
      ? `${(a / 1e9).toFixed(2)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(1)}M`
        : a >= 1e3
          ? `${(a / 1e3).toFixed(0)}K`
          : a.toFixed(0);
  return `${n < 0 ? "-" : ""}$${s}`;
};
const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
};

// ------------------------------------------------------------------------------ live sync loop
const CYCLE_MS = 45_000;
const STEP_MS = 420;

function useSapSync(tables: SapTableInfo[]) {
  const [now, setNow] = useState(() => Date.now());
  const [tableSync, setTableSync] = useState<Record<string, number>>({});
  const [active, setActive] = useState<number | null>(null);
  const [changes, setChanges] = useState(() => 24 + Math.floor(Math.random() * 30));
  const running = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const base = Date.now() - 11_000;
    setTableSync(Object.fromEntries(tables.map((t, i) => [t.name, base - i * 900])));
  }, [tables]);

  const run = useCallback(() => {
    if (running.current || !tables.length) return;
    running.current = true;
    tables.forEach((t, i) => {
      timers.current.push(
        setTimeout(() => {
          setActive(i);
          setTableSync((s) => ({ ...s, [t.name]: Date.now() }));
        }, i * STEP_MS),
      );
    });
    timers.current.push(
      setTimeout(
        () => {
          setActive(null);
          setChanges((c) => c + Math.floor(Math.random() * 7));
          running.current = false;
        },
        tables.length * STEP_MS + 300,
      ),
    );
  }, [tables]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const cycle = setInterval(run, CYCLE_MS);
    return () => {
      clearInterval(tick);
      clearInterval(cycle);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [run]);

  const lastSync = Math.max(0, ...Object.values(tableSync));
  return { now, tableSync, active, syncing: active !== null, changes, lastSync, syncNow: run };
}

// ------------------------------------------------------------------------------ page
export function SapPage() {
  const router = useRouter();
  const search = useRouterState({ select: (s) => s.location.search as { tab?: string } });
  const [tab, setTab] = useState<TabId>(
    search.tab && TAB_IDS.has(search.tab as TabId) ? (search.tab as TabId) : "sync",
  );
  const [data, setData] = useState<SapDataset | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadSapDataset(getSolution())
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (search.tab === tab) return;
    router.navigate({ to: "/app/sap", search: { tab }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const tables = useMemo(() => data?.tables ?? [], [data]);
  const sync = useSapSync(tables);

  const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
    { id: "sync", label: "Sync status", icon: RefreshCw },
    { id: "warranty", label: data?.warrantyLabel ?? "Warranty", icon: ShieldCheck },
    { id: "outages", label: "Outage financial impact", icon: CircleDollarSign },
  ];

  return (
    <AppShell fullHeight>
      <div className="flex h-full flex-col">
        <div className="og-header-skin border-b bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-0 pt-3">
            <div className="flex items-center gap-2.5">
              <div
                className="grid size-8 place-items-center rounded-lg text-white"
                style={{ background: SAP_BLUE }}
              >
                <Landmark className="size-5" />
              </div>
              <div>
                <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                  SAP S/4HANA
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    {data ? `${data.system.sid} · client ${data.system.client}` : "ERP"}
                  </span>
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  Plants, equipment, warranties and outage finance replicated from SAP into OneLake
                  with Fabric Mirroring.
                </p>
              </div>
            </div>
            <SyncBadge sync={sync} />
          </div>
          <div className="flex gap-0.5 overflow-x-auto px-3 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors",
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {err && <div className="p-6 text-sm text-red-400">Could not load SAP data: {err}</div>}
          {!data && !err && (
            <div className="p-6 text-sm text-muted-foreground">Connecting to SAP S/4HANA…</div>
          )}
          {data && tab === "sync" && <SyncTab data={data} sync={sync} />}
          {data && tab === "warranty" && <WarrantyTab data={data} />}
          {data && tab === "outages" && <OutagesTab data={data} />}
        </div>
      </div>
    </AppShell>
  );
}

type Sync = ReturnType<typeof useSapSync>;

function SyncBadge({ sync }: { sync: Sync }) {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold"
        style={{
          background: `${sync.syncing ? SAP_BLUE : OK}22`,
          color: sync.syncing ? SAP_BLUE : OK,
        }}
      >
        {sync.syncing ? (
          <RefreshCw className="size-3.5 animate-spin" />
        ) : (
          <CircleCheckBig className="size-3.5" />
        )}
        {sync.syncing ? "Syncing from SAP…" : "Replicating"}
      </span>
      <span className="text-muted-foreground">
        Last sync{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {ago(sync.now - sync.lastSync)}
        </span>
      </span>
      <button
        onClick={sync.syncNow}
        disabled={sync.syncing}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-foreground hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={cn("size-3.5", sync.syncing && "animate-spin")} /> Sync now
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------ shared UI
function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1 text-[22px] font-bold tabular-nums leading-none"
        style={{ color: accent ?? "var(--color-foreground)" }}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[10.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SapSource({ table }: { table: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      <Database className="size-3" style={{ color: SAP_BLUE }} /> sap.{table}
    </span>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
      style={{ background: `${color}22`, color }}
    >
      {text}
    </span>
  );
}

const th =
  "px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground";
const td = "px-2 py-1.5 text-[12px] text-foreground";

// ------------------------------------------------------------------------------ sync tab
function SyncTab({ data, sync }: { data: SapDataset; sync: Sync }) {
  const totalRows = data.tables.reduce((s, t) => s + t.rows, 0);
  const stages = [
    {
      label: "SAP S/4HANA",
      sub: `${data.system.sid} · client ${data.system.client}`,
      color: SAP_BLUE,
    },
    { label: "Change data capture", sub: "Table-level CDC", color: "#7c5cf0" },
    { label: "Fabric Mirroring", sub: data.system.mirror, color: "#2fbf8f" },
    { label: "OneLake", sub: `Delta · schema ${data.system.schema}`, color: "#2fbf8f" },
    { label: "OneGrid", sub: data.solution === "og" ? "OneRig" : "Energy", color: "#a986ff" },
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-stretch gap-2">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className="rounded-lg border bg-muted/30 px-3 py-2"
                style={{ borderLeft: `4px solid ${s.color}` }}
              >
                <div className="text-[12.5px] font-semibold text-foreground">{s.label}</div>
                <div className="text-[10.5px] text-muted-foreground">{s.sub}</div>
              </div>
              {i < stages.length - 1 && (
                <ArrowRight
                  className={cn(
                    "size-4 text-muted-foreground",
                    sync.syncing && "animate-pulse text-primary",
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi
          label="Status"
          value={sync.syncing ? "Syncing" : "Healthy"}
          accent={sync.syncing ? SAP_BLUE : OK}
          sub="Mirroring running"
        />
        <Kpi label="Last sync" value={ago(sync.now - sync.lastSync)} sub="Continuous replication" />
        <Kpi
          label="Tables replicated"
          value={data.tables.length}
          sub={`${data.system.schema} schema`}
        />
        <Kpi label="Rows in OneLake" value={num(totalRows)} sub="Delta tables, queryable now" />
        <Kpi label="Changes captured" value={num(sync.changes)} sub="Inserts and updates today" />
      </div>

      <Panel
        title="Replicated SAP tables"
        right={
          <span className="text-[11px] text-muted-foreground">
            Typical replication latency ~15 s
          </span>
        }
      >
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className={th}>SAP table</th>
              <th className={th}>Description</th>
              <th className={cn(th, "text-right")}>Rows</th>
              <th className={th}>Status</th>
              <th className={th}>Last sync</th>
            </tr>
          </thead>
          <tbody>
            {data.tables.map((t, i) => {
              const busy = sync.active === i;
              return (
                <tr key={t.name} className="border-b last:border-0">
                  <td className={cn(td, "font-mono")}>{t.name}</td>
                  <td className={cn(td, "text-muted-foreground")}>{t.label}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{num(t.rows)}</td>
                  <td className={td}>
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold"
                      style={{ color: busy ? SAP_BLUE : OK }}
                    >
                      {busy ? (
                        <RefreshCw className="size-3 animate-spin" />
                      ) : (
                        <CircleCheckBig className="size-3" />
                      )}
                      {busy ? "Syncing" : "Replicating"}
                    </span>
                  </td>
                  <td className={cn(td, "tabular-nums text-muted-foreground")}>
                    {ago(sync.now - (sync.tableSync[t.name] ?? sync.now))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Workflow className="size-3.5" /> SAP data lands in OneLake as Delta tables, so OneGrid,
        Power BI, notebooks and Fabric data agents use it without extra copies or ETL.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------ warranty tab
function WarrantyTab({ data }: { data: SapDataset }) {
  const siteName = useMemo(
    () => Object.fromEntries(data.sites.map((s) => [s.WERKS, s.NAME1])),
    [data],
  );
  const eq = useMemo(() => Object.fromEntries(data.equipment.map((e) => [e.EQUNR, e])), [data]);
  const w = data.warranties;
  const active = w.filter((x) => x.STATUS === "ACTIVE").length;
  const expiring = w.filter(
    (x) =>
      x.STATUS === "EXPIRING" ||
      (x.STATUS === "ACTIVE" && daysUntil(x.END_DATE) < 180 && daysUntil(x.END_DATE) >= 0),
  );
  const expired = w.filter((x) => x.STATUS === "EXPIRED").length;
  const claims = data.claims;
  const claimed = claims.reduce((s, c) => s + c.CLAIM_AMT, 0);
  const paid = claims.reduce((s, c) => s + c.PAID_AMT, 0);
  const openClaims = claims.filter((c) =>
    ["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(c.STATUS),
  ).length;

  const latestBreach = useMemo(() => {
    const latest = new Map<string, (typeof data.perf)[number]>();
    for (const p of data.perf) {
      const cur = latest.get(p.EQUNR);
      if (!cur || p.PERIOD > cur.PERIOD) latest.set(p.EQUNR, p);
    }
    return [...latest.values()]
      .filter((p) => p.BREACH === "X")
      .sort((a, b) => b.DEGR_CUM_PCT - b.GUAR_MAX_PCT - (a.DEGR_CUM_PCT - a.GUAR_MAX_PCT));
  }, [data]);

  const byPlant = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const x of w) {
      const r = m.get(x.WERKS) ?? {};
      r[x.STATUS] = (r[x.STATUS] ?? 0) + 1;
      r["total"] = (r["total"] ?? 0) + 1;
      m.set(x.WERKS, r);
    }
    return [...m.entries()].sort((a, b) => (b[1]["total"] ?? 0) - (a[1]["total"] ?? 0));
  }, [w]);

  const byOem = useMemo(() => {
    const m = new Map<string, { claimed: number; approved: number; paid: number; n: number }>();
    for (const c of claims) {
      const k = eq[c.EQUNR]?.MANUFACTURER || "Unknown";
      const r = m.get(k) ?? { claimed: 0, approved: 0, paid: 0, n: 0 };
      r.claimed += c.CLAIM_AMT;
      r.approved += c.APPROVED_AMT;
      r.paid += c.PAID_AMT;
      r.n += 1;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => b[1].claimed - a[1].claimed);
  }, [claims, eq]);

  const statusColor = (s: string) =>
    s === "ACTIVE" || s === "PAID"
      ? OK
      : s === "EXPIRING" || s === "IN_REVIEW" || s === "SUBMITTED" || s === "PENDING"
        ? WARN
        : s === "APPROVED"
          ? SAP_BLUE
          : BAD;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        Synced from SAP <SapSource table="ZSOL_WARR" /> <SapSource table="ZSOL_CLAIM" />{" "}
        <SapSource table="ZSOL_PERF" /> · as of {AS_OF}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Active contracts" value={active} accent={OK} />
        <Kpi
          label="Expiring < 180 days"
          value={expiring.length}
          accent={WARN}
          sub="File claims before end date"
        />
        <Kpi label="Expired" value={expired} />
        <Kpi label="Open claims" value={openClaims} accent={SAP_BLUE} />
        <Kpi
          label="Claimed / paid"
          value={usdShort(claimed)}
          sub={`${usdShort(paid)} paid (${claimed ? Math.round((paid / claimed) * 100) : 0}%)`}
        />
        <Kpi
          label="Guarantee breaches"
          value={latestBreach.length}
          accent={latestBreach.length ? BAD : OK}
          sub="Latest period"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Expiring warranties (next 180 days)" right={<SapSource table="ZSOL_WARR" />}>
          {expiring.length === 0 ? (
            <div className="p-2 text-[12px] text-muted-foreground">
              No warranties expire in the next 180 days.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className={th}>Ends</th>
                  <th className={th}>Plant</th>
                  <th className={th}>Equipment</th>
                  <th className={th}>Type</th>
                  <th className={th}>Warrantor</th>
                </tr>
              </thead>
              <tbody>
                {expiring
                  .sort((a, b) => (a.END_DATE < b.END_DATE ? -1 : 1))
                  .slice(0, 12)
                  .map((x) => (
                    <tr key={x.WARR_ID} className="border-b last:border-0">
                      <td className={cn(td, "tabular-nums")}>
                        {x.END_DATE}{" "}
                        <span className="text-[10.5px] text-amber-400">
                          ({daysUntil(x.END_DATE)}d)
                        </span>
                      </td>
                      <td className={td}>{siteName[x.WERKS] ?? x.WERKS}</td>
                      <td className={cn(td, "max-w-[220px] truncate")} title={x.COVERAGE}>
                        {eq[x.EQUNR]?.EQKTX ?? x.EQUNR}
                      </td>
                      <td className={td}>
                        <Pill text={x.WARR_TYPE} color={SAP_BLUE} />
                      </td>
                      <td className={cn(td, "text-muted-foreground")}>{x.WARRANTOR}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Claims pipeline by OEM" right={<SapSource table="ZSOL_CLAIM" />}>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className={th}>OEM</th>
                <th className={cn(th, "text-right")}>Claims</th>
                <th className={cn(th, "text-right")}>Claimed</th>
                <th className={cn(th, "text-right")}>Approved</th>
                <th className={cn(th, "text-right")}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {byOem.map(([oem, r]) => (
                <tr key={oem} className="border-b last:border-0">
                  <td className={td}>{oem}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{r.n}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{usdShort(r.claimed)}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{usdShort(r.approved)}</td>
                  <td className={cn(td, "text-right tabular-nums")} style={{ color: OK }}>
                    {usdShort(r.paid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {claims.slice(0, 10).map((c) => (
              <span
                key={c.CLAIM_ID}
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px]"
                title={c.DESCRIPTION}
              >
                <span className="font-mono text-muted-foreground">{c.CLAIM_ID}</span>
                <Pill text={c.STATUS.replace("_", " ")} color={statusColor(c.STATUS)} />
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Performance-guarantee breaches" right={<SapSource table="ZSOL_PERF" />}>
          <div className="mb-2 text-[11px] text-muted-foreground">{data.perfLabel}</div>
          {latestBreach.length === 0 ? (
            <div className="p-2 text-[12px] text-muted-foreground">
              No breaches in the latest period.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className={th}>Equipment</th>
                  <th className={th}>Period</th>
                  <th className={cn(th, "text-right")}>Measured</th>
                  <th className={cn(th, "text-right")}>Guaranteed max</th>
                  <th className={cn(th, "text-right")}>Excess</th>
                </tr>
              </thead>
              <tbody>
                {latestBreach.slice(0, 10).map((p) => (
                  <tr key={p.EQUNR} className="border-b last:border-0">
                    <td className={cn(td, "max-w-[240px] truncate")}>
                      {eq[p.EQUNR]?.EQKTX ?? p.EQUNR}
                    </td>
                    <td className={cn(td, "tabular-nums")}>
                      {p.PERIOD.slice(0, 4)}-{p.PERIOD.slice(4)}
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>
                      {p.DEGR_CUM_PCT.toFixed(2)}%
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>
                      {p.GUAR_MAX_PCT.toFixed(2)}%
                    </td>
                    <td className={cn(td, "text-right tabular-nums")} style={{ color: BAD }}>
                      +{(p.DEGR_CUM_PCT - p.GUAR_MAX_PCT).toFixed(2)} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Warranty coverage by plant" right={<SapSource table="ZT001W" />}>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className={th}>Plant</th>
                <th className={cn(th, "text-right")}>Active</th>
                <th className={cn(th, "text-right")}>Expiring</th>
                <th className={cn(th, "text-right")}>Expired</th>
                <th className={cn(th, "text-right")}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {byPlant.map(([werks, r]) => (
                <tr key={werks} className="border-b last:border-0">
                  <td className={td}>{siteName[werks] ?? werks}</td>
                  <td className={cn(td, "text-right tabular-nums")} style={{ color: OK }}>
                    {r["ACTIVE"] ?? 0}
                  </td>
                  <td className={cn(td, "text-right tabular-nums")} style={{ color: WARN }}>
                    {r["EXPIRING"] ?? 0}
                  </td>
                  <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>
                    {r["EXPIRED"] ?? 0}
                  </td>
                  <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>
                    {r["PENDING"] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ outages tab
function OutagesTab({ data }: { data: SapDataset }) {
  const siteName = useMemo(
    () => Object.fromEntries(data.sites.map((s) => [s.WERKS, s.NAME1])),
    [data],
  );
  const eq = useMemo(() => Object.fromEntries(data.equipment.map((e) => [e.EQUNR, e])), [data]);
  const linesBy = useMemo(() => {
    const m = new Map<string, typeof data.fin>();
    for (const f of data.fin) m.set(f.OUTAGE_ID, [...(m.get(f.OUTAGE_ID) ?? []), f]);
    return m;
  }, [data]);
  const [open, setOpen] = useState<string | null>(null);

  const net = data.outages.reduce((s, o) => s + o.TOTAL_IMPACT, 0);
  const gross = data.fin.filter((f) => f.AMOUNT > 0).reduce((s, f) => s + f.AMOUNT, 0);
  const recov = data.fin.filter((f) => f.AMOUNT < 0).reduce((s, f) => s + f.AMOUNT, 0);
  const openOut = data.outages.filter((o) => o.STATUS === "OPEN");
  const openImpact = openOut.reduce((s, o) => s + o.TOTAL_IMPACT, 0);

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of data.fin) m.set(f.COST_CAT, (m.get(f.COST_CAT) ?? 0) + f.AMOUNT);
    return [...m.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [data]);
  const maxCat = Math.max(1, ...byCat.map(([, v]) => Math.abs(v)));

  const byPlant = useMemo(() => {
    const m = new Map<string, { n: number; hours: number; net: number; forced: number }>();
    for (const o of data.outages) {
      const r = m.get(o.WERKS) ?? { n: 0, hours: 0, net: 0, forced: 0 };
      r.n += 1;
      r.hours += o.DURATION_H;
      r.net += o.TOTAL_IMPACT;
      if (o.OUTAGE_TYPE === "FORCED") r.forced += 1;
      m.set(o.WERKS, r);
    }
    return [...m.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [data]);

  const top = useMemo(
    () => [...data.outages].sort((a, b) => b.TOTAL_IMPACT - a.TOTAL_IMPACT).slice(0, 12),
    [data],
  );
  const typeColor = (t: string) =>
    t === "FORCED" ? BAD : t === "PLANNED" ? SAP_BLUE : t === "WEATHER" ? "#a986ff" : WARN;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        Synced from SAP <SapSource table="ZOUT_EVT" /> <SapSource table="ZOUT_FIN" /> · posted to
        cost centers and G/L accounts · as of {AS_OF}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi
          label="Net financial impact"
          value={usdShort(net)}
          accent={BAD}
          sub={`${data.outages.length} outages since 2025`}
        />
        <Kpi label="Gross cost" value={usdShort(gross)} sub="Repairs + lost output + penalties" />
        <Kpi label="Recoveries" value={usdShort(recov)} accent={OK} sub="Warranty + insurance" />
        <Kpi
          label="Open outages"
          value={openOut.length}
          accent={WARN}
          sub={`${usdShort(openImpact)} accrued so far`}
        />
        <Kpi
          label="Forced outages"
          value={data.outages.filter((o) => o.OUTAGE_TYPE === "FORCED").length}
          sub="Unplanned"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Impact by cost category" right={<SapSource table="ZOUT_FIN" />}>
          <div className="space-y-2">
            {byCat.map(([cat, v]) => (
              <div key={cat}>
                <div className="flex justify-between text-[11.5px]">
                  <span className="text-foreground">{COST_LABEL[cat] ?? cat}</span>
                  <span
                    className="tabular-nums"
                    style={{ color: v < 0 ? OK : "var(--color-foreground)" }}
                  >
                    {usdShort(v)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(Math.abs(v) / maxCat) * 100}%`,
                      background: v < 0 ? OK : SAP_BLUE,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Net impact by plant" right={<SapSource table="ZT001W" />}>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className={th}>Plant</th>
                <th className={cn(th, "text-right")}>Outages</th>
                <th className={cn(th, "text-right")}>Forced</th>
                <th className={cn(th, "text-right")}>Hours</th>
                <th className={cn(th, "text-right")}>Net impact</th>
              </tr>
            </thead>
            <tbody>
              {byPlant.slice(0, 12).map(([werks, r]) => (
                <tr key={werks} className="border-b last:border-0">
                  <td className={td}>{siteName[werks] ?? werks}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{r.n}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{r.forced}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{num(r.hours)}</td>
                  <td className={cn(td, "text-right font-semibold tabular-nums")}>
                    {usdShort(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel
        title="Highest-impact outages"
        right={
          <span className="text-[11px] text-muted-foreground">
            Click a row for SAP cost postings
          </span>
        }
      >
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className={th} />
              <th className={th}>Outage</th>
              <th className={th}>Plant / equipment</th>
              <th className={th}>Type</th>
              <th className={th}>Cause</th>
              <th className={cn(th, "text-right")}>Lost output</th>
              <th className={cn(th, "text-right")}>Net impact</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {top.map((o) => {
              const isOpen = open === o.OUTAGE_ID;
              return [
                <tr
                  key={o.OUTAGE_ID}
                  onClick={() => setOpen(isOpen ? null : o.OUTAGE_ID)}
                  className="cursor-pointer border-b hover:bg-accent/40"
                >
                  <td className={td}>
                    {isOpen ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </td>
                  <td className={cn(td, "font-mono text-[11px]")}>
                    {o.OUTAGE_ID}
                    <div className="text-[10px] text-muted-foreground">{o.START_DATE}</div>
                  </td>
                  <td className={cn(td, "max-w-[220px]")}>
                    <div className="truncate">{siteName[o.WERKS] ?? o.WERKS}</div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {eq[o.EQUNR]?.EQKTX ?? o.ASSET_ID}
                    </div>
                  </td>
                  <td className={td}>
                    <Pill text={o.OUTAGE_TYPE} color={typeColor(o.OUTAGE_TYPE)} />
                  </td>
                  <td
                    className={cn(td, "max-w-[260px] truncate text-muted-foreground")}
                    title={o.CAUSE_TEXT}
                  >
                    {o.STORM_EVENT ? `${o.STORM_EVENT} · ` : ""}
                    {o.CAUSE_TEXT}
                  </td>
                  <td className={cn(td, "text-right tabular-nums")}>
                    {num(o.LOST_OUTPUT)} {o.OUTPUT_UOM}
                  </td>
                  <td className={cn(td, "text-right font-semibold tabular-nums")}>
                    {usdShort(o.TOTAL_IMPACT)}
                  </td>
                  <td className={td}>
                    <Pill text={o.STATUS} color={o.STATUS === "OPEN" ? WARN : OK} />
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${o.OUTAGE_ID}-lines`} className="border-b bg-muted/20">
                    <td />
                    <td colSpan={7} className="px-2 py-2">
                      <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                        Cost postings <SapSource table="ZOUT_FIN" />
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className={th}>Line</th>
                            <th className={th}>Category</th>
                            <th className={th}>Description</th>
                            <th className={th}>Cost center</th>
                            <th className={th}>G/L</th>
                            <th className={th}>Reference</th>
                            <th className={cn(th, "text-right")}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(linesBy.get(o.OUTAGE_ID) ?? []).map((f) => (
                            <tr key={f.LINE_NO}>
                              <td className={cn(td, "font-mono text-[11px]")}>{f.LINE_NO}</td>
                              <td className={td}>{COST_LABEL[f.COST_CAT] ?? f.COST_CAT}</td>
                              <td className={cn(td, "text-muted-foreground")}>{f.DESCRIPTION}</td>
                              <td className={cn(td, "font-mono text-[11px]")}>{f.KOSTL}</td>
                              <td className={cn(td, "font-mono text-[11px]")}>{f.HKONT}</td>
                              <td className={cn(td, "font-mono text-[11px] text-muted-foreground")}>
                                {f.REF_DOC || "-"}
                              </td>
                              <td
                                className={cn(td, "text-right tabular-nums")}
                                style={{ color: f.AMOUNT < 0 ? OK : undefined }}
                              >
                                {usd(f.AMOUNT)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
