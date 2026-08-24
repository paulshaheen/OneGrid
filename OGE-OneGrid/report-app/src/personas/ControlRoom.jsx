import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApi, getJson, useRealtime } from '../lib/api.js';
import { useFocus } from '../lib/focus.js';
import { fmt, fmtInt, timeAgo, statusOf, counts } from '../lib/format.js';
import { Facility, plantGenTags } from '../three/Facility.jsx';
import { AssetModal } from '../components/FleetGrid.jsx';
import { Spinner, StatusDot, StatusGlyph } from '../components/ui.jsx';

export default function ControlRoom({ theme }) {
  const { data: model } = useApi('/api/facility-model');
  const { data: assets } = useApi('/api/fleet-assets', { pollMs: 60000 });
  const { data: narrative } = useApi('/api/narrative');
  const { connected, pulse, values, subscribe } = useRealtime();
  const { setFocus, clearFocus } = useFocus();
  const [sel, setSel] = useState(null);
  const [drill, setDrill] = useState(null);
  const [activePlant, setActivePlant] = useState(null);
  const [snapshot, setSnapshot] = useState({});
  const [tagQuery, setTagQuery] = useState('');
  useEffect(() => { setTagQuery(''); }, [sel?.asset_id]);
  const [viewMode, setViewMode] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('pm.cr.view')) || 'map');
  const setView = (v) => { setViewMode(v); try { localStorage.setItem('pm.cr.view', v); } catch { /* ignore */ } };

  // Make the chat aware of what's on screen: a selected asset, or the drilled-in plant.
  // The asset detail modal (drill) sets its own richer focus, so defer to it when open.
  useEffect(() => {
    const src = 'controlroom';
    if (drill) return;
    if (sel) setFocus({ _src: src, kind: 'asset', asset_id: sel.asset_id, name: sel.name, plant: sel.plant, unit: sel.unit, category: sel.category, status: sel.status, running_tag: sel.running_tag });
    else if (activePlant) setFocus({ _src: src, kind: 'site', plant: activePlant, name: activePlant });
    else clearFocus(src);
    return () => clearFocus(src);
  }, [sel, activePlant, drill, setFocus, clearFocus]);

  const tags = useMemo(() => (sel?.tags || []).map((t) => t.tag), [sel]);
  const plantObj = (model?.plants || []).find((p) => p.name === activePlant);
  const genTags = useMemo(() => (activePlant && plantObj ? plantGenTags(plantObj) : []), [activePlant, plantObj]);
  useEffect(() => {
    const all = [...new Set([...tags, ...genTags])];
    subscribe(all);
    if (tags.length) {
      getJson(`/api/tag-values?tags=${encodeURIComponent(tags.join(','))}`)
        .then((rows) => setSnapshot(Object.fromEntries(rows.map((r) => [r.tag, { value: r.value, ts: r.ts }])))).catch(() => {});
    }
  }, [tags, genTags, subscribe]);

  const enterPlant = (name) => { setSel(null); setActivePlant(name); };
  const backToSites = () => { setSel(null); setActivePlant(null); };
  const plantCrit = plantObj ? (plantObj.unitList || []).reduce((s, u) => s + (u.assets || []).filter((a) => a.status === 'critical').length, 0) : 0;

  const c = counts(assets || []);
  const alerts = (narrative?.briefing || []).slice(0, 12);

  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        {!model ? <div className="h-full grid place-items-center"><Spinner theme={theme} label="Building facility twin…" /></div>
          : viewMode === 'map'
            ? <Facility model={model} theme={theme} selected={sel?.asset_id} onSelect={(n) => setSel(n.kind === 'asset' ? n : null)}
                activePlant={activePlant} onEnterPlant={enterPlant} values={values} />
            : <SiteMenu model={model} theme={theme} selected={sel?.asset_id} activePlant={activePlant}
                values={values} connected={connected} pulse={pulse} onEnterPlant={enterPlant} onSelect={(n) => setSel(n)} onInspect={(n) => setDrill(assets?.find((a) => a.asset_id === n.asset_id) || n)} />}
      </div>

      {/* top pulse */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-30">
        <div className={`pointer-events-auto px-4 py-2.5 ${theme.panel} flex items-center gap-4`}>
          <div className="flex items-center gap-2"><StatusDot status={pulse?.live ? 'ok' : 'watch'} /><span className={`text-sm font-semibold ${theme.heading}`}>{pulse?.live ? 'LIVE' : 'HISTORICAL'}</span></div>
          <Divider /><Stat theme={theme} label="Healthy" value={c.ok ?? '—'} color="#2fd07a" />
          <Stat theme={theme} label="Watch" value={c.watch ?? '—'} color="#ffcc4d" />
          <Stat theme={theme} label="Critical" value={c.critical ?? '—'} color="#ff5470" />
          <Divider /><Stat theme={theme} label="Tags" value={pulse?.totalTags ?? model?.counts?.tags ?? '—'} />
          <Stat theme={theme} label="Events/min" value={pulse ? Math.round(pulse.eventsPerMin) : '—'} />
          <Stat theme={theme} label="Last data" value={pulse?.lastTs ? timeAgo(pulse.lastTs) : '—'} sub="· ~1m feed" hint="Fleet feed is 1-minute resolution. Open an equipment's 3D model for per-second live values." />
        </div>
        <div className={`pointer-events-auto px-3 py-2 ${theme.panel} flex items-center gap-2`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span className={`text-xs ${theme.sub}`}>{connected ? 'stream connected' : 'reconnecting…'}</span>
        </div>
      </div>

      {/* breadcrumb / back to sites */}
      <div className="absolute left-1/2 -translate-x-1/2 top-4 pointer-events-none z-10">
        <div data-tour="cr-breadcrumb" className={`pointer-events-auto px-3 py-2 ${theme.panel} flex items-center gap-2 text-sm`}>
          <div className="inline-flex rounded-md overflow-hidden text-xs font-semibold mr-1" style={{ border: `1px solid ${theme.accent}44` }}>
            <button onClick={() => setView('map')} className={`px-2 py-0.5 inline-flex items-center gap-1 ${viewMode === 'map' ? '' : theme.sub}`} style={viewMode === 'map' ? { background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' } : {}}>
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15" strokeLinejoin="round" /></svg>Map
            </button>
            <button onClick={() => setView('list')} className={`px-2 py-0.5 inline-flex items-center gap-1 ${viewMode === 'list' ? '' : theme.sub}`} style={viewMode === 'list' ? { background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' } : {}}>
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>List
            </button>
          </div>
          <span className={theme.sub}>|</span>
          <button onClick={backToSites} className={`font-semibold ${activePlant ? theme.sub : theme.heading} hover:opacity-80 transition`}>{viewMode === 'list' ? 'All Sites' : 'US Fleet Map'}</button>
          {activePlant && (
            <>
              <span className={theme.sub}>›</span>
              <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: plantCrit ? '#ff5470' : '#2fd07a' }}>
                <StatusGlyph status={plantCrit ? 'critical' : 'ok'} size={12} />{activePlant}
              </span>
              <button onClick={backToSites} className="ml-1 text-xs px-2 py-0.5 rounded-md" style={{ background: `${theme.accent}18`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>← all sites</button>
            </>
          )}
        </div>
      </div>

      {/* alert rail */}
      <div className="absolute left-4 top-20 bottom-4 w-[300px] max-w-[80vw] pointer-events-none flex flex-col z-30">
        <div className={`pointer-events-auto ${theme.panel} flex flex-col overflow-hidden`}>
          <div className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest ${theme.sub} border-b border-white/5`}>Live Alert Stream</div>
          <div className="overflow-y-auto no-scrollbar p-2 space-y-1.5">
            {alerts.map((a, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg ${theme.panelSolid}`}>
                <div className="flex items-center gap-1.5">
                  <StatusGlyph status={a.level === 'critical' ? 'critical' : 'watch'} size={12} />
                  <span className={`text-xs font-semibold truncate ${theme.heading}`}>{a.asset}</span>
                  <span className="ml-auto text-[10px] font-bold" style={{ color: a.level === 'critical' ? '#ff5470' : '#ffcc4d' }}>{a.severity}</span>
                </div>
                <div className={`text-[11px] mt-0.5 line-clamp-2 ${theme.sub}`}>{a.headline}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* asset live panel */}
      <AnimatePresence>
        {sel && (
          <motion.div initial={{ x: 420, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 420, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className={`absolute top-20 right-4 bottom-4 w-[380px] max-w-[90vw] z-30 ${theme.panel} overflow-hidden flex flex-col`}>
            <div className="p-4 border-b border-white/10 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2"><StatusDot status={sel.status} /><h3 className={`font-bold ${theme.heading}`}>{sel.name}</h3></div>
                <div className={`text-xs mt-0.5 ${theme.sub}`}>{sel.plant} · {sel.unit} · {sel.category}</div>
              </div>
              <button onClick={() => setSel(null)} className={`text-2xl leading-none ${theme.sub} hover:opacity-70`}>×</button>
            </div>
            <div className="p-3">
              <button onClick={() => setDrill(assets?.find((a) => a.asset_id === sel.asset_id) || sel)}
                className="w-full py-2 rounded-lg text-sm font-semibold mb-2" style={{ background: `${theme.accent}22`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>
                Inspect 3D model & diagnostics →
              </button>
            </div>
            <div className="px-3 pb-3 overflow-y-auto no-scrollbar space-y-2">
              <div className="relative sticky top-0 z-10 pb-1" style={{ background: 'inherit' }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
                <input value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="Search tags…"
                  className={`w-full rounded-lg pl-8 pr-7 py-1.5 text-sm outline-none ${theme.panelSolid}`} style={{ color: theme.mode === 'light' ? '#0f1b2d' : '#e6eef8' }} />
                {tagQuery && <button onClick={() => setTagQuery('')} className={`absolute right-2 top-1/2 -translate-y-1/2 text-lg leading-none ${theme.sub}`}>×</button>}
              </div>
              {(() => {
                const q = tagQuery.trim().toLowerCase();
                const list = (sel.tags || []).filter((t) => !q || `${t.desc || ''} ${t.tag || ''}`.toLowerCase().includes(q));
                return (
                  <>
                    <div className={`text-[11px] uppercase tracking-wider px-1 ${theme.sub}`}>{q ? `${list.length} of ${tags.length}` : tags.length} live tags</div>
                    {list.slice(0, 120).map((t) => {
                const live = values[t.tag]; const snap = snapshot[t.tag];
                const v = live?.value ?? snap?.value; const ts = live?.ts ?? snap?.ts;
                const streaming = !!live && connected && pulse?.live;         // receiving live updates
                const justChanged = !!live && Date.now() - (live.changedAt || 0) < 3500; // flash on new value
                return (
                  <div key={t.tag} className={`p-2.5 rounded-lg ${theme.panelSolid} flex items-center gap-3 transition-shadow`}
                    style={justChanged ? { boxShadow: `inset 0 0 0 1px ${theme.accent}66` } : undefined}>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium truncate ${theme.heading}`}>{t.desc || t.tag}</div>
                      <div className={`text-[10px] font-mono truncate ${theme.sub}`}>{t.tag}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums flex items-center gap-1 justify-end" style={{ color: streaming ? theme.accent : undefined }}>
                        {v != null ? fmt(v, 2) : '—'}{streaming && <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${justChanged ? 'animate-ping' : 'animate-pulse'}`} />}
                      </div>
                      <div className={`text-[10px] ${theme.sub}`}>{t.units || ''} {ts ? `· ${timeAgo(ts)}` : ''}</div>
                    </div>
                  </div>
                );
              })}
                    {q && list.length === 0 && <div className={`text-sm ${theme.sub} py-6 text-center`}>No tags match “{tagQuery}”.</div>}
                  </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!sel && model && viewMode === 'map' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2.5, repeat: Infinity }} className={`px-3 py-1.5 text-xs ${theme.sub}`}>
            {activePlant ? 'drag to orbit · click lit equipment for live tags · grey = modeled (no telemetry)' : 'drag to pan · scroll to zoom · click a plant pin to enter'}
          </motion.div>
        </div>
      )}

      <AssetModal theme={theme} asset={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function Stat({ theme, label, value, color, sub, hint }) {
  return <div className="text-center" title={hint}><div className="text-sm font-bold tabular-nums" style={{ color: color || undefined }}>{value}</div><div className={`text-[10px] uppercase tracking-wide ${theme.sub}`}>{label}{sub ? <span className="normal-case opacity-70"> {sub}</span> : null}</div></div>;
}
function Divider() { return <span className="w-px h-6 bg-white/10" />; }

// Menu-driven navigation as an alternative to the interactive 3D map: pick a site, then a
// piece of equipment — same live panel + detail modal as the map.
function SiteMenu({ model, theme, selected, activePlant, values, connected, pulse, onEnterPlant, onSelect, onInspect }) {
  const [q, setQ] = useState('');
  const plants = model?.plants || [];
  const plant = plants.find((p) => p.name === activePlant);
  const s = q.trim().toLowerCase();
  const worst = (p) => (p.unitList || []).reduce((w, u) => (u.status === 'critical' ? 'critical' : w === 'critical' ? 'critical' : u.status === 'watch' ? 'watch' : w), 'ok');
  const critCount = (p) => (p.unitList || []).reduce((n, u) => n + (u.assets || []).filter((a) => a.status === 'critical').length, 0);
  const assetCount = (p) => (p.unitList || []).reduce((n, u) => n + (u.assets || []).length, 0);

  return (
    <div className="absolute top-20 bottom-4 left-1/2 -translate-x-1/2 w-[min(460px,94vw)] flex flex-col pointer-events-none">
      <div className={`pointer-events-auto ${theme.panel} flex flex-col overflow-hidden h-full`}>
        <div className="px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center justify-between">
            <div className={`text-[11px] font-bold uppercase tracking-widest ${theme.sub}`}>{plant ? `${plant.name} · equipment` : 'Select a site'}</div>
            <span className={`text-[10px] ${theme.sub} inline-flex items-center gap-1`}><span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />{pulse?.live ? 'live' : 'historical'}</span>
          </div>
          <div className="relative mt-2">
            <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={plant ? 'Search equipment…' : 'Search sites…'}
              className={`w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none ${theme.panelSolid}`} style={{ color: theme.mode === 'light' ? '#0f1b2d' : '#e6eef8' }} />
          </div>
        </div>

        <div className="overflow-y-auto no-scrollbar p-2 space-y-1">
          {!plant ? (
            plants.filter((p) => !s || p.name.toLowerCase().includes(s)).map((p) => {
              const st = statusOf(worst(p)); const crit = critCount(p);
              return (
                <button key={p.name} onClick={() => onEnterPlant(p.name)} className={`w-full text-left px-3 py-2.5 rounded-xl ${theme.panelSolid} flex items-center gap-3 hover:opacity-90 transition`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.color, boxShadow: crit ? `0 0 8px ${st.color}` : 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${theme.heading}`}>{p.name}</div>
                    <div className={`text-[11px] ${theme.sub}`}>{crit ? `${crit} critical` : 'all healthy'} · {assetCount(p)} assets</div>
                  </div>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              );
            })
          ) : (
            (plant.unitList || []).map((u) => {
              const rows = (u.assets || []).filter((a) => !s || (a.name || '').toLowerCase().includes(s));
              if (!rows.length) return null;
              return (
                <div key={u.name} className="mb-1">
                  <div className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${theme.sub}`} style={{ color: statusOf(u.status).color }}>{u.name}</div>
                  {rows.map((a) => {
                    const st = statusOf(a.status); const isSel = a.asset_id === selected;
                    const node = { ...a, kind: 'asset', plant: plant.name, unit: u.name };
                    return (
                      <button key={a.asset_id} onClick={() => onSelect(node)} onDoubleClick={() => onInspect(node)}
                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition ${theme.panelSolid} mb-1`}
                        style={isSel ? { boxShadow: `inset 0 0 0 1.5px ${theme.accent}` } : undefined}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${theme.heading}`}>{a.name}</div>
                          <div className={`text-[11px] ${theme.sub}`}>{a.category || 'equipment'}{a.tags?.length ? ` · ${a.tags.length} tags` : ''}</div>
                        </div>
                        {(a.score ?? a.health) != null && <span className="text-sm font-bold tabular-nums" style={{ color: st.color }}>{Math.round(a.score ?? a.health)}%</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
          {plant && !(plant.unitList || []).some((u) => (u.assets || []).some((a) => !s || (a.name || '').toLowerCase().includes(s))) && (
            <div className={`text-sm ${theme.sub} py-8 text-center`}>No equipment matches “{q}”.</div>
          )}
        </div>
        {plant && <div className={`px-4 py-2 border-t border-white/5 text-[10px] ${theme.sub} shrink-0`}>Click to view live tags · double-click for full 3D diagnostics</div>}
      </div>
    </div>
  );
}
