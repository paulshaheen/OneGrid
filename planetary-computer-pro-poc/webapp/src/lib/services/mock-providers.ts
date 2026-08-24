// Mock provider implementations backed by the isolated sample dataset.
// Replace individually with Azure-backed providers via src/lib/services/index.ts.

import { sampleAlerts, sampleAssets, sampleEvent } from "@/lib/data/sample-gom";
import { derivePosture } from "@/lib/services/posture";
import { DEFAULT_RULES } from "@/lib/services/thresholds";
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
import { haversineMi, scoreAsset } from "@/lib/services/risk-engine";
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

export class MockAssetService implements AssetService {
  async listAssets(): Promise<Asset[]> {
    return sampleAssets;
  }
  async getAsset(id: string): Promise<Asset | null> {
    return sampleAssets.find((a) => a.id === id) ?? null;
  }
}

export class MockWeatherService implements WeatherService {
  readonly providerLabel = "Blended global forecast ensemble";
  async listEvents(): Promise<WeatherEvent[]> {
    return [sampleEvent];
  }
  async getEvent(id: string): Promise<WeatherEvent | null> {
    return id === sampleEvent.id ? sampleEvent : null;
  }
}

export class MockRiskEngineService implements RiskEngineService {
  async scoreEstate(horizonHours = 120): Promise<AssetRisk[]> {
    return sampleAssets.map((a) => scoreAsset(a, sampleEvent, horizonHours));
  }
  async scoreOne(assetId: string, horizonHours = 120): Promise<AssetRisk | null> {
    const asset = sampleAssets.find((a) => a.id === assetId);
    return asset ? scoreAsset(asset, sampleEvent, horizonHours) : null;
  }
}

const ALERT_STATUS_KEY = "ops-alert-status";

export class MockAlertService implements AlertService {
  private alerts: OpsAlert[] = [...sampleAlerts];
  private overrides: Record<string, OpsAlert["status"]> | null = null;

  private loadOverrides(): Record<string, OpsAlert["status"]> {
    if (this.overrides) return this.overrides;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(ALERT_STATUS_KEY);
        if (raw) {
          this.overrides = JSON.parse(raw) as Record<string, OpsAlert["status"]>;
          return this.overrides;
        }
      } catch {
        /* fall through to empty */
      }
    }
    this.overrides = {};
    return this.overrides;
  }

  private persistOverrides(next: Record<string, OpsAlert["status"]>): void {
    this.overrides = next;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ALERT_STATUS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — in-memory only */
      }
    }
  }

  async listAlerts(): Promise<OpsAlert[]> {
    const o = this.loadOverrides();
    return this.alerts.map((a) => (o[a.id] ? { ...a, status: o[a.id]! } : a));
  }
  async listStatusOverrides(): Promise<Record<string, OpsAlert["status"]>> {
    return this.loadOverrides();
  }
  async setStatus(id: string, status: OpsAlert["status"]): Promise<OpsAlert[]> {
    this.persistOverrides({ ...this.loadOverrides(), [id]: status });
    return this.listAlerts();
  }
}

export class MockPlanetaryComputerService implements PlanetaryComputerService {
  async listLayers(): Promise<GeospatialLayer[]> {
    return [
      {
        id: "assets",
        name: "Company assets",
        description: "Platforms, pipelines, wells, terminals and ports",
        updatedLabel: "Synced 6 minutes ago",
        defaultOn: true,
      },
      {
        id: "track",
        name: "Storm track & forecast cone",
        description: "Observed track and projected impact corridor",
        updatedLabel: "Updated 4 minutes ago",
        defaultOn: true,
      },
      {
        id: "wind",
        name: "Severe wind field",
        description: "Hurricane and tropical-storm force wind extents",
        updatedLabel: "Updated 4 minutes ago",
        defaultOn: true,
      },
      {
        id: "uncertainty",
        name: "Forecast spread (ensemble)",
        description:
          "Alternative storm paths from the forecast ensemble — how much the track could still change",
        updatedLabel: "Updated 4 minutes ago",
        defaultOn: true,
      },
      {
        id: "previous",
        name: "Previous forecast cycle",
        description: "Where the last cycle put the storm, for cycle-over-cycle comparison",
        updatedLabel: "Superseded 6 hours ago",
        defaultOn: false,
      },
      {
        id: "rain",
        name: "Rainfall accumulation",
        description: "72-hour forecast rainfall totals",
        updatedLabel: "Updated 11 minutes ago",
        defaultOn: false,
      },
      {
        id: "flood",
        name: "Coastal flood exposure",
        description: "Surge and low-lying terrain exposure along the coast",
        updatedLabel: "Updated 38 minutes ago",
        defaultOn: false,
      },
      {
        id: "satellite",
        name: "Satellite imagery — Gulf of Mexico",
        description: "Latest cloud-free composite of the operating region",
        updatedLabel: "Captured 2 hours ago",
        defaultOn: false,
      },
      {
        id: "history",
        name: "Historical storm tracks",
        description: "Named storms crossing the estate since 1998",
        updatedLabel: "Reference dataset",
        defaultOn: false,
      },
    ];
  }
}

/**
 * Grounded rules-based copilot. Answers are computed from live asset, forecast
 * and risk state — the same grounding contract an Azure AI Foundry agent will
 * use when it replaces this provider.
 */
export class MockCopilotService implements CopilotService {
  suggestions(): string[] {
    return [
      "Which offshore platforms are most at risk over the next 72 hours?",
      "When is Platform Delta-7 expected to experience hurricane-force winds?",
      "Show pipelines inside the current storm-impact corridor.",
      "Which assets should operations teams review first?",
      "Summarize Gulf of Mexico risk for leadership.",
      "Show the assets within 100 miles of the hurricane track.",
      "What changed between the latest forecast and the previous forecast?",
    ];
  }

  async ask(question: string): Promise<CopilotAnswer> {
    const q = question.toLowerCase();
    const risks = sampleAssets.map((a) => scoreAsset(a, sampleEvent, 120));
    const byId = new Map(risks.map((r) => [r.assetId, r]));
    const asset = sampleAssets.find(
      (a) => q.includes(a.name.toLowerCase()) || q.includes(a.id.toLowerCase()),
    );
    const ranked = [...risks].sort((a, b) => b.score - a.score);
    const nameOf = (id: string) => sampleAssets.find((a) => a.id === id)?.name ?? id;

    if (asset) {
      const r = byId.get(asset.id)!;
      const hurricaneForce = r.forecastWindMph >= 74;
      return {
        text:
          `**${asset.name}** — risk ${r.level.toUpperCase()} (${r.score}/100).\n\n` +
          `Closest approach to ${sampleEvent.name} is **${r.distanceMi} miles** in **${r.hoursToImpact ?? "—"} hours**, with a forecast sustained wind of **${r.forecastWindMph} mph** and **${r.rainfallIn} in** of rainfall. ` +
          (hurricaneForce
            ? `Hurricane-force wind (74 mph+) is expected to reach the facility around hour **${Math.max(0, (r.hoursToImpact ?? 0) - 6)}**, ahead of peak intensity.`
            : `Hurricane-force wind is not currently forecast at this location.`) +
          `\n\nRecommended: ${r.recommendations[0] ?? "Continue monitoring."}`,
        citations: [
          { label: asset.name, kind: "asset", refId: asset.id },
          { label: sampleEvent.name, kind: "event", refId: sampleEvent.id },
          { label: `Risk score ${r.score}/100`, kind: "risk", refId: asset.id },
        ],
        highlightAssetIds: [asset.id],
      };
    }

    if (q.includes("pipeline")) {
      const pipes = ranked.filter(
        (r) => sampleAssets.find((a) => a.id === r.assetId)?.type === "pipeline" && r.insideCone,
      );
      return {
        text:
          pipes.length === 0
            ? "No pipeline segments are currently inside the projected impact corridor."
            : `**${pipes.length} pipeline segment${pipes.length > 1 ? "s" : ""}** lie inside the projected impact corridor:\n\n` +
              pipes
                .map(
                  (p) =>
                    `- **${nameOf(p.assetId)}** — ${p.score}/100, ${p.distanceMi} mi from the centerline, ${p.rainfallIn} in rainfall forecast, impact in ${p.hoursToImpact} h`,
                )
                .join("\n"),
        citations: [{ label: "Impact corridor intersection", kind: "dataset" }],
        highlightAssetIds: pipes.map((p) => p.assetId),
      };
    }

    if (q.includes("100 mile") || q.includes("100 miles") || q.includes("within")) {
      const near = ranked.filter((r) => r.distanceMi <= 100);
      return {
        text:
          `**${near.length} assets** fall within 100 miles of the forecast track of ${sampleEvent.name}. The most exposed are:\n\n` +
          near
            .slice(0, 6)
            .map(
              (r) =>
                `- **${nameOf(r.assetId)}** — ${r.distanceMi} mi, ${r.forecastWindMph} mph, risk ${r.score}/100`,
            )
            .join("\n"),
        citations: [{ label: "Track proximity analysis", kind: "dataset" }],
        highlightAssetIds: near.map((r) => r.assetId),
      };
    }

    if (q.includes("chang") || q.includes("previous forecast")) {
      return {
        text:
          `The latest forecast cycle shifted the track **21 miles west** of the previous cycle and raised peak intensity from Category 3 to **Category 4** near hour 36.\n\n` +
          `- Central Gulf exposure increased: **Platform Delta-7** moved from elevated to **critical**.\n` +
          `- **Platform Atlas-9** entered the corridor for the first time.\n` +
          `- Eastern Gulf exposure eased slightly for **Platform Titan-1**.\n` +
          `- First expected impact moved forward by roughly **3 hours**.`,
        citations: [
          { label: "Forecast cycle comparison", kind: "dataset" },
          { label: sampleEvent.name, kind: "event", refId: sampleEvent.id },
        ],
        highlightAssetIds: ["PLT-D7", "PLT-A9"],
      };
    }

    if (q.includes("leadership") || q.includes("summar") || q.includes("executive")) {
      const exposed = ranked.filter((r) => r.score >= 42);
      const inCone = ranked.filter((r) => r.insideCone);
      const first = ranked
        .filter((r) => r.hoursToImpact !== null)
        .sort((a, b) => a.hoursToImpact! - b.hoursToImpact!)[0];
      return {
        text:
          `**Gulf of Mexico — leadership summary**\n\n` +
          `${sampleEvent.name} is forecast to enter the central Gulf within 48 hours as a Category 4 system. ` +
          `**${exposed.length} assets** currently carry elevated risk or higher and **${inCone.length}** lie inside the projected impact corridor. ` +
          `First expected impact is in **${first?.hoursToImpact ?? "—"} hours**.\n\n` +
          `Highest exposure: ${ranked
            .slice(0, 3)
            .map((r) => `**${nameOf(r.assetId)}** (${r.score}/100)`)
            .join(", ")}. ` +
          `Production at risk is concentrated in deepwater assets; downstream and LNG facilities remain in a monitoring posture pending the coastal track solution.`,
        citations: [
          { label: `${exposed.length} exposed assets`, kind: "risk" },
          { label: sampleEvent.name, kind: "event", refId: sampleEvent.id },
        ],
        highlightAssetIds: ranked.slice(0, 6).map((r) => r.assetId),
      };
    }

    const scope =
      q.includes("platform") || q.includes("offshore")
        ? ranked.filter(
            (r) => sampleAssets.find((a) => a.id === r.assetId)?.type === "offshore_platform",
          )
        : ranked;
    const top = scope.slice(0, 5);
    return {
      text:
        `Ranked by current 72-hour exposure to ${sampleEvent.name}:\n\n` +
        top
          .map(
            (r, i) =>
              `${i + 1}. **${nameOf(r.assetId)}** — ${r.level.toUpperCase()} ${r.score}/100 · ${r.distanceMi} mi from centerline · ${r.forecastWindMph} mph forecast · impact in ${r.hoursToImpact} h`,
          )
          .join("\n") +
        `\n\nReview order should follow this ranking; each entry has evacuation or shut-in lead time shorter than its forecast onset.`,
      citations: [
        { label: "Risk engine ranking", kind: "risk" },
        { label: sampleEvent.name, kind: "event", refId: sampleEvent.id },
      ],
      highlightAssetIds: top.map((r) => r.assetId),
    };
  }
}

export function nearbyAssets(asset: Asset, all: Asset[], radiusMi = 60): Asset[] {
  return all
    .filter((a) => a.id !== asset.id)
    .map((a) => ({ a, d: haversineMi(asset.lat, asset.lon, a.lat, a.lon) }))
    .filter((x) => x.d <= radiusMi)
    .sort((x, y) => x.d - y.d)
    .slice(0, 6)
    .map((x) => x.a);
}

/**
 * Response-posture provider. Posture is derived from live exposure, with
 * operator overrides layered on top — the same contract a workflow system
 * (Fabric / Dataverse) will honour when it replaces this provider.
 */
export class MockPostureService implements PostureService {
  private gateOverrides = new Map<string, Partial<Record<GateId, GateState>>>();
  private statusOverrides = new Map<string, OperatingStatus>();

  private build(): AssetPosture[] {
    const risks = new Map(
      sampleAssets.map((a) => [a.id, scoreAsset(a, sampleEvent, 120)] as const),
    );
    return sampleAssets.map((a) => {
      const base = derivePosture(a, risks.get(a.id));
      const gates = { ...base.gates, ...(this.gateOverrides.get(a.id) ?? {}) };
      const status = this.statusOverrides.get(a.id) ?? base.productionStatus;
      return { ...base, gates, productionStatus: status };
    });
  }

  async listPostures(): Promise<AssetPosture[]> {
    return this.build();
  }

  async setGate(assetId: string, gate: GateId, state: GateState): Promise<AssetPosture[]> {
    const current = this.gateOverrides.get(assetId) ?? {};
    this.gateOverrides.set(assetId, { ...current, [gate]: state });
    return this.build();
  }

  async setProductionStatus(assetId: string, status: OperatingStatus): Promise<AssetPosture[]> {
    this.statusOverrides.set(assetId, status);
    return this.build();
  }

  async resetOverrides(): Promise<AssetPosture[]> {
    this.gateOverrides.clear();
    this.statusOverrides.clear();
    return this.build();
  }
}

const RULE_STORAGE_KEY = "ops-threshold-rules";

/** Threshold rules persist locally so operator edits survive a reload. */
export class MockThresholdService implements ThresholdService {
  private rules: ThresholdRule[] | null = null;

  private load(): ThresholdRule[] {
    if (this.rules) return this.rules;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(RULE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ThresholdRule[];
          if (Array.isArray(parsed) && parsed.length) {
            this.rules = parsed;
            return parsed;
          }
        }
      } catch {
        /* fall through to defaults */
      }
    }
    this.rules = DEFAULT_RULES.map((r) => ({ ...r }));
    return this.rules;
  }

  private persist(next: ThresholdRule[]): ThresholdRule[] {
    this.rules = next;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(RULE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — in-memory only */
      }
    }
    return next;
  }

  async listRules(): Promise<ThresholdRule[]> {
    return this.load();
  }

  async saveRule(rule: ThresholdRule): Promise<ThresholdRule[]> {
    const rules = this.load();
    const exists = rules.some((r) => r.id === rule.id);
    return this.persist(
      exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule],
    );
  }

  async deleteRule(id: string): Promise<ThresholdRule[]> {
    return this.persist(this.load().filter((r) => r.id !== id));
  }

  async resetRules(): Promise<ThresholdRule[]> {
    return this.persist(DEFAULT_RULES.map((r) => ({ ...r })));
  }
}
