import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { OpsBase } from "@/components/ops/ops-nav";
import type { Asset, AssetRisk, OpsAlert, WeatherEvent } from "@/lib/domain/types";
import { getServices } from "@/lib/services";
import { METRIC_LABEL, METRIC_UNIT, evaluateRules } from "@/lib/services/thresholds";

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

// Combined alert feed = configured-threshold breaches (derived from the live view)
// + any service alerts, with status overrides applied. Shared by the full Alerts
// page and the header bell so the badge and the dropdown always agree.
export function useAlertFeed(base: OpsBase): {
  alerts: OpsAlert[];
  openCount: number;
  isLoading: boolean;
} {
  const baseAlerts = useQuery(alertsQuery(base));
  const assetsRes = useQuery(assetsQuery(base));
  const rulesRes = useQuery(thresholdRulesQuery(base));
  const overridesRes = useQuery(alertStatusOverridesQuery(base));
  const snap = useOpsSnapshot(base, 120);
  return useMemo(() => {
    const assets = assetsRes.data ?? [];
    const rules = rulesRes.data ?? [];
    const statusOverrides = overridesRes.data ?? {};
    const risks = snap.risks;
    const event = snap.event;
    const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
    const cycleIso = event?.updatedAtIso ?? new Date().toISOString();
    const cycleId = event?.id ?? "current-cycle";
    const perRule = new Map<string, number>();
    const derived: OpsAlert[] = evaluateRules(rules, assets, risks)
      .sort((a, b) => (a.hoursToImpact ?? 999) - (b.hoursToImpact ?? 999))
      .filter((b) => {
        const n = perRule.get(b.ruleId) ?? 0;
        if (n >= 4) return false;
        perRule.set(b.ruleId, n + 1);
        return true;
      })
      .map((b) => {
        const id = `${b.ruleId}-${b.assetId}`;
        return {
          id,
          title: `${nameOf(b.assetId)} — ${b.ruleName}`,
          detail: `${METRIC_LABEL[b.metric]} ${b.observed}${METRIC_UNIT[b.metric]} against a configured limit of ${b.comparator === "gte" ? "≥" : "≤"} ${b.threshold}${METRIC_UNIT[b.metric]}${b.hoursToImpact !== null ? `, onset in ${b.hoursToImpact} h` : ""}. ${b.action}`,
          severity: b.severity,
          assetId: b.assetId,
          eventId: cycleId,
          status: statusOverrides[id] ?? "open",
          owner: b.owner,
          createdAtIso: cycleIso,
        } satisfies OpsAlert;
      });
    const alerts = [...derived, ...(baseAlerts.data ?? [])].map((a) => ({
      ...a,
      status: statusOverrides[a.id] ?? a.status,
    }));
    return {
      alerts,
      openCount: alerts.filter((a) => a.status === "open").length,
      isLoading: assetsRes.isLoading || rulesRes.isLoading || snap.isLoading,
    };
  }, [
    assetsRes.data,
    assetsRes.isLoading,
    rulesRes.data,
    rulesRes.isLoading,
    overridesRes.data,
    snap.risks,
    snap.event,
    snap.isLoading,
    baseAlerts.data,
  ]);
}
