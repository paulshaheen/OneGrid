import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getJson } from '../lib/api.js';

const EDGE_STYLE = {
  physical: { dash: '', width: 1.8, opacity: 0.55, label: 'Modeled relationship' },
  logical: { dash: '5 4', width: 1.4, opacity: 0.4, label: 'Logical (shared key)' },
  temporal: { dash: '2 4', width: 1.2, opacity: 0.28, label: 'Temporal (date spine)' },
};

function askChat(message) {
  window.dispatchEvent(new CustomEvent('pm-chat-ask', { detail: { message } }));
}

// ---- lightweight force-directed layout (no deps) ----
function useForceGraph(nodes, edges, W, H) {
  const state = useRef(null);
  const [, force] = useState(0);
  const tickRef = useRef(0);

  if (!state.current || state.current.key !== nodes.map((n) => n.id).join(',')) {
    const N = nodes.length;
    const cx = W / 2, cy = H / 2;
    const P = {};
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      const r = Math.min(W, H) * 0.34;
      P[n.id] = { x: cx + Math.cos(a) * r + (Math.random() - 0.5) * 30, y: cy + Math.sin(a) * r + (Math.random() - 0.5) * 30, vx: 0, vy: 0 };
    });
    state.current = { key: nodes.map((n) => n.id).join(','), P, pinned: null };
  }

  const step = useCallback(() => {
    const { P, pinned } = state.current;
    const ids = Object.keys(P);
    const cx = W / 2, cy = H / 2;
    const K_REP = 42000, K_SPRING = 0.015, L = 200, K_GRAV = 0.015, DAMP = 0.82;
    // repulsion
    for (let i = 0; i < ids.length; i++) {
      const a = P[ids[i]];
      for (let j = i + 1; j < ids.length; j++) {
        const b = P[ids[j]];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1;
        const f = K_REP / d2; const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    // springs
    for (const e of edges) {
      const a = P[e.from], b = P[e.to]; if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const len = e.kind === 'temporal' ? L * 1.3 : L;
      const f = (d - len) * K_SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    // gravity + integrate
    let maxv = 0;
    for (const id of ids) {
      const p = P[id];
      p.vx += (cx - p.x) * K_GRAV; p.vy += (cy - p.y) * K_GRAV;
      p.vx *= DAMP; p.vy *= DAMP;
      if (id === pinned) { p.vx = 0; p.vy = 0; continue; }
      p.x += p.vx; p.y += p.vy;
      p.x = Math.max(60, Math.min(W - 60, p.x));
      p.y = Math.max(40, Math.min(H - 40, p.y));
      maxv = Math.max(maxv, Math.abs(p.vx) + Math.abs(p.vy));
    }
    return maxv;
  }, [edges, W, H]);

  useEffect(() => {
    let raf, cool = 0;
    const loop = () => {
      const maxv = step();
      tickRef.current++;
      force((v) => (v + 1) % 1000000);
      if (maxv < 0.4) { cool++; } else { cool = 0; }
      if (cool < 40) raf = requestAnimationFrame(loop); // settle then stop
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const reheat = useCallback(() => { for (const id in state.current.P) { state.current.P[id].vx += (Math.random() - 0.5) * 6; } force((v) => v + 1); }, []);
  return { P: state.current.P, setPinned: (id) => { state.current.pinned = id; }, reheat };
}

function nodeSize(n) { return n.role === 'hub' ? 30 : 22; }

export default function Ontology({ theme }) {
  const dark = theme.mode !== 'light';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const W = 1000, H = 640;

  useEffect(() => { getJson('/api/ontology').then(setData).catch((e) => setError(e.message)); }, []);

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const cats = data?.categories || {};
  const { P, setPinned, reheat } = useForceGraph(nodes, edges, W, H);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbors = useMemo(() => {
    const m = {}; for (const e of edges) { (m[e.from] ||= new Set()).add(e.to); (m[e.to] ||= new Set()).add(e.from); }
    return m;
  }, [edges]);

  const matches = useCallback((n) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) ||
      (n.columns || []).some((c) => c.name.toLowerCase().includes(q));
  }, [query]);

  const selNode = sel ? byId[sel] : null;
  const focusId = sel || hover;
  const isDim = (id) => focusId && id !== focusId && !(neighbors[focusId]?.has(id));

  // ---- pan / zoom / drag ----
  const toWorld = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * W;
    const sy = (clientY - r.top) / r.height * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  const onWheel = (e) => {
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * W, my = (e.clientY - r.top) / r.height * H;
    const k2 = Math.max(0.5, Math.min(2.4, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView((v) => ({ k: k2, x: mx - (mx - v.x) * (k2 / v.k), y: my - (my - v.y) * (k2 / v.k) }));
  };
  const onPointerDown = (e, id) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (id) { setPinned(id); dragRef.current = { id, moved: false }; }
    else { dragRef.current = { pan: true, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; }
  };
  const onPointerMove = (e) => {
    const d = dragRef.current; if (!d) return;
    if (d.pan) {
      const r = wrapRef.current.getBoundingClientRect();
      const dx = (e.clientX - d.sx) / r.width * W, dy = (e.clientY - d.sy) / r.height * H;
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.id) {
      const w = toWorld(e.clientX, e.clientY);
      P[d.id].x = w.x; P[d.id].y = w.y; P[d.id].vx = 0; P[d.id].vy = 0; d.moved = true;
    }
  };
  const onPointerUp = (e, id) => {
    const d = dragRef.current;
    if (d && d.id && !d.moved) setSel((s) => (s === d.id ? null : d.id));
    if (id) setPinned(null);
    dragRef.current = null;
  };

  const bgPanel = dark ? '#0d1826' : '#ffffff';
  const stroke = dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.12)';

  if (error) return <div className="p-8 text-rose-400">Failed to load ontology: {error}</div>;
  if (!data) return <div className={`p-8 ${theme.sub}`}>Loading knowledge graph…</div>;

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div data-tour="ontology" className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap shrink-0" style={{ borderBottom: `1px solid ${stroke}` }}>
        <div>
          <div className={`text-lg font-bold ${theme.heading} flex items-center gap-2`}>
            <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ color: theme.accent }} fill="none" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7 7l8 9M17 7l-8 9M6.5 6.5h11" strokeLinecap="round" /></svg>
            Knowledge Graph
          </div>
          <div className={`text-[11px] ${theme.sub}`}>{data.stats?.nodes} entities · {data.stats?.edges} relationships · sourced from <b>{data.source}</b></div>
        </div>
        <div className="relative ml-auto">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search entities or columns…"
            className="text-sm rounded-lg pl-8 pr-3 py-1.5 w-56 outline-none"
            style={{ background: dark ? 'rgba(255,255,255,.06)' : '#f1f5f9', color: theme.mode === 'light' ? '#0f1b2d' : '#e6eef8', border: `1px solid ${stroke}` }} />
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: theme.sub ? '#8ea3bd' : undefined }} fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
        </div>
        <button onClick={() => askChat(selNode
            ? buildEntityQuestion(selNode, edges, byId)
            : 'Give me an overview of the OneGrid knowledge graph — the main entities (assets, tags/sensors, telemetry, ML scoring, advisories, outages, work) and how they connect. What are the most valuable questions I can ask across this data model?')}
          className="text-sm font-semibold px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5"
          style={{ background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' }}>
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinejoin="round" /></svg>
          {selNode ? `Ask AI about ${selNode.label}` : 'Ask AI about the model'}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* graph */}
        <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden touch-none"
          style={{ background: dark ? 'radial-gradient(120% 90% at 50% 10%, #16223400 0%, #0a121e 70%)' : 'radial-gradient(120% 90% at 50% 10%, #f8fafc 0%, #eef2f7 80%)' }}
          onWheel={onWheel} onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={(e) => onPointerUp(e)}>
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ cursor: dragRef.current?.pan ? 'grabbing' : 'grab' }}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* edges */}
              {edges.map((e, i) => {
                const a = P[e.from], b = P[e.to]; if (!a || !b) return null;
                const st = EDGE_STYLE[e.kind] || EDGE_STYLE.physical;
                const active = focusId && (e.from === focusId || e.to === focusId);
                const dim = focusId && !active;
                const col = active ? theme.accent : (dark ? '#7f93ac' : '#94a3b8');
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                return (
                  <g key={i} opacity={dim ? 0.12 : 1}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={active ? st.width + 0.8 : st.width} strokeDasharray={st.dash} opacity={active ? 0.9 : st.opacity} />
                    {active && <text x={mx} y={my - 3} textAnchor="middle" fontSize="9" fill={col} style={{ pointerEvents: 'none', fontWeight: 600 }}>{e.label}</text>}
                  </g>
                );
              })}
              {/* nodes */}
              {nodes.map((n) => {
                const p = P[n.id]; if (!p) return null;
                const c = cats[n.category]?.color || theme.accent;
                const r = nodeSize(n);
                const dim = isDim(n.id) || !matches(n);
                const isSel = sel === n.id;
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.22 : 1}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, n.id); }}
                    onPointerUp={(e) => { e.stopPropagation(); onPointerUp(e, n.id); }}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                    <circle r={r + (isSel ? 6 : 0)} fill={dark ? '#0e1a29' : '#ffffff'} stroke={c} strokeWidth={isSel ? 3 : 2} />
                    <circle r={r} fill={c} opacity={0.16} />
                    {n.role === 'hub' && <circle r={r - 6} fill={c} opacity={0.22} />}
                    <text textAnchor="middle" y={r + 13} fontSize="11" fontWeight="700" fill={dark ? '#dce6f2' : '#1e293b'} style={{ pointerEvents: 'none' }}>{n.label}</text>
                    <text textAnchor="middle" y="4" fontSize="9" fill={c} fontWeight="700" style={{ pointerEvents: 'none' }}>{(cats[n.category]?.label || '').slice(0, 3).toUpperCase()}</text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* legend */}
          <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 p-2.5 rounded-xl text-[10px]"
            style={{ background: dark ? 'rgba(10,16,26,.72)' : 'rgba(255,255,255,.82)', border: `1px solid ${stroke}`, backdropFilter: 'blur(6px)' }}>
            <div className="flex flex-wrap gap-x-3 gap-y-1 max-w-[320px]">
              {Object.entries(cats).map(([k, c]) => (
                <span key={k} className="inline-flex items-center gap-1" style={{ color: dark ? '#c7d3e2' : '#334155' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />{c.label}
                </span>
              ))}
            </div>
            <div className="flex gap-3 pt-1" style={{ borderTop: `1px solid ${stroke}`, color: dark ? '#8ea3bd' : '#64748b' }}>
              <span className="inline-flex items-center gap-1"><svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.8" /></svg>Modeled</span>
              <span className="inline-flex items-center gap-1"><svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.4" strokeDasharray="4 3" /></svg>Logical</span>
              <span className="inline-flex items-center gap-1"><svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" /></svg>Temporal</span>
            </div>
          </div>
          {/* controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.4, v.k * 1.15) }))} className="w-8 h-8 rounded-lg grid place-items-center font-bold" style={{ background: dark ? 'rgba(10,16,26,.72)' : 'rgba(255,255,255,.85)', border: `1px solid ${stroke}`, color: theme.mode === 'light' ? '#334155' : '#c7d3e2' }}>+</button>
            <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k * 0.87) }))} className="w-8 h-8 rounded-lg grid place-items-center font-bold" style={{ background: dark ? 'rgba(10,16,26,.72)' : 'rgba(255,255,255,.85)', border: `1px solid ${stroke}`, color: theme.mode === 'light' ? '#334155' : '#c7d3e2' }}>−</button>
            <button onClick={() => { setView({ x: 0, y: 0, k: 1 }); reheat(); }} title="Re-layout" className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: dark ? 'rgba(10,16,26,.72)' : 'rgba(255,255,255,.85)', border: `1px solid ${stroke}`, color: theme.mode === 'light' ? '#334155' : '#c7d3e2' }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        {/* detail panel */}
        <div className="w-80 shrink-0 overflow-y-auto p-4" style={{ background: bgPanel, borderLeft: `1px solid ${stroke}` }}>
          {!selNode ? (
            <div className={`text-sm ${theme.sub} space-y-3`}>
              <p>Click any entity to inspect its columns and relationships, or ask the AI about it.</p>
              <div className="space-y-1.5">
                {Object.entries(cats).map(([k, c]) => (
                  <div key={k} className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: c.color }} />
                    <div><b style={{ color: c.color }}>{c.label}</b> <span className="opacity-80">— {c.blurb}</span></div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: `${cats[selNode.category]?.color}22`, color: cats[selNode.category]?.color }}>{cats[selNode.category]?.label}</span>
                {selNode.role === 'hub' && <span className={`text-[10px] ${theme.sub}`}>hub</span>}
              </div>
              <div className={`text-lg font-extrabold ${theme.heading}`}>{selNode.label}</div>
              <div className={`text-[11px] font-mono ${theme.sub}`}>{selNode.table}{selNode.source ? ` · ${selNode.source}` : ''}</div>
              <div className={`text-[12px] mt-2 ${theme.heading}`} style={{ opacity: 0.9 }}>{selNode.description}</div>
              <div className={`text-[11px] mt-1 ${theme.sub}`}>Grain: {selNode.grain || '—'}</div>

              {/* relationships */}
              <div className={`text-[10px] uppercase tracking-widest font-bold mt-4 mb-1.5 ${theme.sub}`}>Relationships</div>
              <div className="space-y-1">
                {edges.filter((e) => e.from === selNode.id || e.to === selNode.id).map((e, i) => {
                  const out = e.from === selNode.id; const other = out ? e.to : e.from;
                  return (
                    <button key={i} onClick={() => setSel(other)} className="w-full text-left text-[12px] rounded-lg px-2 py-1.5 flex items-center gap-1.5 hover:opacity-100"
                      style={{ background: dark ? 'rgba(255,255,255,.04)' : '#f1f5f9', border: `1px solid ${stroke}` }}>
                      <span style={{ color: theme.sub ? undefined : undefined, opacity: 0.7 }} className={theme.sub}>{out ? '→' : '←'}</span>
                      <span className={theme.heading}>{byId[other]?.label}</span>
                      <span className={`ml-auto text-[10px] ${theme.sub}`}>{e.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* columns */}
              <div className={`text-[10px] uppercase tracking-widest font-bold mt-4 mb-1.5 ${theme.sub}`}>Columns ({selNode.columns.length})</div>
              <div className="space-y-0.5">
                {selNode.columns.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 text-[12px] py-0.5">
                    <span className={`font-mono ${theme.heading}`}>{c.name}</span>
                    {c.key === 'pk' && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#ffcc4d22', color: '#e0a800' }}>PK</span>}
                    {c.key === 'fk' && <span className="text-[9px] font-bold px-1 rounded" style={{ background: `${theme.accent}22`, color: theme.accent }}>FK</span>}
                    <span className={`ml-auto text-[10px] ${theme.sub}`}>{c.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildEntityQuestion(n, edges, byId) {
  const rels = edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => {
    const out = e.from === n.id; const other = out ? e.to : e.from;
    return `${out ? '' : (byId[other]?.label || other) + ' '}${e.label}${out ? ' ' + (byId[other]?.label || other) : ''}`;
  });
  const cols = n.columns.slice(0, 12).map((c) => c.name).join(', ');
  return `In the OneGrid data model, explain the "${n.label}" entity (table \`${n.table}\`). Grain: ${n.grain}. Key columns: ${cols}. Relationships: ${rels.join('; ')}. What does it represent, and what business questions can I answer by joining it with related entities?`;
}
