// ---------------------------------------------------------------------------
//  Realtime simulator for the Infrastructure plane. A single mean-reverting
//  random walk drives every asset metric so the Operations view, 3D scene and
//  detail panels all read "live" from one store (useSyncExternalStore -> one
//  re-render per tick, not per subscriber). A separate slow loop tails the log
//  stream. Self-contained — no backend — so it works in sample + deployed modes.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";

import {
  ASSETS,
  type InfraAsset,
  type InfraStatus,
  metricStatus,
  STATUS_RANK,
  nextLog,
  seedLogs,
  type LogEntry,
} from "./infra-data";

type Listener = () => void;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function key(assetId: string, metricKey: string): string {
  return `${assetId}:${metricKey}`;
}

// ── live metric store ──────────────────────────────────────────────────────
const liveStore = (() => {
  const cur: Record<string, number> = {};
  for (const a of ASSETS) {
    for (const m of a.metrics) {
      cur[key(a.id, m.key)] = m.value;
    }
  }
  const listeners = new Set<Listener>();
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const obj = {
    version: 0,
    get(assetId: string, metricKey: string): number {
      return cur[key(assetId, metricKey)] ?? 0;
    },
    tick() {
      for (const a of ASSETS) {
        // Offline assets flatline; everything else mean-reverts toward its
        // authored base value with light noise, clamped to [min,max]. Assets that
        // are already warning/critical get a touch more variance so the UI shimmers.
        const volatility = a.status === "critical" ? 0.05 : a.status === "warning" ? 0.035 : 0.02;
        for (const m of a.metrics) {
          const k = key(a.id, m.key);
          if (a.status === "offline") {
            cur[k] = m.value;
            continue;
          }
          const noise = (Math.random() - 0.5) * (m.max - m.min) * volatility;
          const prev = cur[k] ?? m.value;
          const reverted = prev + (m.value - prev) * 0.18 + noise;
          cur[k] = clamp(reverted, m.min, m.max);
        }
      }
      obj.version++;
      listeners.forEach((l) => l());
    },
    subscribe(cb: Listener): () => void {
      listeners.add(cb);
      if (!started) {
        started = true;
        timer = setInterval(() => obj.tick(), 2000);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
          started = false;
        }
      };
    },
  };
  return obj;
})();

/** Re-render on each live tick (every 2s). */
export function useLiveTick(): number {
  return useSyncExternalStore(
    (cb) => liveStore.subscribe(cb),
    () => liveStore.version,
    () => 0,
  );
}

/** Current simulated value for one metric. */
export function liveValue(assetId: string, metricKey: string): number {
  return liveStore.get(assetId, metricKey);
}

/** Live status for an asset: the worst of its authored status and any metric
 *  that has crossed a threshold in the simulation. */
export function liveAssetStatus(asset: InfraAsset): InfraStatus {
  let worst = asset.status;
  if (asset.status === "offline") return "offline";
  for (const m of asset.metrics) {
    const s = metricStatus(m, liveStore.get(asset.id, m.key));
    if (STATUS_RANK[s] < STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

// ── log tail store ──────────────────────────────────────────────────────────
const MAX_LOGS = 240;
const logStore = (() => {
  let buffer: LogEntry[] = seedLogs();
  const listeners = new Set<Listener>();
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const obj = {
    version: 0,
    snapshot(): LogEntry[] {
      return buffer;
    },
    subscribe(cb: Listener): () => void {
      listeners.add(cb);
      if (!started) {
        started = true;
        timer = setInterval(() => {
          // Age existing entries, drop the oldest, prepend 1-2 new lines.
          const n = 1 + (Math.random() < 0.4 ? 1 : 0);
          const fresh: LogEntry[] = [];
          for (let i = 0; i < n; i++) fresh.push(nextLog());
          buffer = [...fresh, ...buffer.map((l) => ({ ...l, tsMsAgo: l.tsMsAgo + 3000 }))].slice(
            0,
            MAX_LOGS,
          );
          obj.version++;
          listeners.forEach((l) => l());
        }, 3000);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
          started = false;
        }
      };
    },
  };
  return obj;
})();

/** Subscribe to the live-tailing log buffer (newest first). */
export function useLogTail(): LogEntry[] {
  const empty: LogEntry[] = [];
  return useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.snapshot(),
    () => empty,
  );
}
