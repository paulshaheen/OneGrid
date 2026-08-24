// Lightweight equirectangular projection + Gulf of Mexico reference geometry.
// The renderer is deliberately provider-agnostic: an Azure Maps control can
// replace it without changing the layer model or the interaction contract.

export interface Viewport {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  width: number;
  height: number;
}

/** Full Gulf basin: Texas/Mexico coast to the Florida peninsula, Yucatán and western Cuba. */
export const GULF_VIEW: Omit<Viewport, "width" | "height"> = {
  minLon: -98.2,
  maxLon: -80.2,
  minLat: 21.2,
  maxLat: 31.4,
};

export function project(lon: number, lat: number, v: Viewport): [number, number] {
  const x = ((lon - v.minLon) / (v.maxLon - v.minLon)) * v.width;
  const y = ((v.maxLat - lat) / (v.maxLat - v.minLat)) * v.height;
  return [x, y];
}

export function unproject(x: number, y: number, v: Viewport): [number, number] {
  const lon = v.minLon + (x / v.width) * (v.maxLon - v.minLon);
  const lat = v.maxLat - (y / v.height) * (v.maxLat - v.minLat);
  return [lon, lat];
}

/** Miles → pixels at the viewport's mean latitude. */
export function milesToPx(miles: number, v: Viewport): number {
  const degPerMileLon = 1 / (69 * Math.cos((((v.minLat + v.maxLat) / 2) * Math.PI) / 180));
  return (miles * degPerMileLon * v.width) / (v.maxLon - v.minLon);
}

type Ring = Array<[number, number]>;

/**
 * Generalised shorelines (≈10 km tolerance) for the Gulf basin. Enough fidelity to
 * read as a real basemap at operational zoom levels without shipping a vector tile set.
 */
export const MAINLAND: Ring = [
  [-98.2, 31.4],
  [-98.2, 21.2],
  [-97.35, 21.2],
  [-97.35, 21.7],
  [-97.75, 22.3],
  [-97.78, 23.2],
  [-97.72, 24.0],
  [-97.55, 25.0],
  [-97.35, 25.9],
  [-97.2, 26.6],
  [-97.25, 27.3],
  [-97.2, 27.8],
  [-96.8, 28.2],
  [-96.0, 28.6],
  [-95.3, 28.9],
  [-94.75, 29.3],
  [-94.2, 29.5],
  [-93.8, 29.6],
  [-93.3, 29.76],
  [-92.6, 29.6],
  [-92.05, 29.55],
  [-91.4, 29.25],
  [-90.9, 29.15],
  [-90.3, 29.05],
  [-89.6, 28.95],
  [-89.1, 28.95],
  [-89.0, 29.4],
  [-89.35, 29.75],
  [-89.9, 30.15],
  [-88.9, 30.35],
  [-88.1, 30.35],
  [-87.4, 30.3],
  [-86.6, 30.4],
  [-85.7, 29.95],
  [-84.9, 29.7],
  [-84.35, 30.05],
  [-83.6, 29.9],
  [-83.0, 29.2],
  [-82.8, 28.9],
  [-82.7, 28.2],
  [-82.6, 27.7],
  [-82.4, 27.0],
  [-82.05, 26.6],
  [-81.8, 26.1],
  [-81.6, 25.85],
  [-81.15, 25.3],
  [-80.9, 25.15],
  [-80.4, 25.2],
  [-80.15, 25.8],
  [-80.1, 26.6],
  [-80.05, 27.5],
  [-80.5, 28.5],
  [-80.7, 29.0],
  [-81.3, 29.6],
  [-81.4, 30.4],
  [-81.5, 31.4],
];

export const YUCATAN: Ring = [
  [-91.4, 21.2],
  [-90.9, 21.5],
  [-90.5, 21.75],
  [-90.0, 21.85],
  [-89.3, 21.65],
  [-88.5, 21.55],
  [-87.8, 21.55],
  [-87.1, 21.45],
  [-86.75, 21.2],
];

export const CUBA: Ring = [
  [-84.95, 21.9],
  [-84.0, 22.15],
  [-83.2, 22.45],
  [-82.5, 22.95],
  [-81.8, 23.2],
  [-81.0, 23.15],
  [-80.2, 23.05],
  [-80.2, 22.55],
  [-81.2, 22.35],
  [-82.0, 22.15],
  [-83.0, 21.95],
  [-84.0, 21.78],
];

/** Approximate 200 m isobath — the continental shelf break that frames deepwater assets. */
export const SHELF_EDGE: Ring = [
  [-97.0, 25.9],
  [-96.4, 26.6],
  [-95.6, 27.4],
  [-94.6, 27.9],
  [-93.5, 28.2],
  [-92.4, 28.3],
  [-91.4, 28.3],
  [-90.4, 28.4],
  [-89.6, 28.6],
  [-89.0, 28.5],
  [-88.4, 29.0],
  [-87.4, 29.4],
  [-86.4, 29.6],
  [-85.6, 29.3],
  [-84.9, 28.7],
  [-84.3, 27.8],
  [-83.6, 26.6],
  [-82.9, 25.6],
];

export const ABYSSAL: Ring = [
  [-96.2, 24.2],
  [-95.0, 25.2],
  [-93.6, 26.2],
  [-92.0, 26.6],
  [-90.4, 26.8],
  [-89.0, 26.6],
  [-87.6, 26.2],
  [-86.2, 25.4],
  [-85.2, 24.4],
];

export interface PlaceLabel {
  name: string;
  lon: number;
  lat: number;
  /** Minimum zoom at which the label is drawn. */
  minZoom: number;
  kind: "city" | "water" | "region";
}

export const PLACES: PlaceLabel[] = [
  { name: "GULF OF MEXICO", lon: -90.2, lat: 25.2, minZoom: 0, kind: "water" },
  { name: "TEXAS", lon: -97.0, lat: 30.6, minZoom: 0, kind: "region" },
  { name: "LOUISIANA", lon: -92.3, lat: 30.9, minZoom: 0, kind: "region" },
  { name: "FLORIDA", lon: -81.7, lat: 28.4, minZoom: 0, kind: "region" },
  { name: "MEXICO", lon: -97.9, lat: 23.4, minZoom: 0, kind: "region" },
  { name: "CUBA", lon: -81.9, lat: 22.6, minZoom: 1.4, kind: "region" },
  { name: "YUCATÁN", lon: -89.4, lat: 21.35, minZoom: 1.4, kind: "region" },
  { name: "Houston", lon: -95.37, lat: 29.76, minZoom: 0, kind: "city" },
  { name: "New Orleans", lon: -90.07, lat: 29.95, minZoom: 0, kind: "city" },
  { name: "Corpus Christi", lon: -97.4, lat: 27.8, minZoom: 1.3, kind: "city" },
  { name: "Galveston", lon: -94.79, lat: 29.3, minZoom: 1.8, kind: "city" },
  { name: "Mobile", lon: -88.04, lat: 30.69, minZoom: 1.3, kind: "city" },
  { name: "Pensacola", lon: -87.22, lat: 30.42, minZoom: 1.8, kind: "city" },
  { name: "Tampa", lon: -82.46, lat: 27.95, minZoom: 1.3, kind: "city" },
  { name: "Tampico", lon: -97.86, lat: 22.25, minZoom: 1.8, kind: "city" },
  { name: "Havana", lon: -82.38, lat: 23.13, minZoom: 1.8, kind: "city" },
];

function ringPath(ring: Ring, v: Viewport): string {
  return ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat, v);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Filled landmass polygons (mainland closes through the northern map edge). */
export function landPaths(v: Viewport): string[] {
  const mainland = `${ringPath(MAINLAND, v)} L${v.width},0 L0,0 Z`;
  const yucatan = `${ringPath(YUCATAN, v)} L${v.width * 0.62},${v.height} L${v.width * 0.06},${v.height} Z`;
  const cuba = `${ringPath(CUBA, v)} Z`;
  return [mainland, yucatan, cuba];
}

/** Shoreline strokes only (no fill), used for the coast outline and surge layer. */
export function shorelinePaths(v: Viewport): string[] {
  return [ringPath(MAINLAND, v), ringPath(YUCATAN, v), `${ringPath(CUBA, v)} Z`];
}

export function polylinePath(ring: Ring, v: Viewport): string {
  return ringPath(ring, v);
}

/** Smooth bathymetry band between the shelf edge and the deep basin. */
export function bathymetryBand(v: Viewport): string {
  const shelf = SHELF_EDGE.map(([lon, lat]) => project(lon, lat, v));
  const deep = [...ABYSSAL].reverse().map(([lon, lat]) => project(lon, lat, v));
  const pts = [...shelf, ...deep];
  return `${pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} Z`;
}

/** Nice round distance for a scale bar, given the available pixel width. */
export function scaleBar(maxPx: number, v: Viewport, zoom: number) {
  const candidates = [25, 50, 100, 200, 300, 500];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const miles = candidates[i]!;
    const px = milesToPx(miles, v) * zoom;
    if (px <= maxPx) return { miles, px };
  }
  return { miles: 25, px: milesToPx(25, v) * zoom };
}
