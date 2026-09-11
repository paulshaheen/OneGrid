import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Layers, Loader2, Search } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { PageLoading } from "@/components/ops/PageLoading";
import { AssetDetailPanel } from "@/components/ops/AssetDetailPanel";
import { WeatherHoloMap } from "@/components/ops/WeatherHoloMap";
import { InlineFacility } from "@/components/ops/InlineFacility";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot, eventsQuery } from "@/lib/hooks/use-ops-data";
import type { Asset, AssetRisk } from "@/lib/domain/types";
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

// Coarse badge bucket (matches the reference: critical=red, high/elevated=yellow, else blue).
const sevBucket = (s: Sev): "red" | "yellow" | "blue" =>
  s === "critical" ? "red" : s === "high" || s === "elevated" || s === "watch" ? "yellow" : "blue";
const BUCKET_STROKE = { red: "#fca5a5", yellow: "#fef08a", blue: "#38bdf8" } as const;

// Tree styling copied from the reference mock: elbow connector lines via CSS
// pseudo-elements, colored issue badges, and a blue selection ring.
const TREE_CSS = `
.ae-tree { list-style:none; padding:0; margin:0; }
.ae-node { position:relative; }
.ae-node-content { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:6px; font-size:13px; cursor:pointer; margin-bottom:2px; border:1px solid transparent; }
.ae-node-content:hover { background: rgba(255,255,255,0.035); }
.ae-node-content.ae-selected { background: rgba(56,189,248,0.08); border:1px solid #38bdf8; box-shadow:0 0 10px rgba(56,189,248,0.15); }
.ae-node-left { display:flex; align-items:center; gap:8px; min-width:0; }
.ae-node-left > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ae-node-right { display:flex; align-items:center; gap:12px; flex-shrink:0; }
.ae-icon { width:14px; height:14px; flex-shrink:0; }
.ae-chevron { stroke:#8b949e; }
.ae-rig { stroke:#8b949e; fill:none; }
.ae-ok { stroke:#4ade80; }
.ae-spacer { width:14px; flex-shrink:0; }
.ae-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:500; white-space:nowrap; }
.ae-badge svg { width:11px; height:11px; }
.ae-badge-red { background:rgba(248,113,113,0.15); border:1px solid rgba(248,113,113,0.4); color:#fca5a5; box-shadow:0 0 8px rgba(248,113,113,0.2); }
.ae-badge-red svg { stroke:#fca5a5; }
.ae-badge-yellow { background:rgba(250,204,21,0.15); border:1px solid rgba(250,204,21,0.4); color:#fef08a; }
.ae-badge-blue { background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.4); color:#38bdf8; }
.ae-count { font-size:12px; color:#8b949e; min-width:16px; text-align:right; }
.ae-node-content.ae-selected .ae-count { color:#f0f6fc; font-weight:600; }
.ae-tree-children { list-style:none; padding-left:22px; margin:0; position:relative; }
.ae-tree-children::before { content:''; position:absolute; left:12px; top:0; bottom:14px; width:1px; background:#2b3444; }
.ae-tree-children > .ae-node::before { content:''; position:absolute; left:-10px; top:15px; width:8px; height:1px; background:#2b3444; }
`;

function ChevIcon({ open }: { open: boolean }) {
  return (
    <svg className="ae-icon ae-chevron" fill="none" viewBox="0 0 24 24" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={open ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"}
      />
    </svg>
  );
}
function RigIcon() {
  return (
    <svg className="ae-icon ae-rig" viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M12 2L2 22h20L12 2zm0 4l6 14H6l6-14z" />
    </svg>
  );
}
function AlertIcon({ color }: { color?: string }) {
  return (
    <svg className="ae-icon" style={{ stroke: color }} fill="none" viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}
function OkIcon() {
  return (
    <svg className="ae-icon ae-ok" fill="none" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

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
  const search = useSearch({ strict: false });
  const snap = useOpsSnapshot(base, 120);
  const { assets, riskMap, event } = snap;
  const allEvents = useQuery(eventsQuery(base)).data ?? [];

  const [facility, setFacility] = useState<{
    plants: { name: string; unitList: { name: string; assets: FacAsset[] }[] }[];
  } | null>(null);
  const [equipMeta, setEquipMeta] = useState<Record<string, EquipAsset>>({});
  const [AssetModal, setAssetModal] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [modalAsset, setModalAsset] = useState<(FacAsset & Partial<EquipAsset>) | null>(null);

  const [q, setQ] = useState(() => {
    const s = search as { asset?: string; category?: string };
    return s.asset ?? s.category ?? "";
  });
  const [treeFilter, setTreeFilter] = useState<"all" | "issues" | "critical">("all");

  // One unified hierarchy: Site → Unit → Equipment. The site (plant) level carries
  // storm-exposure (weather) for the map + posture panel; units/equipment carry
  // predictive-maintenance condition and open the inline 3D twin below the map.
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

  const tree = useMemo<Node>(() => {
    const siteByName = new Map(assets.map((a) => [a.name, a]));

    // Combined lens: the plant (site) node carries storm exposure (weather) so the map
    // and posture panel work; each unit/equipment leaf carries predictive-maintenance
    // condition. A plant's severity is the worse of its storm exposure and the worst
    // equipment condition beneath it, so the tree reads at a glance.
    const buildPlant = (p: {
      name: string;
      unitList: { name: string; assets: FacAsset[] }[];
    }): Node => {
      const site = siteByName.get(p.name) ?? null;
      const siteRisk = site ? riskMap.get(site.id) : undefined;
      const siteInfra = site
        ? siteRisk
          ? { asset: site, risk: siteRisk }
          : { asset: site }
        : undefined;
      const units: Node[] = p.unitList.map((u) => {
        const leaves: Node[] = u.assets
          .map((a) => {
            const meta = equipMeta[a.asset_id];
            // Use the health-derived status (facility-model) as the primary severity so
            // the tree, the tile badge and the 3D model agree. The watchlist status
            // (fleet-assets) is a separate predictive signal surfaced in the tile, and
            // only escalates severity when it is worse (e.g. flags a critical the health
            // snapshot hasn't caught yet) — never downgrades a healthy asset to "issue".
            const healthSev = (a.status ?? "ok") as Sev;
            const watchSev = (meta?.status ?? "ok") as Sev;
            const sev = SEV_RANK[watchSev] > SEV_RANK[healthSev] && watchSev === "critical" ? watchSev : healthSev;
            return {
              id: `a:${a.asset_id}`,
              kind: "asset" as const,
              label: a.name,
              domain: "equipment" as Domain,
              sev,
              count: 1,
              issues: isIssue(sev) ? 1 : 0,
              equip: { ...a, plant: p.name, unit: u.name },
            };
          })
          .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
        return {
          id: `u:${p.name}:${u.name}`,
          kind: "unit" as const,
          label: u.name,
          domain: "equipment" as Domain,
          children: leaves,
          ...(siteInfra ? { infra: siteInfra } : {}),
          ...rollup(leaves),
        };
      });
      const equipRoll = rollup(units);
      const weatherSev = (siteRisk?.level ?? "normal") as Sev;
      const plantSev = SEV_RANK[weatherSev] > SEV_RANK[equipRoll.sev] ? weatherSev : equipRoll.sev;
      return {
        id: `p:${p.name}`,
        kind: "plant" as const,
        label: p.name,
        domain: "infrastructure" as Domain,
        children: units,
        ...(siteInfra ? { infra: siteInfra } : {}),
        sev: plantSev,
        count: equipRoll.count,
        issues: equipRoll.issues,
      };
    };

    const plants = (facility?.plants ?? []).map(buildPlant);
    return {
      id: "root",
      kind: "domain",
      label: "Estate",
      domain: "infrastructure",
      children: plants,
      ...rollup(plants),
    };
  }, [assets, riskMap, facility, equipMeta]);

  const activeTree = tree;

  // search auto-expands matching branches of the unified tree
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
  // Resolve the site (plant) that the current selection belongs to — the map flies to it
  // and highlights it whether you picked the plant, a unit or an individual asset.
  const selPlantName =
    sel?.kind === "plant"
      ? sel.label
      : sel?.kind === "unit"
        ? sel.id.split(":")[1]
        : sel?.kind === "asset"
          ? sel.equip?.plant
          : undefined;
  const selPlantNode = selPlantName ? findNode([activeTree], `p:${selPlantName}`) : null;
  const selSiteAsset = selPlantNode?.infra?.asset ?? null;
  const selectedSiteId = selSiteAsset?.id;
  // "Below the site" — a unit or a single asset — swaps the lower half of the panel to the
  // inline 3D equipment train (the Control Room model), drilled into this plant/asset.
  const showModel = !!sel && (sel.kind === "unit" || sel.kind === "asset");
  const selAssetId = sel?.kind === "asset" ? sel.equip?.asset_id : undefined;

  // The exposure map returns a SITE asset id; map it to the shared plant node id so
  // selection lands on the site node in the tree.
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

  const renderNode = (n: Node): ReactNode => {
    if (matchIds && !matchIds.has(n.id)) return null;
    // Quick-filter chips: Issues Only / Critical. Branch rollups carry the worst
    // severity + summed issues, so a per-node test keeps the path to matching
    // leaves while hiding healthy siblings.
    if (treeFilter === "issues" && !(n.issues > 0)) return null;
    if (treeFilter === "critical" && n.sev !== "critical") return null;
    const isOpen =
      expanded.has(n.id) || (matchIds ? matchIds.has(n.id) : false) || treeFilter !== "all";
    const hasChildren = !!n.children?.length;
    const isSel = selected === n.id;
    const bucket = sevBucket(n.sev);
    return (
      <li className="ae-node" key={n.id}>
        <div
          onClick={() => {
            setSelected(n.id);
            if (hasChildren) toggle(n.id);
          }}
          className={`ae-node-content ${isSel ? "ae-selected" : ""}`}
        >
          <div className="ae-node-left">
            {hasChildren ? <ChevIcon open={isOpen} /> : <span className="ae-spacer" />}
            {n.kind === "plant" || n.kind === "group" || n.kind === "domain" ? (
              <RigIcon />
            ) : isIssue(n.sev) ? (
              <AlertIcon color={BUCKET_STROKE[bucket]} />
            ) : (
              <OkIcon />
            )}
            <span style={isSel ? { fontWeight: 600 } : undefined}>{n.label}</span>
          </div>
          <div className="ae-node-right">
            {n.issues > 0 && (
              <span className={`ae-badge ae-badge-${bucket}`}>
                {bucket === "red" && <AlertIcon />}
                {n.issues} issue{n.issues === 1 ? "" : "s"}
              </span>
            )}
            <span className="ae-count">{n.kind !== "asset" ? n.count : ""}</span>
          </div>
        </div>
        {hasChildren && isOpen && (
          <ul className="ae-tree-children">{n.children!.map((c) => renderNode(c))}</ul>
        )}
      </li>
    );
  };

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
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "#38bdf8" }} /> Weather
              exposure
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "#ff8c42" }} /> Equipment
              condition
            </span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* tree */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="shrink-0 space-y-2 border-b p-2.5">
              <div className="relative">
                <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search sites, units, assets…"
                  className="w-full rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {/* quick filters */}
              <div className="flex items-center gap-1.5">
                {(
                  [
                    ["all", "All"],
                    ["issues", "Issues Only"],
                    ["critical", "Critical"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setTreeFilter(k)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      treeFilter === k
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {/* estate summary */}
              <div className="flex items-center gap-2 rounded-md border bg-card/50 px-2.5 py-1.5">
                <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {activeTree?.label}
                  </div>
                  <div className="num text-[11px] text-muted-foreground">
                    {activeTree?.children?.length ?? 0} Sites | {activeTree?.issues ?? 0} Issues |{" "}
                    {activeTree?.count ?? 0} Total Assets
                  </div>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <style>{TREE_CSS}</style>
              {!facility ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="text-xs">Loading asset hierarchy…</span>
                </div>
              ) : (
                <ul className="ae-tree">
                  {(activeTree?.children ?? []).map((c) => renderNode(c))}
                </ul>
              )}
            </div>
          </div>

          {/* detail — always "details tile (left) + visual (right)". Root has no
              tile and the map fills the panel. Site → the map on the right; a unit
              or a piece of equipment → the inline 3D equipment train on the right,
              exactly where the map was. */}
          <div className="h-full min-h-0 overflow-hidden">
            <div
              className={`grid h-full gap-4 p-4 ${
                showModel || selSiteAsset
                  ? "lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
                  : "grid-cols-1"
              }`}
            >
              {/* LEFT — the details tile (equipment header for unit/asset, storm
                  posture for a site). Omitted at the root so the map goes full. */}
              {(showModel || selSiteAsset) && (
                <div key="detail-left" className="panel h-full min-h-0 overflow-y-auto">
                  {showModel ? (
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-base font-semibold">{sel!.label}</div>
                          <div className="text-[12px] text-muted-foreground">
                            {sel!.kind === "asset"
                              ? `${sel!.equip!.plant} · Unit ${sel!.equip!.unit} · ${sel!.equip!.category}`
                              : `${selPlantName} · ${sel!.count} asset${sel!.count === 1 ? "" : "s"}`}
                          </div>
                        </div>
                        <span
                          className="rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase"
                          style={{
                            color: SEV_COLOR[sel!.sev],
                            borderColor: `${SEV_COLOR[sel!.sev]}55`,
                            background: `${SEV_COLOR[sel!.sev]}1f`,
                          }}
                        >
                          {sel!.sev === "ok" ? "Healthy" : sel!.sev}
                        </span>
                      </div>
                      {sel!.kind === "asset" && selEquipMeta && (
                        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
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
                      )}
                      {sel!.kind === "asset" && (
                        <button
                          onClick={() => openTwin(sel!.equip!)}
                          className="mt-4 inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground"
                        >
                          <Cpu className="size-3.5" /> Open full diagnostics
                        </button>
                      )}
                    </div>
                  ) : (
                    <AssetDetailPanel
                      asset={selSiteAsset!}
                      risk={riskMap.get(selSiteAsset!.id)}
                      event={event}
                      allAssets={assets}
                      onClose={() => setSelected("root")}
                      onSelect={(id) => selectSite(id)}
                    />
                  )}
                </div>
              )}

              {/* RIGHT — the visual. Same slot for map / 3D so the panel doesn't
                  jump; the map stays mounted across root ↔ site, and the 3D train
                  stays mounted across unit ↔ asset. */}
              <div
                key="detail-right"
                className="panel h-full min-h-0 overflow-hidden"
                style={
                  showModel
                    ? undefined
                    : {
                        background:
                          "radial-gradient(ellipse 80% 70% at 50% 45%, #1b273d 0%, #0f172a 45%, #080d1a 75%, #020617 100%)",
                      }
                }
              >
                {showModel ? (
                  <InlineFacility
                    model={facility}
                    activePlant={selPlantName}
                    selectedAssetId={selAssetId}
                    onSelect={(n) => n?.asset_id && setSelected(`a:${n.asset_id}`)}
                    onEnterPlant={(name) => setSelected(`p:${name}`)}
                    className="h-full w-full"
                  />
                ) : (
                  <WeatherHoloMap
                    className="h-full w-full"
                    assets={assets}
                    risks={riskMap}
                    event={event}
                    events={allEvents}
                    layers={{ assets: true, track: true, wind: true, links: true }}
                    selectedId={selectedSiteId ?? undefined}
                    highlightIds={selectedSiteId ? [selectedSiteId] : []}
                    onSelect={(id) => selectSite(id)}
                    flat
                    skipGlobe
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {AssetModal && (
        <AssetModal theme={MODES.dark} asset={modalAsset} onClose={() => setModalAsset(null)} />
      )}
    </AppShell>
  );
}
