import type { Feature, FeatureCollection, Polygon, Position } from "geojson";

const EARTH_MI = 3958.8;
const R = Math.PI / 180;

/** Great-circle destination point from an origin, bearing (deg) and distance (mi). */
export function destination(lon: number, lat: number, bearingDeg: number, miles: number): Position {
  const d = miles / EARTH_MI;
  const br = bearingDeg * R;
  const la1 = lat * R;
  const lo1 = lon * R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
  return [lo2 / R, la2 / R];
}

export function circlePolygon(lon: number, lat: number, miles: number, steps = 64): Polygon {
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) ring.push(destination(lon, lat, (i * 360) / steps, miles));
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * NHC-style asymmetric wind-radii polygon: NE, SE, SW, NW radii in miles.
 */
export function quadrantPolygon(lon: number, lat: number, quad: number[], steps = 16): Polygon {
  const [ne = 0, se = 0, sw = 0, nw = 0] = quad;
  // radii are defined per NHC quadrant (NE/SE/SW/NW); blend between them so the
  // envelope reads as a smooth asymmetric field rather than four hard blocks.
  const at = (bearing: number) => {
    const b = ((bearing % 360) + 360) % 360;
    const q = Math.floor(b / 90);
    const t = (b % 90) / 90;
    const order = [ne, se, sw, nw];
    const a = order[q] ?? 0;
    const c = order[(q + 1) % 4] ?? 0;
    const w = (1 - Math.cos(t * Math.PI)) / 2;
    return a + (c - a) * w;
  };
  const total = steps * 4;
  const ring: Position[] = [];
  for (let i = 0; i <= total; i++) {
    const bearing = (i * 360) / total;
    ring.push(destination(lon, lat, bearing, at(bearing)));
  }
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Forecast cone of uncertainty: circles of uncertainty swept along the track,
 * joined on the segment normals, with a rounded cap at the final position.
 */
export function conePolygon(points: { lon: number; lat: number; radiusMi: number }[]): Polygon {
  const pts = points.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (pts.length < 2) return { type: "Polygon", coordinates: [[]] };

  const left: Position[] = [];
  const right: Position[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = (next.lon - prev.lon) * Math.cos(pts[i]!.lat * R);
    const dy = next.lat - prev.lat;
    const bearing = (Math.atan2(dx, dy) / R + 360) % 360;
    const p = pts[i]!;
    const r = Math.max(p.radiusMi, 8);
    left.push(destination(p.lon, p.lat, bearing - 90, r));
    right.unshift(destination(p.lon, p.lat, bearing + 90, r));
  }

  // rounded cap at the terminal forecast position
  const last = pts[pts.length - 1]!;
  const lp = pts[pts.length - 2]!;
  const bx = (last.lon - lp.lon) * Math.cos(last.lat * R);
  const by = last.lat - lp.lat;
  const endBearing = (Math.atan2(bx, by) / R + 360) % 360;
  const cap: Position[] = [];
  for (let a = -90; a <= 90; a += 15) {
    cap.push(destination(last.lon, last.lat, endBearing + a, Math.max(last.radiusMi, 8)));
  }

  const ring = [...left, ...cap, ...right];
  ring.push(ring[0] as Position);
  return { type: "Polygon", coordinates: [ring] };
}

export function fc<P extends Record<string, unknown>>(
  features: Feature<never, P>[],
): FeatureCollection {
  return { type: "FeatureCollection", features: features as unknown as Feature[] };
}

export function feature(
  geometry: GeoJSON.Geometry,
  properties: Record<string, unknown> = {},
): Feature {
  return { type: "Feature", geometry, properties };
}

export function empty(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
