import { useMemo, useRef, useState, useEffect, Suspense, Component } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, ContactShadows, Html, OrbitControls, Line } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { statusOf } from '../lib/format.js';
import { EquipmentGeometry, equipmentType } from './Equipment.jsx';
import { NATION, STATES } from './usaGeo.js';
import { WORLD } from './worldGeo.js';

const worstOf = (units = []) => units.reduce((s, u) => (u.status === 'critical' ? 'critical' : s === 'critical' ? 'critical' : u.status === 'watch' ? 'watch' : s), 'ok');

class SafeBoundary extends Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {}
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children; }
}
function SafeEnvironment({ preset, intensity = 1 }) {
  return <SafeBoundary fallback={null}><Suspense fallback={null}><Environment preset={preset} environmentIntensity={intensity} /></Suspense></SafeBoundary>;
}

// ── Geographic placement of each plant on the US map (lon/lat) ──────────────
const PLANT_GEO = {
  Ashford: { lon: -122.0, lat: 46.9, city: 'WA' },
  Riverton: { lon: -108.4, lat: 43.0, city: 'WY' },
  Fairview: { lon: -96.6, lat: 33.1, city: 'TX' },
  Deepwater: { lon: -75.48, lat: 39.68, city: 'NJ' },
  Eastport: { lon: -67.0, lat: 44.9, city: 'ME' },
  'Harbor Point': { lon: -87.6, lat: 41.8, city: 'IL' },
  Brookline: { lon: -71.12, lat: 42.33, city: 'MA' },
  'Cedar Falls': { lon: -92.44, lat: 42.53, city: 'IA' },
  Glenwood: { lon: -95.39, lat: 45.65, city: 'MN' },
};
// equirectangular projection (lon/lat → world X/Z), aspect-corrected at ~lat38
const LON0 = -95.5, LAT0 = 38.0, K = 2.8, COSLAT = Math.cos((38 * Math.PI) / 180);
function project(lon, lat) { return [(lon - LON0) * K * COSLAT, -(lat - LAT0) * K]; }
let _geoIdx = 0;
function geoFor(name) {
  if (PLANT_GEO[name]) return PLANT_GEO[name];
  const g = [[-115, 39], [-100, 47], [-83, 35], [-78, 44]][(_geoIdx++) % 4];
  return { lon: g[0], lat: g[1], city: '' };
}

// ── Level-2 interior: each unit is its own connected operating train ─────────
const ORDER = { pump: 0, boiler: 1, turbine: 2, generator: 3, skid: 4 };
const CONNECT_LABEL = { 'pump-boiler': 'feedwater', 'boiler-turbine': 'steam', 'turbine-generator': 'shaft', 'pump-turbine': 'feedwater' };
// Canonical operating train + friendly names for modeled (not-instrumented) fill-ins.
const TRAIN = ['pump', 'boiler', 'turbine', 'generator'];
// Turbine + generator sit on an elevated turbine deck (condenser hangs below); boiler & BFP stay at grade.
const DECK_Y = 4;
const GHOST_NAME = { pump: 'Boiler Feed Pump', boiler: 'Boiler', turbine: 'Steam Turbine', generator: 'Generator' };
const GHOST = '#64748b';

// The generator net-load (MW) PI tag follows "<unit>:GEJU<n>NLOAD.AG" (the unit code is
// also the PI tag prefix, e.g. RV3 → RV3:GEJU3NLOAD.AG).
export function deriveMwTag(unit) {
  const prefix = String(unit || '').trim();
  if (!prefix) return null;
  const n = (prefix.match(/(\d+)/) || [])[1] || '';
  return `${prefix}:GEJU${n}NLOAD.AG`;
}
export function plantGenTags(plant) {
  return (plant?.unitList || []).map((u) => deriveMwTag(u.name)).filter(Boolean);
}

function Connector({ from, to, kind, ghost }) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const isShaft = kind === 'turbine-generator';
  const color = ghost ? GHOST : kind === 'boiler-turbine' ? '#d16a4f' : isShaft ? '#c3cedd' : '#7f8aa0';
  return (
    <group position={mid.toArray()} quaternion={quat.toArray()}>
      <mesh castShadow={!ghost}><cylinderGeometry args={[isShaft ? 0.18 : 0.28, isShaft ? 0.18 : 0.28, len, 16]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.4} transparent opacity={ghost ? 0.32 : 1} emissive={!ghost && kind === 'boiler-turbine' ? '#d16a4f' : '#000'} emissiveIntensity={!ghost && kind === 'boiler-turbine' ? 0.25 : 0} /></mesh>
    </group>
  );
}

function Pylon({ x, z = 0, h = 7 }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.12, 0.28, h, 8]} /><meshStandardMaterial color="#6b7688" metalness={0.6} roughness={0.5} /></mesh>
      <mesh position={[0, h - 0.6, 0]}><boxGeometry args={[3.2, 0.18, 0.18]} /><meshStandardMaterial color="#6b7688" metalness={0.6} roughness={0.5} /></mesh>
      <mesh position={[0, h - 1.6, 0]}><boxGeometry args={[2.4, 0.16, 0.16]} /><meshStandardMaterial color="#6b7688" metalness={0.6} roughness={0.5} /></mesh>
    </group>
  );
}
function wireSag(a, b, sag = 1.1, seg = 12) {
  const pts = [];
  for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t]); }
  return pts;
}
// Transmission lines carrying the generator's live net output (MW) off-site.
function Transmission({ mw, live, accent }) {
  const spans = [10, 21, 32];
  const headY = 6.4, pyH = 7;
  const attach = [[2, 4.6, 0], ...spans.map((x) => [x, pyH - 0.6, 0])];
  const phaseZ = [-0.9, 0, 0.9];
  return (
    <group>
      {spans.map((x) => <Pylon key={x} x={x} h={pyH} />)}
      {attach.slice(0, -1).map((a, i) => {
        const b = attach[i + 1];
        return phaseZ.map((pz, j) => (
          <Line key={`${i}-${j}`} points={wireSag([a[0], a[1], pz], [b[0], b[1], pz])} color="#9fb0c6" lineWidth={1} transparent opacity={0.7} />
        ));
      })}
      <Html position={[16, 9.2, 0]} center distanceFactor={30} zIndexRange={[20, 0]}>
        <div className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5"
          style={{ background: 'rgba(8,12,20,.88)', color: '#eaf2fb', border: `1px solid ${accent}66`, boxShadow: `0 0 14px ${accent}44` }}>
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill={accent}><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
          {mw != null ? `${mw.toFixed(1)} MW` : '— MW'}
          {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </div>
      </Html>
    </group>
  );
}

function InteriorAsset({ node, theme, selected, hovered, onSelect, onHover, values }) {
  const ref = useRef();
  const ghost = node.ghost;
  const s = ghost ? { color: GHOST, glow: GHOST } : statusOf(node.status);
  const isSel = selected === node.id;
  const isHot = !ghost && node.status !== 'ok';
  const clickable = !ghost && !node.synthetic;
  const type = node.type || equipmentType(node.asset || node);
  const liveMw = node.isGen && node.mwTag ? values?.[node.mwTag]?.value : undefined;
  const mw = node.isGen ? (liveMw != null ? liveMw : Math.round(((node.health ?? 92) / 100) * 260)) : undefined;
  const baseScale = ghost ? 0.46 : 0.52;
  useFrame((_, delta) => {
    if (!ref.current) return;
    const target = isSel ? 0.62 : hovered === node.id ? 0.58 : baseScale;
    ref.current.scale.setScalar(THREE.MathUtils.lerp(ref.current.scale.x, target, 0.15));
    if (isSel) ref.current.rotation.y += (delta || 0.016) * 0.55;            // spin only the selected resource
    else ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, 0, 0.12); // others settle facing front
  });
  return (
    <group position={node.pos}>
      <mesh position={[0, 2, 0]} visible={false}
        onPointerOver={(e) => { if (!clickable) return; e.stopPropagation(); onHover(node.id); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { if (!clickable) return; e.stopPropagation(); onSelect(node); }}>
        <boxGeometry args={[7, 5, 5]} />
      </mesh>
      <group ref={ref} scale={baseScale}><EquipmentGeometry type={type} accent={s.color} running={!ghost} detail={false} /></group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}><ringGeometry args={[3.6, 4.0, 48]} /><meshBasicMaterial color={s.color} transparent opacity={ghost ? 0.22 : isHot ? 0.8 : 0.4} toneMapped={false} /></mesh>
      {isHot && <mesh position={[0, 5.4, 0]}><sphereGeometry args={[0.22, 16, 16]} /><meshBasicMaterial color={s.color} toneMapped={false} /></mesh>}
      {node.isGen && <group position={[0, -(node.pos?.[1] || 0), 0]}><Transmission mw={mw} live={liveMw != null} accent={theme.accent} /></group>}
      <Html position={[0, isSel || hovered === node.id ? 6.0 : 5.2, 0]} center distanceFactor={26} zIndexRange={[20, 0]}>
        <div className="px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap"
          style={{ background: 'rgba(8,12,20,.82)', color: ghost ? '#9aa7b8' : isSel || hovered === node.id ? s.color : '#cdd8e6', border: `1px solid ${s.color}${isSel ? 'aa' : ghost ? '33' : '44'}`, boxShadow: isSel ? `0 0 16px ${s.glow}` : 'none', borderStyle: ghost ? 'dashed' : 'solid', opacity: ghost ? 0.9 : 1 }}>
          {node.name}{ghost ? '' : node.synthetic ? '' : node.health != null ? ` · ${Math.round(node.health)}%` : ''}
          {ghost ? <span className="opacity-70 font-normal italic"> · modeled</span> : node.unit ? <span className="opacity-60 font-normal"> · {node.unit}</span> : null}
        </div>
      </Html>
    </group>
  );
}

// Each UNIT is a separate operating train. The data only instruments some equipment per
// unit, so missing slots are filled with "modeled" (ghost) placeholders — dimmed and
// non-interactive — so the full pump → boiler → turbine → generator stack still reads
// end-to-end. Real assets stay full-colour, clickable and live.
function interiorLayout(plant) {
  const units = plant?.unitList || [];
  const rows = [], connectors = [], labels = [], pads = [], structures = [];
  const rowGap = 30;
  const onDeck = (t) => t === 'turbine' || t === 'generator';
  units.forEach((u, ui) => {
    const z = (ui - (units.length - 1) / 2) * rowGap;
    const byType = {};
    (u.assets || []).forEach((a) => { byType[equipmentType(a)] = a; });
    const nodes = TRAIN.map((type) => {
      const a = byType[type];
      if (a) return { kind: 'asset', id: a.asset_id, asset_id: a.asset_id, name: a.name, plant: plant.name, unit: u.name, status: a.status, health: a.health, category: a.category, tags: a.tags || [], running_tag: a.running_tag, asset: a, type, real: true };
      const isGen = type === 'generator';
      return { kind: 'ghost', ghost: true, isGen, id: `${u.name}_${type}`, name: `${u.name} ${GHOST_NAME[type]}`, plant: plant.name, unit: u.name, status: 'modeled', type, mwTag: isGen ? deriveMwTag(u.name) : null };
    });
    const gap = 12, n = nodes.length;
    nodes.forEach((nd, i) => { nd.pos = [(i - (n - 1) / 2) * gap, onDeck(nd.type) ? DECK_Y : 0, z]; });
    rows.push(...nodes);
    const cy = (nd) => (onDeck(nd.type) ? DECK_Y + 0.4 : 1.6);
    for (let i = 0; i < nodes.length - 1; i++) {
      const k = `${nodes[i].type}-${nodes[i + 1].type}`;
      const ghost = nodes[i].ghost || nodes[i + 1].ghost;
      connectors.push({ from: [nodes[i].pos[0] + 2.4, cy(nodes[i]), z], to: [nodes[i + 1].pos[0] - 2.4, cy(nodes[i + 1]), z], kind: k, id: `${u.name}-c${i}`, ghost });
      const lbl = CONNECT_LABEL[k];
      if (lbl) labels.push({ id: `${u.name}-l${i}`, pos: [(nodes[i].pos[0] + nodes[i + 1].pos[0]) / 2, Math.max(cy(nodes[i]), cy(nodes[i + 1])) + 1.4, z], text: lbl, ghost });
    }
    const xs = nodes.map((nd) => nd.pos[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    pads.push({ id: u.name, z, x0: minX - 7, x1: maxX + 34, status: u.status });
    labels.push({ id: `${u.name}-unit`, pos: [minX - 8.5, 0.4, z], text: u.name, unit: true, status: u.status });
    const xOf = (t) => nodes.find((nd) => nd.type === t)?.pos[0];
    structures.push({ unit: u.name, z, status: u.status, pumpX: xOf('pump') ?? minX, boilerX: xOf('boiler') ?? minX, turbineX: xOf('turbine') ?? 0, generatorX: xOf('generator') ?? maxX });
  });
  return { rows, connectors, labels, pads, structures };
}

// ── Camera rig: eases to a goal only right after a transition, then hands the
// camera back to OrbitControls so manual zoom/orbit is never yanked back. ────
function CameraRig({ mode, focus }) {
  const controls = useRef();
  const { camera } = useThree();
  // Time-based eased tween driven by accumulated (capped) frame-delta — NOT wall-clock —
  // so a multi-second "building facility twin" stall can't skip the animation before the
  // first frame renders. Reaches the goal exactly at t=1, so duration controls speed.
  const anim = useRef({ active: false, elapsed: 0, dur: 1.4, from: new THREE.Vector3(), fromT: new THREE.Vector3(), to: new THREE.Vector3(), toT: new THREE.Vector3() });
  useEffect(() => {
    const c = controls.current;
    const goalPos = new THREE.Vector3(), goalTgt = new THREE.Vector3();
    let startPos = null, startTgt = null, dur = 1.4, fov = 40;
    if (mode === 'sites') { goalTgt.set(0, 12, 2); goalPos.set(6, 150, 182); }
    else if (focus) { goalTgt.set(focus[0], 2, focus[2]); goalPos.set(focus[0] + 2, 14, focus[2] + 20); }
    else {
      // Plant overview: cinematic entry — establishing angle up high, then sweep down and
      // swing to the LEFT so the moon (far left/high/back at -165,72,-160) lands in the
      // upper-left corner and the plant recedes into the lower-right foreground. Wider 48°
      // FOV is needed to hold both the moon and the whole plant in one frame.
      goalPos.set(10, 10, 115); goalTgt.set(-25, 15, -30); fov = 48;
      startPos = new THREE.Vector3(-30, 55, 155); startTgt = new THREE.Vector3(0, 8, 0);
      dur = 2.8;
    }
    if (camera.isPerspectiveCamera && camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const a = anim.current;
    a.from.copy(startPos || camera.position);
    a.fromT.copy(startTgt || (c ? c.target : goalTgt));
    a.to.copy(goalPos); a.toT.copy(goalTgt);
    a.dur = dur; a.elapsed = 0; a.active = true;
    if (startPos && c) { camera.position.copy(startPos); c.target.copy(startTgt); } // no first-frame jump
  }, [mode, focus]);
  // The instant the user grabs the camera, stop auto-centering for good (until the next
  // explicit mode/focus transition).
  useEffect(() => {
    const c = controls.current; if (!c) return;
    const onStart = () => { anim.current.active = false; };
    c.addEventListener('start', onStart);
    return () => c.removeEventListener('start', onStart);
  }, []);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  useFrame((_, delta) => {
    const c = controls.current; if (!c) return;
    const a = anim.current;
    if (a.active) {
      a.elapsed += Math.min(delta, 1 / 30); // cap so a long build/stall frame can't skip the sweep
      const t = Math.min(1, a.elapsed / a.dur);
      const e = easeInOut(t);
      camera.position.lerpVectors(a.from, a.to, e);
      c.target.lerpVectors(a.fromT, a.toT, e);
      if (t >= 1) a.active = false;
    }
    c.update();
  });
  const sites = mode === 'sites';
  return <OrbitControls ref={controls} makeDefault enablePan={sites} minDistance={sites ? 40 : 8} maxDistance={sites ? 340 : 130} maxPolarAngle={Math.PI / 2.05} enableDamping dampingFactor={0.08} />;
}

// ── Level-1: US map with a glowing status pin per plant ─────────────────────
function MapMarker({ site, theme, hovered, onHover, onEnter }) {
  const g = useRef();
  const s = statusOf(site.status);
  const hot = site.status !== 'ok';
  const isHover = hovered === site.name;
  useFrame(() => { if (g.current) { const t = isHover ? 1.14 : 1; g.current.scale.setScalar(THREE.MathUtils.lerp(g.current.scale.x, t, 0.14)); } });
  return (
    <group position={site.pos}>
      <mesh position={[0, 3, 0]} visible={false}
        onPointerOver={(e) => { e.stopPropagation(); onHover(site.name); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); onEnter(site.name); }}>
        <boxGeometry args={[7, 8, 7]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.12, 0]}><ringGeometry args={[2.0, 2.6, 40]} /><meshBasicMaterial color={s.color} transparent opacity={hot ? 0.85 : 0.5} toneMapped={false} /></mesh>
      <group ref={g}>
        <mesh position={[0, 2, 0]}><cylinderGeometry args={[0.16, 0.16, 4, 12]} /><meshStandardMaterial color="#5a6678" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 4.4, 0]}><sphereGeometry args={[0.85, 20, 20]} /><meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={hot ? 1.4 : 0.6} toneMapped={false} /></mesh>
        {hot && <pointLight position={[0, 4.4, 0]} color={s.color} intensity={7} distance={26} />}
      </group>
      <Html position={[0, 6.4, 0]} center distanceFactor={110} zIndexRange={[20, 0]}>
        <button onClick={() => onEnter(site.name)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap"
          style={{ background: 'rgba(8,12,20,.88)', color: isHover ? s.color : '#e6eef8', border: `1.5px solid ${s.color}${isHover ? 'cc' : '55'}`, boxShadow: hot ? `0 0 16px ${s.glow}` : 'none' }}>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${hot ? 'animate-pulse' : ''}`} style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
            {site.name}<span className="opacity-50 font-medium">· {site.city}</span>
          </div>
          <div className="text-[9px] font-medium opacity-80 mt-0.5">{site.critical ? `${site.critical} critical` : `${site.assetCount} healthy`} · enter →</div>
        </button>
      </Html>
    </group>
  );
}

// point-in-polygon (ray cast) for clipping terrain/lights to the US outline
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}
const CITY_METROS = [[-74,40.7,10],[-118.2,34,9],[-87.6,41.8,8],[-95.4,29.8,6],[-96.8,32.8,6],[-112,33.4,5],[-75.2,40,5],[-122.4,37.8,6],[-122.3,47.6,5],[-80.2,25.8,5],[-84.4,33.7,5],[-71.1,42.4,5],[-77,38.9,5],[-105,39.7,4],[-93.3,45,4],[-83,42.3,4],[-115.1,36.2,3],[-122.7,45.5,3],[-111.9,40.8,3],[-90.2,38.6,3],[-94.6,39.1,3],[-86.8,36.2,3],[-80.8,35.2,3],[-81.4,28.5,3],[-98.5,29.4,3],[-97.5,35.5,3],[-90.1,29.95,3],[-76.6,39.3,3],[-82.4,27.9,3]];
const GLOW_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.4, 'rgba(255,244,214,0.6)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();

function CityLights({ points }) {
  const ref = useRef();
  useFrame((st) => { if (ref.current) ref.current.material.size = 0.6 * (0.82 + 0.22 * Math.sin(st.clock.elapsedTime * 3.2)); });
  return <primitive ref={ref} object={points} />;
}

// ── Holographic Earth: the US night-map panel pops out of a rotating grid globe ──
function lonLatToVec3(lon, lat, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}
function buildGraticule(r) {
  const pts = [];
  for (let lat = -80; lat <= 80; lat += 20) {
    let prev = null;
    for (let lon = -180; lon <= 180; lon += 6) { const v = lonLatToVec3(lon, lat, r); if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z); prev = v; }
  }
  for (let lon = -180; lon < 180; lon += 20) {
    let prev = null;
    for (let lat = -90; lat <= 90; lat += 6) { const v = lonLatToVec3(lon, lat, r); if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z); prev = v; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
}
// World coastlines mapped to the sphere as one LineSegments geometry (single draw call).
function buildWorldLines(r, rings) {
  const pts = [];
  for (const ring of rings) {
    let prev = null;
    for (const [lon, lat] of ring) { const v = lonLatToVec3(lon, lat, r); if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z); prev = v; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
}

// Named continents by lon/lat box. Because the coastline data joins connected landmasses into
// single rings (the Americas; Afro-Eurasia), we CLIP coastlines to the box rather than assign
// whole rings — so South America / Africa / Europe get their real bodies, not just islands.
const CONTINENTS = [
  { name: 'North America', lon: [-170, -52], lat: [7, 72] },
  { name: 'South America', lon: [-82, -34], lat: [-56, 13] },
  { name: 'Europe', lon: [-12, 45], lat: [35, 72] },
  { name: 'Africa', lon: [-20, 52], lat: [-36, 38] },
  { name: 'Asia', lon: [45, 180], lat: [3, 78] },
  { name: 'Australia', lon: [112, 155], lat: [-45, -9] },
].map((c) => ({ ...c, center: [(c.lon[0] + c.lon[1]) / 2, (c.lat[0] + c.lat[1]) / 2] }));

// Coastline polylines with all vertices inside a continent's lon/lat box.
function clipRegion(box) {
  const [lo0, lo1] = box.lon, [la0, la1] = box.lat;
  const inb = (lo, la) => lo >= lo0 && lo <= lo1 && la >= la0 && la <= la1;
  const segs = [];
  for (const ring of WORLD) {
    let cur = null;
    for (const pt of ring) {
      if (inb(pt[0], pt[1])) { if (!cur) { cur = []; segs.push(cur); } cur.push(pt); }
      else cur = null;
    }
  }
  return segs.filter((s) => s.length >= 2);
}

// A dark grid globe with glowing continent coastlines + lat/long graticule + atmosphere rim.
// The globe spins (angle published via spinRef); the US is highlighted brighter and starts
// facing the popped-out panel.
function HoloGlobe({ radius = 52, accent = '#3f96ff', present, spinRef, onPick }) {
  const grp = useRef();
  useFrame((_, dt) => { const v = (spinRef.current || 0) + (dt || 0.016) * 0.06; spinRef.current = v; if (grp.current) grp.current.rotation.y = v; });
  const grid = useMemo(() => buildGraticule(radius * 0.999), [radius]);
  const world = useMemo(() => buildWorldLines(radius * 1.004, WORLD), [radius]);
  const usSeg = useMemo(() => buildWorldLines(radius * 1.012, NATION), [radius]);
  const baseQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(lonLatToVec3(-98, 39, 1).normalize(), present.clone().normalize()), [present]);
  return (
    <group>
      <group ref={grp}>
        <group quaternion={baseQuat.toArray()}>
          <mesh><sphereGeometry args={[radius, 48, 48]} /><meshStandardMaterial color="#05101d" emissive="#0a1e33" emissiveIntensity={0.5} metalness={0.2} roughness={0.9} /></mesh>
          <lineSegments geometry={grid}><lineBasicMaterial color={accent} transparent opacity={0.14} toneMapped={false} /></lineSegments>
          <lineSegments geometry={world}><lineBasicMaterial color="#46d6b6" transparent opacity={0.6} toneMapped={false} /></lineSegments>
          <lineSegments geometry={usSeg}><lineBasicMaterial color={accent} transparent opacity={0.98} toneMapped={false} /></lineSegments>
          {/* clickable continent hotspots (rotate with the globe) */}
          {CONTINENTS.map((c) => {
            const p = lonLatToVec3(c.center[0], c.center[1], radius * 1.03);
            return (
              <mesh key={c.name} position={p.toArray()}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
                onPointerOut={() => { document.body.style.cursor = 'auto'; }}
                onClick={(e) => { e.stopPropagation(); onPick && onPick(c.name); }}>
                <sphereGeometry args={[2.4, 16, 16]} />
                <meshBasicMaterial color="#ffd27a" transparent opacity={0.85} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      </group>
      {/* atmosphere rim glow */}
      <mesh><sphereGeometry args={[radius * 1.05, 48, 48]} /><meshBasicMaterial color="#2f7fff" transparent opacity={0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    </group>
  );
}

// Tether from a popped-out panel down to a region on the globe. The panel end (top) stays
// fixed; the globe end tracks the region as the globe rotates (dir = its post-orientation
// direction on the unit sphere; reads the shared spin angle).
function Tether({ spinRef, center, radius, dir, top, accent }) {
  const base = useMemo(() => dir.clone().normalize().multiplyScalar(radius * 1.02), [dir, radius]);
  const dot = useRef();
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)); return g; }, []);
  useFrame(() => {
    const th = spinRef.current || 0, c = Math.cos(th), s = Math.sin(th);
    const x = base.x * c + base.z * s, z = -base.x * s + base.z * c;
    const ax = center[0] + x, ay = center[1] + base.y, az = center[2] + z;
    const p = geo.attributes.position.array;
    p[0] = ax; p[1] = ay; p[2] = az; p[3] = top[0]; p[4] = top[1]; p[5] = top[2];
    geo.attributes.position.needsUpdate = true;
    if (dot.current) dot.current.position.set(ax, ay, az);
  });
  return (
    <>
      <line geometry={geo}><lineBasicMaterial color={accent} transparent opacity={0.8} toneMapped={false} /></line>
      <mesh ref={dot}><sphereGeometry args={[0.9, 16, 16]} /><meshBasicMaterial color={accent} toneMapped={false} /></mesh>
    </>
  );
}

// A popped-out continent: its coastline outline flattened onto a panel, with a "no facilities"
// banner — the same pop-out treatment as the US, minus the data.
function ContinentPanel({ continent, position, accent }) {
  const rings2d = useMemo(() => {
    const [clon, clat] = continent.center;
    const cos = Math.cos(clat * Math.PI / 180), K2 = 2.4;
    const raw = clipRegion(continent).map((r) => r.map(([lo, la]) => [(lo - clon) * K2 * cos, -(la - clat) * K2]));
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const r of raw) for (const [x, z] of r) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z; }
    const w = (maxx - minx) || 1, d = (maxz - minz) || 1, midx = (minx + maxx) / 2, midz = (minz + maxz) / 2, sc = Math.min(3.0, 74 / Math.max(w, d));
    return raw.map((r) => r.map(([x, z]) => [(x - midx) * sc, 0.1, (z - midz) * sc]));
  }, [continent]);
  return (
    <group position={position}>
      {rings2d.map((r, i) => <Line key={i} points={r} color={accent} lineWidth={2} transparent opacity={0.92} />)}
      <Html position={[0, 6, 0]} center distanceFactor={100} zIndexRange={[30, 0]}>
        <div className="px-3 py-1.5 rounded-md text-[12px] font-semibold whitespace-nowrap"
          style={{ background: 'rgba(8,12,20,.85)', color: accent, border: `1px solid ${accent}66`, boxShadow: `0 0 14px ${accent}44` }}>
          {continent.name} · <span style={{ opacity: 0.72, fontWeight: 400 }}>no facilities in this region</span>
        </div>
      </Html>
    </group>
  );
}

function SceneMap({ plants, theme, hovered, onHover, onEnter }) {
  // Build the 3D night map once: terrain heightfield clipped to the US, city lights,
  // draped neon borders, and a height sampler for placing markers on the terrain.
  const map = useMemo(() => {
    const poly = (NATION[0] || []).map(([lon, lat]) => { const [x, z] = project(lon, lat); return [x, z]; });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    poly.forEach(([x, z]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); });
    const w = maxX - minX + 8, d = maxZ - minZ + 8, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const simplex = new SimplexNoise(); const seaY = -1.6, HS = 3.6;
    const heightAt = (wx, wz) => {
      if (!pointInPoly(wx, wz, poly)) return seaY;
      const n = simplex.noise(wx * 0.02, wz * 0.02) * 0.5 + simplex.noise(wx * 0.055, wz * 0.055) * 0.3 + simplex.noise(wx * 0.14, wz * 0.14) * 0.2;
      return Math.max(0.06, (n + 0.5)) * HS;
    };
    // terrain
    const NX = 220, NZ = Math.round(NX * d / w);
    const geo = new THREE.PlaneGeometry(w, d, NX, NZ); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position; const cols = [], alphas = [];
    const cLow = new THREE.Color('#0c2b46'), cMid = new THREE.Color('#12463a'), cHi = new THREE.Color('#3f5238'), cPeak = new THREE.Color('#6b6f63');
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx, wz = pos.getZ(i) + cz; const h = heightAt(wx, wz); pos.setY(i, h);
      let c; if (h <= seaY + 0.01) c = cLow; else { const e = h / HS; c = e < 0.4 ? cMid.clone().lerp(cHi, e / 0.4) : cHi.clone().lerp(cPeak, (e - 0.4) / 0.6); }
      cols.push(c.r, c.g, c.b); alphas.push(h > seaY + 0.01 ? 1 : 0);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1)); geo.computeVertexNormals();
    // Discard the sea (outside-US) fragments so only the US land floats — the globe shows through.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.92, envMapIntensity: 0.4 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = aAlpha;');
      shader.fragmentShader = 'varying float vAlpha;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', '  if (vAlpha < 0.5) discard;\n#include <dithering_fragment>');
    };
    const terrain = new THREE.Mesh(geo, mat);
    terrain.position.set(cx, 0, cz); terrain.receiveShadow = true;
    // city lights
    const lp = [], lc = []; const warm = new THREE.Color('#ffe6b0'), cool = new THREE.Color('#bcd8ff');
    const addLight = (x, z) => { const c = warm.clone().lerp(cool, Math.random() * 0.5); const b = 0.6 + Math.random() * 0.7; lp.push(x, heightAt(x, z) + 0.28, z); lc.push(c.r * b, c.g * b, c.b * b); };
    CITY_METROS.forEach(([lon, lat, wt]) => { const [mx, mz] = project(lon, lat); const n = Math.round(wt * 16);
      for (let k = 0; k < n; k++) { const r = (Math.random() ** 1.6) * wt * 0.9, a = Math.random() * Math.PI * 2, x = mx + Math.cos(a) * r, z = mz + Math.sin(a) * r; if (pointInPoly(x, z, poly)) addLight(x, z); } });
    let tries = 0, added = 0; while (added < 650 && tries < 6000) { tries++; const x = minX + Math.random() * (maxX - minX), z = minZ + Math.random() * (maxZ - minZ); if (pointInPoly(x, z, poly)) { addLight(x, z); added++; } }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    const cityLights = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.6, map: GLOW_TEX, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
    // draped borders
    const drape = (ring, off) => ring.map(([lon, lat]) => { const [x, z] = project(lon, lat); return [x, heightAt(x, z) + off, z]; });
    const nationLine = drape(NATION[0], 0.25);
    const stateLines = STATES.map((r) => drape(r, 0.15));
    return { terrain, cityLights, nationLine, stateLines, heightAt };
  }, []);

  const sites = useMemo(() => plants.map((p) => {
    const geo = geoFor(p.name); const [x, z] = project(geo.lon, geo.lat);
    return { name: p.name, city: geo.city, status: worstOf(p.unitList), pos: [x, map.heightAt(x, z), z],
      assetCount: (p.unitList || []).reduce((s, u) => s + (u.assets || []).length, 0),
      critical: (p.unitList || []).reduce((s, u) => s + (u.assets || []).filter((a) => a.status === 'critical').length, 0) };
  }), [plants, map]);

  // Composition: the detailed US panel floats above a rotating grid globe, tethered to the US.
  const LIFT = 60, R = 52;
  const GC = [0, -34, -8];
  const present = useMemo(() => new THREE.Vector3(0, 0.95, 0.3), []);
  const spinRef = useRef(0);
  const sunColor = useMemo(() => new THREE.Color('#fff3d6').multiplyScalar(5), []); // HDR so bloom glows it
  const [popped, setPopped] = useState(null);
  const baseQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(lonLatToVec3(-98, 39, 1).normalize(), present.clone().normalize()), [present]);
  const pc = useMemo(() => CONTINENTS.find((c) => c.name === popped) || null, [popped]);
  const contDir = useMemo(() => (pc ? lonLatToVec3(pc.center[0], pc.center[1], 1).applyQuaternion(baseQuat).normalize() : null), [pc, baseQuat]);
  // North America == the original US facilities map; other continents show a bare outline.
  const showUS = !pc || pc.name === 'North America';

  return (
    <>
      <color attach="background" args={['#02040a']} />
      <fog attach="fog" args={['#02040a', 240, 680]} />
      <hemisphereLight intensity={0.05} groundColor={'#0a0f18'} color={'#33405a'} />
      <directionalLight position={[40, 120, 60]} intensity={0.28} color={'#5f79b8'} />
      <StarField count={2600} radius={520} full />
      {/* the sun — a bright HDR core; bloom turns it into a soft glow (no fake halo geometry) */}
      <mesh position={[150, 25, -185]}><sphereGeometry args={[16, 32, 32]} /><meshBasicMaterial color={sunColor} toneMapped={false} fog={false} /></mesh>
      <directionalLight position={[150, 120, 90]} intensity={0.9} color={'#fff2d6'} />

      {/* rotating hologram Earth */}
      <group position={GC}>
        <HoloGlobe radius={R} accent={theme.accent} present={present} spinRef={spinRef} onPick={(name) => setPopped((p) => (p === name ? null : name))} />
      </group>
      {/* One map at a time: the US facilities map (default / North America) OR a continent outline */}
      {showUS && (
        <>
          <Tether spinRef={spinRef} center={GC} radius={R} dir={present} top={[0, LIFT - 1, 0]} accent={theme.accent} />
          <group position={[0, LIFT, 0]}>
            <primitive object={map.terrain} />
            <CityLights points={map.cityLights} />
            <Line points={map.nationLine} color={theme.accent} lineWidth={2.4} transparent opacity={0.95} />
            {map.stateLines.map((pts, i) => <Line key={i} points={pts} color="#1f6f9c" lineWidth={1.1} transparent opacity={0.5} />)}
            {sites.map((s) => <MapMarker key={s.name} site={s} theme={theme} hovered={hovered} onHover={onHover} onEnter={onEnter} />)}
          </group>
        </>
      )}
      {pc && !showUS && contDir && (
        <>
          <ContinentPanel continent={pc} position={[0, LIFT, 0]} accent={theme.accent} />
          <Tether spinRef={spinRef} center={GC} radius={R} dir={contDir} top={[0, LIFT - 1, 0]} accent={theme.accent} />
        </>
      )}

      <CameraRig mode="sites" />
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.0} luminanceSmoothing={0.2} />
      </EffectComposer>
    </>
  );
}

// A tall area-light pole with a warm sodium-vapor lamp — sells the dusk/industrial mood.
function Lamp({ x, z, h = 15, color = '#ffd39a' }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.13, 0.2, h, 8]} /><meshStandardMaterial color="#39414f" metalness={0.6} roughness={0.5} /></mesh>
      {/* fixture housing (shade) */}
      <mesh position={[0, h + 0.18, 0]}><cylinderGeometry args={[0.55, 0.32, 0.42, 14]} /><meshStandardMaterial color="#232932" metalness={0.6} roughness={0.5} /></mesh>
      {/* small bright emitter — the soft halo comes from post-process bloom, not fake spheres */}
      <mesh position={[0, h - 0.05, 0]}><sphereGeometry args={[0.24, 16, 16]} /><meshBasicMaterial color={'#fff0cf'} toneMapped={false} /></mesh>
      <pointLight position={[0, h - 0.3, 0]} color={color} intensity={3.8} distance={56} decay={2} />
    </group>
  );
}

// Per-unit plant architecture: a tall boiler house + stack, an elevated turbine deck with the
// condenser slung beneath it, and an open turbine-hall canopy. Placed around the (already laid
// out) equipment so the boiler reads multi-story and the TG train sits on a real deck.
function UnitStructures({ s }) {
  const { z, boilerX, turbineX, generatorX } = s;
  const frame = '#3b4652', clad = '#333d4a';
  const deckMidX = (turbineX + generatorX) / 2;
  const deckW = Math.abs(generatorX - turbineX) + 12;
  const colH = DECK_Y - 0.6;
  return (
    <group>
      {/* ---- Boiler house: open steel framework, boiler drum + stack ---- */}
      <group position={[boilerX, 0, z]}>
        {/* corner columns */}
        {[[-4, -4], [4, -4], [-4, 4], [4, 4]].map(([dx, dz], i) => (
          <mesh key={`c${i}`} position={[dx, 10, dz]}><boxGeometry args={[0.5, 20, 0.5]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.5} /></mesh>
        ))}
        {/* horizontal ring girders at 4 floors */}
        {[4, 9, 14, 19].map((y, i) => (
          <group key={`r${i}`} position={[0, y, 0]}>
            <mesh position={[0, 0, -4]}><boxGeometry args={[8.3, 0.3, 0.3]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.5} /></mesh>
            <mesh position={[0, 0, 4]}><boxGeometry args={[8.3, 0.3, 0.3]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.5} /></mesh>
            <mesh position={[-4, 0, 0]}><boxGeometry args={[0.3, 0.3, 8.3]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.5} /></mesh>
            <mesh position={[4, 0, 0]}><boxGeometry args={[0.3, 0.3, 8.3]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.5} /></mesh>
          </group>
        ))}
        {/* thin cladding on the back + far side only, so the interior stays visible */}
        <mesh position={[0, 11, -4]}><boxGeometry args={[8, 18, 0.15]} /><meshStandardMaterial color={clad} metalness={0.5} roughness={0.6} /></mesh>
        <mesh position={[-4, 11, 0]}><boxGeometry args={[0.15, 18, 8]} /><meshStandardMaterial color={clad} metalness={0.5} roughness={0.6} /></mesh>
        <mesh position={[0, 20.2, 0]}><boxGeometry args={[8.7, 0.4, 8.7]} /><meshStandardMaterial color="#242b34" metalness={0.5} roughness={0.6} /></mesh>
        {/* steam drum high in the structure — reads as an actual boiler */}
        <mesh position={[0, 16.5, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[1.6, 1.6, 6, 18]} /><meshStandardMaterial color="#4a5460" metalness={0.55} roughness={0.45} /></mesh>
        {/* downcomer / riser tubes */}
        {[-1.4, 0, 1.4].map((dx, i) => (
          <mesh key={`t${i}`} position={[dx, 9, -1.2]}><cylinderGeometry args={[0.16, 0.16, 14, 8]} /><meshStandardMaterial color="#39424d" metalness={0.5} roughness={0.5} /></mesh>
        ))}
        {/* subtle furnace ember at the base (warm light, not a fake orange panel) */}
        <pointLight position={[0, 2, 0]} color={'#ff7a2a'} intensity={1.6} distance={13} decay={2} />
        {/* stack */}
        <mesh position={[3.4, 24, -2.4]}><cylinderGeometry args={[0.85, 1.1, 20, 16]} /><meshStandardMaterial color="#3a3f47" metalness={0.5} roughness={0.6} /></mesh>
        <mesh position={[3.4, 34.2, -2.4]}><cylinderGeometry args={[0.92, 0.92, 0.7, 16]} /><meshStandardMaterial color="#e0553a" emissive="#e0553a" emissiveIntensity={0.55} toneMapped={false} /></mesh>
      </group>

      {/* ---- Turbine deck + condenser (hung below the deck) ---- */}
      <group position={[deckMidX, 0, z]}>
        <mesh position={[0, DECK_Y - 0.3, 0]} receiveShadow castShadow><boxGeometry args={[deckW, 0.6, 12]} /><meshStandardMaterial color="#4a5460" metalness={0.3} roughness={0.75} /></mesh>
        {[-deckW / 2 + 1.5, -deckW / 6, deckW / 6, deckW / 2 - 1.5].map((dx, i) => [-4.6, 4.6].map((dz, j) => (
          <mesh key={`${i}-${j}`} position={[dx, colH / 2, dz]}><boxGeometry args={[0.5, colH, 0.5]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.55} /></mesh>
        )))}
        {/* condenser slung beneath the turbine end */}
        <group position={[turbineX - deckMidX, 0, 0]}>
          <mesh position={[0, (DECK_Y - 0.8) / 2, 0]}><boxGeometry args={[7, DECK_Y - 0.8, 7]} /><meshStandardMaterial color="#37454f" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, (DECK_Y - 0.8) / 2, 3.6]}><planeGeometry args={[6, 1.6]} /><meshBasicMaterial color="#2ac0d0" toneMapped={false} transparent opacity={0.32} /></mesh>
        </group>
      </group>

      {/* ---- Turbine-hall canopy (open sides so the TG train stays visible) ---- */}
      <group position={[deckMidX, 0, z]}>
        {[[-deckW / 2, -6], [deckW / 2, -6], [-deckW / 2, 6], [deckW / 2, 6]].map(([dx, dz], i) => (
          <mesh key={i} position={[dx, DECK_Y + 6, dz]}><boxGeometry args={[0.45, 12, 0.45]} /><meshStandardMaterial color={frame} metalness={0.7} roughness={0.55} /></mesh>
        ))}
        <mesh position={[0, DECK_Y + 12.1, 0]}><boxGeometry args={[deckW + 1, 0.4, 13]} /><meshStandardMaterial color="#20272f" metalness={0.5} roughness={0.6} /></mesh>
      </group>

      {/* overhead floods illuminating the whole unit */}
      <pointLight position={[boilerX, 34, z]} intensity={4.2} distance={120} decay={2} color={'#fff1d8'} />
      <pointLight position={[(turbineX + generatorX) / 2, 30, z]} intensity={3.6} distance={110} decay={2} color={'#fff1d8'} />
      <Lamp x={boilerX - 12} z={z - 9} />
      <Lamp x={generatorX + 8} z={z + 9} />
      <Lamp x={boilerX - 12} z={z + 9} />
    </group>
  );
}

// A points-based star field on a high dome — constant-size white dots, fog-disabled so they
// stay crisp pinpoints (no fake glowing spheres).
function StarField({ count = 1600, radius = 450, full = false }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const cosLo = full ? -1 : -0.12; // full sphere for space, else a horizon-down dome
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(cosLo, 1, Math.random()));
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = radius * Math.cos(phi);
      pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [count, radius, full]);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#e6edff" size={1.5} sizeAttenuation={false} fog={false} transparent opacity={0.9} toneMapped={false} />
    </points>
  );
}

// Procedural moon surface (canvas): pale base with soft dark maria + craters. Used as both the
// color map and the emissive map so craters read as darker spots within the glow.
function makeMoonTexture() {
  const size = 256;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9edfb'; ctx.fillRect(0, 0, size, size);
  const blob = (x, y, r, shade, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${shade},${shade},${shade + 8},${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  };
  for (let i = 0; i < 6; i++) blob(Math.random() * size, Math.random() * size, 30 + Math.random() * 45, 120 + Math.random() * 26, 0.36); // maria
  for (let i = 0; i < 38; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 13;
    blob(x, y, r, 84 + Math.random() * 40, 0.62); // crater floor
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, 7); ctx.stroke(); // subtle rim
  }
  return new THREE.CanvasTexture(c);
}

// Procedural asphalt texture (canvas): dark base + aggregate speckle, tiled across the ground.
// Self-contained — no external image assets to load.
function makeAsphaltTexture() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#34383d'; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 40;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < 1600; k++) {
    const g = 150 + Math.random() * 60;
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${Math.random() * 0.07})`;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 1.7, 0, 7); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26); tex.anisotropy = 8;
  return tex;
}

function SceneInterior({ plant, theme, selected, onSelect, values }) {
  const t = theme.three;
  const { rows, connectors, labels, pads, structures } = useMemo(() => interiorLayout(plant), [plant]);
  const asphalt = useMemo(() => makeAsphaltTexture(), []);
  const moonTex = useMemo(() => makeMoonTexture(), []);
  const [hovered, setHovered] = useState(null);
  const focus = useMemo(() => rows.find((r) => r.id === selected)?.pos || null, [selected, rows]);
  return (
    <>
      <color attach="background" args={['#0a1120']} />
      <fog attach="fog" args={['#0e1524', 110, 520]} />
      <ambientLight intensity={0.5} color={'#dfeaff'} />
      <hemisphereLight intensity={0.7} color={'#cfe0ff'} groundColor={'#141b26'} />
      {/* strong overhead key light illuminating the whole plant, cool fill from behind */}
      <directionalLight position={[0, 100, 40]} intensity={1.5} color={'#fff3e2'} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} shadow-bias={-0.0002} />
      <directionalLight position={[-40, 45, -25]} intensity={0.55} color={'#9db8ff'} />
      <SafeEnvironment preset="night" intensity={0.6} />
      {/* moon low in the night sky — soft halo comes from bloom, plus a gentle moonlight fill */}
      <group position={[-165, 72, -160]}>
        <mesh><sphereGeometry args={[16, 40, 40]} /><meshStandardMaterial map={moonTex} emissiveMap={moonTex} color={'#c9d4ef'} emissive={'#dbe4ff'} emissiveIntensity={1.9} toneMapped={false} /></mesh>
        <pointLight color={'#aebbe6'} intensity={0.4} distance={0} decay={0} />
      </group>
      <StarField />
      {/* textured asphalt ground (replaces the grassy terrain) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial map={asphalt} color="#83878e" metalness={0.08} roughness={0.94} />
      </mesh>
      {/* concrete pad per unit */}
      {pads.map((p) => {
        const w = p.x1 - p.x0, cx = (p.x0 + p.x1) / 2;
        return (
          <group key={p.id} position={[cx, 0, p.z]}>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow><planeGeometry args={[w, 22]} /><meshStandardMaterial color="#2e343d" metalness={0.15} roughness={0.9} /></mesh>
          </group>
        );
      })}

      {/* plant architecture: boiler house, turbine deck + condenser, hall canopy, area lights */}
      {structures.map((s) => <UnitStructures key={s.unit} s={s} />)}

      {connectors.map((c) => <Connector key={c.id} from={c.from} to={c.to} kind={c.kind} ghost={c.ghost} />)}
      {labels.map((l) => (
        <Html key={l.id} position={l.pos} center distanceFactor={l.unit ? 34 : 22} zIndexRange={[15, 0]}>
          {l.unit
            ? <div className="px-2 py-0.5 rounded text-[11px] font-bold tracking-widest uppercase" style={{ background: 'rgba(8,12,20,.72)', color: statusOf(l.status).color, border: `1px solid ${statusOf(l.status).color}55` }}>{l.text}</div>
            : <div className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(8,12,20,.7)', color: l.ghost ? '#6b7789' : '#8ea3bd', border: '1px solid rgba(255,255,255,.08)', opacity: l.ghost ? 0.7 : 1 }}>{l.text}</div>}
        </Html>
      ))}
      {rows.map((n) => <InteriorAsset key={n.id} node={n} theme={theme} selected={selected} hovered={hovered} onSelect={onSelect} onHover={setHovered} values={values} />)}

      <ContactShadows position={[0, 0.05, 0]} opacity={0.5} scale={220} blur={2.4} far={36} />
      <CameraRig mode="interior" focus={focus} />
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.95} luminanceThreshold={0.5} luminanceSmoothing={0.28} />
        <Vignette eskil={false} offset={0.25} darkness={0.4} />
      </EffectComposer>
    </>
  );
}

export function Facility({ model, theme, selected, onSelect, activePlant, onEnterPlant, values }) {
  const [hovered, setHovered] = useState(null);
  const plant = useMemo(() => (model?.plants || []).find((p) => p.name === activePlant) || null, [model, activePlant]);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 150, 118], fov: 40 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = 1.0; }}>
      {plant
        ? <SceneInterior plant={plant} theme={theme} selected={selected} onSelect={onSelect} values={values} />
        : <SceneMap plants={model?.plants || []} theme={theme} hovered={hovered} onHover={setHovered} onEnter={onEnterPlant} />}
    </Canvas>
  );
}
