// Deployment-selectable app modules. The Deploy to Azure form writes the chosen set to
// the ONEGRID_MODULES app setting (comma-separated ids, or "none"); the SSR shell
// publishes it on window.__APP_CONFIG__.modules. When the setting is absent every
// module is on, so existing environments are unaffected.
//
// Core pages (Overview, Asset Explorer, Maintenance, Alerts, Ontology, Thresholds,
// Governance, Cyber Readiness, Deployment) are not modules and are always shown.

export type ModuleId =
  "exec" | "weather" | "twin" | "infra" | "sap" | "esu" | "onerig" | "copilot" | "rates" | "sre";

export const MODULE_IDS: readonly ModuleId[] = [
  "exec",
  "weather",
  "twin",
  "infra",
  "sap",
  "esu",
  "onerig",
  "copilot",
  "rates",
  "sre",
];

export const MODULE_LABELS: Record<ModuleId, string> = {
  exec: "Executive Brief",
  weather: "Weather Intelligence",
  twin: "Digital Twin & Simulation",
  infra: "IT/OT Infrastructure",
  sap: "SAP S/4HANA",
  esu: "ESU Planner",
  onerig: "OneRig (Oil & Gas)",
  copilot: "Copilot chat",
  rates: "Customer Rate Analysis",
  sre: "SRE Demo",
};

// App routes (relative to the ops base) owned by each module.
const ROUTES: Partial<Record<ModuleId, readonly string[]>> = {
  exec: ["/exec"],
  weather: ["/map", "/events", "/risk", "/posture", "/transmission-weather", "/offshore-weather"],
  twin: ["/control-room", "/simulation", "/distribution-network"],
  infra: ["/infrastructure"],
  sap: ["/sap"],
  esu: ["/esu-planner"],
  rates: ["/rates"],
  sre: ["/sre"],
  copilot: ["/copilot"],
};

/** Parses an ONEGRID_MODULES value. Returns null when every module is enabled. */
export function parseModules(raw: string | null | undefined): ModuleId[] | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "all" || v === "*") return null;
  if (v === "none") return [];
  const ids = v.split(/[\s,;]+/).filter(Boolean);
  return MODULE_IDS.filter((m) => ids.includes(m));
}

function configured(): ModuleId[] | null {
  // Server render reads the app setting directly so SSR and hydration agree.
  if (typeof window === "undefined") {
    return typeof process !== "undefined" ? parseModules(process.env["ONEGRID_MODULES"]) : null;
  }
  const m = (window.__APP_CONFIG__ as Record<string, unknown> | undefined)?.["modules"];
  return Array.isArray(m) ? (m as ModuleId[]) : null;
}

export function isModuleEnabled(id: ModuleId): boolean {
  const list = configured();
  return list === null || list.includes(id);
}

/** The module that owns an app route (e.g. "/esu-planner"), if any. */
export function moduleForRoute(to: string | undefined): ModuleId | null {
  if (!to) return null;
  for (const [id, routes] of Object.entries(ROUTES) as [ModuleId, readonly string[]][]) {
    if (routes.some((r) => to === r || to.startsWith(`${r}/`))) return id;
  }
  return null;
}

export function isRouteEnabled(to: string | undefined): boolean {
  const m = moduleForRoute(to);
  return m === null || isModuleEnabled(m);
}
