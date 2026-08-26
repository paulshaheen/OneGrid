import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { fmt, fmtInt, pct, counts, rankAssets, statusOf } from '../lib/format.js';
import { KpiCard } from '../components/KpiCard.jsx';
import { AssetModal } from '../components/FleetGrid.jsx';
import { SectionTitle, Spinner, Pill, StatusGlyph } from '../components/ui.jsx';
import { ManualResolveModal } from '../components/Manuals.jsx';

const prioColor = (p) => (Number(p) <= 1 ? '#ff5470' : Number(p) <= 2 ? '#f5a524' : Number(p) <= 3 ? '#ffcc4d' : '#7bb1ff');
const FILTERS = [
  { key: 'critical', label: 'Critical', color: '#ff5470' },
  { key: 'watch', label: 'Watch', color: '#ffcc4d' },
  { key: 'ok', label: 'Healthy', color: '#2fd07a' },
];

export default function Maintenance({ theme }) {
  const { data: health } = useApi('/api/fleet-health', { pollMs: 60000 });
  const { data: assets } = useApi('/api/fleet-assets', { pollMs: 60000 });
  const { data: wos } = useApi('/api/work-orders?limit=100');
  const { data: woSummary } = useApi('/api/work-orders-summary', { pollMs: 120000 });
  const { data: manualsHealth } = useApi('/api/manuals/health');
  const manualsOn = !!manualsHealth?.enabled;
  const [asset, setAsset] = useState(null);
  const [resolveWo, setResolveWo] = useState(null);
  const [woQuery, setWoQuery] = useState('');
  const [filter, setFilter] = useState('critical');
  const c = counts(assets || []);
  const h = health || {};
  const openWO = woSummary?.active ?? woSummary?.open ?? h.workRequests?.open;
  const backlogWO = woSummary?.backlog;
  const totalWO = woSummary?.total ?? h.workRequests?.total;

  const filtered = rankAssets((assets || []).filter((a) => (a.status || 'ok') === filter));
  const filterMeta = FILTERS.find((f) => f.key === filter);
  const dark = theme.persona !== 'executive';
  const woPrio = (w) => { const n = Number(w.priority_code ?? w.priority); return Number.isFinite(n) ? n : 99; };
  const woList = (wos || []).filter((w) => {
    const q = woQuery.trim().toLowerCase();
    if (!q) return true;
    return [w.wr_id, w.problem_descr, w.location, w.problem_location, w.parent_descr, w.wr_type, w.wr_status]
      .some((v) => String(v || '').toLowerCase().includes(q));
  }).sort((a, b) => woPrio(a) - woPrio(b));

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 lg:px-8 py-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard theme={theme} label="Open Work Orders" value={openWO != null ? fmtInt(openWO) : '-'} accent="#f5a524" sub={backlogWO != null ? `active · ${fmtInt(backlogWO)} in backlog` : (totalWO != null ? `of ${fmtInt(totalWO)} fleet total` : '')} />
        <KpiCard theme={theme} label="Critical Assets" value={c.critical ?? 0} accent="#ff5470" sub="need intervention" delay={0.05} />
        <KpiCard theme={theme} label="Active Anomalies" value={h.anomalies ? fmtInt(h.anomalies.rows) : '-'} accent="#ffcc4d" sub={h.anomalies ? `${h.anomalies.critical} critical` : ''} delay={0.1} />
        <KpiCard theme={theme} label="Watchlist Items" value={h.watchlist ? fmtInt(h.watchlist.rows) : '-'} accent="#7bb1ff" sub={h.watchlist ? `${h.watchlist.assets} assets` : ''} delay={0.15} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-sm font-bold uppercase tracking-wide ${theme.heading}`}>Equipment</h3>
            <div data-tour="mnt-pills" className="inline-flex gap-1 p-1 rounded-xl" style={{ background: theme.persona === 'executive' ? 'rgba(0,0,0,.04)' : 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
              {FILTERS.map((f) => {
                const n = c[f.key === 'ok' ? 'ok' : f.key] ?? 0;
                const active = filter === f.key;
                return (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5"
                    style={active ? { background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}66` } : { color: theme.persona === 'executive' ? '#64748b' : '#8ea3bd' }}>
                    <StatusGlyph status={f.key} size={12} />{f.label} {n}
                  </button>
                );
              })}
            </div>
          </div>
          {!assets ? <Spinner theme={theme} /> : filtered.length === 0 ? (
            <div className={`text-sm ${theme.sub} py-10 text-center ${theme.panel}`}>No {filterMeta.label.toLowerCase()} equipment.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((a) => {
                const s = statusOf(a.status);
                const disp = a.score ?? a.health;
                return (
                  <motion.button key={a.asset_id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} onClick={() => setAsset(a)}
                    className={`w-full text-left p-4 ${theme.card} relative overflow-hidden`}>
                    <div className="absolute left-0 top-0 h-full w-1" style={{ background: s.color }} />
                    <div className="flex items-start justify-between pl-2">
                      <div>
                        <div className={`font-semibold ${theme.heading}`}>{a.name}</div>
                        <div className={`text-xs ${theme.sub}`}>{a.plant} - {a.unit} - {a.category}</div>
                      </div>
                      <Pill status={a.status} theme={theme} />
                    </div>
                    <div className="pl-2 mt-3 grid grid-cols-4 gap-2">
                      <Mini theme={theme} label="Condition" value={disp != null ? pct(disp) : '-'} color={s.color} />
                      <Mini theme={theme} label="Anomalies" value={a.anom_n ?? 0} />
                      <Mini theme={theme} label="Watchlist" value={a.watch_n ?? 0} />
                      <Mini theme={theme} label="Peak z" value={a.max_z != null ? fmt(a.max_z, 0) : '-'} />
                    </div>
                    <div className="pl-2 mt-3 text-xs font-semibold" style={{ color: theme.accent }}>Open diagnostics & 3D model →</div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        <div data-tour="mnt-workorders" className="xl:col-span-3">
          <SectionTitle theme={theme} right={<span className={`text-xs ${theme.sub}`}>{wos ? `${woList.length}${woQuery ? ` / ${wos.length}` : ''} shown` : ''}</span>}>Open Work Orders - by priority</SectionTitle>
          <div className={`${theme.panel} overflow-hidden`}>
            <div className="p-2.5" style={{ borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)'}` }}>
              <div className="relative">
                <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
                <input value={woQuery} onChange={(e) => setWoQuery(e.target.value)} placeholder="Search work orders — WO #, problem, location, type, status…"
                  className={`w-full text-sm rounded-md pl-8 pr-8 py-1.5 outline-none ${theme.heading}`}
                  style={{ background: dark ? 'rgba(255,255,255,.05)' : '#f4f7fb', border: `1px solid ${dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)'}` }} />
                {woQuery && <button onClick={() => setWoQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-lg leading-none opacity-50 hover:opacity-90">×</button>}
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '62vh' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: 'rgba(20,18,12,.9)' }}>
                  <tr className={`text-left ${theme.sub}`}>
                    {['Pri', 'WO', 'Problem', 'Location', 'Type', 'Status'].map((hd) => <th key={hd} className="font-medium py-2 px-3">{hd}</th>)}
                    {manualsOn && <th className="font-medium py-2 px-3">Manual</th>}
                  </tr>
                </thead>
                <tbody>
                  {!wos ? <tr><td colSpan={manualsOn ? 7 : 6} className="p-6"><Spinner theme={theme} /></td></tr> :
                    woList.length === 0 ? <tr><td colSpan={manualsOn ? 7 : 6} className={`p-6 text-center text-sm ${theme.sub}`}>No work orders match “{woQuery}”.</td></tr> :
                    woList.map((w, i) => (
                      <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                        <td className="py-2 px-3"><span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold" style={{ background: `${prioColor(w.priority_code || w.priority)}22`, color: prioColor(w.priority_code || w.priority) }}>{w.priority_code || w.priority || '-'}</span></td>
                        <td className={`py-2 px-3 font-mono text-xs ${theme.heading}`}>{w.wr_id}</td>
                        <td className={`py-2 px-3 ${theme.heading} max-w-[280px]`}><div className="line-clamp-2">{w.problem_descr}</div></td>
                        <td className={`py-2 px-3 text-xs ${theme.sub}`}>{w.location || w.problem_location || w.parent_descr || '-'}</td>
                        <td className={`py-2 px-3 text-xs ${theme.sub}`}>{w.wr_type || '-'}</td>
                        <td className={`py-2 px-3 text-xs ${theme.sub}`}>{w.wr_status || '-'}</td>
                        {manualsOn && (
                          <td className="py-2 px-3">
                            <button onClick={() => setResolveWo(w)} title="Resolve this work order with the equipment manual"
                              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 transition"
                              style={{ color: theme.accent, border: `1px solid ${theme.accent}55`, background: `${theme.accent}12` }}>
                              📖 Resolve
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AssetModal theme={theme} asset={asset} onClose={() => setAsset(null)} />
      <ManualResolveModal theme={theme} wo={resolveWo} onClose={() => setResolveWo(null)} />
    </div>
  );
}

function Mini({ theme, label, value, color }) {
  return <div><div className={`text-[10px] uppercase tracking-wide ${theme.sub}`}>{label}</div><div className="text-base font-bold tabular-nums" style={{ color: color || undefined }}>{value}</div></div>;
}
