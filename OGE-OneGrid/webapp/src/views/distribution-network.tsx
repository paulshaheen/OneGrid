import { useMemo, useRef, useState, useSyncExternalStore, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Link } from "@tanstack/react-router";
import { Waypoints, Gauge, Factory, Fuel, CircleDot, Boxes, ArrowUpRight } from "lucide-react";

import { AppShell } from "@/components/ops/AppShell";
import { FacilityModel } from "@/report/three/Equipment.jsx";
import {
  PIPE_NODES,
  PIPE_EDGES,
  PRODUCT_COLOR,
  PRODUCT_LABEL,
  type PipeNode,
  type PipeSensor,
  type PipeStatus,
  type Product,
} from "@/lib/data/texas-pipelines";

const STATUS_COLOR: Record<PipeStatus, string> = { ok: "#3fb950", watch: "#f0b429", critical: "#ff5a5f" };
const KIND_LABEL: Record<PipeNode["kind"], string> = {
  origin: "Origin station", pump: "Pump station", compressor: "Compressor station",
  hub: "Distribution hub", storage: "Storage / terminal", terminal: "Export terminal", refinery: "Refinery",
};
const NODE_BY_ID = new Map(PIPE_NODES.map((n) => [n.id, n]));
const FLOW_TAGS: Array<[string, number]> = PIPE_NODES.flatMap((n) =>
  n.sensors.filter((s) => /FLOW|CHARGE|LOAD/.test(s.tag) && s.unit.includes("kbbl")).map((s) => [s.tag, s.value] as [string, number]),
);
function primarySensor(n: PipeNode): PipeSensor {
  return n.sensors.find((s) => /FLOW|CHARGE/.test(s.tag)) ?? n.sensors[0];
}

// ── Deliberate schematic layout (no longer geographic) ──
const NODE_XY: Record<string, [number, number]> = {
  wink: [-150, -55], waha: [-150, -15], midland: [-150, 25], coloradocity: [-150, 62],
  mccamey: [-98, -38], sheffield: [-92, 2], threerivers: [-48, -72], sealy: [-40, 40], refugio: [8, -84],
  cushing: [-8, -112], aguadulce: [52, -66], corpus: [92, -92], katy: [72, -8],
  houston: [134, 18], montbelvieu: [145, -30], nederland: [150, 58],
};
function nodePos(id: string): [number, number] {
  const p = NODE_XY[id] ?? [0, 0];
  return [p[0] * 0.82, p[1] * 0.9];
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const PIPE_Y = 1.6;

type LiveValues = Record<string, { value: number } | undefined>;
function fmt(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

// Self-contained streaming SCADA: mean-reverting random walk around each authored base
// value, so magnitudes stay realistic (matching corridor capacities) while reading live.
const liveStore = (() => {
  const cur: Record<string, number> = {};
  for (const n of PIPE_NODES) for (const s of n.sensors) cur[s.tag] = s.value;
  const listeners = new Set<() => void>();
  let started = false;
  const obj = {
    version: 0,
    get(tag: string): number {
      return cur[tag] ?? 0;
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      if (!started) {
        started = true;
        setInterval(() => {
          for (const n of PIPE_NODES)
            for (const s of n.sensors) {
              const noise = (Math.random() - 0.5) * s.value * 0.025;
              cur[s.tag] = cur[s.tag] + (s.value - cur[s.tag]) * 0.2 + noise;
            }
          obj.version++;
          listeners.forEach((l) => l());
        }, 1500);
      }
      return () => listeners.delete(cb);
    },
  };
  return obj;
})();
function useLiveTick(): number {
  return useSyncExternalStore((cb) => liveStore.subscribe(cb), () => liveStore.version, () => 0);
}

function KindIcon({ kind, className }: { kind: PipeNode["kind"]; className?: string }) {
  if (kind === "refinery") return <Factory className={className} />;
  if (kind === "storage" || kind === "hub") return <Boxes className={className} />;
  if (kind === "terminal") return <Fuel className={className} />;
  if (kind === "pump" || kind === "compressor") return <Gauge className={className} />;
  return <CircleDot className={className} />;
}

function Pipe({ edge, dimmed }: { edge: (typeof PIPE_EDGES)[number]; dimmed: boolean }) {
  const color = PRODUCT_COLOR[edge.product];
  const crit = edge.status === "critical";
  const curve = useMemo(() => {
    const [fx, fz] = nodePos(edge.from);
    const [tx, tz] = nodePos(edge.to);
    const mx = (fx + tx) / 2;
    const mz = (fz + tz) / 2;
    let dx = tx - fx;
    let dz = tz - fz;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const off = ((hash(edge.id) % 7) - 3) * 10;
    const mid = new THREE.Vector3(mx + px * off, PIPE_Y, mz + pz * off);
    const v = [new THREE.Vector3(fx, PIPE_Y, fz), mid, new THREE.Vector3(tx, PIPE_Y, tz)];
    return new THREE.CatmullRomCurve3(v, false, "catmullrom", 0.5);
  }, [edge]);
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 100, crit ? 0.7 : 0.5, 9, false), [curve, crit]);

  const pulseCount = 4;
  const pulses = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const speed = edge.product === "gas" ? 0.13 : 0.09;
  useFrame((state) => {
    if (!pulses.current) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < pulseCount; i++) {
      const u = (((t * speed + i / pulseCount) % 1) + 1) % 1;
      const p = curve.getPointAt(u);
      dummy.position.copy(p);
      dummy.scale.setScalar(dimmed ? 0.0001 : 0.9 + 0.4 * Math.sin((u + i) * Math.PI * 2));
      dummy.updateMatrix();
      pulses.current.setMatrixAt(i, dummy.matrix);
    }
    pulses.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={tube}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dimmed ? 0.12 : crit ? 1.2 : 0.85} roughness={0.4} metalness={0.2} transparent opacity={dimmed ? 0.16 : 0.95} toneMapped={false} />
      </mesh>
      <instancedMesh ref={pulses} args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, pulseCount]}>
        <sphereGeometry args={[0.9, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Beacon({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.35, 0.6, 4, 10]} />
        <meshStandardMaterial color="#c9d6ea" metalness={0.8} roughness={0.3} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 4.4, 0]}>
        <sphereGeometry args={[0.7, 14, 14]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function StatusRing({ color, active, selected }: { color: string; active: boolean; selected: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    if (!mat.current) return;
    mat.current.opacity = active ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.2)) : 0.5;
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[3.0, 3.8, 40]} />
        <meshBasicMaterial ref={mat} color={color} transparent opacity={0.5} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[4.2, 4.8, 44]} />
          <meshBasicMaterial color="#3f96ff" transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}

// Static 3D layer: models + rings + click targets (does NOT depend on live values, so it
// isn't re-rendered every tick).
function NodeModel({ node, selected, onSelect }: { node: PipeNode; selected: boolean; onSelect: (id: string) => void }) {
  const [x, z] = nodePos(node.id);
  const col = STATUS_COLOR[node.status];
  const targetH = node.kind === "hub" || node.kind === "storage" || node.kind === "refinery" || node.kind === "terminal" ? 7 : 5;
  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "auto"; }}
    >
      <StatusRing color={col} active={node.status !== "ok"} selected={selected} />
      <Suspense fallback={<Beacon color={col} />}>
        <FacilityModel type={node.assetType} accent={col} targetHeight={targetH} />
      </Suspense>
    </group>
  );
}

// Live HUD layer: name + streaming primary sensor value floating on each node. This is the
// ONLY thing that re-renders on each realtime tick.
function LiveLabels({ selectedId }: { selectedId: string | null }) {
  useLiveTick();
  return (
    <>
      {PIPE_NODES.map((n) => {
        const [x, z] = nodePos(n.id);
        const targetH = n.kind === "hub" || n.kind === "storage" || n.kind === "refinery" || n.kind === "terminal" ? 7 : 5;
        const col = STATUS_COLOR[n.status];
        const ps = primarySensor(n);
        const live = liveStore.get(ps.tag);
        const strong = n.id === selectedId || n.status !== "ok";
        return (
          <Html key={n.id} position={[x, targetH + 2.4, z]} center distanceFactor={150} style={{ pointerEvents: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#eaf1ff", textShadow: "0 1px 4px rgba(0,0,0,0.9)", opacity: strong ? 1 : 0.8 }}>{n.name}</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: col, background: "rgba(6,12,22,0.72)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "1px 6px", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: col, boxShadow: `0 0 6px ${col}` }} />
                {fmt(live)}<span style={{ color: "#93a4bd", fontWeight: 500 }}>{ps.unit}</span>
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}

function Scene({ selectedId, onSelect, productFilter }: { selectedId: string | null; onSelect: (id: string) => void; productFilter: Product | "all" }) {
  return (
    <>
      <hemisphereLight intensity={0.55} color="#cfe0ff" groundColor="#141b26" />
      <directionalLight position={[60, 140, 80]} intensity={1.1} color="#fff3e2" />
      <directionalLight position={[-70, 60, -40]} intensity={0.4} color="#9db8ff" />
      <ambientLight intensity={0.35} color="#dfeaff" />
      <Suspense fallback={null}>
        <Environment preset="warehouse" environmentIntensity={1.05} />
      </Suspense>
      {PIPE_EDGES.map((e) => (
        <Pipe key={e.id} edge={e} dimmed={productFilter !== "all" && e.product !== productFilter} />
      ))}
      {PIPE_NODES.map((n) => (
        <NodeModel key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} />
      ))}
      <LiveLabels selectedId={selectedId} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={100} maxDistance={700} maxPolarAngle={Math.PI / 2.15} target={[0, 0, -20]} />
    </>
  );
}

export function DistributionNetworkPage() {
  const [selectedId, setSelectedId] = useState<string | null>("threerivers");
  const [productFilter, setProductFilter] = useState<Product | "all">("all");
  const selected = selectedId ? NODE_BY_ID.get(selectedId) ?? null : null;
  const counts = useMemo(() => ({ pipelines: PIPE_EDGES.length, nodes: PIPE_NODES.length, alerts: PIPE_NODES.filter((n) => n.status !== "ok").length }), []);

  return (
    <AppShell fullHeight>
      <div className="flex h-full flex-col gap-3 p-4 lg:flex-row">
        <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl border bg-card">
          <div className="pointer-events-none absolute left-4 top-3 z-10">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Waypoints className="size-4 text-primary" /> Distribution Network
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">Texas &amp; Gulf Coast · crude, gas &amp; NGL corridors</div>
          </div>
          <div className="absolute right-3 top-3 z-10 inline-flex overflow-hidden rounded-md border bg-card/80 backdrop-blur">
            {(["all", "crude", "gas", "ngl"] as const).map((p) => (
              <button key={p} onClick={() => setProductFilter(p)} className={`px-2.5 py-1 text-[11px] font-semibold capitalize ${productFilter === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {p === "ngl" ? "NGL" : p}
              </button>
            ))}
          </div>
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 250, 300], fov: 42 }}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => { gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = 1.0; }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <Suspense fallback={null}>
              <Scene selectedId={selectedId} onSelect={setSelectedId} productFilter={productFilter} />
            </Suspense>
          </Canvas>
          <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex flex-wrap gap-3 rounded-md border bg-card/80 px-3 py-2 text-[11px] backdrop-blur">
            {(Object.keys(PRODUCT_COLOR) as Product[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-4 rounded" style={{ background: PRODUCT_COLOR[p] }} /> {PRODUCT_LABEL[p]}
              </span>
            ))}
            <span className="mx-1 w-px bg-border" />
            {(["ok", "watch", "critical"] as PipeStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 capitalize text-muted-foreground">
                <span className="inline-block size-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} /> {s}
              </span>
            ))}
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[340px]">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Pipelines" value={counts.pipelines} />
            <LiveThroughput />
            <Stat label="Alerts" value={counts.alerts} accent={counts.alerts ? STATUS_COLOR.critical : undefined} />
          </div>

          {selected && (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <KindIcon kind={selected.kind} className="size-4 text-primary" /> {selected.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{KIND_LABEL[selected.kind]}</div>
                </div>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: `${STATUS_COLOR[selected.status]}22`, color: STATUS_COLOR[selected.status] }}>
                  {selected.status}
                </span>
              </div>
              {selected.note && <p className="mt-1.5 text-[12px] text-muted-foreground">{selected.note}</p>}
              <div className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live telemetry
              </div>
              <LiveSensors sensors={selected.sensors} />
              <Link to="/app/asset-explorer" className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                Open in Asset Explorer <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-2">
            <div className="px-1.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Corridors</div>
            {PIPE_EDGES.map((e) => {
              const from = NODE_BY_ID.get(e.from)!;
              const to = NODE_BY_ID.get(e.to)!;
              return (
                <button key={e.id} onClick={() => setSelectedId(e.to)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PRODUCT_COLOR[e.product] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-foreground">{e.name}</span>
                    <span className="block truncate text-[10.5px] text-muted-foreground">{from.name.split(" ")[0]} → {to.name.split(" ")[0]} · {e.capacity}</span>
                  </span>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[e.status] }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function LiveThroughput() {
  useLiveTick();
  const throughput = FLOW_TAGS.reduce((s, [tag]) => s + liveStore.get(tag), 0);
  return <Stat label="kbbl/d live" value={fmt(throughput)} accent="var(--color-primary)" />;
}

function LiveSensors({ sensors }: { sensors: PipeSensor[] }) {
  useLiveTick();
  return (
    <div className="space-y-1.5">
      {sensors.map((s) => (
        <div key={s.tag} className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-[12px] text-foreground">{s.label}</div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">{s.tag}</div>
          </div>
          <div className="text-right text-[13px] font-semibold text-foreground tabular-nums">
            {fmt(liveStore.get(s.tag))}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">{s.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-2.5 text-center">
      <div className="text-xl font-bold tabular-nums" style={{ color: accent ?? "var(--color-foreground)" }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
