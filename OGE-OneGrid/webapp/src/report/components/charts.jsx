import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

const tip = (theme) => ({
  contentStyle: { background: 'rgba(12,18,28,.92)', border: `1px solid ${theme.chart.grid}`, borderRadius: 10, fontSize: 12, color: '#e6edf3' },
  labelStyle: { color: theme.chart.axis },
});

export function Donut({ theme, data, height = 180 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={3} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip {...tip(theme)} formatter={(v, n) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function AreaTrend({ theme, data, xKey = 'ts', yKey = 'v', height = 90, color }) {
  const c = color || theme.chart.series[0];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`g-${c}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.5} />
            <stop offset="100%" stopColor={c} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={yKey} stroke={c} strokeWidth={2} fill={`url(#g-${c})`} isAnimationActive={false} dot={false} />
        <Tooltip {...tip(theme)} />
        <XAxis dataKey={xKey} hide />
        <YAxis hide domain={['auto', 'auto']} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Bars({ theme, data, xKey = 'name', yKey = 'value', height = 160 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke={theme.chart.grid} />
        <XAxis dataKey={xKey} tick={{ fill: theme.chart.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: theme.chart.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip {...tip(theme)} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
        <Bar dataKey={yKey} radius={[5, 5, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color || theme.chart.series[i % theme.chart.series.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, color = '#4be1ff', height = 34, yKey = 'v' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={1.8} dot={false} isAnimationActive={false} />
        <YAxis hide domain={['auto', 'auto']} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Interactive "sundial" sunburst ────────────────────────────────────────
// Inner ring = status groups (sized by count); outer ring = individual assets
// (colored by condition). Click a group to explode it; click an asset segment
// to open it. Pure SVG so it stays crisp and fully controllable.
const TAU = Math.PI * 2;
function arcPath(cx, cy, rIn, rOut, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0o, y0o] = p(rOut, a0), [x1o, y1o] = p(rOut, a1);
  const [x0i, y0i] = p(rIn, a1), [x1i, y1i] = p(rIn, a0);
  return `M${x0o},${y0o} A${rOut},${rOut} 0 ${large} 1 ${x1o},${y1o} L${x0i},${y0i} A${rIn},${rIn} 0 ${large} 0 ${x1i},${y1i} Z`;
}
const STATUS_COLOR = { critical: '#ff5470', watch: '#ffcc4d', ok: '#2fd07a' };
const STATUS_LABEL = { critical: 'Critical', watch: 'Watch', ok: 'Healthy' };
const worst = (statuses) => statuses.reduce((s, x) => (x === 'critical' ? 'critical' : s === 'critical' ? 'critical' : x === 'watch' ? 'watch' : s), 'ok');

// Hierarchical "sundial": Fleet › Site › Unit › Equipment. Click a ring segment to
// drill down (site → unit → equipment); click an equipment segment to open it; click
// the center to go back up. Inner ring = current level's children, outer ring = the
// next level down for context.
export function Sunburst({ theme, assets = [], size = 260, centerValue, centerLabel, onAsset }) {
  const cx = size / 2, cy = size / 2;
  const [path, setPath] = useState([]); // [] fleet · [plant] · [plant, unit]
  const [dir, setDir] = useState(1);    // drill direction: 1 = down/explode, -1 = up/collapse
  const [hover, setHover] = useState(null); // { x, y, label, status, sub }
  const [centerHover, setCenterHover] = useState(false);
  const go = (next, d) => { setDir(d); setPath(next); setHover(null); };

  // build plant → unit → asset tree
  const tree = useMemo(() => {
    const plants = {};
    for (const a of assets) {
      const P = (plants[a.plant] ||= { name: a.plant, units: {} });
      const U = (P.units[a.unit] ||= { name: a.unit, assets: [] });
      U.assets.push(a);
    }
    return Object.values(plants).map((p) => {
      const units = Object.values(p.units).map((u) => ({ ...u, status: worst(u.assets.map((a) => a.status || 'ok')), count: u.assets.length, alerts: u.assets.filter((a) => a.status === 'critical').length }));
      return { ...p, units, status: worst(units.map((u) => u.status)), count: units.reduce((s, u) => s + u.count, 0), alerts: units.reduce((s, u) => s + u.alerts, 0) };
    });
  }, [assets]);

  // resolve the current node + its children (level-aware) and grandchildren (outer ring)
  const level = path.length; // 0 fleet, 1 plant, 2 unit
  const plantNode = level >= 1 ? tree.find((p) => p.name === path[0]) : null;
  const unitNode = level >= 2 && plantNode ? plantNode.units.find((u) => u.name === path[1]) : null;

  let children = [], titleLabel = centerLabel, titleValue = centerValue;
  if (level === 0) {
    children = tree.map((p) => ({ key: p.name, label: p.name, status: p.status, weight: p.count, node: p, kind: 'plant', alerts: p.alerts }));
  } else if (level === 1 && plantNode) {
    children = plantNode.units.map((u) => ({ key: u.name, label: u.name, status: u.status, weight: u.count, node: u, kind: 'unit', alerts: u.alerts }));
    titleLabel = path[0]; titleValue = `${plantNode.count}`;
  } else if (level === 2 && unitNode) {
    children = unitNode.assets.map((a) => ({ key: a.asset_id, label: a.name, status: a.status || 'ok', weight: 1, asset: a, kind: 'asset', alerts: a.status === 'critical' ? 1 : 0 }));
    titleLabel = path.join(' · '); titleValue = `${unitNode.assets.length}`;
  }
  // sort worst-first for a readable ring
  const rank = (s) => (s === 'critical' ? 0 : s === 'watch' ? 1 : 2);
  children = [...children].sort((a, b) => rank(a.status) - rank(b.status));

  const totalW = children.reduce((s, c) => s + (c.weight || 1), 0) || 1;
  const gap = 0.012 * TAU;
  // single ring: start with just the parent level; a click explodes it to the next level
  const rC = size * 0.24, rIn0 = size * 0.28, rIn1 = size * 0.48;

  let a = -Math.PI / 2;
  const innerArcs = children.map((c) => {
    const frac = (c.weight || 1) / totalW;
    const a0 = a + gap / 2, a1 = a + frac * TAU - gap / 2, span = [a, a + frac * TAU]; a += frac * TAU;
    return { c, a0, a1, span };
  });

  const clickInner = (c) => { if (c.kind === 'asset') onAsset && onAsset(c.asset); else go([...path, c.key], 1); };
  const stroke = theme.persona === 'executive' ? '#fff' : '#0b1420';
  const labelFill = theme.persona === 'executive' ? '#0b1420' : '#e6edf3';
  const at = (r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
  const alertText = (c) => (c.kind === 'asset' ? STATUS_LABEL[c.status] : c.alerts ? `${c.alerts} alert${c.alerts > 1 ? 's' : ''}` : 'no alerts');
  const move = (e, label, status, sub) => {
    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, label, status, sub });
  };
  // Leader-line callouts: place each wedge's label OUTSIDE the ring (with a connector line)
  // so text isn't cramped/truncated inside the band. Drop the redundant "<unit> Unit N"
  // prefix (already shown in the breadcrumb), then de-collide labels vertically per side.
  const stripUnit = (sName) => String(sName || '').replace(/^\w+\s+Unit\s+\d+\s+/i, '');
  const rOut = rIn1;
  const callouts = innerArcs.map((ia) => {
    const midA = (ia.a0 + ia.a1) / 2;
    const side = Math.cos(midA) >= 0 ? 1 : -1;
    const [rx, ry] = at(rOut, midA);
    const [ex, ey] = at(rOut + size * 0.04, midA);
    const labelX = cx + side * (size * 0.5 + size * 0.05);
    const name = ia.c.kind === 'asset' ? stripUnit(ia.c.label) : ia.c.label;
    return { key: ia.c.key, c: ia.c, side, rx, ry, ex, ey, y: ey, labelX, name };
  });
  for (const dirn of [1, -1]) {
    const arr = callouts.filter((o) => o.side === dirn).sort((a, b) => a.y - b.y);
    const gap = size * 0.115;
    for (let k = 1; k < arr.length; k++) if (arr[k].y - arr[k - 1].y < gap) arr[k].y = arr[k - 1].y + gap;
    if (arr.length) {
      const over = arr[arr.length - 1].y - (cy + size * 0.5 - 4);
      if (over > 0) arr.forEach((o) => { o.y -= over; });
      const under = (cy - size * 0.5 + 4) - arr[0].y;
      if (under > 0) arr.forEach((o) => { o.y += under; });
    }
  }
  const pathKey = 'lvl' + level + '|' + path.join('/');
  const ringVariants = {
    enter: (d) => ({ opacity: 0, scale: d >= 0 ? 0.18 : 1.85, rotate: d >= 0 ? -45 : 45 }),
    center: { opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 90, damping: 15, mass: 1.15, staggerChildren: 0.07, delayChildren: 0.18 } },
    exit: (d) => ({ opacity: 0, scale: d >= 0 ? 1.85 : 0.2, rotate: d >= 0 ? 40 : -40, transition: { duration: 0.5, ease: [0.4, 0, 0.9, 0.4] } }),
  };
  const arcVariants = {
    enter: { opacity: 0, scale: 0.82 },
    center: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 140, damping: 16 } },
    exit: { opacity: 0 },
  };

  return (
    <div className="relative flex flex-col items-center gap-2" onMouseLeave={() => { setHover(null); setCenterHover(false); }}>
      {/* Up-navigation: a clear Back button + clickable breadcrumb trail */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center text-[11px] min-h-[26px] px-2">
        {level > 0 && (
          <button onClick={() => go(path.slice(0, -1), -1)}
            className="inline-flex items-center gap-1 pl-1.5 pr-2.5 py-1 rounded-full font-bold transition hover:brightness-110"
            style={{ background: `${theme.accent}22`, color: theme.accent, border: `1px solid ${theme.accent}66` }}>
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Back
          </button>
        )}
        <button onClick={() => go([], -1)}
          className="px-2 py-0.5 rounded-full font-semibold transition hover:opacity-90"
          style={level === 0 ? { background: `${theme.accent}18`, color: theme.accent, border: `1px solid ${theme.accent}44` } : {}}>
          <span className={level === 0 ? '' : theme.sub}>Fleet</span>
        </button>
        {path.map((seg, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className={theme.sub}>›</span>
            <button onClick={() => go(path.slice(0, i + 1), -1)}
              className="px-2 py-0.5 rounded-full font-semibold transition hover:opacity-90"
              style={i === path.length - 1 ? { background: `${theme.accent}18`, color: theme.accent, border: `1px solid ${theme.accent}44` } : {}}>
              <span className={i === path.length - 1 ? '' : theme.sub}>{seg}</span>
            </button>
          </span>
        ))}
      </div>

      {/* Ring + center hub */}
      <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        <AnimatePresence custom={dir} initial={false}>
          <motion.g key={pathKey} custom={dir} variants={ringVariants} initial="enter" animate="center" exit="exit"
            style={{ transformBox: 'view-box', transformOrigin: `${cx}px ${cy}px` }}>
            {innerArcs.map((ia) => {
              const sub = ia.c.kind === 'asset'
                ? STATUS_LABEL[ia.c.status]
                : `${STATUS_LABEL[ia.c.status]} · ${ia.c.weight} ${ia.c.kind === 'plant' ? 'assets' : 'items'} · ${ia.c.alerts || 0} alert${ia.c.alerts === 1 ? '' : 's'}`;
              return (
                <motion.g key={ia.c.key} variants={arcVariants} style={{ transformBox: 'view-box', transformOrigin: `${cx}px ${cy}px` }}>
                  <path d={arcPath(cx, cy, rIn0, rIn1, ia.a0, ia.a1)} fill={STATUS_COLOR[ia.c.status]}
                    stroke={stroke} strokeWidth="0.7" style={{ cursor: 'pointer' }}
                    onClick={() => clickInner(ia.c)}
                    onMouseMove={(e) => move(e, ia.c.label, ia.c.status, sub)} />
                </motion.g>
              );
            })}
          </motion.g>
        </AnimatePresence>
        {/* leader-line callout labels outside the ring */}
        <motion.g key={'lbl' + pathKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.15 }}>
          {callouts.map((o) => {
            const col = STATUS_COLOR[o.c.status];
            const anchor = o.side > 0 ? 'start' : 'end';
            return (
              <g key={o.key} style={{ cursor: 'pointer' }} onClick={() => clickInner(o.c)}
                onMouseMove={(e) => move(e, o.c.label, o.c.status, o.c.kind === 'asset' ? STATUS_LABEL[o.c.status] : `${STATUS_LABEL[o.c.status]} · ${o.c.weight} · ${o.c.alerts || 0} alert${o.c.alerts === 1 ? '' : 's'}`)}>
                <polyline points={`${o.rx},${o.ry} ${o.ex},${o.ey} ${o.labelX},${o.y}`} fill="none" stroke={col} strokeWidth="1.3" opacity="0.85" />
                <circle cx={o.labelX} cy={o.y} r="2.6" fill={col} />
                <text x={o.labelX + o.side * 7} y={o.y - 1} textAnchor={anchor} dominantBaseline="middle"
                  fill={labelFill} fontSize={size * 0.05} fontWeight="700"
                  style={{ textShadow: theme.persona === 'executive' ? 'none' : '0 1px 2px rgba(0,0,0,.6)' }}>{trunc(o.name, 22)}</text>
                <text x={o.labelX + o.side * 7} y={o.y + size * 0.045} textAnchor={anchor} dominantBaseline="middle"
                  fill={col} fontSize={size * 0.036} fontWeight="600">{STATUS_LABEL[o.c.status]}</text>
              </g>
            );
          })}
        </motion.g>
        {/* center hub — doubles as the "up one level" control when drilled in */}
        <circle cx={cx} cy={cy} r={rC + 1.5} fill="none" stroke={theme.accent} strokeOpacity={level ? (centerHover ? 1 : 0.6) : 0.2} strokeWidth={level && centerHover ? 2.5 : 1.5} />
        <circle cx={cx} cy={cy} r={rC} fill={theme.persona === 'executive' ? (level && centerHover ? '#eef1ff' : '#fff') : (level && centerHover ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.04)')}
          style={{ cursor: level ? 'pointer' : 'default' }}
          onClick={() => level && go(path.slice(0, -1), -1)}
          onMouseEnter={() => level && setCenterHover(true)} onMouseLeave={() => setCenterHover(false)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center pointer-events-none px-2">
        <div>
          {level > 0 && (
            <div className="flex items-center justify-center gap-0.5 -mb-0.5 font-bold" style={{ color: theme.accent, opacity: centerHover ? 1 : 0.85 }}>
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="text-[9px] uppercase tracking-wider">Back</span>
            </div>
          )}
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div key={pathKey} custom={dir}
              initial={(d) => ({ opacity: 0, y: d >= 0 ? 12 : -12, scale: 0.82 })}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={(d) => ({ opacity: 0, y: d >= 0 ? -12 : 12, scale: 0.82 })}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
              <div className={`text-2xl font-extrabold tabular-nums ${theme.heading}`}>{titleValue}</div>
              <div className={`text-[10px] uppercase tracking-widest ${theme.sub} truncate max-w-[120px]`}>{titleLabel}</div>
            </motion.div>
          </AnimatePresence>
          {level === 0 && <div className={`text-[9px] mt-0.5 ${theme.sub}`}>click a site to drill</div>}
        </div>
      </div>
      {/* hover tooltip */}
      {hover && (
        <div className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap"
          style={{ left: hover.x + 12, top: hover.y + 8, background: 'rgba(10,15,24,.95)', border: `1px solid ${STATUS_COLOR[hover.status]}88`, boxShadow: '0 6px 20px rgba(0,0,0,.45)' }}>
          <div className="flex items-center gap-1.5 font-semibold" style={{ color: '#eef4fb' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[hover.status] }} />{hover.label}
          </div>
          <div style={{ color: STATUS_COLOR[hover.status] }} className="text-[10px] mt-0.5 font-medium">{hover.sub}</div>
        </div>
      )}
      </div>
    </div>
  );
}
