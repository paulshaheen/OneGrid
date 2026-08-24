import { X } from "lucide-react";

import type { Asset, AssetRisk, WeatherEvent } from "@/lib/domain/types";
import { ASSET_TYPE_LABEL, STATUS_LABEL, coords, riskColorVar } from "@/lib/format";
import { nearbyAssets } from "@/lib/services/mock-providers";
import { RiskBadge } from "@/components/ops/RiskBadge";

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
