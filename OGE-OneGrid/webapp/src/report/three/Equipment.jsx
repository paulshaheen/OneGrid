import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { STEEL_TEX, PLATES_TEX, DARK_TEX, PAINTED_TEX, CONCRETE_TEX, HAS_TEX, STEAM_TEX } from './textures.js';

// Map an asset to an equipment archetype. Prefer the NAME (the group is a unit label
// like "TURBINE 2", not the equipment type). The pure classifier lives in its own module
// (no `three` import) so lightweight callers can use it without the 3D engine; re-exported
// here for the existing 3D components that import it alongside geometry helpers.
export { equipmentType } from './equipmentType.js';

// With real PBR sets loaded, the maps drive metalness/roughness/albedo — so we keep the
// scalars near 1.0 and let color=white show the true texture (tints only where we want a
// material read, e.g. copper / hot metal). Without textures (SSR), fall back to flat tints.
const envI = 1.5;
const M = HAS_TEX;
const MAT = {
  steel:     M ? { color: '#eef2f7', metalness: 1.0, roughness: 1.0, envMapIntensity: envI, normalScale: [1, 1], ...STEEL_TEX }
                : { color: '#c3cedd', metalness: 0.85, roughness: 0.40 },
  darksteel: M ? { color: '#c8ccd2', metalness: 1.0, roughness: 1.0, envMapIntensity: envI, normalScale: [1, 1], ...DARK_TEX }
                : { color: '#8b97a8', metalness: 0.8, roughness: 0.48 },
  casing:    M ? { color: '#e9edf2', metalness: 1.0, roughness: 1.0, envMapIntensity: envI, normalScale: [1, 1], ...PLATES_TEX }
                : { color: '#b3bece', metalness: 0.75, roughness: 0.42 },
  base:      M ? { color: '#9aa0a6', metalness: 0.0, roughness: 1.0, envMapIntensity: 0.7, normalScale: [1.3, 1.3], ...CONCRETE_TEX }
                : { color: '#5b6472', metalness: 0.4, roughness: 0.9 },
  copper:    M ? { color: '#e59a63', metalness: 1.0, roughness: 0.85, envMapIntensity: envI, normalScale: [0.8, 0.8], ...STEEL_TEX }
                : { color: '#d08a54', metalness: 0.9, roughness: 0.38 },
  pipe:      M ? { color: '#e6eaf0', metalness: 1.0, roughness: 1.0, envMapIntensity: envI, normalScale: [1, 1], ...STEEL_TEX }
                : { color: '#a3adbf', metalness: 0.82, roughness: 0.44 },
  hot:       M ? { color: '#e6907a', metalness: 0.9, roughness: 0.95, envMapIntensity: envI, normalScale: [1, 1], ...STEEL_TEX }
                : { color: '#d16a4f', metalness: 0.65, roughness: 0.48 },
  painted:   M ? { color: '#dfe3e6', metalness: 0.6, roughness: 1.0, envMapIntensity: envI, normalScale: [1, 1], ...PAINTED_TEX }
                : { color: '#9aa6b6', metalness: 0.5, roughness: 0.6 },
};

// Each model returns { anchors: [{id,label,pos,hint}], node } via a component that
// renders the geometry and exposes anchor points for tag hotspots.
export function EquipmentGeometry({ type, accent = '#3f96ff', running = true, detail = false, onBounds, lowRes = false }) {
  // High-res detail uses the photoreal GLBs; low-res (or fleet/overview) uses the
  // lightweight procedural builders. Toggled via the profile menu → model-res store.
  const glb = detail && !lowRes;
  switch (type) {
    case 'turbine': return glb
      ? <TurbineGLB onBounds={onBounds} />
      : <Turbine accent={accent} running={running} detail={detail} />;
    case 'boiler': return glb
      ? <BoilerGLB onBounds={onBounds} />
      : <Boiler accent={accent} running={running} detail={detail} />;
    case 'pump': return glb
      ? <PumpGLB onBounds={onBounds} />
      : <Pump accent={accent} running={running} detail={detail} />;
    case 'generator': return glb
      ? <GeneratorGLB onBounds={onBounds} />
      : <Generator accent={accent} running={running} detail={detail} />;
    case 'offshore_platform': return glb
      ? <PlatformGLB onBounds={onBounds} />
      : <OffshorePlatform accent={accent} running={running} detail={detail} />;
    case 'well': return glb
      ? <WellheadGLB onBounds={onBounds} />
      : <Wellhead accent={accent} running={running} detail={detail} />;
    case 'storage': return glb
      ? <StorageGLB onBounds={onBounds} />
      : <StorageTank accent={accent} running={running} detail={detail} />;
    case 'lng_terminal': return glb
      ? <LngGLB onBounds={onBounds} />
      : <LngTerminal accent={accent} running={running} detail={detail} />;
    case 'refinery': return glb
      ? <RefineryGLB onBounds={onBounds} />
      : <Refinery accent={accent} running={running} detail={detail} />;
    case 'port': return glb
      ? <PortGLB onBounds={onBounds} />
      : <Port accent={accent} running={running} detail={detail} />;
    case 'pipeline': return glb
      ? <PipelineGLB onBounds={onBounds} />
      : <Pipeline accent={accent} running={running} detail={detail} />;
    default: return <Skid accent={accent} running={running} detail={detail} />;
  }
}

// Self-normalizing GLB for the facility drill-in: measures its own bounds and scales to a
// common target height so the photoreal models drop into the equipment-train slots at the
// same size the procedural glyphs used. Gated behind the High model-resolution setting.
export function FacilityModel({ type, accent = '#3f96ff', running = true, targetHeight = 8 }) {
  const [fit, setFit] = useState({ s: targetHeight / 4.5, pos: [0, 0, 0] });
  const onBounds = useCallback((box) => {
    const sy = Math.max(box.max.y - box.min.y, 1e-3);
    const s = targetHeight / sy;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    setFit({ s, pos: [-cx * s, -box.min.y * s, -cz * s] });
  }, [targetHeight]);
  return (
    <group position={fit.pos} scale={fit.s}>
      <EquipmentGeometry type={type} accent={accent} running={running} detail onBounds={onBounds} />
    </group>
  );
}

// Hand-placed anchor positions on the actual photoreal GLB features, as fractions
// [fx, fy, fz] of the loaded model's bounding box (fx=width, fy=height, fz=depth; the
// GLBs are normalized + seated at y=0). Keyed by the same anchor ids as anchorsFor().
// Used only in High-res; Low-res keeps the procedural anchorsFor() positions.
export const GLB_ANCHORS = {
  offshore_platform: { deck: [0.50, 0.42, 0.55], sep: [0.28, 0.44, 0.62], flare: [0.86, 0.55, 0.50], derrick: [0.51, 0.76, 0.50], heli: [0.14, 0.55, 0.64] },
  well: { tree: [0.50, 0.74, 0.50], whp: [0.50, 0.48, 0.55], flow: [0.72, 0.22, 0.50] },
  storage: { shell: [0.28, 0.50, 0.55], roof: [0.28, 0.90, 0.50] },
  lng_terminal: { sphere: [0.50, 0.55, 0.40], rack: [0.58, 0.12, 0.90] },
  refinery: { cdu: [0.46, 0.72, 0.50], rack: [0.60, 0.33, 0.60], flare: [0.72, 0.78, 0.50] },
  port: { crane: [0.50, 0.88, 0.50], berth: [0.35, 0.08, 0.60] },
  pipeline: { valve: [0.12, 0.78, 0.50], pig: [0.48, 0.50, 0.55], press: [0.82, 0.45, 0.50] },
  turbine: { hp: [0.52, 0.55, 0.50], ip: [0.62, 0.60, 0.50], lp: [0.72, 0.52, 0.50], fbrg: [0.16, 0.45, 0.50], rbrg: [0.88, 0.45, 0.50], shaft: [0.62, 0.85, 0.50] },
  boiler: { drum: [0.47, 0.90, 0.50], furn: [0.51, 0.45, 0.60], sh: [0.62, 0.66, 0.50], econ: [0.40, 0.20, 0.55], aph: [0.80, 0.28, 0.50] },
  pump: { motor: [0.26, 0.44, 0.75], mbrg: [0.30, 0.46, 0.62], seal: [0.44, 0.42, 0.46], volute: [0.42, 0.48, 0.52], suction: [0.30, 0.10, 0.06], pbrg: [0.40, 0.55, 0.44] },
  generator: { stator: [0.50, 0.55, 0.40], exc: [0.58, 0.60, 0.10], brg: [0.50, 0.48, 0.90] },
};

// Camera framing per archetype so the whole model is centered & fully visible
// (a tall boiler needs a very different frame than a long turbine).
export function viewFor(type) {
  switch (type) {
    case 'turbine':   return { position: [10.5, 5.5, 14], target: [0, 1.8, 0], minD: 8, maxD: 30 };
    case 'boiler':    return { position: [12, 8.5, 16], target: [0, 3.8, 0], minD: 10, maxD: 34 };
    case 'pump':      return { position: [8, 5, 11], target: [0, 1.7, 0], minD: 6, maxD: 24 };
    case 'generator': return { position: [9.5, 5.5, 12.5], target: [0, 1.9, 0], minD: 7, maxD: 26 };
    case 'offshore_platform': return { position: [14, 10, 17], target: [0, 3.6, 0], minD: 11, maxD: 44 };
    case 'well':              return { position: [6, 4.5, 8], target: [0, 1.8, 0], minD: 4, maxD: 20 };
    case 'storage':           return { position: [11, 8, 14], target: [0, 3.0, 0], minD: 9, maxD: 34 };
    case 'lng_terminal':      return { position: [12, 7, 15], target: [0, 2.4, 0], minD: 9, maxD: 34 };
    case 'refinery':          return { position: [14, 10, 17], target: [0, 4.2, 0], minD: 11, maxD: 42 };
    case 'port':              return { position: [15, 9, 17], target: [0, 2.4, 0], minD: 11, maxD: 44 };
    case 'pipeline':          return { position: [11, 5.5, 12], target: [0, 1.1, 0], minD: 7, maxD: 30 };
    default:          return { position: [7.5, 5, 10.5], target: [0, 1.6, 0], minD: 6, maxD: 22 };
  }
}

export function anchorsFor(type) {
  switch (type) {
    case 'turbine': return [
      { id: 'hp', label: 'HP Casing', pos: [-3.1, 1.9, 0], hint: 'throttle|hp|steam|inlet' },
      { id: 'ip', label: 'IP Section', pos: [-0.4, 2.05, 0], hint: 'ip|reheat|mid' },
      { id: 'lp', label: 'LP Exhaust', pos: [2.9, 2.0, 0], hint: 'lp|exhaust|hood|vacuum|condenser' },
      { id: 'fbrg', label: 'Front Bearing', pos: [-4.6, 1.2, 0], hint: 'thrust|front|brg|bearing|vibration' },
      { id: 'rbrg', label: 'Gen Bearing', pos: [4.7, 1.2, 0], hint: 'gen|rear|brg|bearing|seal' },
      { id: 'shaft', label: 'Rotor / Speed', pos: [0, 3.1, 0], hint: 'speed|rpm|rotor|turb speed' },
    ];
    case 'boiler': return [
      { id: 'drum', label: 'Steam Drum', pos: [0, 6.6, 0], hint: 'drum|level|steam|press' },
      { id: 'furn', label: 'Furnace', pos: [-2.4, 3.2, 0], hint: 'furnace|fire|burner|temp' },
      { id: 'sh', label: 'Superheater', pos: [2.2, 4.6, 0], hint: 'superheat|sh|outlet|temp' },
      { id: 'econ', label: 'Economizer', pos: [2.4, 1.4, 0], hint: 'econ|feedwater|fw|inlet' },
      { id: 'aph', label: 'Air Preheater', pos: [-2.6, 1.2, 0], hint: 'air|aph|preheat|damper' },
    ];
    case 'pump': return [
      { id: 'motor', label: 'Motor', pos: [-2.6, 2.1, 0], hint: 'motor|winding|current|amp' },
      { id: 'mbrg', label: 'Motor Bearing', pos: [-1.1, 2.1, 0], hint: 'motor brg|bearing|vibration' },
      { id: 'seal', label: 'Mech Seal', pos: [0.7, 1.9, 0], hint: 'seal|leak' },
      { id: 'volute', label: 'Volute', pos: [2.2, 1.6, 0], hint: 'discharge|press|flow|head' },
      { id: 'suction', label: 'Suction', pos: [2.4, 0.5, 1.6], hint: 'suction|inlet|npsh' },
      { id: 'pbrg', label: 'Pump Bearing', pos: [1.0, 2.2, 0], hint: 'pump brg|thrust|vertical|horizontal' },
    ];
    case 'generator': return [
      { id: 'stator', label: 'Stator', pos: [0, 2.6, 0], hint: 'stator|voltage|volt' },
      { id: 'exc', label: 'Exciter', pos: [3.2, 1.6, 0], hint: 'exciter|field|reactive' },
      { id: 'brg', label: 'Bearing', pos: [-3.2, 1.4, 0], hint: 'bearing|brg|h2|hydrogen' },
    ];
    case 'offshore_platform': return [
      { id: 'deck', label: 'Process Deck', pos: [0, 3.7, 0], hint: 'process|deck|topside' },
      { id: 'sep', label: 'Separator', pos: [1.6, 4.2, -1.8], hint: 'separator|sep|pressure' },
      { id: 'flare', label: 'Flare', pos: [4.4, 4.2, 0], hint: 'flare|gas|burn' },
      { id: 'derrick', label: 'Derrick', pos: [-1.8, 8.2, 1.6], hint: 'derrick|drill|well' },
      { id: 'heli', label: 'Helideck', pos: [2.0, 3.9, 2.2], hint: 'helideck|heli' },
    ];
    case 'well': return [
      { id: 'tree', label: 'Xmas Tree', pos: [0, 3.4, 0], hint: 'tree|valve|choke' },
      { id: 'whp', label: 'Wellhead', pos: [0, 1.0, 0], hint: 'wellhead|casing|pressure|pip' },
      { id: 'flow', label: 'Flowline', pos: [1.9, 0.6, 0], hint: 'flow|line|rate|amps' },
    ];
    case 'storage': return [
      { id: 'shell', label: 'Shell', pos: [0, 3.0, 2.6], hint: 'shell|level|temp' },
      { id: 'roof', label: 'Roof', pos: [0, 5.6, 0], hint: 'roof|vapor|pressure' },
    ];
    case 'lng_terminal': return [
      { id: 'sphere', label: 'LNG Sphere', pos: [0, 3.6, 0], hint: 'sphere|lng|level|temp' },
      { id: 'rack', label: 'Loading', pos: [2.6, 1.6, 2.0], hint: 'loading|jetty|flow' },
    ];
    case 'refinery': return [
      { id: 'cdu', label: 'Crude Column', pos: [0.2, 6.2, 0], hint: 'column|cdu|distill|temp' },
      { id: 'rack', label: 'Pipe Rack', pos: [1.6, 2.0, 2.2], hint: 'rack|pipe|flow' },
      { id: 'flare', label: 'Flare', pos: [3.4, 6.4, -1.5], hint: 'flare|gas' },
    ];
    case 'port': return [
      { id: 'crane', label: 'Gantry Crane', pos: [-1.2, 6.2, 1.8], hint: 'crane|load' },
      { id: 'berth', label: 'Berth', pos: [1.8, 0.9, 1.8], hint: 'berth|vessel|dock' },
    ];
    case 'pipeline': return [
      { id: 'valve', label: 'Block Valve', pos: [0, 1.9, 0], hint: 'valve|block|isolation' },
      { id: 'pig', label: 'Pig Launcher', pos: [-3.0, 1.0, 0], hint: 'pig|launcher|flow' },
      { id: 'press', label: 'Pressure', pos: [2.2, 1.2, 0], hint: 'pressure|flow|leak|imbalance' },
    ];
    default: return [
      { id: 'a', label: 'Point A', pos: [-1.5, 1.6, 0], hint: '' },
      { id: 'b', label: 'Point B', pos: [1.5, 1.6, 0], hint: '' },
      { id: 'c', label: 'Point C', pos: [0, 2.4, 0], hint: '' },
    ];
  }
}

// ---------------- models ----------------
function Base({ w = 12, d = 5 }) {
  const bolts = [];
  const bx = w / 2 - 0.5, bz = d / 2 - 0.5;
  [[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz], [0, -bz], [0, bz]].forEach((p, i) => {
    bolts.push(
      <mesh key={i} position={[p[0], 0.55, p[1]]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.18, 8]} />
        <meshStandardMaterial {...MAT.darksteel} />
      </mesh>
    );
  });
  return (
    <group>
      {/* concrete pad */}
      <mesh position={[0, 0.25, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, 0.5, d]} />
        <meshStandardMaterial {...MAT.base} />
      </mesh>
      {/* raised curb edge */}
      <mesh position={[0, 0.52, 0]} receiveShadow castShadow>
        <boxGeometry args={[w - 0.4, 0.14, d - 0.4]} />
        <meshStandardMaterial {...MAT.base} />
      </mesh>
      {bolts}
    </group>
  );
}

// ---- reusable industrial detail parts ----
// Ring of bolt heads in the plane perpendicular to X (for shaft/pipe flanges).
function BoltRingX({ r = 1, count = 12, s = 0.05, len = 0.16, mat = MAT.darksteel }) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    items.push(
      <mesh key={i} position={[0, Math.cos(a) * r, Math.sin(a) * r]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[s, s, len, 6]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    );
  }
  return <group>{items}</group>;
}
// A bolted pipe/casing flange centered at origin, axis along X.
function FlangeX({ r = 1.2, thick = 0.14, count = 14 }) {
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, thick, 44]} />
        <meshStandardMaterial {...MAT.casing} />
      </mesh>
      <BoltRingX r={r * 0.82} count={count} len={thick + 0.06} />
    </group>
  );
}
// Small pressure gauge on a stem.
function Gauge({ pos = [0, 0, 0], rot = [0, 0, 0] }) {
  return (
    <group position={pos} rotation={rot}>
      <mesh castShadow><cylinderGeometry args={[0.05, 0.05, 0.5, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[0, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.22, 0.12, 20]} /><meshStandardMaterial {...MAT.casing} />
      </mesh>
      <mesh position={[0, 0.35, 0.07]}><circleGeometry args={[0.17, 20]} /><meshStandardMaterial color="#f2f5f8" metalness={0.1} roughness={0.4} /></mesh>
    </group>
  );
}
// Perimeter handrail (posts + top/mid rails) around a w x d footprint at height y0.
function Handrail({ w = 8, d = 4, y0 = 0.6, h = 1.1 }) {
  const hx = w / 2, hz = d / 2, posts = [];
  const stops = (n, half) => Array.from({ length: n + 1 }, (_, i) => -half + (i * (half * 2)) / n);
  const xs = stops(Math.max(2, Math.round(w / 2)), hx);
  const zs = stops(Math.max(2, Math.round(d / 2)), hz);
  const corners = [];
  xs.forEach((x) => { corners.push([x, -hz]); corners.push([x, hz]); });
  zs.forEach((z) => { corners.push([-hx, z]); corners.push([hx, z]); });
  corners.forEach((p, i) => posts.push(
    <mesh key={i} position={[p[0], y0 + h / 2, p[1]]} castShadow>
      <cylinderGeometry args={[0.045, 0.045, h, 8]} /><meshStandardMaterial {...MAT.pipe} />
    </mesh>
  ));
  const rail = (yy) => (
    <group position={[0, y0 + yy, 0]}>
      <mesh position={[0, 0, -hz]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, w, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[0, 0, hz]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, w, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[-hx, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.04, 0.04, d, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[hx, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.04, 0.04, d, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
    </group>
  );
  return <group>{posts}{rail(h)}{rail(h * 0.55)}</group>;
}
// Caged vertical ladder.
function Ladder({ pos = [0, 0, 0], height = 5 }) {
  const rungs = [];
  for (let y = 0.4; y < height; y += 0.5) rungs.push(
    <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.03, 0.03, 0.7, 6]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
  );
  return (
    <group position={pos}>
      <mesh position={[-0.32, height / 2, 0]}><cylinderGeometry args={[0.04, 0.04, height, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[0.32, height / 2, 0]}><cylinderGeometry args={[0.04, 0.04, height, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      {rungs}
    </group>
  );
}
// Buckstay / structural I-band around a box (horizontal stiffener).
function Band({ w, h, d, y, t = 0.16 }) {
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, 0, d / 2]} castShadow><boxGeometry args={[w, h, t]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      <mesh position={[0, 0, -d / 2]} castShadow><boxGeometry args={[w, h, t]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      <mesh position={[w / 2, 0, 0]} castShadow><boxGeometry args={[t, h, d]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      <mesh position={[-w / 2, 0, 0]} castShadow><boxGeometry args={[t, h, d]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
    </group>
  );
}

// ---- motion / running FX ----
// Continuously rotate children around an axis (visualises a running rotor / fan / coupling).
function Spin({ speed = 1, axis = 'x', position = [0, 0, 0], run = true, children }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (run && ref.current) ref.current.rotation[axis] += speed * Math.min(dt, 0.05);
  });
  return <group ref={ref} position={position}>{children}</group>;
}

// A spinning coupling/flywheel disc with a contrasting keyway stripe so rotation is visible.
function Coupling({ r = 0.55, len = 0.6, speed = 8, run = true, axis = 'x' }) {
  return (
    <Spin speed={speed} axis={axis} run={run}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, len, 24]} /><meshStandardMaterial {...MAT.steel} />
      </mesh>
      {/* keyway stripe */}
      <mesh position={[0, r * 0.98, 0]}>
        <boxGeometry args={[len + 0.02, 0.06, 0.12]} /><meshStandardMaterial color="#ffcf5a" metalness={0.4} roughness={0.5} emissive="#f0a500" emissiveIntensity={0.25} />
      </mesh>
    </Spin>
  );
}

// A spinning bladed fan (visible rotation for motors / generators).
function Fan({ r = 1.4, blades = 9, speed = 14, run = true }) {
  const items = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    items.push(
      <mesh key={i} position={[0, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55]} rotation={[a, 0, Math.PI / 2]} castShadow>
        <boxGeometry args={[0.06, r, 0.34]} /><meshStandardMaterial {...MAT.darksteel} />
      </mesh>
    );
  }
  return (
    <Spin speed={speed} axis="x" run={run}>
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.22, 0.22, 0.3, 16]} /><meshStandardMaterial {...MAT.steel} /></mesh>
      {items}
    </Spin>
  );
}

// Rising, swaying, fading steam/vapour plume made of soft billboarded sprites.
function Steam({ position = [0, 0, 0], count = 16, spread = 0.5, rise = 3.2, size = 1.5, color = '#e8eef5', opacity = 0.4, speed = 1, run = true }) {
  const refs = useRef([]);
  const state = useMemo(() => Array.from({ length: count }, () => ({
    t: Math.random(),
    x: (Math.random() * 2 - 1) * spread, z: (Math.random() * 2 - 1) * spread,
    sway: Math.random() * Math.PI * 2, amp: 0.15 + Math.random() * 0.3, s0: 0.55 + Math.random() * 0.6,
  })), [count, spread]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    for (let i = 0; i < count; i++) {
      const p = state[i], spr = refs.current[i];
      if (!spr) continue;
      if (run) p.t += d * speed * 0.32;
      if (p.t >= 1) { p.t -= 1; p.x = (Math.random() * 2 - 1) * spread; p.z = (Math.random() * 2 - 1) * spread; p.sway = Math.random() * Math.PI * 2; }
      const f = p.t;
      spr.position.set(p.x + Math.sin(p.sway + f * 4) * p.amp * f, f * rise, p.z + Math.cos(p.sway + f * 4) * p.amp * f);
      const sc = size * (0.35 + f * 1.4) * p.s0;
      spr.scale.set(sc, sc, sc);
      spr.material.opacity = run ? opacity * Math.sin(Math.min(1, f) * Math.PI) : 0;
    }
  });
  if (!STEAM_TEX) return null;
  return (
    <group position={position}>
      {state.map((p, i) => (
        <sprite key={i} ref={(el) => (refs.current[i] = el)} scale={[0.01, 0.01, 0.01]}>
          <spriteMaterial map={STEAM_TEX} color={color} transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// Flickering burner/fire glow (+ a heat point light in the close-up detail view).
function BurnerFX({ position = [0, 0, 0], detail = false, run = true }) {
  const glow = useRef();
  const light = useRef();
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const f = 0.72 + Math.sin(t * 13) * 0.16 + Math.sin(t * 7.3) * 0.1;
    if (glow.current) glow.current.material.opacity = run ? 0.6 + (f - 0.72) : 0.12;
    if (light.current) light.current.intensity = run ? (detail ? 2.6 : 0) * f : 0;
  });
  return (
    <group position={position}>
      <mesh ref={glow}><circleGeometry args={[0.5, 24]} /><meshBasicMaterial color="#ff7a3c" toneMapped={false} transparent opacity={0.6} /></mesh>
      {detail && <pointLight ref={light} color="#ff6a2c" distance={7} intensity={2} />}
    </group>
  );
}

// ---- greeble / added industrial detail (matches the model-gallery look) ----
function Seg({ a, b, r = 0.05, mat = MAT.pipe }) {
  const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = new THREE.Vector3().subVectors(vb, va), len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  return <mesh position={mid.toArray()} quaternion={[q.x, q.y, q.z, q.w]} castShadow>
    <cylinderGeometry args={[r, r, len, 8]} /><meshStandardMaterial {...mat} /></mesh>;
}
function Valve({ pos }) {
  return <group position={pos}>
    <mesh castShadow><boxGeometry args={[0.4, 0.42, 0.5]} /><meshStandardMaterial {...MAT.painted} /></mesh>
    <mesh position={[0, 0.45, 0]} castShadow><cylinderGeometry args={[0.08, 0.08, 0.5, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
    <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.22, 0.04, 8, 18]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
  </group>;
}
function JBox({ pos, h = 0.7 }) {
  return <group position={pos}>
    <mesh castShadow><boxGeometry args={[0.5, h, 0.32]} /><meshStandardMaterial {...MAT.painted} /></mesh>
    <Seg a={[0, -h / 2, 0]} b={[0, -h / 2 - 0.7, 0]} r={0.05} />
  </group>;
}
function LaggingRings({ x0, x1, y, z = 0, r, count }) {
  const items = [];
  for (let i = 0; i < count; i++) { const x = x0 + (x1 - x0) * (i / (count - 1));
    items.push(<mesh key={i} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[r, 0.045, 6, 28]} /><meshStandardMaterial {...MAT.casing} /></mesh>); }
  return <group>{items}</group>;
}
function CableTray({ a, b, y }) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6));
  const rungs = [];
  for (let i = 0; i <= n; i++) { const t = i / n;
    rungs.push(<mesh key={i} position={[a[0] + (b[0] - a[0]) * t, y + 0.06, a[1] + (b[1] - a[1]) * t]} rotation={[0, ang, 0]}><boxGeometry args={[0.32, 0.03, 0.05]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>); }
  return <group>
    <Seg a={[a[0], y, a[1]]} b={[b[0], y, b[1]]} r={0.05} mat={MAT.darksteel} />
    <Seg a={[a[0], y + 0.12, a[1]]} b={[b[0], y + 0.12, b[1]]} r={0.05} mat={MAT.darksteel} />
    {rungs}
  </group>;
}
function Greeble({ type }) {
  return <group>
    <JBox pos={[-2.2, 1.3, -2.1]} /><JBox pos={[2.4, 1.1, -2.1]} /><CableTray a={[-3, -1.9]} b={[3, -1.9]} y={0.72} />
    {type === 'turbine' && <><LaggingRings x0={-4.2} x1={1.3} y={1.6} r={1.42} count={11} /><Valve pos={[0, 1.05, 2.1]} /><JBox pos={[4.6, 1.65, 1.0]} /><Seg a={[-4.6, 1.9, 1.2]} b={[-4.6, 3.1, 1.2]} /><mesh position={[-4.9, 2.4, -1.4]} castShadow><boxGeometry args={[1.0, 0.7, 0.8]} /><meshStandardMaterial {...MAT.painted} /></mesh></>}
    {type === 'boiler' && <><Valve pos={[1.0, 7.55, 0.6]} /><JBox pos={[-2.55, 3.2, 2.4]} /><CableTray a={[-2.8, 2.7]} b={[2.8, 2.7]} y={1.0} />{[0, 1, 2].map((i) => <mesh key={i} position={[-2.55, 2 + i * 1.3, 2.4]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.1, 0.1, 2.0, 8]} /><meshStandardMaterial {...MAT.pipe} /></mesh>)}</>}
    {type === 'pump' && <><Valve pos={[1.9, 3.95, 0]} /><Seg a={[1.9, 3.9, 0]} b={[2.8, 3.9, 0]} r={0.06} /><JBox pos={[-2.2, 2.7, -0.8]} /></>}
    {type === 'generator' && <><CableTray a={[-0.6, -1.3]} b={[0.6, -1.3]} y={3.5} /><JBox pos={[3.0, 1.65, 1.1]} /><Valve pos={[-2.5, 1.25, 1.6]} /><LaggingRings x0={-2.4} x1={2.4} y={2.2} r={1.86} count={7} /></>}
    {type === 'skid' && <><Valve pos={[-1.9, 1.45, 1.0]} /><JBox pos={[-1.6, 1.05, -1.0]} /><Seg a={[0, 1.1, 1.0]} b={[1.6, 1.1, 1.0]} r={0.06} /></>}
  </group>;
}

function Turbine({ accent, running = true, detail = false }) {
  const stages = [
    { x: -3.1, r: 1.35, l: 2.4 },
    { x: -0.4, r: 1.6, l: 2.6 },
    { x: 2.4, r: 2.0, l: 3.0 },
  ];
  return (
    <group>
      <Base w={12} d={4.5} />
      {/* shaft */}
      <mesh position={[0, 1.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 12, 24]} />
        <meshStandardMaterial {...MAT.steel} />
      </mesh>
      {/* stepped casings */}
      {stages.map((s, i) => (
        <group key={i} position={[s.x, 1.6, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[s.r, s.r, s.l, 40]} />
            <meshStandardMaterial {...MAT.casing} />
          </mesh>
          {/* casing bands */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[s.r + 0.02, 0.06, 8, 40]} />
            <meshStandardMaterial {...MAT.darksteel} />
          </mesh>
        </group>
      ))}
      {/* bearing pedestals */}
      {[-4.6, 4.6].map((x, i) => (
        <mesh key={i} position={[x, 1.0, 0]} castShadow>
          <boxGeometry args={[1.0, 1.6, 2.2]} />
          <meshStandardMaterial {...MAT.darksteel} />
        </mesh>
      ))}
      {/* flanged joints between casings */}
      {[-1.75, 1.0].map((x, i) => (
        <group key={i} position={[x, 1.6, 0]}><FlangeX r={1.75} thick={0.18} count={18} /></group>
      ))}
      {/* oil / drain piping along the base */}
      <mesh position={[0, 0.62, 1.9]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 10.5, 16]} /><meshStandardMaterial {...MAT.pipe} />
      </mesh>
      {[-3.4, 0, 3.4].map((x, i) => (
        <mesh key={i} position={[x, 1.0, 1.9]} castShadow><cylinderGeometry args={[0.09, 0.09, 1.0, 12]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      ))}
      {/* gauges on the front pedestal + a small governor box */}
      <Gauge pos={[-4.6, 1.85, 1.2]} />
      <Gauge pos={[-4.2, 1.85, 1.2]} />
      <mesh position={[4.6, 2.1, 1.0]} castShadow><boxGeometry args={[0.7, 0.5, 0.4]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      {/* exhaust hood */}
      <mesh position={[2.4, 3.4, 0]} castShadow>
        <boxGeometry args={[3.2, 1.4, 3.4]} />
        <meshStandardMaterial {...MAT.casing} />
      </mesh>
      {/* generator stub */}
      <mesh position={[5.6, 1.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[1.3, 1.3, 2.2, 32]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.35} emissive={accent} emissiveIntensity={0.15} />
      </mesh>
      {/* spinning coupling between turbine and generator (running indicator) */}
      <group position={[4.35, 1.6, 0]}><Coupling r={0.62} len={0.7} speed={9} run={running} axis="x" /></group>
      <Greeble type="turbine" />
      {/* gland / exhaust vapour wisps (detail close-up only) */}
      {detail && <Steam position={[2.4, 4.2, 0]} count={12} spread={0.7} rise={2.6} size={1.1} opacity={0.28} speed={1.3} run={running} />}
    </group>
  );
}

function Boiler({ accent, running = true, detail = false }) {
  return (
    <group>
      <Base w={7} d={6} />
      {/* furnace */}
      <mesh position={[-1.4, 3.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 6.2, 4.6]} />
        <meshStandardMaterial {...MAT.painted} />
      </mesh>
      {/* back pass */}
      <mesh position={[2.0, 3.0, 0]} castShadow>
        <boxGeometry args={[2.4, 5.2, 4.2]} />
        <meshStandardMaterial {...MAT.darksteel} />
      </mesh>
      {/* steam drum */}
      <mesh position={[0, 6.7, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[1.15, 1.15, 6.2, 32]} />
        <meshStandardMaterial {...MAT.steel} />
      </mesh>
      {/* downcomers */}
      {[-2.5, -1.9, 1.4, 2.0].map((x, i) => (
        <mesh key={i} position={[x, 3.4, 2.3]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 6, 12]} />
          <meshStandardMaterial {...MAT.pipe} />
        </mesh>
      ))}
      {/* stack */}
      <mesh position={[3.4, 6.5, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.85, 7, 24]} />
        <meshStandardMaterial {...MAT.darksteel} />
      </mesh>
      {/* flickering burner heat glow (+ heat light in close-up) */}
      <BurnerFX position={[-1.4, 2.0, 2.31]} detail={detail} run={running} />
      {/* steam plume off the stack + flue vapour */}
      <Steam position={[3.4, 10.2, 0]} count={detail ? 22 : 12} spread={0.7} rise={detail ? 4.0 : 3.4} size={2.0} color="#dfe6ee" opacity={0.5} speed={1} run={running} />
      {/* safety-valve steam jet off the drum (very visible, mid-frame) */}
      <Steam position={[0.9, 7.7, 0]} count={detail ? 16 : 8} spread={0.28} rise={detail ? 3.2 : 2.4} size={1.2} color="#eef3f8" opacity={0.5} speed={1.6} run={running} />
      {/* buckstay stiffener bands around the furnace */}
      {[1.6, 3.4, 5.2].map((y, i) => (
        <Band key={i} w={3.8} h={0.24} d={4.8} y={y} />
      ))}
      {/* burner fronts */}
      {[[-2.2, 2.0], [-2.2, 3.4], [-0.6, 2.0], [-0.6, 3.4]].map((p, i) => (
        <mesh key={i} position={[p[0], p[1], 2.32]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.34, 0.4, 16]} /><meshStandardMaterial {...MAT.darksteel} />
        </mesh>
      ))}
      {/* drum saddle straps */}
      {[-2, 2].map((z, i) => (
        <mesh key={i} position={[0, 6.7, z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.16, 0.07, 8, 32]} /><meshStandardMaterial {...MAT.darksteel} />
        </mesh>
      ))}
      {/* riser tubes furnace -> drum */}
      {[-1.2, -0.4, 0.4, 1.2].map((x, i) => (
        <mesh key={i} position={[x, 5.6, -2.3]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 2.6, 10]} /><meshStandardMaterial {...MAT.pipe} />
        </mesh>
      ))}
      {/* main steam line off the drum */}
      <mesh position={[0.9, 7.6, 0]} castShadow><cylinderGeometry args={[0.22, 0.22, 1.8, 16]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      {/* flue duct: back pass -> stack */}
      <mesh position={[2.9, 6.0, 0]} rotation={[0, 0, Math.PI / 2.6]} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 1.6, 20]} /><meshStandardMaterial {...MAT.darksteel} />
      </mesh>
      {/* access platform + handrail + ladder */}
      <mesh position={[0.3, 4.2, 2.9]} receiveShadow castShadow>
        <boxGeometry args={[6.4, 0.12, 1.2]} /><meshStandardMaterial {...MAT.casing} />
      </mesh>
      <Handrail w={6.4} d={1.2} y0={4.26} h={1.0} />
      <Ladder pos={[-3.0, 0.5, 3.0]} height={3.7} />
      <Greeble type="boiler" />
    </group>
  );
}

function Pump({ accent, running = true, detail = false }) {
  return (
    <group>
      <Base w={8} d={3.4} />
      {/* motor */}
      <mesh position={[-2.2, 2.0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[1.0, 1.0, 3.0, 32]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.35} emissive={accent} emissiveIntensity={0.12} />
      </mesh>
      {/* motor fins */}
      {[...Array(10)].map((_, i) => (
        <mesh key={i} position={[-2.2, 2.0, 0]} rotation={[0, (i / 10) * Math.PI * 2, Math.PI / 2]}>
          <boxGeometry args={[3.0, 0.04, 0.5]} />
          <meshStandardMaterial {...MAT.darksteel} />
        </mesh>
      ))}
      {/* spinning motor cooling fan (rear) + exposed coupling (running indicator) */}
      <group position={[-3.95, 2.0, 0]}><Fan r={0.85} blades={9} speed={16} run={running} /></group>
      <group position={[0.55, 2.0, 0]}><Coupling r={0.32} len={0.5} speed={16} run={running} axis="x" /></group>
      {/* coupling guard */}
      <mesh position={[-0.3, 2.0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 1.0, 20]} />
        <meshStandardMaterial {...MAT.steel} />
      </mesh>
      {/* pump volute */}
      <mesh position={[1.9, 1.5, 0]} castShadow>
        <sphereGeometry args={[1.15, 32, 24]} />
        <meshStandardMaterial {...MAT.casing} />
      </mesh>
      <mesh position={[1.9, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.15, 0.12, 10, 32]} />
        <meshStandardMaterial {...MAT.darksteel} />
      </mesh>
      {/* discharge pipe up */}
      <mesh position={[1.9, 3.1, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.4, 1.6, 20]} />
        <meshStandardMaterial {...MAT.pipe} />
      </mesh>
      {/* suction pipe */}
      <mesh position={[2.6, 0.9, 1.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.45, 1.8, 20]} />
        <meshStandardMaterial {...MAT.pipe} />
      </mesh>
      {/* discharge + suction flanges */}
      <group position={[1.9, 3.75, 0]} rotation={[0, 0, Math.PI / 2]}><FlangeX r={0.55} thick={0.12} count={8} /></group>
      <group position={[2.6, 0.9, 2.3]} rotation={[Math.PI / 2, 0, 0]}><FlangeX r={0.6} thick={0.12} count={8} /></group>
      {/* steel baseplate */}
      <mesh position={[0, 0.62, 0]} receiveShadow castShadow><boxGeometry args={[7.2, 0.24, 2.8]} /><meshStandardMaterial {...MAT.casing} /></mesh>
      {/* motor terminal box */}
      <mesh position={[-2.2, 3.0, 0.5]} castShadow><boxGeometry args={[0.7, 0.5, 0.5]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      {/* mechanical-seal gland + bolts */}
      <group position={[0.75, 1.9, 0]} rotation={[0, 0, Math.PI / 2]}><FlangeX r={0.42} thick={0.12} count={6} /></group>
      {/* gauge on the discharge */}
      <Gauge pos={[1.5, 3.4, 0.5]} rot={[0, 0.4, 0]} />
      <Greeble type="pump" />
    </group>
  );
}

function Generator({ accent, running = true, detail = false }) {
  return (
    <group>
      <Base w={9} d={4} />
      {/* stator body */}
      <mesh position={[0, 2.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[1.8, 1.8, 5.2, 40]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.35} emissive={accent} emissiveIntensity={0.12} />
      </mesh>
      {/* cooling ribs along the stator */}
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={i} position={[-2.0 + i * 0.5, 2.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[1.82, 0.05, 8, 40]} /><meshStandardMaterial {...MAT.darksteel} />
        </mesh>
      ))}
      {/* end bells with bolt rings */}
      {[-2.62, 2.62].map((x, i) => (
        <group key={i} position={[x, 2.2, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[1.85, 1.85, 0.2, 40]} /><meshStandardMaterial {...MAT.casing} /></mesh>
          <BoltRingX r={1.5} count={20} len={0.24} />
        </group>
      ))}
      {/* bearing pedestals */}
      {[-3.1, 3.1].map((x, i) => (
        <mesh key={i} position={[x, 1.4, 0]} castShadow><boxGeometry args={[1.0, 1.4, 2.2]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      ))}
      {/* line-side terminal bushings */}
      {[-0.5, 0, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 3.9, -0.9]} castShadow><cylinderGeometry args={[0.14, 0.18, 0.9, 12]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      ))}
      {/* base rails */}
      {[-1.3, 1.3].map((z, i) => (
        <mesh key={i} position={[0, 0.62, z]} castShadow><boxGeometry args={[8, 0.22, 0.4]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      ))}
      {/* spinning shaft-end fan (running indicator) */}
      <group position={[3.0, 2.2, 0]}><Fan r={1.05} blades={11} speed={12} run={running} /></group>
      <Greeble type="generator" />
    </group>
  );
}

function Skid({ accent, running = true, detail = false }) {
  return (
    <group>
      <Base w={6} d={4} />
      {/* main enclosure */}
      <mesh position={[0, 1.6, 0]} castShadow><boxGeometry args={[3.2, 2.4, 2.6]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      {/* framing bands */}
      <Band w={3.3} h={0.16} d={2.7} y={1.6} t={0.12} />
      {/* pump/driver stub */}
      <mesh position={[1.9, 1.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.8, 0.8, 1.6, 24]} /><meshStandardMaterial color={accent} metalness={0.6} roughness={0.4} /></mesh>
      {/* spinning coupling (running indicator) */}
      <group position={[2.85, 1.4, 0]}><Coupling r={0.4} len={0.5} speed={13} run={running} axis="x" /></group>
      {/* skid piping + valves */}
      <mesh position={[-1.9, 0.9, 1.0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.18, 0.18, 3.2, 16]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <mesh position={[0, 0.9, 1.0]} castShadow><boxGeometry args={[0.3, 0.5, 0.3]} /><meshStandardMaterial {...MAT.copper} /></mesh>
      {/* control cabinet */}
      <mesh position={[-1.6, 1.5, -1.0]} castShadow><boxGeometry args={[0.7, 1.4, 0.5]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      <Gauge pos={[1.0, 2.9, 1.0]} />
      <Greeble type="skid" />
    </group>
  );
}

// ======================= Oil & Gas models =======================
// A live gas flare — emissive flame + drifting smoke, used by the platform & refinery.
function Flame({ position = [0, 0, 0], scale = 1, run = true }) {
  const ref = useRef();
  useFrame((s) => { if (ref.current && run) ref.current.scale.setScalar(scale * (1 + 0.12 * Math.sin(s.clock.elapsedTime * 9))); });
  return (
    <group position={position}>
      <group ref={ref}>
        <mesh><coneGeometry args={[0.5 * scale, 2.2 * scale, 14]} /><meshStandardMaterial color="#ff7a2c" emissive="#ff5a1a" emissiveIntensity={2.2} toneMapped={false} /></mesh>
        <mesh position={[0, 0.5 * scale, 0]}><coneGeometry args={[0.28 * scale, 1.3 * scale, 14]} /><meshStandardMaterial color="#ffd27a" emissive="#ffbd52" emissiveIntensity={3} toneMapped={false} /></mesh>
      </group>
      <Steam position={[0, 1.7 * scale, 0]} count={10} spread={0.4} rise={3} size={1.3} color="#3b3b3b" opacity={0.26} run={run} />
    </group>
  );
}

function OffshorePlatform({ accent, running = true }) {
  const legs = [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]];
  return (
    <group>
      {/* jacket legs down to the seabed + cross bracing */}
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, -1.4, z]} castShadow><cylinderGeometry args={[0.26, 0.34, 7.2, 12]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      ))}
      <Seg a={[-1.9, -3.2, -1.9]} b={[1.9, -0.4, 1.9]} r={0.08} mat={MAT.darksteel} />
      <Seg a={[1.9, -3.2, -1.9]} b={[-1.9, -0.4, 1.9]} r={0.08} mat={MAT.darksteel} />
      <Seg a={[-1.9, -3.2, 1.9]} b={[1.9, -0.4, -1.9]} r={0.08} mat={MAT.darksteel} />
      {/* main deck */}
      <mesh position={[0, 3.2, 0]} castShadow receiveShadow><boxGeometry args={[6.8, 0.5, 6.4]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      <Handrail w={6.8} d={6.4} y0={3.45} h={1.0} />
      {/* topside process modules + separators */}
      <mesh position={[-1.7, 4.5, -1.2]} castShadow><boxGeometry args={[2.2, 2.1, 2.2]} /><meshStandardMaterial {...MAT.casing} /></mesh>
      <mesh position={[1.5, 4.2, 1.1]} castShadow><boxGeometry args={[2.6, 1.6, 2.4]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      <mesh position={[1.6, 4.0, -1.8]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.6, 0.6, 2.2, 20]} /><meshStandardMaterial {...MAT.steel} /></mesh>
      {/* drilling derrick — tapered lattice */}
      <group position={[-1.7, 3.45, 1.6]}>
        {[0, 1, 2, 3].map((i) => {
          const s = 1 - i * 0.17;
          return (
            <group key={i} position={[0, i * 1.4, 0]}>
              {[[-0.55 * s, -0.55 * s], [0.55 * s, -0.55 * s], [-0.55 * s, 0.55 * s], [0.55 * s, 0.55 * s]].map(([x, z], j) => (
                <mesh key={j} position={[x, 0.7, z]} castShadow><cylinderGeometry args={[0.05, 0.05, 1.4, 6]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
              ))}
            </group>
          );
        })}
        <mesh position={[0, 5.7, 0]} castShadow><boxGeometry args={[0.4, 0.4, 0.4]} /><meshStandardMaterial color={accent} /></mesh>
      </group>
      {/* flare boom + flame */}
      <group position={[3.4, 3.6, 0]} rotation={[0, 0, -0.5]}>
        <mesh position={[1.7, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.14, 0.14, 3.8, 10]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
        <Flame position={[3.4, 0.5, 0]} scale={0.9} run={running} />
      </group>
      {/* helideck */}
      <mesh position={[2.0, 3.55, 2.3]} castShadow><cylinderGeometry args={[1.4, 1.4, 0.12, 24]} /><meshStandardMaterial color="#2a3547" metalness={0.3} roughness={0.85} /></mesh>
      <mesh position={[2.0, 3.63, 2.3]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.7, 0.9, 32]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} side={THREE.DoubleSide} /></mesh>
      <Gauge pos={[0, 4.0, 2.7]} />
    </group>
  );
}

// Photoreal O&G assets from real Sketchfab CAD models (all CC-BY, see MODEL_CREDITS),
// decimated + textured, exported as GLBs. Used only in the drill-in detail view; the
// fleet/overview still renders the lightweight procedural builders below.
function makeGLB(path) {
  function GLB({ onBounds }) {
    const { scene } = useGLTF(path);
    const model = useMemo(() => scene.clone(true), [scene]);
    // Report the model's local-space bounding box (rotation-independent) so the detail
    // view can frame the camera and lay the sensor anchors onto the actual geometry —
    // the GLBs are all normalized to ~4.5m, unlike the larger procedural models the
    // hardcoded anchors/cameras were authored for.
    useEffect(() => {
      if (!onBounds) return;
      model.updateWorldMatrix(true, true);
      const inv = model.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      const m = new THREE.Matrix4();
      model.traverse((o) => {
        if (o.isMesh && o.geometry) {
          o.updateWorldMatrix(true, false);
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          m.multiplyMatrices(inv, o.matrixWorld);
          tmp.copy(o.geometry.boundingBox).applyMatrix4(m);
          box.union(tmp);
        }
      });
      if (!box.isEmpty()) onBounds(box);
    }, [model, onBounds]);
    return <primitive object={model} />;
  }
  useGLTF.preload(path);
  return GLB;
}
const WellheadGLB = makeGLB('/models/wellhead.glb');
const PlatformGLB = makeGLB('/models/platform.glb');
const StorageGLB = makeGLB('/models/storage.glb');
const RefineryGLB = makeGLB('/models/refinery.glb');
const LngGLB = makeGLB('/models/lng.glb');
const PortGLB = makeGLB('/models/port.glb');
const PipelineGLB = makeGLB('/models/pipeline.glb');
const TurbineGLB = makeGLB('/models/turbine.glb');
const BoilerGLB = makeGLB('/models/boiler.glb');
const PumpGLB = makeGLB('/models/pump.glb');
const GeneratorGLB = makeGLB('/models/generator.glb');

// Attribution for shipped Sketchfab models (CC-BY requires credit).
export const MODEL_CREDITS = [
  { type: 'well', title: 'Oil Wellhead Assembly', author: 'vivek.b.khandelwal' },
  { type: 'offshore_platform', title: 'Offshore Oil Rig', author: 'Juoda' },
  { type: 'storage', title: 'Industrial Storage Tanks', author: 'duanesmind' },
  { type: 'refinery', title: 'Refinery Complex', author: 'Chenzoss' },
  { type: 'lng_terminal', title: 'Gas Storage Sphere', author: 'burnedhrum' },
  { type: 'port', title: 'Harbour Crane (Skipskranen)', author: 'Tidvis' },
  { type: 'pipeline', title: 'Old Rusty Pipeline', author: 'SamuelLee' },
  { type: 'turbine', title: 'Turbine Generator', author: 'shevchukmaks' },
  { type: 'boiler', title: 'Industrial Boiler System', author: '0xDegenPicasso' },
  { type: 'pump', title: 'Industrial Water Pump', author: 'visthetique' },
  { type: 'generator', title: 'Diesel Generator', author: 'orphanrtg' },
];

function Wellhead({ accent }) {
  return (
    <group>
      <Base w={4} d={4} />
      <mesh position={[0, 0.7, 0]} castShadow><cylinderGeometry args={[0.6, 0.72, 1.4, 20]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      {/* stacked valve blocks (christmas tree) */}
      {[0, 1, 2].map((i) => (<mesh key={i} position={[0, 1.6 + i * 0.7, 0]} castShadow><boxGeometry args={[0.9, 0.6, 0.9]} /><meshStandardMaterial {...MAT.painted} /></mesh>))}
      <mesh position={[0, 3.5, 0]} castShadow><cylinderGeometry args={[0.35, 0.46, 0.5, 16]} /><meshStandardMaterial color={accent} metalness={0.6} roughness={0.4} /></mesh>
      {/* wing valves + handwheels */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.9, 2.0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.22, 0.22, 0.9, 14]} /><meshStandardMaterial {...MAT.steel} /></mesh>
          <mesh position={[s * 0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.32, 0.06, 8, 20]} /><meshStandardMaterial color={accent} /></mesh>
        </group>
      ))}
      <mesh position={[1.5, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.18, 0.18, 1.8, 16]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      <Valve pos={[2.2, 0.55, 0]} />
      <Gauge pos={[0.8, 3.0, 0.7]} />
    </group>
  );
}

function StorageTank({ accent }) {
  return (
    <group>
      <Base w={7} d={7} />
      <mesh position={[0, 2.6, 0]} castShadow receiveShadow><cylinderGeometry args={[2.6, 2.6, 5.0, 40]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      <mesh position={[0, 5.1, 0]} castShadow><sphereGeometry args={[2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...MAT.casing} /></mesh>
      {[1.4, 2.8, 4.2].map((y, i) => (<mesh key={i} position={[0, y, 0]}><torusGeometry args={[2.61, 0.04, 8, 48]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>))}
      {/* spiral stair */}
      {Array.from({ length: 11 }).map((_, i) => { const a = i * 0.55; return (<mesh key={i} position={[Math.cos(a) * 2.78, 0.5 + i * 0.46, Math.sin(a) * 2.78]} castShadow><boxGeometry args={[0.5, 0.06, 0.28]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>); })}
      <mesh position={[2.9, 3.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.16, 0.16, 0.9, 12]} /><meshStandardMaterial color={accent} /></mesh>
      <Gauge pos={[0, 5.7, 0]} />
    </group>
  );
}

function LngTerminal({ accent }) {
  return (
    <group>
      <Base w={8} d={5} />
      {[-2.2, 0, 2.2].map((x, i) => (
        <group key={i} position={[x, 2.7, 0]}>
          <mesh position={[0, -1.6, 0]} castShadow><cylinderGeometry args={[0.9, 1.0, 1.7, 20]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
          <mesh castShadow><sphereGeometry args={[1.3, 32, 24]} /><meshStandardMaterial color="#eef2f7" metalness={0.7} roughness={0.35} envMapIntensity={1.5} /></mesh>
          <mesh><torusGeometry args={[1.31, 0.03, 8, 40]} /><meshStandardMaterial color={accent} /></mesh>
        </group>
      ))}
      {/* pipe rack */}
      <mesh position={[0, 1.2, 2.0]} castShadow><boxGeometry args={[6.6, 0.16, 0.3]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      {[-2.7, 0, 2.7].map((x, i) => (<mesh key={i} position={[x, 0.6, 2.0]} castShadow><boxGeometry args={[0.16, 1.2, 0.16]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>))}
      <Seg a={[-3.1, 1.3, 2.0]} b={[3.1, 1.3, 2.0]} r={0.08} mat={MAT.pipe} />
      <Gauge pos={[0, 4.3, 0]} />
    </group>
  );
}

function Refinery({ accent, running = true }) {
  const cols = [[-1.8, 3.0], [0.2, 3.9], [1.9, 2.5]];
  return (
    <group>
      <Base w={9} d={6} />
      {cols.map(([x, h], i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, h, 0]} castShadow><cylinderGeometry args={[0.55, 0.62, h * 2, 24]} /><meshStandardMaterial {...MAT.painted} /></mesh>
          {[0.3, 0.6, 0.85].map((f, j) => (<mesh key={j} position={[0, h * 2 * f, 0]}><torusGeometry args={[0.6, 0.05, 8, 24]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>))}
          <mesh position={[0, h * 2 + 0.2, 0]} castShadow><cylinderGeometry args={[0.3, 0.55, 0.5, 20]} /><meshStandardMaterial {...MAT.steel} /></mesh>
        </group>
      ))}
      {/* pipe rack */}
      <mesh position={[0, 1.4, 2.2]} castShadow><boxGeometry args={[7, 0.16, 0.4]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      {[-3, -1, 1, 3].map((x, i) => (<mesh key={i} position={[x, 0.7, 2.2]} castShadow><boxGeometry args={[0.16, 1.4, 0.16]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>))}
      <Seg a={[-3.4, 1.5, 2.2]} b={[3.4, 1.5, 2.2]} r={0.07} mat={MAT.pipe} />
      <Seg a={[-3.4, 1.2, 2.2]} b={[3.4, 1.2, 2.2]} r={0.06} mat={MAT.copper} />
      {/* flare stack */}
      <group position={[3.4, 0, -1.5]}>
        <mesh position={[0, 3.0, 0]} castShadow><cylinderGeometry args={[0.16, 0.2, 6, 14]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
        <Flame position={[0, 6.3, 0]} scale={0.8} run={running} />
      </group>
      <Gauge pos={[0.2, 8.0, 0]} />
    </group>
  );
}

function Port({ accent, running = true }) {
  const trolley = useRef();
  useFrame((s) => { if (trolley.current && running) trolley.current.position.x = -1.2 + Math.sin(s.clock.elapsedTime * 0.5) * 2.2; });
  const boxes = [['#c0492f', -3.4, 0.7, -0.6], ['#2f6ec0', -3.4, 1.35, -0.6], ['#2f9e6e', -2.0, 0.7, -0.6], ['#c98a12', 3.2, 0.7, -0.4], ['#7c5cf0', 3.2, 1.35, -0.4]];
  return (
    <group>
      <Base w={10} d={6} />
      {/* quay */}
      <mesh position={[0, 0.4, 1.8]} castShadow receiveShadow><boxGeometry args={[9, 0.8, 2.2]} /><meshStandardMaterial {...MAT.base} /></mesh>
      {/* gantry crane portal */}
      {[[-1.2, 1.0], [-1.2, 2.6]].map(([x, z], i) => (<mesh key={i} position={[x, 3.2, z]} castShadow><boxGeometry args={[0.2, 5.6, 0.2]} /><meshStandardMaterial color={accent} /></mesh>))}
      <mesh position={[-1.2, 6.0, 1.8]} castShadow><boxGeometry args={[0.3, 0.3, 3.4]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      <mesh position={[1.6, 6.0, 1.8]} castShadow><boxGeometry args={[5.8, 0.3, 0.3]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      <mesh ref={trolley} position={[-1.2, 5.7, 1.8]} castShadow><boxGeometry args={[0.6, 0.4, 0.6]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      {/* stacked containers */}
      {boxes.map(([c, x, y, z], i) => (<mesh key={i} position={[x, y, z]} castShadow><boxGeometry args={[1.4, 0.6, 0.7]} /><meshStandardMaterial color={c} metalness={0.2} roughness={0.7} /></mesh>))}
      <Gauge pos={[1.8, 1.4, 1.8]} />
    </group>
  );
}

function Pipeline({ accent }) {
  return (
    <group>
      <Base w={9} d={3} />
      <mesh position={[0, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.4, 0.4, 8, 24]} /><meshStandardMaterial {...MAT.pipe} /></mesh>
      {[-3.2, -1.1, 1.1, 3.2].map((x, i) => (<mesh key={i} position={[x, 0.4, 0]} castShadow><boxGeometry args={[0.3, 0.7, 0.8]} /><meshStandardMaterial {...MAT.base} /></mesh>))}
      {/* block valve + actuator */}
      <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[0.7, 0.9, 0.9]} /><meshStandardMaterial {...MAT.painted} /></mesh>
      <mesh position={[0, 1.7, 0]} castShadow><cylinderGeometry args={[0.28, 0.28, 0.7, 16]} /><meshStandardMaterial color={accent} /></mesh>
      {/* pig launcher */}
      <group position={[-3.0, 0.9, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.5, 0.5, 1.4, 20]} /><meshStandardMaterial {...MAT.steel} /></mesh>
        <mesh position={[-0.85, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow><sphereGeometry args={[0.5, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...MAT.darksteel} /></mesh>
      </group>
      <Valve pos={[1.7, 1.4, 0]} />
      <Gauge pos={[2.3, 1.4, 0.5]} />
    </group>
  );
}
