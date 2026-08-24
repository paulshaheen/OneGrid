// Transparent risk engine. Every point contributed to a score is explainable.

import type { Asset, AssetRisk, ForecastPoint, RiskLevel, WeatherEvent } from "@/lib/domain/types";

const EARTH_MI = 3958.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export interface TrackProximity {
  distanceMi: number;
  hoursToImpact: number | null;
  nearest: ForecastPoint;
  insideCone: boolean;
}

/** Distance from an asset to the forecast centerline, interpolated between forecast points. */
export function trackProximity(asset: Asset, event: WeatherEvent, maxHour = 120): TrackProximity {
  let best: TrackProximity | null = null;
  const points = event.forecast.filter((p) => p.hour <= maxHour);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    const samples: Array<{ lat: number; lon: number; hour: number; base: ForecastPoint }> = [
      { lat: p.lat, lon: p.lon, hour: p.hour, base: p },
    ];
    if (next) {
      for (let t = 1; t < 6; t++) {
        const f = t / 6;
        samples.push({
          lat: p.lat + (next.lat - p.lat) * f,
          lon: p.lon + (next.lon - p.lon) * f,
          hour: p.hour + (next.hour - p.hour) * f,
          base: f < 0.5 ? p : next,
        });
      }
    }
    for (const s of samples) {
      const d = haversineMi(asset.lat, asset.lon, s.lat, s.lon);
      if (!best || d < best.distanceMi) {
        const cone = s.base.coneRadiusMi;
        best = {
          distanceMi: d,
          hoursToImpact: s.hour,
          nearest: { ...s.base, hour: Math.round(s.hour) },
          insideCone: d <= Math.max(cone, 25),
        };
      }
    }
  }
  return (
    best ?? {
      distanceMi: Number.POSITIVE_INFINITY,
      hoursToImpact: null,
      nearest: event.forecast[0]!,
      insideCone: false,
    }
  );
}

/** Forecast sustained wind at the asset, decaying radially from the storm core. */
export function forecastWindAt(distanceMi: number, coreWindMph: number): number {
  const eyewall = 30;
  if (distanceMi <= eyewall) return coreWindMph;
  const decay = Math.exp(-(distanceMi - eyewall) / 95);
  return Math.max(12, Math.round(coreWindMph * decay));
}

export function forecastRainfallAt(distanceMi: number, category: number): number {
  const base = 3 + category * 1.9;
  return Math.max(0.2, Number((base * Math.exp(-distanceMi / 180)).toFixed(1)));
}

export interface WindArrival {
  tsWindEtaH: number | null;
  hurWindEtaH: number | null;
  evacWindowH: number | null;
}

/** First forecast hour at which storm-force / hurricane-force winds reach an asset. */
export function windArrival(asset: Asset, event: WeatherEvent, maxHour = 120): WindArrival {
  const points = event.forecast.filter((p) => p.hour <= maxHour);
  let tsEta: number | null = null;
  let hurEta: number | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let t = 0; t <= 12; t++) {
      const f = t / 12;
      const lat = a.lat + (b.lat - a.lat) * f;
      const lon = a.lon + (b.lon - a.lon) * f;
      const core = a.windMph + (b.windMph - a.windMph) * f;
      const hour = a.hour + (b.hour - a.hour) * f;
      const w = forecastWindAt(haversineMi(asset.lat, asset.lon, lat, lon), core);
      if (tsEta === null && w >= 39) tsEta = hour;
      if (hurEta === null && w >= 74) hurEta = hour;
    }
  }
  return {
    tsWindEtaH: tsEta === null ? null : Math.round(tsEta),
    hurWindEtaH: hurEta === null ? null : Math.round(hurEta),
    evacWindowH: tsEta === null ? null : Math.max(0, Math.round(tsEta)),
  };
}

export function levelFromScore(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 62) return "high";
  if (score >= 42) return "elevated";
  if (score >= 22) return "monitor";
  return "normal";
}

const TYPE_SENSITIVITY: Record<Asset["type"], { points: number; note: string }> = {
  offshore_platform: {
    points: 8,
    note: "Offshore facility — crew evacuation and shut-in lead time required",
  },
  pipeline: {
    points: 5,
    note: "Subsea/onshore pipeline — scour, rainfall and right-of-way exposure",
  },
  lng_terminal: { points: 6, note: "LNG terminal — marine loading and storm surge sensitivity" },
  refinery: { points: 6, note: "Refinery — flooding and safe-shutdown lead time" },
  storage: { points: 4, note: "Storage facility — surge and access exposure" },
  port: {
    points: 5,
    note: "Port/logistics base — staging capacity is critical during evacuations",
  },
  well: { points: 2, note: "Wellhead — limited manned exposure" },
};

const CRITICALITY: Record<Asset["criticality"], { points: number; label: string }> = {
  business_critical: { points: 10, label: "Asset designated business-critical" },
  important: { points: 6, label: "Asset designated operationally important" },
  standard: { points: 2, label: "Asset designated standard criticality" },
};

export function scoreAsset(asset: Asset, event: WeatherEvent, horizonHours = 120): AssetRisk {
  const prox = trackProximity(asset, event, horizonHours);
  const wind = forecastWindAt(prox.distanceMi, prox.nearest.windMph);
  const rain = forecastRainfallAt(prox.distanceMi, prox.nearest.category);
  const factors = [];

  const distPoints = Math.round(Math.max(0, 26 * Math.exp(-prox.distanceMi / 70)));
  factors.push({
    label: "Storm proximity",
    detail: `${Math.round(prox.distanceMi)} miles from the predicted storm centerline`,
    points: distPoints,
  });

  const windPoints = Math.round(Math.min(24, Math.max(0, (wind - 50) / 3.7)));
  factors.push({
    label: "Forecast wind",
    detail: `${wind} mph sustained forecast at closest approach`,
    points: windPoints,
  });

  const rainPoints = Math.round(Math.min(8, rain * 0.9));
  factors.push({
    label: "Forecast rainfall",
    detail: `${rain} in forecast accumulation`,
    points: rainPoints,
  });

  const eta = prox.hoursToImpact;
  const etaPoints = eta === null ? 0 : Math.round(Math.max(0, 10 - eta / 12));
  factors.push({
    label: "Time to impact",
    detail:
      eta === null
        ? "No impact within the forecast horizon"
        : `Closest approach in ${Math.round(eta)} hours`,
    points: etaPoints,
  });

  const intensityPoints = prox.distanceMi > 220 ? 0 : Math.round(prox.nearest.category * 2);
  factors.push({
    label: "Storm intensity",
    detail: `${event.name} forecast at ${prox.nearest.category > 0 ? `Category ${prox.nearest.category}` : "tropical storm strength"} at closest approach`,
    points: intensityPoints,
  });

  const crit = CRITICALITY[asset.criticality];
  factors.push({ label: "Asset criticality", detail: crit.label, points: crit.points });

  const sens = TYPE_SENSITIVITY[asset.type];
  factors.push({ label: "Asset type sensitivity", detail: sens.note, points: sens.points });

  if (prox.insideCone) {
    factors.push({
      label: "Forecast cone",
      detail: "Asset lies inside the projected impact corridor",
      points: 6,
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const arrival = windArrival(asset, event, horizonHours);

  return {
    assetId: asset.id,
    score,
    level: levelFromScore(score),
    eventId: event.id,
    distanceMi: Math.round(prox.distanceMi),
    forecastWindMph: wind,
    rainfallIn: rain,
    hoursToImpact: eta === null ? null : Math.round(eta),
    tsWindEtaH: arrival.tsWindEtaH,
    hurWindEtaH: arrival.hurWindEtaH,
    evacWindowH: arrival.evacWindowH,
    insideCone: prox.insideCone,
    factors: factors.filter((f) => f.points > 0),
    recommendations: recommend(asset, wind, eta, prox.insideCone, rain),
  };
}

function recommend(
  asset: Asset,
  wind: number,
  eta: number | null,
  insideCone: boolean,
  rain: number,
): string[] {
  const out: string[] = [];
  const etaText = eta === null ? "the forecast horizon" : `${Math.round(eta)} hours`;
  if (asset.type === "offshore_platform") {
    if (wind >= 90)
      out.push(
        `Initiate non-essential personnel down-manning; full evacuation decision within ${etaText}.`,
      );
    else if (wind >= 60)
      out.push("Begin pre-storm secure checklist and suspend crane and helideck operations.");
    else out.push("Maintain normal operations; confirm weather-window reporting cadence.");
    if (wind >= 74)
      out.push("Prepare production shut-in sequence and confirm subsea isolation readiness.");
  }
  if (asset.type === "pipeline") {
    out.push(
      rain >= 5
        ? "Review right-of-way access and scour-prone crossings ahead of rainfall."
        : "Confirm pigging and inspection schedule against forecast window.",
    );
    if (wind >= 74) out.push("Coordinate throughput reduction with upstream shut-in plan.");
  }
  if (asset.type === "refinery" || asset.type === "storage") {
    out.push(
      rain >= 6
        ? "Activate flood-preparedness plan and verify drainage and berm readiness."
        : "Verify safe-shutdown lead time against forecast onset.",
    );
  }
  if (asset.type === "lng_terminal") {
    out.push("Review marine loading schedule and confirm vessel departure cut-off times.");
  }
  if (asset.type === "port") {
    out.push("Confirm evacuation staging capacity and vessel berth allocation priority.");
  }
  if (asset.type === "well") {
    out.push(
      wind >= 74
        ? "Confirm remote shut-in capability and subsea valve status."
        : "No action required; continue monitoring.",
    );
  }
  if (insideCone)
    out.push(
      "Include in the twice-daily incident management team review while inside the impact corridor.",
    );
  return out;
}
