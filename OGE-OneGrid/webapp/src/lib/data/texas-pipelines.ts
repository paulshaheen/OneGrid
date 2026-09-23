// Texas + Gulf Coast crude / gas / NGL distribution network for the OneRig
// (Oil & Gas) solution. Real-named corridors and hubs (Permian Basin -> Cushing
// and the Gulf Coast) with representative routing; node positions are approximate
// (public geography), not survey-grade. Each node carries SCADA-style sensors so
// the network view can drill into pressure / flow / temperature and asset health.

export type PipeStatus = "ok" | "watch" | "critical";
export type Product = "crude" | "gas" | "ngl";
export type NodeKind = "origin" | "pump" | "compressor" | "hub" | "storage" | "terminal" | "refinery";

export interface PipeSensor {
  label: string;
  value: number;
  unit: string;
  tag: string;
}

export interface PipeNode {
  id: string;
  name: string;
  kind: NodeKind;
  lon: number;
  lat: number;
  status: PipeStatus;
  /** Twin asset type for the drill-in (maps to a GLB via equipmentType). */
  assetType: "pipeline" | "storage" | "port" | "well" | "offshore_platform" | "refinery" | "pump" | "turbine";
  sensors: PipeSensor[];
  note?: string;
}

export interface PipeEdge {
  id: string;
  name: string;
  product: Product;
  from: string;
  to: string;
  /** Optional intermediate lon/lat waypoints so the corridor reads as a real route. */
  via?: Array<[number, number]>;
  status: PipeStatus;
  /** Nominal throughput label, e.g. "900 kbbl/d". */
  capacity: string;
}

/** Map viewport: Permian Basin (West TX) to Cushing OK and the Gulf Coast. */
export const TEXAS_GULF_VIEW = { minLon: -104.6, maxLon: -92.6, minLat: 26.7, maxLat: 36.6 };

/** Product palette (fixed hues; readable on dark + light). */
export const PRODUCT_COLOR: Record<Product, string> = {
  crude: "#f0a020",
  gas: "#3fb6ff",
  ngl: "#a986ff",
};

export const PRODUCT_LABEL: Record<Product, string> = {
  crude: "Crude oil",
  gas: "Natural gas",
  ngl: "NGL / Y-grade",
};

const S = (label: string, value: number, unit: string, tag: string): PipeSensor => ({ label, value, unit, tag });

export const PIPE_NODES: PipeNode[] = [
  // ── Permian Basin origins (West Texas) ──
  { id: "waha", name: "Waha Hub", kind: "hub", lon: -103.9, lat: 31.36, status: "ok", assetType: "storage",
    sensors: [S("Header pressure", 62, "bar", "WAHA.HDR_PRESS"), S("Gas throughput", 512, "MMcf/d", "WAHA.FLOW"), S("H₂S", 3.1, "ppm", "WAHA.H2S")], note: "West Texas gas gathering hub" },
  { id: "wink", name: "Wink Origin Station", kind: "origin", lon: -103.16, lat: 31.75, status: "ok", assetType: "well",
    sensors: [S("Header pressure", 48, "bar", "WINK.HDR_PRESS"), S("Crude throughput", 640, "kbbl/d", "WINK.FLOW"), S("BS&W", 0.4, "%", "WINK.BSW")], note: "Crude origin, Permian Delaware" },
  { id: "midland", name: "Midland Terminal", kind: "origin", lon: -102.08, lat: 31.99, status: "watch", assetType: "storage",
    sensors: [S("Tank farm level", 71, "%", "MID.TANK_LVL"), S("Crude throughput", 720, "kbbl/d", "MID.FLOW"), S("Vapor pressure", 8.4, "psi", "MID.RVP")], note: "Midland origin + storage" },
  { id: "coloradocity", name: "Colorado City Station", kind: "origin", lon: -100.86, lat: 32.39, status: "ok", assetType: "well",
    sensors: [S("Header pressure", 45, "bar", "CC.HDR_PRESS"), S("Crude throughput", 300, "kbbl/d", "CC.FLOW")], note: "BridgeTex / Basin origin" },

  // ── Pump / compressor stations along corridors ──
  { id: "mccamey", name: "McCamey Pump Station", kind: "pump", lon: -102.22, lat: 31.13, status: "ok", assetType: "pump",
    sensors: [S("Suction pressure", 12, "bar", "MCC.SUCT_PRESS"), S("Discharge pressure", 88, "bar", "MCC.DISCH_PRESS"), S("Flow", 610, "kbbl/d", "MCC.FLOW"), S("Bearing temp", 71, "°C", "MCC.BRG_TEMP")] },
  { id: "sheffield", name: "Sheffield Compressor", kind: "compressor", lon: -101.82, lat: 30.69, status: "ok", assetType: "turbine",
    sensors: [S("Suction pressure", 41, "bar", "SHF.SUCT_PRESS"), S("Discharge pressure", 96, "bar", "SHF.DISCH_PRESS"), S("Gas flow", 480, "MMcf/d", "SHF.FLOW"), S("Vibration", 4.2, "mm/s", "SHF.VIBR")] },
  { id: "threerivers", name: "Three Rivers Pump Station", kind: "pump", lon: -98.18, lat: 28.46, status: "critical", assetType: "pump",
    sensors: [S("Suction pressure", 9, "bar", "TR.SUCT_PRESS"), S("Discharge pressure", 62, "bar", "TR.DISCH_PRESS"), S("Flow", 540, "kbbl/d", "TR.FLOW"), S("Bearing temp", 96, "°C", "TR.BRG_TEMP")], note: "Bearing temperature exceedance" },
  { id: "refugio", name: "Refugio Pump Station", kind: "pump", lon: -97.28, lat: 28.30, status: "watch", assetType: "pump",
    sensors: [S("Suction pressure", 10, "bar", "REF.SUCT_PRESS"), S("Discharge pressure", 58, "bar", "REF.DISCH_PRESS"), S("Flow", 500, "kbbl/d", "REF.FLOW"), S("Seal leak", 1.2, "%", "REF.SEAL")] },
  { id: "sealy", name: "Sealy Compressor", kind: "compressor", lon: -96.16, lat: 29.78, status: "ok", assetType: "turbine",
    sensors: [S("Suction pressure", 38, "bar", "SEA.SUCT_PRESS"), S("Discharge pressure", 92, "bar", "SEA.DISCH_PRESS"), S("Gas flow", 610, "MMcf/d", "SEA.FLOW"), S("Vibration", 3.4, "mm/s", "SEA.VIBR")] },

  // ── Gas hub near Corpus ──
  { id: "aguadulce", name: "Agua Dulce Gas Hub", kind: "hub", lon: -97.9, lat: 27.78, status: "ok", assetType: "storage",
    sensors: [S("Header pressure", 58, "bar", "AD.HDR_PRESS"), S("Gas throughput", 1020, "MMcf/d", "AD.FLOW"), S("Line pack", 63, "%", "AD.PACK")], note: "South Texas gas hub" },

  // ── Gulf Coast terminals / storage / refineries ──
  { id: "corpus", name: "Corpus Christi Terminal", kind: "terminal", lon: -97.40, lat: 27.80, status: "ok", assetType: "port",
    sensors: [S("Line pressure", 24, "bar", "CRP.LINE_PRESS"), S("Loading rate", 62, "kbbl/h", "CRP.LOAD"), S("Tank level", 68, "%", "CRP.TANK_LVL")], note: "Crude export terminal (Ingleside)" },
  { id: "houston", name: "Houston Refining Complex", kind: "refinery", lon: -95.28, lat: 29.72, status: "watch", assetType: "refinery",
    sensors: [S("Crude charge", 410, "kbbl/d", "HOU.CHARGE"), S("CDU top pressure", 2.1, "bar", "HOU.CDU_PRESS"), S("Feed temp", 352, "°C", "HOU.FEED_TEMP")], note: "Houston Ship Channel refining" },
  { id: "montbelvieu", name: "Mont Belvieu NGL Storage", kind: "storage", lon: -94.89, lat: 29.85, status: "ok", assetType: "storage",
    sensors: [S("Cavern inventory", 74, "%", "MB.INV"), S("Fractionator flow", 380, "kbbl/d", "MB.FRAC_FLOW"), S("Sphere pressure", 11, "bar", "MB.SPH_PRESS")], note: "NGL salt-cavern + sphere storage" },
  { id: "nederland", name: "Nederland / Port Arthur Terminal", kind: "terminal", lon: -93.99, lat: 29.97, status: "ok", assetType: "port",
    sensors: [S("Line pressure", 22, "bar", "NED.LINE_PRESS"), S("Loading rate", 58, "kbbl/h", "NED.LOAD"), S("Tank level", 72, "%", "NED.TANK_LVL")], note: "Gulf export + storage" },
  { id: "katy", name: "Katy Delivery Point", kind: "hub", lon: -95.82, lat: 29.79, status: "ok", assetType: "storage",
    sensors: [S("Header pressure", 51, "bar", "KATY.HDR_PRESS"), S("Gas delivery", 720, "MMcf/d", "KATY.FLOW")], note: "Permian Highway gas delivery" },

  // ── Cushing (northbound) ──
  { id: "cushing", name: "Cushing Storage Hub", kind: "storage", lon: -96.77, lat: 35.98, status: "ok", assetType: "storage",
    sensors: [S("Tank farm inventory", 66, "%", "CUSH.INV"), S("Inbound flow", 430, "kbbl/d", "CUSH.IN_FLOW"), S("Vapor pressure", 7.9, "psi", "CUSH.RVP")], note: "\"Pipeline crossroads\" crude storage" },
];

export const PIPE_EDGES: PipeEdge[] = [
  // Crude — Permian to the Gulf Coast
  { id: "grayoak", name: "Gray Oak", product: "crude", from: "wink", to: "corpus", via: [[-100.5, 30.2], [-98.18, 28.46]], status: "critical", capacity: "900 kbbl/d" },
  { id: "cactus", name: "Cactus II", product: "crude", from: "midland", to: "corpus", via: [[-102.22, 31.13], [-99.2, 29.0], [-97.28, 28.30]], status: "watch", capacity: "670 kbbl/d" },
  { id: "epic", name: "EPIC Crude", product: "crude", from: "wink", to: "corpus", via: [[-101.0, 30.4], [-97.9, 27.9]], status: "ok", capacity: "600 kbbl/d" },
  { id: "winkwebster", name: "Wink-to-Webster", product: "crude", from: "wink", to: "houston", via: [[-102.08, 31.99], [-98.5, 30.6], [-95.82, 29.79]], status: "ok", capacity: "1500 kbbl/d" },
  { id: "bridgetex", name: "BridgeTex", product: "crude", from: "coloradocity", to: "houston", via: [[-98.9, 31.2], [-96.16, 29.78]], status: "ok", capacity: "440 kbbl/d" },
  { id: "basin", name: "Basin / Centurion", product: "crude", from: "wink", to: "cushing", via: [[-100.86, 32.39], [-98.5, 34.0]], status: "ok", capacity: "700 kbbl/d" },

  // Gas — Permian (Waha) to South Texas / Houston
  { id: "gcx", name: "Gulf Coast Express", product: "gas", from: "waha", to: "aguadulce", via: [[-101.82, 30.69], [-99.0, 28.6]], status: "ok", capacity: "2.0 Bcf/d" },
  { id: "whistler", name: "Whistler", product: "gas", from: "waha", to: "aguadulce", via: [[-100.5, 29.9], [-98.6, 28.2]], status: "ok", capacity: "2.5 Bcf/d" },
  { id: "phc", name: "Permian Highway", product: "gas", from: "waha", to: "katy", via: [[-100.2, 30.4], [-97.5, 30.1], [-96.16, 29.78]], status: "watch", capacity: "2.1 Bcf/d" },

  // NGL — Permian to Mont Belvieu
  { id: "ngl", name: "Grand Prix NGL", product: "ngl", from: "midland", to: "montbelvieu", via: [[-99.0, 30.6], [-95.82, 29.79]], status: "ok", capacity: "550 kbbl/d" },
];

/** Simplified Texas state outline (lon/lat) for basemap context. */
export const TEXAS_OUTLINE: Array<[number, number]> = [
  [-103.04, 36.50], [-100.00, 36.50], [-100.00, 34.56], [-99.20, 34.21], [-97.46, 33.85],
  [-96.00, 33.62], [-94.49, 33.64], [-94.04, 33.02], [-93.83, 31.60], [-93.53, 31.02],
  [-93.72, 30.05], [-94.10, 29.70], [-95.10, 29.10], [-96.40, 28.40], [-97.40, 27.80],
  [-97.15, 26.07], [-98.20, 26.06], [-99.10, 26.42], [-99.45, 27.27], [-100.40, 28.70],
  [-101.40, 29.79], [-102.30, 29.88], [-103.28, 29.00], [-104.53, 29.68], [-104.85, 30.62],
  [-106.53, 31.79], [-106.62, 32.00], [-103.06, 32.00], [-103.04, 36.50],
];
