import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Cog, Cpu, Layers, Search, Waves } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { OpsMap } from "@/components/ops/OpsMap";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { ASSET_TYPE_LABEL, RISK_LABEL } from "@/lib/format";
import type { Asset, AssetRisk, RiskLevel } from "@/lib/domain/types";
import { MODES } from "@/report/lib/themes.js";

// Asset Explorer — a navigator for the estate. Drill the hierarchy:
//   Energy Infrastructure → Type → Asset          (weather storm-exposure)
//   Rotating & Fired Equipment → Plant → Unit → Asset   (digital-twin condition)
// Every node rolls up its worst status + open-issue count. Leaves open the storm-exposure
// detail (infrastructure) or the full 3D asset modal (equipment).

type Domain = "infrastructure" | "equipment";
type Sev = "critical" | "high" | "elevated" | "watch" | "monitor" | "ok" | "normal";

const SEV_COLOR: Record<Sev, string> = {
  critical: "#ff5470",
  high: "#ff8c42",
  elevated: "#ffcc4d",
  watch: "#ffcc4d",
  monitor: "#5aa9ff",
  ok: "#2fd07a",
  normal: "#2fd07a",
};
const SEV_RANK: Record<Sev, number> = {
  critical: 5,
  high: 4,
  elevated: 3,
  watch: 3,
  monitor: 2,
  ok: 0,
  normal: 0,
};
const isIssue = (s: Sev) => SEV_RANK[s] >= 3;

type EquipAsset = {
  asset_id: string;
  name: string;
  plant: string;
  unit: string;
  category: string;
  status: "ok" | "watch" | "critical";
  health: number;
  condition: number;
  anom_n: number;
  watch_n: number;
  max_z: number;
};
type FacAsset = {
  asset_id: string;
  name: string;
  plant: string;
  unit: string;
  category: string;
  status: EquipAsset["status"];
};

type Node = {
  id: string;
  kind: "domain" | "group" | "plant" | "unit" | "asset";
  label: string;
  domain: Domain;
  sev: Sev;
  count: number;
  issues: number;
  children?: Node[];
  infra?: { asset: Asset; risk?: AssetRisk };
  equip?: FacAsset;
};

function rollup(children: Node[]): { sev: Sev; count: number; issues: number } {
  let sev: Sev = "ok";
  let count = 0;
  let issues = 0;
  for (const c of children) {
    if (SEV_RANK[c.sev] > SEV_RANK[sev]) sev = c.sev;
    count += c.count;
    issues += c.issues;
  }
  return { sev, count, issues };
}

function leavesUnder(n: Node): Node[] {
  if (n.kind === "asset") return [n];
  return (n.children ?? []).flatMap(leavesUnder);
}
function findNode(nodes: Node[], id: string): Node | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function AssetExplorerPage() {
  const router = useRouter();
  const base = useOpsBase();
  const { assets, riskMap, event } = useOpsSnapshot(base, 120);

  const [facility, setFacility] = useState<{
    plants: { name: string; unitList: { name: string; assets: FacAsset[] }[] }[];
  } | null>(null);
  const [equipMeta, setEquipMeta] = useState<Record<string, EquipAsset>>({});
  const [AssetModal, setAssetModal] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [modalAsset, setModalAsset] = useState<FacAsset | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set(["infra", "equip"]));
  const [selected, setSelected] = useState<string | null>("infra");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"weather" | "pdm">("weather");
  const activeDomain: Domain = tab === "weather" ? "infrastructure" : "equipment";

  useEffect(() => {
    const rootId = tab === "weather" ? "infra" : "equip";
    setSelected(rootId);
    setExpanded(new Set([rootId]));
    setQ("");
  }, [tab]);

  useEffect(() => {
    let ok = true;
    import("@/report/lib/sample.js").then((m) => {
      if (!ok) return;
      setFacility(m.facilityModel());
      setEquipMeta(
        Object.fromEntries((m.fleetAssets() as EquipAsset[]).map((a) => [a.asset_id, a])),
      );
    });
    import("@/report/components/FleetGrid.jsx").then(
      (m) => ok && setAssetModal(() => m.AssetModal),
    );
    return () => {
      ok = false;
    };
  }, []);

  const tree = useMemo<Node[]>(() => {
    // infrastructure grouped by type
    const byType: Record<string, Asset[]> = {};
    for (const a of assets) (byType[a.type] ||= []).push(a);
    const infraGroups: Node[] = Object.entries(byType)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([type, list]) => {
        const leaves: Node[] = list
          .map((a) => {
            const risk = riskMap.get(a.id);
            const sev = (risk?.level ?? "normal") as Sev;
            return {
              id: `i:${a.id}`,
              kind: "asset" as const,
              label: a.name,
              domain: "infrastructure" as const,
              sev,
              count: 1,
              issues: isIssue(sev) ? 1 : 0,
              infra: { asset: a, risk },
            };
          })
          .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
        const r = rollup(leaves);
        return {
          id: `infra:${type}`,
          kind: "group" as const,
          label: ASSET_TYPE_LABEL[type as Asset["type"]],
          domain: "infrastructure" as const,
          children: leaves,
          ...r,
        };
      });
    const infraRoot: Node = {
      id: "infra",
      kind: "domain",
      label: "Energy Infrastructure",
      domain: "infrastructure",
      children: infraGroups,
      ...rollup(infraGroups),
    };

    // equipment grouped by plant → unit
    const equipPlants: Node[] = (facility?.plants ?? []).map((p) => {
      const units: Node[] = p.unitList.map((u) => {
        const leaves: Node[] = u.assets
          .map((a) => {
            const sev = a.status as Sev;
            return {
              id: `e:${a.asset_id}`,
              kind: "asset" as const,
              label: a.name,
              domain: "equipment" as const,
              sev,
              count: 1,
              issues: isIssue(sev) ? 1 : 0,
              equip: a,
            };
          })
          .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
        return {
          id: `equip:${p.name}:${u.name}`,
          kind: "unit" as const,
          label: u.name,
          domain: "equipment" as const,
          children: leaves,
          ...rollup(leaves),
        };
      });
      return {
        id: `equip:${p.name}`,
        kind: "plant" as const,
        label: p.name,
        domain: "equipment" as const,
        children: units,
        ...rollup(units),
      };
    });
    const equipRoot: Node = {
      id: "equip",
      kind: "domain",
      label: "Rotating & Fired Equipment",
      domain: "equipment",
      children: equipPlants,
      ...rollup(equipPlants),
    };

    return [infraRoot, equipRoot];
  }, [assets, riskMap, facility]);

  // search auto-expands matching branches
  const matchIds = useMemo(() => {
    if (!q.trim()) return null;
    const s = q.toLowerCase();
    const keep = new Set<string>();
    const walk = (n: Node): boolean => {
      const selfMatch = n.label.toLowerCase().includes(s);
      const childMatch = (n.children ?? []).map(walk).some(Boolean);
      if (selfMatch || childMatch) keep.add(n.id);
      return selfMatch || childMatch;
    };
    tree.forEach(walk);
    return keep;
  }, [q, tree]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sel = selected ? findNode(tree, selected) : null;
  const selLeaves = sel ? leavesUnder(sel) : [];
  const problemLeaves = selLeaves
    .filter((l) => l.issues > 0)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
  const highlightInfraIds =
    sel?.domain === "infrastructure" ? selLeaves.map((l) => l.infra!.asset.id) : [];

  const renderNode = (n: Node, depth: number): ReactNode => {
    if (matchIds && !matchIds.has(n.id)) return null;
    const isOpen = expanded.has(n.id) || (matchIds ? matchIds.has(n.id) : false);
    const hasChildren = !!n.children?.length;
    const isSel = selected === n.id;
    return (
      <div key={n.id}>
        <div
          onClick={() => {
            setSelected(n.id);
            if (hasChildren) toggle(n.id);
            if (n.kind === "asset" && n.domain === "equipment") setModalAsset(n.equip!);
          }}
          className={`flex cursor-pointer items-center gap-1.5 rounded-sm py-1.5 pr-2 text-[12.5px] hover:bg-accent/50 ${isSel ? "bg-accent/70" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {n.kind === "domain" &&
            (n.domain === "infrastructure" ? (
              <Waves className="size-3.5 shrink-0" style={{ color: "#5aa9ff" }} />
            ) : (
              <Cog className="size-3.5 shrink-0" style={{ color: "#a986ff" }} />
            ))}
          <span className="size-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[n.sev] }} />
          <span
            className={`truncate ${n.kind === "domain" ? "font-semibold" : n.kind === "asset" ? "" : "font-medium"}`}
          >
            {n.label}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
            {n.issues > 0 && (
              <span
                className="rounded-full px-1.5 text-[10px] font-semibold"
                style={{ color: SEV_COLOR[n.sev], background: `${SEV_COLOR[n.sev]}1f` }}
              >
                {n.issues} issue{n.issues === 1 ? "" : "s"}
              </span>
            )}
            {n.kind !== "asset" && (
              <span className="num text-[10px] text-muted-foreground">{n.count}</span>
            )}
          </span>
        </div>
        {hasChildren && isOpen && <div>{n.children!.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  };

  const selInfraAsset =
    sel?.kind === "asset" && sel.domain === "infrastructure" ? sel.infra!.asset : null;
  const selEquipMeta =
    sel?.kind === "asset" && sel.domain === "equipment" ? equipMeta[sel.equip!.asset_id] : null;

  return (
    <AppShell fullHeight>
      <div className="flex h-full min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            <div>
              <h1 className="text-sm font-semibold">Asset Explorer</h1>
              <p className="text-[11px] text-muted-foreground">
                Navigate the estate hierarchy and drill into any issue.
              </p>
            </div>
          </div>
          <div className="ml-auto inline-flex overflow-hidden rounded-md border">
            {(
              [
                ["weather", "Weather"],
                ["pdm", "Predictive Maintenance"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${tab === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* tree */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="shrink-0 border-b p-2.5">
              <div className="relative">
                <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search sites, units, assets…"
                  className="w-full rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {(() => {
                const root = activeDomain === "infrastructure" ? tree[0] : tree[1];
                return root ? renderNode(root, 0) : null;
              })()}
            </div>
          </div>

          {/* detail */}
          <div className="min-h-0 overflow-y-auto">
            {!sel ? (
              <div className="grid h-full min-h-[50vh] place-items-center p-8 text-center text-sm text-muted-foreground">
                Select a site, unit or asset from the hierarchy to see its status and issues.
              </div>
            ) : selEquipMeta ? (
              // equipment leaf
              <div className="space-y-4 p-4">
                <div className="panel p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-base font-semibold">{sel.label}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {sel.equip!.plant} · Unit {sel.equip!.unit} · {sel.equip!.category}
                      </div>
                    </div>
                    <span
                      className="rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase"
                      style={{
                        color: SEV_COLOR[sel.sev],
                        borderColor: `${SEV_COLOR[sel.sev]}55`,
                        background: `${SEV_COLOR[sel.sev]}1f`,
                      }}
                    >
                      {sel.sev === "ok" ? "Healthy" : sel.sev}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["Condition", `${selEquipMeta.condition}%`],
                      ["Health", `${selEquipMeta.health}%`],
                      ["Anomalies", selEquipMeta.anom_n],
                      ["Peak z", selEquipMeta.max_z],
                    ].map(([l, v]) => (
                      <div key={l} className="rounded-md border bg-card px-2 py-2">
                        <div className="num text-lg leading-none font-semibold">{v}</div>
                        <div className="label-xs mt-1">{l}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setModalAsset(sel.equip!)}
                    className="mt-4 inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground"
                  >
                    <Cpu className="size-3.5" /> Open 3D twin &amp; diagnostics
                  </button>
                </div>
              </div>
            ) : selInfraAsset ? (
              // infrastructure leaf
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
                <div className="panel h-[360px] overflow-hidden">
                  <OpsMap
                    className="h-full w-full"
                    assets={assets}
                    risks={riskMap}
                    event={event}
                    layers={{ assets: true, track: true, wind: true }}
                    highlightIds={[selInfraAsset.id]}
                    selectedId={selInfraAsset.id}
                    onSelect={(id) => id && setSelected(`i:${id}`)}
                  />
                </div>
                <div className="panel max-h-[480px] overflow-hidden">
                  <AssetDetailPanel
                    asset={selInfraAsset}
                    risk={riskMap.get(selInfraAsset.id)}
                    event={event}
                    allAssets={assets}
                    onClose={() => setSelected(null)}
                    onSelect={(id) => setSelected(`i:${id}`)}
                  />
                </div>
              </div>
            ) : (
              // branch rollup
              <div className="space-y-4 p-4">
                <div className="panel p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-base font-semibold">{sel.label}</div>
                      <div className="text-[12px] text-muted-foreground capitalize">
                        {sel.kind} · {sel.count} asset{sel.count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span
                      className="rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase"
                      style={{
                        color: SEV_COLOR[sel.sev],
                        borderColor: `${SEV_COLOR[sel.sev]}55`,
                        background: `${SEV_COLOR[sel.sev]}1f`,
                      }}
                    >
                      {sel.issues} open issue{sel.issues === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div
                  className={
                    sel.domain === "infrastructure" ? "grid gap-4 xl:grid-cols-2 [&>*]:min-w-0" : ""
                  }
                >
                  {sel.domain === "infrastructure" && (
                    <div className="panel h-[420px] overflow-hidden xl:order-2">
                      <OpsMap
                        className="h-full w-full"
                        assets={assets}
                        risks={riskMap}
                        event={event}
                        layers={{ assets: true, track: true, wind: true }}
                        highlightIds={highlightInfraIds}
                        onSelect={(id) => id && setSelected(`i:${id}`)}
                      />
                    </div>
                  )}

                  <div className="panel overflow-hidden xl:order-1">
                    <div className="border-b px-4 py-2.5 text-[13px] font-semibold">
                      Issues in this {sel.kind}{" "}
                      {problemLeaves.length > 0 && `(${problemLeaves.length})`}
                    </div>
                    {problemLeaves.length === 0 ? (
                      <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                        No open issues here — everything nominal.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {problemLeaves.map((l) => (
                          <button
                            key={l.id}
                            onClick={() => {
                              setSelected(l.id);
                              if (l.domain === "equipment") setModalAsset(l.equip!);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: SEV_COLOR[l.sev] }}
                            />
                            <span className="w-56 shrink-0 truncate text-[13px] font-medium">
                              {l.label}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                              {l.domain === "infrastructure"
                                ? `${l.infra!.asset.region} · ${l.infra!.risk?.hoursToImpact != null ? `${l.infra!.risk!.hoursToImpact}h to impact` : "monitoring"}`
                                : `${l.equip!.plant} · Unit ${l.equip!.unit} · ${l.equip!.category}`}
                            </span>
                            <span
                              className="num shrink-0 text-[11px] font-semibold"
                              style={{ color: SEV_COLOR[l.sev] }}
                            >
                              {l.domain === "infrastructure"
                                ? RISK_LABEL[l.sev as RiskLevel]
                                : l.sev === "critical"
                                  ? "Critical"
                                  : "Watch"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {AssetModal && (
        <AssetModal theme={MODES.dark} asset={modalAsset} onClose={() => setModalAsset(null)} />
      )}
    </AppShell>
  );
}
