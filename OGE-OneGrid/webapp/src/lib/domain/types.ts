import type { FeatureCollection } from "geojson";

// Core domain model for the Oil & Gas Weather & Asset Risk platform.
// Deliberately provider-agnostic: mock providers and future Azure providers
// (Planetary Computer Pro, Aurora/ECMWF, AI Foundry) implement the same shapes.

export type AssetType =
  "offshore_platform" | "pipeline" | "well" | "refinery" | "lng_terminal" | "storage" | "port";

export type RiskLevel = "normal" | "monitor" | "elevated" | "high" | "critical";

export type OperatingStatus = "producing" | "reduced" | "shut_in" | "evacuating" | "standby";

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  lat: number;
  lon: number;
  /** Optional line geometry for pipelines / corridors. */
  geometry?: Array<[number, number]>;
  operator: string;
  region: string;
  businessUnit: string;
  status: OperatingStatus;
  criticality: "standard" | "important" | "business_critical";
  metadata: Record<string, string | number>;
}

export interface ForecastPoint {
  /** Hours from the current analysis time. */
  hour: number;
  lat: number;
  lon: number;
  /** Sustained wind, mph. */
  windMph: number;
  /** Radius of the uncertainty cone, in miles. */
  coneRadiusMi: number;
  category: number;
  pressureMb: number;
}

export interface WeatherEvent {
  id: string;
  name: string;
  kind: "hurricane" | "tropical_storm" | "severe_convective" | "flood";
  status: string;
  basin: string;
  currentCategory: number;
  currentWindMph: number;
  gustMph: number;
  pressureMb: number;
  movementDeg: number;
  movementMph: number;
  lat: number;
  lon: number;
  confidence: "low" | "moderate" | "high";
  modelSource: string;
  updatedAtIso: string;
  expectedLandfall: string;
  /** Forecast cycle label, e.g. "18Z Tue". */
  cycleId?: string;
  /** Perturbed ensemble members conveying track spread. */
  ensemble?: EnsembleMember[];
  /** The previous cycle's centerline, for cycle-over-cycle comparison. */
  previousForecast?: ForecastPoint[];
  cycleShift?: CycleShift;
  history: Array<[number, number]>;
  forecast: ForecastPoint[];
}

export interface RiskFactor {
  label: string;
  detail: string;
  points: number;
}

export interface AssetRisk {
  assetId: string;
  score: number;
  level: RiskLevel;
  eventId: string | null;
  distanceMi: number;
  forecastWindMph: number;
  rainfallIn: number;
  hoursToImpact: number | null;
  /** First forecast hour storm-force (>=39 mph) winds reach the asset. */
  tsWindEtaH: number | null;
  /** First forecast hour hurricane-force (>=74 mph) winds reach the asset. */
  hurWindEtaH: number | null;
  /** Actionable lead time (hours) before storm-force winds make ops unsafe. */
  evacWindowH: number | null;
  insideCone: boolean;
  factors: RiskFactor[];
  recommendations: string[];
}

export type AlertSeverity = "info" | "advisory" | "warning" | "critical";

export interface OpsAlert {
  id: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  assetId?: string;
  eventId?: string;
  status: "open" | "acknowledged" | "resolved";
  owner: string;
  createdAtIso: string;
}

export interface CopilotCitation {
  label: string;
  kind: "asset" | "event" | "risk" | "alert" | "dataset";
  refId?: string;
}

export interface CopilotAnswer {
  text: string;
  citations: CopilotCitation[];
  /** Assets the map should highlight for this answer. */
  highlightAssetIds: string[];
}

export interface GeospatialLayer {
  id: string;
  name: string;
  /** Operator-facing description — never STAC/Azure jargon. */
  description: string;
  updatedLabel: string;
  defaultOn: boolean;
  itemCount?: number;
  data?: FeatureCollection;
}

// ---------------------------------------------------------------------------
// Response posture — the decision state of the estate, not just the hazard.
// ---------------------------------------------------------------------------

/** Lead-time decision gates, expressed as hours before forecast onset. */
export type GateId = "T-120" | "T-96" | "T-72" | "T-48" | "T-24";

export type GateState = "not_started" | "in_progress" | "complete" | "not_required";

export interface PostureGate {
  id: GateId;
  leadHours: number;
  label: string;
  description: string;
}

export type PostureLevel = 0 | 1 | 2 | 3 | 4;

export interface AssetPosture {
  assetId: string;
  /** 0 normal · 1 watch · 2 prepare · 3 down-man · 4 evacuate & shut in */
  level: PostureLevel;
  gates: Record<GateId, GateState>;
  productionStatus: OperatingStatus;
  /** Personnel on board — manned facilities only. */
  pobCurrent: number | null;
  pobNormal: number | null;
  decisionOwner: string;
  /** Hours remaining until the next gate must be decided. */
  nextGate: GateId | null;
  nextGateDueHours: number | null;
  lastDecision: { action: string; by: string; atIso: string } | null;
}

// ---------------------------------------------------------------------------
// Configurable operational thresholds
// ---------------------------------------------------------------------------

export type ThresholdMetric = "wind" | "rain" | "eta" | "score" | "distance";
export type ThresholdComparator = "gte" | "lte";

export interface ThresholdRule {
  id: string;
  name: string;
  assetTypes: AssetType[];
  metric: ThresholdMetric;
  comparator: ThresholdComparator;
  value: number;
  /** Rule only applies to assets already scoring at or above this exposure. */
  appliesAboveScore: number;
  severity: AlertSeverity;
  action: string;
  owner: string;
  enabled: boolean;
  builtIn: boolean;
}

export interface ThresholdBreach {
  ruleId: string;
  ruleName: string;
  assetId: string;
  metric: ThresholdMetric;
  observed: number;
  threshold: number;
  comparator: ThresholdComparator;
  severity: AlertSeverity;
  action: string;
  owner: string;
  hoursToImpact: number | null;
}

// ---------------------------------------------------------------------------
// Forecast uncertainty and cycle-over-cycle change
// ---------------------------------------------------------------------------

export interface EnsembleMember {
  id: string;
  label: string;
  /** [lon, lat] positions, analysis time through the horizon. */
  track: Array<[number, number]>;
}

export interface CycleShift {
  currentCycle: string;
  previousCycle: string;
  /** Along-track displacement of the 48 h position, miles. */
  shiftMi: number;
  shiftBearingDeg: number;
  shiftDirection: string;
  /** Change in peak forecast intensity, mph. */
  intensityDeltaMph: number;
  /** Change in 72 h cone radius, miles. */
  coneDeltaMi: number;
  summary: string;
}
