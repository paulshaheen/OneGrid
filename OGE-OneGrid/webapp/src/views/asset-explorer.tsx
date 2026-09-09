import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Cog, Cpu, Layers, Search, Waves } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { PageLoading } from "@/components/ops/PageLoading";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { OpsMap } from "@/components/ops/OpsMap";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { RISK_LABEL } from "@/lib/format";
import type { Asset, AssetRisk, RiskLevel } from "@/lib/domain/types";
import { MODES } from "@/report/lib/themes.js";
import { getJson } from "@/report/lib/api.js";

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
  const snap = useOpsSnapshot(base, 120);
  const { assets, riskMap, event } = snap;

  const [facility, setFacility] = useState<{
    plants: { name: string; unitList: { name: string; assets: FacAsset[] }[] }[];
  } | null>(null);
  const [equipMeta, setEquipMeta] = useState<Record<string, EquipAsset>>({});
  const [AssetModal, setAssetModal] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [modalAsset, setModalAsset] = useState<(FacAsset & Partial<EquipAsset>) | null>(null);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"weather" | "pdm">("weather");
  const activeDomain: Domain = tab === "weather" ? "infrastructure" : "equipment";

  // Both tabs share the SAME node ids (root / p:<plant> / u:<plant>:<unit> / a:<assetId>),
  // so a single expansion + selection state carries your navigation across the
  // Weather <-> Predictive Maintenance toggle instead of resetting.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [selected, setSelected] = useState<string | null>("root");

  useEffect(() => {
    let ok = true;
    // Load the facility model + equipment meta from the SAME source the tag-values come
    // from (getJson honours backend mode): live backend when deployed, sample otherwise.
    // Previously these came straight from sample.js, so sample-only units (e.g. Riverton
    // RV3/RV4) had no live Eventhouse telemetry and the 3D model showed empty values.
    getJson("/api/facility-model")
      .then(
        (fm) =>
          ok &&
          setFacility(
            fm as {
              plants: { name: string; unitList: { name: string; assets: FacAsset[] }[] }[];
            },
          ),
      )
      .catch(() => {});
    getJson("/api/fleet-assets")
      .then(
        (fa) =>
          ok &&
          setEquipMeta(
            Object.fromEntries((fa as EquipAsset[]).map((a) => [a.asset_id, a])),
          ),
      )
      .catch(() => {});
    import("@/report/components/FleetGrid.jsx").then(
      (m) => ok && setAssetModal(() => m.AssetModal),
    );
    return () => {
      ok = false;
    };
  }, []);

  const tree = useMemo<Node[]>(() => {
    const siteByName = new Map(assets.map((a) => [a.name, a]));

    // Both tabs share the SAME facility hierarchy AND the SAME node ids
    // (root / p:<plant> / u:<plant>:<unit> / a:<assetId>), so navigation carries across
    // the tab toggle. Only the lens differs — Predictive Maintenance colours by equipment
    // condition; Weather by the site's storm exposure (inherited by everything at the site).
    const build = (domain: Domain, rootLabel: string): Node => {
      const plants: Node[] = (facility?.plants ?? []).map((p) => {
        const site = siteByName.get(p.name) ?? null;
        const siteRisk = site ? riskMap.get(site.id) : undefined;
        const pid = `p:${p.name}`;
        const siteInfra =
          domain === "infrastructure" && site
            ? siteRisk
              ? { asset: site, risk: siteRisk }
              : { asset: site }
            : undefined;
        const units: Node[] = p.unitList.map((u) => {
          const leaves: Node[] = u.assets
            .map((a) => {
              const meta = domain === "equipment" ? equipMeta[a.asset_id] : undefined;
              const sev: Sev =
                domain === "equipment"
                  ? ((meta?.status ?? a.status) as Sev)
                  : ((siteRisk?.level ?? "normal") as Sev);
              const common = {
                id: `a:${a.asset_id}`,
                kind: "asset" as const,
                label: a.name,
                domain,
                sev,
                count: 1,
                issues: isIssue(sev) ? 1 : 0,
              };
              return domain === "equipment"
                ? { ...common, equip: { ...a, plant: p.name, unit: u.name } }
                : { ...common, ...(siteInfra ? { infra: siteInfra } : {}) };
            })
            .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
          return {
            id: `u:${p.name}:${u.name}`,
            kind: "unit" as const,
            label: u.name,
            domain,
            children: leaves,
            ...(siteInfra ? { infra: siteInfra } : {}),
            ...rollup(leaves),
          };
        });
        return {
          id: pid,
          kind: "plant" as const,
          label: p.name,
          domain,
          children: units,
          ...(siteInfra ? { infra: siteInfra } : {}),
          ...rollup(units),
        };
      });
      return {
        id: "root",
        kind: "domain",
        label: rootLabel,
        domain,
        children: plants,
        ...rollup(plants),
      };
    };

    return [
      build("infrastructure", "Energy Infrastructure"),
      build("equipment", "Rotating & Fired Equipment"),
    ];
  }, [assets, riskMap, facility, equipMeta]);

  const activeTree = activeDomain === "infrastructure" ? tree[0] : tree[1];

  // search auto-expands matching branches (in the active tab's tree)
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
    if (activeTree) walk(activeTree);
    return keep;
  }, [q, activeTree]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sel = selected && activeTree ? findNode([activeTree], selected) : null;
  const selLeaves = sel ? leavesUnder(sel) : [];
  const problemLeaves = selLeaves
    .filter((l) => l.issues > 0)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
  const highlightInfraIds =
    sel?.domain === "infrastructure"
      ? (selLeaves.map((l) => l.infra?.asset.id).filter(Boolean) as string[])
      : [];

  // The exposure map returns a SITE asset id; map it to the shared plant node id so
  // selection lands on the same tree node regardless of the active tab.
  const selectSite = (siteId?: string) => {
    if (!siteId) return;
    const nm = assets.find((a) => a.id === siteId)?.name;
    if (nm) setSelected(`p:${nm}`);
  };

  // Open the 3D twin modal with the equipment leaf enriched by its fleet-assets meta
  // (condition/health/max_z/etc.) so the banner + hotspots have the full picture. The
  // modal itself resolves live tags from /api/asset/:id using the (real) asset_id.
  const openTwin = (fac: FacAsset) =>
    setModalAsset({ ...fac, ...(equipMeta[fac.asset_id] ?? {}) });

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
            if (n.kind === "asset" && n.domain === "equipment") openTwin(n.equip!);
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
    sel?.domain === "infrastructure" ? (sel.infra?.asset ?? null) : null;
  const selEquipMeta =
    sel?.kind === "asset" && sel.domain === "equipment" ? equipMeta[sel.equip!.asset_id] : null;

  if (snap.isLoading && assets.length === 0) {
    return (
      <AppShell fullHeight>
        <PageLoading label="Loading asset hierarchy…" />
      </AppShell>
    );
  }

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
                const root = activeTree;
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
                    onClick={() => openTwin(sel.equip!)}
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
                    onSelect={(id) => selectSite(id)}
                  />
                </div>
                <div className="panel max-h-[480px] overflow-hidden">
                  <AssetDetailPanel
                    asset={selInfraAsset}
                    risk={riskMap.get(selInfraAsset.id)}
                    event={event}
                    allAssets={assets}
                    onClose={() => setSelected(null)}
                    onSelect={(id) => selectSite(id)}
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
                        onSelect={(id) => selectSite(id)}
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
                              if (l.domain === "equipment") openTwin(l.equip!);
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
