// ---------------------------------------------------------------------------
//  OneGrid Infrastructure plane — the IT/OT estate that *runs* OneGrid.
//
//  This is the "IT lens" of the solution: instead of power/oil field assets, it
//  models the servers, databases, network controllers, Azure Local clusters and
//  OT/IoT gateways+sensors that the OneGrid software actually depends on, plus the
//  Azure management planes that observe them (Arc, Monitor/Log Analytics, Defender,
//  Update Manager, SCADA Historian, ServiceNow).
//
//  Everything here is self-contained dummy data — no Fabric/KQL dependency — with a
//  mean-reverting realtime simulator so the Operations view and 3D scene read "live".
//  Swapping this for a KQL/Lakehouse feed later is a drop-in: keep the shapes, change
//  the source of `ASSETS`/`metrics`.
// ---------------------------------------------------------------------------

export type InfraStatus = "healthy" | "warning" | "critical" | "offline";
export type InfraCategory = "compute" | "data" | "network" | "ot" | "platform";

export type InfraKind =
  // compute
  | "vmhost"
  | "vm"
  | "aks-node"
  | "container-app"
  | "fabric-capacity"
  // data
  | "sql-db"
  | "postgres"
  | "cosmos"
  | "eventhouse"
  | "storage"
  // network
  | "sdn-controller"
  | "firewall"
  | "load-balancer"
  | "router"
  | "switch"
  | "expressroute"
  // ot
  | "scada-gateway"
  | "plc"
  | "rtu"
  | "iot-edge"
  | "sensor"
  | "historian"
  // platform
  | "arc-server"
  | "ai-foundry";

export type RelKind =
  | "hosts"
  | "runs-on"
  | "depends-on"
  | "connects-to"
  | "replicates-to"
  | "streams-to"
  | "controls"
  | "protects"
  | "monitors"
  | "backs-up";

export interface InfraMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** Soft/hard thresholds (value above warn -> amber, above crit -> red). For
   *  "lower is worse" metrics (availability, battery) set `invert: true`. */
  warn?: number;
  crit?: number;
  invert?: boolean;
  /** Clamp for the live random walk. */
  min: number;
  max: number;
}

export interface InfraAsset {
  id: string;
  name: string;
  kind: InfraKind;
  category: InfraCategory;
  siteId: string;
  status: InfraStatus;
  env: "prod" | "dr" | "edge" | "shared";
  os?: string;
  sku?: string;
  ip?: string;
  region?: string;
  /** Source-system ids that observe/manage this asset. */
  sources: string[];
  metrics: InfraMetric[];
  /** Monthly run-rate in USD (0 for OT field devices). */
  costMonthly: number;
  tags: Record<string, string>;
  note?: string;
  /** SQL lifecycle metadata — present only on SQL instances (see SQL Estate tab). */
  sql?: SqlMeta;
}

// ── SQL estate / lifecycle ───────────────────────────────────────────────────
export type SqlEngine = "SQL Server" | "Azure SQL DB" | "Azure SQL MI";
export type SqlVersion = "2012" | "2014" | "2016" | "2017" | "2019" | "2022" | "Azure";
export type SqlHost = "VM" | "Arc" | "Azure Local" | "Azure SQL" | "Azure SQL MI";
/** ESU = Extended Security Updates. n/a = still supported; enrolled = covered via
 *  Azure Arc; eligible = past support & could enroll but hasn't (exposure); expired
 *  = ESU window closed, fully unsupported. */
export type EsuStatus = "n/a" | "enrolled" | "eligible" | "expired";

export interface SqlMeta {
  engine: SqlEngine;
  version: SqlVersion;
  build?: string;
  edition: string;
  cores: number;
  hostType: SqlHost;
  databases: number;
  arcEnabled: boolean;
  esuStatus: EsuStatus;
  /** Amortised SQL Server license run-rate ($/mo); 0 for Azure managed services. */
  licenseMonthly: number;
  /** Extended Security Updates run-rate ($/mo) when enrolled via Arc. */
  esuMonthly: number;
}

export type SqlState =
  "current" | "mainstream" | "extended" | "eol-approaching" | "eol-esu" | "eol";
export interface SqlVersionInfo {
  label: string;
  mainstreamEnd?: string;
  extendedEnd?: string;
  esuEnd?: string;
}
// Microsoft SQL Server lifecycle dates (Fixed Lifecycle Policy). Azure SQL DB / MI
// are evergreen (no end-of-support).
export const SQL_LIFECYCLE: Record<SqlVersion, SqlVersionInfo> = {
  "2012": {
    label: "SQL Server 2012",
    mainstreamEnd: "2017-07-11",
    extendedEnd: "2022-07-12",
    esuEnd: "2025-07-08",
  },
  "2014": {
    label: "SQL Server 2014",
    mainstreamEnd: "2019-07-09",
    extendedEnd: "2024-07-09",
    esuEnd: "2027-07-13",
  },
  "2016": {
    label: "SQL Server 2016",
    mainstreamEnd: "2021-07-13",
    extendedEnd: "2026-07-14",
    esuEnd: "2029-07-10",
  },
  "2017": { label: "SQL Server 2017", mainstreamEnd: "2022-10-11", extendedEnd: "2027-10-12" },
  "2019": { label: "SQL Server 2019", mainstreamEnd: "2025-02-28", extendedEnd: "2030-01-08" },
  "2022": { label: "SQL Server 2022", mainstreamEnd: "2028-01-11", extendedEnd: "2033-01-11" },
  Azure: { label: "Azure SQL (evergreen)" },
};
// Anchor "today" to the demo's current forecast cycle so lifecycle math is stable.
const SQL_NOW_MS = Date.UTC(2026, 9, 14);
const SQL_DAY = 86400000;
export function sqlState(version: SqlVersion): SqlState {
  const info = SQL_LIFECYCLE[version];
  if (!info.extendedEnd) return "current";
  const ext = Date.parse(info.extendedEnd);
  if (ext < SQL_NOW_MS) {
    const esu = info.esuEnd ? Date.parse(info.esuEnd) : 0;
    return esu > SQL_NOW_MS ? "eol-esu" : "eol";
  }
  if (ext - SQL_NOW_MS < 365 * SQL_DAY) return "eol-approaching";
  const main = info.mainstreamEnd ? Date.parse(info.mainstreamEnd) : 0;
  return main && main < SQL_NOW_MS ? "extended" : "mainstream";
}
export function sqlDaysToEol(version: SqlVersion): number | null {
  const info = SQL_LIFECYCLE[version];
  if (!info.extendedEnd) return null;
  return Math.round((Date.parse(info.extendedEnd) - SQL_NOW_MS) / SQL_DAY);
}
export const SQL_STATE_META: Record<SqlState, { label: string; color: string }> = {
  current: { label: "Current", color: "#3fb950" },
  mainstream: { label: "Mainstream", color: "#3fb950" },
  extended: { label: "Extended support", color: "#5aa9ff" },
  "eol-approaching": { label: "EOL approaching", color: "#f0b429" },
  "eol-esu": { label: "EOL · ESU", color: "#f0803c" },
  eol: { label: "End of life", color: "#ff5a5f" },
};
export const ESU_META: Record<EsuStatus, { label: string; color: string }> = {
  "n/a": { label: "—", color: "#7d8597" },
  enrolled: { label: "ESU enrolled", color: "#3fb950" },
  eligible: { label: "ESU eligible", color: "#f0b429" },
  expired: { label: "ESU expired", color: "#ff5a5f" },
};

export interface InfraEdge {
  id: string;
  from: string;
  to: string;
  rel: RelKind;
  note?: string;
}

export interface InfraSite {
  id: string;
  name: string;
  kind: "cloud" | "datacenter" | "edge";
  location: string;
  region?: string;
  /** 2D anchor for the 3D scene zone layout (world units). */
  anchor: [number, number];
}

export interface SourceSystem {
  id: string;
  name: string;
  vendor: string;
  kind: "inventory" | "monitoring" | "security" | "patching" | "telemetry" | "itsm" | "ai";
  status: "connected" | "degraded" | "syncing";
  lastSyncMin: number;
  /** Fraction of the estate this plane covers (0..1). */
  coverage: number;
  description: string;
}

export type TicketSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type TicketStatus = "new" | "ack" | "in-progress" | "resolved";
export interface Ticket {
  id: string;
  title: string;
  severity: TicketSeverity;
  status: TicketStatus;
  assetId: string;
  assignee: string;
  team: string;
  openedMinAgo: number;
  slaMin: number;
  source: string;
  detail: string;
}

export type LogLevel = "trace" | "info" | "warn" | "error" | "critical";
export interface LogEntry {
  id: string;
  tsMsAgo: number;
  level: LogLevel;
  source: string;
  table: string;
  assetId: string;
  message: string;
}

export interface CostRec {
  id: string;
  title: string;
  assetId: string;
  category: "rightsize" | "idle" | "reservation" | "orphaned" | "storage-tier";
  monthlySaving: number;
  effort: "low" | "medium" | "high";
  detail: string;
}

export interface PerfRec {
  id: string;
  title: string;
  assetId: string;
  impact: "high" | "medium" | "low";
  metricKey: string;
  detail: string;
}

// ── visual metadata ────────────────────────────────────────────────────────
export const STATUS_COLOR: Record<InfraStatus, string> = {
  healthy: "#3fb950",
  warning: "#f0b429",
  critical: "#ff5a5f",
  offline: "#7d8597",
};
export const STATUS_LABEL: Record<InfraStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  offline: "Offline",
};
export const STATUS_RANK: Record<InfraStatus, number> = {
  critical: 0,
  warning: 1,
  offline: 2,
  healthy: 3,
};

export const CATEGORY_META: Record<InfraCategory, { label: string; color: string }> = {
  compute: { label: "Compute", color: "#4f8cff" },
  data: { label: "Data", color: "#b07bff" },
  network: { label: "Network", color: "#19c3d3" },
  ot: { label: "OT / IoT", color: "#ff6fb5" },
  platform: { label: "Platform", color: "#8b9dff" },
};

export const KIND_LABEL: Record<InfraKind, string> = {
  vmhost: "Hyper-V host",
  vm: "Virtual machine",
  "aks-node": "AKS node",
  "container-app": "Container app",
  "fabric-capacity": "Fabric capacity",
  "sql-db": "Azure SQL DB",
  postgres: "PostgreSQL",
  cosmos: "Cosmos DB",
  eventhouse: "Eventhouse (KQL)",
  storage: "Storage / OneLake",
  "sdn-controller": "Network controller",
  firewall: "Firewall",
  "load-balancer": "Load balancer",
  router: "Router",
  switch: "Switch",
  expressroute: "ExpressRoute",
  "scada-gateway": "SCADA gateway",
  plc: "PLC",
  rtu: "RTU",
  "iot-edge": "IoT Edge",
  sensor: "Field sensor",
  historian: "OT historian",
  "arc-server": "Arc-enabled server",
  "ai-foundry": "AI Foundry",
};

// ── sites ───────────────────────────────────────────────────────────────────
export const SITES: InfraSite[] = [
  {
    id: "az-east",
    name: "Azure East US 2",
    kind: "cloud",
    location: "Virginia",
    region: "eastus2",
    anchor: [-78, -40],
  },
  {
    id: "az-west",
    name: "Azure West US 2 (DR)",
    kind: "cloud",
    location: "Washington",
    region: "westus2",
    anchor: [-78, 46],
  },
  {
    id: "dc-hou",
    name: "Houston Core DC",
    kind: "datacenter",
    location: "Houston, TX",
    anchor: [4, 2],
  },
  {
    id: "sub-west",
    name: "Westside Substation",
    kind: "edge",
    location: "Katy, TX · Azure Local",
    anchor: [86, -52],
  },
  {
    id: "sub-harbor",
    name: "Harbor Substation",
    kind: "edge",
    location: "Pasadena, TX · Azure Local",
    anchor: [86, 4],
  },
  {
    id: "plant-bayou",
    name: "Bayou Generating Plant",
    kind: "edge",
    location: "Baytown, TX · OT",
    anchor: [86, 56],
  },
];
export const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]));

// ── source systems (management planes) ───────────────────────────────────────
export const SOURCES: SourceSystem[] = [
  {
    id: "arc",
    name: "Azure Arc",
    vendor: "Microsoft",
    kind: "inventory",
    status: "connected",
    lastSyncMin: 3,
    coverage: 0.86,
    description:
      "Projects on-prem & Azure Local servers into Azure for unified inventory, policy and extensions.",
  },
  {
    id: "monitor",
    name: "Azure Monitor · Log Analytics",
    vendor: "Microsoft",
    kind: "monitoring",
    status: "connected",
    lastSyncMin: 1,
    coverage: 0.94,
    description:
      "Metrics, logs and the KQL query plane for the whole estate; backs alerts and workbooks.",
  },
  {
    id: "defender",
    name: "Defender for Cloud",
    vendor: "Microsoft",
    kind: "security",
    status: "degraded",
    lastSyncMin: 12,
    coverage: 0.79,
    description:
      "CSPM + workload protection; secure-score, vulnerability findings and regulatory compliance.",
  },
  {
    id: "update",
    name: "Azure Update Manager",
    vendor: "Microsoft",
    kind: "patching",
    status: "connected",
    lastSyncMin: 42,
    coverage: 0.74,
    description: "Patch assessment and scheduled maintenance for VMs and Arc servers.",
  },
  {
    id: "resourcegraph",
    name: "Azure Resource Graph",
    vendor: "Microsoft",
    kind: "inventory",
    status: "connected",
    lastSyncMin: 2,
    coverage: 1.0,
    description: "Fast, tenant-wide resource topology and change history across subscriptions.",
  },
  {
    id: "scada-historian",
    name: "SCADA Historian",
    vendor: "AVEVA PI",
    kind: "telemetry",
    status: "connected",
    lastSyncMin: 1,
    coverage: 0.41,
    description:
      "OT time-series historian; streams field tags to Fabric Eventhouse via the edge gateways.",
  },
  {
    id: "grafana",
    name: "Managed Grafana",
    vendor: "Microsoft / Grafana",
    kind: "monitoring",
    status: "syncing",
    lastSyncMin: 1,
    coverage: 0.52,
    description: "Prometheus-backed dashboards for AKS and container workloads.",
  },
  {
    id: "servicenow",
    name: "ServiceNow ITSM",
    vendor: "ServiceNow",
    kind: "itsm",
    status: "connected",
    lastSyncMin: 5,
    coverage: 1.0,
    description: "Incident, change and CMDB system of record; two-way synced with Azure alerts.",
  },
];
export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

// ── metric helpers ───────────────────────────────────────────────────────────
function pct(key: string, label: string, value: number, warn = 80, crit = 92): InfraMetric {
  return { key, label, value, unit: "%", warn, crit, min: 0, max: 100 };
}
function up(key: string, label: string, value: number, warn = 99.9, crit = 99.5): InfraMetric {
  return { key, label, value, unit: "%", warn, crit, invert: true, min: 90, max: 100 };
}
// "higher is better" percentage: value at/below warn -> amber, at/below crit -> red.
function pctUp(key: string, label: string, value: number, warn: number, crit: number): InfraMetric {
  return { key, label, value, unit: "%", warn, crit, invert: true, min: 0, max: 100 };
}
function num(
  key: string,
  label: string,
  value: number,
  unit: string,
  opts: Partial<InfraMetric> = {},
): InfraMetric {
  const spread = Math.max(Math.abs(value) * 0.6, 4);
  return {
    key,
    label,
    value,
    unit,
    min: Math.max(0, value - spread),
    max: value + spread,
    ...opts,
  };
}

// ── the estate ────────────────────────────────────────────────────────────────
// Authored for coherent relationships; metrics are representative, not survey-grade.
export const ASSETS: InfraAsset[] = [
  // ───────── az-east (production cloud) ─────────
  {
    id: "aks-prod-1",
    name: "aks-onegrid-prod-1",
    kind: "aks-node",
    category: "compute",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    os: "AKS · Ubuntu 22.04",
    sku: "Standard_D8s_v5",
    ip: "10.20.1.11",
    region: "eastus2",
    sources: ["monitor", "defender", "grafana", "resourcegraph"],
    costMonthly: 540,
    tags: { workload: "report-app", pool: "system" },
    note: "Hosts the OneGrid report-app + chat agent pods.",
    metrics: [
      pct("cpu", "CPU", 58),
      pct("mem", "Memory", 64),
      num("pods", "Pods", 22, "", { min: 0, max: 40, warn: 32, crit: 38 }),
      num("net", "Network", 310, "Mbps"),
    ],
  },
  {
    id: "aks-prod-2",
    name: "aks-onegrid-prod-2",
    kind: "aks-node",
    category: "compute",
    siteId: "az-east",
    status: "warning",
    env: "prod",
    os: "AKS · Ubuntu 22.04",
    sku: "Standard_D8s_v5",
    ip: "10.20.1.12",
    region: "eastus2",
    sources: ["monitor", "defender", "grafana", "resourcegraph"],
    costMonthly: 540,
    tags: { workload: "webapp", pool: "user" },
    note: "Memory pressure from the 3D SSR render path; eviction threshold approaching.",
    metrics: [
      pct("cpu", "CPU", 71),
      pct("mem", "Memory", 88, 80, 92),
      num("pods", "Pods", 29, "", { min: 0, max: 40, warn: 32, crit: 38 }),
      num("net", "Network", 420, "Mbps"),
    ],
  },
  {
    id: "aks-prod-3",
    name: "aks-onegrid-prod-3",
    kind: "aks-node",
    category: "compute",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    os: "AKS · Ubuntu 22.04",
    sku: "Standard_D8s_v5",
    ip: "10.20.1.13",
    region: "eastus2",
    sources: ["monitor", "defender", "grafana", "resourcegraph"],
    costMonthly: 540,
    tags: { workload: "ingest", pool: "user" },
    metrics: [
      pct("cpu", "CPU", 44),
      pct("mem", "Memory", 52),
      num("pods", "Pods", 18, "", { min: 0, max: 40, warn: 32, crit: 38 }),
      num("net", "Network", 260, "Mbps"),
    ],
  },
  {
    id: "ca-onegrid",
    name: "ca-onegrid-web",
    kind: "container-app",
    category: "compute",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    os: "Container · distroless",
    sku: "2 vCPU / 4 GiB",
    ip: "10.20.2.40",
    region: "eastus2",
    sources: ["monitor", "grafana"],
    costMonthly: 180,
    tags: { app: "OneGrid", revision: "app--0000030" },
    note: "The public OneGrid web app (report-app SSR + webapp + chat agent).",
    metrics: [
      pct("cpu", "CPU", 48),
      pct("mem", "Memory", 61),
      num("rps", "Requests", 240, "req/s"),
      num("p95", "p95 latency", 180, "ms", { warn: 400, crit: 800, min: 40, max: 1200 }),
    ],
  },
  {
    id: "fabric-cap",
    name: "ogestu (F16)",
    kind: "fabric-capacity",
    category: "compute",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "Fabric F16",
    region: "eastus2",
    sources: ["monitor", "resourcegraph"],
    costMonthly: 2880,
    tags: { capacity: "F16", autoscale: "paused-overnight" },
    note: "Fabric capacity backing the lakehouse, Eventhouse and semantic models.",
    metrics: [
      pct("cu", "CU utilization", 63, 85, 95),
      num("throttle", "Throttling", 0, "%", { warn: 1, crit: 5, min: 0, max: 20 }),
      num("queries", "Queries", 140, "/min"),
    ],
  },
  {
    id: "sql-ops",
    name: "sql-onegrid-ops",
    kind: "sql-db",
    category: "data",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "Azure SQL · Business Critical GP_Gen5_8",
    ip: "10.20.3.10",
    region: "eastus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 1420,
    tags: { db: "operations", tier: "BC" },
    note: "Operational store for work orders, assets and user state.",
    metrics: [
      pct("dtu", "DTU / vCore", 57, 85, 95),
      pct("storage", "Storage", 68),
      num("conns", "Connections", 310, "", { min: 0, max: 800, warn: 600, crit: 740 }),
      num("latency", "Read latency", 6, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "Azure SQL DB",
      version: "Azure",
      edition: "Business Critical",
      cores: 8,
      hostType: "Azure SQL",
      databases: 12,
      arcEnabled: false,
      esuStatus: "n/a",
      licenseMonthly: 0,
      esuMonthly: 0,
    },
  },
  {
    id: "pg-ontology",
    name: "pg-ontology-flex",
    kind: "postgres",
    category: "data",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "PostgreSQL Flexible · D4ds_v5",
    ip: "10.20.3.20",
    region: "eastus2",
    sources: ["monitor", "defender"],
    costMonthly: 460,
    tags: { db: "ontology", ha: "zone-redundant" },
    note: "Graph + metadata store for the knowledge-graph / ontology.",
    metrics: [
      pct("cpu", "CPU", 39),
      num("conns", "Connections", 120, "", { min: 0, max: 400, warn: 300, crit: 360 }),
      pctUp("cache", "Cache hit", 98, 95, 90),
      num("repl", "Replica lag", 1.2, "s", { warn: 10, crit: 30, min: 0, max: 60 }),
    ],
  },
  {
    id: "eventhouse-eh",
    name: "OneGridEH",
    kind: "eventhouse",
    category: "data",
    siteId: "az-east",
    status: "warning",
    env: "prod",
    sku: "Eventhouse · auto",
    region: "eastus2",
    sources: ["monitor", "scada-historian", "resourcegraph"],
    costMonthly: 980,
    tags: { db: "OneGridEH", retention: "90d" },
    note: "Real-time KQL store for streaming sensor telemetry; ingestion backlog building.",
    metrics: [
      num("ingest", "Ingestion", 46, "GB/day", { warn: 60, crit: 80, min: 0, max: 120 }),
      num("qlatency", "Query latency", 240, "ms", { warn: 300, crit: 600, min: 40, max: 1200 }),
      pct("cache", "Hot cache", 74),
      num("lag", "Ingestion lag", 55, "s", { warn: 45, crit: 120, min: 0, max: 300 }),
    ],
  },
  {
    id: "storage-lake",
    name: "onelakeonegrid",
    kind: "storage",
    category: "data",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "ADLS Gen2 · ZRS",
    region: "eastus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 620,
    tags: { account: "onelake", redundancy: "ZRS" },
    metrics: [
      num("used", "Used", 42, "TB", { min: 0, max: 100, warn: 80, crit: 92 }),
      num("tps", "Transactions", 1800, "/s"),
      num("throughput", "Throughput", 420, "MB/s"),
      up("avail", "Availability", 99.99),
    ],
  },
  {
    id: "cosmos-state",
    name: "cosmos-onegrid-state",
    kind: "cosmos",
    category: "data",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "Cosmos DB · autoscale 4000 RU/s",
    region: "eastus2",
    sources: ["monitor", "resourcegraph"],
    costMonthly: 390,
    tags: { db: "session-state", consistency: "session" },
    metrics: [
      pct("ru", "RU utilization", 46, 80, 92),
      num("latency", "p99 read", 8, "ms", { warn: 15, crit: 30, min: 1, max: 60 }),
      num("docs", "Docs", 2.4, "M"),
    ],
  },
  {
    id: "foundry-oai",
    name: "pcpro-oai (Foundry)",
    kind: "ai-foundry",
    category: "platform",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "AI Foundry · gpt-5-mini",
    region: "eastus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 1150,
    tags: { deployment: "gpt-5-mini", purpose: "chat-with-data" },
    note: "Grounds the in-app copilot over Eventhouse (KQL) + semantic model (DAX).",
    metrics: [
      num("tpm", "Tokens", 28, "K/min", { min: 0, max: 120, warn: 90, crit: 110 }),
      num("latency", "p95 latency", 920, "ms", { warn: 1500, crit: 3000, min: 200, max: 6000 }),
      pct("quota", "Quota used", 24, 80, 92),
    ],
  },
  {
    id: "lb-prod",
    name: "agw-onegrid-prod",
    kind: "load-balancer",
    category: "network",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "App Gateway v2 · WAF",
    ip: "20.51.44.10",
    region: "eastus2",
    sources: ["monitor", "defender"],
    costMonthly: 320,
    tags: { tier: "WAF_v2", backends: "aks-prod" },
    metrics: [
      num("rps", "Requests", 240, "req/s"),
      num("backends", "Healthy backends", 3, "/3", {
        invert: true,
        warn: 2,
        crit: 1,
        min: 0,
        max: 3,
      }),
      num("latency", "Latency", 22, "ms", { warn: 60, crit: 120, min: 2, max: 240 }),
      pct("snat", "SNAT ports", 34, 80, 92),
    ],
  },
  {
    id: "fw-hub",
    name: "azfw-hub-eastus2",
    kind: "firewall",
    category: "network",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "Azure Firewall Premium",
    ip: "10.20.0.4",
    region: "eastus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 940,
    tags: { tier: "Premium", idps: "alert+deny" },
    metrics: [
      num("throughput", "Throughput", 3.2, "Gbps", { min: 0, max: 30, warn: 24, crit: 28 }),
      num("sessions", "Sessions", 48, "K"),
      num("blocked", "Blocked", 140, "/min"),
      pct("cpu", "CPU", 41),
    ],
  },
  {
    id: "sdn-prod",
    name: "nc-onegrid-eastus2",
    kind: "sdn-controller",
    category: "network",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "SDN Network Controller",
    ip: "10.20.0.8",
    region: "eastus2",
    sources: ["monitor", "arc"],
    costMonthly: 210,
    tags: { role: "control-plane", vnets: "7" },
    note: "Software-defined networking control plane for the production VNets.",
    metrics: [
      num("flows", "Active flows", 86, "K"),
      num("throughput", "Throughput", 6.1, "Gbps", { min: 0, max: 40 }),
      pct("cpu", "CPU", 33),
      num("latency", "Path latency", 1.4, "ms", { warn: 5, crit: 10, min: 0, max: 20 }),
    ],
  },
  {
    id: "er-gw",
    name: "er-gw-onegrid",
    kind: "expressroute",
    category: "network",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "ExpressRoute · 1 Gbps",
    region: "eastus2",
    sources: ["monitor"],
    costMonthly: 680,
    tags: { peering: "houston-core", bandwidth: "1Gbps" },
    note: "Private circuit to the Houston Core DC.",
    metrics: [
      pct("util", "Circuit util", 52, 80, 92),
      num("in", "Ingress", 410, "Mbps"),
      num("out", "Egress", 380, "Mbps"),
      up("avail", "Availability", 99.98),
    ],
  },

  // ───────── az-west (DR) ─────────
  {
    id: "aks-dr-1",
    name: "aks-onegrid-dr-1",
    kind: "aks-node",
    category: "compute",
    siteId: "az-west",
    status: "healthy",
    env: "dr",
    os: "AKS · Ubuntu 22.04",
    sku: "Standard_D8s_v5",
    ip: "10.60.1.11",
    region: "westus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 540,
    tags: { workload: "warm-standby", pool: "system" },
    note: "Warm standby for the production AKS cluster (scaled to 1).",
    metrics: [
      pct("cpu", "CPU", 12),
      pct("mem", "Memory", 28),
      num("pods", "Pods", 6, "", { min: 0, max: 40 }),
      num("net", "Network", 40, "Mbps"),
    ],
  },
  {
    id: "sql-dr",
    name: "sql-onegrid-dr",
    kind: "sql-db",
    category: "data",
    siteId: "az-west",
    status: "healthy",
    env: "dr",
    sku: "Azure SQL · geo-replica",
    ip: "10.60.3.10",
    region: "westus2",
    sources: ["monitor", "defender"],
    costMonthly: 1180,
    tags: { db: "operations", role: "geo-secondary" },
    note: "Active geo-replica of sql-onegrid-ops.",
    metrics: [
      pct("dtu", "DTU / vCore", 18, 85, 95),
      pct("storage", "Storage", 68),
      num("lag", "Replication lag", 2.1, "s", { warn: 10, crit: 30, min: 0, max: 60 }),
      num("latency", "Read latency", 7, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "Azure SQL DB",
      version: "Azure",
      edition: "Business Critical",
      cores: 8,
      hostType: "Azure SQL",
      databases: 12,
      arcEnabled: false,
      esuStatus: "n/a",
      licenseMonthly: 0,
      esuMonthly: 0,
    },
  },
  {
    id: "storage-dr",
    name: "onelakeonegriddr",
    kind: "storage",
    category: "data",
    siteId: "az-west",
    status: "healthy",
    env: "dr",
    sku: "ADLS Gen2 · GRS target",
    region: "westus2",
    sources: ["monitor", "resourcegraph"],
    costMonthly: 300,
    tags: { account: "onelake-dr", redundancy: "GRS" },
    metrics: [
      num("used", "Used", 42, "TB", { min: 0, max: 100 }),
      num("rpo", "RPO", 9, "min", { warn: 15, crit: 30, min: 0, max: 60 }),
      up("avail", "Availability", 99.99),
    ],
  },
  {
    id: "lb-dr",
    name: "agw-onegrid-dr",
    kind: "load-balancer",
    category: "network",
    siteId: "az-west",
    status: "offline",
    env: "dr",
    sku: "App Gateway v2 · stopped",
    ip: "20.66.12.10",
    region: "westus2",
    sources: ["monitor"],
    costMonthly: 40,
    tags: { tier: "WAF_v2", state: "stopped" },
    note: "Stopped until a DR failover; started by the recovery runbook.",
    metrics: [
      num("rps", "Requests", 0, "req/s", { min: 0, max: 200 }),
      num("backends", "Healthy backends", 0, "/1", { min: 0, max: 1 }),
      num("latency", "Latency", 0, "ms", { min: 0, max: 200 }),
    ],
  },

  // ───────── dc-hou (Houston Core DC) ─────────
  {
    id: "hv-host-1",
    name: "hv-core-01",
    kind: "vmhost",
    category: "compute",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    os: "Windows Server 2025 · Hyper-V",
    sku: "Dell R760 · 2×32c / 1 TB",
    ip: "10.10.1.21",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { cluster: "core-hci", arc: "enabled" },
    note: "Arc-enabled Hyper-V host; 1 of 2 in the core cluster.",
    metrics: [
      pct("cpu", "CPU", 61),
      pct("mem", "Memory", 72),
      num("vms", "VMs", 7, "", { min: 0, max: 16, warn: 13, crit: 15 }),
      num("temp", "Inlet temp", 24, "°C", { warn: 30, crit: 35, min: 16, max: 45 }),
    ],
  },
  {
    id: "hv-host-2",
    name: "hv-core-02",
    kind: "vmhost",
    category: "compute",
    siteId: "dc-hou",
    status: "warning",
    env: "shared",
    os: "Windows Server 2025 · Hyper-V",
    sku: "Dell R760 · 2×32c / 1 TB",
    ip: "10.10.1.22",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { cluster: "core-hci", arc: "enabled" },
    note: "Pending security patches (3) past the maintenance window.",
    metrics: [
      pct("cpu", "CPU", 69),
      pct("mem", "Memory", 83, 80, 92),
      num("vms", "VMs", 8, "", { min: 0, max: 16, warn: 13, crit: 15 }),
      num("temp", "Inlet temp", 27, "°C", { warn: 30, crit: 35, min: 16, max: 45 }),
    ],
  },
  {
    id: "vm-historian",
    name: "vm-pi-historian",
    kind: "vm",
    category: "compute",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    os: "Windows Server 2022",
    sku: "8 vCPU / 32 GiB",
    ip: "10.10.2.31",
    sources: ["arc", "monitor", "update", "scada-historian"],
    costMonthly: 0,
    tags: { role: "PI historian", arc: "enabled" },
    note: "AVEVA PI historian — the OT system of record.",
    metrics: [
      pct("cpu", "CPU", 48),
      pct("mem", "Memory", 66),
      pct("disk", "Disk", 71),
      num("tags", "Tags", 18, "K"),
    ],
  },
  {
    id: "vm-ad",
    name: "vm-dc-01",
    kind: "vm",
    category: "compute",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    os: "Windows Server 2022",
    sku: "4 vCPU / 16 GiB",
    ip: "10.10.2.10",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { role: "domain controller", arc: "enabled" },
    metrics: [
      pct("cpu", "CPU", 22),
      pct("mem", "Memory", 44),
      num("auth", "Auth", 85, "/s"),
      pct("disk", "Disk", 38),
    ],
  },
  {
    id: "vm-sql-legacy",
    name: "vm-sql-legacy",
    kind: "vm",
    category: "compute",
    siteId: "dc-hou",
    status: "critical",
    env: "shared",
    os: "Windows Server 2016",
    sku: "8 vCPU / 48 GiB",
    ip: "10.10.2.50",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { role: "legacy GIS DB", arc: "enabled", eol: "2027" },
    note: "Disk 96% full and OS nearing end-of-support; migration candidate.",
    metrics: [
      pct("cpu", "CPU", 74),
      pct("mem", "Memory", 81, 80, 92),
      pct("disk", "Disk", 96, 85, 94),
      num("latency", "IO latency", 42, "ms", { warn: 20, crit: 40, min: 1, max: 120 }),
    ],
    sql: {
      engine: "SQL Server",
      version: "2016",
      build: "13.0.6435.1",
      edition: "Enterprise",
      cores: 8,
      hostType: "VM",
      databases: 9,
      arcEnabled: true,
      esuStatus: "eligible",
      licenseMonthly: 1750,
      esuMonthly: 0,
    },
  },
  {
    id: "sql-hist-2012",
    name: "sql-archive-2012",
    kind: "sql-db",
    category: "data",
    siteId: "dc-hou",
    status: "critical",
    env: "shared",
    os: "Windows Server 2012 R2",
    sku: "SQL Server 2012 Std · 4 vCPU",
    ip: "10.10.2.60",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { role: "archive / reporting", arc: "enabled", eol: "2022" },
    note: "SQL Server 2012 past end of ESU — fully unsupported. Decommission or migrate the archive DBs.",
    metrics: [
      pct("cpu", "CPU", 28),
      pct("storage", "Storage", 82, 85, 94),
      num("conns", "Connections", 40, "", { min: 0, max: 200, warn: 160, crit: 190 }),
      num("latency", "Read latency", 14, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "SQL Server",
      version: "2012",
      build: "11.0.7512.0",
      edition: "Standard",
      cores: 4,
      hostType: "VM",
      databases: 5,
      arcEnabled: true,
      esuStatus: "expired",
      licenseMonthly: 480,
      esuMonthly: 0,
    },
  },
  {
    id: "sql-gis-2014",
    name: "sql-gis-2014",
    kind: "sql-db",
    category: "data",
    siteId: "dc-hou",
    status: "warning",
    env: "shared",
    os: "Windows Server 2019",
    sku: "SQL Server 2014 Std · 8 vCPU",
    ip: "10.10.2.62",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { role: "GIS spatial DB", arc: "enabled", esu: "year-2" },
    note: "SQL Server 2014 past end of support but covered by Extended Security Updates (Year 2) via Azure Arc.",
    metrics: [
      pct("cpu", "CPU", 44),
      pct("storage", "Storage", 61),
      num("conns", "Connections", 120, "", { min: 0, max: 400, warn: 320, crit: 380 }),
      num("latency", "Read latency", 9, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "SQL Server",
      version: "2014",
      build: "12.0.6449.1",
      edition: "Standard",
      cores: 8,
      hostType: "Arc",
      databases: 7,
      arcEnabled: true,
      esuStatus: "enrolled",
      licenseMonthly: 900,
      esuMonthly: 560,
    },
  },
  {
    id: "sql-billing-2019",
    name: "sql-billing-2019",
    kind: "sql-db",
    category: "data",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    os: "Windows Server 2022",
    sku: "SQL Server 2019 Ent · 16 vCPU",
    ip: "10.10.2.64",
    sources: ["arc", "monitor", "update", "defender"],
    costMonthly: 0,
    tags: { role: "billing / CIS", arc: "enabled" },
    note: "SQL Server 2019 Enterprise — in extended support with runway to 2030.",
    metrics: [
      pct("cpu", "CPU", 52),
      pct("storage", "Storage", 58),
      num("conns", "Connections", 280, "", { min: 0, max: 800, warn: 640, crit: 760 }),
      num("latency", "Read latency", 5, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "SQL Server",
      version: "2019",
      build: "15.0.4345.5",
      edition: "Enterprise",
      cores: 16,
      hostType: "Arc",
      databases: 14,
      arcEnabled: true,
      esuStatus: "n/a",
      licenseMonthly: 3500,
      esuMonthly: 0,
    },
  },
  {
    id: "sqlmi-ops",
    name: "sqlmi-onegrid",
    kind: "sql-db",
    category: "data",
    siteId: "az-east",
    status: "healthy",
    env: "prod",
    sku: "Azure SQL MI · General Purpose · 8 vCore",
    ip: "10.20.3.30",
    region: "eastus2",
    sources: ["monitor", "defender", "resourcegraph"],
    costMonthly: 1680,
    tags: { role: "modernized workloads", tier: "GP" },
    note: "Azure SQL Managed Instance — evergreen target for migrating the on-prem SQL estate.",
    metrics: [
      pct("cpu", "CPU", 38),
      pct("storage", "Storage", 44),
      num("conns", "Connections", 190, "", { min: 0, max: 800, warn: 640, crit: 760 }),
      num("latency", "Read latency", 4, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "Azure SQL MI",
      version: "Azure",
      edition: "General Purpose",
      cores: 8,
      hostType: "Azure SQL MI",
      databases: 20,
      arcEnabled: false,
      esuStatus: "n/a",
      licenseMonthly: 0,
      esuMonthly: 0,
    },
  },
  {
    id: "sql-scada-2017",
    name: "sql-scada-2017",
    kind: "sql-db",
    category: "data",
    siteId: "sub-west",
    status: "warning",
    env: "edge",
    os: "Windows Server 2019 IoT",
    sku: "SQL Server 2017 Std · 4 vCPU",
    ip: "172.16.11.40",
    sources: ["arc", "monitor", "update"],
    costMonthly: 0,
    tags: { role: "SCADA config DB", arc: "enabled", cluster: "al-west" },
    note: "SQL Server 2017 on Azure Local — extended support ends Oct 2027; plan the upgrade.",
    metrics: [
      pct("cpu", "CPU", 33),
      pct("storage", "Storage", 49),
      num("conns", "Connections", 60, "", { min: 0, max: 200, warn: 160, crit: 190 }),
      num("latency", "Read latency", 8, "ms", { warn: 20, crit: 40, min: 1, max: 80 }),
    ],
    sql: {
      engine: "SQL Server",
      version: "2017",
      build: "14.0.3485.1",
      edition: "Standard",
      cores: 4,
      hostType: "Azure Local",
      databases: 3,
      arcEnabled: true,
      esuStatus: "n/a",
      licenseMonthly: 700,
      esuMonthly: 0,
    },
  },
  {
    id: "core-router",
    name: "rtr-core-01",
    kind: "router",
    category: "network",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    sku: "Cisco ASR 1001-X",
    ip: "10.10.0.1",
    sources: ["monitor", "arc"],
    costMonthly: 0,
    tags: { role: "core", uplinks: "ER + Internet" },
    metrics: [
      pct("util", "Uplink util", 47, 80, 92),
      num("throughput", "Throughput", 2.4, "Gbps", { min: 0, max: 10 }),
      num("errors", "Errors", 0, "/min", { warn: 5, crit: 20, min: 0, max: 50 }),
      num("temp", "Temp", 38, "°C", { warn: 55, crit: 65, min: 20, max: 80 }),
    ],
  },
  {
    id: "core-switch",
    name: "sw-core-01",
    kind: "switch",
    category: "network",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    sku: "Arista 7050X3",
    ip: "10.10.0.2",
    sources: ["monitor"],
    costMonthly: 0,
    tags: { role: "ToR", ports: "48×25G" },
    metrics: [
      pct("util", "Fabric util", 38, 80, 92),
      num("throughput", "Throughput", 18, "Gbps", { min: 0, max: 100 }),
      num("errors", "CRC errors", 2, "/min", { warn: 10, crit: 40, min: 0, max: 80 }),
      num("temp", "Temp", 34, "°C", { warn: 55, crit: 65, min: 20, max: 80 }),
    ],
  },
  {
    id: "fw-dc",
    name: "fw-core-pa",
    kind: "firewall",
    category: "network",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    sku: "Palo Alto PA-3410",
    ip: "10.10.0.3",
    sources: ["monitor", "defender"],
    costMonthly: 0,
    tags: { role: "perimeter", ha: "active-passive" },
    metrics: [
      num("throughput", "Throughput", 1.8, "Gbps", { min: 0, max: 20 }),
      num("sessions", "Sessions", 22, "K"),
      num("blocked", "Blocked", 60, "/min"),
      pct("cpu", "CPU", 36),
    ],
  },
  {
    id: "nc-dc",
    name: "nc-core-hci",
    kind: "sdn-controller",
    category: "network",
    siteId: "dc-hou",
    status: "healthy",
    env: "shared",
    sku: "Windows SDN controller",
    ip: "10.10.0.8",
    sources: ["arc", "monitor"],
    costMonthly: 0,
    tags: { role: "HCI SDN", vnets: "4" },
    metrics: [
      num("flows", "Active flows", 24, "K"),
      num("throughput", "Throughput", 3.3, "Gbps", { min: 0, max: 40 }),
      pct("cpu", "CPU", 29),
    ],
  },

  // ───────── sub-west (Westside Substation · Azure Local) ─────────
  {
    id: "al-node-a1",
    name: "al-west-01",
    kind: "vmhost",
    category: "compute",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    os: "Azure Local 23H2",
    sku: "HPE EL8000 · 2×16c / 256 GiB",
    ip: "172.16.10.11",
    sources: ["arc", "monitor", "update"],
    costMonthly: 0,
    tags: { cluster: "al-west", arc: "enabled" },
    note: "Azure Local node — runs edge control + SCADA VMs at the substation.",
    metrics: [
      pct("cpu", "CPU", 44),
      pct("mem", "Memory", 58),
      num("vms", "VMs", 4, "", { min: 0, max: 8, warn: 7, crit: 8 }),
      num("temp", "Inlet temp", 29, "°C", { warn: 34, crit: 40, min: 16, max: 50 }),
    ],
  },
  {
    id: "al-node-a2",
    name: "al-west-02",
    kind: "vmhost",
    category: "compute",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    os: "Azure Local 23H2",
    sku: "HPE EL8000 · 2×16c / 256 GiB",
    ip: "172.16.10.12",
    sources: ["arc", "monitor", "update"],
    costMonthly: 0,
    tags: { cluster: "al-west", arc: "enabled" },
    metrics: [
      pct("cpu", "CPU", 37),
      pct("mem", "Memory", 49),
      num("vms", "VMs", 3, "", { min: 0, max: 8, warn: 7, crit: 8 }),
      num("temp", "Inlet temp", 28, "°C", { warn: 34, crit: 40, min: 16, max: 50 }),
    ],
  },
  {
    id: "vm-scada-a",
    name: "vm-scada-west",
    kind: "vm",
    category: "compute",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    os: "Windows Server 2022 IoT",
    sku: "4 vCPU / 16 GiB",
    ip: "172.16.11.20",
    sources: ["arc", "monitor", "scada-historian"],
    costMonthly: 0,
    tags: { role: "SCADA frontend", arc: "enabled" },
    metrics: [
      pct("cpu", "CPU", 51),
      pct("mem", "Memory", 62),
      num("tags", "Polled tags", 4.2, "K"),
      num("scan", "Scan time", 240, "ms", { warn: 500, crit: 1000, min: 50, max: 2000 }),
    ],
  },
  {
    id: "scada-gw-a",
    name: "scada-gw-west",
    kind: "scada-gateway",
    category: "ot",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    sku: "Edge gateway · OPC UA",
    ip: "172.16.12.1",
    sources: ["scada-historian", "monitor", "arc"],
    costMonthly: 0,
    tags: { protocol: "OPC UA / DNP3", uplink: "Eventhouse" },
    note: "Bridges field PLC/RTU data to Fabric Eventhouse.",
    metrics: [
      num("tagsps", "Tags", 1200, "/s"),
      num("latency", "Uplink latency", 180, "ms", { warn: 400, crit: 900, min: 40, max: 2000 }),
      pctUp("uplink", "Uplink health", 99.2, 98, 95),
      num("queue", "Queue depth", 40, "", { warn: 500, crit: 2000, min: 0, max: 5000 }),
    ],
  },
  {
    id: "plc-a1",
    name: "plc-west-feeder-1",
    kind: "plc",
    category: "ot",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    sku: "Allen-Bradley ControlLogix",
    ip: "172.16.20.11",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { feeder: "W-1", protocol: "EtherNet/IP" },
    metrics: [
      num("scan", "Scan time", 12, "ms", { warn: 30, crit: 60, min: 2, max: 120 }),
      num("io", "I/O points", 256, ""),
      pct("cpu", "CPU", 34),
      pctUp("comm", "Comm health", 99.8, 98, 95),
    ],
  },
  {
    id: "rtu-a1",
    name: "rtu-west-recloser",
    kind: "rtu",
    category: "ot",
    siteId: "sub-west",
    status: "warning",
    env: "edge",
    sku: "SEL-3530 RTAC",
    ip: "172.16.20.21",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { device: "recloser", protocol: "DNP3" },
    note: "Intermittent DNP3 comms on the recloser circuit.",
    metrics: [
      num("scan", "Poll time", 420, "ms", { warn: 300, crit: 800, min: 50, max: 1500 }),
      num("io", "Points", 96, ""),
      pctUp("comm", "Comm health", 96.4, 98, 95),
      pct("cpu", "CPU", 41),
    ],
  },
  {
    id: "iot-edge-a",
    name: "iot-edge-west",
    kind: "iot-edge",
    category: "ot",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    os: "Azure IoT Edge · EFLOW",
    sku: "Rugged gateway",
    ip: "172.16.12.5",
    sources: ["arc", "monitor", "scada-historian"],
    costMonthly: 0,
    tags: { modules: "3", uplink: "Eventhouse" },
    metrics: [
      num("msgs", "Messages", 860, "/s"),
      pct("cpu", "CPU", 38),
      pct("mem", "Memory", 47),
      pct("buffer", "Offline buffer", 2, 40, 80),
    ],
  },
  {
    id: "sensor-a-temp",
    name: "xfmr-west-temp",
    kind: "sensor",
    category: "ot",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    sku: "Transformer RTD",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { asset: "transformer W-1", signal: "wireless" },
    metrics: [
      num("value", "Oil temp", 62, "°C", { warn: 85, crit: 95, min: 20, max: 110 }),
      pctUp("signal", "Signal", 88, 40, 20),
      pctUp("battery", "Battery", 74, 30, 15),
    ],
  },
  {
    id: "sensor-a-vib",
    name: "xfmr-west-vib",
    kind: "sensor",
    category: "ot",
    siteId: "sub-west",
    status: "healthy",
    env: "edge",
    sku: "Vibration probe",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { asset: "transformer W-1", signal: "wired" },
    metrics: [
      num("value", "Vibration", 2.1, "mm/s", { warn: 4.5, crit: 7, min: 0, max: 12 }),
      pctUp("signal", "Signal", 96, 40, 20),
    ],
  },

  // ───────── sub-harbor (Harbor Substation · Azure Local) ─────────
  {
    id: "al-node-b1",
    name: "al-harbor-01",
    kind: "vmhost",
    category: "compute",
    siteId: "sub-harbor",
    status: "healthy",
    env: "edge",
    os: "Azure Local 23H2",
    sku: "Dell XR4000 · 2×12c / 128 GiB",
    ip: "172.17.10.11",
    sources: ["arc", "monitor", "update"],
    costMonthly: 0,
    tags: { cluster: "al-harbor", arc: "enabled" },
    metrics: [
      pct("cpu", "CPU", 40),
      pct("mem", "Memory", 55),
      num("vms", "VMs", 3, "", { min: 0, max: 6, warn: 5, crit: 6 }),
      num("temp", "Inlet temp", 31, "°C", { warn: 34, crit: 40, min: 16, max: 50 }),
    ],
  },
  {
    id: "scada-gw-b",
    name: "scada-gw-harbor",
    kind: "scada-gateway",
    category: "ot",
    siteId: "sub-harbor",
    status: "critical",
    env: "edge",
    sku: "Edge gateway · OPC UA",
    ip: "172.17.12.1",
    sources: ["scada-historian", "monitor", "arc"],
    costMonthly: 0,
    tags: { protocol: "OPC UA / Modbus", uplink: "Eventhouse" },
    note: "Uplink to Eventhouse is down — buffering locally; telemetry gap on the harbor feeders.",
    metrics: [
      num("tagsps", "Tags", 0, "/s", { min: 0, max: 1500 }),
      num("latency", "Uplink latency", 0, "ms", { warn: 400, crit: 900, min: 0, max: 2000 }),
      pctUp("uplink", "Uplink health", 0, 98, 95),
      num("queue", "Queue depth", 3400, "", { warn: 500, crit: 2000, min: 0, max: 5000 }),
    ],
  },
  {
    id: "plc-b1",
    name: "plc-harbor-feeder-1",
    kind: "plc",
    category: "ot",
    siteId: "sub-harbor",
    status: "healthy",
    env: "edge",
    sku: "Siemens S7-1500",
    ip: "172.17.20.11",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { feeder: "H-1", protocol: "PROFINET" },
    metrics: [
      num("scan", "Scan time", 10, "ms", { warn: 30, crit: 60, min: 2, max: 120 }),
      num("io", "I/O points", 192, ""),
      pct("cpu", "CPU", 30),
      pctUp("comm", "Comm health", 99.6, 98, 95),
    ],
  },
  {
    id: "iot-edge-b",
    name: "iot-edge-harbor",
    kind: "iot-edge",
    category: "ot",
    siteId: "sub-harbor",
    status: "warning",
    env: "edge",
    os: "Azure IoT Edge · EFLOW",
    sku: "Rugged gateway",
    ip: "172.17.12.5",
    sources: ["arc", "monitor", "scada-historian"],
    costMonthly: 0,
    tags: { modules: "3", uplink: "Eventhouse" },
    note: "Offline buffer filling while the SCADA gateway uplink is down.",
    metrics: [
      num("msgs", "Messages", 120, "/s"),
      pct("cpu", "CPU", 44),
      pct("mem", "Memory", 58),
      pct("buffer", "Offline buffer", 68, 40, 80),
    ],
  },
  {
    id: "sensor-b-flow",
    name: "harbor-breaker-sf6",
    kind: "sensor",
    category: "ot",
    siteId: "sub-harbor",
    status: "healthy",
    env: "edge",
    sku: "SF6 density sensor",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { asset: "breaker H-1", signal: "wired" },
    metrics: [
      num("value", "SF6 density", 6.2, "bar", {
        warn: 5.5,
        crit: 5.0,
        invert: true,
        min: 4,
        max: 8,
      }),
      pctUp("signal", "Signal", 92, 40, 20),
    ],
  },

  // ───────── plant-bayou (Bayou Generating Plant · OT) ─────────
  {
    id: "scada-gw-plant",
    name: "scada-gw-bayou",
    kind: "scada-gateway",
    category: "ot",
    siteId: "plant-bayou",
    status: "healthy",
    env: "edge",
    sku: "Edge gateway · OPC UA",
    ip: "172.18.12.1",
    sources: ["scada-historian", "monitor", "arc"],
    costMonthly: 0,
    tags: { protocol: "OPC UA", uplink: "Eventhouse" },
    metrics: [
      num("tagsps", "Tags", 2100, "/s"),
      num("latency", "Uplink latency", 150, "ms", { warn: 400, crit: 900, min: 40, max: 2000 }),
      pctUp("uplink", "Uplink health", 99.6, 98, 95),
      num("queue", "Queue depth", 30, "", { warn: 500, crit: 2000, min: 0, max: 5000 }),
    ],
  },
  {
    id: "historian-edge",
    name: "pi-edge-bayou",
    kind: "historian",
    category: "ot",
    siteId: "plant-bayou",
    status: "healthy",
    env: "edge",
    os: "Windows IoT · PI Edge",
    sku: "Edge historian",
    ip: "172.18.11.30",
    sources: ["scada-historian", "monitor", "arc"],
    costMonthly: 0,
    tags: { role: "edge historian", retention: "7d" },
    note: "Store-and-forward historian buffering plant tags to the core PI + Eventhouse.",
    metrics: [
      pct("cpu", "CPU", 42),
      pct("disk", "Disk", 58),
      num("tags", "Tags", 9.5, "K"),
      pctUp("forward", "Forward health", 99.7, 98, 95),
    ],
  },
  {
    id: "plc-plant-1",
    name: "plc-turbine-1",
    kind: "plc",
    category: "ot",
    siteId: "plant-bayou",
    status: "healthy",
    env: "edge",
    sku: "Emerson Ovation",
    ip: "172.18.20.11",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { unit: "GT-1", protocol: "Modbus TCP" },
    metrics: [
      num("scan", "Scan time", 8, "ms", { warn: 25, crit: 50, min: 2, max: 100 }),
      num("io", "I/O points", 512, ""),
      pct("cpu", "CPU", 46),
      pctUp("comm", "Comm health", 99.9, 98, 95),
    ],
  },
  {
    id: "plc-plant-2",
    name: "plc-turbine-2",
    kind: "plc",
    category: "ot",
    siteId: "plant-bayou",
    status: "warning",
    env: "edge",
    sku: "Emerson Ovation",
    ip: "172.18.20.12",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { unit: "GT-2", protocol: "Modbus TCP" },
    note: "Scan time drifting up under load on unit GT-2.",
    metrics: [
      num("scan", "Scan time", 34, "ms", { warn: 25, crit: 50, min: 2, max: 100 }),
      num("io", "I/O points", 512, ""),
      pct("cpu", "CPU", 63),
      pctUp("comm", "Comm health", 99.1, 98, 95),
    ],
  },
  {
    id: "rtu-plant",
    name: "rtu-bop-bayou",
    kind: "rtu",
    category: "ot",
    siteId: "plant-bayou",
    status: "healthy",
    env: "edge",
    sku: "SEL-3505 RTAC",
    ip: "172.18.20.21",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { system: "balance-of-plant", protocol: "DNP3" },
    metrics: [
      num("scan", "Poll time", 180, "ms", { warn: 300, crit: 800, min: 50, max: 1500 }),
      num("io", "Points", 160, ""),
      pctUp("comm", "Comm health", 99.4, 98, 95),
      pct("cpu", "CPU", 28),
    ],
  },
  {
    id: "sensor-plant-steam",
    name: "gt1-steam-pressure",
    kind: "sensor",
    category: "ot",
    siteId: "plant-bayou",
    status: "healthy",
    env: "edge",
    sku: "Steam pressure transmitter",
    sources: ["scada-historian"],
    costMonthly: 0,
    tags: { unit: "GT-1", signal: "wired" },
    metrics: [
      num("value", "Steam pressure", 1420, "psi", { warn: 1550, crit: 1650, min: 1000, max: 1800 }),
      pctUp("signal", "Signal", 98, 40, 20),
    ],
  },
];
export const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

// ── SQL estate (derived) ──────────────────────────────────────────────────────
export type SqlAsset = InfraAsset & { sql: SqlMeta };
export const SQL_INSTANCES: SqlAsset[] = ASSETS.filter((a): a is SqlAsset => !!a.sql);
/** Total SQL run-rate for an instance = service/compute + amortised license + ESU. */
export function sqlMonthlyCost(a: SqlAsset): number {
  return a.costMonthly + a.sql.licenseMonthly + a.sql.esuMonthly;
}

// ── relationships (the ontology edges) ────────────────────────────────────────
function E(from: string, to: string, rel: RelKind, note?: string): InfraEdge {
  const id = `${from}~${rel}~${to}`;
  return note === undefined ? { id, from, to, rel } : { id, from, to, rel, note };
}
export const EDGES: InfraEdge[] = [
  // app topology
  E("ca-onegrid", "aks-prod-1", "runs-on"),
  E("ca-onegrid", "aks-prod-2", "runs-on"),
  E("ca-onegrid", "aks-prod-3", "runs-on"),
  E("ca-onegrid", "sql-ops", "depends-on"),
  E("ca-onegrid", "pg-ontology", "depends-on"),
  E("ca-onegrid", "eventhouse-eh", "depends-on"),
  E("ca-onegrid", "cosmos-state", "depends-on"),
  E("ca-onegrid", "foundry-oai", "depends-on"),
  E("ca-onegrid", "fabric-cap", "depends-on"),
  E("lb-prod", "ca-onegrid", "connects-to"),
  E("fw-hub", "lb-prod", "protects"),
  E("sdn-prod", "lb-prod", "controls"),
  E("sdn-prod", "fw-hub", "controls"),
  E("fabric-cap", "eventhouse-eh", "hosts"),
  E("fabric-cap", "storage-lake", "hosts"),
  // data replication
  E("sql-ops", "sql-dr", "replicates-to"),
  E("storage-lake", "storage-dr", "replicates-to"),
  E("aks-prod-1", "aks-dr-1", "backs-up"),
  E("lb-dr", "aks-dr-1", "connects-to"),
  // cloud <-> core DC
  E("er-gw", "core-router", "connects-to"),
  E("core-router", "core-switch", "connects-to"),
  E("fw-dc", "core-router", "protects"),
  E("nc-dc", "core-switch", "controls"),
  E("hv-host-1", "vm-ad", "hosts"),
  E("hv-host-1", "vm-historian", "hosts"),
  E("hv-host-2", "vm-sql-legacy", "hosts"),
  E("hv-host-1", "sql-billing-2019", "hosts"),
  E("hv-host-1", "sql-gis-2014", "hosts"),
  E("hv-host-2", "sql-hist-2012", "hosts"),
  E("al-node-a1", "sql-scada-2017", "hosts"),
  E("ca-onegrid", "sqlmi-ops", "depends-on"),
  E("hv-host-2", "vm-historian", "backs-up"),
  E("core-switch", "hv-host-1", "connects-to"),
  E("core-switch", "hv-host-2", "connects-to"),
  E("vm-historian", "eventhouse-eh", "streams-to"),
  // Westside substation
  E("core-switch", "al-node-a1", "connects-to"),
  E("al-node-a1", "vm-scada-a", "hosts"),
  E("al-node-a2", "vm-scada-a", "backs-up"),
  E("vm-scada-a", "scada-gw-a", "depends-on"),
  E("scada-gw-a", "plc-a1", "connects-to"),
  E("scada-gw-a", "rtu-a1", "connects-to"),
  E("plc-a1", "sensor-a-temp", "connects-to"),
  E("plc-a1", "sensor-a-vib", "connects-to"),
  E("scada-gw-a", "eventhouse-eh", "streams-to"),
  E("iot-edge-a", "eventhouse-eh", "streams-to"),
  E("iot-edge-a", "sensor-a-temp", "connects-to"),
  // Harbor substation
  E("core-switch", "al-node-b1", "connects-to"),
  E("al-node-b1", "scada-gw-b", "hosts"),
  E("scada-gw-b", "plc-b1", "connects-to"),
  E("plc-b1", "sensor-b-flow", "connects-to"),
  E("scada-gw-b", "eventhouse-eh", "streams-to"),
  E("iot-edge-b", "eventhouse-eh", "streams-to"),
  // Bayou plant
  E("scada-gw-plant", "plc-plant-1", "connects-to"),
  E("scada-gw-plant", "plc-plant-2", "connects-to"),
  E("scada-gw-plant", "rtu-plant", "connects-to"),
  E("plc-plant-1", "sensor-plant-steam", "connects-to"),
  E("historian-edge", "scada-gw-plant", "depends-on"),
  E("historian-edge", "vm-historian", "streams-to"),
  E("scada-gw-plant", "eventhouse-eh", "streams-to"),
].filter((e) => ASSET_BY_ID.has(e.from) && ASSET_BY_ID.has(e.to));

export function edgesFor(assetId: string): InfraEdge[] {
  return EDGES.filter((e) => e.from === assetId || e.to === assetId);
}

export const REL_LABEL: Record<RelKind, string> = {
  hosts: "hosts",
  "runs-on": "runs on",
  "depends-on": "depends on",
  "connects-to": "connects to",
  "replicates-to": "replicates to",
  "streams-to": "streams to",
  controls: "controls",
  protects: "protects",
  monitors: "monitors",
  "backs-up": "backs up",
};

// ── service tickets ────────────────────────────────────────────────────────────
export const TICKETS: Ticket[] = [
  {
    id: "INC0048213",
    title: "SCADA gateway uplink down at Harbor Substation",
    severity: "sev1",
    status: "in-progress",
    assetId: "scada-gw-b",
    assignee: "A. Rivera",
    team: "OT Network",
    openedMinAgo: 38,
    slaMin: 60,
    source: "monitor",
    detail:
      "OPC UA uplink to Eventhouse unreachable; local buffer at 68% and climbing. Telemetry gap on harbor feeders.",
  },
  {
    id: "INC0048207",
    title: "Legacy GIS DB volume 96% full",
    severity: "sev2",
    status: "ack",
    assetId: "vm-sql-legacy",
    assignee: "J. Okafor",
    team: "Platform",
    openedMinAgo: 126,
    slaMin: 240,
    source: "monitor",
    detail:
      "Data drive on vm-sql-legacy at 96%. Autogrow exhausted; schedule cleanup or migrate off Server 2016.",
  },
  {
    id: "INC0048199",
    title: "Eventhouse ingestion lag above threshold",
    severity: "sev2",
    status: "in-progress",
    assetId: "eventhouse-eh",
    assignee: "M. Chen",
    team: "Data Platform",
    openedMinAgo: 54,
    slaMin: 120,
    source: "grafana",
    detail:
      "Ingestion lag 55s (SLO 45s). Correlates with harbor gateway buffer flush backpressure.",
  },
  {
    id: "INC0048188",
    title: "aks-prod-2 memory pressure / pod evictions",
    severity: "sev3",
    status: "ack",
    assetId: "aks-prod-2",
    assignee: "M. Chen",
    team: "Platform",
    openedMinAgo: 95,
    slaMin: 480,
    source: "grafana",
    detail:
      "Working set 88%. SSR render pods evicted twice overnight. Recommend right-size to D16s_v5 or add a node.",
  },
  {
    id: "INC0048176",
    title: "Recloser RTU intermittent DNP3 comms",
    severity: "sev3",
    status: "new",
    assetId: "rtu-a1",
    assignee: "Unassigned",
    team: "OT Field",
    openedMinAgo: 180,
    slaMin: 480,
    source: "scada-historian",
    detail: "Comm health 96.4% on rtu-west-recloser. Suspected fiber SFP; dispatch field tech.",
  },
  {
    id: "INC0048170",
    title: "hv-core-02 missing 3 security updates",
    severity: "sev3",
    status: "ack",
    assetId: "hv-host-2",
    assignee: "R. Patel",
    team: "Security",
    openedMinAgo: 320,
    slaMin: 1440,
    source: "update",
    detail:
      "Three critical Windows updates past the maintenance window. Schedule patch + reboot with cluster drain.",
  },
  {
    id: "INC0048155",
    title: "GT-2 PLC scan time drift",
    severity: "sev4",
    status: "new",
    assetId: "plc-plant-2",
    assignee: "Unassigned",
    team: "OT Field",
    openedMinAgo: 240,
    slaMin: 2880,
    source: "scada-historian",
    detail:
      "Scan time trending from 10ms to 34ms under load. Monitor; may indicate logic bloat on GT-2.",
  },
  {
    id: "INC0048149",
    title: "Defender for Cloud agent degraded coverage",
    severity: "sev4",
    status: "in-progress",
    assetId: "hv-host-2",
    assignee: "R. Patel",
    team: "Security",
    openedMinAgo: 410,
    slaMin: 2880,
    source: "defender",
    detail:
      "MDE sensor heartbeat stale on 4 servers; secure-score impacted. Re-onboard via Arc extension.",
  },
  {
    id: "INC0048132",
    title: "DR App Gateway stopped (expected)",
    severity: "sev4",
    status: "resolved",
    assetId: "lb-dr",
    assignee: "Automation",
    team: "Platform",
    openedMinAgo: 1440,
    slaMin: 2880,
    source: "resourcegraph",
    detail:
      "agw-onegrid-dr intentionally stopped to save cost; recovery runbook starts it on failover. Closed as by-design.",
  },
];

// ── outages + root-cause analysis ─────────────────────────────────────────────
export type OutageStatus = "active" | "mitigated" | "resolved";
export interface OutageEvent {
  tMinAgo: number;
  kind: "signal" | "event" | "action";
  assetId?: string;
  message: string;
}
export interface OutageEvidence {
  assetId: string;
  metricKey?: string;
  note: string;
}
export interface Outage {
  id: string;
  title: string;
  severity: TicketSeverity;
  status: OutageStatus;
  startedMinAgo: number;
  /** null while still ongoing (active/mitigated). */
  durationMin: number | null;
  rootCauseAssetId: string;
  rootCauseSummary: string;
  /** Ordered causal path of asset ids: root cause -> … -> impact. */
  chain: string[];
  impactedAssetIds: string[];
  affectedServices: string[];
  estUsers: number;
  slaMin: number;
  timeline: OutageEvent[];
  evidence: OutageEvidence[];
  remediation: string[];
  relatedTicketId?: string;
}

export const OUTAGES: Outage[] = [
  {
    id: "OUT-4821",
    title: "Harbor Substation telemetry blackout",
    severity: "sev1",
    status: "active",
    startedMinAgo: 38,
    durationMin: null,
    rootCauseAssetId: "scada-gw-b",
    rootCauseSummary:
      "The OPC UA uplink from scada-gw-harbor to Eventhouse dropped (suspected fiber SFP). Tags are buffering in the edge store-and-forward, driving ingestion lag and a live telemetry gap across the Harbor feeders.",
    chain: ["scada-gw-b", "eventhouse-eh", "ca-onegrid"],
    impactedAssetIds: ["scada-gw-b", "iot-edge-b", "eventhouse-eh", "plc-b1", "sensor-b-flow"],
    affectedServices: ["OT telemetry — Harbor feeders", "Real-time exposure model"],
    estUsers: 6,
    slaMin: 60,
    timeline: [
      {
        tMinAgo: 38,
        kind: "event",
        assetId: "scada-gw-b",
        message: "OPC UA session to OneGridEH failed: timeout",
      },
      { tMinAgo: 37, kind: "signal", assetId: "scada-gw-b", message: "Uplink health 99% → 0%" },
      {
        tMinAgo: 34,
        kind: "signal",
        assetId: "scada-gw-b",
        message: "Queue depth climbing past 2,000 (SLO 500)",
      },
      { tMinAgo: 30, kind: "signal", assetId: "iot-edge-b", message: "Offline buffer 40% → 68%" },
      {
        tMinAgo: 28,
        kind: "signal",
        assetId: "eventhouse-eh",
        message: "Ingestion lag crossed SLO (45s → 55s)",
      },
      { tMinAgo: 25, kind: "event", message: "Alert fired: Harbor telemetry blackout (Sev1)" },
      { tMinAgo: 10, kind: "action", message: "OT Network paged — inspecting fiber SFP at Harbor" },
    ],
    evidence: [
      { assetId: "scada-gw-b", metricKey: "uplink", note: "Uplink health flatlined at 0%" },
      { assetId: "scada-gw-b", metricKey: "queue", note: "Buffer queue depth ~3,400 tags" },
      { assetId: "iot-edge-b", metricKey: "buffer", note: "Edge offline buffer 68% and rising" },
      { assetId: "eventhouse-eh", metricKey: "lag", note: "Ingestion lag 55s (SLO 45s)" },
    ],
    remediation: [
      "Fail the OT uplink over to the LTE backup APN",
      "Replace the suspect fiber SFP at Harbor Substation",
      "Once restored, drain buffered tags and verify no gaps in OneGridEH",
    ],
    relatedTicketId: "INC0048213",
  },
  {
    id: "OUT-4820",
    title: "GIS query failures — legacy SQL volume full",
    severity: "sev2",
    status: "mitigated",
    startedMinAgo: 126,
    durationMin: null,
    rootCauseAssetId: "vm-sql-legacy",
    rootCauseSummary:
      "The data volume on vm-sql-legacy reached 96% and autogrow failed (no space on device), so GIS spatial queries began timing out. The instance (SQL Server 2016) is also past end of support — ESU-eligible but not enrolled.",
    chain: ["vm-sql-legacy", "ca-onegrid"],
    impactedAssetIds: ["vm-sql-legacy"],
    affectedServices: ["GIS / outage-map queries", "Dispatch"],
    estUsers: 35,
    slaMin: 240,
    timeline: [
      { tMinAgo: 126, kind: "signal", assetId: "vm-sql-legacy", message: "Data volume 90% → 96%" },
      {
        tMinAgo: 120,
        kind: "event",
        assetId: "vm-sql-legacy",
        message: "Autogrow failed: no space on device (E:)",
      },
      { tMinAgo: 118, kind: "signal", assetId: "vm-sql-legacy", message: "IO latency 12ms → 42ms" },
      { tMinAgo: 116, kind: "event", message: "GIS query timeouts reported by Dispatch" },
      {
        tMinAgo: 100,
        kind: "action",
        message: "Freed ~40 GB of stale backups — queries recovered (mitigated)",
      },
    ],
    evidence: [
      { assetId: "vm-sql-legacy", metricKey: "disk", note: "Data volume at 96%" },
      { assetId: "vm-sql-legacy", metricKey: "latency", note: "IO latency 42ms (SLO 20ms)" },
    ],
    remediation: [
      "Expand the E: volume / attach a managed data disk",
      "Migrate to Azure SQL MI to remove the end-of-support exposure",
      "If staying on 2016, enroll Extended Security Updates via Azure Arc",
    ],
    relatedTicketId: "INC0048207",
  },
  {
    id: "OUT-4815",
    title: "Slow web app — AKS node memory pressure",
    severity: "sev3",
    status: "resolved",
    startedMinAgo: 300,
    durationMin: 95,
    rootCauseAssetId: "aks-prod-2",
    rootCauseSummary:
      "Memory pressure on aks-onegrid-prod-2 evicted the SSR render pods, so the web app served slow and intermittently empty responses until cluster-autoscaler added a node.",
    chain: ["aks-prod-2", "ca-onegrid"],
    impactedAssetIds: ["aks-prod-2", "ca-onegrid"],
    affectedServices: ["OneGrid web app (SSR render)"],
    estUsers: 210,
    slaMin: 480,
    timeline: [
      { tMinAgo: 300, kind: "signal", assetId: "aks-prod-2", message: "Working set 80% → 88%" },
      {
        tMinAgo: 296,
        kind: "event",
        assetId: "aks-prod-2",
        message: "Pod onegrid-web-7c9 evicted (MemoryPressure)",
      },
      { tMinAgo: 292, kind: "signal", assetId: "ca-onegrid", message: "p95 latency 180ms → 820ms" },
      { tMinAgo: 290, kind: "event", message: "Alert: web app p95 breach (Sev3)" },
      {
        tMinAgo: 220,
        kind: "action",
        message: "Cluster-autoscaler added a D8s_v5 node to the user pool",
      },
      { tMinAgo: 205, kind: "action", message: "Latency recovered — incident resolved" },
    ],
    evidence: [
      { assetId: "aks-prod-2", metricKey: "mem", note: "Working set 88% at peak" },
      { assetId: "ca-onegrid", metricKey: "p95", note: "p95 820ms (SLO 400ms)" },
    ],
    remediation: [
      "Raise the user-pool minimum nodes / right-size to memory-optimized E-series",
      "Set memory requests & limits on the SSR render pods",
      "Add an HPA keyed on working-set",
    ],
    relatedTicketId: "INC0048188",
  },
];

export const OUTAGE_STATUS_META: Record<OutageStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "#ff5a5f" },
  mitigated: { label: "Mitigated", color: "#f0b429" },
  resolved: { label: "Resolved", color: "#3fb950" },
};

// ── cost recommendations (Advisor-style) ──────────────────────────────────────
export const COST_RECS: CostRec[] = [
  {
    id: "cost-1",
    title: "Stop idle DR AKS node outside drills",
    assetId: "aks-dr-1",
    category: "idle",
    monthlySaving: 410,
    effort: "low",
    detail:
      "aks-onegrid-dr-1 averages 12% CPU. Scale the warm-standby pool to 0 between DR tests and let cluster-autoscaler re-scale on failover.",
  },
  {
    id: "cost-2",
    title: "Buy 1-year reservation for Fabric F16",
    assetId: "fabric-cap",
    category: "reservation",
    monthlySaving: 760,
    effort: "low",
    detail:
      "ogestu runs 24×6 at steady utilization. A 1-year reserved capacity cuts ~26% versus pay-as-you-go.",
  },
  {
    id: "cost-3",
    title: "Right-size sql-onegrid-ops to GP 6-vCore",
    assetId: "sql-ops",
    category: "rightsize",
    monthlySaving: 320,
    effort: "medium",
    detail:
      "Peak DTU 57% on an 8-vCore Business Critical tier. General Purpose 6-vCore holds headroom and drops cost.",
  },
  {
    id: "cost-4",
    title: "Delete orphaned managed disks",
    assetId: "vm-sql-legacy",
    category: "orphaned",
    monthlySaving: 90,
    effort: "low",
    detail: "Three unattached premium disks left from the GIS DB migration test are still billing.",
  },
  {
    id: "cost-5",
    title: "Move cold OneLake data to cool tier",
    assetId: "storage-lake",
    category: "storage-tier",
    monthlySaving: 140,
    effort: "medium",
    detail:
      "18 TB of parquet older than 90 days is in hot tier but rarely read. Lifecycle-manage to cool.",
  },
  {
    id: "cost-6",
    title: "Reserve App Gateway WAF capacity units",
    assetId: "lb-prod",
    category: "reservation",
    monthlySaving: 70,
    effort: "low",
    detail: "Steady WAF_v2 capacity-unit floor qualifies for a reservation.",
  },
];

// ── performance recommendations ────────────────────────────────────────────────
export const PERF_RECS: PerfRec[] = [
  {
    id: "perf-1",
    title: "Add a node or right-size aks-prod-2",
    assetId: "aks-prod-2",
    impact: "high",
    metricKey: "mem",
    detail:
      "Working set 88% with repeated evictions of the SSR render pods. Add a D8s_v5 node to the user pool or move to memory-optimized E-series.",
  },
  {
    id: "perf-2",
    title: "Migrate vm-sql-legacy off premium-throttled disk",
    assetId: "vm-sql-legacy",
    impact: "high",
    metricKey: "latency",
    detail:
      "IO latency 42 ms at 96% disk. Move data file to a P40 or managed instance; current queue depth is starving GIS queries.",
  },
  {
    id: "perf-3",
    title: "Scale Eventhouse ingestion or shed OT load",
    assetId: "eventhouse-eh",
    impact: "high",
    metricKey: "lag",
    detail:
      "Ingestion lag over SLO. Increase cache/compute or stage the harbor gateway backlog so query latency recovers.",
  },
  {
    id: "perf-4",
    title: "Tune GT-2 PLC control logic",
    assetId: "plc-plant-2",
    impact: "medium",
    metricKey: "scan",
    detail:
      "Scan time drifting toward the 50 ms alarm. Profile the ladder logic; offload non-critical routines to a slower task.",
  },
  {
    id: "perf-5",
    title: "Enable read scale-out on pg-ontology",
    assetId: "pg-ontology",
    impact: "low",
    metricKey: "cpu",
    detail:
      "Route ontology read queries to the zone-redundant replica to free primary CPU during graph rebuilds.",
  },
  {
    id: "perf-6",
    title: "Increase App Gateway instance floor",
    assetId: "lb-prod",
    impact: "medium",
    metricKey: "rps",
    detail:
      "Autoscale min of 2 causes cold-start latency at the morning request ramp. Raise the floor to 3.",
  },
];

// ── log stream (Log Analytics-style) ───────────────────────────────────────────
const LOG_SEED: Array<Omit<LogEntry, "id" | "tsMsAgo">> = [
  {
    level: "critical",
    source: "monitor",
    table: "AzureActivity",
    assetId: "scada-gw-b",
    message: "Heartbeat lost: OPC UA uplink to OneGridEH unreachable for 300s",
  },
  {
    level: "warn",
    source: "grafana",
    table: "ContainerInsights",
    assetId: "aks-prod-2",
    message: "Pod onegrid-web-7c9 evicted: node memory pressure (MemoryPressure=true)",
  },
  {
    level: "warn",
    source: "monitor",
    table: "AzureDiagnostics",
    assetId: "eventhouse-eh",
    message: "Ingestion latency 55s exceeds SLO 45s on database OneGridEH",
  },
  {
    level: "error",
    source: "monitor",
    table: "Event",
    assetId: "vm-sql-legacy",
    message: "Volume E: at 96% — autogrow failed, no space on device",
  },
  {
    level: "info",
    source: "arc",
    table: "HeartBeat",
    assetId: "al-node-a1",
    message:
      "Arc agent heartbeat OK; extensions AzureMonitorWindowsAgent, AzureSecurityWindowsAgent healthy",
  },
  {
    level: "warn",
    source: "scada-historian",
    table: "PiPoints",
    assetId: "rtu-a1",
    message: "DNP3 poll timeout on rtu-west-recloser (retry 2/3)",
  },
  {
    level: "info",
    source: "defender",
    table: "SecurityAlert",
    assetId: "hv-host-2",
    message: "Recommendation: apply 3 missing critical updates (secure-score -4)",
  },
  {
    level: "info",
    source: "monitor",
    table: "AppRequests",
    assetId: "ca-onegrid",
    message: "GET /api/weather/events 200 in 182ms",
  },
  {
    level: "trace",
    source: "scada-historian",
    table: "PiPoints",
    assetId: "scada-gw-plant",
    message: "Flushed 2100 tags/s to OneGridEH (queue depth 30)",
  },
  {
    level: "warn",
    source: "grafana",
    table: "ContainerInsights",
    assetId: "aks-prod-2",
    message: "Working set 88% on node aks-onegrid-prod-2",
  },
  {
    level: "info",
    source: "update",
    table: "UpdateSummary",
    assetId: "hv-host-1",
    message: "Patch assessment complete: 0 pending, last reboot 6d ago",
  },
  {
    level: "error",
    source: "scada-historian",
    table: "PiPoints",
    assetId: "scada-gw-b",
    message: "Buffer backpressure: local store-and-forward at 68% capacity",
  },
  {
    level: "info",
    source: "monitor",
    table: "AppRequests",
    assetId: "ca-onegrid",
    message: "POST /api/chat 200 streamed in 1.9s (gpt-5-mini)",
  },
  {
    level: "info",
    source: "resourcegraph",
    table: "ResourceChanges",
    assetId: "lb-dr",
    message: "Property change: Microsoft.Network/applicationGateways operationalState -> Stopped",
  },
  {
    level: "trace",
    source: "monitor",
    table: "Perf",
    assetId: "fabric-cap",
    message: "Capacity CU utilization 63%, throttling 0%",
  },
  {
    level: "warn",
    source: "monitor",
    table: "AzureMetrics",
    assetId: "plc-plant-2",
    message: "Scan time 34ms approaching alarm (50ms) on plc-turbine-2",
  },
];
const LOG_MESSAGES: Array<Omit<LogEntry, "id" | "tsMsAgo">> = [
  {
    level: "info",
    source: "monitor",
    table: "AppRequests",
    assetId: "ca-onegrid",
    message: "GET /api/fleet-assets 200 in 96ms",
  },
  {
    level: "trace",
    source: "scada-historian",
    table: "PiPoints",
    assetId: "scada-gw-a",
    message: "Flushed 1200 tags/s to OneGridEH (queue depth 40)",
  },
  {
    level: "info",
    source: "arc",
    table: "HeartBeat",
    assetId: "hv-host-1",
    message: "Arc agent heartbeat OK",
  },
  {
    level: "info",
    source: "monitor",
    table: "AppRequests",
    assetId: "ca-onegrid",
    message: "GET /webapp/app 200 in 41ms",
  },
  {
    level: "warn",
    source: "scada-historian",
    table: "PiPoints",
    assetId: "rtu-a1",
    message: "DNP3 poll timeout on rtu-west-recloser (retry 1/3)",
  },
  {
    level: "trace",
    source: "monitor",
    table: "Perf",
    assetId: "sql-ops",
    message: "DTU 57%, read latency 6ms",
  },
  {
    level: "info",
    source: "grafana",
    table: "ContainerInsights",
    assetId: "aks-prod-1",
    message: "Node ready; 22 pods running",
  },
  {
    level: "error",
    source: "monitor",
    table: "AzureDiagnostics",
    assetId: "scada-gw-b",
    message: "OPC UA session create failed: timeout",
  },
];
let logCounter = 0;
export function seedLogs(): LogEntry[] {
  return LOG_SEED.map((l, i) => ({
    ...l,
    id: `log-seed-${i}`,
    tsMsAgo: i * 2400 + Math.round(Math.random() * 800),
  }));
}
export function nextLog(): LogEntry {
  const base = LOG_MESSAGES[Math.floor(Math.random() * LOG_MESSAGES.length)]!;
  logCounter += 1;
  return { ...base, id: `log-live-${logCounter}`, tsMsAgo: 0 };
}

// ── derived fleet stats ────────────────────────────────────────────────────────
export interface FleetStats {
  total: number;
  byStatus: Record<InfraStatus, number>;
  byCategory: Record<InfraCategory, number>;
  bySite: Record<string, { total: number; worst: InfraStatus }>;
  healthScore: number;
  monthlyCost: number;
  openIncidents: number;
  sev1: number;
  potentialSavings: number;
}
export function fleetStats(): FleetStats {
  const byStatus: Record<InfraStatus, number> = { healthy: 0, warning: 0, critical: 0, offline: 0 };
  const byCategory: Record<InfraCategory, number> = {
    compute: 0,
    data: 0,
    network: 0,
    ot: 0,
    platform: 0,
  };
  const bySite: Record<string, { total: number; worst: InfraStatus }> = {};
  let cost = 0;
  for (const a of ASSETS) {
    byStatus[a.status] += 1;
    byCategory[a.category] += 1;
    cost += a.costMonthly;
    const s = (bySite[a.siteId] ??= { total: 0, worst: "healthy" });
    s.total += 1;
    if (STATUS_RANK[a.status] < STATUS_RANK[s.worst]) s.worst = a.status;
  }
  // Weighted health: healthy=1, warning=.6, offline=.4, critical=0.
  const w = { healthy: 1, warning: 0.6, offline: 0.4, critical: 0 } as const;
  const score = ASSETS.reduce((s, a) => s + w[a.status], 0) / ASSETS.length;
  const openIncidents = TICKETS.filter((t) => t.status !== "resolved").length;
  const sev1 = TICKETS.filter((t) => t.status !== "resolved" && t.severity === "sev1").length;
  const potentialSavings = COST_RECS.reduce((s, r) => s + r.monthlySaving, 0);
  return {
    total: ASSETS.length,
    byStatus,
    byCategory,
    bySite,
    healthScore: Math.round(score * 1000) / 10,
    monthlyCost: cost,
    openIncidents,
    sev1,
    potentialSavings,
  };
}

// Status derived from a metric against its thresholds (used by live gauges).
export function metricStatus(m: InfraMetric, value = m.value): InfraStatus {
  if (m.warn === undefined && m.crit === undefined) return "healthy";
  if (m.invert) {
    if (m.crit !== undefined && value <= m.crit) return "critical";
    if (m.warn !== undefined && value <= m.warn) return "warning";
    return "healthy";
  }
  if (m.crit !== undefined && value >= m.crit) return "critical";
  if (m.warn !== undefined && value >= m.warn) return "warning";
  return "healthy";
}
