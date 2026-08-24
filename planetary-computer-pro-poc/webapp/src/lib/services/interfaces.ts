// Service interfaces. Mock providers ship by default; Azure-backed providers
// (Planetary Computer Pro, Aurora/ECMWF, AI Foundry, Fabric, Blob Storage)
// implement the same contracts so the UI never changes.

import type {
  Asset,
  AssetPosture,
  AssetRisk,
  CopilotAnswer,
  GateId,
  GateState,
  GeospatialLayer,
  OperatingStatus,
  OpsAlert,
  ThresholdRule,
  WeatherEvent,
} from "@/lib/domain/types";

export interface AssetService {
  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
}

export interface WeatherService {
  /** Provider label surfaced to operators in plain language. */
  readonly providerLabel: string;
  listEvents(): Promise<WeatherEvent[]>;
  getEvent(id: string): Promise<WeatherEvent | null>;
}

export interface RiskEngineService {
  scoreEstate(horizonHours?: number): Promise<AssetRisk[]>;
  scoreOne(assetId: string, horizonHours?: number): Promise<AssetRisk | null>;
}

export interface AlertService {
  listAlerts(): Promise<OpsAlert[]>;
  setStatus(id: string, status: OpsAlert["status"]): Promise<OpsAlert[]>;
  /** Persisted status overrides keyed by stable alert id, applied to derived alerts. */
  listStatusOverrides(): Promise<Record<string, OpsAlert["status"]>>;
}

/** Decision state of the estate: lead-time gates, shut-in and personnel status. */
export interface PostureService {
  listPostures(): Promise<AssetPosture[]>;
  setGate(assetId: string, gate: GateId, state: GateState): Promise<AssetPosture[]>;
  setProductionStatus(assetId: string, status: OperatingStatus): Promise<AssetPosture[]>;
  resetOverrides(): Promise<AssetPosture[]>;
}

/** Operator-configurable thresholds that drive the alert feed. */
export interface ThresholdService {
  listRules(): Promise<ThresholdRule[]>;
  saveRule(rule: ThresholdRule): Promise<ThresholdRule[]>;
  deleteRule(id: string): Promise<ThresholdRule[]>;
  resetRules(): Promise<ThresholdRule[]>;
}

export interface PlanetaryComputerService {
  /** Operator-facing geospatial layers; catalog mechanics stay hidden. */
  listLayers(): Promise<GeospatialLayer[]>;
}

export interface CopilotService {
  ask(question: string): Promise<CopilotAnswer>;
  suggestions(): string[];
}

export interface PlatformServices {
  assets: AssetService;
  weather: WeatherService;
  risk: RiskEngineService;
  alerts: AlertService;
  posture: PostureService;
  thresholds: ThresholdService;
  geospatial: PlanetaryComputerService;
  copilot: CopilotService;
}
