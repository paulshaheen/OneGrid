import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { Boxes, Search, Table2, Box as BoxIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSETS,
  SITES,
  EDGES,
  SITE_BY_ID,
  CATEGORY_META,
  STATUS_COLOR,
  KIND_LABEL,
  type InfraAsset,
  type InfraCategory,
} from "@/lib/infra/infra-data";
import { useLiveTick, liveValue, liveAssetStatus } from "@/lib/infra/infra-live";
import { InfraAssetDetail } from "./InfraAssetDetail";
import { KindIcon, StatusDot } from "./infra-ui";
import { fmtNum } from "./infra-format";

// ── layout: lay each site's assets on a centered grid around its anchor ──────
const SPACING = 10;
const NODE_POS: Map<string, [number, number, number]> = (() => {
  const map = new Map<string, [number, number, number]>();
  for (const site of SITES) {
    const list = ASSETS.filter((a) => a.siteId === site.id);
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const rows = Math.ceil(list.length / cols);
    list.forEach((a, i) => {
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      const x = site.anchor[0] + (cx - (cols - 1) / 2) * SPACING;
      const z = site.anchor[1] + (cz - (rows - 1) / 2) * SPACING;
      map.set(a.id, [x, 0, z]);
    });
  }
  return map;
})();
function siteFootprint(siteId: string): { cols: number; rows: number } {
  const n = ASSETS.filter((a) => a.siteId === siteId).length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.ceil(n / cols) };
}

const SITE_TINT: Record<string, string> = {
  cloud: "#4f8cff",
  datacenter: "#19c3d3",
  edge: "#ff6fb5",
};

// ── a single asset rendered by category (static; doesn't re-render per tick) ──
function CategoryBody({ asset, accent }: { asset: InfraAsset; accent: string }) {
  const mat = {
    color: accent,
    metalness: 0.45,
    roughness: 0.5,
    emissive: accent,
    emissiveIntensity: 0.18,
  } as const;
  switch (asset.category) {
    case "data":
      return (
        <group position={[0, 1.4, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[1.5, 1.5, 2.6, 22]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          {[-0.7, 0, 0.7].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <torusGeometry args={[1.52, 0.06, 8, 24]} />
              <meshBasicMaterial color={accent} toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    case "network":
      return (
        <group position={[0, 0.9, 0]}>
          <mesh>
            <boxGeometry args={[3.6, 1.1, 2.4]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          <mesh position={[1.3, 0.9, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 1.6, 6]} />
            <meshBasicMaterial color={accent} toneMapped={false} />
          </mesh>
        </group>
      );
    case "ot":
      return (
        <group position={[0, 1, 0]}>
          <mesh>
            <boxGeometry args={[1.9, 1.9, 1.9]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        </group>
      );
    case "platform":
      return (
        <mesh position={[0, 1.6, 0]} rotation={[0.3, 0.4, 0]}>
          <icosahedronGeometry args={[1.7, 0]} />
          <meshStandardMaterial {...mat} />
        </mesh>
      );
    default: // compute
      return (
        <group position={[0, 1.2, 0]}>
          <mesh>
            <boxGeometry args={[3, 2.2, 3]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          <mesh position={[0, 0, 1.51]}>
            <planeGeometry args={[2.4, 0.3]} />
            <meshBasicMaterial color={accent} toneMapped={false} />
          </mesh>
        </group>
      );
  }
}

function StatusRing({ color, selected }: { color: string; selected: boolean }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <mesh>
        <ringGeometry args={[2.3, 2.75, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {selected && (
        <mesh position={[0, 0, -0.01]}>
          <ringGeometry args={[3.0, 3.5, 44]} />
          <meshBasicMaterial
            color="#4f8cff"
            transparent
            opacity={0.95}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

function AssetNode({
  asset,
  selected,
  dimmed,
  onSelect,
  onHover,
}: {
  asset: InfraAsset;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const pos = NODE_POS.get(asset.id)!;
  const accent = CATEGORY_META[asset.category].color;
  const statusCol = STATUS_COLOR[asset.status];
  return (
    <group
      position={pos}
      scale={selected ? 1.14 : 1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(asset.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(asset.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = "auto";
      }}
    >
      <group visible={!dimmed}>
        <StatusRing color={statusCol} selected={selected} />
        <CategoryBody asset={asset} accent={accent} />
        {/* status beacon */}
        <mesh position={[0, asset.category === "network" ? 2.0 : 3.2, 0]}>
          <sphereGeometry args={[0.32, 12, 12]} />
          <meshBasicMaterial color={statusCol} toneMapped={false} />
        </mesh>
      </group>
      {dimmed && (
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[1.4, 1.4, 1.4]} />
          <meshStandardMaterial color={accent} transparent opacity={0.12} />
        </mesh>
      )}
    </group>
  );
}

function SitePlatform({ siteId }: { siteId: string }) {
  const site = SITE_BY_ID.get(siteId)!;
  const { cols, rows } = siteFootprint(siteId);
  const w = cols * SPACING + 6;
  const d = rows * SPACING + 6;
  const tint = SITE_TINT[site.kind] ?? "#4f8cff";
  return (
    <group position={[site.anchor[0], 0, site.anchor[1]]}>
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <boxGeometry args={[w, 0.4, d]} />
        <meshStandardMaterial
          color="#10151f"
          metalness={0.3}
          roughness={0.8}
          emissive={tint}
          emissiveIntensity={0.05}
        />
      </mesh>
      <mesh position={[0, 0.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(w, d) / 2 - 1, Math.min(w, d) / 2 - 0.6, 64]} />
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={0.25}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Html
        position={[0, 0.2, -d / 2 - 1]}
        center
        distanceFactor={160}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            whiteSpace: "nowrap",
            fontSize: 12,
            fontWeight: 700,
            color: "#eaf1ff",
            textShadow: "0 1px 6px rgba(0,0,0,0.9)",
          }}
        >
          {site.name}
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: "#9db0cc" }}>
            {site.location}
          </span>
        </div>
      </Html>
    </group>
  );
}

function RelationshipLines({
  selectedId,
  filter,
}: {
  selectedId: string | null;
  filter: (a: InfraAsset) => boolean;
}) {
  return (
    <>
      {EDGES.map((e) => {
        const a = NODE_POS.get(e.from);
        const b = NODE_POS.get(e.to);
        if (!a || !b) return null;
        const fromA = ASSETS.find((x) => x.id === e.from)!;
        const toA = ASSETS.find((x) => x.id === e.to)!;
        const active = selectedId === e.from || selectedId === e.to;
        const visible = (filter(fromA) && filter(toA)) || active;
        if (!visible) return null;
        const col = active
          ? CATEGORY_META[(selectedId === e.from ? fromA : toA).category].color
          : "#5b6678";
        const mid: [number, number, number] = [
          (a[0] + b[0]) / 2,
          3 + (active ? 2 : 0),
          (a[2] + b[2]) / 2,
        ];
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(a[0], 1.2, a[2]),
          new THREE.Vector3(mid[0], mid[1], mid[2]),
          new THREE.Vector3(b[0], 1.2, b[2]),
        );
        const pts = curve.getPoints(20).map((p) => [p.x, p.y, p.z] as [number, number, number]);
        return (
          <Line
            key={e.id}
            points={pts}
            color={col}
            lineWidth={active ? 2 : 1}
            transparent
            opacity={active ? 0.9 : 0.22}
            toneMapped={false}
          />
        );
      })}
    </>
  );
}

function LiveLabels({
  selectedId,
  hoveredId,
}: {
  selectedId: string | null;
  hoveredId: string | null;
}) {
  useLiveTick();
  return (
    <>
      {ASSETS.map((a) => {
        const pos = NODE_POS.get(a.id)!;
        const live = liveAssetStatus(a);
        const strong =
          a.id === selectedId || a.id === hoveredId || live === "critical" || live === "warning";
        if (!strong) return null;
        const m = a.metrics[0];
        if (!m) return null;
        const col = STATUS_COLOR[live];
        return (
          <Html
            key={a.id}
            position={[pos[0], 4.6, pos[2]]}
            center
            distanceFactor={150}
            style={{ pointerEvents: "none" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#eaf1ff",
                  textShadow: "0 1px 4px rgba(0,0,0,0.9)",
                }}
              >
                {a.name}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: col,
                  background: "rgba(6,12,22,0.75)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  padding: "1px 6px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: col,
                    boxShadow: `0 0 6px ${col}`,
                  }}
                />
                {m.label} {fmtNum(liveValue(a.id, m.key))}
                <span style={{ color: "#93a4bd", fontWeight: 500 }}>{m.unit}</span>
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}

function Scene({
  selectedId,
  onSelect,
  onHover,
  hoveredId,
  filter,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  hoveredId: string | null;
  filter: (a: InfraAsset) => boolean;
}) {
  return (
    <>
      <hemisphereLight intensity={0.6} color="#cfe0ff" groundColor="#0a0e16" />
      <directionalLight position={[60, 140, 60]} intensity={1.1} color="#fff3e2" />
      <directionalLight position={[-70, 70, -50]} intensity={0.4} color="#9db8ff" />
      <ambientLight intensity={0.35} color="#dfeaff" />
      <gridHelper args={[460, 46, "#243043", "#161d29"]} position={[0, -0.45, 0]} />
      {SITES.map((s) => (
        <SitePlatform key={s.id} siteId={s.id} />
      ))}
      <RelationshipLines selectedId={selectedId} filter={filter} />
      {ASSETS.map((a) => (
        <AssetNode
          key={a.id}
          asset={a}
          selected={a.id === selectedId}
          dimmed={!filter(a)}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      <LiveLabels selectedId={selectedId} hoveredId={hoveredId} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={50}
        maxDistance={360}
        maxPolarAngle={Math.PI / 2.1}
        target={[4, 0, 0]}
      />
    </>
  );
}

type CatFilter = InfraCategory | "all";

export function InfraAssets3D({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"3d" | "grid">("3d");

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (a: InfraAsset) =>
      (catFilter === "all" || a.category === catFilter) &&
      (!query ||
        a.name.toLowerCase().includes(query) ||
        KIND_LABEL[a.kind].toLowerCase().includes(query) ||
        (a.ip ?? "").includes(query));
  }, [catFilter, q]);

  const list = useMemo(() => ASSETS.filter(matches), [matches]);

  return (
    <div className="flex h-full flex-col gap-3 p-4 lg:flex-row">
      {/* left: filters + list */}
      <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search assets, IP, type…"
            className="w-full rounded-lg border bg-card py-2 pl-8 pr-2 text-[12.5px] outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "compute", "data", "network", "ot", "platform"] as CatFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10.5px] font-semibold capitalize transition-colors",
                catFilter === c ? "text-white" : "text-muted-foreground hover:bg-accent",
              )}
              style={
                catFilter === c
                  ? {
                      background:
                        c === "all"
                          ? "var(--color-primary)"
                          : CATEGORY_META[c as InfraCategory].color,
                      borderColor: "transparent",
                    }
                  : undefined
              }
            >
              {c === "all" ? "All" : CATEGORY_META[c as InfraCategory].label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border bg-card p-1.5">
          <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {list.length} assets
          </div>
          {list.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              selected={a.id === selectedId}
              onSelect={() => onSelect(a.id)}
            />
          ))}
        </div>
      </div>

      {/* center: 3d / grid */}
      <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl border bg-card">
        <div className="pointer-events-none absolute left-4 top-3 z-10">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Boxes className="size-4 text-primary" /> Infrastructure Map
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {ASSETS.length} assets · {SITES.length} sites · {EDGES.length} relationships
          </div>
        </div>
        <div className="absolute right-3 top-3 z-10 inline-flex overflow-hidden rounded-md border bg-card/80 backdrop-blur">
          <button
            onClick={() => setView("3d")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold",
              view === "3d" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <BoxIcon className="size-3.5" /> 3D
          </button>
          <button
            onClick={() => setView("grid")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold",
              view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <Table2 className="size-3.5" /> Grid
          </button>
        </div>

        {view === "3d" ? (
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [10, 120, 165], fov: 45 }}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.AgXToneMapping;
              gl.toneMappingExposure = 1.0;
            }}
            onPointerMissed={() => onSelect(null)}
          >
            <Suspense fallback={null}>
              <Scene
                selectedId={selectedId}
                onSelect={onSelect}
                onHover={setHoveredId}
                hoveredId={hoveredId}
                filter={matches}
              />
            </Suspense>
          </Canvas>
        ) : (
          <div className="absolute inset-0 overflow-y-auto p-3 pt-14">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {list.map((a) => (
                <AssetCard
                  key={a.id}
                  asset={a}
                  selected={a.id === selectedId}
                  onSelect={() => onSelect(a.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* legend */}
        <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex flex-wrap gap-2.5 rounded-md border bg-card/80 px-3 py-2 text-[11px] backdrop-blur">
          {(Object.keys(CATEGORY_META) as InfraCategory[]).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2.5 rounded"
                style={{ background: CATEGORY_META[c].color }}
              />{" "}
              {CATEGORY_META[c].label}
            </span>
          ))}
        </div>
      </div>

      {/* right: detail */}
      {selectedId && (
        <div className="w-full shrink-0 lg:w-80">
          <div className="h-full lg:max-h-[calc(100vh-7rem)]">
            <InfraAssetDetail
              assetId={selectedId}
              onSelect={onSelect}
              onClose={() => onSelect(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  selected,
  onSelect,
}: {
  asset: InfraAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  const live = liveAssetStatus(asset);
  const accent = CATEGORY_META[asset.category].color;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        selected ? "bg-accent ring-1 ring-inset ring-primary/40" : "hover:bg-accent/50",
      )}
    >
      <StatusDot status={live} pulse size={7} />
      <div
        className="grid size-6 shrink-0 place-items-center rounded-md"
        style={{ background: `${accent}1f`, color: accent }}
      >
        <KindIcon kind={asset.kind} className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-foreground">{asset.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{KIND_LABEL[asset.kind]}</div>
      </div>
    </button>
  );
}

function AssetCard({
  asset,
  selected,
  onSelect,
}: {
  asset: InfraAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  const live = liveAssetStatus(asset);
  const accent = CATEGORY_META[asset.category].color;
  const m = asset.metrics[0];
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-muted/20 p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
        selected && "ring-1 ring-primary/50",
      )}
      style={{ borderLeft: `3px solid ${STATUS_COLOR[live]}` }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{ background: `${accent}1f`, color: accent }}
        >
          <KindIcon kind={asset.kind} className="size-3.5" />
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          {asset.name}
        </span>
        <StatusDot status={live} pulse size={7} />
      </div>
      <div className="truncate text-[10px] text-muted-foreground">
        {KIND_LABEL[asset.kind]} · {SITE_BY_ID.get(asset.siteId)?.name}
      </div>
      {m && <LiveMini assetId={asset.id} metricKey={m.key} label={m.label} unit={m.unit} />}
    </button>
  );
}

function LiveMini({
  assetId,
  metricKey,
  label,
  unit,
}: {
  assetId: string;
  metricKey: string;
  label: string;
  unit: string;
}) {
  useLiveTick();
  return (
    <div className="flex items-center justify-between text-[10.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {fmtNum(liveValue(assetId, metricKey))}
        <span className="ml-0.5 font-normal text-muted-foreground">{unit}</span>
      </span>
    </div>
  );
}
