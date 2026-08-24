// Real-time streamer. Clients subscribe to a set of tags; the server pushes a
// smooth 1-second live value for each over a WebSocket, plus a fleet "pulse".
//
// Fabric Eventhouse streaming ingestion lags ~30-40s and the synthetic feed is
// 1-minute resolution, so polling KQL cannot produce smooth per-second motion.
// Instead we seed each tag baseline + variability from REAL recent history
// (tagStats) and run a mean-reverting (Ornstein-Uhlenbeck) live-tick simulator
// that drifts each value once per second around its real anchor. We re-anchor to
// real data every 60s so the stream tracks genuine drift/anomalies over time.
import { WebSocketServer } from 'ws';
import { tagStats, realtimePulse } from './dataApi.js';

const TICK_MS = 1000;      // 1-second live resolution
const RESEED_MS = 60000;   // re-anchor to real last-known values every minute
const THETA = 0.08;        // mean-reversion strength per tick
const SIGMA = 0.06;        // per-tick noise as a fraction of the tag sd

function gaussian() { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws/realtime' });
  const subs = new Map();       // ws -> Set(tags)
  const sim = new Map();        // tag -> { value, mean, sd, min, max, range, seededAt }
  const pending = new Set();    // tags awaiting a stats seed

  wss.on('connection', (ws) => {
    subs.set(ws, new Set());
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(String(buf)); } catch { return; }
      if (msg.type === 'subscribe' && Array.isArray(msg.tags)) {
        const set = new Set(msg.tags.slice(0, 400));
        subs.set(ws, set);
        for (const t of set) if (!sim.has(t)) pending.add(t);
        seedPending();
      }
      if (msg.type === 'clear') subs.set(ws, new Set());
    });
    ws.on('close', () => subs.delete(ws));
    ws.on('error', () => subs.delete(ws));
  });

  let seeding = false;
  async function seedPending() {
    if (seeding || !pending.size) return;
    seeding = true;
    try {
      const batch = [...pending].slice(0, 400);
      const stats = await tagStats(batch);
      const now = Date.now();
      for (const t of batch) {
        pending.delete(t);
        const s = stats[t];
        if (!s) { sim.set(t, { value: null, mean: null, sd: 0, min: null, max: null, range: 1, seededAt: now }); continue; }
        const range = (s.max - s.min) || Math.abs(s.value) * 0.02 || 1;
        const sd = s.sd && s.sd > 0 ? s.sd : range * 0.05;
        sim.set(t, { value: s.value, mean: s.mean, sd, min: s.min, max: s.max, range, seededAt: now });
      }
    } catch { /* transient */ }
    seeding = false;
    if (pending.size) setTimeout(seedPending, 500);
  }

  function tick(st) {
    if (st.value === null || st.mean === null) return st.value;
    const noise = SIGMA * st.sd * gaussian();
    let v = st.value + THETA * (st.mean - st.value) + noise;
    const pad = (st.range || st.sd * 4) * 0.15;
    const lo = st.min - pad, hi = st.max + pad;
    if (v < lo) v = lo + Math.abs(noise);
    if (v > hi) v = hi - Math.abs(noise);
    st.value = v;
    return v;
  }

  function round(v) {
    if (v === null) return null;
    const a = Math.abs(v);
    const d = a >= 1000 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
    return Number(v.toFixed(d));
  }

  const activeTags = () => { const all = new Set(); for (const set of subs.values()) for (const t of set) all.add(t); return all; };

  const pushTick = () => {
    const all = activeTags();
    if (!all.size) return;
    const snap = {};
    for (const t of all) { const st = sim.get(t); if (st) snap[t] = { tag: t, value: round(tick(st)), ts: new Date().toISOString() }; }
    for (const [ws, set] of subs.entries()) {
      if (ws.readyState !== ws.OPEN || !set.size) continue;
      const values = [...set].map((t) => snap[t]).filter((x) => x && x.value != null);
      if (values.length) ws.send(JSON.stringify({ type: 'tags', ts: Date.now(), values }));
    }
  };

  const reseed = () => { const all = activeTags(); for (const t of all) pending.add(t); seedPending(); };

  const pushPulse = async () => {
    try {
      const pulse = await realtimePulse();
      const msg = JSON.stringify({ type: 'pulse', ts: Date.now(), pulse });
      for (const ws of subs.keys()) if (ws.readyState === ws.OPEN) ws.send(msg);
    } catch { /* transient */ }
  };

  const t1 = setInterval(pushTick, TICK_MS);
  const t2 = setInterval(pushPulse, 5000);
  const t3 = setInterval(reseed, RESEED_MS);
  return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); wss.close(); };
}
