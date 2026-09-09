import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { US_STATES } from "./us-geo";

// ── projection: lon/lat -> scene x/z (equirectangular, aspect-corrected) ───
const CX = -95.5;
const CY = 39.5;
const S = 0.42;
const ASPECT = 0.78; // cos(~39°) — compress longitude so the US isn't stretched
function project(lon: number, lat: number): [number, number] {
  return [(lon - CX) * S * ASPECT, -(lat - CY) * S];
}

export type MapSite = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  level: "critical" | "high" | "elevated" | "monitor" | "normal" | string;
  status?: string;
  loadPct?: number;
  voltageKv?: number;
  tempF?: number;
};

const LEVEL_COLOR: Record<string, string> = {
  critical: "#ff4d6d",
  high: "#ff8c42",
  elevated: "#f5b942",
  monitor: "#38bdf8",
  normal: "#3ce6b0",
};
const colorFor = (lvl: string) => LEVEL_COLOR[lvl] ?? "#3ce6b0";

// Soft radial sprite for glowing points (cities, storm cloud).
function softSprite(inner: string, outer = "rgba(0,0,0,0)"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.4, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// Disable bloom on Adreno/Snapdragon (known compositor flicker); glow still reads
// via additive/emissive materials.
function bloomSafe(): boolean {
  try {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl") as WebGLRenderingContext | null;
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const r = dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    return !/adreno|snapdragon|apple gpu/i.test(r);
  } catch {
    return true;
  }
}

// ── state outlines (single merged additive line object) ────────────────────
function StateLines() {
  const obj = useMemo(() => {
    const pts: number[] = [];
    for (const ring of US_STATES) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, az] = project(ring[i][0], ring[i][1]);
        const [bx, bz] = project(ring[i + 1][0], ring[i + 1][1]);
        pts.push(ax, 0.02, az, bx, 0.02, bz);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#1f6feb"),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }, []);
  return <primitive object={obj} />;
}

// ── digital ground grid ────────────────────────────────────────────────────
function GroundGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(60, 80, new THREE.Color("#12335c"), new THREE.Color("#0c1b33"));
    const m = g.material as THREE.Material | THREE.Material[];
    (Array.isArray(m) ? m : [m]).forEach((mm) => {
      mm.transparent = true;
      (mm as THREE.Material & { opacity: number }).opacity = 0.35;
      mm.depthWrite = false;
    });
    g.position.y = -0.01;
    return g;
  }, []);
  return (
    <group>
      <primitive object={grid} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#050912" metalness={0.2} roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── city lights ─────────────────────────────────────────────────────────────
function CityLights() {
  const obj = useMemo(() => {
    const n = 200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lon = -122 + Math.random() * 55;
      const lat = 26 + Math.random() * 22;
      const [x, z] = project(lon, lat);
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.03 + Math.random() * 0.02;
      pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: softSprite("rgba(120,190,255,0.9)"),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }, []);
  return <primitive object={obj} />;
}

// ── network edges (nearest-neighbour graph) with travelling pulses ─────────
function NetworkEdges({ sites }: { sites: MapSite[] }) {
  const { lines, edges } = useMemo(() => {
    const nodes = sites.map((s) => {
      const [x, z] = project(s.lon, s.lat);
      return new THREE.Vector3(x, 0.06, z);
    });
    const seen = new Set<string>();
    const eArr: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (let i = 0; i < nodes.length; i++) {
      const d = nodes
        .map((n, j) => ({ j, dist: nodes[i].distanceTo(n) }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);
      for (const { j } of d) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        eArr.push([nodes[i], nodes[j]]);
      }
    }
    const pts: number[] = [];
    for (const [a, b] of eArr) pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#39e6ff"),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { lines: new THREE.LineSegments(geo, mat), edges: eArr };
  }, [sites]);

  // travelling pulses
  const pulseRef = useRef<THREE.Points>(null);
  const pulseData = useMemo(() => {
    const count = Math.min(40, edges.length);
    const pick = Array.from({ length: count }, () => Math.floor(Math.random() * edges.length));
    const speed = pick.map(() => 0.15 + Math.random() * 0.35);
    const t = pick.map(() => Math.random());
    return { pick, speed, t, count };
  }, [edges]);
  const pulseObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(pulseData.count * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.3,
      map: softSprite("rgba(180,250,255,1)"),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }, [pulseData.count]);
  useFrame((_, dt) => {
    const arr = pulseObj.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pulseData.count; i++) {
      pulseData.t[i] += pulseData.speed[i] * dt;
      if (pulseData.t[i] > 1) {
        pulseData.t[i] = 0;
        pulseData.pick[i] = Math.floor(Math.random() * edges.length);
      }
      const [a, b] = edges[pulseData.pick[i]] ?? [new THREE.Vector3(), new THREE.Vector3()];
      arr.setXYZ(i, a.x + (b.x - a.x) * pulseData.t[i], 0.08, a.z + (b.z - a.z) * pulseData.t[i]);
    }
    arr.needsUpdate = true;
  });

  return (
    <group>
      <primitive object={lines} />
      <primitive ref={pulseRef} object={pulseObj} />
    </group>
  );
}

// ── procedural substation model ─────────────────────────────────────────────
function Substation({ color }: { color: string }) {
  return (
    <group scale={1.05}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.5, 0.04, 0.5]} />
        <meshStandardMaterial color="#0e1626" metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.12, 0.08]}>
        <boxGeometry args={[0.2, 0.16, 0.16]} />
        <meshStandardMaterial color="#182741" metalness={0.7} roughness={0.35} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {[-0.16, 0.16].map((x, i) => (
        <mesh key={i} position={[x, 0.17, -0.08]}>
          <cylinderGeometry args={[0.012, 0.03, 0.34, 6]} />
          <meshStandardMaterial color="#2b3d5e" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, -0.08]}>
        <boxGeometry args={[0.44, 0.018, 0.018]} />
        <meshStandardMaterial color="#3a4f78" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.36, -0.08]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ── one site: model + glow beacon + pulse ring + click popup ───────────────
function SiteNode({
  site,
  selected,
  onSelect,
}: {
  site: MapSite;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [x, z] = project(site.lon, site.lat);
  const color = colorFor(site.level);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      const s = 1 + ((t * 0.6 + x) % 1) * 1.6;
      ring.current.scale.set(s, s, s);
      const mat = ring.current.material as THREE.Material & { opacity: number };
      mat.opacity = Math.max(0, 0.5 - ((t * 0.6 + x) % 1) * 0.5);
    }
    if (beam.current) {
      const mat = beam.current.material as THREE.Material & { opacity: number };
      mat.opacity = 0.25 + Math.sin(t * 2 + x) * 0.12;
    }
  });

  return (
    <group position={[x, 0, z]}>
      <Substation color={color} />
      {/* pulse ring on the ground */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.22, 0.28, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* vertical beam */}
      <mesh ref={beam} position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.4, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* click target */}
      <mesh
        position={[0, 0.2, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(selected ? null : site.id);
        }}
        visible={false}
      >
        <boxGeometry args={[0.6, 0.9, 0.6]} />
      </mesh>
      {(selected || hover) && (
        <mesh position={[0, 0.36, 0]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      {selected && (
        <Html position={[0, 0.55, 0]} center distanceFactor={10} zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              width: 190,
              background: "linear-gradient(180deg, rgba(12,20,38,0.97), rgba(9,14,28,0.97))",
              border: "1px solid rgba(90,150,220,0.35)",
              borderRadius: 10,
              padding: "10px 12px",
              color: "#e6eef8",
              fontFamily: "system-ui, sans-serif",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              backdropFilter: "blur(6px)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>{site.name}</div>
            <div style={{ fontSize: 10.5, color: "#8aa0c0", marginBottom: 8 }}>{site.id}</div>
            {[
              ["Status", site.status ?? (site.level === "normal" ? "Operational" : "Watch"), site.level === "normal" ? "#3ce6b0" : color],
              ["Load", site.loadPct != null ? `${site.loadPct}%` : "—", "#dbe6f5"],
              ["Voltage", site.voltageKv != null ? `${site.voltageKv} kV` : "—", "#dbe6f5"],
              ["Temp", site.tempF != null ? `${site.tempF}°F` : "—", "#dbe6f5"],
            ].map(([k, v, c]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "1.5px 0" }}>
                <span style={{ color: "#8aa0c0" }}>{k}</span>
                <span style={{ color: c as string, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "#4c9dff" }}>View Asset →</div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ── storm front (NW) with drifting cloud, glowing edge, lightning ──────────
function Storm({ label }: { label?: string }) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const bolt = useRef<THREE.LineSegments>(null);
  const nextFlash = useRef(1.5);

  const cloud = useMemo(() => {
    const n = 520;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // blob centred over the Pacific NW / upper-left, elongated toward the SE
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * 5.5;
      const lon = -119 + Math.cos(a) * r * 1.1 + r * 0.4;
      const lat = 46 + Math.sin(a) * r * 0.6;
      const [x, z] = project(lon, lat);
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.4 + Math.random() * 1.6;
      pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.4,
      map: softSprite("rgba(60,80,120,0.55)"),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    return new THREE.Points(geo, mat);
  }, []);

  const edge = useMemo(() => {
    // glowing leading edge sweeping NW -> SE
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const lon = -122 + t * 26;
      const lat = 50 - t * 22 + Math.sin(t * 8) * 0.6;
      const [x, z] = project(lon, lat);
      if (i > 0) {
        const pt = t - 1 / 60;
        const [px, pz] = project(-122 + pt * 26, 50 - pt * 22 + Math.sin(pt * 8) * 0.6);
        pts.push(px, 0.12, pz, x, 0.12, z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color("#6cc6ff"), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    return new THREE.LineSegments(geo, mat);
  }, []);

  const boltGeo = useMemo(() => new THREE.BufferGeometry(), []);
  useFrame((state, dt) => {
    if (group.current) group.current.position.x = Math.sin(state.clock.elapsedTime * 0.08) * 0.3;
    nextFlash.current -= dt;
    const l = light.current;
    if (l) l.intensity = Math.max(0, l.intensity - dt * 12);
    if (bolt.current) {
      const bm = bolt.current.material as THREE.Material & { opacity: number };
      bm.opacity = Math.max(0, bm.opacity - dt * 6);
    }
    if (nextFlash.current <= 0) {
      nextFlash.current = 1.2 + Math.random() * 2.6;
      const lon = -120 + Math.random() * 10;
      const lat = 44 + Math.random() * 6;
      const [x, z] = project(lon, lat);
      if (l) {
        l.position.set(x, 1.4, z);
        l.intensity = 6;
      }
      // a quick jagged bolt
      const seg: number[] = [];
      let y = 2.2;
      let bx = x;
      let bz = z;
      while (y > 0.1) {
        const nx = bx + (Math.random() - 0.5) * 0.5;
        const nz = bz + (Math.random() - 0.5) * 0.5;
        const ny = y - (0.25 + Math.random() * 0.3);
        seg.push(bx, y, bz, nx, ny, nz);
        bx = nx;
        bz = nz;
        y = ny;
      }
      boltGeo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
      if (bolt.current) (bolt.current.material as THREE.Material & { opacity: number }).opacity = 1;
    }
  });

  return (
    <group ref={group}>
      <primitive object={cloud} />
      <primitive object={edge} />
      <lineSegments ref={bolt} geometry={boltGeo}>
        <lineBasicMaterial color="#bfe6ff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <pointLight ref={light} color="#9ecbff" intensity={0} distance={14} decay={2} />
      {label && (
        <Html position={project(-116, 47).length ? [project(-116, 47)[0], 2.4, project(-116, 47)[1]] : [0, 2.4, 0]} center distanceFactor={12} style={{ pointerEvents: "none" }}>
          <div style={{ whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: "#bcd8ff", textShadow: "0 0 8px rgba(0,0,0,0.9)", fontFamily: "system-ui" }}>
            ⛈ {label}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── camera rig ──────────────────────────────────────────────────────────────
function Rig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0.5, 12.5, 15);
    camera.lookAt(0, 0, 1.5);
  }, [camera]);
  return (
    <OrbitControls
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={9}
      maxDistance={26}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2.35}
      target={[0, 0, 1.5]}
    />
  );
}

function Scene({ sites, storm, selectedId, onSelect }: CommandMapProps) {
  const canBloom = useMemo(bloomSafe, []);
  return (
    <>
      <color attach="background" args={["#050912"]} />
      <fog attach="fog" args={["#050912", 20, 46]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 12, 8]} intensity={0.5} color="#8fbfff" />
      <hemisphereLight args={["#22406e", "#050912", 0.4]} />

      <GroundGrid />
      <StateLines />
      <CityLights />
      <NetworkEdges sites={sites} />
      {sites.map((s) => (
        <SiteNode key={s.id} site={s} selected={selectedId === s.id} onSelect={onSelect} />
      ))}
      <Storm label={storm?.name} />

      {/* click empty space to deselect */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} onClick={() => onSelect(null)}>
        <planeGeometry args={[80, 80]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Rig />
      {canBloom && (
        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.85} mipmapBlur radius={0.7} />
        </EffectComposer>
      )}
    </>
  );
}

export type CommandMapProps = {
  sites: MapSite[];
  storm?: { name?: string } | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

// SSR-safe wrapper — three.js needs a DOM.
export function CommandMap(props: CommandMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="grid h-full w-full place-items-center bg-[#050912] text-[11px] text-slate-500">Initializing grid map…</div>;
  }
  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 38, near: 0.1, far: 100 }}
      style={{ width: "100%", height: "100%", background: "#050912" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
