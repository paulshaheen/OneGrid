// Shared Light/Dark mode store. The shadcn shell flips via the `.dark` class on <html>;
// the ported report/twin components take a MODES theme object. This store is the single
// source of truth for both, so the profile toggle themes the ENTIRE app, not just the shell.
import { useSyncExternalStore } from "react";
import { MODES } from "@/report/lib/themes.js";

const KEY = "ops-theme";
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const s = localStorage.getItem(KEY);
    return s ? s === "dark" : true;
  } catch {
    return true;
  }
}

let dark = read();

function apply(): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }
}
apply();

export function getIsDark(): boolean {
  return dark;
}

export function setDark(next: boolean): void {
  dark = next;
  try {
    localStorage.setItem(KEY, next ? "dark" : "light");
  } catch {
    /* ignore */
  }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive boolean: true when dark mode is active. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getIsDark, () => true);
}

/** Reactive MODES theme object (MODES.dark | MODES.light) for the report/twin components. */
export function useMode() {
  return useSyncExternalStore(
    subscribe,
    () => (dark ? MODES.dark : MODES.light),
    () => MODES.dark,
  );
}
