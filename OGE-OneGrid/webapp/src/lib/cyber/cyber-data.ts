// Cyber readiness model for OneGrid: the critical ("crown jewel") IT/OT systems in the
// synthetic estate from infra-data, what a compromise of each would reach (blast
// radius over the dependency graph), the readiness checklist and the scripted
// "historian tampering" tabletop. Pure data and functions, safe for the client bundle.
import { ASSET_BY_ID, EDGES, type InfraAsset, type RelKind } from "@/lib/infra/infra-data";

// ── What each site carries ───────────────────────────────────────────────────
export interface SiteImpact {
  siteId: string;
  name: string;
  /** Customers served through the site's feeders. */
  customers: number;
  /** Load served (MW). */
  loadMw: number;
  /** Generation that would trip or need manual control (MW). */
  genMw: number;
  /** What goes dark for operators. */
  effect: string;
}

export const SITE_IMPACT: Record<string, SiteImpact> = {
  "sub-west": { siteId: "sub-west", name: "Westside Substation", customers: 18_400, loadMw: 62, genMw: 0, effect: "Remote control of feeders W-1 to W-4 and the recloser" },
  "sub-harbor": { siteId: "sub-harbor", name: "Harbor Substation", customers: 14_900, loadMw: 48, genMw: 0, effect: "Remote control and protection data for the Harbor feeders" },
  "plant-bayou": { siteId: "plant-bayou", name: "Bayou Generating Plant", customers: 0, loadMw: 0, genMw: 640, effect: "Turbine and balance-of-plant control (GT1, unit 2)" },
};

/** Illustrative cost assumptions, shown in the UI next to every dollar figure. */
export const COST_ASSUMPTIONS = {
  perCustomerHour: 9,
  replacementPowerPerMwh: 95,
};

export function costPerHour(i: { customers: number; genMw: number }): number {
  return i.customers * COST_ASSUMPTIONS.perCustomerHour + i.genMw * COST_ASSUMPTIONS.replacementPowerPerMwh;
}

// ── Crown jewels ─────────────────────────────────────────────────────────────
export interface CrownJewel {
  id: string;
  role: string;
  why: string;
}

export const CROWN_JEWELS: CrownJewel[] = [
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
];

// ── Blast radius ─────────────────────────────────────────────────────────────
/** How a compromise spreads along each relationship. */
const FORWARD: RelKind[] = ["hosts", "connects-to", "controls", "protects", "monitors", "replicates-to", "backs-up"];
const REVERSE: RelKind[] = ["depends-on", "runs-on"];
/** OT-facing servers that can reach the gateway they poll (the classic IT-to-OT pivot). */
const PIVOT_FROM = new Set(["historian-edge", "vm-scada-a"]);
/** Kinds joined to the domain, so a domain-controller compromise reaches them. */
const AD_JOINED = new Set(["vm", "vmhost", "sql-db", "historian"]);
const ON_PREM = new Set(["dc-hou", "sub-west", "sub-harbor", "plant-bayou"]);

export type Reach = "control" | "data";

export interface BlastRadius {
  jewel: CrownJewel;
  asset: InfraAsset;
  /** Every asset reached and how: lost control, or untrustworthy data. */
  reached: { asset: InfraAsset; reach: Reach; depth: number }[];
  sites: SiteImpact[];
  customers: number;
  loadMw: number;
  genMw: number;
  costPerHour: number;
  /** Operator analytics (OneGrid, historian) affected even if control is not. */
  analyticsBlind: boolean;
}

export function blastRadius(jewel: CrownJewel): BlastRadius {
  const start = ASSET_BY_ID.get(jewel.id)!;
  const seen = new Map<string, { reach: Reach; depth: number }>([[start.id, { reach: "control", depth: 0 }]]);
  const queue: string[] = [start.id];
  if (start.id === "vm-ad") {
    for (const a of ASSET_BY_ID.values())
      if (a.id !== start.id && ON_PREM.has(a.siteId) && AD_JOINED.has(a.kind)) {
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
    for (const e of EDGES) {
      if (e.from === id) {
        if (FORWARD.includes(e.rel)) visit(e.to, reach, depth + 1);
        else if (e.rel === "streams-to") visit(e.to, "data", depth + 1);
        else if (e.rel === "depends-on" && PIVOT_FROM.has(id)) visit(e.to, reach, depth + 1);
      }
      if (e.to === id && REVERSE.includes(e.rel)) visit(e.from, reach, depth + 1);
    }
  }
  const reached = [...seen.entries()].map(([id, v]) => ({ asset: ASSET_BY_ID.get(id)!, ...v }));
  const siteIds = new Set(
    reached.filter((r) => r.reach === "control" && r.asset.category === "ot").map((r) => r.asset.siteId),
  );
  const sites = [...siteIds].map((s) => SITE_IMPACT[s]).filter((s): s is SiteImpact => !!s);
  const totals = sites.reduce(
    (t, s) => ({ customers: t.customers + s.customers, loadMw: t.loadMw + s.loadMw, genMw: t.genMw + s.genMw }),
    { customers: 0, loadMw: 0, genMw: 0 },
  );
  return {
    jewel,
    asset: start,
    reached: reached.sort((a, b) => a.depth - b.depth),
    sites,
    ...totals,
    costPerHour: costPerHour(totals),
    analyticsBlind: reached.some((r) => ["eventhouse-eh", "vm-historian", "ca-onegrid"].includes(r.asset.id)),
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
  { id: "plan", label: "Incident response plan covers OT", detail: "IT and OT runbooks, and who decides to isolate plant and substation networks.", done: true },
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

export const RETAINER_PRESETS: Record<"none" | "active", RetainerRecord> = {
  none: {
    status: "none",
    provider: "",
    termStart: "",
    termEnd: "",
    csam: "",
    engagementSteps: "",
    incidentCommander: "Plant manager, Bayou Generating Plant",
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
    engagementSteps:
      "1. The incident commander, or a delegate named in the IR plan, engages Microsoft Incident Response using the contact process in our CIR agreement.\n2. Reference the retainer and share this handoff package.\n3. Notify our CSAM to coordinate.\n4. Brief executives on the plant operating decision.",
    incidentCommander: "Plant manager, Bayou Generating Plant",
    lastExercise: "2026-03-18",
    lastVerified: "2026-10-02",
    source: "Customer-reported",
  },
};

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

// ── Tabletop: historian tampering at Bayou Generating Plant ─────────────────
export interface TabletopStep {
  t: string;
  title: string;
  body: string;
  /** Infra asset ids to highlight on the path diagram. */
  highlight: string[];
  tone: "info" | "warn" | "critical" | "action";
  /** Playback stops here until an operator decides. */
  decision?: boolean;
}

export const TABLETOP_JEWEL = "historian-edge";

export const TABLETOP: TabletopStep[] = [
  {
    t: "02:14",
    title: "Configuration change outside the change window",
    body: "The SCADA gateway at Bayou (scada-gw-bayou) accepts a configuration push from the plant historian. No change ticket exists.",
    highlight: ["historian-edge", "scada-gw-plant"],
    tone: "info",
  },
  {
    t: "02:31",
    title: "14 sensors flatline in the same second",
    body: "Steam pressure, turbine vibration and bearing temperatures on GT1 and unit 2 stop changing at once. The control room HMI keeps updating.",
    highlight: ["sensor-plant-steam", "plc-plant-1", "plc-plant-2"],
    tone: "warn",
  },
  {
    t: "02:32",
    title: "OneGrid weighs the explanations",
    body: "OneGrid ranks the possible causes with the evidence for and against each, and flags the event for people to decide. It does not conclude on its own.",
    highlight: ["historian-edge", "vm-historian", "eventhouse-eh"],
    tone: "critical",
  },
  {
    t: "02:34",
    title: "Recommended actions wait for operator approval",
    body: "OneGrid recommends preserving evidence, checking values on local panels and opening a SOC investigation. Isolating any OT link is an operations decision.",
    highlight: ["historian-edge", "fw-dc"],
    tone: "action",
    decision: true,
  },
  {
    t: "02:41",
    title: "SOC corroborates; incident commander declares Sev 1",
    body: "The SOC finds an unknown outbound connection from the plant historian. The plant manager, as incident commander, declares a Sev 1 cyber incident.",
    highlight: ["historian-edge", "scada-gw-plant", "plc-plant-1", "plc-plant-2", "rtu-plant"],
    tone: "critical",
  },
  {
    t: "02:47",
    title: "Handoff package ready for outside responders",
    body: "OneGrid assembles the evidence, open questions, affected systems and modeled exposure for the incident commander to review and send through the documented engagement path.",
    highlight: ["historian-edge"],
    tone: "action",
  },
];

export interface Hypothesis {
  name: string;
  confidence: "High" | "Medium" | "Low" | "Very low";
  evidenceFor: string[];
  evidenceAgainst: string[];
}

export const HYPOTHESES: Hypothesis[] = [
  {
    name: "Tampering or replayed data",
    confidence: "High",
    evidenceFor: ["Configuration change at 02:14 with no ticket", "Values repeat the 01:31–01:32 window exactly", "HMI and historian disagree"],
    evidenceAgainst: ["No malware alert yet"],
  },
  {
    name: "Historian or interface failure",
    confidence: "Medium",
    evidenceFor: ["Would freeze many tags at once"],
    evidenceAgainst: ["Doesn't explain the configuration change or the repeated values"],
  },
  {
    name: "Network loss to the gateway",
    confidence: "Low",
    evidenceFor: ["Would freeze tags from both units"],
    evidenceAgainst: ["HMI still updating; plant network healthy"],
  },
  {
    name: "Instrument failure",
    confidence: "Very low",
    evidenceFor: [],
    evidenceAgainst: ["14 tags across 2 units in the same second"],
  },
];

export interface RecommendedAction {
  id: string;
  label: string;
  note: string;
  /** Pre-selected for approval. */
  recommended: boolean;
}

export const ACTIONS: RecommendedAction[] = [
  { id: "preserve", label: "Preserve historian logs and memory; don't reboot", note: "Rebooting destroys evidence responders need.", recommended: true },
  { id: "verify", label: "Check process values on local panels", note: "Operators trust local instruments, not the historian, until cleared.", recommended: true },
  { id: "soc", label: "Open a SOC investigation", note: "Security operations look for the attacker's access.", recommended: true },
  { id: "isolate", label: "Isolate the historian's link to the SCADA gateway", note: "Operations decision: the plant runs on local control and loses remote history.", recommended: false },
];