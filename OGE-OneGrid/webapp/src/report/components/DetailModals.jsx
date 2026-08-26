import { useApi } from '../lib/api.js';
import { fmt, fmtInt, pct } from '../lib/format.js';
import { Modal, Spinner } from './ui.jsx';
import { Bars } from './charts.jsx';

const money = (n) => (n == null ? '—' : `${fmtInt(n)} MW`);

// Fleet Availability drill-down: active/planned/forced outages + derate from PCIOutages.
export function OutagesModal({ theme, open, onClose }) {
  const { data } = useApi('/api/outages', { deps: [open], pollMs: open ? 30000 : 0 });
  const s = data?.summary || {};
  return (
    <Modal open={open} onClose={onClose} theme={theme} size="max-w-4xl">
      <div className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className={`text-lg font-bold ${theme.heading}`}>Fleet Availability — Outages & Derates</h2>
            <div className={`text-xs mt-0.5 ${theme.sub}`}>Live from Eventhouse · PCIOutages</div>
          </div>
          <button onClick={onClose} className={`text-2xl ${theme.sub} hover:opacity-70`}>×</button>
        </div>
        {!data ? <div className="p-10"><Spinner theme={theme} label="Loading outages…" /></div> : (
          <div className="p-5 overflow-y-auto space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[['Active', s.active, '#ff5470'], ['Forced', s.forced, '#ff8c42'], ['Planned', s.planned, '#5aa9ff'], ['Active derate', money(s.activeDerateMW), '#f5a524']].map(([l, v, c]) => (
                <div key={l} className={`p-3 rounded-xl ${theme.panelSolid}`}>
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: c }}>{l}</div>
                  <div className={`text-2xl font-bold tabular-nums ${theme.heading}`}>{typeof v === 'number' ? v : v ?? '—'}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(data.rows || []).map((o) => (
                <div key={o.outage_id} className={`p-3 rounded-xl ${theme.panelSolid} flex items-center gap-3`}>
                  <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: o.active ? '#ff5470' : /plan/i.test(o.type) ? '#5aa9ff' : '#8ea3bd' }} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${theme.heading}`}>{o.unit}</div>
                    <div className={`text-xs ${theme.sub} truncate`}>{o.plant} · {o.reason}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums" style={{ color: o.active ? '#ff5470' : theme.accent }}>{fmt(o.derate_mw, 0)} MW</div>
                    <div className={`text-[10px] ${theme.sub}`}>{o.status} · {o.type}</div>
                  </div>
                </div>
              ))}
              {!data.rows?.length && <div className={`text-sm ${theme.sub} py-6 text-center`}>No active outages — fleet fully available.</div>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Predicted Risks drill-down: per-asset survival + stop probability, ranked.
export function PredictionsModal({ theme, open, onClose, onAsset }) {
  const { data } = useApi('/api/predictions', { deps: [open] });
  const rank = (lv) => (/crit/i.test(lv) ? '#ff5470' : /high/i.test(lv) ? '#ff8c42' : /med/i.test(lv) ? '#ffcc4d' : '#2fd07a');
  return (
    <Modal open={open} onClose={onClose} theme={theme} size="max-w-4xl">
      <div className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className={`text-lg font-bold ${theme.heading}`}>Predicted Risks — next 7–14 days</h2>
            <div className={`text-xs mt-0.5 ${theme.sub}`}>Survival model + short-term stop probability</div>
          </div>
          <button onClick={onClose} className={`text-2xl ${theme.sub} hover:opacity-70`}>×</button>
        </div>
        {!data ? <div className="p-10"><Spinner theme={theme} label="Loading predictions…" /></div> : (
          <div className="p-5 overflow-y-auto space-y-2">
            {(data.rows || []).map((r) => (
              <button key={r.asset_id} onClick={() => onAsset && onAsset(r)} className={`w-full text-left p-3 rounded-xl ${theme.panelSolid} hover:opacity-90 transition`}>
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="text-[10px] font-bold uppercase px-2 py-1 rounded shrink-0" style={{ background: `${rank(r.risk_level)}22`, color: rank(r.risk_level) }}>{r.risk_level || '—'}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${theme.heading}`}>{r.name}</div>
                    <div className={`text-xs ${theme.sub}`}>{r.plant} · {r.unit}</div>
                  </div>
                  {r.risk_score != null && <div className="text-right shrink-0"><div className="text-sm font-bold tabular-nums" style={{ color: rank(r.risk_level) }}>{fmt(r.risk_score, 1)}</div><div className={`text-[9px] uppercase tracking-wide ${theme.sub}`}>risk score</div></div>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Metric theme={theme} label="7d survival" v={r.surv7 != null ? pct(r.surv7 * 100) : '—'} color={r.surv7 != null && r.surv7 < 0.75 ? '#ffcc4d' : undefined} />
                  <Metric theme={theme} label="14d survival" v={r.surv14 != null ? pct(r.surv14 * 100) : '—'} color={r.surv14 != null && r.surv14 < 0.6 ? '#ff8c42' : undefined} />
                  <Metric theme={theme} label={r.stop_estimated ? 'Stop prob ~' : 'Stop prob'} v={r.stop_prob != null ? `${r.stop_estimated ? '~' : ''}${pct(r.stop_prob * 100)}` : '—'} color={r.stop_prob >= 0.5 ? '#ff5470' : r.stop_prob >= 0.25 ? '#ffcc4d' : undefined} />
                  <Metric theme={theme} label="Median life" v={r.median_days != null ? `${fmt(r.median_days, 0)}d` : '—'} />
                </div>
              </button>
            ))}
            {!data.rows?.length && <div className={`text-sm ${theme.sub} py-6 text-center`}>No elevated risk predicted.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
function Metric({ theme, label, v, color }) {
  return <div className="text-left"><div className="text-sm font-bold tabular-nums" style={{ color: color || undefined }}>{v}</div><div className={`text-[9px] uppercase tracking-wide ${theme.sub}`}>{label}</div></div>;
}
