// Pure formatting helpers for the Infrastructure plane (kept out of infra-ui.tsx
// so that component files only export components — React Fast Refresh friendly).

export function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 100) return Math.round(v).toString();
  if (a >= 10) return (Math.round(v * 10) / 10).toString();
  return (Math.round(v * 100) / 100).toString();
}

export function fmtCost(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function fmtRelTime(minAgo: number): string {
  if (minAgo < 60) return `${Math.round(minAgo)}m ago`;
  if (minAgo < 1440) return `${Math.round(minAgo / 60)}h ago`;
  return `${Math.round(minAgo / 1440)}d ago`;
}

export function fmtMsAgo(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.max(0, Math.round(s))}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}
