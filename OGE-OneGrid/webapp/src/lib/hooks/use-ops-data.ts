import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { OpsBase } from "@/components/ops/ops-nav";
import type { Asset, AssetRisk, WeatherEvent } from "@/lib/domain/types";
import { getServices } from "@/lib/services";

// Queries are keyed by console base so the /demo (synthetic) and /app (tenant)
// caches never collide, and each fetches from the provider set for that base.

export function assetsQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "assets"],
    queryFn: () => getServices(base).assets.listAssets(),
    staleTime: 5 * 60 * 1000,
  });
}

export function eventsQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "events"],
    queryFn: () => getServices(base).weather.listEvents(),
    staleTime: 60 * 1000,
  });
}

export function layersQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "layers"],
    queryFn: () => getServices(base).geospatial.listLayers(),
    staleTime: 10 * 60 * 1000,
  });
}

export function alertsQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "alerts"],
    queryFn: () => getServices(base).alerts.listAlerts(),
    staleTime: 30 * 1000,
  });
}

export function alertStatusOverridesQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "alert-status-overrides"],
    queryFn: () => getServices(base).alerts.listStatusOverrides(),
    staleTime: 30 * 1000,
  });
}

export function postureQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "posture"],
    queryFn: () => getServices(base).posture.listPostures(),
    staleTime: 30 * 1000,
  });
}

export function thresholdRulesQuery(base: OpsBase) {
  return queryOptions({
    queryKey: [base, "threshold-rules"],
    queryFn: () => getServices(base).thresholds.listRules(),
    staleTime: 5 * 60 * 1000,
  });
}

export function risksQuery(base: OpsBase, horizonHours: number) {
  return queryOptions({
    queryKey: [base, "risks", horizonHours],
    queryFn: () => getServices(base).risk.scoreEstate(horizonHours),
    staleTime: 60 * 1000,
  });
}

export interface OpsSnapshot {
  assets: Asset[];
  risks: AssetRisk[];
  riskMap: Map<string, AssetRisk>;
  event: WeatherEvent | undefined;
  isLoading: boolean;
  metrics: {
    monitored: number;
    exposed: number;
    insideCone: number;
    high: number;
    critical: number;
    firstImpactHours: number | null;
  };
}

export function useOpsSnapshot(base: OpsBase, horizonHours = 72): OpsSnapshot {
  const assets = useQuery(assetsQuery(base));
  const events = useQuery(eventsQuery(base));
  const risks = useQuery(risksQuery(base, horizonHours));

  return useMemo(() => {
    const a = assets.data ?? [];
    const r = risks.data ?? [];
    const riskMap = new Map(r.map((x) => [x.assetId, x]));
    const exposed = r.filter((x) => x.level !== "normal" && x.level !== "monitor");
    const impacts = r
      .filter((x) => x.hoursToImpact !== null && x.level !== "normal")
      .map((x) => x.hoursToImpact!)
      .sort((x, y) => x - y);
    const highestRisk = r.reduce<AssetRisk | undefined>(
      (highest, risk) => (!highest || risk.score > highest.score ? risk : highest),
      undefined,
    );
    const primaryEvent =
      events.data?.find((event) => event.id === highestRisk?.eventId) ?? events.data?.[0];
    return {
      assets: a,
      risks: r,
      riskMap,
      event: primaryEvent,
      isLoading: assets.isLoading || risks.isLoading || events.isLoading,
      metrics: {
        monitored: a.length,
        exposed: exposed.length,
        insideCone: r.filter((x) => x.insideCone).length,
        high: r.filter((x) => x.level === "high").length,
        critical: r.filter((x) => x.level === "critical").length,
        firstImpactHours: impacts[0] ?? null,
      },
    };
  }, [assets.data, assets.isLoading, risks.data, risks.isLoading, events.data, events.isLoading]);
}
