// "Workbench" layout of the executive brief: an object-inbox module in the look of an
// operational ontology app (Blueprint-style chrome) — module header, filter rail with facet
// counts and a risk histogram, metric cards over a dense object table, and an object view
// panel (overview, properties, linked outages and work orders). Uses the data the brief has
// already cached (fleet assets, open work orders, SAP outage history); no extra polling.
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  ClipboardList,
  Cpu,
  Droplets,
  ExternalLink,
  Fan,
  Filter,
  Flame,
  Gauge,
  Layers,
  ListFilter,
  MapPin,
  PanelRightClose,
  Search,
  ShieldCheck,
  Star,
  Table2,
  TriangleAlert,
  Wind,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { formatUsd, type FleetAssetRow } from "@/lib/exec/exec-brief";
import type { EvidenceSubject } from "@/lib/exec/evidence";
import { loadSapDataset, type SapOutage } from "@/lib/sap/sap-data";
import type { Solution } from "@/lib/solution";
import { useIsDark } from "@/lib/theme-mode";
import { cn } from "@/lib/utils";
import { getJson } from "@/report/lib/api.js";

// ── Blueprint palette (light / dark) ─────────────────────────────────────────
const LIGHT = {
  "--fd-app": "#F6F7F9",
  "--fd-panel": "#FFFFFF",
  "--fd-sunken": "#F6F7F9",
  "--fd-hover": "#EDEFF2",
  "--fd-border": "#DCE0E5",
  "--fd-divider": "#E5E8EB",
  "--fd-text": "#1C2127",
  "--fd-muted": "#5F6B7C",
  "--fd-faint": "#8F99A8",
  "--fd-blue": "#2D72D2",
  "--fd-blue-text": "#215DB0",
  "--fd-sel": "rgba(45,114,210,0.10)",
  "--fd-red": "#CD4246",
  "--fd-orange": "#C87619",
  "--fd-green": "#238551",
  "--fd-bar": "#2D72D2",
  "--fd-input": "#FFFFFF",
} as const;
const DARK = {
  "--fd-app": "#1C2127",
  "--fd-panel": "#252A31",
  "--fd-sunken": "#1C2127",
  "--fd-hover": "#2F343C",
  "--fd-border": "#383E47",
  "--fd-divider": "#2F343C",
  "--fd-text": "#F6F7F9",
  "--fd-muted": "#ABB3BF",
  "--fd-faint": "#738091",
  "--fd-blue": "#2D72D2",
  "--fd-blue-text": "#8ABBFF",
  "--fd-sel": "rgba(76,144,240,0.16)",
  "--fd-red": "#E76A6E",
  "--fd-orange": "#EC9A3C",
  "--fd-green": "#32A467",
  "--fd-bar": "#4C90F0",
  "--fd-input": "#1C2127",
} as const;
const FONT = '"Inter", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ── data shaping ─────────────────────────────────────────────────────────────
type Asset = FleetAssetRow & {
  unit?: string;
  region?: string;
  site_type?: string;
  running_tag?: string;
  health?: number | null;
  condition?: number | null;
  anomaly_pct?: number | null;
  max_z?: number | null;
  anom_n?: number;
  watch_n?: number;
  stop_prob?: number | null;
  lat?: number;
  lon?: number;
};
interface WorkRow {
  wr_id?: string;
  asset_id?: string;
  problem_descr?: string;
  wr_status?: string;
  priority?: string;
  priority_rank?: number;
  create_date?: string;
}
type Status = "critical" | "watch" | "ok";
interface Row {
  a: Asset;
  id: string;
  name: string;
  site: string;
  group: string;
  status: Status;
  failure: number | null;
  condition: number | null;
  alerts: number;
  workOrders: WorkRow[];
  outages: SapOutage[];
  lastOutage: string | null;
}
type SortKey =
  "name" | "site" | "group" | "failure" | "condition" | "alerts" | "wos" | "lastOutage";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
function failureOf(a: Asset): number | null {
  if (a.survival_7d != null) return Math.round((1 - num(a.survival_7d)) * 100);
  if (a.stop_prob != null) return Math.round(num(a.stop_prob) * 100);
  return null;
}
const STATUS_LABEL: Record<Status, string> = {
  critical: "Critical",
  watch: "Watch",
  ok: "Healthy",
};
const RISK_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "0–5", lo: 0, hi: 5 },
  { label: "5–10", lo: 5, hi: 10 },
  { label: "10–15", lo: 10, hi: 15 },
  { label: "15–20", lo: 15, hi: 20 },
  { label: "20–30", lo: 20, hi: 30 },
  { label: "30+", lo: 30, hi: 101 },
];

// Object type icon + tile colour, by equipment group.
function objectIcon(group: string): { Icon: LucideIcon; color: string } {
  const g = group.toLowerCase();
  if (/turbine|fan/.test(g)) return { Icon: Fan, color: "#2D72D2" };
  if (/compressor/.test(g)) return { Icon: Wind, color: "#00A396" };
  if (/boiler|heater|furnace/.test(g)) return { Icon: Flame, color: "#C87619" };
  if (/pump/.test(g)) return { Icon: Droplets, color: "#7961DB" };
  if (/generator|transformer|electrical/.test(g)) return { Icon: Zap, color: "#D1980B" };
  if (/separator|vessel|tank/.test(g)) return { Icon: Layers, color: "#634DBF" };
  return { Icon: Cpu, color: "#5F6B7C" };
}
const riskIntent = (p: number | null): Intent =>
  p == null ? "none" : p >= 30 ? "danger" : p >= 15 ? "warning" : "success";
const riskLabel = (p: number | null) =>
  p == null ? "—" : p >= 30 ? "High" : p >= 15 ? "Medium" : "Low";

// ── component ────────────────────────────────────────────────────────────────
export function ExecWorkbench({
  solution,
  fleet,
  onEvidence,
}: {
  solution: Solution;
  fleet: FleetAssetRow[];
  onEvidence: (subject: EvidenceSubject) => void;
}) {
  const isDark = useIsDark();
  const vars = (isDark ? DARK : LIGHT) as unknown as CSSProperties;
  // Same query keys as the Scorecard, so switching pills reuses the cache.
  const sap = useQuery({
    queryKey: ["exec-sap-outages", solution],
    queryFn: async () => (await loadSapDataset(solution)).outages,
    staleTime: 60 * 60 * 1000,
  });
  const wos = useQuery({
    queryKey: ["exec-open-work"],
    queryFn: () => getJson("/api/work-orders?limit=100") as Promise<WorkRow[]>,
    staleTime: 5 * 60 * 1000,
  });

  const rows: Row[] = useMemo(() => {
    const woBy = new Map<string, WorkRow[]>();
    for (const w of wos.data ?? [])
      if (w.asset_id) woBy.set(w.asset_id, [...(woBy.get(w.asset_id) ?? []), w]);
    const outBy = new Map<string, SapOutage[]>();
    for (const o of sap.data ?? []) outBy.set(o.ASSET_ID, [...(outBy.get(o.ASSET_ID) ?? []), o]);
    return (fleet as Asset[]).map((a) => {
      const outs = (outBy.get(a.asset_id) ?? []).sort((x, y) =>
        y.START_DATE.localeCompare(x.START_DATE),
      );
      return {
        a,
        id: a.asset_id,
        name: [a.plant, a.name ?? a.asset_id].filter(Boolean).join(" ") || a.asset_id,
        site: a.plant || "—",
        group: titleCase(a.group || a.category || "Other"),
        status: a.status === "critical" ? "critical" : a.status === "watch" ? "watch" : "ok",
        failure: failureOf(a),
        condition: a.condition ?? null,
        alerts: num(a.anom_n) + num(a.watch_n),
        workOrders: woBy.get(a.asset_id) ?? [],
        outages: outs,
        lastOutage: outs.find((o) => o.OUTAGE_TYPE !== "PLANNED")?.START_DATE ?? null,
      } satisfies Row;
    });
  }, [fleet, wos.data, sap.data]);

  // ── filters ──────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status | null>(null);
  const [groups, setGroups] = useState<Set<string>>(() => new Set());
  const [sites, setSites] = useState<Set<string>>(() => new Set());
  const [bucket, setBucket] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showAllSites, setShowAllSites] = useState(false);
  const toggle = (set: Set<string>, v: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };
  const inBucket = (r: Row, i: number | null) => {
    if (i == null) return true;
    const b = RISK_BUCKETS[i]!;
    return r.failure != null && r.failure >= b.lo && r.failure < b.hi;
  };
  const q = query.trim().toLowerCase();
  const match = (r: Row, skip?: "status" | "group" | "site" | "bucket") =>
    (skip === "status" || !status || r.status === status) &&
    (skip === "group" || groups.size === 0 || groups.has(r.group)) &&
    (skip === "site" || sites.size === 0 || sites.has(r.site)) &&
    (skip === "bucket" || inBucket(r, bucket)) &&
    (!q || `${r.name} ${r.site} ${r.group} ${r.id}`.toLowerCase().includes(q));
  const visible = rows.filter((r) => match(r));
  const facet = (skip: "group" | "site", key: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) if (match(r, skip)) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const groupFacet = facet("group", (r) => r.group);
  const siteFacet = facet("site", (r) => r.site);
  const statusCounts = (["critical", "watch", "ok"] as Status[]).map(
    (s) => [s, rows.filter((r) => r.status === s && match(r, "status")).length] as const,
  );
  const histogram = RISK_BUCKETS.map(
    (_, i) => rows.filter((r) => match(r, "bucket") && inBucket(r, i)).length,
  );
  const anyFilter = !!status || groups.size > 0 || sites.size > 0 || bucket != null || !!q;
  const clearAll = () => {
    setStatus(null);
    setGroups(new Set());
    setSites(new Set());
    setBucket(null);
    setQuery("");
  };

  // ── sort + selection ─────────────────────────────────────────────────────
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "failure", desc: true });
  const sorted = useMemo(() => {
    const v = (r: Row): number | string => {
      switch (sort.key) {
        case "name":
          return r.name;
        case "site":
          return r.site;
        case "group":
          return r.group;
        case "condition":
          return r.condition ?? 999;
        case "alerts":
          return r.alerts;
        case "wos":
          return r.workOrders.length;
        case "lastOutage":
          return r.lastOutage ?? "";
        default:
          return r.failure ?? -1;
      }
    };
    return [...visible].sort((x, y) => {
      const a = v(x),
        b = v(y);
      const c = typeof a === "string" ? a.localeCompare(String(b)) : a - (b as number);
      return sort.desc ? -c : c;
    });
  }, [visible, sort]);
  const sortBy = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : { key, desc: !["name", "site", "group"].includes(key) },
    );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sorted.find((r) => r.id === selectedId) ?? sorted[0] ?? null;
  const [panelOpen, setPanelOpen] = useState(true);

  // ── metrics ──────────────────────────────────────────────────────────────
  const yearAgo = Date.now() - 365 * 86_400_000;
  const visibleIds = new Set(visible.map((r) => r.id));
  const forced = (sap.data ?? []).filter(
    (o) =>
      o.OUTAGE_TYPE === "FORCED" &&
      visibleIds.has(o.ASSET_ID) &&
      new Date(o.START_DATE).getTime() >= yearAgo,
  );
  const openWos = visible.reduce((s, r) => s + r.workOrders.length, 0);

  return (
    <div
      style={{ ...vars, fontFamily: FONT }}
      className="overflow-hidden rounded-[3px] border border-[var(--fd-border)] bg-[var(--fd-app)] text-[14px] leading-[20px] text-[var(--fd-text)] shadow-sm"
    >
      {/* module header */}
      <div className="flex h-12 items-center border-b border-[var(--fd-border)] bg-[var(--fd-panel)]">
        <div
          className="grid h-12 w-12 place-items-center"
          style={{ background: "color-mix(in srgb, var(--fd-red) 10%, transparent)" }}
        >
          <span className="grid size-7 place-items-center rounded-[3px] bg-[var(--fd-red)] text-white">
            <TriangleAlert className="size-4" strokeWidth={2.5} />
          </span>
        </div>
        <div className="ml-3 text-[16px] font-semibold">Equipment Risk Inbox</div>
        <div className="ml-6 hidden items-center gap-1 text-[13px] md:flex">
          {[
            ["Inbox", Table2, true],
            ["Map", MapPin, false],
            ["History", ClipboardList, false],
          ].map(([label, Icon, active]) => {
            const I = Icon as LucideIcon;
            return (
              <span
                key={label as string}
                className={cn(
                  "inline-flex h-12 items-center gap-1.5 border-b-[3px] px-3",
                  active
                    ? "border-[var(--fd-blue)] font-semibold text-[var(--fd-blue-text)]"
                    : "border-transparent text-[var(--fd-muted)]",
                )}
              >
                <I className="size-4" /> {label as string}
              </span>
            );
          })}
        </div>
        <div className="ml-auto mr-4 flex items-center gap-3 text-[12px] text-[var(--fd-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> {rows.length} objects · Equipment
          </span>
        </div>
      </div>

      <div
        className={cn(
          "grid h-[calc(100vh-190px)] min-h-[640px]",
          panelOpen ? "grid-cols-[272px_minmax(0,1fr)_400px]" : "grid-cols-[272px_minmax(0,1fr)]",
        )}
      >
        {/* ── filter rail ─────────────────────────────────────────────── */}
        <aside className="flex min-h-0 flex-col border-r border-[var(--fd-border)] bg-[var(--fd-panel)]">
          <SectionHeader icon={Filter} title="Filters">
            {anyFilter && (
              <button
                onClick={clearAll}
                className="text-[12px] text-[var(--fd-blue-text)] hover:underline"
              >
                Clear all
              </button>
            )}
          </SectionHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <div className="mt-3 space-y-1">
              {statusCounts.map(([s, n]) => {
                const Icon = s === "critical" ? CircleAlert : s === "watch" ? TriangleAlert : Check;
                const active = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(active ? null : s)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2.5 rounded-[3px] px-2.5 text-left transition-colors",
                      active
                        ? "bg-[var(--fd-sel)] text-[var(--fd-blue-text)]"
                        : "hover:bg-[var(--fd-hover)]",
                    )}
                  >
                    <Icon className={cn("size-4", !active && "text-[var(--fd-muted)]")} />
                    <span className="flex-1">{STATUS_LABEL[s]}</span>
                    <span className="tabular-nums text-[var(--fd-muted)]">{n}</span>
                  </button>
                );
              })}
            </div>

            <FacetTitle
              label={`Equipment type (${groups.size || groupFacet.length}/${groupFacet.length})`}
              onClear={groups.size ? () => setGroups(new Set()) : undefined}
            />
            <FacetList
              items={groupFacet}
              selected={groups}
              onToggle={(v) => toggle(groups, v, setGroups)}
            />

            <FacetTitle
              label={`Site (${sites.size || siteFacet.length}/${siteFacet.length})`}
              onClear={sites.size ? () => setSites(new Set()) : undefined}
            />
            <FacetList
              items={showAllSites ? siteFacet : siteFacet.slice(0, 6)}
              selected={sites}
              onToggle={(v) => toggle(sites, v, setSites)}
            />
            {siteFacet.length > 6 && (
              <button
                onClick={() => setShowAllSites((s) => !s)}
                className="mt-1 h-7 w-full rounded-[3px] bg-[var(--fd-sunken)] text-[12px] text-[var(--fd-muted)] hover:bg-[var(--fd-hover)]"
              >
                {showAllSites ? "Show less" : "Show more"}
              </button>
            )}

            <FacetTitle
              label="7-day failure risk (%)"
              onClear={bucket != null ? () => setBucket(null) : undefined}
            />
            <Histogram
              counts={histogram}
              selected={bucket}
              onSelect={(i) => setBucket(bucket === i ? null : i)}
            />
          </div>
          <div className="border-t border-[var(--fd-border)] p-3">
            <button
              onClick={clearAll}
              disabled={!anyFilter}
              className="h-[30px] w-full rounded-[3px] border border-[var(--fd-border)] bg-[var(--fd-sunken)] text-[13px] hover:bg-[var(--fd-hover)] disabled:opacity-50"
            >
              Reset filters
            </button>
          </div>
        </aside>

        {/* ── metrics + object table ───────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="grid grid-cols-2 gap-px border-b border-[var(--fd-border)] bg-[var(--fd-border)] lg:grid-cols-4">
            <Metric
              label="Objects in view"
              value={String(visible.length)}
              sub={`of ${rows.length} monitored`}
            />
            <Metric
              label="Critical"
              value={String(visible.filter((r) => r.status === "critical").length)}
              sub={`${visible.filter((r) => r.status === "watch").length} on watch`}
              intent="danger"
            />
            <Metric
              label="Open work orders"
              value={wos.isLoading ? "…" : String(openWos)}
              sub="linked to these objects"
            />
            <Metric
              label="Forced outages · 12 mo"
              value={sap.isLoading ? "…" : String(forced.length)}
              sub={
                sap.isLoading
                  ? "loading SAP history"
                  : formatUsd(forced.reduce((s, o) => s + num(o.TOTAL_IMPACT), 0))
              }
              intent={forced.length ? "warning" : "none"}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col bg-[var(--fd-panel)]">
            <SectionHeader icon={Table2} title="Object Table" count={sorted.length}>
              <label className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--fd-faint)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search properties to filter…"
                  className="h-[30px] w-60 rounded-[3px] border border-[var(--fd-border)] bg-[var(--fd-input)] pl-7 pr-2 text-[13px] outline-none placeholder:text-[var(--fd-faint)] focus:border-[var(--fd-blue)] focus:shadow-[0_0_0_1px_var(--fd-blue)]"
                />
              </label>
            </SectionHeader>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-10 bg-[var(--fd-panel)]">
                  <tr className="text-left text-[12px] font-semibold text-[var(--fd-muted)]">
                    <Th k="name" sort={sort} onSort={sortBy} className="pl-4">
                      Title
                    </Th>
                    <Th k="group" sort={sort} onSort={sortBy}>
                      Equipment Type
                    </Th>
                    <Th k="failure" sort={sort} onSort={sortBy}>
                      Failure Risk (7d)
                    </Th>
                    <Th k="condition" sort={sort} onSort={sortBy} align="right">
                      Condition
                    </Th>
                    <Th k="alerts" sort={sort} onSort={sortBy} align="right">
                      Alerts
                    </Th>
                    <Th k="wos" sort={sort} onSort={sortBy} align="right">
                      Open WOs
                    </Th>
                    <Th k="lastOutage" sort={sort} onSort={sortBy}>
                      Last Unplanned Outage
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const sel = selected?.id === r.id;
                    const { Icon, color } = objectIcon(r.group);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => {
                          setSelectedId(r.id);
                          setPanelOpen(true);
                        }}
                        className={cn(
                          "h-10 cursor-pointer",
                          sel ? "bg-[var(--fd-sel)]" : "hover:bg-[var(--fd-hover)]",
                        )}
                      >
                        <td
                          className={cn(
                            "border-b border-[var(--fd-divider)] py-1.5 pl-4 pr-3",
                            sel && "shadow-[inset_3px_0_0_var(--fd-blue)]",
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <ObjTile Icon={Icon} color={color} />
                            <span
                              className={cn("block max-w-[250px] truncate", sel && "font-semibold")}
                            >
                              {r.name}
                            </span>
                          </span>
                        </td>
                        <Td>{r.group}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-2">
                            <Tag intent={riskIntent(r.failure)}>{riskLabel(r.failure)}</Tag>
                            <span className="tabular-nums text-[var(--fd-muted)]">
                              {r.failure == null ? "" : `${r.failure}%`}
                            </span>
                          </span>
                        </Td>
                        <Td align="right">{r.condition ?? "—"}</Td>
                        <Td align="right">{r.alerts}</Td>
                        <Td align="right">{r.workOrders.length || ""}</Td>
                        <Td>
                          {r.lastOutage ? (
                            fmtDate(r.lastOutage)
                          ) : (
                            <span className="text-[var(--fd-faint)]">No value</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-[var(--fd-muted)]">
                        <ListFilter className="mx-auto mb-2 size-6 text-[var(--fd-faint)]" />
                        No objects match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── object view ─────────────────────────────────────────────── */}
        {panelOpen && (
          <ObjectView
            row={selected}
            loadingHistory={sap.isLoading || wos.isLoading}
            onClose={() => setPanelOpen(false)}
            onEvidence={() =>
              selected &&
              onEvidence({
                kind: "equipment",
                assetId: selected.id,
                site: selected.site,
                item: selected.a.name ?? selected.name,
                pct: selected.failure,
              })
            }
          />
        )}
      </div>
    </div>
  );
}

// ── object view panel ────────────────────────────────────────────────────────
type TabKey = "overview" | "properties" | "outages" | "work";
function ObjectView({
  row,
  loadingHistory,
  onClose,
  onEvidence,
}: {
  row: Row | null;
  loadingHistory: boolean;
  onClose: () => void;
  onEvidence: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [starred, setStarred] = useState<Set<string>>(() => new Set());
  if (!row) {
    return (
      <aside className="grid place-items-center border-l border-[var(--fd-border)] bg-[var(--fd-panel)] text-[var(--fd-muted)]">
        No object selected
      </aside>
    );
  }
  const a = row.a;
  const { Icon, color } = objectIcon(row.group);
  const isStar = starred.has(row.id);
  const props: Array<[string, ReactNode]> = [
    ["Failure Risk (7d)", row.failure == null ? "—" : `${row.failure}%`],
    ["Condition Score", row.condition ?? "—"],
    ["Health Index", a.health != null ? num(a.health).toFixed(1) : "—"],
    ["Anomaly Rate", a.anomaly_pct != null ? `${num(a.anomaly_pct).toFixed(1)}%` : "—"],
    ["Risk Level", titleCase(a.risk_level || "—")],
    ["Equipment Type", row.group],
    ["Category", titleCase(a.category || "—")],
    ["Site", row.site],
    ["Unit", a.unit || "—"],
    ["Region", titleCase(a.region || "—")],
    ["Running Tag", a.running_tag || "—"],
    ["Asset Id", row.id],
  ];
  const tabs: Array<[TabKey, string, number | null]> = [
    ["overview", "Overview", null],
    ["properties", "Properties", null],
    ["outages", "Outages", row.outages.length],
    ["work", "Work Orders", row.workOrders.length],
  ];
  const cost = row.outages.reduce((s, o) => s + num(o.TOTAL_IMPACT), 0);

  return (
    <aside className="flex min-h-0 flex-col border-l border-[var(--fd-border)] bg-[var(--fd-panel)]">
      <SectionHeader icon={Icon} title="Object View">
        <button
          onClick={onEvidence}
          className="h-[30px] rounded-[3px] bg-[var(--fd-blue)] px-3 text-[13px] font-medium text-white shadow-[inset_0_-1px_0_rgba(17,20,24,0.2)] hover:brightness-110"
        >
          Open evidence
        </button>
        <button
          onClick={onClose}
          aria-label="Close object view"
          className="grid size-[30px] place-items-center rounded-[3px] text-[var(--fd-muted)] hover:bg-[var(--fd-hover)]"
        >
          <PanelRightClose className="size-4" />
        </button>
      </SectionHeader>

      <div className="border-b border-[var(--fd-border)] px-4 pt-3">
        <div className="flex items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-[3px] text-white"
            style={{ background: color }}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold">{row.name}</span>
              <button
                aria-label={isStar ? "Unfavorite" : "Favorite"}
                onClick={() =>
                  setStarred((s) => {
                    const n = new Set(s);
                    if (n.has(row.id)) n.delete(row.id);
                    else n.add(row.id);
                    return n;
                  })
                }
                className="text-[var(--fd-faint)] hover:text-[var(--fd-orange)]"
              >
                <Star
                  className={cn(
                    "size-3.5",
                    isStar && "fill-[var(--fd-orange)] text-[var(--fd-orange)]",
                  )}
                />
              </button>
            </div>
            <div className="text-[12px] text-[var(--fd-muted)]">
              {row.group} (Equipment) · {row.site}
              {a.unit ? ` · ${a.unit}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-[13px]">
          {tabs.map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-[3px] pb-2",
                tab === k
                  ? "border-[var(--fd-blue)] text-[var(--fd-blue-text)]"
                  : "border-transparent text-[var(--fd-text)] hover:text-[var(--fd-blue-text)]",
              )}
            >
              {label}
              {n != null && n > 0 && (
                <span className="rounded-[3px] bg-[var(--fd-hover)] px-1.5 text-[11px] tabular-nums text-[var(--fd-muted)]">
                  {n}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--fd-app)] p-3">
        {tab === "overview" && (
          <>
            <Card icon={Gauge} title="Risk Summary">
              <div className="grid grid-cols-3 divide-x divide-[var(--fd-divider)]">
                <MiniStat
                  label="Failure Risk (7d)"
                  value={row.failure == null ? "—" : `${row.failure}%`}
                  intent={riskIntent(row.failure)}
                />
                <MiniStat label="Condition" value={String(row.condition ?? "—")} />
                <MiniStat
                  label="Active Alerts"
                  value={String(row.alerts)}
                  intent={row.alerts ? "warning" : "none"}
                />
              </div>
            </Card>
            <Card icon={ListFilter} title="Properties" onExpand={() => setTab("properties")}>
              <PropList items={props.slice(0, 7)} />
              <button
                onClick={() => setTab("properties")}
                className="mt-2 w-full border-t border-[var(--fd-divider)] pt-2 text-center text-[13px] text-[var(--fd-blue-text)] hover:underline"
              >
                View all…
              </button>
            </Card>
            <Card icon={ExternalLink} title="Links">
              <LinkGroup label="Site">
                <LinkRow
                  Icon={MapPin}
                  color="#CD4246"
                  text={`${row.site}${a.region ? ` (${titleCase(a.region)})` : ""}`}
                />
              </LinkGroup>
              <LinkGroup label={`Open Work Orders (${row.workOrders.length})`}>
                {row.workOrders.length ? (
                  row.workOrders
                    .slice(0, 3)
                    .map((w) => (
                      <LinkRow
                        key={w.wr_id}
                        Icon={ClipboardList}
                        color="#2D72D2"
                        text={`${w.wr_id ?? "WO"} · ${w.problem_descr ?? ""}`}
                        onClick={() => setTab("work")}
                      />
                    ))
                ) : (
                  <Empty text={loadingHistory ? "Loading…" : "No open work orders"} />
                )}
              </LinkGroup>
              <LinkGroup
                label={`Outages (${row.outages.length}${cost ? ` · ${formatUsd(cost)}` : ""})`}
              >
                {row.outages.length ? (
                  row.outages
                    .slice(0, 3)
                    .map((o) => (
                      <LinkRow
                        key={o.OUTAGE_ID}
                        Icon={Zap}
                        color={
                          o.OUTAGE_TYPE === "FORCED"
                            ? "#CD4246"
                            : o.OUTAGE_TYPE === "PLANNED"
                              ? "#238551"
                              : "#C87619"
                        }
                        text={`${fmtDate(o.START_DATE)} · ${titleCase(o.OUTAGE_TYPE.toLowerCase())} · ${o.CAUSE_TEXT}`}
                        onClick={() => setTab("outages")}
                      />
                    ))
                ) : (
                  <Empty text={loadingHistory ? "Loading SAP history…" : "No outages recorded"} />
                )}
              </LinkGroup>
            </Card>
          </>
        )}
        {tab === "properties" && (
          <Card icon={ListFilter} title="All Properties">
            <PropList items={props} />
          </Card>
        )}
        {tab === "outages" && (
          <Card icon={Zap} title="Outages (SAP)">
            {row.outages.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold text-[var(--fd-muted)]">
                    <th className="pb-1.5">Start</th>
                    <th className="pb-1.5">Type</th>
                    <th className="pb-1.5 text-right">Hours</th>
                    <th className="pb-1.5 text-right">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {row.outages.map((o) => (
                    <tr
                      key={o.OUTAGE_ID}
                      className="border-t border-[var(--fd-divider)]"
                      title={o.CAUSE_TEXT}
                    >
                      <td className="py-1.5">{fmtDate(o.START_DATE)}</td>
                      <td>
                        <Tag
                          intent={
                            o.OUTAGE_TYPE === "FORCED"
                              ? "danger"
                              : o.OUTAGE_TYPE === "PLANNED"
                                ? "success"
                                : "warning"
                          }
                        >
                          {titleCase(o.OUTAGE_TYPE.toLowerCase())}
                        </Tag>
                      </td>
                      <td className="text-right tabular-nums">{Math.round(num(o.DURATION_H))}</td>
                      <td className="text-right tabular-nums">{formatUsd(num(o.TOTAL_IMPACT))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty text={loadingHistory ? "Loading SAP history…" : "No outages recorded"} />
            )}
          </Card>
        )}
        {tab === "work" && (
          <Card icon={ClipboardList} title="Open Work Orders">
            {row.workOrders.length ? (
              <div className="divide-y divide-[var(--fd-divider)]">
                {row.workOrders.map((w) => (
                  <div key={w.wr_id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-[var(--fd-blue-text)]">
                        {w.wr_id}
                      </span>
                      <Tag
                        intent={
                          num(w.priority_rank) <= 1
                            ? "danger"
                            : num(w.priority_rank) === 2
                              ? "warning"
                              : "none"
                        }
                      >
                        {w.priority ?? "—"}
                      </Tag>
                    </div>
                    <div className="mt-0.5">{w.problem_descr}</div>
                    <div className="text-[12px] text-[var(--fd-muted)]">
                      {w.wr_status} · {fmtDate(w.create_date)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text={loadingHistory ? "Loading…" : "No open work orders"} />
            )}
          </Card>
        )}
      </div>
    </aside>
  );
}

// ── Blueprint-style building blocks ─────────────────────────────────────────
type Intent = "none" | "primary" | "success" | "warning" | "danger";
const INTENT_VAR: Record<Intent, string> = {
  none: "var(--fd-muted)",
  primary: "var(--fd-blue)",
  success: "var(--fd-green)",
  warning: "var(--fd-orange)",
  danger: "var(--fd-red)",
};

function Tag({ intent, children }: { intent: Intent; children: ReactNode }) {
  const c = INTENT_VAR[intent];
  return (
    <span
      className="inline-flex h-5 items-center rounded-[2px] border px-1.5 text-[12px] leading-none"
      style={{
        color: c,
        borderColor: `color-mix(in srgb, ${c} 55%, transparent)`,
        background: `color-mix(in srgb, ${c} 10%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function ObjTile({ Icon, color }: { Icon: LucideIcon; color: string }) {
  return (
    <span
      className="grid size-5 shrink-0 place-items-center rounded-[2px] text-white"
      style={{ background: color }}
    >
      <Icon className="size-3" strokeWidth={2.5} />
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--fd-border)] bg-[var(--fd-panel)] px-4">
      <Icon className="size-4 text-[var(--fd-muted)]" />
      <span className="font-semibold">{title}</span>
      {count != null && (
        <span className="rounded-[3px] bg-[var(--fd-hover)] px-1.5 text-[12px] tabular-nums text-[var(--fd-muted)]">
          {count}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

function FacetTitle({ label, onClear }: { label: string; onClear?: (() => void) | undefined }) {
  return (
    <div className="mb-1.5 mt-5 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.02em] text-[var(--fd-muted)]">
      {label}
      {onClear && (
        <button
          onClick={onClear}
          className="font-normal normal-case text-[var(--fd-muted)] hover:text-[var(--fd-blue-text)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function FacetList({
  items,
  selected,
  onToggle,
}: {
  items: Array<[string, number]>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  return (
    <div className="space-y-0.5">
      {items.map(([v, n]) => {
        const on = selected.has(v);
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className="flex h-7 w-full items-center gap-2 rounded-[3px] px-1 text-left text-[13px] hover:bg-[var(--fd-hover)]"
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-[3px] border",
                on
                  ? "border-[var(--fd-blue)] bg-[var(--fd-blue)] text-white"
                  : "border-[var(--fd-border)] bg-[var(--fd-input)]",
              )}
            >
              {on && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{v}</span>
            <span className="w-6 text-right tabular-nums text-[var(--fd-muted)]">{n}</span>
            <span className="h-2 w-12 overflow-hidden rounded-[1px]">
              <span
                className="block h-full rounded-[1px] bg-[var(--fd-bar)]"
                style={{ width: `${(n / max) * 100}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Histogram({
  counts,
  selected,
  onSelect,
}: {
  counts: number[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div className="rounded-[3px] border border-[var(--fd-divider)] p-2">
      <div className="flex h-24 items-end gap-1">
        {counts.map((c, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            title={`${RISK_BUCKETS[i]!.label}%: ${c} objects`}
            className="group relative flex h-full flex-1 flex-col justify-end"
          >
            <span className="mb-0.5 text-center text-[10px] tabular-nums text-[var(--fd-muted)]">
              {c || ""}
            </span>
            <span
              className={cn(
                "block w-full rounded-t-[1px] transition-opacity",
                selected == null || selected === i ? "opacity-100" : "opacity-35",
              )}
              style={{
                height: `${Math.max(c ? 6 : 2, (c / max) * 72)}px`,
                background:
                  i >= 5 ? "var(--fd-red)" : i >= 3 ? "var(--fd-orange)" : "var(--fd-bar)",
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1 border-t border-[var(--fd-divider)] pt-1">
        {RISK_BUCKETS.map((b) => (
          <span key={b.label} className="flex-1 text-center text-[10px] text-[var(--fd-muted)]">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  intent = "none",
}: {
  label: string;
  value: string;
  sub: string;
  intent?: Intent;
}) {
  return (
    <div className="bg-[var(--fd-panel)] px-4 py-3">
      <div className="text-[12px] text-[var(--fd-muted)]">{label}</div>
      <div
        className="mt-0.5 text-[24px] font-semibold leading-8 tabular-nums"
        style={intent !== "none" ? { color: INTENT_VAR[intent] } : undefined}
      >
        {value}
      </div>
      <div className="text-[12px] text-[var(--fd-muted)]">{sub}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  intent = "none",
}: {
  label: string;
  value: string;
  intent?: Intent;
}) {
  return (
    <div className="px-3 first:pl-0">
      <div className="text-[12px] text-[var(--fd-muted)]">{label}</div>
      <div
        className="text-[20px] font-semibold tabular-nums"
        style={intent !== "none" ? { color: INTENT_VAR[intent] } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  onExpand,
  children,
}: {
  icon: LucideIcon;
  title: string;
  onExpand?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[3px] border border-[var(--fd-border)] bg-[var(--fd-panel)]">
      <div className="flex h-10 items-center gap-2 border-b border-[var(--fd-divider)] px-3">
        <Icon className="size-4 text-[var(--fd-muted)]" />
        <span className="font-semibold">{title}</span>
        {onExpand && (
          <button
            onClick={onExpand}
            aria-label={`Open ${title}`}
            className="ml-auto text-[var(--fd-muted)] hover:text-[var(--fd-blue-text)]"
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function PropList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,44%)_1fr] gap-x-3 gap-y-2 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate text-[var(--fd-muted)] underline decoration-dotted decoration-[var(--fd-faint)] underline-offset-[3px]">
            {k}
          </dt>
          <dd className="truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinkGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[13px] text-[var(--fd-muted)]">{label}:</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function LinkRow({
  Icon,
  color,
  text,
  onClick,
}: {
  Icon: LucideIcon;
  color: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[3px] py-0.5 text-left hover:bg-[var(--fd-hover)]"
    >
      <ChevronRight className="size-3.5 shrink-0 text-[var(--fd-faint)]" />
      <span
        className="grid size-6 shrink-0 place-items-center rounded-[3px] text-white"
        style={{ background: color }}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="truncate text-[13px] text-[var(--fd-blue-text)]">{text}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-1 text-[13px] text-[var(--fd-faint)]">{text}</div>;
}

function Th({
  k,
  sort,
  onSort,
  children,
  align = "left",
  className,
}: {
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = active ? (sort.desc ? ArrowDown : ArrowUp) : ChevronsUpDown;
  return (
    <th className={cn("whitespace-nowrap border-b border-[var(--fd-border)] px-3 py-2", className)}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-[var(--fd-text)]",
          align === "right" && "w-full justify-end",
          active && "text-[var(--fd-text)]",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function Td({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap border-b border-[var(--fd-divider)] px-3 py-1.5",
        align === "right" && "text-right tabular-nums",
      )}
    >
      {children}
    </td>
  );
}
