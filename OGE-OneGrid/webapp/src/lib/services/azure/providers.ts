// Azure-backed providers. These implement the same interfaces as the mock
// providers, so no UI code changes. Real data comes from the tenant's Azure
// resources via the server functions in ./server; anything the customer has not
// ingested yet returns an honest empty result — never the synthetic sample estate.

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
import { DEFAULT_RULES } from "@/lib/services/thresholds";
import type {
  AlertService,
  AssetService,
  CopilotService,
  PlanetaryComputerService,
  PostureService,
  RiskEngineService,
  ThresholdService,
  WeatherService,
} from "@/lib/services/interfaces";
import { derivePosture } from "@/lib/services/posture";
import { scoreAsset } from "@/lib/services/risk-engine";
import {
  askFoundryCopilot,
  listAuroraWeatherEvents,
  listStacLayers,
  listUploadedAssets,
  loadAlertStatuses,
  loadPostureOverrides,
  loadThresholdRules,
  saveAlertStatuses,
  savePostureOverrides,
  saveThresholdRules,
  type AlertStatusMap,
  type PostureOverrides,
} from "@/lib/services/azure/server";

/** Geospatial layers from the tenant's GeoCatalog STAC collections. */
export class AzurePlanetaryComputerService implements PlanetaryComputerService {
  listLayers(): Promise<GeospatialLayer[]> {
    return listStacLayers();
  }
}

/** Grounded assistant backed by Azure OpenAI (Foundry) via managed identity. */
export class AzureCopilotService implements CopilotService {
  suggestions(): string[] {
    return [
      "Which assets are most at risk over the next 72 hours?",
      "Summarize current exposure for leadership.",
      "What changed since the previous forecast cycle?",
    ];
  }
  ask(question: string): Promise<CopilotAnswer> {
    return askFoundryCopilot({ data: { question } });
  }
}

/**
 * Tenant assets. Bind this to your asset master (STAC items / Blob / Fabric).
 * Until the customer ingests their estate this is empty by design.
 */
export class AzureAssetService implements AssetService {
  async listAssets(): Promise<Asset[]> {
    return listUploadedAssets();
  }
  async getAsset(id: string): Promise<Asset | null> {
    const all = await listUploadedAssets();
    return all.find((a) => a.id === id) ?? null;
  }
}

/** Forecasts normalized by the Aurora post-processing job and persisted in Blob Storage. */
export class AzureWeatherService implements WeatherService {
  readonly providerLabel = "Aurora / ECMWF (Planetary Computer Pro)";
  listEvents(): Promise<WeatherEvent[]> {
    return listAuroraWeatherEvents();
  }
  async getEvent(id: string): Promise<WeatherEvent | null> {
    const events = await listAuroraWeatherEvents();
    return events.find((event) => event.id === id) ?? null;
  }
}

function highestRiskFor(
  asset: Asset,
  events: WeatherEvent[],
  horizonHours: number,
): AssetRisk | null {
  if (events.length === 0) return null;
  return events
    .map((event) => scoreAsset(asset, event, horizonHours))
    .reduce((highest, risk) => (risk.score > highest.score ? risk : highest));
}

/** Risk is computed from the tenant's real assets and forecasts; no assets → no risks. */
export class AzureRiskEngineService implements RiskEngineService {
  async scoreEstate(horizonHours = 120): Promise<AssetRisk[]> {
    const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
    return assets.flatMap((asset) => {
      const risk = highestRiskFor(asset, events, horizonHours);
      return risk ? [risk] : [];
    });
  }
  async scoreOne(assetId: string, horizonHours = 120): Promise<AssetRisk | null> {
    const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
    const asset = assets.find((candidate) => candidate.id === assetId);
    return asset ? highestRiskFor(asset, events, horizonHours) : null;
  }
}

/**
 * Alerts are derived from live threshold breaches in the view; this service owns
 * their acknowledgement/resolution state, persisted as a map keyed by stable
 * alert id so operator actions survive restarts and are shared across workers.
 */
export class AzureAlertService implements AlertService {
  async listAlerts(): Promise<OpsAlert[]> {
    return [];
  }
  async listStatusOverrides(): Promise<AlertStatusMap> {
    return loadAlertStatuses();
  }
  async setStatus(id: string, status: OpsAlert["status"]): Promise<OpsAlert[]> {
    const current = await loadAlertStatuses();
    const next: AlertStatusMap = { ...current, [id]: status };
    const result = await saveAlertStatuses({ data: { statuses: next } });
    if (!result.ok) throw new Error(result.message);
    return [];
  }
}

/** Response posture derives from real exposure, with durable operator overrides. */
export class AzurePostureService implements PostureService {
  private async build(overrides: PostureOverrides): Promise<AssetPosture[]> {
    const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
    return assets.map((asset) => {
      const base = derivePosture(asset, highestRiskFor(asset, events, 120) ?? undefined);
      return {
        ...base,
        gates: { ...base.gates, ...(overrides.gates[asset.id] ?? {}) },
        productionStatus: overrides.status[asset.id] ?? base.productionStatus,
      };
    });
  }

  private async mutate(
    apply: (overrides: PostureOverrides) => PostureOverrides,
  ): Promise<AssetPosture[]> {
    const next = apply(await loadPostureOverrides());
    const result = await savePostureOverrides({ data: { overrides: next } });
    if (!result.ok) throw new Error(result.message);
    return this.build(next);
  }

  async listPostures(): Promise<AssetPosture[]> {
    return this.build(await loadPostureOverrides());
  }
  async setGate(assetId: string, gate: GateId, state: GateState): Promise<AssetPosture[]> {
    return this.mutate((o) => ({
      gates: { ...o.gates, [assetId]: { ...(o.gates[assetId] ?? {}), [gate]: state } },
      status: o.status,
    }));
  }
  async setProductionStatus(assetId: string, status: OperatingStatus): Promise<AssetPosture[]> {
    return this.mutate((o) => ({
      gates: o.gates,
      status: { ...o.status, [assetId]: status },
    }));
  }
  async resetOverrides(): Promise<AssetPosture[]> {
    return this.mutate(() => ({ gates: {}, status: {} }));
  }
}

/**
 * Threshold rules are operator configuration (not sample weather data). A fresh
 * deployment starts from the built-in starter defaults; operator edits are
 * persisted as a JSON blob in the deployment's storage container (see
 * loadThresholdRules / saveThresholdRules) so tuned limits survive restarts.
 * When storage is unwired (local dev) edits stay in memory for the session.
 */
export class AzureThresholdService implements ThresholdService {
  private rules: ThresholdRule[] | null = null;

  /** Load persisted rules once; fall back to built-in starter defaults. */
  private async ensure(): Promise<ThresholdRule[]> {
    if (this.rules) return this.rules;
    const stored = await loadThresholdRules();
    this.rules = stored && stored.length > 0 ? stored : DEFAULT_RULES.map((r) => ({ ...r }));
    return this.rules;
  }

  private async persist(rules: ThresholdRule[]): Promise<ThresholdRule[]> {
    const result = await saveThresholdRules({ data: { rules } });
    if (!result.ok) throw new Error(result.message);
    this.rules = rules;
    return rules;
  }

  async listRules(): Promise<ThresholdRule[]> {
    return this.ensure();
  }
  async saveRule(rule: ThresholdRule): Promise<ThresholdRule[]> {
    const rules = [...(await this.ensure())];
    const i = rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) rules[i] = rule;
    else rules.push(rule);
    return this.persist(rules);
  }
  async deleteRule(id: string): Promise<ThresholdRule[]> {
    const rules = (await this.ensure()).filter((r) => r.id !== id);
    return this.persist(rules);
  }
  async resetRules(): Promise<ThresholdRule[]> {
    return this.persist(DEFAULT_RULES.map((r) => ({ ...r })));
  }
}
