// Shared "3D Model Resolution" preference (profile menu).
//   high = photoreal Sketchfab GLBs (new)   ·   low = original procedural models
// Framework-light store so both the shadcn AppShell (tsx) and the report twin (jsx)
// can read/subscribe without a provider. Persisted to localStorage.
import { useSyncExternalStore } from "react";

export type ModelRes = "high" | "low";

const KEY = "og.modelRes";
const listeners = new Set<() => void>();

function read(): ModelRes {
  if (typeof window === "undefined") return "high";
  try {
    return localStorage.getItem(KEY) === "low" ? "low" : "high";
  } catch {
    return "high";
  }
}

let current: ModelRes = read();

export function getModelRes(): ModelRes {
  return current;
}

export function setModelRes(next: ModelRes): void {
  if (next !== "high" && next !== "low") return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive hook: re-renders when the preference changes. */
export function useModelRes(): ModelRes {
  return useSyncExternalStore(subscribe, getModelRes, () => "high");
}
