// Synthetic Southeast transmission network (Georgia + Alabama) for the OneGrid
// "Transmission Weather" view. Substations sit near real towns so the weather is
// real for those places, but every name, line and attribute is fictional — this is
// a realistic demo grid, not any utility's actual system.

export type Kv = 500 | 230 | 115;
export type AreaId = "atl" | "ngA" | "mga" | "cga" | "sga" | "nal" | "cal" | "sal";
export type ConductorId = "falcon" | "drake" | "linnet";

/** IEEE 738 inputs for one sub-conductor. Resistances are AC, ohm per metre. */
export interface Conductor {
  id: ConductorId;
  name: string;
  diameterM: number;
  r25: number;
  r75: number;
  /** Maximum operating temperature used for the normal rating (°C). */
  motC: number;
  absorptivity: number;
  emissivity: number;
}

export const CONDUCTORS: Record<ConductorId, Conductor> = {
  falcon: { id: "falcon", name: "1590 kcmil ACSR “Falcon”", diameterM: 0.03922, r25: 3.69e-5, r75: 4.35e-5, motC: 100, absorptivity: 0.8, emissivity: 0.8 },
  drake: { id: "drake", name: "795 kcmil ACSR “Drake”", diameterM: 0.02814, r25: 7.28e-5, r75: 8.68e-5, motC: 100, absorptivity: 0.8, emissivity: 0.8 },
  linnet: { id: "linnet", name: "336 kcmil ACSR “Linnet”", diameterM: 0.01831, r25: 1.727e-4, r75: 2.06e-4, motC: 75, absorptivity: 0.8, emissivity: 0.8 },
};

export interface Substation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kv: Kv;
  area: AreaId;
  kind: "plant" | "switching" | "load";
}

export interface ServiceArea {
  id: AreaId;
  name: string;
  state: "GA" | "AL";
  depot: { name: string; lat: number; lon: number };
  /** Transmission line crews based in the area. */
  crews: number;
}

export interface TxLine {
  id: string;
  name: string;
  from: string;
  to: string;
  kv: Kv;
  conductor: ConductorId;
  /** Sub-conductors per phase. */
  bundle: number;
  /** Tree-fall exposure of the corridor, 0 (cleared/urban) to 1 (dense pine/hardwood edge). */
  vegetation: number;
  /** Typical peak loading as a share of the static rating at 27 °C ambient. */
  baseLoadingPct: number;
  /** Loss of this line forces a contingency / load transfer. */
  critical: boolean;
  area: AreaId;
}

export const SERVICE_AREAS: ServiceArea[] = [
  { id: "atl", name: "Atlanta Metro", state: "GA", depot: { name: "Forest Park yard", lat: 33.62, lon: -84.37 }, crews: 14 },
  { id: "ngA", name: "North Georgia", state: "GA", depot: { name: "Cartersville yard", lat: 34.16, lon: -84.8 }, crews: 8 },
  { id: "mga", name: "Middle Georgia", state: "GA", depot: { name: "Macon yard", lat: 32.82, lon: -83.66 }, crews: 9 },
  { id: "cga", name: "Coastal Georgia", state: "GA", depot: { name: "Savannah yard", lat: 32.06, lon: -81.16 }, crews: 7 },
  { id: "sga", name: "Southwest Georgia", state: "GA", depot: { name: "Albany yard", lat: 31.56, lon: -84.2 }, crews: 6 },
  { id: "nal", name: "North Alabama", state: "AL", depot: { name: "Decatur yard", lat: 34.6, lon: -86.98 }, crews: 8 },
  { id: "cal", name: "Central Alabama", state: "AL", depot: { name: "Bessemer yard", lat: 33.4, lon: -86.95 }, crews: 11 },
  { id: "sal", name: "South Alabama & Gulf", state: "AL", depot: { name: "Theodore yard", lat: 30.56, lon: -88.17 }, crews: 7 },
];

export const SUBSTATIONS: Substation[] = [
  // Georgia
  { id: "ETW", name: "Etowah 500", lat: 34.17, lon: -84.8, kv: 500, area: "ngA", kind: "plant" },
  { id: "RMR", name: "Rome Ridge 230", lat: 34.26, lon: -85.16, kv: 230, area: "ngA", kind: "load" },
  { id: "DLT", name: "Dalton Mill 230", lat: 34.77, lon: -84.97, kv: 230, area: "ngA", kind: "load" },
  { id: "GNV", name: "Gainesville Lake 230", lat: 34.3, lon: -83.82, kv: 230, area: "ngA", kind: "load" },
  { id: "CHT", name: "Chattahoochee 500", lat: 33.95, lon: -84.45, kv: 500, area: "atl", kind: "switching" },
  { id: "PCH", name: "Peachtree 230", lat: 33.76, lon: -84.39, kv: 230, area: "atl", kind: "load" },
  { id: "STM", name: "Stone Mountain 230", lat: 33.8, lon: -84.15, kv: 230, area: "atl", kind: "load" },
  { id: "FYT", name: "Fayette 230", lat: 33.45, lon: -84.45, kv: 230, area: "atl", kind: "load" },
  { id: "OCN", name: "Oconee 500", lat: 33.45, lon: -83.28, kv: 500, area: "mga", kind: "plant" },
  { id: "AUG", name: "Augusta Sandhills 230", lat: 33.47, lon: -81.97, kv: 230, area: "cga", kind: "load" },
  { id: "OCM", name: "Ocmulgee 500", lat: 32.84, lon: -83.63, kv: 500, area: "mga", kind: "switching" },
  { id: "FLL", name: "Fall Line 230", lat: 32.46, lon: -84.99, kv: 230, area: "mga", kind: "load" },
  { id: "ALT", name: "Altamaha 500", lat: 31.93, lon: -82.34, kv: 500, area: "cga", kind: "plant" },
  { id: "SVB", name: "Savannah Bluff 230", lat: 32.08, lon: -81.09, kv: 230, area: "cga", kind: "load" },
  { id: "BRM", name: "Brunswick Marsh 230", lat: 31.15, lon: -81.49, kv: 230, area: "cga", kind: "load" },
  { id: "FLR", name: "Flint River 230", lat: 31.58, lon: -84.16, kv: 230, area: "sga", kind: "load" },
  { id: "VLP", name: "Valdosta Pines 115", lat: 30.83, lon: -83.28, kv: 115, area: "sga", kind: "load" },
  { id: "TFT", name: "Tifton Crossing 230", lat: 31.45, lon: -83.51, kv: 230, area: "sga", kind: "switching" },
  // Alabama
  { id: "CSA", name: "Coosa 500", lat: 34.01, lon: -86.01, kv: 500, area: "cal", kind: "switching" },
  { id: "TLP", name: "Tallapoosa 230", lat: 33.66, lon: -85.83, kv: 230, area: "cal", kind: "load" },
  { id: "VLC", name: "Vulcan 500", lat: 33.52, lon: -86.8, kv: 500, area: "cal", kind: "switching" },
  { id: "BWR", name: "Black Warrior 500", lat: 33.21, lon: -87.57, kv: 500, area: "cal", kind: "plant" },
  { id: "SHL", name: "Shoals 230", lat: 34.8, lon: -87.68, kv: 230, area: "nal", kind: "load" },
  { id: "RKC", name: "Rocket City 230", lat: 34.73, lon: -86.59, kv: 230, area: "nal", kind: "load" },
  { id: "GTV", name: "Guntersville 230", lat: 34.36, lon: -86.29, kv: 230, area: "nal", kind: "switching" },
  { id: "CAP", name: "Capitol 230", lat: 32.38, lon: -86.3, kv: 230, area: "cal", kind: "load" },
  { id: "LMT", name: "Lake Martin 230", lat: 32.69, lon: -85.91, kv: 230, area: "cal", kind: "plant" },
  { id: "SLP", name: "Selma Prairie 115", lat: 32.41, lon: -87.02, kv: 115, area: "cal", kind: "load" },
  { id: "WGR", name: "Wiregrass 230", lat: 31.22, lon: -85.39, kv: 230, area: "sal", kind: "load" },
  { id: "MBY", name: "Mobile Bay 500", lat: 30.69, lon: -88.04, kv: 500, area: "sal", kind: "plant" },
  { id: "BRT", name: "Brewton Timber 230", lat: 31.1, lon: -87.07, kv: 230, area: "sal", kind: "switching" },
];

const L = (
  from: string, to: string, kv: Kv, vegetation: number, baseLoadingPct: number, critical: boolean, area: AreaId,
): TxLine => {
  const conductor: ConductorId = kv === 500 ? "falcon" : kv === 230 ? "drake" : "linnet";
  const bundle = kv === 500 ? 3 : 1;
  const a = SUBSTATIONS.find((s) => s.id === from)!;
  const b = SUBSTATIONS.find((s) => s.id === to)!;
  return {
    id: `${from}-${to}-${kv}`,
    name: `${a.name.replace(/ \d+$/, "")} – ${b.name.replace(/ \d+$/, "")} ${kv} kV`,
    from, to, kv, conductor, bundle, vegetation, baseLoadingPct, critical, area,
  };
};

export const TX_LINES: TxLine[] = [
  // 500 kV backbone
  L("VLC", "CSA", 500, 0.55, 62, true, "cal"),
  L("CSA", "ETW", 500, 0.7, 58, true, "ngA"),
  L("ETW", "CHT", 500, 0.6, 71, true, "atl"),
  L("CHT", "OCN", 500, 0.65, 66, true, "atl"),
  L("OCN", "OCM", 500, 0.6, 59, true, "mga"),
  L("OCM", "ALT", 500, 0.72, 54, true, "mga"),
  L("VLC", "BWR", 500, 0.68, 63, true, "cal"),
  L("BWR", "MBY", 500, 0.82, 52, true, "sal"),
  L("VLC", "LMT", 500, 0.62, 48, false, "cal"),
  // Alabama 230 kV
  L("SHL", "RKC", 230, 0.45, 57, false, "nal"),
  L("RKC", "GTV", 230, 0.58, 61, false, "nal"),
  L("GTV", "CSA", 230, 0.66, 55, false, "nal"),
  L("SHL", "BWR", 230, 0.78, 44, false, "nal"),
  L("CSA", "TLP", 230, 0.6, 49, false, "cal"),
  L("TLP", "LMT", 230, 0.74, 46, false, "cal"),
  L("LMT", "CAP", 230, 0.55, 64, false, "cal"),
  L("CAP", "SLP", 115, 0.7, 68, false, "cal"),
  L("SLP", "BWR", 115, 0.76, 51, false, "cal"),
  L("CAP", "WGR", 230, 0.71, 58, false, "sal"),
  L("CAP", "BRT", 230, 0.8, 53, false, "sal"),
  L("BRT", "MBY", 230, 0.84, 60, true, "sal"),
  // Georgia 230 kV
  L("ETW", "RMR", 230, 0.69, 52, false, "ngA"),
  L("RMR", "DLT", 230, 0.73, 57, false, "ngA"),
  L("DLT", "GNV", 230, 0.81, 49, false, "ngA"),
  L("GNV", "CHT", 230, 0.63, 66, false, "atl"),
  L("CHT", "PCH", 230, 0.25, 78, true, "atl"),
  L("PCH", "STM", 230, 0.35, 74, false, "atl"),
  L("PCH", "FYT", 230, 0.42, 69, false, "atl"),
  L("STM", "OCN", 230, 0.67, 55, false, "atl"),
  L("TLP", "PCH", 230, 0.58, 72, true, "atl"),
  L("FYT", "FLL", 230, 0.7, 54, false, "mga"),
  L("FLL", "OCM", 230, 0.66, 48, false, "mga"),
  L("OCN", "AUG", 230, 0.75, 56, false, "cga"),
  L("AUG", "SVB", 230, 0.79, 50, false, "cga"),
  L("ALT", "SVB", 230, 0.77, 61, true, "cga"),
  L("SVB", "BRM", 230, 0.6, 57, false, "cga"),
  L("ALT", "TFT", 230, 0.74, 47, false, "sga"),
  L("TFT", "FLR", 230, 0.7, 52, false, "sga"),
  L("FLL", "FLR", 230, 0.72, 46, false, "sga"),
  L("TFT", "VLP", 115, 0.83, 63, false, "sga"),
  L("FLR", "WGR", 230, 0.76, 44, false, "sga"),
];

const SUB_BY_ID = new Map(SUBSTATIONS.map((s) => [s.id, s]));
export const substation = (id: string): Substation => SUB_BY_ID.get(id)!;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const EARTH_KM = 6371;
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Corridor polyline as [lon, lat] pairs: a gentle, deterministic meander between the
 * two substations so lines read like real right-of-way rather than straight rulers. */
export function linePath(line: TxLine): [number, number][] {
  const a = substation(line.from);
  const b = substation(line.to);
  const h = hash(line.id);
  const amp = 0.04 + ((h % 100) / 100) * 0.08;
  const phase = ((h >> 8) % 628) / 100;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = 8;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : amp * Math.sin(Math.PI * t) * Math.sin(phase + 2.3 * Math.PI * t);
    pts.push([a.lon + dx * t + nx * off, a.lat + dy * t + ny * off]);
  }
  return pts;
}

export interface SamplePoint {
  lat: number;
  lon: number;
  /** Bearing of the conductor at this point (degrees from north). */
  azimuthDeg: number;
  /** Corridor length this point represents (km). */
  km: number;
}

/** Points every ~`spacingKm` along the corridor, each carrying its local bearing. */
export function samplePoints(line: TxLine, spacingKm = 12): SamplePoint[] {
  const path = linePath(line);
  const out: SamplePoint[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [lon1, lat1] = path[i]!;
    const [lon2, lat2] = path[i + 1]!;
    const segKm = haversineKm(lat1, lon1, lat2, lon2);
    const steps = Math.max(1, Math.round(segKm / spacingKm));
    const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
    const x =
      Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
      Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
    const az = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      out.push({ lat: lat1 + (lat2 - lat1) * t, lon: lon1 + (lon2 - lon1) * t, azimuthDeg: az, km: segKm / steps });
    }
  }
  return out;
}

export function lineLengthKm(line: TxLine): number {
  return samplePoints(line).reduce((s, p) => s + p.km, 0);
}

/** Weather is fetched once per 0.25° cell (the GFS / Aurora grid spacing). */
export const cellKey = (lat: number, lon: number): string =>
  `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;

export function weatherCells(): { key: string; lat: number; lon: number }[] {
  const seen = new Map<string, { key: string; lat: number; lon: number }>();
  for (const line of TX_LINES) {
    for (const p of samplePoints(line)) {
      const key = cellKey(p.lat, p.lon);
      if (!seen.has(key)) {
        const [la, lo] = key.split(",").map(Number) as [number, number];
        seen.set(key, { key, lat: la, lon: lo });
      }
    }
  }
  return [...seen.values()];
}

/** Bounding box of the network (lon/lat), padded — also the Aurora corridor export box. */
export const NETWORK_BBOX = { minLon: -89, minLat: 30, maxLon: -80.5, maxLat: 35.5 };
