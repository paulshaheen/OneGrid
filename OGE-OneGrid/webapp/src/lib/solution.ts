// Active "solution" store — the single seam that flips the whole app between the
// Energy (live electric) and Oil & Gas (sample estate) experiences. Both data
// planes consult it: useSampleData() (ops console services) and the report/twin
// api.js backend switch. It resolves the active solution with precedence:
//
//   1. URL param  ?solution=energy|og   (shareable links; wins for the visit)
//   2. saved profile choice (localStorage)
//   3. the deployment default injected onto window.__APP_CONFIG__ (energy unless
//      a sample-only deploy says otherwise)
//
// Switching is a whole-app context change (entire dataset + branding), so the
// profile toggle navigates to ?solution=<next> and reloads — every query then
// refetches under the new services with no stale cross-solution data.
import { useSyncExternalStore } from "react";

export type Solution = "energy" | "og";

const KEY = "og.solution";
const PARAM = "solution";
const listeners = new Set<() => void>();

declare global {
  interface Window {
    __APP_CONFIG__?: { defaultSolution?: string; solution?: string } & Record<string, unknown>;
  }
}

function normalize(v: string | null | undefined): Solution | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === "og" || s === "oil-and-gas" || s === "oilgas" || s === "oil" || s === "gom") return "og";
  if (s === "energy" || s === "electric" || s === "power" || s === "grid") return "energy";
  return null;
}

function fromParam(): Solution | null {
  if (typeof window === "undefined") return null;
  try {
    return normalize(new URLSearchParams(window.location.search).get(PARAM));
  } catch {
    return null;
  }
}

function fromStorage(): Solution | null {
  if (typeof window === "undefined") return null;
  try {
    return normalize(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** The deployment default: energy, unless the SSR shell flags a sample-only deploy. */
function deployDefault(): Solution {
  const cfg = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;
  return normalize(cfg?.solution) ?? normalize(cfg?.defaultSolution) ?? "energy";
}

function resolve(): Solution {
  return fromParam() ?? fromStorage() ?? deployDefault();
}

// Resolve once at module init on the client. When a URL param is present, persist
// it so the choice sticks across in-app navigation (the param may drop on SPA nav).
let solution: Solution = typeof window === "undefined" ? "energy" : resolve();
if (typeof window !== "undefined") {
  const param = fromParam();
  if (param && param !== fromStorage()) {
    try {
      localStorage.setItem(KEY, param);
    } catch {
      /* ignore */
    }
  }
}

export function getSolution(): Solution {
  return solution;
}

export function isOilAndGas(): boolean {
  return solution === "og";
}

/** Persist the choice without reloading (used internally / for tests). */
export function setSolution(next: Solution): void {
  solution = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/**
 * Switch solutions from the UI: persist the choice, put it on the URL (shareable +
 * SSR-visible on the fresh load), and reload so every data plane rebinds cleanly.
 */
export function switchSolution(next: Solution): void {
  if (next === solution) return;
  setSolution(next);
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, next);
    window.location.assign(url.toString());
  } catch {
    window.location.reload();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive active solution. Server snapshot is the default so hydration is stable. */
export function useSolution(): Solution {
  return useSyncExternalStore(subscribe, getSolution, () => "energy");
}

/** Branding for the active solution: wordmark suffix + accent, product name, domain. */
export function solutionBrand(s: Solution): { word: string; name: string; domain: string; accent: string } {
  return s === "og"
    ? { word: "FIELD", name: "OneField", domain: "Oil & Gas", accent: "#f59e0b" }
    : { word: "GRID", name: "OneGrid", domain: "Energy", accent: "#38bdf8" };
}
