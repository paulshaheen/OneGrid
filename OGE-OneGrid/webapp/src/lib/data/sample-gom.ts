// SAMPLE DATASET — synthetic Gulf of Mexico oil & gas estate.
// Isolated from production integrations: the mock service providers are the
// only consumers. Swapping in a real AssetService/WeatherService requires no
// UI changes.

import type { Asset, OpsAlert, WeatherEvent } from "@/lib/domain/types";

export const SAMPLE_DATASET_ID = "sample-gom-v1";

const OP_MERIDIAN = "Meridian Energy";
const OP_GULFSTAR = "Gulfstar Offshore";
const OP_DELTA = "Delta Petroleum";
const OP_COASTAL = "Coastal LNG Partners";
const operators: readonly string[] = [OP_MERIDIAN, OP_GULFSTAR, OP_DELTA, OP_COASTAL];

function well(
  id: string,
  name: string,
  lat: number,
  lon: number,
  region: string,
  operator: string,
): Asset {
  return {
    id,
    name,
    type: "well",
    lat,
    lon,
    operator,
    region,
    businessUnit: "Upstream",
    status: "producing",
    criticality: "standard",
    metadata: {
      water_depth_ft: 400 + ((Number(id.slice(-3)) * 137) % 4000),
      completion: "subsea tieback",
    },
  };
}

export const sampleAssets: Asset[] = [
  {
    id: "PLT-D7",
    name: "Platform Delta-7",
    type: "offshore_platform",
    lat: 27.62,
    lon: -90.35,
    operator: OP_MERIDIAN,
    region: "Central Gulf",
    businessUnit: "Deepwater Production",
    status: "producing",
    criticality: "business_critical",
    metadata: { design_wind_mph: 130, production_boepd: 92000, poB: 148, water_depth_ft: 5240 },
  },
  {
    id: "PLT-M4",
    name: "Platform Mercury-4",
    type: "offshore_platform",
    lat: 28.41,
    lon: -89.42,
    operator: OP_MERIDIAN,
    region: "Mississippi Canyon",
    businessUnit: "Deepwater Production",
    status: "producing",
    criticality: "business_critical",
    metadata: { design_wind_mph: 145, production_boepd: 61000, poB: 96, water_depth_ft: 4100 },
  },
  {
    id: "PLT-B2",
    name: "Facility Bravo-2",
    type: "offshore_platform",
    lat: 26.88,
    lon: -91.6,
    operator: OP_GULFSTAR,
    region: "Central Gulf",
    businessUnit: "Deepwater Production",
    status: "reduced",
    criticality: "important",
    metadata: { design_wind_mph: 120, production_boepd: 34000, poB: 58, water_depth_ft: 3300 },
  },
  {
    id: "PLT-A9",
    name: "Platform Atlas-9",
    type: "offshore_platform",
    lat: 28.05,
    lon: -92.4,
    operator: OP_GULFSTAR,
    region: "Western Gulf",
    businessUnit: "Shelf Production",
    status: "producing",
    criticality: "important",
    metadata: { design_wind_mph: 115, production_boepd: 18500, poB: 41, water_depth_ft: 620 },
  },
  {
    id: "PLT-K3",
    name: "Platform Kestrel-3",
    type: "offshore_platform",
    lat: 26.1,
    lon: -93.2,
    operator: OP_DELTA,
    region: "Western Gulf",
    businessUnit: "Shelf Production",
    status: "standby",
    criticality: "standard",
    metadata: { design_wind_mph: 110, production_boepd: 7200, poB: 22, water_depth_ft: 410 },
  },
  {
    id: "PLT-T1",
    name: "Platform Titan-1",
    type: "offshore_platform",
    lat: 27.05,
    lon: -88.7,
    operator: OP_MERIDIAN,
    region: "Eastern Gulf",
    businessUnit: "Deepwater Production",
    status: "producing",
    criticality: "business_critical",
    metadata: { design_wind_mph: 155, production_boepd: 110000, poB: 176, water_depth_ft: 6100 },
  },
  {
    id: "RIG-N5",
    name: "Drillship Nautilus-5",
    type: "offshore_platform",
    lat: 27.9,
    lon: -90.9,
    operator: OP_GULFSTAR,
    region: "Central Gulf",
    businessUnit: "Drilling",
    status: "producing",
    criticality: "important",
    metadata: { design_wind_mph: 100, poB: 132, operation: "riser running" },
  },
  {
    id: "REF-PA1",
    name: "Port Arthur Refinery",
    type: "refinery",
    lat: 29.87,
    lon: -93.93,
    operator: OP_DELTA,
    region: "Texas Coast",
    businessUnit: "Downstream",
    status: "producing",
    criticality: "business_critical",
    metadata: { capacity_bpd: 610000, flood_elevation_ft: 12 },
  },
  {
    id: "REF-BR2",
    name: "Baton Rouge Refinery",
    type: "refinery",
    lat: 30.48,
    lon: -91.19,
    operator: OP_DELTA,
    region: "Louisiana",
    businessUnit: "Downstream",
    status: "producing",
    criticality: "business_critical",
    metadata: { capacity_bpd: 502000, flood_elevation_ft: 22 },
  },
  {
    id: "LNG-SAB",
    name: "Sabine Pass LNG Terminal",
    type: "lng_terminal",
    lat: 29.74,
    lon: -93.87,
    operator: OP_COASTAL,
    region: "Texas Coast",
    businessUnit: "LNG",
    status: "producing",
    criticality: "business_critical",
    metadata: { trains: 6, storm_surge_design_ft: 18 },
  },
  {
    id: "LNG-CAM",
    name: "Cameron LNG Terminal",
    type: "lng_terminal",
    lat: 29.86,
    lon: -93.32,
    operator: OP_COASTAL,
    region: "Louisiana",
    businessUnit: "LNG",
    status: "producing",
    criticality: "business_critical",
    metadata: { trains: 3, storm_surge_design_ft: 16 },
  },
  {
    id: "STO-CLK",
    name: "Clovelly Storage Hub",
    type: "storage",
    lat: 29.48,
    lon: -90.29,
    operator: OP_MERIDIAN,
    region: "Louisiana",
    businessUnit: "Midstream",
    status: "producing",
    criticality: "important",
    metadata: { capacity_bbl: 10200000 },
  },
  {
    id: "POR-FOU",
    name: "Port Fourchon Base",
    type: "port",
    lat: 29.11,
    lon: -90.2,
    operator: OP_MERIDIAN,
    region: "Louisiana",
    businessUnit: "Logistics",
    status: "producing",
    criticality: "business_critical",
    metadata: { berths: 14, supply_vessels: 26 },
  },
  {
    id: "POR-GAL",
    name: "Galveston Marine Terminal",
    type: "port",
    lat: 29.31,
    lon: -94.79,
    operator: OP_GULFSTAR,
    region: "Texas Coast",
    businessUnit: "Logistics",
    status: "producing",
    criticality: "important",
    metadata: { berths: 8, supply_vessels: 11 },
  },
  {
    id: "PIP-GOM12",
    name: "Pipeline Segment GOM-12",
    type: "pipeline",
    lat: 28.35,
    lon: -90.5,
    geometry: [
      [-91.2, 27.4],
      [-90.8, 28.0],
      [-90.5, 28.6],
      [-90.3, 29.2],
    ],
    operator: OP_MERIDIAN,
    region: "Central Gulf",
    businessUnit: "Midstream",
    status: "producing",
    criticality: "business_critical",
    metadata: { diameter_in: 30, length_mi: 148, throughput_bpd: 420000 },
  },
  {
    id: "PIP-GOM04",
    name: "Pipeline Segment GOM-04",
    type: "pipeline",
    lat: 28.6,
    lon: -92.1,
    geometry: [
      [-92.9, 27.8],
      [-92.4, 28.4],
      [-92.0, 29.0],
      [-93.4, 29.6],
    ],
    operator: OP_GULFSTAR,
    region: "Western Gulf",
    businessUnit: "Midstream",
    status: "producing",
    criticality: "important",
    metadata: { diameter_in: 24, length_mi: 176, throughput_bpd: 210000 },
  },
  {
    id: "PIP-EAG7",
    name: "Pipeline Segment Eagle-7",
    type: "pipeline",
    lat: 29.6,
    lon: -91.6,
    geometry: [
      [-90.3, 29.3],
      [-91.4, 29.6],
      [-92.6, 29.8],
      [-93.9, 29.9],
    ],
    operator: OP_DELTA,
    region: "Louisiana",
    businessUnit: "Midstream",
    status: "producing",
    criticality: "important",
    metadata: { diameter_in: 36, length_mi: 232, throughput_bpd: 540000 },
  },
];

const WELL_NAMES = ["Marlin", "Cobia", "Tarpon", "Amberjack", "Wahoo", "Bonito"];

// A field of synthetic wells fills out the estate to a realistic count.
const wellSeeds: Array<[number, number]> = [];
// Deterministic spread across the offshore shelf and onshore Gulf Coast fields.
for (let i = 0; i < 169; i++) {
  const a = (i * 2.399963) % (Math.PI * 2);
  const rad = Math.sqrt((i % 43) / 43);
  const clusterIndex = i % 5;
  const clusters: Array<[number, number, number]> = [
    [27.6, -91.4, 1.6],
    [28.6, -88.9, 1.3],
    [27.2, -94.4, 1.5],
    [30.1, -95.4, 1.1],
    [30.5, -92.2, 1.0],
  ];
  const c = clusters[clusterIndex]!;
  wellSeeds.push([c[0] + Math.sin(a) * rad * c[2], c[1] + Math.cos(a) * rad * c[2] * 1.4]);
}
wellSeeds.forEach(([lat, lon], i) => {
  sampleAssets.push(
    well(
      `WEL-${String(i + 1).padStart(3, "0")}`,
      `Well ${WELL_NAMES[i % WELL_NAMES.length] ?? "Marlin"}-${i + 1}`,
      Number(lat.toFixed(3)),
      Number(lon.toFixed(3)),
      lon < -92 ? "Western Gulf" : lon < -89.5 ? "Central Gulf" : "Eastern Gulf",
      operators[i % operators.length] ?? OP_MERIDIAN,
    ),
  );
});

export const sampleEvent: WeatherEvent = {
  id: "AL072026",
  name: "Hurricane Gabrielle",
  kind: "hurricane",
  status: "Major hurricane — Category 3",
  basin: "Atlantic / Gulf of Mexico",
  currentCategory: 3,
  currentWindMph: 121,
  gustMph: 149,
  pressureMb: 954,
  movementDeg: 315,
  movementMph: 12,
  lat: 24.4,
  lon: -86.2,
  confidence: "high",
  modelSource: "Blended global forecast ensemble",
  updatedAtIso: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  expectedLandfall: "Central Louisiana coast, ~68 hours",
  history: [
    [-80.4, 20.1],
    [-82.1, 21.3],
    [-83.7, 22.4],
    [-85.0, 23.5],
    [-86.2, 24.4],
  ],
  forecast: [
    { hour: 0, lat: 24.4, lon: -86.2, windMph: 121, coneRadiusMi: 0, category: 3, pressureMb: 954 },
    {
      hour: 12,
      lat: 25.3,
      lon: -87.3,
      windMph: 127,
      coneRadiusMi: 42,
      category: 3,
      pressureMb: 949,
    },
    {
      hour: 24,
      lat: 26.2,
      lon: -88.4,
      windMph: 133,
      coneRadiusMi: 74,
      category: 4,
      pressureMb: 941,
    },
    {
      hour: 36,
      lat: 27.0,
      lon: -89.5,
      windMph: 138,
      coneRadiusMi: 104,
      category: 4,
      pressureMb: 936,
    },
    {
      hour: 48,
      lat: 27.9,
      lon: -90.4,
      windMph: 131,
      coneRadiusMi: 138,
      category: 4,
      pressureMb: 942,
    },
    {
      hour: 72,
      lat: 29.3,
      lon: -91.4,
      windMph: 112,
      coneRadiusMi: 196,
      category: 2,
      pressureMb: 958,
    },
    {
      hour: 96,
      lat: 30.6,
      lon: -92.1,
      windMph: 68,
      coneRadiusMi: 244,
      category: 0,
      pressureMb: 985,
    },
    {
      hour: 120,
      lat: 31.8,
      lon: -92.5,
      windMph: 40,
      coneRadiusMi: 288,
      category: 0,
      pressureMb: 999,
    },
  ],
};

const now = Date.now();
export const sampleAlerts: OpsAlert[] = [
  {
    id: "ALR-1041",
    title: "Platform Delta-7 entered high-risk storm corridor",
    detail:
      "Latest forecast places Delta-7 34 miles from the predicted centerline with 91 mph sustained winds at hour 29.",
    severity: "critical",
    assetId: "PLT-D7",
    eventId: "AL072026",
    status: "open",
    owner: "GoM Operations Duty Manager",
    createdAtIso: new Date(now - 22 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1040",
    title: "Pipeline Segment GOM-12 forecast for severe rainfall within 18 hours",
    detail:
      "Forecast rainfall of 8.4 in over the shore approach may affect right-of-way access and pigging schedule.",
    severity: "warning",
    assetId: "PIP-GOM12",
    eventId: "AL072026",
    status: "open",
    owner: "Midstream Integrity",
    createdAtIso: new Date(now - 64 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1039",
    title: "Wind forecast for Facility Bravo-2 exceeded configured threshold",
    detail:
      "Configured threshold 74 mph; forecast peak 88 mph at hour 41. Crane operations suspension recommended.",
    severity: "warning",
    assetId: "PLT-B2",
    eventId: "AL072026",
    status: "acknowledged",
    owner: "Offshore Marine Assurance",
    createdAtIso: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1038",
    title: "Hurricane track updated",
    detail: "Track shifted 21 miles west of the previous cycle; central Gulf exposure increased.",
    severity: "advisory",
    eventId: "AL072026",
    status: "open",
    owner: "Meteorology Watch",
    createdAtIso: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1037",
    title: "Port Fourchon Base staging capacity constrained",
    detail:
      "Evacuation demand modelling indicates berth saturation if more than four facilities de-man simultaneously.",
    severity: "advisory",
    assetId: "POR-FOU",
    status: "open",
    owner: "Logistics Control",
    createdAtIso: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1036",
    title: "Drillship Nautilus-5 riser disconnect decision window opens in 12 hours",
    detail: "Forecast sea state exceeds operating envelope from hour 34.",
    severity: "warning",
    assetId: "RIG-N5",
    eventId: "AL072026",
    status: "open",
    owner: "Drilling Superintendent",
    createdAtIso: new Date(now - 9 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "ALR-1035",
    title: "Sabine Pass LNG Terminal surge watch issued",
    detail: "Forecast surge 6.2 ft against 18 ft design; monitoring only at this time.",
    severity: "info",
    assetId: "LNG-SAB",
    status: "resolved",
    owner: "LNG Operations",
    createdAtIso: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Forecast uncertainty: ensemble spread and the previous cycle's centerline.
// Deterministic perturbations of the operational track — no randomness, so the
// picture is stable across renders and reproducible in demos.
// ---------------------------------------------------------------------------

sampleEvent.cycleId = "18Z cycle";

sampleEvent.ensemble = Array.from({ length: 14 }, (_, m) => {
  // Members fan out around the centerline, spread growing with lead time.
  const bias = (m - 6.5) / 6.5; // -1 … +1
  const speedBias = 1 + ((m % 5) - 2) * 0.055;
  return {
    id: `ENS-${String(m + 1).padStart(2, "0")}`,
    label: `Member ${m + 1}`,
    track: sampleEvent.forecast.map((p) => {
      const spread = Math.pow(p.hour / 120, 1.35);
      const lat = p.lat + bias * spread * 2.4 * 0.62 + Math.sin(bias * 3.1) * spread * 0.5;
      const lon = p.lon - bias * spread * 3.6 + Math.cos(bias * 2.2) * spread * 0.45;
      const drift = (speedBias - 1) * spread * 2.1;
      return [Number((lon + drift).toFixed(3)), Number((lat + drift * 0.4).toFixed(3))] as [
        number,
        number,
      ];
    }),
  };
});

// Previous cycle ran ~21 miles east and 6 mph weaker at peak.
sampleEvent.previousForecast = sampleEvent.forecast.map((p) => ({
  ...p,
  lat: Number((p.lat - (p.hour / 120) * 0.22).toFixed(3)),
  lon: Number((p.lon + (p.hour / 120) * 0.62).toFixed(3)),
  windMph: Math.max(35, Math.round(p.windMph - (p.hour >= 24 && p.hour <= 72 ? 7 : 2))),
  coneRadiusMi: Math.round(p.coneRadiusMi * 1.07),
}));

sampleEvent.cycleShift = {
  currentCycle: "18Z cycle",
  previousCycle: "12Z cycle",
  shiftMi: 24,
  shiftBearingDeg: 288,
  shiftDirection: "west-northwest",
  intensityDeltaMph: 7,
  coneDeltaMi: -13,
  summary:
    "The 48-hour position moved 24 miles west-northwest of the 12Z cycle, peak intensity increased 7 mph and the 72-hour cone tightened by 13 miles. Central Gulf exposure increased; eastern Gulf exposure eased.",
};
