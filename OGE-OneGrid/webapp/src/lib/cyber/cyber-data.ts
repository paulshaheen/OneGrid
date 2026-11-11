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
  { id: "retainer", label: "Incident response retainer in place", detail: "For example the Microsoft Cybersecurity Incident Response retainer (CIR), with prioritized access to Microsoft Incident Response (DART).", done: false, retainer: true },
];

// ── Tabletop: historian tampering at Bayou Generating Plant ─────────────────
export interface TabletopStep {
  t: string;
  title: string;
  body: string;
  /** Infra asset ids to highlight on the path diagram. */
  highlight: string[];
  tone: "info" | "warn" | "critical" | "action";
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
    body: "Steam pressure, turbine vibration and bearing temperatures on GT1 and unit 2 stop changing at once. The control room HMI still looks normal.",
    highlight: ["sensor-plant-steam", "plc-plant-1", "plc-plant-2"],
    tone: "warn",
  },
  {
    t: "02:32",
    title: "OneGrid: this is not an instrument failure",
    body: "One failed transducer flatlines one tag. Fourteen tags across two units in the same second, values that repeat an earlier hour, and the HMI and historian disagreeing point to replayed or tampered data.",
    highlight: ["historian-edge", "vm-historian", "eventhouse-eh"],
    tone: "critical",
  },
  {
    t: "02:34",
    title: "Agent recommends: isolate, preserve, escalate",
    body: "Switch operators to local panels, isolate the historian conduit, preserve logs and memory, and page the SOC. Do not reboot anything yet: that destroys evidence.",
    highlight: ["historian-edge", "fw-dc"],
    tone: "action",
  },
  {
    t: "02:41",
    title: "SOC confirms: Sev 1 cyber incident declared",
    body: "Unknown outbound connection from the plant historian. Leadership must decide on unit operation and bring in outside incident responders.",
    highlight: ["historian-edge", "scada-gw-plant", "plc-plant-1", "plc-plant-2", "rtu-plant"],
    tone: "critical",
  },
];

export const FAILURE_VS_TAMPER: { signal: string; failure: string; tamper: string }[] = [
  { signal: "How many sensors", failure: "One sensor or one instrument loop", tamper: "Many sensors across units at the same moment" },
  { signal: "What the value does", failure: "Drops to 0, or to a fixed fault value", tamper: "Freezes at a plausible value, or replays an earlier period" },
  { signal: "HMI vs historian", failure: "Agree (both show the fault)", tamper: "Disagree (the control room sees one thing, the historian another)" },
  { signal: "Configuration", failure: "No changes", tamper: "Changes outside the change window, no ticket" },
  { signal: "Network", failure: "Normal", tamper: "New or unusual connections from OT-facing servers" },
];
