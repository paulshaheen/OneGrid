import { useState } from 'react';
import { useApi } from '../lib/api.js';
import { fmt, fmtInt, pct, counts, rankAssets, statusOf } from '../lib/format.js';
import { KpiCard } from '../components/KpiCard.jsx';
import { AssetModal } from '../components/FleetGrid.jsx';
import { BriefingBar } from '../components/Briefing.jsx';
import { SectionTitle, Spinner, Pill, StatusGlyph } from '../components/ui.jsx';
import { Sunburst } from '../components/charts.jsx';
import { OutagesModal, PredictionsModal } from '../components/DetailModals.jsx';
import { GovernanceBadge } from './Governance.jsx';

export default function Executive({ theme, onNavigate, onOpenGovernance }) {
  const { data: health } = useApi('/api/fleet-health', { pollMs: 60000 });
  const { data: assets } = useApi('/api/fleet-assets', { pollMs: 60000 });
  const { data: narrative } = useApi('/api/narrative');
  const { data: woSummary } = useApi('/api/work-orders-summary', { pollMs: 120000 });
  const { data: preds } = useApi('/api/predictions', { pollMs: 120000 });
  const [asset, setAsset] = useState(null);
  const [modal, setModal] = useState(null); // outages | predictions
  const c = counts(assets || []);
  const h = health || {};
  const availability = assets && assets.length ? Math.round(((c.ok + c.watch) / assets.length) * 100) : null;
  const criticalAssets = (assets || []).filter((a) => a.status === 'critical');
  const openWO = woSummary?.active ?? woSummary?.open ?? h.workRequests?.open;
  const backlogWO = woSummary?.backlog;
  const totalWO = woSummary?.total ?? h.workRequests?.total;
  const atRisk = preds?.counts?.atRisk;

  return (
    <div className="h-full flex flex-col overflow-hidden px-5 sm:px-8 lg:px-12 py-4 max-w-[1500px] mx-auto">
      <div className="mb-3 shrink-0"><BriefingBar theme={theme} narrative={narrative} /></div>

      {onOpenGovernance && (
        <div className="mb-3 shrink-0"><GovernanceBadge theme={theme} onOpen={onOpenGovernance} /></div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-3 shrink-0">
        <div data-tour="sundial" className={`lg:col-span-4 ${theme.panel} p-4 flex flex-col items-center justify-center`}>
          <SectionTitle theme={theme} right={<span className={`text-[11px] ${theme.sub}`}>click to drill</span>}>Fleet Health</SectionTitle>
          {!assets ? <Spinner theme={theme} /> : (
            <Sunburst theme={theme} assets={assets} size={200}
              centerValue={h.health ? `${Math.round(h.health.avg)}%` : '-'} centerLabel="Fleet Health"
              onAsset={(a) => setAsset(a)} />
          )}
          <div className="flex justify-center gap-4 mt-3 text-xs">
            {[['Healthy', c.ok, 'ok'], ['Watch', c.watch, 'watch'], ['Critical', c.critical, 'critical']].map(([l, n, st]) => (
              <span key={l} className="inline-flex items-center gap-1.5"><StatusGlyph status={st} size={13} />{l} {n || 0}</span>
            ))}
          </div>
        </div>

        <div data-tour="kpis" className="lg:col-span-8 grid grid-cols-2 gap-4">
          <KpiCard theme={theme} label="Fleet Availability" value={availability != null ? `${availability}%` : '-'} accent="#2fd07a"
            sub="click for outages & derates" delay={0.05} onClick={() => setModal('outages')} />
          <KpiCard theme={theme} label="Critical Assets" value={c.critical ?? 0} accent="#ff5470"
            sub="open live facility map" delay={0.1} onClick={() => onNavigate && onNavigate('controlroom')} />
          <KpiCard theme={theme} label="Predicted Risks" value={atRisk != null ? fmtInt(atRisk) : (h.predictions ? fmtInt(h.predictions.highRisk) : '-')} accent="#5aa9ff"
            sub="assets flagged - next 7-14 days" delay={0.15} onClick={() => setModal('predictions')} />
          <KpiCard theme={theme} label="Open Work Orders" value={openWO != null ? fmtInt(openWO) : '-'} accent="#f5a524"
            sub={backlogWO != null ? `${fmtInt(backlogWO)} in backlog - to maintenance` : 'to maintenance'} delay={0.2} onClick={() => onNavigate && onNavigate('maintenance')} />
        </div>
      </div>

      <div className={`${theme.panel} p-4 flex-1 min-h-0 flex flex-col`}>
        <div className="shrink-0">
          <SectionTitle theme={theme} right={<span className={`text-xs ${theme.sub}`}>critical only - click for detail</span>}>Priority Watch - where to focus</SectionTitle>
        </div>
        {!assets ? <Spinner theme={theme} /> : criticalAssets.length === 0 ? (
          <div className={`text-sm ${theme.sub} py-8 text-center`}>No critical assets - fleet is stable.</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {rankAssets(criticalAssets).map((a) => {
              const s = statusOf(a.status);
              const disp = a.score ?? a.health;
              return (
                <button key={a.asset_id} onClick={() => setAsset(a)} className={`w-full text-left flex items-center gap-4 p-3 rounded-xl ${theme.panelSolid} hover:opacity-90 transition`}>
                  <StatusGlyph status={a.status} size={16} />
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold ${theme.heading}`}>{a.name}</div>
                    <div className={`text-xs ${theme.sub}`}>{a.plant} - {a.unit} - {a.anom_n || 0} anomalies - peak z {a.max_z != null ? fmt(a.max_z, 0) : '-'}</div>
                  </div>
                  <div className="w-32 h-2 rounded-full bg-black/10 overflow-hidden shrink-0">
                    <div className="h-full rounded-full" style={{ width: `${disp ?? 0}%`, background: s.color }} />
                  </div>
                  <div className="w-14 text-right font-bold tabular-nums" style={{ color: s.color }}>{disp != null ? pct(disp) : '-'}</div>
                  <Pill status={a.status} theme={theme} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AssetModal theme={theme} asset={asset} onClose={() => setAsset(null)} />
      <OutagesModal theme={theme} open={modal === 'outages'} onClose={() => setModal(null)} />
      <PredictionsModal theme={theme} open={modal === 'predictions'} onClose={() => setModal(null)} onAsset={(a) => { setModal(null); setAsset(a); }} />
    </div>
  );
}
