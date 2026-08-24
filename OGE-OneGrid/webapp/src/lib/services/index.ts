// Service registry. The single seam where the UI's data providers are chosen.
//
// This is the tenant product app: the console is served under /app/* and always
// binds the Azure-backed providers (real GeoCatalog / Foundry when configured;
// honest empty results until the customer ingests their estate). The marketing
// demo with the synthetic sample estate lives in a separate app and repo.

import type { OpsBase } from "@/components/ops/ops-nav";
import type { PlatformServices } from "@/lib/services/interfaces";
import {
  AzureAlertService,
  AzureAssetService,
  AzureCopilotService,
  AzurePlanetaryComputerService,
  AzurePostureService,
  AzureRiskEngineService,
  AzureThresholdService,
  AzureWeatherService,
} from "@/lib/services/azure/providers";
import {
  MockAlertService,
  MockAssetService,
  MockCopilotService,
  MockPlanetaryComputerService,
  MockPostureService,
  MockRiskEngineService,
  MockThresholdService,
  MockWeatherService,
} from "@/lib/services/mock-providers";

/** Tenant (/app) providers — real Azure services; empty/honest until data is ingested. */
export const tenantServices: PlatformServices = {
  assets: new AzureAssetService(),
  weather: new AzureWeatherService(),
  risk: new AzureRiskEngineService(),
  alerts: new AzureAlertService(),
  posture: new AzurePostureService(),
  thresholds: new AzureThresholdService(),
  geospatial: new AzurePlanetaryComputerService(),
  copilot: new AzureCopilotService(),
};

const sampleServices: PlatformServices = {
  assets: new MockAssetService(),
  weather: new MockWeatherService(),
  risk: new MockRiskEngineService(),
  alerts: new MockAlertService(),
  posture: new MockPostureService(),
  thresholds: new MockThresholdService(),
  geospatial: new MockPlanetaryComputerService(),
  copilot: new MockCopilotService(),
};

/** Pick the provider set for the current console base. */
export function getServices(_base: OpsBase): PlatformServices {
  return import.meta.env.VITE_USE_SAMPLE_DATA === "true" ? sampleServices : tenantServices;
}

export type { PlatformServices };
