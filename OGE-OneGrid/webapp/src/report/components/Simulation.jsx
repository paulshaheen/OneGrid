import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, ContactShadows } from '@react-three/drei';
import { EquipmentGeometry, anchorsFor, viewFor, equipmentType } from '../three/Equipment.jsx';
import { Feedback } from './Feedback.jsx';

const HORIZON = 14; // days into the future
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));
const sevColor = (s) => (s === 'critical' ? '#ff5470' : s === 'high' ? '#ff8c42' : '#ffcc4d');
const cleanDesc = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const HZ_DAYS = { '4h': 4 / 24, '8h': 8 / 24, '12h': 0.5, '24h': 1, '48h': 2, '72h': 3, '7d': 7, '14d': 14 };

// Deterministic per-(tag, hour) noise so the forecast is stable across renders/scrubs.
function noiseAt(tag, t) {
  const key = tag + '|' + Math.round(t * 24);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (((h >>> 0) % 10000) / 10000) - 0.5; // -0.5..0.5
}

// Map a degrading sensor to the nearest physical zone on the 3D model via anchor hints.
function anchorForSensor(anchors, desc, tag) {
  const hay = `${desc || ''} ${tag || ''}`.toLowerCase();
  let best = null, score = 0;
  for (const a of anchors) {
    const words = (a.hint || '').split('|').filter(Boolean);
    let sc = 0; for (const w of words) if (w && hay.includes(w)) sc++;
    if (sc > score) { score = sc; best = a; }
  }
  return best;
}

// Build the forward simulation from the asset's real short-term stop model + long-term
// survival + the top degrading signals (watchlist / anomalies), grounded in physical ranges.
function buildSim(asset, detail) {
  const type = equipmentType(asset);
  const anchors = anchorsFor(type);
  const predL = detail?.predLong || [];
  const survVals = predL.map((r) => num(r.survival_probability_14d)).filter((v) => v != null);
  const surv7Vals = predL.map((r) => num(r.survival_probability_7d)).filter((v) => v != null);
  const fb = asset.status === 'critical' ? 0.5 : asset.status === 'watch' ? 0.82 : 0.97;
  const surv14 = clamp(survVals.length ? Math.min(...survVals) : fb, 0.02, 0.999);
  const surv7 = clamp(surv7Vals.length ? Math.min(...surv7Vals) : Math.sqrt(surv14), 0.02, 0.999);
  const risk = predL.length ? clamp(Math.max(...predL.map((r) => num(r.risk_score) || 0)), 0, 1) : 0;

  // ---- short-term STOP model (the real near-term breakdown signal) ----
  const shortRows = detail?.predShort || [];
  const latestByHz = {};
  for (const r of shortRows) {
    const hz = String(r.prediction_horizon || '').toLowerCase();
    const ts = r.scoring_timestamp || r.scored_at || '';
    if (!latestByHz[hz] || ts > latestByHz[hz]._ts) latestByHz[hz] = { ...r, _ts: ts };
  }
  const stops = Object.values(latestByHz).map((r) => ({
    hz: String(r.prediction_horizon || '').toLowerCase(),
    p: clamp(num(r.stop_probability) || 0, 0, 1),
    alert: String(r.alert_level || '').toLowerCase(),
  }));
  const pStop = stops.length ? Math.max(...stops.map((s) => s.p)) : (1 - surv14) * 0.6;
  const alertRank = { critical: 3, high: 2, medium: 1, normal: 0, '': 0 };
  const alertName = stops.reduce((best, s) => (alertRank[s.alert] > alertRank[best] ? s.alert : best), '');
  const alertSev = alertName === 'critical' ? 'critical' : alertName === 'high' ? 'high' : alertName === 'medium' ? 'high' : 'watch';

  // Long-term hazard (per day) from 14d survival.
  const hLong = Math.max(-Math.log(surv14) / HORIZON, 1e-4);

  // A breakdown is expected if the stop model is elevated, the asset is unhealthy, or
  // survival is materially degraded. Otherwise the twin runs clean.
  const willTrip = pStop >= 0.35 || alertName === 'medium' || alertName === 'high' || alertName === 'critical'
    || asset.status === 'critical' || surv14 < 0.7;
  // Higher stop probability -> sooner trip. Monotonic, bounded to the window.
  const tripDay = willTrip ? clamp(HORIZON * Math.pow(1 - clamp(pStop, 0.02, 0.95), 1.6), 0.4, HORIZON) : Infinity;
  // Combined survival curve: long hazard + a stop hazard tuned so survival at the trip
  // day ~= (1 - pStop). Monotonic decreasing, so the "health now" readout makes sense.
  const hStop = isFinite(tripDay) ? Math.log(1 / clamp(1 - pStop, 0.05, 0.999)) / tripDay : 0;
  const survAt = (t) => clamp(Math.exp(-(hLong + hStop) * t), 0, 1);
  const rulDay = (hLong + hStop) > 1e-6 ? Math.log(2) / (hLong + hStop) : Infinity;

  // ---- pick the degrading sensors (prefer watchlist: has descriptor + ranges + trend) ----
  const tagMeta = {};
  for (const t of detail?.tags || []) tagMeta[t.tag] = { desc: cleanDesc(t.desc), units: t.units, value: num(t.value) };

  // Root-cause lookup (per tag): mechanism + concise narrative + confidence + action.
  const rcRows = detail?.rootCause || [];
  const rcByTag = {};
  for (const r of rcRows) { const tg = r.tag; if (!tg) continue; if (!rcByTag[tg] || /crit/i.test(r.priority)) rcByTag[tg] = r; }
  const conciseCause = (r) => cleanDesc(String(r?.root_cause || '').split(/Contributing signals:|Recommended action:/i)[0]);
  const rcFor = (tag, desc) => {
    const r = rcByTag[tag] || rcRows.find((x) => cleanDesc(x.descriptor) === cleanDesc(desc)) || rcRows[0];
    if (!r) return null;
    return {
      mechanism: cleanDesc(r.failure_mechanism) || 'Developing fault',
      cause: conciseCause(r),
      confidence: num(r.confidence),
      priority: String(r.priority || '').toLowerCase(),
      action: cleanDesc(r.recommended_action),
      contributing: cleanDesc(r.contributing_tag_names),
    };
  };

  const picks = []; const seen = new Set();
  const addWatch = (w) => {
    const tag = w.tag_name; if (!tag || seen.has(tag)) return; seen.add(tag);
    const base = num(w.current_value) ?? num(w.baseline_mean) ?? tagMeta[tag]?.value ?? 50;
    const low = num(w.normal_range_low), high = num(w.normal_range_high);
    const slope = num(w.trend_slope_per_day) || 0;
    const trend = String(w.trend_direction || '').toLowerCase();
    const rawAct = cleanDesc(w.recommended_action);
    const action = cleanDesc(w.recommendation_text) || (/^(critical|high|medium|low|normal)$/i.test(rawAct) ? '' : rawAct);
    picks.push({
      tag, desc: cleanDesc(w.descriptor) || tagMeta[tag]?.desc || tag,
      units: w.engineering_units || tagMeta[tag]?.units || '',
      base, low, high, slope, trend,
      action,
      w: (num(w.risk_contribution) || 0), src: 'watch',
    });
  };
  const addAnom = (a) => {
    const tag = a.Tag; if (!tag || seen.has(tag)) return; seen.add(tag);
    const base = num(a.latest_value) ?? num(a.baseline_median) ?? tagMeta[tag]?.value ?? 50;
    const med = num(a.baseline_median) ?? base;
    const up = !/low/i.test(a.anomaly_direction || a.advisory_message || '');
    picks.push({
      tag, desc: tagMeta[tag]?.desc || cleanDesc(a.descriptor) || tag,
      units: tagMeta[tag]?.units || '', base,
      low: up ? null : med * 0.7, high: up ? med * 1.4 : null,
      slope: 0, trend: up ? 'increasing' : 'decreasing', action: '',
      w: (num(a.peak_abs_z) || 0) * 20, src: 'anom', z: num(a.peak_abs_z),
    });
  };
  [...(detail?.watchlist || [])].sort((a, b) => (num(b.risk_contribution) || 0) - (num(a.risk_contribution) || 0)).forEach(addWatch);
  [...(detail?.anomalies || [])].sort((a, b) => (num(b.peak_abs_z) || 0) - (num(a.peak_abs_z) || 0)).forEach(addAnom);
  (detail?.tags || []).forEach((t) => {
    if (seen.has(t.tag)) return; seen.add(t.tag);
    picks.push({ tag: t.tag, desc: cleanDesc(t.desc) || t.tag, units: t.units || '', base: num(t.value) ?? 50, low: null, high: null, slope: 0, trend: 'flat', action: '', w: 0.5, src: 'tag' });
  });

  const nSensors = willTrip ? clamp(picks.filter((p) => p.w > 0).length, 3, 5) : Math.min(4, picks.length);
  const chosen = picks.slice(0, nSensors);

  const sensors = chosen.map((p, i) => {
    const base = isFinite(p.base) ? p.base : 50;
    // Which limit is it heading toward?
    let dir = p.trend.startsWith('inc') ? 1 : p.trend.startsWith('dec') ? -1 : (i % 2 === 0 ? 1 : -1);
    let limit = dir > 0 ? p.high : p.low;
    if (limit == null || !isFinite(limit)) {
      const span = Math.max(Math.abs(base) * (0.35 + (i % 3) * 0.12), 4);
      limit = base + dir * span;
    }
    if ((dir > 0 && limit <= base) || (dir < 0 && limit >= base)) { dir = -dir; limit = base + (base - limit); }
    // failDay from physical trend slope if available, else derived from the trip timing.
    let failDay;
    if (p.slope && Math.sign(p.slope) === Math.sign(limit - base) && Math.abs(limit - base) > 1e-6) {
      failDay = clamp((limit - base) / p.slope, 0.4, HORIZON * 1.6);
    } else {
      failDay = isFinite(tripDay) ? clamp(tripDay * (0.75 + i * 0.35), 0.4, HORIZON * 1.4) : Infinity;
    }
    const degrading = willTrip && (i < Math.max(1, Math.round(nSensors * clamp(0.4 + risk * 0.6, 0.4, 1))));
    const span = Math.abs(limit - base) || Math.max(Math.abs(base) * 0.3, 4);
    return {
      tag: p.tag, desc: p.desc, units: p.units, base, dir, limit,
      low: num(p.low), high: num(p.high), degrading, failDay: degrading ? failDay : Infinity,
      action: p.action, src: p.src, noise: span * 0.03 + Math.abs(base) * 0.008,
      anchor: anchorForSensor(anchors, p.desc, p.tag), rc: rcFor(p.tag, p.desc),
    };
  });

  // Force the top degrader to align with the modeled trip so the story is coherent.
  const primary = sensors.find((s) => s.degrading) || sensors[0];
  if (primary && isFinite(tripDay)) { primary.degrading = true; primary.failDay = tripDay; }
  // Give each degrading sensor a distinct 3D zone where possible.
  const usedAnchors = new Set();
  for (const s of sensors) {
    if (s.anchor && !usedAnchors.has(s.anchor.id)) { usedAnchors.add(s.anchor.id); continue; }
    const free = anchors.find((a) => !usedAnchors.has(a.id));
    if (free) { s.anchor = free; usedAnchors.add(free.id); }
  }

  const valueAt = (s, t) => {
    const n = noiseAt(s.tag, t) * 2 * s.noise;
    if (!s.degrading || !isFinite(s.failDay)) {
      const drift = (s.limit - s.base) * 0.06 * clamp(t / HORIZON, 0, 1);
      return s.base + drift + n;
    }
    const p = clamp(t / s.failDay, 0, 1.25);
    let v = s.base + (s.limit - s.base) * Math.pow(Math.min(p, 1), 1.9);
    if (t > s.failDay) v += (s.limit - s.base) * 0.06 * Math.sin(t * 4); // post-failure instability
    return v + n;
  };

  const events = sensors.filter((s) => s.degrading && isFinite(s.failDay))
    .map((s) => ({ day: s.failDay, sensor: s, severity: (s === primary || s.failDay <= tripDay * 1.15) ? 'critical' : 'high' }))
    .sort((a, b) => a.day - b.day);

  return {
    type, anchors, pStop, alertName, alertSev, surv7, surv14, risk,
    survAt, tripDay, rulDay, sensors, primary, events, valueAt,
    willTrip, healthy: !willTrip || events.length === 0,
  };
}

/* ----------------------------- 3D digital twin ----------------------------- */

function lerpHex(a, b, t) {
  const hx = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const pa = hx(a), pb = hx(b);
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(t, 0, 1)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function FailMarker({ pos, color, stress, broken }) {
  const ref = useRef(); const core = useRef();
  useFrame((st) => {
    const pulse = 1 + Math.sin(st.clock.elapsedTime * (broken ? 9 : 3.4)) * (broken ? 0.28 : 0.14);
    if (ref.current) ref.current.scale.setScalar((0.6 + stress * 1.1) * pulse);
    if (core.current) core.current.scale.setScalar(pulse);
  });
  return (
    <group position={pos}>
      <mesh ref={ref}>
        <sphereGeometry args={[1.0, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.10 + stress * 0.22} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh><ringGeometry args={[0.26, 0.34, 24]} /><meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} /></mesh>
    </group>
  );
}

function TwinRig({ type, target, stress, broken, theme }) {
  const grp = useRef();
  const accent = broken ? '#ff5470' : lerpHex(theme.accent || '#3f96ff', '#ff8c42', stress * 0.9);
  useFrame((st) => {
    if (!grp.current) return;
    const wob = broken ? (Math.sin(st.clock.elapsedTime * 34) * 0.05 + Math.sin(st.clock.elapsedTime * 61) * 0.03) : 0;
    grp.current.position.y = wob;
    grp.current.position.x = broken ? Math.sin(st.clock.elapsedTime * 47) * 0.04 : 0;
    grp.current.rotation.y = -0.3 + Math.sin(st.clock.elapsedTime * 0.12) * 0.18;
  });
  const showMarker = target && target.anchor && (broken || stress > 0.05);
  const markerCol = broken ? '#ff5470' : stress > 0.6 ? '#ff8c42' : '#ffcc4d';
  return (
    <group ref={grp}>
      <EquipmentGeometry type={type} accent={accent} running={!broken} detail />
      {showMarker && <FailMarker pos={target.anchor.pos} color={markerCol} stress={broken ? 1 : stress} broken={broken} />}
    </group>
  );
}

function TwinStage({ theme, sim, target, stress, broken }) {
  const type = sim.type;
  const view = viewFor(type);
  const cam = useMemo(() => view.position.map((c) => c * 1.05), [view]);
  return (
    <div className="relative w-full rounded-xl overflow-hidden" style={{ height: 300, background: 'radial-gradient(120% 90% at 50% 15%, #223247 0%, #141d2b 45%, #0b1119 78%, #060a11 100%)' }}>
      <Canvas dpr={[1, 1.8]} camera={{ position: cam, fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <hemisphereLight intensity={0.85} groundColor={'#141c2b'} color={'#eaf1ff'} />
        <directionalLight position={[9, 15, 8]} intensity={2.0} />
        <directionalLight position={[-10, 8, -6]} intensity={0.8} color={'#9db8ff'} />
        <pointLight position={[0, 6, 6]} intensity={broken ? 2.6 : 0.5 + stress * 1.4} color={broken ? '#ff3355' : '#ff8c42'} distance={40} />
        <Suspense fallback={null}>
          <TwinRig type={type} target={target} stress={stress} broken={broken} theme={theme} />
        </Suspense>
        <ContactShadows position={[0, 0.02, 0]} opacity={0.6} scale={30} blur={2.4} far={16} color={'#020509'} />
        <OrbitControls target={view.target} enablePan={false} minDistance={view.minD} maxDistance={view.maxD} maxPolarAngle={Math.PI / 2.05} enableDamping dampingFactor={0.08} autoRotate={!broken} autoRotateSpeed={0.5} />
      </Canvas>

      {/* status chip */}
      <div className="absolute top-2 left-2 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
        style={{ background: 'rgba(10,16,26,.72)', border: `1px solid ${broken ? '#ff547066' : 'rgba(255,255,255,.12)'}`, color: broken ? '#ff5470' : stress > 0.5 ? '#ff8c42' : '#35d69a', backdropFilter: 'blur(6px)' }}>
        <span className="w-2 h-2 rounded-full" style={{ background: 'currentColor', boxShadow: '0 0 8px currentColor' }} />
        {broken ? 'TRIPPED — predicted failure' : stress > 0.5 ? 'STRESSED — approaching limit' : 'RUNNING — nominal'}
      </div>
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] uppercase tracking-wide" style={{ background: 'rgba(10,16,26,.6)', border: '1px solid rgba(255,255,255,.08)', color: '#8ea3bd' }}>drag to orbit</div>

      {broken && (
        <div className="absolute inset-x-0 bottom-3 grid place-items-center pointer-events-none">
          <div className="px-4 py-2 rounded-xl text-center animate-pulse" style={{ background: 'rgba(30,6,12,.72)', border: '1.5px solid #ff5470', boxShadow: '0 0 30px #ff547055' }}>
            <div className="text-[13px] font-extrabold tracking-wide" style={{ color: '#ff5470' }}>⚠ PREDICTED TRIP</div>
            <div className="text-[11px] text-slate-300">{target?.desc}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RootCausePanel({ theme, sensor, broken }) {
  const rc = sensor?.rc;
  const conf = rc?.confidence != null ? Math.round(rc.confidence * 100) : null;
  const accent = broken ? '#ff5470' : '#ff8c42';
  return (
    <div className={`rounded-xl p-3 flex flex-col ${theme.panelSolid}`} style={{ minHeight: 300, border: `1px solid ${accent}33` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className={`text-[10px] uppercase tracking-widest font-bold ${theme.sub}`}>Likely root cause</span>
        {conf != null && <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${accent}1f`, color: accent }}>{conf}% conf</span>}
      </div>
      {sensor ? (
        <>
          <div className={`text-[15px] font-extrabold leading-tight ${theme.heading}`}>{rc?.mechanism || 'Developing fault'}</div>
          <div className={`text-[11px] mt-0.5 ${theme.sub}`}>on <b className={theme.heading}>{sensor.desc}</b></div>
          {rc?.cause && <div className={`text-[12px] mt-2 leading-snug ${theme.heading}`} style={{ opacity: 0.92 }}>{rc.cause}</div>}
          <div className="mt-auto pt-3">
            {rc?.action && (
              <div className="rounded-lg p-2" style={{ background: `${accent}12`, border: `1px solid ${accent}33` }}>
                <div className="text-[9px] uppercase tracking-wider font-bold mb-0.5" style={{ color: accent }}>Recommended action</div>
                <div className={`text-[12px] leading-snug ${theme.heading}`}>{rc.action}</div>
              </div>
            )}
            {rc?.contributing && <div className={`text-[10px] mt-2 ${theme.sub}`}>Contributing: {rc.contributing.split(';').slice(0, 3).join(' · ')}</div>}
          </div>
        </>
      ) : (
        <div className={`text-[12px] ${theme.sub} m-auto text-center`}>No active fault — twin projected to run within normal limits.</div>
      )}
    </div>
  );
}

/* ----------------------------- sensor charts ----------------------------- */

function SensorChart({ theme, sensor, valueAt, t, width = 300, height = 58 }) {
  const N = 70;
  const pts = useMemo(() => Array.from({ length: N + 1 }, (_, i) => { const x = (i / N) * HORIZON; return { x, y: valueAt(sensor, x) }; }), [sensor, valueAt]);
  const ys = pts.map((p) => p.y);
  const refs = [sensor.base, sensor.limit, sensor.low, sensor.high].filter((v) => v != null && isFinite(v));
  const lo = Math.min(...ys, ...refs), hi = Math.max(...ys, ...refs);
  const pad = (hi - lo) * 0.12 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const sx = (x) => (x / HORIZON) * width;
  const sy = (y) => height - ((y - yMin) / (yMax - yMin)) * height;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const now = valueAt(sensor, t);
  const limitY = sy(sensor.limit);
  const breached = sensor.degrading && ((sensor.dir > 0 && now >= sensor.limit) || (sensor.dir < 0 && now <= sensor.limit));
  const col = breached ? '#ff5470' : sensor.degrading ? '#ff8c42' : '#5aa9ff';
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5 gap-2">
        <span className={`text-[11px] font-semibold truncate ${theme.heading}`} title={`${sensor.desc} · ${sensor.tag}`}>{sensor.desc}</span>
        <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: col }}>{now.toFixed(1)}{sensor.units ? ` ${sensor.units}` : ''}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* normal band */}
        {sensor.low != null && sensor.high != null && isFinite(sensor.low) && isFinite(sensor.high) && (
          <rect x="0" y={sy(sensor.high)} width={width} height={Math.max(0, sy(sensor.low) - sy(sensor.high))} fill="#35d69a" opacity="0.08" />
        )}
        {/* failure zone beyond limit */}
        {sensor.degrading && <rect x="0" y={sensor.dir > 0 ? 0 : limitY} width={width} height={sensor.dir > 0 ? limitY : height - limitY} fill="#ff5470" opacity="0.10" />}
        {sensor.degrading && <line x1="0" y1={limitY} x2={width} y2={limitY} stroke="#ff5470" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />}
        <path d={line} fill="none" stroke={col} strokeWidth="1.8" />
        <line x1={sx(t)} y1="0" x2={sx(t)} y2={height} stroke={theme.accent} strokeWidth="1.4" opacity="0.9" />
        <circle cx={sx(t)} cy={sy(now)} r="3" fill={col} stroke={theme.mode === 'light' ? '#fff' : '#0b1420'} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/* ----------------------------- main tab ----------------------------- */

export function Simulation({ theme, asset, detail }) {
  const sim = useMemo(() => buildSim(asset, detail), [asset, detail]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [event, setEvent] = useState(null);
  const fired = useRef(new Set());
  const barRef = useRef(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf;
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      setT((prev) => {
        let nt = prev + dt * speed;
        for (const ev of sim.events) {
          if (!fired.current.has(ev.day) && prev < ev.day && nt >= ev.day) { nt = ev.day; fired.current.add(ev.day); setPlaying(false); setEvent(ev); break; }
        }
        if (nt >= HORIZON) { nt = HORIZON; setPlaying(false); }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, sim]);

  const reset = () => { setT(0); fired.current = new Set(); setEvent(null); setPlaying(false); };
  const play = () => { if (t >= HORIZON) reset(); setEvent(null); setPlaying(true); };
  const scrub = (clientX) => {
    const r = barRef.current.getBoundingClientRect();
    setT(clamp(((clientX - r.left) / r.width) * HORIZON, 0, HORIZON));
    setPlaying(false); setEvent(null);
  };
  const dateAt = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const healthNow = Math.round(sim.survAt(t) * 100);
  const nextEvent = sim.events.find((e) => e.day > t + 1e-6);
  const tripTxt = isFinite(sim.tripDay) ? `Day ${sim.tripDay.toFixed(1)}` : 'None ≤14d';

  // Segment-based twin state so the animation RESETS between predicted trips:
  // stress builds from the previous trip (or now) toward the next trip, the twin
  // "trips" only while paused on an event, then recovers when playback continues.
  const passed = sim.events.filter((e) => e.day <= t + 1e-6);
  const lastPassed = passed.length ? passed[passed.length - 1] : null;
  const segStart = lastPassed ? lastPassed.day : 0;
  const segEnd = nextEvent ? nextEvent.day : HORIZON;
  const broken = !!event;
  const stress = broken ? 1 : clamp((t - segStart) / Math.max(0.001, segEnd - segStart), 0, 1);
  const targetEvent = event || nextEvent || sim.events[sim.events.length - 1] || null;
  const target = targetEvent ? targetEvent.sensor : sim.primary;

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat theme={theme} label="Predicted trip" value={tripTxt} color={isFinite(sim.tripDay) ? sevColor(sim.alertSev) : '#2fd07a'} />
        <Stat theme={theme} label="Stop probability" value={`${Math.round(sim.pStop * 100)}%`} color={sim.pStop >= 0.5 ? '#ff5470' : sim.pStop >= 0.3 ? '#ff8c42' : '#2fd07a'} />
        <Stat theme={theme} label="Survival 14d" value={`${Math.round(sim.surv14 * 100)}%`} color={sim.surv14 < 0.6 ? '#ff5470' : sim.surv14 < 0.85 ? '#ffcc4d' : '#2fd07a'} />
        <Stat theme={theme} label={`Health @ day ${t.toFixed(1)}`} value={`${healthNow}%`} color={healthNow < 60 ? '#ff5470' : healthNow < 85 ? '#ffcc4d' : '#2fd07a'} />
      </div>

      {/* 3D twin + live root cause */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="lg:flex-1 min-w-0"><TwinStage theme={theme} sim={sim} target={target} stress={stress} broken={broken} /></div>
        <div className="lg:w-72 shrink-0"><RootCausePanel theme={theme} sensor={sim.healthy ? null : target} broken={broken} /></div>
      </div>

      {/* time scrubber */}
      <div className={`p-3 rounded-xl ${theme.panelSolid}`}>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => (playing ? setPlaying(false) : play())} className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' }}>
            {playing ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M7 5l12 7-12 7z" /></svg>}
          </button>
          <button onClick={reset} title="Reset to now" className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${theme.panelSolid}`}>
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold tabular-nums ${theme.heading}`}>Day {t.toFixed(1)} of 14 <span className={`font-normal ${theme.sub}`}>· {dateAt(t)}</span></div>
          </div>
          <div className="inline-flex rounded-lg overflow-hidden text-[11px] font-bold shrink-0" style={{ border: `1px solid ${theme.accent}44` }}>
            {[1, 2, 4].map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className="px-2 py-1" style={speed === s ? { background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' } : { color: theme.mode === 'light' ? '#64748b' : '#8ea3bd' }}>{s}×</button>
            ))}
          </div>
        </div>
        <div ref={barRef} className="relative h-9 rounded-lg cursor-pointer select-none" style={{ background: theme.mode === 'light' ? 'rgba(15,23,42,.06)' : 'rgba(255,255,255,.06)' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons) scrub(e.clientX); }}>
          <div className="absolute inset-y-0 left-0 rounded-l-lg" style={{ width: `${(t / HORIZON) * 100}%`, background: `linear-gradient(90deg, ${theme.accent}44, ${sim.events.length ? '#ff547066' : theme.accent + '44'})` }} />
          {Array.from({ length: HORIZON + 1 }, (_, d) => (
            <div key={d} className="absolute top-0 bottom-0 flex flex-col justify-between items-center" style={{ left: `${(d / HORIZON) * 100}%`, transform: 'translateX(-50%)' }}>
              <span className="w-px h-1.5" style={{ background: theme.mode === 'light' ? 'rgba(15,23,42,.2)' : 'rgba(255,255,255,.2)' }} />
              {d % 2 === 0 && <span className={`text-[8px] ${theme.sub}`}>{d}</span>}
            </div>
          ))}
          {sim.events.map((ev, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setT(ev.day); setPlaying(false); setEvent(ev); }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10" style={{ left: `${(ev.day / HORIZON) * 100}%` }} title={`Predicted failure · Day ${ev.day.toFixed(1)}`}>
              <span className="block w-3 h-3 rounded-full animate-pulse" style={{ background: sevColor(ev.severity), boxShadow: `0 0 8px ${sevColor(ev.severity)}` }} />
            </button>
          ))}
          <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: `${(t / HORIZON) * 100}%`, transform: 'translateX(-50%)' }}>
            <div className="w-0.5 h-full" style={{ background: theme.accent }} />
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full" style={{ background: theme.accent, boxShadow: `0 0 6px ${theme.accent}` }} />
          </div>
        </div>
      </div>

      {/* sensor forecasts */}
      <div>
        <div className={`text-[11px] uppercase tracking-widest font-bold mb-2 ${theme.sub}`}>Projected sensor trajectories · next 14 days</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          {sim.sensors.map((s) => <SensorChart key={s.tag} theme={theme} sensor={s} valueAt={sim.valueAt} t={t} />)}
        </div>
      </div>

      {sim.healthy && (
        <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ background: '#2fd07a14', color: '#2fd07a', border: '1px solid #2fd07a33' }}>
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          No trip predicted in the next 14 days — this asset is projected to keep running healthy.
        </div>
      )}

      {/* event pause card */}
      {event && (
        <div className="p-4 rounded-xl" style={{ background: `${sevColor(event.severity)}12`, border: `1px solid ${sevColor(event.severity)}55` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: sevColor(event.severity) }} />
            <span className="text-sm font-bold" style={{ color: sevColor(event.severity) }}>Predicted failure · Day {event.day.toFixed(1)} ({dateAt(event.day)})</span>
            <button onClick={() => setEvent(null)} className={`ml-auto text-lg leading-none ${theme.sub}`}>×</button>
          </div>
          <div className={`text-[13px] ${theme.heading}`}><b>{event.sensor.desc}</b> is projected to reach its operating limit (~{event.sensor.limit.toFixed(1)}{event.sensor.units ? ` ${event.sensor.units}` : ''}), from a baseline of {event.sensor.base.toFixed(1)}{event.sensor.units ? ` ${event.sensor.units}` : ''}.</div>
          <div className={`text-[12px] mt-1 ${theme.sub}`}>{event.sensor.action
            ? <><b>Recommended:</b> {event.sensor.action}</>
            : <>Recommended: schedule inspection before <b>Day {Math.floor(event.day)}</b> ({dateAt(Math.max(0, event.day - 2))}) to avoid unplanned downtime.</>}</div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className={`text-[11px] uppercase tracking-wide ${theme.sub}`}>Is this prediction right?</span>
            <Feedback theme={theme} itemType="simulation" persona="maintenance" asset={asset}
              itemRef={`${event.sensor.desc} @ day ${event.day.toFixed(1)}`}
              context={{ kind: 'simulation', day: event.day, sensor: event.sensor.tag, severity: event.severity, limit: event.sensor.limit }} />
            <button onClick={play} className="ml-auto px-4 py-1.5 rounded-lg text-[13px] font-bold" style={{ background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' }}>Continue →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ theme, label, value, color }) {
  return (
    <div className={`p-2.5 rounded-xl ${theme.panelSolid} text-center`}>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: color || undefined }}>{value}</div>
      <div className={`text-[9px] uppercase tracking-wider ${theme.sub}`}>{label}</div>
    </div>
  );
}
