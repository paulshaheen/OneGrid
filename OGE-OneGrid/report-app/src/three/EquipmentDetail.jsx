import { useMemo, useState, useRef, useEffect, Suspense, Component } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html, Environment, Line } from '@react-three/drei';
import { EffectComposer, Bloom, N8AO } from '@react-three/postprocessing';
import { AnimatePresence, motion } from 'framer-motion';
import { EquipmentGeometry, anchorsFor, equipmentType, viewFor } from './Equipment.jsx';
import { statusOf, fmt } from '../lib/format.js';
import { getJson } from '../lib/api.js';

class SafeB extends Component { constructor(p){super(p);this.state={f:false};} static getDerivedStateFromError(){return {f:true};} componentDidCatch(){} render(){return this.state.f?null:this.props.children;} }

// 24h trend sparkline for a tag, fetched from the Eventhouse; the current live value
// is appended so the line stays anchored to what the model is showing right now.
function TagTrend({ tag, units, live, color, theme }) {
  const [pts, setPts] = useState(null);
  useEffect(() => {
    let alive = true; setPts(null);
    if (!tag) return;
    getJson(`/api/tag-trend?tag=${encodeURIComponent(tag)}&hours=24&bin=15`)
      .then((rows) => { if (alive) setPts((rows || []).filter((r) => r.v != null)); })
      .catch(() => { if (alive) setPts([]); });
    return () => { alive = false; };
  }, [tag]);
  const data = useMemo(() => {
    const base = pts ? pts.map((r) => Number(r.v)) : [];
    if (live != null && base.length) return [...base, Number(live)];
    return base;
  }, [pts, live]);
  if (pts === null) return <div className={`text-[11px] ${theme.sub} py-3 text-center`}>Loading 24h trend…</div>;
  if (!data.length) return <div className={`text-[11px] ${theme.sub} py-3 text-center`}>No trend history for this tag.</div>;
  const W = 288, H = 74, pad = 4;
  const min = Math.min(...data), max = Math.max(...data), span = (max - min) || Math.abs(max) * 0.02 || 1;
  const x = (i) => pad + (i / Math.max(1, data.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${line} ${(W - pad).toFixed(1)},${H - pad}`;
  const gid = `tg-${Math.abs(hashCode(tag))}`;
  const maxIdx = data.indexOf(max), minIdx = data.indexOf(min), lastIdx = data.length - 1;
  const lastV = data[lastIdx];
  // label positions as % of the box so HTML overlays aren't distorted by the stretched SVG
  const posPct = (i, v) => ({ left: `${(x(i) / W) * 100}%`, top: `${(y(v) / H) * 100}%` });
  const Marker = ({ i, v, place }) => (
    <div className="absolute -translate-x-1/2 pointer-events-none" style={{ ...posPct(i, v) }}>
      <div className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ background: color }} />
      <div className="absolute text-[9px] font-bold tabular-nums px-1 py-[1px] rounded whitespace-nowrap -translate-x-1/2"
        style={{ top: place === 'below' ? 6 : -15, background: 'rgba(10,16,26,.85)', color: '#eaf1f8', border: `1px solid ${color}55` }}>{fmt(v, 1)}</div>
    </div>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${theme.sub}`}>24-hour trend</span>
        <span className="text-[10px] tabular-nums font-semibold" style={{ color }}>{fmt(lastV, 1)} {units || ''}</span>
      </div>
      <div className="relative" style={{ paddingTop: 16, paddingBottom: 8 }}>
        <div className="relative" style={{ height: H }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={area} fill={`url(#${gid})`} />
            <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          {/* HTML value labels overlaid (undistorted): max, min, current */}
          <Marker i={maxIdx} v={max} place="above" />
          {minIdx !== maxIdx && <Marker i={minIdx} v={min} place="below" />}
          {lastIdx !== maxIdx && lastIdx !== minIdx && <Marker i={lastIdx} v={lastV} place="above" />}
        </div>
      </div>
      <div className={`flex justify-between text-[9px] ${theme.sub}`}><span>-24h</span><span>-12h</span><span>now</span></div>
    </div>
  );
}
function hashCode(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return h; }

const ALERT = { critical: { color: '#ff5470', glow: 'rgba(255,84,112,.6)' }, watch: { color: '#ffcc4d', glow: 'rgba(255,204,77,.5)' }, ok: { color: '#35d69a', glow: 'rgba(53,214,154,.45)' }, pending: { color: '#7f93ac', glow: 'rgba(127,147,172,.0)' } };

function matchAnchor(anchors, text) {
  const hay = (text || '').toLowerCase();
  let best = null, score = 0;
  for (const a of anchors) {
    const words = (a.hint || '').split('|').filter(Boolean);
    const sc = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (sc > score) { score = sc; best = a; }
  }
  return best;
}

// Assign each anchor a tag + an alert level from root_cause (critical, readable) + anomalies.
function buildAnchors(type, tags = [], anomalies = [], rootCause = []) {
  const anchors = anchorsFor(type);
  const pool = [...tags]; const used = new Set();
  const pickTag = (hint) => {
    const words = (hint || '').split('|').filter(Boolean);
    let idx = -1;
    for (let i = 0; i < pool.length; i++) { if (used.has(i)) continue; const hay = `${pool[i].desc || ''} ${pool[i].tag || ''}`.toLowerCase(); if (words.some((w) => hay.includes(w))) { idx = i; break; } }
    if (idx < 0) for (let i = 0; i < pool.length; i++) if (!used.has(i)) { idx = i; break; }
    if (idx >= 0) { used.add(idx); return pool[idx]; }
    return null;
  };
  const en = anchors.map((a) => ({ ...a, tag: pickTag(a.hint), level: 'ok', root: null, anoms: [] }));
  const byId = Object.fromEntries(en.map((a) => [a.id, a]));
  for (const rc of rootCause) {
    const a = matchAnchor(en, `${rc.descriptor || ''} ${rc.tag || ''} ${rc.failure_mechanism || ''} ${rc.contributing_tag_names || ''}`) || en[0];
    if (!a) continue; const e = byId[a.id];
    if (!e.root || /crit/i.test(rc.priority)) e.root = rc;
    e.level = /crit/i.test(rc.priority) ? 'critical' : (e.level === 'critical' ? 'critical' : 'watch');
  }
  for (const an of anomalies) {
    const a = matchAnchor(en, `${an.advisory_message || ''}`);
    if (!a) continue; const e = byId[a.id]; e.anoms.push(an);
    const crit = /crit|high/i.test(an.severity || '') || Number(an.peak_abs_z) >= 6;
    if (crit && e.level !== 'critical') e.level = 'critical'; else if (e.level === 'ok') e.level = 'watch';
  }
  return en;
}

function HotZone({ level, active }) {
  const ref = useRef();
  const a = ALERT[level] || ALERT.ok;
  useFrame((st) => { if (ref.current) { const p = 1 + Math.sin(st.clock.elapsedTime * 2.4) * 0.12; ref.current.scale.setScalar((active ? 1.25 : 1) * p); } });
  if (level === 'ok' || level === 'pending') return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[level === 'critical' ? 1.4 : 1.0, 24, 24]} />
      <meshBasicMaterial color={a.color} transparent opacity={level === 'critical' ? 0.22 : 0.13} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function Hotspot({ anchor, theme, value, active, hideLabel = false, labelPos, onClick }) {
  const lvl = anchor.level || 'ok';
  const a = ALERT[lvl];
  const hasAlert = lvl !== 'ok';
  // label sits at labelPos (spread out); leader line connects it back to the component.
  const off = labelPos ? [labelPos[0] - anchor.pos[0], labelPos[1] - anchor.pos[1], labelPos[2] - anchor.pos[2]] : [0, 0.42, 0];
  return (
    <group position={anchor.pos}>
      <HotZone level={lvl} active={active} />
      <mesh onClick={(e) => { e.stopPropagation(); onClick(anchor); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => (document.body.style.cursor = 'auto')}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshBasicMaterial color={active ? a.color : '#eef4fb'} toneMapped={false} />
      </mesh>
      <mesh><ringGeometry args={[0.24, 0.3, 24]} /><meshBasicMaterial color={a.color} transparent opacity={active ? 1 : 0.65} toneMapped={false} /></mesh>
      {!hideLabel && labelPos && (
        <Line points={[[0, 0, 0], off]} color={a.color} lineWidth={active ? 2 : 1.2} transparent opacity={active ? 0.95 : 0.55} toneMapped={false} />
      )}
      {!hideLabel && (
      <Html position={off} center zIndexRange={[30, 0]} style={{ pointerEvents: 'auto' }}>
        <button onClick={() => onClick(anchor)}
          className="px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition hover:scale-105"
          style={{ background: active ? a.color : 'rgba(12,17,26,.94)', color: active ? '#0a0f14' : '#eaf1f8', border: `1px solid ${active ? a.color : a.color + '88'}`, boxShadow: '0 1px 3px rgba(0,0,0,.45)' }}>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? '#0a0f14' : a.color }} />
            <span className="opacity-90">{anchor.label}</span>
          </div>
          <div className="text-[13px] font-bold tabular-nums">{value != null ? fmt(value, 1) : '—'}{anchor.tag?.units ? ` ${anchor.tag.units}` : ''}</div>
        </button>
      </Html>
      )}
    </group>
  );
}

function Model({ asset, theme, anchors, active, onPick, snapshot }) {
  const g = useRef();
  const type = equipmentType(asset);
  const s = statusOf(asset?.status);
  useFrame((st) => { if (g.current) g.current.rotation.y = -0.28 + Math.sin(st.clock.elapsedTime * 0.34) * 0.22; });
  // Lay labels out in two side columns (left/right of the model) so they never overlap;
  // each connects back to its component with a leader line. Classic exploded-callout look.
  const labelPos = useMemo(() => {
    const xs = anchors.map((a) => a.pos[0]), ys = anchors.map((a) => a.pos[1]), zs = anchors.map((a) => a.pos[2]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), topY = Math.max(...ys), frontZ = Math.max(...zs, 0);
    const out = {};
    const sortedByX = [...anchors].sort((p, q) => p.pos[0] - q.pos[0]);
    const mid = Math.ceil(sortedByX.length / 2);
    const cols = [
      { list: sortedByX.slice(0, mid), x: minX - 3.4 },   // left column (lower-X components)
      { list: sortedByX.slice(mid), x: maxX + 3.4 },      // right column
    ];
    const yHi = topY + 1.4, yLo = 0.8;
    for (const col of cols) {
      const m = col.list.length;
      const byY = [...col.list].sort((p, q) => q.pos[1] - p.pos[1]); // high -> low, reduces line crossing
      byY.forEach((a, k) => { const t = m > 1 ? k / (m - 1) : 0.5; out[a.id] = [col.x, yHi - (yHi - yLo) * t, frontZ + 0.8]; });
    }
    return out;
  }, [anchors]);
  return (
    <group ref={g}>
      <EquipmentGeometry type={type} accent={s.color} running detail />
      {anchors.map((a) => {
        const t = a.tag?.tag; const v = t ? snapshot[t]?.value : null;
        return <Hotspot key={a.id} anchor={a} theme={theme} value={v} active={active === a.id} labelPos={labelPos[a.id]}
          hideLabel={active != null} onClick={(an) => onPick(an)} />;
      })}
    </group>
  );
}

export function EquipmentDetail({ asset, theme, snapshot = {}, anomalies = [], rootCause = [], loading = false }) {
  const [active, setActive] = useState(null);
  const type = equipmentType(asset);
  const rawAnchors = useMemo(() => buildAnchors(type, asset?.tags || [], anomalies, rootCause), [type, asset, anomalies, rootCause]);
  // While intelligence is still loading, show neutral (grey) markers instead of
  // defaulting every zone to green — otherwise it misleadingly reads "all healthy".
  const anchors = loading ? rawAnchors.map((a) => ({ ...a, level: 'pending' })) : rawAnchors;
  const t = theme.three;
  const view = viewFor(type);
  // pull the camera back a touch so the side-column labels + leader lines fit in frame
  const camPos = useMemo(() => view.position.map((c) => c * 1.16), [view]);
  const s = statusOf(asset?.status);
  const sel = anchors.find((a) => a.id === active);
  const critCount = anchors.filter((a) => a.level === 'critical').length;
  const watchCount = anchors.filter((a) => a.level === 'watch').length;
  const okCount = anchors.filter((a) => a.level === 'ok').length;

  return (
    <div className="relative w-full h-full overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 50% 18%, #243347 0%, #16202f 42%, #0c1420 72%, #070b12 100%)' }}>
      {/* subtle grid floor vibe */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 40% at 50% 92%, rgba(120,150,200,.10), transparent 70%)' }} />
      <Canvas shadows dpr={[1, 2]} camera={{ position: camPos, fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = 0.95; }}>
        <hemisphereLight intensity={0.9} groundColor={'#141c2b'} color={'#eaf1ff'} />
        <directionalLight position={[9, 16, 8]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} />
        <directionalLight position={[-10, 8, -6]} intensity={0.9} color={'#9db8ff'} />
        {/* dramatic accent rim keyed to health status */}
        <spotLight position={[-6, 9, 10]} angle={0.6} penumbra={0.8} intensity={1.4} color={s.color} distance={44} />
        <pointLight position={[8, 3, -8]} intensity={0.7} color={'#3f96ff'} />
        <SafeB><Suspense fallback={null}><Environment preset={'sunset'} environmentIntensity={1.1} /></Suspense></SafeB>
        <Model asset={asset} theme={theme} anchors={anchors} active={active} snapshot={snapshot}
          onPick={(a) => setActive((cur) => (cur === a.id ? null : a.id))} />
        <ContactShadows position={[0, 0.02, 0]} opacity={0.7} scale={30} blur={2.6} far={16} color={'#020509'} />
        <OrbitControls target={view.target} enablePan={false} minDistance={view.minD} maxDistance={view.maxD}
          maxPolarAngle={Math.PI / 2.05} enableDamping dampingFactor={0.08} />
        <EffectComposer disableNormalPass>
          <N8AO halfRes aoRadius={1.6} intensity={2.4} distanceFalloff={1.0} color="#05070c" />
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.66} />
        </EffectComposer>
      </Canvas>

      <div className="absolute top-3 left-3 flex items-center gap-3 px-3 py-1.5 rounded-lg text-[11px] font-medium"
        style={{ background: 'rgba(10,16,26,.72)', border: '1px solid rgba(255,255,255,.10)', color: '#dbe6f5', backdropFilter: 'blur(6px)' }}>
        {loading ? (
          <span className="inline-flex items-center gap-2" style={{ color: '#9fb3ca' }}>
            <span className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
            Analyzing sensor data…
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#ff5470' }} />Critical {critCount}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#ffcc4d' }} />Watch {watchCount}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#35d69a' }} />Healthy {okCount}</span>
            <span style={{ color: '#8ea3bd' }}>click a zone for detail</span>
          </>
        )}
      </div>
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md text-[10px] tracking-wide uppercase"
        style={{ background: 'rgba(10,16,26,.6)', border: '1px solid rgba(255,255,255,.08)', color: '#8ea3bd' }}>drag to orbit · scroll to zoom</div>

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
            style={{ background: 'radial-gradient(60% 50% at 50% 45%, rgba(8,13,22,.55), rgba(8,13,22,.15))' }}>
            <div className="w-9 h-9 rounded-full border-2 border-white/15 border-t-white/70 animate-spin" />
            <div className="mt-3 text-[12px] font-medium" style={{ color: '#cfe0f2' }}>Loading sensor intelligence…</div>
            <div className="mt-0.5 text-[10px]" style={{ color: '#7f93ac' }}>querying live tags &amp; root-cause</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sel && (
          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
            className={`absolute top-3 right-3 bottom-3 w-[320px] max-w-[85%] z-50 ${theme.modal} overflow-hidden flex flex-col`}>
            <div className="p-3 border-b border-white/10 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: (ALERT[sel.level] || ALERT.ok).color }} /><h4 className={`font-bold text-sm ${theme.heading}`}>{sel.label}</h4></div>
                {sel.tag && <div className={`text-[11px] mt-0.5 ${theme.sub}`}>{sel.tag.desc || sel.tag.tag}</div>}
              </div>
              <button onClick={() => setActive(null)} className={`text-xl leading-none ${theme.sub} hover:opacity-70`}>×</button>
            </div>
            <div className="p-3 overflow-y-auto text-sm space-y-3">
              {sel.tag && (
                <div className={`p-2.5 rounded-lg ${theme.panelSolid} flex items-center justify-between`}>
                  <span className={`text-xs ${theme.sub}`}>Current value</span>
                  <span className={`text-lg font-bold tabular-nums ${theme.heading}`}>{snapshot[sel.tag.tag]?.value != null ? fmt(snapshot[sel.tag.tag].value, 2) : '—'} {sel.tag.units || ''}</span>
                </div>
              )}
              {sel.root ? (
                <div className={`p-3 rounded-lg ${theme.panelSolid}`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${theme.heading}`}>{sel.root.failure_mechanism || 'Root cause'}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: '#ff547022', color: '#ff5470' }}>{sel.root.priority}</span>
                  </div>
                  {sel.root.root_cause && <p className={`text-xs mt-2 leading-relaxed ${theme.sub}`}>{sel.root.root_cause}</p>}
                  {sel.root.recommended_action && <div className="mt-2 text-xs flex gap-1.5"><span style={{ color: theme.accent }}>▸</span><span className={theme.heading}><b>Action:</b> {sel.root.recommended_action}</span></div>}
                  {sel.root.confidence != null && <div className={`mt-2 text-[11px] ${theme.sub}`}>Confidence {Math.round(Number(sel.root.confidence) * 100)}%</div>}
                </div>
              ) : sel.anoms.length ? (
                <div className={`p-3 rounded-lg ${theme.panelSolid}`}>
                  <div className={`font-semibold ${theme.heading}`}>Anomaly detected</div>
                  <p className={`text-xs mt-1.5 ${theme.sub}`}>{sel.anoms[0].advisory_message}</p>
                  <div className={`text-[11px] mt-2 ${theme.sub}`}>Peak z {fmt(sel.anoms[0].peak_abs_z, 1)} · {sel.anoms[0].severity}</div>
                </div>
              ) : <div className={`text-xs ${theme.sub}`}>No active root-cause finding for this area — monitoring.</div>}

              {sel.tag && (
                <div className={`p-3 rounded-lg ${theme.panelSolid}`}>
                  <TagTrend tag={sel.tag.tag} units={sel.tag.units} live={snapshot[sel.tag.tag]?.value}
                    color={(ALERT[sel.level] || ALERT.ok).color} theme={theme} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
