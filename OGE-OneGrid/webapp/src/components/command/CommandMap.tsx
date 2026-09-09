import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { US_STATES } from "./us-geo";

// ── projection: lon/lat -> scene x/z (equirectangular, aspect-corrected) ───
const CX = -95.5;
const CY = 39.5;
const S = 0.46;
const ASPECT = 0.78;
function project(lon: number, lat: number): [number, number] {
  return [(lon - CX) * S * ASPECT, -(lat - CY) * S];
}

const RINGS_XZ: Array<Array<[number, number]>> = US_STATES.map((r) => r.map(([lo, la]) => project(lo, la)));
function pointInRing(x: number, z: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function insideUS(x: number, z: number): boolean {
  for (const r of RINGS_XZ) if (pointInRing(x, z, r)) return true;
  return false;
}
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
type Node = { x: number; z: number; real?: MapSite; tower?: boolean };

const LEVEL_COLOR: Record<string, string> = {
  critical: "#ff4d6d",
  high: "#ff8c42",
  elevated: "#f5b942",
  monitor: "#38bdf8",
  normal: "#39e6c0",
};
const colorFor = (lvl: string) => LEVEL_COLOR[lvl] ?? "#39e6c0";

function softSprite(inner: string, mid = 0.4): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(mid, inner);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
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

// soft radial glow disc (adds depth / "hovering platform" feel without bloom)
function GlowDisc({ x = 0, z = 0, w, h, color, opacity, y = -0.02 }: { x?: number; z?: number; w: number; h: number; color: string; opacity: number; y?: number }) {
  const tex = useMemo(() => softSprite(color, 0.05), [color]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, y, z]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

// ── filled US landmass (dark, reads as 3D terrain against space) ────────────
function Landmass() {
  const obj = useMemo(() => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0c2036"),
      emissive: new THREE.Color("#0a1a30"),
      emissiveIntensity: 0.6,
      metalness: 0.15,
      roughness: 0.92,
      transparent: true,
      opacity: 0.97,
    });
    const rim = new THREE.MeshBasicMaterial({ color: new THREE.Color("#123a63"), transparent: true, opacity: 0.3 });
    for (const ring of RINGS_XZ) {
      const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      group.add(new THREE.Mesh(geo, mat));
      const g2 = new THREE.ShapeGeometry(shape);
      g2.rotateX(-Math.PI / 2);
      const m2 = new THREE.Mesh(g2, rim);
      m2.position.y = -0.05;
      m2.scale.set(1.015, 1, 1.015);
      group.add(m2);
    }
    return group;
  }, []);
  return <primitive object={obj} />;
}

function StateLines() {
  const obj = useMemo(() => {
    const pts: number[] = [];
    for (const ring of RINGS_XZ) {
      for (let i = 0; i < ring.length - 1; i++) {
        pts.push(ring[i][0], 0.05, ring[i][1], ring[i + 1][0], 0.05, ring[i + 1][1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color("#2f86df"), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    return new THREE.LineSegments(geo, mat);
  }, []);
  return <primitive object={obj} />;
}

function GroundGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(70, 96, new THREE.Color("#173a63"), new THREE.Color("#0b1a30"));
    const m = g.material as THREE.Material | THREE.Material[];
    (Array.isArray(m) ? m : [m]).forEach((mm) => {
      mm.transparent = true;
      (mm as THREE.Material & { opacity: number }).opacity = 0.26;
      mm.depthWrite = false;
    });
    g.position.y = -0.08;
    return g;
  }, []);
  return (
    <group>
      <primitive object={grid} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#04070f" metalness={0.1} roughness={1} />
      </mesh>
    </group>
  );
}

function CityLights({ nodes }: { nodes: Node[] }) {
  const obj = useMemo(() => {
    const rng = mulberry32(7);
    const arr: number[] = [];
    for (const n of nodes) {
      const c = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < c; k++) arr.push(n.x + (rng() - 0.5) * 0.8, 0.05 + rng() * 0.02, n.z + (rng() - 0.5) * 0.8);
    }
    let placed = 0;
    while (placed < 260) {
      const x = (rng() - 0.5) * 20;
      const z = -3.6 + rng() * 11;
      if (insideUS(x, z)) {
        arr.push(x, 0.05 + rng() * 0.02, z);
        placed++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ size: 0.14, map: softSprite("rgba(150,205,255,0.95)"), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    return new THREE.Points(geo, mat);
  }, [nodes]);
  return <primitive object={obj} />;
}

function NetworkEdges({ nodes }: { nodes: Node[] }) {
  const { lines, glow, edges } = useMemo(() => {
    const v = nodes.map((n) => new THREE.Vector3(n.x, 0.09, n.z));
    const seen = new Set<string>();
    const eArr: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (let i = 0; i < v.length; i++) {
      const d = v
        .map((n, j) => ({ j, dist: v[i].distanceTo(n) }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);
      for (const { j } of d) {
        if (v[i].distanceTo(v[j]) > 6) continue;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        eArr.push([v[i], v[j]]);
      }
    }
    const mk = (color: string, op: number, y: number) => {
      const geo = new THREE.BufferGeometry();
      const p = eArr.flatMap(([a, b]) => [a.x, y, a.z, b.x, y, b.z]);
      geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
    };
    return { lines: mk("#4fe8ff", 0.75, 0.09), glow: mk("#1c8ad6", 0.32, 0.085), edges: eArr };
  }, [nodes]);

  const pulseData = useMemo(
    () => ({
      count: Math.min(70, edges.length),
      pick: Array.from({ length: Math.min(70, edges.length) }, () => Math.floor(Math.random() * edges.length)),
      speed: Array.from({ length: Math.min(70, edges.length) }, () => 0.18 + Math.random() * 0.4),
      t: Array.from({ length: Math.min(70, edges.length) }, () => Math.random()),
    }),
    [edges],
  );
  const pulseObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(pulseData.count * 3), 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.26, map: softSprite("rgba(200,250,255,1)"), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
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
      arr.setXYZ(i, a.x + (b.x - a.x) * pulseData.t[i], 0.11, a.z + (b.z - a.z) * pulseData.t[i]);
    }
    arr.needsUpdate = true;
  });
  return (
    <group>
      <primitive object={glow} />
      <primitive object={lines} />
      <primitive object={pulseObj} />
    </group>
  );
}

function Tower({ color, big }: { color: string; big?: boolean }) {
  const s = big ? 1.5 : 1;
  return (
    <group scale={s}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.34, 0.4, 0.05, 6]} />
        <meshStandardMaterial color="#0d1a2e" metalness={0.6} roughness={0.5} />
      </mesh>
      {[
        [-0.14, -0.14],
        [0.14, -0.14],
        [-0.14, 0.14],
        [0.14, 0.14],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x * 0.6, 0.34, z * 0.6]}>
          <cylinderGeometry args={[0.01, 0.02, 0.66, 5]} />
          <meshStandardMaterial color="#3a527d" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {[0.24, 0.44, 0.62].map((y, i) => (
        <mesh key={`x${i}`} position={[0, y, 0]}>
          <boxGeometry args={[0.34 - i * 0.06, 0.012, 0.012]} />
          <meshStandardMaterial color="#3f5c8c" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.66, 0]}>
        <boxGeometry args={[0.5, 0.02, 0.02]} />
        <meshStandardMaterial color="#4a6aa0" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.56, 0]}>
        <boxGeometry args={[0.36, 0.02, 0.02]} />
        <meshStandardMaterial color="#4a6aa0" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0.22, 0.1, 0.2]}>
        <boxGeometry args={[0.16, 0.16, 0.16]} />
        <meshStandardMaterial color="#16263f" metalness={0.7} roughness={0.4} emissive={color} emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function SiteNode({ site, selected, onSelect }: { site: MapSite; selected: boolean; onSelect: (id: string | null) => void }) {
  const [x, z] = project(site.lon, site.lat);
  const color = colorFor(site.level);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      const f = (t * 0.55 + x) % 1;
      const sc = 1 + f * 1.35;
      ring.current.scale.set(sc, sc, sc);
      (ring.current.material as THREE.Material & { opacity: number }).opacity = Math.max(0, 0.42 - f * 0.42);
    }
    if (beam.current) (beam.current.material as THREE.Material & { opacity: number }).opacity = 0.14 + Math.sin(t * 2 + x) * 0.07;
  });
  return (
    <group position={[x, 0, z]}>
      <Tower color={color} big />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.34, 0.42, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={beam} position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 1.5, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, 0.5, 0]}
        visible={false}
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
      >
        <boxGeometry args={[0.9, 1.4, 0.9]} />
      </mesh>
      {(selected || hover) && (
        <mesh position={[0, 0.78, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      {selected && (
        <Html position={[0, 1.0, 0]} center distanceFactor={11} zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ width: 196, background: "linear-gradient(180deg, rgba(11,19,36,0.98), rgba(8,13,26,0.98))", border: "1px solid rgba(90,150,220,0.4)", borderRadius: 10, padding: "10px 12px", color: "#e6eef8", fontFamily: "system-ui, sans-serif", boxShadow: "0 14px 44px rgba(0,0,0,0.65)" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{site.name}</div>
            <div style={{ fontSize: 10.5, color: "#8aa0c0", marginBottom: 8 }}>{site.id}</div>
            {[
              ["Status", site.status ?? "Operational", site.level === "normal" ? "#39e6c0" : color],
              ["Load", site.loadPct != null ? `${site.loadPct}%` : "—", "#dbe6f5"],
              ["Voltage", site.voltageKv != null ? `${site.voltageKv} kV` : "—", "#dbe6f5"],
              ["Temp", site.tempF != null ? `${site.tempF}°F` : "—", "#dbe6f5"],
            ].map(([k, val, c]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "1.5px 0" }}>
                <span style={{ color: "#8aa0c0" }}>{k}</span>
                <span style={{ color: c as string, fontWeight: 600 }}>{val}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "#4c9dff" }}>View Asset →</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function GridNode({ x, z, tower }: { x: number; z: number; tower?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      {tower ? (
        <group scale={0.7}>
          <Tower color="#7fd8ff" />
        </group>
      ) : (
        <mesh position={[0, 0.07, 0]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color="#8fe6ff" />
        </mesh>
      )}
    </group>
  );
}

function Storm({ label }: { label?: string }) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const bolt = useRef<THREE.LineSegments>(null);
  const nextFlash = useRef(1);

  const clouds = useMemo(() => {
    const rng = mulberry32(21);
    const specs: Array<[number, string, number, number]> = [
      [1500, "rgba(9,14,26,0.86)", 4.1, 0.24],
      [520, "rgba(26,40,68,0.55)", 2.6, 0.72],
      [120, "rgba(84,114,166,0.45)", 1.6, 1.15],
    ];
    const g = new THREE.Group();
    for (const [n, col, size, yb] of specs) {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.pow(rng(), 0.55) * 6.5;
        const lon = -116 + Math.cos(a) * r * 1.15 + r * 0.35;
        const lat = 45 + Math.sin(a) * r * 0.62;
        const [x, zz] = project(lon, lat);
        pos[i * 3] = x;
        pos[i * 3 + 1] = yb + rng() * 1.3;
        pos[i * 3 + 2] = zz;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size, map: softSprite(col, 0.45), transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.NormalBlending })));
    }
    return g;
  }, []);

  const edge = useMemo(() => {
    const linePts: number[] = [];
    const glowPts: number[] = [];
    let prev: [number, number] | null = null;
    // short arc hugging the SE boundary of the cloud, not a beam across the map
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const lon = -119 + t * 12;
      const lat = 49.5 - t * 9.5 + Math.sin(t * 6) * 0.5;
      const [x, z] = project(lon, lat);
      glowPts.push(x, 0.16, z);
      if (prev) linePts.push(prev[0], 0.16, prev[1], x, 0.16, z);
      prev = [x, z];
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute("position", new THREE.Float32BufferAttribute(linePts, 3));
    const line = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: new THREE.Color("#9ed6ff"), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute("position", new THREE.Float32BufferAttribute(glowPts, 3));
    const glow = new THREE.Points(ggeo, new THREE.PointsMaterial({ size: 0.85, map: softSprite("rgba(110,180,240,0.8)", 0.2), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
    const g = new THREE.Group();
    g.add(glow);
    g.add(line);
    return g;
  }, []);

  const rain = useMemo(() => {
    const rng = mulberry32(5);
    const seg: number[] = [];
    for (let i = 0; i < 300; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.6) * 5.5;
      const lon = -116 + Math.cos(a) * r + r * 0.3;
      const lat = 45 + Math.sin(a) * r * 0.6;
      const [x, z] = project(lon, lat);
      const y = 0.2 + rng() * 0.8;
      seg.push(x, y, z, x + 0.05, Math.max(0.03, y - 0.35), z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color("#6f8fc0"), transparent: true, opacity: 0.26, depthWrite: false }));
  }, []);

  const boltGeo = useMemo(() => new THREE.BufferGeometry(), []);
  useFrame((state, dt) => {
    if (group.current) group.current.position.x = Math.sin(state.clock.elapsedTime * 0.07) * 0.35;
    nextFlash.current -= dt;
    if (light.current) light.current.intensity = Math.max(0, light.current.intensity - dt * 14);
    if (bolt.current) {
      const bm = bolt.current.material as THREE.Material & { opacity: number };
      bm.opacity = Math.max(0, bm.opacity - dt * 5);
    }
    if (nextFlash.current <= 0) {
      nextFlash.current = 0.9 + Math.random() * 2.2;
      const lon = -119 + Math.random() * 11;
      const lat = 42 + Math.random() * 7;
      const [x, z] = project(lon, lat);
      if (light.current) {
        light.current.position.set(x, 1.6, z);
        light.current.intensity = 9;
      }
      const seg: number[] = [];
      let y = 2.6;
      let bx = x;
      let bz = z;
      while (y > 0.1) {
        const nx = bx + (Math.random() - 0.5) * 0.55;
        const nz = bz + (Math.random() - 0.5) * 0.55;
        const ny = y - (0.28 + Math.random() * 0.32);
        seg.push(bx, y, bz, nx, ny, nz);
        bx = nx;
        bz = nz;
        y = ny;
      }
      boltGeo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
      if (bolt.current) (bolt.current.material as THREE.Material & { opacity: number }).opacity = 1;
    }
  });

  const [lx, lz] = project(-113, 47);
  return (
    <group ref={group}>
      <primitive object={clouds} />
      <primitive object={rain} />
      <primitive object={edge} />
      <lineSegments ref={bolt} geometry={boltGeo}>
        <lineBasicMaterial color="#d6f0ff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <pointLight ref={light} color="#a9d4ff" intensity={0} distance={16} decay={2} />
      {label && (
        <Html position={[lx, 2.7, lz]} center distanceFactor={13} style={{ pointerEvents: "none" }}>
          <div style={{ whiteSpace: "nowrap", fontSize: 11, fontWeight: 700, color: "#cfe6ff", textShadow: "0 0 10px rgba(0,0,0,1)", fontFamily: "system-ui" }}>⛈ {label}</div>
        </Html>
      )}
    </group>
  );
}

function NodeHalos({ nodes }: { nodes: Node[] }) {
  const cyan = useMemo(() => {
    const pos: number[] = [];
    for (const n of nodes) if (!n.real) pos.push(n.x, 0.12, n.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.6, map: softSprite("rgba(120,230,255,0.85)", 0.2), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  }, [nodes]);
  const site = useMemo(() => {
    // colored halos for the real facilities so they read against the grid
    const g = new THREE.Group();
    for (const n of nodes) {
      if (!n.real) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([n.x, 0.14, n.z], 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.9, map: softSprite("rgba(255,255,255,0.95)", 0.12), color: new THREE.Color(colorFor(n.real.level)), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
    }
    return g;
  }, [nodes]);
  return (
    <group>
      <primitive object={cyan} />
      <primitive object={site} />
    </group>
  );
}

function Rig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0.4, 10, 13.6);
    camera.lookAt(0, 0, 1);
  }, [camera]);
  return <OrbitControls enablePan={false} enableDamping dampingFactor={0.08} minDistance={7} maxDistance={28} minPolarAngle={0.12} maxPolarAngle={Math.PI / 2.3} target={[0, 0, 1]} />;
}

function Scene({ sites, storm, selectedId, onSelect }: CommandMapProps) {
  const canBloom = useMemo(bloomSafe, []);
  const nodes = useMemo<Node[]>(() => {
    const real: Node[] = sites
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => {
        const [x, z] = project(s.lon, s.lat);
        return { x, z, real: s, tower: true };
      });
    const rng = mulberry32(1337);
    const proc: Node[] = [];
    let tries = 0;
    while (proc.length < 62 && tries < 6000) {
      tries++;
      const x = (rng() - 0.5) * 20;
      const z = -3.6 + rng() * 11;
      if (!insideUS(x, z)) continue;
      if ([...real, ...proc].some((n) => (n.x - x) ** 2 + (n.z - z) ** 2 < 0.55)) continue;
      proc.push({ x, z, tower: rng() < 0.35 });
    }
    return [...real, ...proc];
  }, [sites]);

  return (
    <>
      <color attach="background" args={["#04070f"]} />
      <fog attach="fog" args={["#04070f", 22, 50]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[6, 13, 8]} intensity={0.55} color="#9cc4ff" />
      <hemisphereLight args={["#24466e", "#04070f", 0.45]} />

      <GroundGrid />
      <GlowDisc w={28} h={17} color="rgba(46,120,190,0.55)" opacity={0.15} />
      <Landmass />
      <StateLines />
      <CityLights nodes={nodes} />
      <NetworkEdges nodes={nodes} />
      <NodeHalos nodes={nodes} />

      {nodes.map((n, i) =>
        n.real ? (
          <SiteNode key={n.real.id} site={n.real} selected={selectedId === n.real.id} onSelect={onSelect} />
        ) : (
          <GridNode key={`p${i}`} x={n.x} z={n.z} tower={n.tower} />
        ),
      )}

      {(() => {
        const [sx, sz] = project(-116, 45);
        return <GlowDisc x={sx} z={sz} w={12} h={8.5} color="rgba(95,155,235,0.8)" opacity={0.24} y={0.06} />;
      })()}
      <Storm label={storm?.name} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} onClick={() => onSelect(null)}>
        <planeGeometry args={[90, 90]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Rig />
      {canBloom && (
        <EffectComposer>
          <Bloom intensity={1.15} luminanceThreshold={0.2} luminanceSmoothing={0.85} mipmapBlur />
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

export function CommandMap(props: CommandMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="grid h-full w-full place-items-center bg-[#04070f] text-[11px] text-slate-500">Initializing grid map…</div>;
  return (
    <Canvas shadows={false} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance", alpha: false }} camera={{ fov: 40, near: 0.1, far: 100 }} style={{ width: "100%", height: "100%", background: "#04070f" }}>
      <Scene {...props} />
    </Canvas>
  );
}
