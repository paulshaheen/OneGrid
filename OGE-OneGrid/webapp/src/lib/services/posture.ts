// Response-posture engine. Converts hazard exposure into the decision state an
// incident management team actually tracks: lead-time gates, production status,
// personnel on board and who owns the next decision.

import type {
  Asset,
  AssetPosture,
  AssetRisk,
  GateId,
  GateState,
  OperatingStatus,
  PostureGate,
  PostureLevel,
} from "@/lib/domain/types";

export const POSTURE_GATES: PostureGate[] = [
  {
    id: "T-120",
    leadHours: 120,
    label: "Watch declared",
    description: "Incident management team stood up; forecast cycle reviewed twice daily.",
  },
  {
    id: "T-96",
    leadHours: 96,
    label: "Secure & logistics plan",
    description:
      "Loose equipment secured, marine and aviation capacity reserved, supply runs re-sequenced.",
  },
  {
    id: "T-72",
    leadHours: 72,
    label: "Non-essential down-man",
    description:
      "Non-essential personnel flown to shore; drilling and construction activity suspended.",
  },
  {
    id: "T-48",
    leadHours: 48,
    label: "Shut-in sequence",
    description: "Production ramped down, wells shut in, subsea isolation confirmed.",
  },
  {
    id: "T-24",
    leadHours: 24,
    label: "Full evacuation complete",
    description: "Facility unmanned, helideck closed, remote monitoring confirmed.",
  },
];

export const POSTURE_LEVEL_LABEL: Record<PostureLevel, string> = {
  0: "Normal operations",
  1: "Watch",
  2: "Prepare",
  3: "Down-man",
  4: "Evacuate & shut in",
};

const GATE_STATE_LABEL: Record<GateState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  not_required: "Not required",
};

export function gateStateLabel(state: GateState): string {
  return GATE_STATE_LABEL[state];
}

/** Facilities that carry people and therefore run the full gate sequence. */
const MANNED = new Set(["offshore_platform", "port", "refinery", "lng_terminal"]);

const NORMAL_POB: Record<string, number> = {
  offshore_platform: 128,
  refinery: 410,
  lng_terminal: 240,
  port: 180,
};

const OWNER: Record<string, string> = {
  offshore_platform: "GoM Offshore Installation Manager",
  pipeline: "Midstream Integrity Duty Lead",
  well: "Subsea Operations Supervisor",
  refinery: "Refinery Shift Superintendent",
  lng_terminal: "LNG Terminal Duty Manager",
  storage: "Terminals Operations Lead",
  port: "Logistics Control",
};

/** Gate state purely from lead time: a gate is worked in the 12 h before its T-mark. */
function gateFromEta(eta: number | null, leadHours: number): GateState {
  if (eta === null) return "not_started";
  if (eta > leadHours) return "not_started";
  if (eta > leadHours - 12) return "in_progress";
  return "complete";
}

function levelFor(risk: AssetRisk | undefined): PostureLevel {
  if (!risk) return 0;
  const eta = risk.hoursToImpact ?? 999;
  if (risk.level === "critical" && eta <= 48) return 4;
  if (risk.score >= 70 || (risk.level === "critical" && eta <= 96)) return 3;
  if (risk.score >= 50) return 2;
  if (risk.score >= 30 || risk.insideCone) return 1;
  return 0;
}

function statusFor(asset: Asset, level: PostureLevel, eta: number | null): OperatingStatus {
  if (level >= 4) return asset.type === "offshore_platform" ? "evacuating" : "shut_in";
  if (level === 3) return "shut_in";
  if (level === 2) return "reduced";
  if (level === 1) return eta !== null && eta <= 96 ? "producing" : "standby";
  return asset.status;
}

export function derivePosture(asset: Asset, risk: AssetRisk | undefined): AssetPosture {
  const eta = risk?.hoursToImpact ?? null;
  const level = levelFor(risk);
  const exposed = (risk?.score ?? 0) >= 30;
  const manned = MANNED.has(asset.type);

  const gates = {} as Record<GateId, GateState>;
  for (const g of POSTURE_GATES) {
    if (!exposed) {
      gates[g.id] = "not_required";
      continue;
    }
    // Unmanned assets skip personnel gates but still run the shut-in sequence.
    if (!manned && (g.id === "T-72" || g.id === "T-24")) {
      gates[g.id] = "not_required";
      continue;
    }
    gates[g.id] = gateFromEta(eta, g.leadHours);
  }

  const next = POSTURE_GATES.find(
    (g) => gates[g.id] === "not_started" || gates[g.id] === "in_progress",
  );
  const normalPob = manned ? (NORMAL_POB[asset.type] ?? 90) : null;
  const reduction = level >= 4 ? 0 : level === 3 ? 0.32 : level === 2 ? 0.68 : 1;
  const pob = normalPob === null ? null : Math.round(normalPob * reduction);

  const decision =
    level >= 3
      ? {
          action:
            level >= 4 ? "Full evacuation authorised" : "Non-essential down-manning authorised",
          by: OWNER[asset.type] ?? "Operations Duty Manager",
          atIso: new Date(Date.now() - (level >= 4 ? 42 : 96) * 60 * 1000).toISOString(),
        }
      : level === 2
        ? {
            action: "Pre-storm secure checklist issued",
            by: OWNER[asset.type] ?? "Operations Duty Manager",
            atIso: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          }
        : null;

  return {
    assetId: asset.id,
    level,
    gates,
    productionStatus: statusFor(asset, level, eta),
    pobCurrent: pob,
    pobNormal: normalPob,
    decisionOwner: OWNER[asset.type] ?? "Operations Duty Manager",
    nextGate: next?.id ?? null,
    nextGateDueHours: next && eta !== null ? Math.max(0, Math.round(eta - next.leadHours)) : null,
    lastDecision: decision,
  };
}
