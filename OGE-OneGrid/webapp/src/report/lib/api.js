// Client-side data access compat layer. Same public surface as the original report-app
// lib/api.js (getJson/postJson/useApi/useCapacityStatus/useRealtime) but served entirely
// from the deterministic sample provider — no backend. This lets every ported persona and
// component run unchanged inside the OneGrid webapp.
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import * as sample from "./sample.js";
import ontology from "./ontology.json";
import { governanceRoute } from "./governance-sample.js";

function parse(path) {
  const [p, qs] = String(path).split("?");
  return { p, params: new URLSearchParams(qs || "") };
}

// Runtime switch: when the OneGrid report-app backend is serving this webapp
// (deployed mode) the SSR shell sets window.__APP_CONFIG__.reportApiEnabled, so
// every persona reads live Fabric/Eventhouse/PBI data through the same-origin
// /api. Standalone / marketing builds leave it unset and use the sample provider.
function backendEnabled() {
  return typeof window !== "undefined" && !!window.__APP_CONFIG__ && !!window.__APP_CONFIG__.reportApiEnabled;
}

// Central resolver: path -> sample data (exact shapes from the original dataApi).
export function resolve(path) {
  const { p, params } = parse(path);
  if (p === "/api/status") return { ok: true, capacityPaused: false };
  if (p === "/api/facility-model") return sample.facilityModel();
  if (p === "/api/fleet-assets") return sample.fleetAssets();
  if (p === "/api/fleet-health") return sample.fleetHealth();
  if (p === "/api/narrative") return sample.narrative();
  if (p === "/api/predictions") return sample.predictionsDetail();
  if (p === "/api/work-orders-summary") return sample.workOrdersSummary();
  if (p === "/api/work-orders") return sample.workOrders(Number(params.get("limit")) || 80);
  if (p === "/api/watchlist") return sample.watchlistTop(Number(params.get("limit")) || 60);
  if (p === "/api/anomalies") return sample.anomaliesTop(Number(params.get("limit")) || 60);
  if (p === "/api/outages") return sample.outages();
  if (p === "/api/ontology") return ontology;
  if (p === "/api/manuals/health") return { enabled: false, categories: [] };
  if (p === "/api/tag-values") return sample.tagValues(params.get("tags") || "");
  if (p === "/api/tag-trend")
    return sample.tagTrend(
      params.get("tag"),
      Number(params.get("hours")) || 24,
      Number(params.get("bin")) || 15,
    );
  if (p.startsWith("/api/asset-workorders/"))
    return sample.assetWorkOrders(decodeURIComponent(p.slice("/api/asset-workorders/".length)));
  if (p.startsWith("/api/asset/"))
    return sample.assetDetail(decodeURIComponent(p.slice("/api/asset/".length)));
  if (p.startsWith("/api/governance/")) return governanceRoute(p, params);
  return null;
}

export async function getJson(path) {
  if (backendEnabled()) {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }
  const data = resolve(path);
  if (data === null) throw new Error(`${path} -> 404 (no sample provider)`);
  return data;
}
export async function postJson(path, body) {
  if (backendEnabled()) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json().catch(() => ({ ok: true }));
  }
  // feedback / chat / ask-ontology are no-ops in the sample environment.
  return { ok: true };
}

export function useApi(path, { pollMs = 0, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await getJson(path);
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = pollMs ? setInterval(load, pollMs) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pollMs, ...deps]);
  return { data, error, loading };
}

export function useCapacityStatus() {
  return { ok: true, capacityPaused: false };
}

// Realtime: subscribe to a set of tags, receive live values + fleet pulse from the
// in-browser Ornstein-Uhlenbeck simulator. useSyncExternalStore re-renders on each tick.
export function useRealtime() {
  const subStore = useCallback((cb) => sample.simulator.onChange(cb), []);
  const getSnap = useCallback(() => sample.simulator.pulse, []);
  useSyncExternalStore(subStore, getSnap, getSnap);
  const subscribe = useCallback((tags) => sample.simulator.subscribe(tags), []);
  return {
    connected: true,
    pulse: sample.simulator.pulse,
    values: sample.simulator.values,
    subscribe,
  };
}
