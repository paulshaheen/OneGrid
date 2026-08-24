// Configurable operational thresholds. Operators define the wind, rainfall and
// lead-time limits their procedures already use; breaches drive the alert feed
// rather than a fixed, hard-coded alert list.

import type {
  Asset,
  AssetRisk,
  ThresholdBreach,
  ThresholdMetric,
  ThresholdRule,
} from "@/lib/domain/types";

export const METRIC_LABEL: Record<ThresholdMetric, string> = {
  wind: "Forecast sustained wind",
  rain: "Forecast rainfall",
  eta: "Hours to impact",
  score: "Risk score",
  distance: "Distance to centerline",
};

export const METRIC_UNIT: Record<ThresholdMetric, string> = {
  wind: "mph",
  rain: "in",
  eta: "h",
  score: "pts",
  distance: "mi",
};

export const DEFAULT_RULES: ThresholdRule[] = [
  {
    id: "THR-CRANE",
    name: "Crane & lifting operations suspension",
    assetTypes: ["offshore_platform", "port"],
    metric: "wind",
    comparator: "gte",
    value: 40,
    appliesAboveScore: 25,
    severity: "advisory",
    action: "Suspend crane, lifting and over-side work; secure deck cargo.",
    owner: "Offshore Marine Assurance",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-HELI",
    name: "Helicopter transfer cut-off",
    assetTypes: ["offshore_platform", "port"],
    metric: "wind",
    comparator: "gte",
    value: 46,
    appliesAboveScore: 25,
    severity: "warning",
    action: "Close helideck to routine transfers; complete crew changes ahead of onset.",
    owner: "Aviation Duty Officer",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-DOWNMAN",
    name: "Down-man decision window",
    assetTypes: ["offshore_platform"],
    metric: "eta",
    comparator: "lte",
    value: 72,
    appliesAboveScore: 45,
    severity: "warning",
    action: "Convene down-manning decision; confirm aviation and marine capacity.",
    owner: "GoM Operations Duty Manager",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-SHUTIN",
    name: "Production shut-in trigger",
    assetTypes: ["offshore_platform", "well"],
    metric: "wind",
    comparator: "gte",
    value: 74,
    appliesAboveScore: 45,
    severity: "critical",
    action: "Execute shut-in sequence and confirm subsea isolation.",
    owner: "Production Operations Superintendent",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-ROW",
    name: "Pipeline right-of-way flooding",
    assetTypes: ["pipeline"],
    metric: "rain",
    comparator: "gte",
    value: 5,
    appliesAboveScore: 20,
    severity: "warning",
    action: "Inspect scour-prone crossings; review right-of-way access routes.",
    owner: "Midstream Integrity",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-SAFESHUT",
    name: "Refinery safe-shutdown lead time",
    assetTypes: ["refinery", "storage"],
    metric: "eta",
    comparator: "lte",
    value: 48,
    appliesAboveScore: 40,
    severity: "warning",
    action: "Start safe-shutdown sequence; verify drainage, berms and flare capacity.",
    owner: "Refinery Shift Superintendent",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-LNG",
    name: "LNG marine loading cut-off",
    assetTypes: ["lng_terminal"],
    metric: "wind",
    comparator: "gte",
    value: 39,
    appliesAboveScore: 25,
    severity: "warning",
    action: "Disconnect loading arms and clear vessels from the berth.",
    owner: "LNG Terminal Duty Manager",
    enabled: true,
    builtIn: true,
  },
  {
    id: "THR-SURGE",
    name: "Coastal flooding watch",
    assetTypes: ["port", "refinery", "lng_terminal", "storage"],
    metric: "rain",
    comparator: "gte",
    value: 8,
    appliesAboveScore: 30,
    severity: "critical",
    action: "Activate flood-preparedness plan and stage dewatering equipment.",
    owner: "Emergency Response Coordinator",
    enabled: true,
    builtIn: true,
  },
];

function observed(metric: ThresholdMetric, risk: AssetRisk): number | null {
  switch (metric) {
    case "wind":
      return risk.forecastWindMph;
    case "rain":
      return risk.rainfallIn;
    case "eta":
      return risk.hoursToImpact;
    case "score":
      return risk.score;
    case "distance":
      return risk.distanceMi;
  }
}

export function evaluateRules(
  rules: ThresholdRule[],
  assets: Asset[],
  risks: AssetRisk[],
): ThresholdBreach[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const out: ThresholdBreach[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const risk of risks) {
      const asset = assetById.get(risk.assetId);
      if (!asset || !rule.assetTypes.includes(asset.type)) continue;
      if (risk.score < rule.appliesAboveScore) continue;
      const value = observed(rule.metric, risk);
      if (value === null) continue;
      const breached = rule.comparator === "gte" ? value >= rule.value : value <= rule.value;
      if (!breached) continue;
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        assetId: risk.assetId,
        metric: rule.metric,
        observed: value,
        threshold: rule.value,
        comparator: rule.comparator,
        severity: rule.severity,
        action: rule.action,
        owner: rule.owner,
        hoursToImpact: risk.hoursToImpact,
      });
    }
  }

  const rank = { critical: 0, warning: 1, advisory: 2, info: 3 } as const;
  return out.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] || (a.hoursToImpact ?? 999) - (b.hoursToImpact ?? 999),
  );
}
