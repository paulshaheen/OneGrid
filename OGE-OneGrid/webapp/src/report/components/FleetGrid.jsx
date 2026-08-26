import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { getJson, useRealtime, useApi } from '../lib/api.js';
import { statusOf, fmt, pct, rankAssets } from '../lib/format.js';
import { Modal, Pill, Chip, Spinner } from './ui.jsx';
import { AreaTrend } from './charts.jsx';
// The 3D asset views pull in the entire three.js engine (three + drei + postprocessing).
// They only ever render inside this modal (Model / Simulation tabs), so load them lazily to
// keep the 3D bundle out of the landing-page critical path (fixes the huge LCP number).
const EquipmentDetail = lazy(() => import('../three/EquipmentDetail.jsx').then((m) => ({ default: m.EquipmentDetail })));
const Simulation = lazy(() => import('./Simulation.jsx').then((m) => ({ default: m.Simulation })));
// Manual-resolve modal is loaded on demand (only when the user opens a work order's manual),
// keeping the manuals/markdown code off the landing-page critical path.
const ManualResolveModal = lazy(() => import('./Manuals.jsx').then((m) => ({ default: m.ManualResolveModal })));
import { equipmentType } from '../three/equipmentType.js';
import { Feedback } from './Feedback.jsx';
import { useFocus } from '../lib/focus.js';

// Compact SVG health ring for the modal header.
function HealthRing({ value, color }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - v / 100);
  return (
    <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
      <svg width="56" height="56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[15px] font-bold text-white tabular-nums">{value != null ? Math.round(v) : '—'}</span>
        <span className="text-[8px] uppercase tracking-wider text-slate-400 mt-0.5">health</span>
      </div>
    </div>
  );
}

const EQUIP_LABEL = { turbine: 'Steam Turbine', boiler: 'Boiler', pump: 'Feed Pump', generator: 'Generator', skid: 'Equipment' };

export function FleetGrid({ theme, assets, onOpen }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {rankAssets(assets).map((a, i) => {
        const s = statusOf(a.status);
        return (
          <motion.button
            key={a.asset_id}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            whileHover={{ y: -3 }} onClick={() => onOpen(a)}
            className={`relative text-left p-4 overflow-hidden ${theme.card}`}
            style={{ borderColor: `${s.color}40` }}
          >
            <div className="absolute left-0 top-0 h-full w-1" style={{ background: s.color }} />
            <div className="flex items-start justify-between gap-2 pl-2">
              <div>
                <div className={`font-semibold ${theme.heading}`}>{a.name}</div>
                <div className={`text-xs ${theme.sub}`}>{a.plant} · {a.unit} · {a.category}</div>
              </div>
              <Pill status={a.status} theme={theme} />
            </div>
            <div className="mt-3 pl-2 grid grid-cols-3 gap-2">
              <Metric theme={theme} label="Health" value={(a.score ?? a.health) != null ? pct(a.score ?? a.health) : '—'} color={s.color} />
              <Metric theme={theme} label="Anomalies" value={a.anom_n ?? 0} />
              <Metric theme={theme} label="Peak z" value={a.max_z != null ? fmt(a.max_z, 0) : '—'} />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function Metric({ theme, label, value, color }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wide ${theme.sub}`}>{label}</div>
      <div className="text-lg font-bold tabular-nums" style={{ color: color || undefined }}>{value}</div>
    </div>
  );
}

export function AssetModal({ theme, asset, onClose }) {
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('model');
  const [snapshot, setSnapshot] = useState({});
  const { values: liveValues, subscribe, connected } = useRealtime();
  const { setFocus, clearFocus } = useFocus();
  // Keep the chat assistant aware of the asset being inspected in this 3D detail view.
  useEffect(() => {
    if (!asset) return;
    const runningTag = detail?.tags?.find((t) => /NLOAD|GE\d|LOAD/i.test(t.tag || ''))?.tag || detail?.running_tag || asset.running_tag;
    setFocus({
      _src: 'asset-modal', kind: 'asset', asset_id: asset.asset_id, name: asset.name,
      plant: asset.plant, unit: asset.unit, category: asset.category, status: asset.status,
      health: asset.health, running_tag: runningTag,
      tags: (detail?.tags || []).slice(0, 12).map((t) => ({ tag: t.tag, desc: t.desc })),
    });
    return () => clearFocus('asset-modal');
  }, [asset, detail, setFocus, clearFocus]);
  useEffect(() => {
    if (!asset) return;
    setDetail(null); setTab('model'); setSnapshot({});
    getJson(`/api/asset/${encodeURIComponent(asset.asset_id)}`).then((d) => {
      setDetail(d);
      // Seed the 3D snapshot from values folded into the detail response (instant, no race).
      const seed = {};
      for (const t of d.tags || []) if (t.tag && t.value != null) seed[t.tag] = { value: t.value, ts: t.ts };
      if (Object.keys(seed).length) setSnapshot(seed);
      // Then refresh from the live tag stream (picks up seeding when active).
      const tags = (d.tags || []).map((t) => t.tag).filter(Boolean).slice(0, 400);
      if (tags.length) {
        subscribe(tags); // stream live updates over the WebSocket while the modal is open
        getJson(`/api/tag-values?tags=${encodeURIComponent(tags.join(','))}`)
          .then((rows) => setSnapshot((cur) => ({ ...cur, ...Object.fromEntries(rows.map((r) => [r.tag, { value: r.value, ts: r.ts }])) }))).catch(() => {});
      }
    }).catch(() => setDetail({ error: true }));
    return () => subscribe([]); // unsubscribe when the asset changes / modal closes
  }, [asset, subscribe]);
  // Merge live WS values over the fetched snapshot so the 3D model updates in real time.
  const mergedSnapshot = useMemo(() => {
    if (!liveValues || !Object.keys(liveValues).length) return snapshot;
    const m = { ...snapshot };
    for (const [tag, v] of Object.entries(liveValues)) if (v && v.value != null) m[tag] = { value: v.value, ts: v.ts, changedAt: v.changedAt };
    return m;
  }, [snapshot, liveValues]);
  const s = statusOf(asset?.status);
  const liveStreaming = connected && Object.keys(liveValues || {}).length > 0;
  const modelAsset = asset && detail && !detail.error ? { ...asset, tags: detail.tags || [] } : asset;
  const surface = theme.persona === 'executive' ? '#ffffff' : theme.persona === 'controlroom' ? '#0c1622' : '#17140d';
  const eqType = asset ? equipmentType(asset) : 'skid';
  return (
    <Modal open={!!asset} onClose={onClose} theme={theme} size="max-w-5xl">
      {asset && (
        <div className="flex flex-col max-h-[90vh]" style={{ background: surface }}>
          {/* solid dark banner — flows into the 3D viewport, no dashboard bleed-through */}
          <div className="relative" style={{ background: '#0f1522' }}>
            <div className="absolute top-0 inset-x-0 h-[2px]" style={{ background: s.color }} />
            <div className="p-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <HealthRing value={(asset.score ?? asset.health) != null ? (asset.score ?? asset.health) : null} color={s.color} />
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-xl font-bold text-white tracking-tight">{asset.name}</h2>
                    <span className="eyebrow inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                      style={{ background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}3a` }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.label}
                    </span>
                    {liveStreaming && (
                      <span className="eyebrow inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                        style={{ background: '#3fd08a14', color: '#3fd08a', border: '1px solid #3fd08a3a' }} title="Per-second live values streaming from this equipment">
                        <span className="relative flex w-1.5 h-1.5"><span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" /></span>
                        Live
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] mt-1.5 text-slate-400 flex items-center gap-2 flex-wrap">
                    <span className="text-slate-300 font-medium">{EQUIP_LABEL[eqType] || 'Equipment'}</span>
                    <span className="text-slate-600">•</span><span>{asset.plant}</span>
                    <span className="text-slate-600">•</span><span>Unit {asset.unit}</span>
                    {asset.max_z != null && (<><span className="text-slate-600">•</span><span>Peak z {fmt(asset.max_z, 0)}</span></>)}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white transition -mt-1">×</button>
            </div>

            <div className="px-5 pb-3">
              <div className="inline-flex flex-wrap gap-1 p-1 rounded-[8px] bg-white/[.03] border border-white/10">
                {[['model', '3D Model'], ['root', 'Root Cause'], ['watch', 'Watchlist'], ['anom', 'Anomalies'], ['pred', 'Predictions'], ['sim', 'Simulation'], ['wo', 'Work Orders']].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className="px-3.5 py-1.5 rounded-[6px] text-sm font-semibold transition"
                    style={tab === k
                      ? { background: `${theme.accent}22`, color: '#e6eef8', border: `1px solid ${theme.accent}55` }
                      : { color: '#9fb0c6', border: '1px solid transparent' }}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          <div className={`${tab === 'model' ? 'p-0' : 'p-5'} overflow-y-auto`} style={tab === 'model' ? { height: '58vh' } : { background: surface }}>
            {tab === 'model' ? (
              <Suspense fallback={<Spinner theme={theme} label="Loading 3D model…" />}>
                <EquipmentDetail asset={modelAsset} theme={theme} snapshot={mergedSnapshot} loading={!detail}
                  anomalies={(detail && detail.anomalies) || []} rootCause={(detail && detail.rootCause) || []} />
              </Suspense>
            ) : !detail ? <Spinner theme={theme} label="Loading asset intelligence…" /> :
              detail.error ? <div className="text-rose-400 text-sm">Failed to load detail.</div> : (
                <>
                  {tab === 'root' && <RootCause theme={theme} rows={detail.rootCause} asset={asset} />}
                  {tab === 'watch' && <WatchTable theme={theme} rows={detail.watchlist} asset={asset} />}
                  {tab === 'anom' && <AnomTable theme={theme} rows={detail.anomalies} asset={asset} />}
                  {tab === 'pred' && <Predictions theme={theme} short={detail.predShort} long={detail.predLong} asset={asset} />}
                  {tab === 'sim' && <Suspense fallback={<Spinner theme={theme} label="Loading simulation…" />}><Simulation theme={theme} asset={asset} detail={detail} /></Suspense>}
                  {tab === 'wo' && <WorkOrdersTab theme={theme} asset={asset} />}
                </>
              )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Keep the highest-scoring row per key, sorted, capped — kills the dupe noise.
function topUnique(rows, keyFn, scoreFn, limit = 12) {
  const best = new Map();
  for (const r of rows || []) {
    const k = keyFn(r); if (k == null || k === '') continue;
    const sc = scoreFn(r);
    if (!best.has(k) || sc > best.get(k)._s) best.set(k, { ...r, _s: sc });
  }
  return [...best.values()].sort((a, b) => b._s - a._s).slice(0, limit);
}
const prioScore = (p) => (/crit/i.test(p || '') ? 3 : /high/i.test(p || '') ? 2 : /med/i.test(p || '') ? 1 : 0);

function FocusNote({ theme, shown, total }) {
  if (!total || total <= shown) return null;
  return <div className={`text-[11px] mb-2 ${theme.sub}`}>Showing the top {shown} of {total} — de-duplicated by tag, ranked by severity.</div>;
}

function RootCause({ theme, rows, asset }) {
  const items = topUnique(rows, (r) => `${r.failure_mechanism || r.root_cause || ''}|${r.descriptor || r.tag || ''}`,
    (r) => prioScore(r.priority) * 1000 + (Number(r.confidence) || 0) * 100, 8);
  if (!items.length) return <Empty theme={theme} msg="No root-cause findings for this asset." />;
  return (
    <div className="space-y-3">
      <FocusNote theme={theme} shown={items.length} total={(rows || []).length} />
      {items.map((r, i) => (
        <div key={i} className={`p-4 ${theme.panelSolid}`}>
          <div className="flex items-center justify-between gap-2">
            <div className={`font-semibold ${theme.heading}`}>{r.failure_mechanism || r.root_cause || 'Finding'}</div>
            <div className="flex items-center gap-2 shrink-0">
              {r.priority && <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold" style={{ background: prioScore(r.priority) >= 3 ? '#ff547022' : '#ffcc4d22', color: prioScore(r.priority) >= 3 ? '#ff5470' : '#ffcc4d' }}>{r.priority}</span>}
              <Chip theme={theme}>conf {Math.round((Number(r.confidence) || 0) * 100)}%</Chip>
              <Feedback theme={theme} itemType="root_cause" itemRef={r.failure_mechanism || r.root_cause} asset={asset} tag={r.tag}
                context={{ descriptor: r.descriptor, priority: r.priority, confidence: r.confidence }} />
            </div>
          </div>
          {r.descriptor && <div className={`text-xs mt-1 ${theme.sub}`}>{r.descriptor}</div>}
          {r.root_cause && <p className={`text-sm mt-2 ${theme.sub}`}>{r.root_cause}</p>}
          {r.recommended_action && (
            <div className="mt-3 text-sm flex gap-2 items-start">
              <span style={{ color: theme.accent }}>▸</span>
              <span className={theme.heading}><b>Recommended:</b> {r.recommended_action}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WatchTable({ theme, rows, asset }) {
  const items = topUnique(rows, (r) => r.tag_name, (r) => Number(r.risk_contribution) || 0, 12);
  if (!items.length) return <Empty theme={theme} msg="No watchlist items." />;
  return (
    <>
      <FocusNote theme={theme} shown={items.length} total={(rows || []).length} />
      <Table theme={theme} head={['Tag', 'Descriptor', 'Current', 'Trend', 'Risk', '']}
        rows={items.map((r) => [r.tag_name, r.descriptor, fmt(r.current_value), r.trend_direction, fmt(r.risk_contribution, 2),
          <Feedback key="fb" theme={theme} itemType="watchlist" itemRef={r.tag_name} asset={asset} tag={r.tag_name} context={{ descriptor: r.descriptor, risk: r.risk_contribution }} />])} />
    </>
  );
}
function AnomTable({ theme, rows, asset }) {
  const items = topUnique(rows, (r) => r.Tag, (r) => Number(r.peak_abs_z) || 0, 12);
  if (!items.length) return <Empty theme={theme} msg="No anomalies." />;
  return (
    <>
      <FocusNote theme={theme} shown={items.length} total={(rows || []).length} />
      <Table theme={theme} head={['Tag', 'Severity', 'Peak z', 'Duration h', 'Message', '']}
        rows={items.map((r) => [r.Tag, r.severity, fmt(r.peak_abs_z, 1), fmt(r.duration_h, 1), r.advisory_message,
          <Feedback key="fb" theme={theme} itemType="anomaly" itemRef={r.advisory_message || r.Tag} asset={asset} tag={r.Tag} context={{ severity: r.severity, peak_abs_z: r.peak_abs_z }} />])} />
    </>
  );
}
function Predictions({ theme, short, long, asset }) {
  const L = topUnique(long, (r) => r.horizon ?? r.risk_level, (r) => Number(r.risk_score) || 0, 6);
  const S = topUnique(short, (r) => r.prediction_horizon, (r) => Number(r.stop_probability) || 0, 6);
  if (!L.length && !S.length) return <Empty theme={theme} msg="No predictions." />;
  return (
    <div className="space-y-4">
      {L.length > 0 && <Table theme={theme} title="Long-term survival" head={['Horizon', 'Risk', 'Surv 7d', 'Surv 14d', 'Median days', '']}
        rows={L.map((r) => [r.horizon, r.risk_level, pct((Number(r.survival_probability_7d) || 0) * 100), pct((Number(r.survival_probability_14d) || 0) * 100), fmt(r.predicted_median_survival_days, 0),
          <Feedback key="fb" theme={theme} itemType="prediction" itemRef={`survival ${r.horizon} ${r.risk_level}`} asset={asset} context={{ kind: 'longterm', horizon: r.horizon, risk_level: r.risk_level }} />])} />}
      {S.length > 0 && <Table theme={theme} title="Short-term stop probability" head={['Horizon', 'Alert', 'Stop prob', '']}
        rows={S.map((r) => [r.prediction_horizon, r.alert_level, pct((Number(r.stop_probability) || 0) * 100),
          <Feedback key="fb" theme={theme} itemType="prediction" itemRef={`stop ${r.prediction_horizon} ${r.alert_level}`} asset={asset} context={{ kind: 'shortterm', horizon: r.prediction_horizon, alert: r.alert_level }} />])} />}
    </div>
  );
}

// Past + open work orders associated with this equipment (matched by plant + unit/keyword).
function WorkOrdersTab({ theme, asset }) {
  const { data } = useApi(`/api/asset-workorders/${encodeURIComponent(asset.asset_id)}`, { deps: [asset.asset_id] });
  const { data: manualsHealth } = useApi('/api/manuals/health');
  const manualsOn = !!manualsHealth?.enabled;
  const [q, setQ] = useState('');
  const [resolveWo, setResolveWo] = useState(null);
  const rows = data?.rows || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((w) => [w.wr_id, w.problem, w.status, w.type, w.priority, w.entity, w.parent]
      .filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [rows, q]);
  // ManualResolveModal expects work-order fields under different names than this endpoint
  // returns — normalise so the "Resolve with manual" flow gets the problem/asset/type it needs.
  const toManualWo = (w) => ({
    wr_id: w.wr_id, problem_descr: w.problem, wr_type: w.type,
    parent_descr: w.parent, location: w.entity, wr_status: w.status,
  });
  if (!data) return <Spinner theme={theme} label="Loading work orders…" />;
  if (!rows.length) return <Empty theme={theme} msg="No work orders found for this equipment." />;
  const prioColor = (p) => (Number(p) <= 1 ? '#ff5470' : Number(p) <= 2 ? '#f5a524' : Number(p) <= 3 ? '#ffcc4d' : '#7bb1ff');
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work orders — id, problem, status, type…"
            className={`w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none ${theme.panelSolid}`}
            style={{ color: theme.persona === 'executive' ? '#0f1b2d' : '#e6eef8' }} />
          {q && <button onClick={() => setQ('')} className={`absolute right-2 top-1/2 -translate-y-1/2 text-lg leading-none ${theme.sub} hover:opacity-70`}>×</button>}
        </div>
      </div>
      <div className={`text-[11px] mb-3 ${theme.sub}`}>{data.open} open · {filtered.length} of {rows.length} shown · matched by {data.matchedBy} ({data.plant}{asset.unit ? ` · ${asset.unit}` : ''})</div>
      {filtered.length === 0 ? <Empty theme={theme} msg={`No work orders match “${q}”.`} /> : (
      <div className="space-y-2">
        {filtered.map((w) => (
          <div key={w.wr_id} className={`p-3 rounded-xl ${theme.panelSolid} flex gap-3`}>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[11px] font-bold shrink-0 self-start" style={{ background: `${prioColor(w.priority_rank)}22`, color: prioColor(w.priority_rank) }}>{w.priority || '–'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-mono text-xs ${theme.sub}`}>#{w.wr_id}</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: w.open ? '#f5a52422' : '#2fd07a22', color: w.open ? '#f5a524' : '#2fd07a' }}>{w.status}</span>
                <span className={`text-[10px] ${theme.sub}`}>{w.type}</span>
              </div>
              <div className={`text-sm mt-1 ${theme.heading}`}>{w.problem}</div>
              {(w.entity || w.parent) && <div className={`text-[11px] mt-0.5 ${theme.sub}`}>{[w.entity, w.parent].filter(Boolean).join(' · ')}</div>}
            </div>
            {manualsOn && (
              <button onClick={() => setResolveWo(toManualWo(w))} title="Resolve this work order with the equipment manual"
                className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 h-fit shrink-0 self-start transition hover:opacity-80"
                style={{ color: theme.accent, border: `1px solid ${theme.accent}55`, background: `${theme.accent}12` }}>
                📖 Resolve
              </button>
            )}
          </div>
        ))}
      </div>
      )}
      {manualsOn && (
        <Suspense fallback={null}>
          <ManualResolveModal theme={theme} wo={resolveWo} onClose={() => setResolveWo(null)} />
        </Suspense>
      )}
    </div>
  );
}

function Table({ theme, head, rows, title }) {
  return (
    <div>
      {title && <div className={`text-xs font-semibold uppercase mb-2 ${theme.sub}`}>{title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className={`text-left ${theme.sub}`}>{head.map((h) => <th key={h} className="font-medium py-1.5 pr-4">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                {r.map((c, j) => <td key={j} className={`py-1.5 pr-4 ${j === 0 ? 'font-mono text-xs' : ''} ${theme.heading}`}>{c ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Empty({ theme, msg }) { return <div className={`text-sm py-8 text-center ${theme.sub}`}>{msg}</div>; }
