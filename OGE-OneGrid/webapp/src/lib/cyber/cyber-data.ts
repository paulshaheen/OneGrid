// Cyber readiness model for OneGrid (Energy) and OneRig (Oil & Gas). Each solution has an
// "estate": its critical IT/OT systems, how they connect, what each site carries, and a
// scripted tabletop. The blast radius of a compromise is computed over the estate's
// dependency graph. Pure data and functions, safe for the client bundle.
import { ASSET_BY_ID, EDGES, KIND_LABEL, SITE_BY_ID } from "@/lib/infra/infra-data";

export type Rel =
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

export interface EstateAsset {
  id: string;
  name: string;
  kindLabel: string;
  /** OT systems are the ones whose loss takes control away from operators. */
  ot: boolean;
  siteId: string;
  status: "healthy" | "warning" | "critical" | "offline";
  /** Joined to the Windows domain, so a domain-controller compromise reaches it. */
  domainJoined?: boolean;
}

export interface SiteImpact {
  siteId: string;
  name: string;
  /** Primary exposure measure (customers, or barrels per day). */
  a: number;
  /** Secondary exposure measure (MW of generation, or people on board). */
  b: number;
  costPerHour: number;
  /** What goes dark for operators. */
  effect: string;
}

export interface CrownJewel {
  id: string;
  role: string;
  why: string;
}

export interface Hypothesis {
  name: string;
  confidence: "High" | "Medium" | "Low" | "Very low";
  evidenceFor: string[];
  evidenceAgainst: string[];
}

export interface RecommendedAction {
  id: string;
  label: string;
  note: string;
  /** Pre-selected for approval. */
  recommended: boolean;
}

export interface TabletopStep {
  t: string;
  title: string;
  body: string;
  tone: "info" | "warn" | "critical" | "action";
  /** Playback stops here until an operator decides. */
  decision?: boolean;
}

export interface TabletopSpec {
  title: string;
  site: string;
  jewelId: string;
  steps: TabletopStep[];
  hypotheses: Hypothesis[];
  actions: RecommendedAction[];
  openQuestions: string[];
  /** One-line summary for the handoff card. */
  observed: string;
  /** Timestamped lines for the copied handoff text. */
  observedLog: string[];
  /** Short name for footnotes, e.g. "the Bayou plant". */
  place: string;
  /** "plant" or "platform": where nothing happens until a person approves. */
  noun: string;
  approver: string;
  incidentCommander: string;
  /** What the exposure means on the ground, e.g. "640 MW on manual control". */
  atRisk: (r: { a: number; b: number }) => string;
}

export interface Estate {
  id: "energy" | "og";
  brand: string;
  assets: Map<string, EstateAsset>;
  edges: { from: string; to: string; rel: Rel }[];
  siteName: (id: string) => string;
  /** Compact site label for tables. */
  shortSite: (name: string) => string;
  impact: Record<string, SiteImpact>;
  metrics: { a: { label: string; fmt: (n: number) => string }; b: { label: string; fmt: (n: number) => string } };
  assumptions: string;
  jewels: CrownJewel[];
  identityId: string;
  pivotFrom: Set<string>;
  analyticsIds: string[];
  tabletop: TabletopSpec;
}

// ── Shared tabletop pieces ───────────────────────────────────────────────────
const step = (t: string, title: string, body: string, tone: TabletopStep["tone"], decision = false): TabletopStep => ({ t, title, body, tone, ...(decision ? { decision } : {}) });
const weighs = (brand: string) =>
  step(
    "02:32",
    `${brand} weighs the explanations`,
    `${brand} ranks the possible causes with the evidence for and against each, and flags the event for people to decide. It does not conclude on its own.`,
    "critical",
  );
const handoff = (brand: string) =>
  step(
    "02:47",
    "Handoff package ready for outside responders",
    `${brand} assembles the evidence, open questions, affected systems and modeled exposure for the incident commander to review and send through the documented engagement path.`,
    "action",
  );
const PRESERVE: RecommendedAction = { id: "preserve", label: "Preserve historian logs and memory; don't reboot", note: "Rebooting destroys evidence responders need.", recommended: true };
const VERIFY: RecommendedAction = { id: "verify", label: "Check process values on local panels", note: "Operators trust local instruments, not the historian, until cleared.", recommended: true };
const SOC: RecommendedAction = { id: "soc", label: "Open a SOC investigation", note: "Security operations look for the attacker's access.", recommended: true };

// ── Energy (OneGrid): the utility estate from Infrastructure ────────────────
const ENERGY_IMPACT: Record<string, SiteImpact> = {
  "sub-west": { siteId: "sub-west", name: "Westside Substation", a: 18_400, b: 0, costPerHour: 18_400 * 9, effect: "Remote control of feeders W-1 to W-4 and the recloser" },
  "sub-harbor": { siteId: "sub-harbor", name: "Harbor Substation", a: 14_900, b: 0, costPerHour: 14_900 * 9, effect: "Remote control and protection data for the Harbor feeders" },
  "plant-bayou": { siteId: "plant-bayou", name: "Bayou Generating Plant", a: 0, b: 640, costPerHour: 640 * 95, effect: "Turbine and balance-of-plant control (GT1, unit 2)" },
};
const ENERGY_DOMAIN_KINDS = new Set(["vm", "vmhost", "sql-db", "historian"]);
const ENERGY_ON_PREM = new Set(["dc-hou", "sub-west", "sub-harbor", "plant-bayou"]);

const ENERGY: Estate = {
  id: "energy",
  brand: "OneGrid",
  assets: new Map(
    [...ASSET_BY_ID.values()].map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        kindLabel: KIND_LABEL[a.kind],
        ot: a.category === "ot",
        siteId: a.siteId,
        status: a.status,
        domainJoined: ENERGY_ON_PREM.has(a.siteId) && ENERGY_DOMAIN_KINDS.has(a.kind),
      },
    ]),
  ),
  edges: EDGES.map((e) => ({ from: e.from, to: e.to, rel: e.rel })),
  siteName: (id) => SITE_BY_ID.get(id)?.name ?? id,
  shortSite: (n) => n.replace(" Substation", "").replace(" Generating Plant", " plant"),
  impact: ENERGY_IMPACT,
  metrics: {
    a: { label: "Customers", fmt: (n) => n.toLocaleString("en-US") },
    b: { label: "Generation", fmt: (n) => `${n} MW` },
  },
  assumptions: "$9 per customer-hour and $95/MWh replacement power",
  jewels: [
    { id: "vm-ad", role: "Active Directory domain controller", why: "Identity for every on-premises system. Usually the first target in ransomware attacks." },
    { id: "fw-dc", role: "Core firewall (IT/OT boundary)", why: "The boundary between corporate IT and the substation networks." },
    { id: "historian-edge", role: "PI historian, plant edge", why: "Sits between plant control and IT. A common pivot from IT into OT." },
    { id: "vm-historian", role: "PI historian, central", why: "System of record for operations data; feeds analytics, planning and OneGrid." },
    { id: "scada-gw-plant", role: "SCADA gateway, Bayou plant", why: "Talks directly to the turbine and balance-of-plant controllers." },
    { id: "vm-scada-a", role: "SCADA server, Westside", why: "Operator control of the Westside feeders." },
    { id: "scada-gw-a", role: "SCADA gateway, Westside", why: "Talks directly to the feeder PLC and recloser RTU." },
    { id: "scada-gw-b", role: "SCADA gateway, Harbor", why: "Talks directly to the Harbor feeder controllers." },
    { id: "eventhouse-eh", role: "Real-time telemetry store (Fabric Eventhouse)", why: "Every live reading OneGrid shows flows through it." },
    { id: "sql-scada-2017", role: "SCADA database (SQL Server 2017)", why: "Configuration and alarm history for Westside SCADA." },
  ],
  identityId: "vm-ad",
  pivotFrom: new Set(["historian-edge", "vm-scada-a"]),
  analyticsIds: ["eventhouse-eh", "vm-historian", "ca-onegrid"],
  tabletop: {
    title: "Suspected historian tampering at Bayou plant",
    site: "Bayou Generating Plant",
    jewelId: "historian-edge",
    steps: [
      step("02:14", "Configuration change outside the change window", "The SCADA gateway at Bayou (scada-gw-bayou) accepts a configuration push from the plant historian. No change ticket exists.", "info"),
      step("02:31", "14 sensors flatline in the same second", "Steam pressure, turbine vibration and bearing temperatures on GT1 and unit 2 stop changing at once. The control room HMI keeps updating.", "warn"),
      weighs("OneGrid"),
      step("02:34", "Recommended actions wait for operator approval", "OneGrid recommends preserving evidence, checking values on local panels and opening a SOC investigation. Isolating any OT link is an operations decision.", "action", true),
      step("02:41", "SOC corroborates; incident commander declares Sev 1", "The SOC finds an unknown outbound connection from the plant historian. The plant manager, as incident commander, declares a Sev 1 cyber incident.", "critical"),
      handoff("OneGrid"),
    ],
    hypotheses: [
      { name: "Tampering or replayed data", confidence: "High", evidenceFor: ["Configuration change at 02:14 with no ticket", "Values repeat the 01:31–01:32 window exactly", "HMI and historian disagree"], evidenceAgainst: ["No malware alert yet"] },
      { name: "Historian or interface failure", confidence: "Medium", evidenceFor: ["Would freeze many tags at once"], evidenceAgainst: ["Doesn't explain the configuration change or the repeated values"] },
      { name: "Network loss to the gateway", confidence: "Low", evidenceFor: ["Would freeze tags from both units"], evidenceAgainst: ["HMI still updating; plant network healthy"] },
      { name: "Instrument failure", confidence: "Very low", evidenceFor: [], evidenceAgainst: ["14 tags across 2 units in the same second"] },
    ],
    actions: [
      PRESERVE,
      VERIFY,
      SOC,
      { id: "isolate", label: "Isolate the historian's link to the SCADA gateway", note: "Operations decision: the plant runs on local control and loses remote history.", recommended: false },
    ],
    openQuestions: [
      "Is the replay limited to the historian, or are control commands affected?",
      "How did the configuration push reach the SCADA gateway?",
      "Are historians at other plants affected?",
    ],
    observed: "Configuration change with no ticket (02:14), 14 tags frozen while the HMI updates (02:31), unknown outbound connection from the historian (02:41)",
    observedLog: [
      "02:14 configuration change on the SCADA gateway, no change ticket",
      "02:31 14 tags frozen across GT1 and unit 2; HMI still updating",
      "02:41 SOC: unknown outbound connection from the plant historian",
    ],
    place: "the Bayou plant",
    noun: "plant",
    approver: "Shift supervisor, Bayou",
    incidentCommander: "Plant manager, Bayou Generating Plant",
    atRisk: (r) => `${r.b} MW on manual control`,
  },
};

// ── Oil & Gas (OneRig): Gulf of Mexico estate ───────────────────────────────
const OG_SITES: Record<string, string> = {
  "hou-dc": "Houston Data Center",
  "ros-fourchon": "Remote Operations Center, Port Fourchon",
  "plt-t1": "Platform Titan-1",
  "plt-d7": "Platform Delta-7",
  "plt-m4": "Platform Mercury-4",
  "pl-eagle7": "Eagle-7 Compressor Station",
  azure: "Azure (OneRig)",
};

const og = (id: string, name: string, kindLabel: string, siteId: string, ot: boolean, extra: Partial<EstateAsset> = {}): EstateAsset => ({
  id,
  name,
  kindLabel,
  ot,
  siteId,
  status: "healthy",
  ...extra,
});

const OG_ASSETS: EstateAsset[] = [
  og("og-ad", "dc-hou-01", "Domain controller", "hou-dc", false),
  og("og-host", "hv-hou-01", "Virtualization host", "hou-dc", false, { domainJoined: true }),
  og("og-fw", "fw-itot-hou", "Firewall", "hou-dc", false),
  og("og-pi", "pi-central-hou", "Historian", "hou-dc", false, { domainJoined: true }),
  og("og-erp", "sap-pm-hou", "ERP (maintenance)", "hou-dc", false, { domainJoined: true }),
  og("og-scada", "scada-ros-fourchon", "SCADA server", "ros-fourchon", true, { domainJoined: true }),
  og("og-hmi", "hmi-ros-01", "Operator HMI", "ros-fourchon", true, { domainJoined: true }),
  og("og-vsat", "vsat-hub-fourchon", "Satellite and microwave hub", "ros-fourchon", false, { status: "warning" }),
  ...(["t1", "d7", "m4"] as const).flatMap((p) => {
    const name = p === "t1" ? "titan1" : p === "d7" ? "delta7" : "mercury4";
    const site = `plt-${p}`;
    return [
      og(`dcs-${p}`, `dcs-${name}`, "Process control system (DCS)", site, true),
      og(`sis-${p}`, `sis-${name}`, "Safety instrumented system", site, true),
      og(`ews-${p}`, `ews-${name}`, "Engineering workstation", site, true, { domainJoined: true }),
      og(`pie-${p}`, `pi-edge-${name}`, "Historian", site, true, { domainJoined: true }),
      og(`plc-${p}`, `plc-${name}-compressor`, "PLC", site, true, p === "m4" ? { status: "warning" } : {}),
      og(`sen-${p}`, `${name}-comp-vib`, "Field sensor", site, true),
    ];
  }),
  og("rtu-e7", "rtu-eagle7-cs", "RTU", "pl-eagle7", true),
  og("plc-e7", "plc-eagle7-compressor", "PLC", "pl-eagle7", true),
  og("og-eh", "OneRigEH", "Eventhouse (KQL)", "azure", false),
  og("og-app", "ca-onerig-web", "Container app", "azure", false),
];

const OG_EDGES: Estate["edges"] = [
  { from: "og-host", to: "og-ad", rel: "hosts" },
  { from: "og-host", to: "og-pi", rel: "hosts" },
  { from: "og-host", to: "og-erp", rel: "hosts" },
  { from: "og-fw", to: "og-vsat", rel: "protects" },
  { from: "og-fw", to: "og-scada", rel: "protects" },
  { from: "og-hmi", to: "og-scada", rel: "depends-on" },
  { from: "og-scada", to: "rtu-e7", rel: "controls" },
  { from: "rtu-e7", to: "plc-e7", rel: "controls" },
  ...(["t1", "d7", "m4"] as const).flatMap((p): Estate["edges"] => [
    { from: "og-vsat", to: `dcs-${p}`, rel: "connects-to" },
    { from: "og-scada", to: `dcs-${p}`, rel: "monitors" },
    { from: `dcs-${p}`, to: `plc-${p}`, rel: "controls" },
    { from: `plc-${p}`, to: `sen-${p}`, rel: "connects-to" },
    { from: `ews-${p}`, to: `dcs-${p}`, rel: "connects-to" },
    { from: `ews-${p}`, to: `sis-${p}`, rel: "connects-to" },
    { from: `pie-${p}`, to: `dcs-${p}`, rel: "depends-on" },
    { from: `pie-${p}`, to: "og-pi", rel: "streams-to" },
  ]),
  { from: "og-pi", to: "og-eh", rel: "streams-to" },
  { from: "og-app", to: "og-eh", rel: "depends-on" },
];

const OIL = 70;
const TARIFF = 4;
const platform = (siteId: string, bpd: number, pob: number, effect: string): SiteImpact => ({
  siteId,
  name: OG_SITES[siteId]!,
  a: bpd,
  b: pob,
  costPerHour: (bpd / 24) * OIL,
  effect,
});

const OG: Estate = {
  id: "og",
  brand: "OneRig",
  assets: new Map(OG_ASSETS.map((a) => [a.id, a])),
  edges: OG_EDGES,
  siteName: (id) => OG_SITES[id] ?? id,
  shortSite: (n) => n.replace("Platform ", "").replace(" Compressor Station", ""),
  impact: {
    "plt-t1": platform("plt-t1", 110_000, 176, "Compressor trains and separators: shut in, or run on local control"),
    "plt-d7": platform("plt-d7", 92_000, 148, "Process control and gas compression: shut in, or run on local control"),
    "plt-m4": platform("plt-m4", 61_000, 96, "Process control and gas compression: shut in, or run on local control"),
    "pl-eagle7": { siteId: "pl-eagle7", name: OG_SITES["pl-eagle7"]!, a: 540_000, b: 0, costPerHour: (540_000 / 24) * TARIFF, effect: "Remote control of the Eagle-7 compressors and line pack" },
  },
  metrics: {
    a: { label: "Barrels per day", fmt: (n) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString("en-US")}K bbl/d` : `${n} bbl/d`) },
    b: { label: "People on board", fmt: (n) => `${n} POB` },
  },
  assumptions: `$${OIL} per barrel of deferred production and a $${TARIFF}/bbl pipeline tariff`,
  jewels: [
    { id: "og-ad", role: "Active Directory domain controller", why: "Identity for historians, workstations and SCADA servers. Usually the first target in ransomware attacks." },
    { id: "og-fw", role: "IT/OT firewall", why: "The boundary between corporate IT and the remote operations network." },
    { id: "og-vsat", role: "Satellite and microwave hub", why: "The only link from shore to every platform." },
    { id: "og-scada", role: "SCADA server, Remote Operations Center", why: "Supervises all platforms and controls the Eagle-7 compressor station." },
    { id: "ews-t1", role: "Engineering workstation, Titan-1", why: "Can reprogram both the process control system and the safety system." },
    { id: "pie-t1", role: "PI historian, Titan-1", why: "Sits between platform control and IT. A common pivot from IT into OT." },
    { id: "dcs-t1", role: "Process control system, Titan-1", why: "Runs the compressor trains and separators on the largest platform." },
    { id: "dcs-d7", role: "Process control system, Delta-7", why: "Runs process control and gas compression on Delta-7." },
    { id: "rtu-e7", role: "RTU, Eagle-7 Compressor Station", why: "Controls the compressors that move 540K barrels a day." },
    { id: "og-pi", role: "PI historian, central", why: "System of record for operations data; feeds analytics, planning and OneRig." },
  ],
  identityId: "og-ad",
  pivotFrom: new Set(["pie-t1", "pie-d7", "pie-m4", "og-hmi"]),
  analyticsIds: ["og-eh", "og-pi", "og-app"],
  tabletop: {
    title: "Suspected historian tampering on Titan-1",
    site: "Platform Titan-1",
    jewelId: "pie-t1",
    steps: [
      step("02:14", "Configuration change outside the change window", "The process control system on Titan-1 (dcs-titan1) accepts a configuration push from the platform historian. No change ticket exists.", "info"),
      step("02:31", "14 sensors flatline in the same second", "Compressor discharge pressure, vibration and separator levels on trains A and B stop changing at once. The control room HMI keeps updating.", "warn"),
      weighs("OneRig"),
      step("02:34", "Recommended actions wait for operator approval", "OneRig recommends preserving evidence, checking values on local panels, confirming the safety system is healthy and opening a SOC investigation. Isolating any OT link is an operations decision.", "action", true),
      step("02:41", "SOC corroborates; the OIM declares Sev 1", "The SOC finds an unknown outbound connection from the platform historian over the satellite link. The offshore installation manager (OIM), as incident commander, declares a Sev 1 cyber incident.", "critical"),
      handoff("OneRig"),
    ],
    hypotheses: [
      { name: "Tampering or replayed data", confidence: "High", evidenceFor: ["Configuration change at 02:14 with no ticket", "Values repeat the 01:31–01:32 window exactly", "HMI and historian disagree"], evidenceAgainst: ["No malware alert yet"] },
      { name: "Historian or interface failure", confidence: "Medium", evidenceFor: ["Would freeze many tags at once"], evidenceAgainst: ["Doesn't explain the configuration change or the repeated values"] },
      { name: "Satellite link degradation", confidence: "Low", evidenceFor: ["Would freeze tags from both trains"], evidenceAgainst: ["HMI still updating; link healthy on both paths"] },
      { name: "Instrument failure", confidence: "Very low", evidenceFor: [], evidenceAgainst: ["14 tags across 2 compressor trains in the same second"] },
    ],
    actions: [
      PRESERVE,
      VERIFY,
      { id: "sis", label: "Confirm the safety system is healthy and independent", note: "The SIS must still be able to shut the process down safely.", recommended: true },
      SOC,
      { id: "isolate", label: "Isolate the historian's link to the process control system", note: "Operations decision: the platform runs on local control and loses remote history.", recommended: false },
    ],
    openQuestions: [
      "Is the replay limited to the historian, or are control commands affected?",
      "How did the configuration push reach the process control system?",
      "Are historians on other platforms affected?",
    ],
    observed: "Configuration change with no ticket (02:14), 14 tags frozen while the HMI updates (02:31), unknown outbound connection from the historian over the satellite link (02:41)",
    observedLog: [
      "02:14 configuration change on the Titan-1 process control system, no change ticket",
      "02:31 14 tags frozen across compressor trains A and B; HMI still updating",
      "02:41 SOC: unknown outbound connection from the platform historian over the satellite link",
    ],
    place: "Titan-1",
    noun: "platform",
    approver: "Control room supervisor, Titan-1",
    incidentCommander: "Offshore installation manager, Titan-1",
    atRisk: (r) => `${Math.round(r.a / 1000)}K bbl/d and ${r.b} people on board`,
  },
};

export function getEstate(solution: "energy" | "og"): Estate {
  return solution === "og" ? OG : ENERGY;
}

// ── Blast radius ─────────────────────────────────────────────────────────────
const FORWARD: Rel[] = ["hosts", "connects-to", "controls", "protects", "monitors", "replicates-to", "backs-up"];
const REVERSE: Rel[] = ["depends-on", "runs-on"];

export type Reach = "control" | "data";

export interface BlastRadius {
  jewel: CrownJewel;
  asset: EstateAsset;
  /** Every asset reached and how: lost control, or untrustworthy data. */
  reached: { asset: EstateAsset; reach: Reach; depth: number }[];
  sites: SiteImpact[];
  a: number;
  b: number;
  costPerHour: number;
  /** Operator analytics (historian, Eventhouse, app) affected even if control is not. */
  analyticsBlind: boolean;
}

export function blastRadius(estate: Estate, jewel: CrownJewel): BlastRadius {
  const start = estate.assets.get(jewel.id)!;
  const seen = new Map<string, { reach: Reach; depth: number }>([[start.id, { reach: "control", depth: 0 }]]);
  const queue: string[] = [start.id];
  if (start.id === estate.identityId) {
    for (const a of estate.assets.values())
      if (a.id !== start.id && a.domainJoined) {
        seen.set(a.id, { reach: "control", depth: 1 });
        queue.push(a.id);
      }
  }
  const visit = (id: string, reach: Reach, depth: number) => {
    const cur = seen.get(id);
    // Control beats data; keep the stronger effect.
    if (cur && (cur.reach === "control" || reach === "data")) return;
    seen.set(id, { reach, depth });
    queue.push(id);
  };
  while (queue.length) {
    const id = queue.shift()!;
    const { reach, depth } = seen.get(id)!;
    for (const e of estate.edges) {
      if (e.from === id) {
        if (FORWARD.includes(e.rel)) visit(e.to, reach, depth + 1);
        else if (e.rel === "streams-to") visit(e.to, "data", depth + 1);
        else if (e.rel === "depends-on" && estate.pivotFrom.has(id)) visit(e.to, reach, depth + 1);
      }
      if (e.to === id && REVERSE.includes(e.rel)) visit(e.from, reach, depth + 1);
    }
  }
  const reached = [...seen.entries()]
    .filter(([id]) => estate.assets.has(id))
    .map(([id, v]) => ({ asset: estate.assets.get(id)!, ...v }));
  const siteIds = new Set(reached.filter((r) => r.reach === "control" && r.asset.ot).map((r) => r.asset.siteId));
  const sites = [...siteIds].map((s) => estate.impact[s]).filter((s): s is SiteImpact => !!s);
  return {
    jewel,
    asset: start,
    reached: reached.sort((a, b) => a.depth - b.depth),
    sites,
    a: sites.reduce((t, s) => t + s.a, 0),
    b: sites.reduce((t, s) => t + s.b, 0),
    costPerHour: sites.reduce((t, s) => t + s.costPerHour, 0),
    analyticsBlind: reached.some((r) => estate.analyticsIds.includes(r.asset.id)),
  };
}

// ── Readiness checklist ──────────────────────────────────────────────────────
export interface ReadinessItem {
  id: string;
  label: string;
  detail: string;
  /** Demo default. */
  done: boolean;
  /** Derived from the retainer record instead of toggled. */
  retainer?: boolean;
}

export const READINESS: ReadinessItem[] = [
  { id: "plan", label: "Incident response plan covers OT", detail: "IT and OT runbooks, and who decides to isolate plant, platform and substation networks.", done: true },
  { id: "tabletop", label: "Tabletop exercise in the last 12 months", detail: "Executives, operations and IT rehearse a cyber incident together.", done: false },
  { id: "backups", label: "Offline backups of AD, historian and SCADA, restore tested", detail: "Immutable or offline copies, with a timed restore test.", done: true },
  { id: "segment", label: "OT segmented from IT", detail: "Zones and conduits (IEC 62443); no direct IT-to-PLC paths.", done: true },
  { id: "monitor", label: "OT security monitoring", detail: "For example Microsoft Defender for IoT feeding Microsoft Sentinel.", done: false },
  { id: "pam", label: "Privileged access protected", detail: "MFA and privileged access workstations for OT administrators.", done: true },
  { id: "soc", label: "24/7 security operations coverage", detail: "Someone watching alerts nights and weekends.", done: true },
  { id: "oob", label: "Out-of-band communications plan", detail: "How leaders, operators and responders talk if email and Teams are down.", done: false },
  { id: "retainer", label: "Incident response retainer with a documented engagement path", detail: "Set from the retainer record below.", done: false, retainer: true },
];

// ── Incident response retainer record ────────────────────────────────────────
export type RetainerStatus = "active" | "proposal" | "expired" | "none";

export interface RetainerRecord {
  status: RetainerStatus;
  provider: string;
  termStart: string;
  termEnd: string;
  csam: string;
  /** The customer's own documented steps for engaging incident response. */
  engagementSteps: string;
  incidentCommander: string;
  lastExercise: string;
  lastVerified: string;
  source: "Customer-reported" | "Verified with Microsoft Services";
}

export const RETAINER_STATUS_LABEL: Record<RetainerStatus, string> = {
  active: "Active",
  proposal: "Proposal in progress",
  expired: "Expired",
  none: "Not in place",
};

export function retainerPresets(estate: Estate): Record<"none" | "active", RetainerRecord> {
  const ic = estate.tabletop.incidentCommander;
  return {
    none: {
      status: "none",
      provider: "",
      termStart: "",
      termEnd: "",
      csam: "",
      engagementSteps: "",
      incidentCommander: ic,
      lastExercise: "",
      lastVerified: "2026-11-11",
      source: "Customer-reported",
    },
    active: {
      status: "active",
      provider: "Microsoft Cybersecurity Incident Response (CIR)",
      termStart: "2026-07-01",
      termEnd: "2027-06-30",
      csam: "Assigned CSAM (name and contact in the agreement)",
      engagementSteps: `1. The incident commander, or a delegate named in the IR plan, engages Microsoft Incident Response using the contact process in our CIR agreement.\n2. Reference the retainer and share this handoff package.\n3. Notify our CSAM to coordinate.\n4. Brief executives on the ${estate.id === "og" ? "platform" : "plant"} operating decision.`,
      incidentCommander: ic,
      lastExercise: "2026-03-18",
      lastVerified: "2026-10-02",
      source: "Customer-reported",
    },
  };
}

const daysBetween = (a: string, b: Date) => (b.getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000;

/** Readiness gaps the record reveals, most important first. */
export function retainerGaps(r: RetainerRecord, today = new Date()): string[] {
  const gaps: string[] = [];
  if (r.status !== "active") gaps.push("No active incident response retainer: outside help would be arranged during the incident.");
  if (!r.engagementSteps.trim()) gaps.push("No documented path for engaging outside incident responders.");
  if (r.status === "active" && r.termEnd && daysBetween(r.termEnd, today) > -90)
    gaps.push(`Retainer term ends ${r.termEnd}: plan the renewal.`);
  if (!r.lastExercise || daysBetween(r.lastExercise, today) > 365) gaps.push("No tabletop exercise in the last 12 months.");
  if (r.lastVerified && daysBetween(r.lastVerified, today) > 180) gaps.push("Retainer details not verified in the last 6 months.");
  return gaps;
}

/** Quoted from the Microsoft Cybersecurity Incident Response datasheet. */
export const CIR_DATASHEET_URL =
  "https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/unisp/documents/presentations/Cybersecurity%20Incident%20Response%20Datasheet.pdf";
export const CIR_DATASHEET: string[] = [
  "“Enhanced two-hour response in the event of a security incident (if purchasing Cybersecurity Incident Response proactively as a retainer).”",
  "“Assigned Incident Response Coordinator: a Microsoft incident response expert to guide your engagement during an active security incident.”",
  "“Assigned Customer Success Account Manager (CSAM): your point of contact to schedule proactive services.”",
  "Proactive compromise assessments and threat briefings tailored to your industry.",
];
