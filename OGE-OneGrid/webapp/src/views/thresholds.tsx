import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { useOpsBase } from "@/components/ops/ops-nav";
import { thresholdRulesQuery, useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { METRIC_LABEL, METRIC_UNIT, evaluateRules } from "@/lib/services/thresholds";
import { getServices } from "@/lib/services";
import { ASSET_TYPE_LABEL, riskColorVar } from "@/lib/format";
import type {
  AlertSeverity,
  AssetType,
  ThresholdComparator,
  ThresholdMetric,
  ThresholdRule,
} from "@/lib/domain/types";

const SEVERITY_TONE: Record<AlertSeverity, "critical" | "high" | "monitor" | "normal"> = {
  critical: "critical",
  warning: "high",
  advisory: "monitor",
  info: "normal",
};

const ALL_TYPES: AssetType[] = [
  "offshore_platform",
  "pipeline",
  "well",
  "refinery",
  "lng_terminal",
  "storage",
  "port",
];

const METRICS: ThresholdMetric[] = ["wind", "rain", "eta", "score", "distance"];

function blankRule(): ThresholdRule {
  return {
    id: `THR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    name: "New operational threshold",
    assetTypes: ["offshore_platform"],
    metric: "wind",
    comparator: "gte",
    value: 60,
    appliesAboveScore: 30,
    severity: "warning",
    action: "Describe the operational action this threshold triggers.",
    owner: "Operations Duty Manager",
    enabled: true,
    builtIn: false,
  };
}

export function ThresholdsPage() {
  const qc = useQueryClient();
  const base = useOpsBase();
  const { assets, risks } = useOpsSnapshot(base, 120);
  const rules = useQuery(thresholdRulesQuery(base)).data ?? [];
  const [editing, setEditing] = useState<ThresholdRule | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const breaches = useMemo(() => evaluateRules(rules, assets, risks), [rules, assets, risks]);
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  const breachCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of breaches) m.set(b.ruleId, (m.get(b.ruleId) ?? 0) + 1);
    return m;
  }, [breaches]);

  async function save(rule: ThresholdRule) {
    setActionError(null);
    try {
      await getServices(base).thresholds.saveRule(rule);
      await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
      setEditing(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save the threshold.");
    }
  }
  async function remove(id: string) {
    setActionError(null);
    try {
      await getServices(base).thresholds.deleteRule(id);
      await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete the threshold.");
    }
  }
  async function reset() {
    setActionError(null);
    try {
      await getServices(base).thresholds.resetRules();
      await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not restore defaults.");
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Operational thresholds"
        description="Starter defaults based on common energy-sector limits (crane cut-offs, helideck limits, shut-in triggers, flood watches) — review and replace with your own operating procedures. Edits are saved to this deployment. Rules are evaluated against every asset in the current forecast cycle; breaches drive the alert feed."
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(blankRule())}
              className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
            >
              <Plus className="size-3.5" /> New threshold
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" /> Restore defaults
            </button>
          </div>
        }
      />

      {actionError && (
        <div className="px-4 pt-4">
          <div
            role="alert"
            className="rounded-sm border border-risk-critical/50 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical"
          >
            {actionError}
          </div>
        </div>
      )}

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="panel">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="label-xs">Threshold rules</span>
            <span className="text-[11px] text-muted-foreground">
              {rules.filter((r) => r.enabled).length} active · {breaches.length} breaches this cycle
            </span>
          </div>
          <ul className="divide-y">
            {rules.map((rule) => (
              <li key={rule.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => void save({ ...rule, enabled: !rule.enabled })}
                    className="mt-1 accent-primary"
                    aria-label={`Enable ${rule.name}`}
                  />
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{rule.name}</span>
                      <span
                        className="rounded-sm border px-1.5 py-0.5 text-[9.5px] font-medium tracking-wide uppercase"
                        style={{
                          color: riskColorVar(SEVERITY_TONE[rule.severity]),
                          borderColor: `color-mix(in oklch, ${riskColorVar(SEVERITY_TONE[rule.severity])} 45%, transparent)`,
                        }}
                      >
                        {rule.severity}
                      </span>
                      {!rule.builtIn && (
                        <span className="rounded-sm border px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                          custom
                        </span>
                      )}
                    </div>
                    <div className="num mt-1 text-[11px] text-muted-foreground">
                      {METRIC_LABEL[rule.metric]} {rule.comparator === "gte" ? "≥" : "≤"}{" "}
                      {rule.value} {METRIC_UNIT[rule.metric]} · exposure ≥ {rule.appliesAboveScore}{" "}
                      · {rule.assetTypes.map((t) => ASSET_TYPE_LABEL[t]).join(", ")}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{rule.action}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="num rounded-sm border px-2 py-1 text-[11px]"
                      style={{
                        color:
                          (breachCount.get(rule.id) ?? 0) > 0
                            ? riskColorVar(SEVERITY_TONE[rule.severity])
                            : undefined,
                      }}
                    >
                      {breachCount.get(rule.id) ?? 0} breaching
                    </span>
                    <button
                      onClick={() => setEditing(rule)}
                      className="rounded-sm border px-2 py-1 text-[11px] hover:bg-accent"
                    >
                      Edit
                    </button>
                    {!rule.builtIn && (
                      <button
                        onClick={() => void remove(rule.id)}
                        className="rounded-sm border p-1.5 text-muted-foreground hover:bg-accent hover:text-risk-critical"
                        aria-label="Delete threshold"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          {editing && (
            <div className="panel p-4">
              <div className="label-xs mb-3">
                {editing.builtIn ? "Edit threshold" : "Threshold definition"}
              </div>
              <div className="space-y-3 text-xs">
                <label className="block">
                  <span className="label-xs">Name</span>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="label-xs">Metric</span>
                    <select
                      value={editing.metric}
                      onChange={(e) =>
                        setEditing({ ...editing, metric: e.target.value as ThresholdMetric })
                      }
                      className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                    >
                      {METRICS.map((m) => (
                        <option key={m} value={m}>
                          {METRIC_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label-xs">Comparator</span>
                    <select
                      value={editing.comparator}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          comparator: e.target.value as ThresholdComparator,
                        })
                      }
                      className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                    >
                      <option value="gte">at or above</option>
                      <option value="lte">at or below</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="label-xs">Value ({METRIC_UNIT[editing.metric]})</span>
                    <input
                      type="number"
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })}
                      className="num mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                    />
                  </label>
                </div>
                <div>
                  <span className="label-xs">Applies to asset classes</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {ALL_TYPES.map((t) => {
                      const on = editing.assetTypes.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() =>
                            setEditing({
                              ...editing,
                              assetTypes: on
                                ? editing.assetTypes.filter((x) => x !== t)
                                : [...editing.assetTypes, t],
                            })
                          }
                          className={`rounded-sm border px-2 py-1 text-[11px] ${
                            on
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "text-muted-foreground"
                          }`}
                        >
                          {ASSET_TYPE_LABEL[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label-xs">Only above exposure score</span>
                    <input
                      type="number"
                      value={editing.appliesAboveScore}
                      onChange={(e) =>
                        setEditing({ ...editing, appliesAboveScore: Number(e.target.value) })
                      }
                      className="num mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="label-xs">Severity</span>
                    <select
                      value={editing.severity}
                      onChange={(e) =>
                        setEditing({ ...editing, severity: e.target.value as AlertSeverity })
                      }
                      className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                    >
                      <option value="critical">Critical</option>
                      <option value="warning">Warning</option>
                      <option value="advisory">Advisory</option>
                      <option value="info">Info</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="label-xs">Owner</span>
                  <input
                    value={editing.owner}
                    onChange={(e) => setEditing({ ...editing, owner: e.target.value })}
                    className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="label-xs">Operational action</span>
                  <textarea
                    value={editing.action}
                    onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                    rows={3}
                    className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => void save(editing)}
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
                  >
                    Save threshold
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-sm border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="border-b px-4 py-2.5 label-xs">Breaches in the current cycle</div>
            <ul className="max-h-[560px] divide-y overflow-y-auto">
              {breaches.slice(0, 60).map((b, i) => (
                <li key={`${b.ruleId}-${b.assetId}-${i}`} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: riskColorVar(SEVERITY_TONE[b.severity]) }}
                    />
                    <div>
                      <div className="text-xs font-medium">{nameOf(b.assetId)}</div>
                      <div className="num mt-0.5 text-[11px] text-muted-foreground">
                        {b.ruleName} · {METRIC_LABEL[b.metric]} {b.observed}
                        {METRIC_UNIT[b.metric]} vs {b.comparator === "gte" ? "≥" : "≤"}{" "}
                        {b.threshold}
                        {METRIC_UNIT[b.metric]}
                        {b.hoursToImpact !== null && ` · onset ${b.hoursToImpact}h`}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {breaches.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No thresholds are breached in this forecast cycle.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
