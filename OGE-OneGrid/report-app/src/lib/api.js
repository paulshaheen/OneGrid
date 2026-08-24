// Data access: REST fetch hooks + realtime WebSocket client.
import { useEffect, useRef, useState, useCallback } from 'react';

const API = ''; // same origin (vite proxies /api and /ws to the backend)

export async function getJson(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

export async function postJson(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

// Generic polling hook.
export function useApi(path, { pollMs = 0, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await getJson(path); if (alive) { setData(d); setError(null); } }
      catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setLoading(false); }
    };
    load();
    const t = pollMs ? setInterval(load, pollMs) : null;
    return () => { alive = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pollMs, ...deps]);
  return { data, error, loading };
}

// Poll the backend liveness probe so the app can show a clear banner when the Fabric
// capacity is paused (e.g. auto-paused outside operating hours) instead of blank values.
export function useCapacityStatus(pollMs = 30000) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await getJson('/api/status');
        if (alive) setStatus(s);
      } catch {
        // If even the probe endpoint is unreachable, the backend/data plane is down — surface a
        // neutral connection notice rather than falsely claiming the capacity is paused.
        if (alive) setStatus({ ok: false, connectionError: true, capacityPaused: false, message: 'Live data is unavailable — the app backend could not be reached.' });
      }
    };
    load();
    const t = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs]);
  return status;
}

// Realtime WebSocket: subscribe to a set of tags, receive live values + fleet pulse.
export function useRealtime() {
  const [connected, setConnected] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [values, setValues] = useState({}); // tag -> {value, ts}
  const wsRef = useRef(null);
  const tagsRef = useRef([]);

  useEffect(() => {
    let stop = false;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/realtime`);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); if (tagsRef.current.length) ws.send(JSON.stringify({ type: 'subscribe', tags: tagsRef.current })); };
      ws.onclose = () => { setConnected(false); if (!stop) setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'pulse') setPulse(m.pulse);
        if (m.type === 'tags') setValues((prev) => {
          const next = { ...prev };
          const rx = Date.now();
          for (const v of m.values) {
            const old = prev[v.tag];
            const changed = !old || old.value !== v.value;
            next[v.tag] = { value: v.value, ts: v.ts, plant: v.plant, rxAt: rx, changedAt: changed ? rx : (old?.changedAt || 0) };
          }
          return next;
        });
      };
    };
    connect();
    return () => { stop = true; wsRef.current && wsRef.current.close(); };
  }, []);

  const subscribe = useCallback((tags) => {
    tagsRef.current = tags;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', tags }));
  }, []);

  return { connected, pulse, values, subscribe };
}
