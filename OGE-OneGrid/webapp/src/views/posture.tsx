import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Circle, Loader2, Minus, RotateCcw } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { RiskBadge } from "@/components/ops/RiskBadge";
import { useOpsBase } from "@/components/ops/ops-nav";
import { postureQuery, useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { POSTURE_GATES, POSTURE_LEVEL_LABEL, gateStateLabel } from "@/lib/services/posture";
import { getServices } from "@/lib/services";
import { ASSET_TYPE_LABEL, STATUS_LABEL, relativeTime, riskColorVar } from "@/lib/format";
import type { GateId, GateState, OperatingStatus, PostureLevel } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const LEVEL_TONE: Record<PostureLevel, "normal" | "monitor" | "elevated" | "high" | "critical"> = {
  0: "normal",
  1: "monitor",
  2: "elevated",
  3: "high",
  4: "critical",
};

const NEXT_STATE: Record<GateState, GateState> = {
  not_started: "in_progress",
  in_progress: "complete",
  complete: "not_started",
  not_required: "not_started",
};

const STATUS_OPTIONS: OperatingStatus[] = [
  "producing",
  "reduced",
  "standby",
  "shut_in",
  "evacuating",
];

function GateCell({
  state,
  onCycle,
  title,
}: {
  state: GateState;
  onCycle: () => void;
  title: string;
}) {
  const icon =
    state === "complete" ? (
      <Check className="size-3.5" />
    ) : state === "in_progress" ? (
      <Loader2 className="size-3.5" />
    ) : state === "not_required" ? (
      <Minus className="size-3.5" />
    ) : (
      <Circle className="size-3" />
    );
  const tone =
    state === "complete"
      ? "border-risk-normal/50 bg-risk-normal/12 text-risk-normal"
      : state === "in_progress"
        ? "border-risk-high/50 bg-risk-high/12 text-risk-high"
        : state === "not_required"
          ? "border-border/60 text-muted-foreground/50"
          : "border-border text-muted-foreground";
  return (
    <button
      onClick={onCycle}
      title={`${title} — ${gateStateLabel(state)} (click to advance)`}
      className={cn(
        "grid size-7 place-items-center rounded-sm border transition-colors hover:brightness-125",
        tone,
      )}
    >
      {icon}
    </button>
  );
}

export function PosturePage() {
  const qc = useQueryClient();
  const base = useOpsBase();
  const { assets, riskMap, event } = useOpsSnapshot(base, 120);
  const postures = useQuery(postureQuery(base)).data ?? [];
  const [onlyActive, setOnlyActive] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    return postures
      .map((p) => ({ posture: p, asset: byId.get(p.assetId)!, risk: riskMap.get(p.assetId) }))
      .filter((r) => r.asset)
      .filter((r) => (onlyActive ? r.posture.level > 0 : true))
      .sort(
        (a, b) =>
          b.posture.level - a.posture.level ||
          (a.risk?.hoursToImpact ?? 999) - (b.risk?.hoursToImpact ?? 999) ||
          (b.risk?.score ?? 0) - (a.risk?.score ?? 0),
      );
  }, [postures, assets, riskMap, onlyActive]);

  const levelCounts = ([4, 3, 2, 1] as PostureLevel[]).map((lvl) => ({
    lvl,
    n: postures.filter((p) => p.level === lvl).length,
  }));

  const pob = postures.reduce(
    (acc, p) => ({
      current: acc.current + (p.pobCurrent ?? 0),
      normal: acc.normal + (p.pobNormal ?? 0),
    }),
    { current: 0, normal: 0 },
  );
  const shutIn = postures.filter(
    (p) => p.productionStatus === "shut_in" || p.productionStatus === "evacuating",
  ).length;

  async function cycleGate(assetId: string, gate: GateId, state: GateState) {
    setActionError(null);
    try {
      await getServices(base).posture.setGate(assetId, gate, NEXT_STATE[state]);
      await qc.invalidateQueries({ queryKey: [base, "posture"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not record the gate decision.");
    }
  }
  async function setStatus(assetId: string, status: OperatingStatus) {
    setActionError(null);
    try {
      await getServices(base).posture.setProductionStatus(assetId, status);
      await qc.invalidateQueries({ queryKey: [base, "posture"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update production status.");
    }
  }
  async function reset() {
    setActionError(null);
    try {
      await getServices(base).posture.resetOverrides();
      await qc.invalidateQueries({ queryKey: [base, "posture"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reset overrides.");
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Response posture"
        description={`Lead-time decision gates, production status and personnel on board for ${event?.name ?? "the active event"}. Gates advance automatically with the forecast; click any gate to record the actual decision.`}
        actions={
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Reset to forecast-derived
          </button>
        }
      />

      <div className="space-y-4 p-4">
        {actionError && (
          <div
            role="alert"
            className="rounded-sm border border-risk-critical/50 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical"
          >
            {actionError}
          </div>
        )}
        <div className="panel grid grid-cols-2 divide-x md:grid-cols-6">
          {levelCounts.map((c) => (
            <div key={c.lvl} className="px-4 py-3">
              <div className="label-xs" style={{ color: riskColorVar(LEVEL_TONE[c.lvl]) }}>
                {POSTURE_LEVEL_LABEL[c.lvl]}
              </div>
              <div className="num mt-1 text-xl font-semibold">{c.n}</div>
            </div>
          ))}
          <div className="px-4 py-3">
            <div className="label-xs">Shut in / evacuating</div>
            <div className="num mt-1 text-xl font-semibold">{shutIn}</div>
          </div>
          <div className="px-4 py-3">
            <div className="label-xs">Personnel on board</div>
            <div className="num mt-1 text-xl font-semibold">
              {pob.current}
              <span className="text-sm font-normal text-muted-foreground"> / {pob.normal}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
            <span className="label-xs">Gate sequence</span>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {POSTURE_GATES.map((g) => (
                <span key={g.id} className="num">
                  <span className="text-foreground">{g.id}</span> {g.label}
                </span>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
                className="accent-primary"
              />
              Only assets in an active posture
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-3 py-2 font-medium">Posture</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Onset</th>
                  {POSTURE_GATES.map((g) => (
                    <th key={g.id} className="num px-2 py-2 text-center font-medium">
                      {g.id}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Production</th>
                  <th className="px-3 py-2 font-medium">POB</th>
                  <th className="px-4 py-2 font-medium">Last decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ posture: p, asset, risk }) => (
                  <tr key={p.assetId} className="border-t align-middle hover:bg-accent/40">
                    <td className="px-4 py-2">
                      <div className="font-medium">{asset.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {ASSET_TYPE_LABEL[asset.type]} · {asset.region}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase"
                        style={{
                          color: riskColorVar(LEVEL_TONE[p.level]),
                          borderColor: `color-mix(in oklch, ${riskColorVar(LEVEL_TONE[p.level])} 45%, transparent)`,
                          backgroundColor: `color-mix(in oklch, ${riskColorVar(LEVEL_TONE[p.level])} 12%, transparent)`,
                        }}
                      >
                        {POSTURE_LEVEL_LABEL[p.level]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {risk ? <RiskBadge level={risk.level} score={risk.score} /> : "—"}
                    </td>
                    <td className="num px-3 py-2 text-muted-foreground">
                      {risk?.hoursToImpact ?? "—"} h
                    </td>
                    {POSTURE_GATES.map((g) => (
                      <td key={g.id} className="px-2 py-2 text-center">
                        <div className="flex justify-center">
                          <GateCell
                            state={p.gates[g.id]}
                            title={`${g.id} ${g.label}`}
                            onCycle={() => void cycleGate(p.assetId, g.id, p.gates[g.id])}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <select
                        value={p.productionStatus}
                        onChange={(e) =>
                          void setStatus(p.assetId, e.target.value as OperatingStatus)
                        }
                        className="rounded-sm border bg-card px-1.5 py-1 text-[11px]"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num px-3 py-2 text-muted-foreground">
                      {p.pobCurrent === null ? "unmanned" : `${p.pobCurrent} / ${p.pobNormal}`}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">
                      {p.lastDecision ? (
                        <>
                          <span className="text-foreground">{p.lastDecision.action}</span>
                          <br />
                          {p.lastDecision.by} · {relativeTime(p.lastDecision.atIso)}
                        </>
                      ) : (
                        <>No decision recorded · owner {p.decisionOwner}</>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No facility is currently in an active response posture.
            </div>
          )}
        </div>

        <div className="panel p-4">
          <div className="label-xs mb-2">Gate definitions</div>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {POSTURE_GATES.map((g) => (
              <li key={g.id} className="rounded-sm border p-3">
                <div className="num text-xs font-semibold">
                  {g.id} · {g.label}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {g.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
