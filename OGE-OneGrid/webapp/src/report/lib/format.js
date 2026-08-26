// Shared formatting + status helpers.
// Each status carries a distinct SHAPE as well as a color, so meaning survives without
// color perception (colorblind-safe): healthy = check, watch = triangle, critical = octagon.
export const STATUS = {
  ok: { label: 'Healthy', color: '#2fd07a', glow: 'rgba(47,208,122,.5)', ring: 'ring-emerald-400/40', shape: 'check' },
  watch: { label: 'Watch', color: '#ffcc4d', glow: 'rgba(255,204,77,.5)', ring: 'ring-amber-400/40', shape: 'triangle' },
  critical: { label: 'Critical', color: '#ff5470', glow: 'rgba(255,84,112,.55)', ring: 'ring-rose-400/40', shape: 'octagon' },
};
export const statusOf = (s) => STATUS[s] || STATUS.ok;

export const fmt = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });

export const fmtInt = (v) => (v === null || v === undefined ? '—' : Math.round(Number(v)).toLocaleString());

export const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v))}%`);

export function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Rank assets worst-first for "what to watch".
export function rankAssets(assets = []) {
  const w = { critical: 0, watch: 1, ok: 2 };
  return [...assets].sort((a, b) => (w[a.status] - w[b.status]) || (b.anom_n || 0) - (a.anom_n || 0) || (a.health ?? 100) - (b.health ?? 100));
}

export function counts(assets = []) {
  const c = { ok: 0, watch: 0, critical: 0 };
  for (const a of assets) c[a.status] = (c[a.status] || 0) + 1;
  return c;
}
