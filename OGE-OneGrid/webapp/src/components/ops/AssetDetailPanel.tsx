import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Asset, AssetRisk, WeatherEvent } from "@/lib/domain/types";
import { ASSET_TYPE_LABEL, STATUS_LABEL, coords, riskColorVar } from "@/lib/format";
import { nearbyAssets } from "@/lib/services/mock-providers";
import { RiskBadge } from "@/components/ops/RiskBadge";

type AssetDamage = {
  assetId: string;
  siteId?: string;
  equipmentCategory?: string;
  damageMode?: string;
  damageProbability?: number;
  expectedDowntimeH?: number;
  expectedLossUsd?: number;
  damageFactors?: { label: string; detail: string }[];
};

// Live predicted-damage rows from the report-app data plane (Aurora-driven).
// Fetched directly (not the solution-gated api hook) so the card shows whenever
// the exposure API has data for the selected asset or site.
function useAssetDamage(): AssetDamage[] {
  const [rows, setRows] = useState<AssetDamage[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/exposure", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (alive) setRows(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return rows;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="num text-right text-xs">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t px-4 py-3">
      <div className="label-xs mb-2">{title}</div>
      {children}
    </div>
  );
}

export function AssetDetailPanel({
  asset,
  risk,
  event,
  allAssets,
  onClose,
  onSelect,
}: {
  asset: Asset;
  risk?: AssetRisk | undefined;
  event?: WeatherEvent | undefined;
  allAssets: Asset[];
  onClose: () => void;
  onSelect?: (id: string) => void;
}) {
  const nearby = nearbyAssets(asset, allAssets, 75);
  const damageRows = useAssetDamage();
  const notNeg = (e: AssetDamage) => e.damageMode && e.damageMode !== "Negligible";
  // Equipment selected -> that asset's damage; site selected -> aggregate its units.
  const dmg = damageRows.find((e) => e.assetId === asset.id && notNeg(e));
  const siteRows = dmg ? [] : damageRows.filter((e) => e.siteId === asset.id);
  const siteAtRisk = siteRows.filter(notNeg);
  const siteAgg =
    !dmg && siteAtRisk.length > 0
      ? {
          atRisk: siteAtRisk.length,
          units: siteRows.length,
          totalLoss: siteRows.reduce((s, e) => s + (e.expectedLossUsd ?? 0), 0),
          totalDowntime: siteRows.reduce((s, e) => s + (e.expectedDowntimeH ?? 0), 0),
          worst: siteAtRisk.reduce((w, e) =>
            (e.damageProbability ?? 0) > (w.damageProbability ?? 0) ? e : w,
          ),
        }
      : null;
  const cleanId = (id: string) => id.replace(/_/g, " ");

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-card">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{asset.name}</h2>
            {risk && <RiskBadge level={risk.level} score={risk.score} />}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {ASSET_TYPE_LABEL[asset.type]} · {asset.id} · {asset.operator}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-sm p-1 text-muted-foreground hover:bg-accent"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {risk && (
        <div className="px-4 py-3">
          <div className="flex items-end gap-3">
            <div
              className="num text-4xl leading-none font-semibold"
              style={{ color: riskColorVar(risk.level) }}
            >
              {risk.score}
            </div>
            <div className="pb-1 text-[11px] text-muted-foreground">
              risk score / 100
              <br />
              {risk.insideCone
                ? "Inside projected impact corridor"
                : "Outside projected impact corridor"}
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${risk.score}%`, backgroundColor: riskColorVar(risk.level) }}
            />
          </div>
        </div>
      )}

      <Section title="Asset">
        <Row label="Type" value={ASSET_TYPE_LABEL[asset.type]} />
        <Row label="Location" value={coords(asset.lat, asset.lon)} />
        <Row label="Region" value={asset.region} />
        <Row label="Business unit" value={asset.businessUnit} />
        <Row label="Operating status" value={STATUS_LABEL[asset.status]} />
        <Row label="Criticality" value={asset.criticality.replace("_", " ")} />
        {Object.entries(asset.metadata).map(([k, v]) => (
          <Row
            key={k}
            label={k.replace(/_/g, " ")}
            value={typeof v === "number" ? v.toLocaleString() : v}
          />
        ))}
      </Section>

      {risk && (
        <Section title="Weather & forecast">
          <Row label="Active event" value={event?.name ?? "—"} />
          <Row label="Storm proximity" value={`${risk.distanceMi} mi from centerline`} />
          <Row label="Forecast sustained wind" value={`${risk.forecastWindMph} mph`} />
          <Row label="Forecast rainfall" value={`${risk.rainfallIn} in`} />
          <Row
            label="Expected time of impact"
            value={risk.hoursToImpact === null ? "None in horizon" : `${risk.hoursToImpact} hours`}
          />
          <Row
            label="Storm-force winds (≥39 mph)"
            value={
              risk.tsWindEtaH === null
                ? "Not within horizon"
                : risk.tsWindEtaH === 0
                  ? "Underway now"
                  : `arrive in ${risk.tsWindEtaH} h`
            }
          />
          {risk.hurWindEtaH !== null && (
            <Row
              label="Hurricane-force winds (≥74 mph)"
              value={risk.hurWindEtaH === 0 ? "Underway now" : `arrive in ${risk.hurWindEtaH} h`}
            />
          )}
          <Row label="Forecast confidence" value={event ? event.confidence : "—"} />
          {risk.evacWindowH !== null && (
            <div
              className="mt-2 rounded-sm border px-2.5 py-2"
              style={{ borderColor: riskColorVar(risk.level) }}
            >
              <div className="label-xs">Evacuation / shut-in window</div>
              <div className="num mt-0.5 text-sm font-semibold" style={{ color: riskColorVar(risk.level) }}>
                {risk.evacWindowH === 0
                  ? "Window closed — storm-force winds underway"
                  : `${risk.evacWindowH} h before storm-force winds`}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Actionable lead time to down-man, secure and shut in before conditions exceed safe
                operating limits.
              </p>
            </div>
          )}
        </Section>
      )}

      {risk && (
        <Section title="Why this score">
          <ul className="space-y-1.5">
            {risk.factors.map((f) => (
              <li key={f.label} className="flex items-start justify-between gap-3 text-xs">
                <span>
                  <span className="font-medium">{f.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{f.detail}</span>
                </span>
                <span className="num shrink-0 text-muted-foreground">+{f.points}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {risk && risk.recommendations.length > 0 && (
        <Section title="Recommended operational considerations">
          <ul className="space-y-1.5 text-xs">
            {risk.recommendations.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                {r}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {dmg && dmg.damageMode && dmg.damageMode !== "Negligible" && (
        <Section title="Predicted equipment damage">
          <Row label="Likely failure mode" value={dmg.damageMode} />
          <Row
            label="Damage probability"
            value={`${Math.round((dmg.damageProbability ?? 0) * 100)}%`}
          />
          <Row
            label="Expected downtime"
            value={dmg.expectedDowntimeH ? `${dmg.expectedDowntimeH} h` : "—"}
          />
          <Row
            label="Expected loss"
            value={`$${Math.round(dmg.expectedLossUsd ?? 0).toLocaleString()}`}
          />
          {dmg.equipmentCategory && (
            <Row label="Equipment class" value={dmg.equipmentCategory} />
          )}
          {dmg.damageFactors && dmg.damageFactors.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {dmg.damageFactors.map((f) => (
                <li key={f.label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-right text-[11px] text-muted-foreground">{f.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Fragility estimate from the Aurora forecast wind/rain at this asset, its equipment
            class and current condition. Deterministic and explainable.
          </p>
        </Section>
      )}

      {siteAgg && (
        <Section title="Predicted equipment damage">
          <Row
            label="Equipment at risk"
            value={`${siteAgg.atRisk} of ${siteAgg.units} units`}
          />
          <Row
            label="Est. site loss exposure"
            value={`$${Math.round(siteAgg.totalLoss).toLocaleString()}`}
          />
          <Row label="Est. cumulative downtime" value={`${siteAgg.totalDowntime} asset-h`} />
          <div
            className="mt-2 rounded-sm border px-2.5 py-2"
            style={{ borderColor: riskColorVar(risk ? risk.level : "elevated") }}
          >
            <div className="label-xs">Most vulnerable unit</div>
            <div className="num mt-0.5 text-sm font-semibold">{cleanId(siteAgg.worst.assetId)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {siteAgg.worst.damageMode} · {Math.round((siteAgg.worst.damageProbability ?? 0) * 100)}%
              damage probability · ${Math.round(siteAgg.worst.expectedLossUsd ?? 0).toLocaleString()}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Fragility estimate from the Aurora forecast at each unit (equipment class + current
            condition), aggregated across the site. Expand the site to inspect a single unit.
          </p>
        </Section>
      )}

      <Section title="Nearby exposed infrastructure">
        {nearby.length === 0 ? (
          <p className="text-xs text-muted-foreground">No other assets within 75 miles.</p>
        ) : (
          <ul className="space-y-1">
            {nearby.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => onSelect?.(n.id)}
                  className="flex w-full items-center justify-between rounded-sm px-1 py-1 text-left text-xs hover:bg-accent"
                >
                  <span>{n.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {ASSET_TYPE_LABEL[n.type]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
