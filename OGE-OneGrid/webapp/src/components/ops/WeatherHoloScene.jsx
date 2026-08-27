import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";

import { conePolygon, destination, quadrantPolygon } from "../../lib/map/geojson";
import { NATION, STATES } from "../../report/three/usaGeo.js";
import { WORLD } from "../../report/three/worldGeo.js";

// ── US equirectangular projection (lon/lat → world X/Z) ──────────────────────
// Same vocabulary as the Control Room map (Facility.jsx): the whole continental
// US is projected so the full country is visible and you can orbit/zoom down to
// the Gulf where the storm sits. z runs north-negative (north = away from camera).
const LON0 = -95.5;
const LAT0 = 38.0;
const K = 2.8;
const COSLAT = Math.cos((LAT0 * Math.PI) / 180);
function project(lon, lat) {
  return [(lon - LON0) * K * COSLAT, -(lat - LAT0) * K];
}
// World units per statute mile (1° lat ≈ 69 mi) — keeps storm geometry sized in
// real distance regardless of the map scale K.
const UNITS_PER_MI = K / 69;

// Flat drape of a lon/lat ring onto a constant height, used for the storm track
// (which floats just above the water rather than following land topography).
function drape(seg, y) {
  return seg.map(([lo, la]) => {
    const [x, z] = project(lo, la);
    return [x, y, z];
  });
}

// Ray-cast point-in-polygon, for clipping terrain + city lights to the US outline.
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Metro seeds [lon, lat, weight] for scattering warm city lights across the map.
const CITY_METROS = [
  [-74, 40.7, 10],
  [-118.2, 34, 9],
  [-87.6, 41.8, 8],
  [-95.4, 29.8, 6],
  [-96.8, 32.8, 6],
  [-112, 33.4, 5],
  [-75.2, 40, 5],
  [-122.4, 37.8, 6],
  [-122.3, 47.6, 5],
  [-80.2, 25.8, 5],
  [-84.4, 33.7, 5],
  [-71.1, 42.4, 5],
  [-77, 38.9, 5],
  [-105, 39.7, 4],
  [-93.3, 45, 4],
  [-83, 42.3, 4],
  [-115.1, 36.2, 3],
  [-122.7, 45.5, 3],
  [-111.9, 40.8, 3],
  [-90.2, 38.6, 3],
  [-94.6, 39.1, 3],
  [-86.8, 36.2, 3],
  [-80.8, 35.2, 3],
  [-81.4, 28.5, 3],
  [-98.5, 29.4, 3],
  [-97.5, 35.5, 3],
  [-90.1, 29.95, 3],
  [-76.6, 39.3, 3],
  [-82.4, 27.9, 3],
];

// ── Colour tokens ────────────────────────────────────────────────────────────
// The design tokens are authored in oklch(); MapLibre and three.js both predate
// the oklch parser, so resolve the source CSS var and convert to sRGB rgb().
function oklchToRgb(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const srgb = lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(255, Math.max(0, g * 255)));
  });
  return `rgb(${srgb[0]}, ${srgb[1]}, ${srgb[2]})`;
}
const _tok = new Map();
function token(name, fallback) {
  if (typeof window === "undefined") return fallback;
  if (_tok.has(name)) return _tok.get(name);
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let out = fallback;
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(raw);
  if (m) out = oklchToRgb(parseFloat(m[1]) / (m[2] ? 100 : 1), parseFloat(m[3]), parseFloat(m[4]));
  else if (/^(#|rgb|hsl)/i.test(raw)) out = raw;
  _tok.set(name, out);
  return out;
}
function categoryColor(category, windMph) {
  if (category >= 5) return token("--cat5", "#f0abfc");
  if (category >= 4) return token("--cat4", "#f87171");
  if (category >= 3) return token("--cat3", "#fb923c");
  if (category >= 2) return token("--cat2", "#fbbf24");
  if (category >= 1) return token("--cat1", "#facc15");
  if (windMph >= 39) return token("--cat-ts", "#4ade80");
  return token("--cat-td", "#38bdf8");
}
function categoryLabel(category, windMph) {
  if (category >= 1) return `C${category}`;
  return windMph >= 39 ? "TS" : "TD";
}
const RISK_FALLBACK = {
  normal: "#64748b",
  monitor: "#38bdf8",
  elevated: "#fbbf24",
  high: "#fb7185",
  critical: "#f43f5e",
};
function riskColor(level) {
  const lv = level || "normal";
  return token(`--risk-${lv}`, RISK_FALLBACK[lv] || RISK_FALLBACK.normal);
}

// ── Storm playhead interpolation (matches GeoMap.interpolatePosition) ─────────
function interpolate(event, hour) {
  if (!event || !event.forecast || event.forecast.length === 0) return null;
  const f = event.forecast;
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i];
    const b = f[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const t = (hour - a.hour) / (b.hour - a.hour || 1);
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        windMph: Math.round(a.windMph + (b.windMph - a.windMph) * t),
        coneRadiusMi: a.coneRadiusMi + (b.coneRadiusMi - a.coneRadiusMi) * t,
        category: t < 0.5 ? a.category : b.category,
      };
    }
  }
  const last = f[f.length - 1];
  return { ...last };
}

// A soft radial sprite used for city-light-style particles (spiral bands).
const GLOW_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.35, "rgba(226,242,255,0.7)");
  rg.addColorStop(1, "rgba(180,215,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// A soft, feathered puff used for the storm's grey/white cloud particles.
const CLOUD_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,0.92)");
  rg.addColorStop(0.5, "rgba(233,238,246,0.42)");
  rg.addColorStop(1, "rgba(214,223,236,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// A swirled disk of grey/white cloud puffs with a clear eye — a hurricane seen
// from above. Denser/brighter near the eyewall, ragged at the outer bands.
function makeStormClouds(R, eyeR) {
  const N = 2400;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const arms = 5;
  for (let i = 0; i < N; i++) {
    const u = Math.random();
    const r = eyeR * 1.05 + (R - eyeR * 1.05) * Math.pow(u, 0.85);
    const arm = i % arms;
    const spread = (1 - r / R) * 0.6 + 0.35;
    const ang =
      (arm / arms) * Math.PI * 2 +
      (r / R) * 2.6 * Math.PI * 2 +
      (Math.random() - 0.5) * spread * Math.PI;
    pos[i * 3] = Math.cos(ang) * r;
    pos[i * 3 + 1] = 0.25 + (1 - r / R) * R * 0.16 + (Math.random() - 0.5) * 0.4;
    pos[i * 3 + 2] = Math.sin(ang) * r;
    const s = THREE.MathUtils.clamp(
      0.78 - (r / R) * 0.28 + (Math.random() - 0.5) * 0.12,
      0.42,
      0.8,
    );
    col[i * 3] = s;
    col[i * 3 + 1] = s;
    col[i * 3 + 2] = s * 1.05;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Build a flat (XZ-plane) filled polygon geometry from a lon/lat ring.
function flatPolyGeom(ring, y) {
  const shape = new THREE.Shape();
  ring.forEach(([lo, la], i) => {
    const [x, z] = project(lo, la);
    // negate z so, after rotateX(-90°), world-z lands back on +z (screen space)
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  if (y) g.translate(0, y, 0);
  return g;
}

// Robustly build the forecast cone as a triangle STRIP between its left/right
// edges (same offsets as geojson.conePolygon). ShapeGeometry/earcut on the swept
// cone polygon self-intersects when the track recurves, producing giant flashing
// spikes; a strip never does. Returns null if there aren't enough points.
const DEG = Math.PI / 180;
function buildConeStrip(pts, y) {
  const clean = pts.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (clean.length < 2) return null;
  const toWorld = ([lo, la]) => {
    const [x, z] = project(lo, la);
    return [x, y, z];
  };
  const left = [];
  const right = [];
  for (let i = 0; i < clean.length; i++) {
    const prev = clean[Math.max(0, i - 1)];
    const next = clean[Math.min(clean.length - 1, i + 1)];
    const dx = (next.lon - prev.lon) * Math.cos(clean[i].lat * DEG);
    const dy = next.lat - prev.lat;
    const bearing = (Math.atan2(dx, dy) / DEG + 360) % 360;
    const p = clean[i];
    const r = Math.max(p.radiusMi, 8);
    left.push(toWorld(destination(p.lon, p.lat, bearing - 90, r)));
    right.push(toWorld(destination(p.lon, p.lat, bearing + 90, r)));
  }
  const positions = [];
  for (let i = 0; i < clean.length - 1; i++) {
    const l0 = left[i];
    const r0 = right[i];
    const l1 = left[i + 1];
    const r1 = right[i + 1];
    positions.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

// HDR sun colour (multiplied past 1 so bloom turns it into a glowing sun).
const SUN_COLOR = new THREE.Color("#fff3d6").multiplyScalar(5);

// ── Star dome ────────────────────────────────────────────────────────────────
function StarField({ count = 3000, radius = 640, full = false }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      // full = uniform across the whole sphere (globe view); otherwise bias the
      // band downward toward the horizon (map view).
      const yFrac = full
        ? THREE.MathUtils.lerp(-1, 1, Math.random())
        : THREE.MathUtils.lerp(-0.4, 0.85, Math.pow(Math.random(), 1.8));
      const rXZ = radius * Math.sqrt(Math.max(0, 1 - yFrac * yFrac));
      pos[i * 3] = rXZ * Math.cos(theta);
      pos[i * 3 + 1] = radius * yFrac;
      pos[i * 3 + 2] = rXZ * Math.sin(theta);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [count, radius, full]);
  return (
    <points geometry={geo}>
      <pointsMaterial
        color="#e6edff"
        size={1.4}
        sizeAttenuation={false}
        fog={false}
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </points>
  );
}

// ── Textured US terrain (procedural topography, clipped to the coastline) ────
// Ported from the Control Room map (Facility.jsx SceneMap): a SimplexNoise
// heightfield draped with an elevation colour ramp, sea fragments discarded via
// a shader clip, scattered warm city lights, and neon borders that hug terrain.
function buildUSMap() {
  const poly = (NATION[0] || []).map(([lon, lat]) => {
    const [x, z] = project(lon, lat);
    return [x, z];
  });
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  poly.forEach(([x, z]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  });
  const w = maxX - minX + 8,
    d = maxZ - minZ + 8,
    cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  const simplex = new SimplexNoise();
  const seaY = -1.6,
    HS = 3.6;
  const heightAt = (wx, wz) => {
    if (!pointInPoly(wx, wz, poly)) return seaY;
    const n =
      simplex.noise(wx * 0.02, wz * 0.02) * 0.5 +
      simplex.noise(wx * 0.055, wz * 0.055) * 0.3 +
      simplex.noise(wx * 0.14, wz * 0.14) * 0.2;
    return Math.max(0.06, n + 0.5) * HS;
  };
  const NX = 220,
    NZ = Math.round((NX * d) / w);
  const geo = new THREE.PlaneGeometry(w, d, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const cols = [],
    alphas = [];
  const cLow = new THREE.Color("#0c2b46"),
    cMid = new THREE.Color("#12463a"),
    cHi = new THREE.Color("#3f5238"),
    cPeak = new THREE.Color("#6b6f63");
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i) + cx,
      wz = p.getZ(i) + cz;
    const h = heightAt(wx, wz);
    p.setY(i, h);
    let c;
    if (h <= seaY + 0.01) c = cLow;
    else {
      const e = h / HS;
      c = e < 0.4 ? cMid.clone().lerp(cHi, e / 0.4) : cHi.clone().lerp(cPeak, (e - 0.4) / 0.6);
    }
    cols.push(c.r, c.g, c.b);
    alphas.push(h > seaY + 0.01 ? 1 : 0);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alphas, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.1,
    roughness: 0.92,
    envMapIntensity: 0.4,
  });
  // Discard the sea (outside-US) fragments so only the US land floats over water.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "attribute float aAlpha;\nvarying float vAlpha;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vAlpha = aAlpha;",
      );
    shader.fragmentShader =
      "varying float vAlpha;\n" +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "  if (vAlpha < 0.5) discard;\n#include <dithering_fragment>",
      );
  };
  const terrain = new THREE.Mesh(geo, mat);
  terrain.position.set(cx, 0, cz);
  terrain.receiveShadow = true;

  // city lights
  const lp = [],
    lc = [];
  const warm = new THREE.Color("#ffe6b0"),
    cool = new THREE.Color("#bcd8ff");
  const addLight = (x, z) => {
    const c = warm.clone().lerp(cool, Math.random() * 0.5);
    const b = 0.6 + Math.random() * 0.7;
    lp.push(x, heightAt(x, z) + 0.28, z);
    lc.push(c.r * b, c.g * b, c.b * b);
  };
  CITY_METROS.forEach(([lon, lat, wt]) => {
    const [mx, mz] = project(lon, lat);
    const n = Math.round(wt * 16);
    for (let k = 0; k < n; k++) {
      const r = Math.random() ** 1.6 * wt * 0.9,
        a = Math.random() * Math.PI * 2;
      const x = mx + Math.cos(a) * r,
        z = mz + Math.sin(a) * r;
      if (pointInPoly(x, z, poly)) addLight(x, z);
    }
  });
  let tries = 0,
    added = 0;
  while (added < 650 && tries < 6000) {
    tries++;
    const x = minX + Math.random() * (maxX - minX),
      z = minZ + Math.random() * (maxZ - minZ);
    if (pointInPoly(x, z, poly)) {
      addLight(x, z);
      added++;
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
  cg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
  const cityLights = new THREE.Points(
    cg,
    new THREE.PointsMaterial({
      size: 0.6,
      map: GLOW_TEX,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    }),
  );

  // borders draped onto the terrain surface
  const drapeH = (ring, off) =>
    ring.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return [x, heightAt(x, z) + off, z];
    });
  const nationLine = drapeH(NATION[0], 0.25);
  const stateLines = STATES.map((r) => drapeH(r, 0.15));
  return { terrain, cityLights, nationLine, stateLines, heightAt };
}

// City lights twinkle by modulating point size, exactly like the Control Room map.
function CityLights({ points }) {
  const ref = useRef();
  useFrame((st) => {
    if (ref.current)
      ref.current.material.size = 0.6 * (0.82 + 0.22 * Math.sin(st.clock.elapsedTime * 3.2));
  });
  return <primitive ref={ref} object={points} />;
}

// ── Procedural hurricane: a spinning top of grey/white clouds with a clear eye ─
function Hurricane({ radius, eyeR }) {
  const spin = useRef();
  const eyeRatio = radius > 0 ? THREE.MathUtils.clamp(eyeR / radius, 0.05, 0.45) : 0.14;
  // Generate the cloud once in unit space and scale it to the storm size — so
  // intensity changes just resize it, with no per-frame regeneration (which made
  // the puffs shimmer/jump and looked low-framerate).
  const clouds = useMemo(() => makeStormClouds(1, 0.14), []);
  useEffect(() => () => clouds.dispose(), [clouds]);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += (dt || 0.016) * 1.15;
  });
  return (
    <group scale={radius}>
      {/* dark eye at the centre of the swirl */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.12, 0]} renderOrder={22}>
        <circleGeometry args={[eyeRatio, 32]} />
        <meshBasicMaterial
          color="#141b24"
          transparent
          opacity={0.5}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      {/* spinning cloud mass — soft grey/white puffs, lit like real cloud, not neon */}
      <points ref={spin} geometry={clouds} renderOrder={23}>
        <pointsMaterial
          map={CLOUD_TEX}
          size={Math.max(0.9, radius * 0.34)}
          vertexColors
          transparent
          opacity={0.92}
          depthWrite={false}
          depthTest={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// ── 3D wind swirl: tangential streaks circulating cyclonically around the eye ─
// Streaks sit in a shallow bowl (higher near the centre) and rotate with the
// inner streaks faster than the outer ones, so the field reads as real 3D wind
// shear. Used for every storm (it is the primary visual for the non-tropical
// windstorm, which has no cloud vortex).
function WindSwirl({ radius, windMph, color = "#a9d8ff" }) {
  const N = 520;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    return g;
  }, []);
  // Particles are generated ONCE in unit space; the group is then scaled to the
  // storm size. Previously `data` depended on `radius`, which changes every tick,
  // so all streaks teleported to new random spots each frame → strobing/flashing.
  const data = useMemo(() => {
    const rs = new Float32Array(N);
    const ang = new Float32Array(N);
    const ys = new Float32Array(N);
    const hl = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      rs[i] = 0.14 + 0.86 * Math.sqrt(Math.random());
      ang[i] = Math.random() * Math.PI * 2;
      ys[i] = 0.06 + (1 - rs[i]) * 0.12 + Math.random() * 0.04;
      hl[i] = 0.1 + Math.random() * 0.1; // angular half-length of the streak
    }
    return { rs, ang, ys, hl };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    const d = Math.min(dt || 0.016, 0.05);
    const posArr = geo.attributes.position.array;
    const spd = windMph / 130;
    for (let i = 0; i < N; i++) {
      const r = data.rs[i];
      // cyclonic (counter-clockwise) circulation, inner streaks faster (~1/r)
      data.ang[i] += d * spd * (0.8 / (r + 0.12));
      const a1 = data.ang[i] - data.hl[i];
      const a2 = data.ang[i] + data.hl[i];
      const y = data.ys[i];
      const k = i * 6;
      posArr[k] = Math.cos(a1) * r;
      posArr[k + 1] = y;
      posArr[k + 2] = Math.sin(a1) * r;
      posArr[k + 3] = Math.cos(a2) * r;
      posArr[k + 4] = y;
      posArr[k + 5] = Math.sin(a2) * r;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return (
    <group scale={radius}>
      <lineSegments geometry={geo} renderOrder={16}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.32}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

// ── Full storm layer: history, forecast track, animated cone, wind field ─────
function StormLayer({ event, hour }) {
  const pos = useMemo(() => interpolate(event, hour), [event, hour]);
  const bucket = Math.round(hour);

  const history = useMemo(() => {
    const h = (event?.history ?? []).filter((c) => Array.isArray(c) && c.length === 2);
    return h.length >= 2 ? drape(h, 0.3) : null;
  }, [event]);

  const forecastSegs = useMemo(() => {
    const f = event?.forecast ?? [];
    const segs = [];
    for (let i = 0; i < f.length - 1; i++) {
      const a = f[i];
      const b = f[i + 1];
      segs.push({
        points: [drape([[a.lon, a.lat]], 0.34)[0], drape([[b.lon, b.lat]], 0.34)[0]],
        color: categoryColor(Math.max(a.category, b.category), Math.max(a.windMph, b.windMph)),
      });
    }
    return segs;
  }, [event]);

  const forecastPins = useMemo(() => event?.forecast ?? [], [event]);

  // Cone swept up to the playhead — rebuilt ~once per forecast hour and disposed.
  const coneGeom = useMemo(() => {
    const f = event?.forecast ?? [];
    if (f.length < 2 || hour <= f[0].hour) return null;
    const pts = f
      .filter((p) => p.hour <= hour)
      .map((p) => ({ lon: p.lon, lat: p.lat, radiusMi: p.coneRadiusMi }));
    if (pos) pts.push({ lon: pos.lon, lat: pos.lat, radiusMi: pos.coneRadiusMi });
    if (pts.length < 2) return null;
    return buildConeStrip(pts, 0.22);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, hour]);
  useEffect(() => () => coneGeom?.dispose(), [coneGeom]);

  const coneOutline = useMemo(() => {
    const f = event?.forecast ?? [];
    if (f.length < 2 || hour <= f[0].hour) return null;
    const pts = f
      .filter((p) => p.hour <= hour)
      .map((p) => ({ lon: p.lon, lat: p.lat, radiusMi: p.coneRadiusMi }));
    if (pos) pts.push({ lon: pos.lon, lat: pos.lat, radiusMi: pos.coneRadiusMi });
    if (pts.length < 2) return null;
    const ring = conePolygon(pts).coordinates?.[0] ?? [];
    return ring.length >= 3
      ? ring.map(([lo, la]) => {
          const [x, z] = project(lo, la);
          return [x, 0.24, z];
        })
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, hour]);

  // Outer extent of the 3D wind swirl (world units), scaled from the storm's
  // sustained wind — the wind field grows with intensity and reaches beyond the
  // eyewall clouds.
  const windRadius = pos ? Math.max(4, 175 * (pos.windMph / 120)) * UNITS_PER_MI : 0;

  if (!event) return null;
  const eye = pos ? project(pos.lon, pos.lat) : null;
  // Only tropical systems get the cloud vortex; a non-tropical windstorm shows
  // just its track, cone and wind field (no eye).
  const tropical = event.kind === "hurricane" || event.kind === "tropical_storm";
  // Size the vortex in real miles so it stays proportional to the map scale.
  const vortexR = pos
    ? THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(pos.windMph, 30, 160, 90, 190), 80, 210) *
      UNITS_PER_MI
    : 0;
  const vortexEyeR = pos
    ? THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(pos.windMph, 30, 160, 26, 12), 10, 28) *
      UNITS_PER_MI
    : 0;

  return (
    <group>
      {history && (
        <Line
          points={history}
          color="#7f93ad"
          lineWidth={1.4}
          transparent
          opacity={0.5}
          dashed
          dashSize={1.4}
          gapSize={0.9}
          depthTest={false}
          renderOrder={20}
        />
      )}
      {forecastSegs.map((s, i) => (
        <Line
          key={`fs${i}`}
          points={s.points}
          color={s.color}
          lineWidth={2.6}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={21}
        />
      ))}

      {coneGeom && (
        <mesh geometry={coneGeom} renderOrder={19}>
          <meshBasicMaterial
            color={token("--cone", "#7aa7ff")}
            transparent
            opacity={0.16}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      )}
      {coneOutline && (
        <Line
          points={coneOutline}
          color={token("--cone", "#7aa7ff")}
          lineWidth={1.4}
          transparent
          opacity={0.6}
          depthTest={false}
          renderOrder={20}
        />
      )}

      {eye && (
        <group position={[eye[0], 0.5, eye[1]]}>
          <WindSwirl radius={windRadius} windMph={pos.windMph} />
        </group>
      )}
      {eye && tropical && (
        <group position={[eye[0], 0.4, eye[1]]}>
          <Hurricane radius={vortexR} eyeR={vortexEyeR} />
        </group>
      )}
    </group>
  );
}

// ── Asset pin ────────────────────────────────────────────────────────────────
// Persistent labels are limited to the big fixed landmarks (plus selected /
// hovered), mirroring the 2D map, which only labels major infrastructure and
// collision-hides the rest. Numerous offshore platforms stay unlabelled until
// you hover or select them, so the scene doesn't drown in text.
const LABEL_TYPES = new Set(["refinery", "lng_terminal", "port"]);
// Types that warrant a full 3D pin. Everything else (the ~169 synthetic wells,
// pipelines) renders as a small flat dot so the Gulf field reads like the 2D
// map's dot scatter instead of a forest of pins.
const MAJOR_SET = new Set(["refinery", "lng_terminal", "port", "storage", "offshore_platform"]);
function AssetPin({ asset, level, selected, hovered, onSelect, onHover, heightAt }) {
  const g = useRef();
  const ring = useRef();
  const color = riskColor(level);
  const hot = level === "high" || level === "critical";
  const [x, z] = project(asset.lon, asset.lat);
  // Onshore assets sit on the terrain; offshore assets rest just above the water.
  const baseY = heightAt ? Math.max(0.05, heightAt(x, z)) : 0;
  useFrame((st) => {
    if (g.current) {
      const t = selected ? 1.25 : hovered ? 1.12 : 1;
      g.current.scale.setScalar(THREE.MathUtils.lerp(g.current.scale.x, t, 0.14));
    }
    if (ring.current && hot) {
      const p = (st.clock.elapsedTime * 1.4) % 1;
      ring.current.scale.setScalar(1 + p * 1.6);
      ring.current.material.opacity = 0.7 * (1 - p);
    }
  });
  return (
    <group position={[x, baseY, z]}>
      <mesh
        position={[0, 1.6, 0]}
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(asset.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          onSelect?.(asset.id);
        }}
      >
        <boxGeometry args={[3, 4, 3]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.9, 1.15, 32]} />
        <meshBasicMaterial color={color} transparent opacity={hot ? 0.8 : 0.4} toneMapped={false} />
      </mesh>
      {hot && (
        <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.07, 0]}>
          <ringGeometry args={[1.05, 1.25, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      )}
      <group ref={g}>
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 1.8, 10]} />
          <meshStandardMaterial color="#5a6678" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2, 0]}>
          <sphereGeometry args={[0.42, 20, 20]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={hot ? 1.5 : 0.6}
            toneMapped={false}
          />
        </mesh>
        {(selected || hot) && (
          <pointLight
            position={[0, 2, 0]}
            color={color}
            intensity={hot ? 5 : 3}
            distance={16}
            decay={2}
          />
        )}
      </group>
    </group>
  );
}

// ── Minor asset (well / pipeline): a small, static, low-profile dot ──────────
// No tall pin, ring pulse or per-frame work — there are ~170 of these, so they
// stay lightweight and unobtrusive, matching the flat well dots on the 2D map.
// Selecting one (from the map or the sidebar list) pops it and shows its label.
function WellMarker({ asset, level, selected, hovered, onSelect, onHover, heightAt }) {
  const color = riskColor(level);
  const [x, z] = project(asset.lon, asset.lat);
  const baseY = heightAt ? Math.max(0.05, heightAt(x, z)) : 0;
  const s = selected ? 1.9 : hovered ? 1.4 : 1;
  return (
    <group position={[x, baseY + 0.16, z]}>
      <mesh
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(asset.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          onSelect?.(asset.id);
        }}
      >
        <sphereGeometry args={[0.7, 8, 8]} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.15 * s, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1.4 : 0.45}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.15, 0]}>
        <ringGeometry args={[0.22 * s, 0.32 * s, 18]} />
        <meshBasicMaterial color={color} transparent opacity={0.38} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── Camera: intro sweep, click-to-zoom on assets, click-to-recenter on the map ─
function CameraRig({ focus, focusKey, recenter, recenterKey, entry }) {
  const controls = useRef();
  const { camera } = useThree();
  // If we drilled in from the globe, frame the chosen storm region; otherwise do
  // the establishing whole-US sweep.
  const anim = useRef(
    entry
      ? {
          active: true,
          elapsed: 0,
          dur: 1.8,
          fromPos: new THREE.Vector3(entry[0] - 30, 210, entry[2] + 190),
          toPos: new THREE.Vector3(entry[0], 96, entry[2] + 120),
          fromTgt: new THREE.Vector3(entry[0], 4, entry[2]),
          toTgt: new THREE.Vector3(entry[0], 4, entry[2]),
        }
      : {
          active: true,
          elapsed: 0,
          dur: 2.6,
          fromPos: new THREE.Vector3(-70, 220, 260),
          toPos: new THREE.Vector3(0, 140, 185),
          fromTgt: new THREE.Vector3(0, 2, 6),
          toTgt: new THREE.Vector3(0, 2, 6),
        },
  );
  // Set the initial orbit pivot once (no `target` prop, so re-renders can't reset
  // the pivot the user has moved by clicking/panning).
  useEffect(() => {
    controls.current?.target.copy(anim.current.toTgt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The instant the user grabs the camera, stop the current auto-move.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => (anim.current.active = false);
    c.addEventListener("start", onStart);
    return () => c.removeEventListener("start", onStart);
  }, []);
  // Click an asset → fly in very close to it, keeping the view direction. Never
  // zooms out: if you're already closer than the target distance, it stays put.
  useEffect(() => {
    if (!focus) return;
    const c = controls.current;
    if (!c) return;
    const f = new THREE.Vector3(focus[0], focus[1] + 2, focus[2]);
    const dir = camera.position.clone().sub(c.target);
    dir.y = Math.max(dir.y, 26); // keep looking down at the target, not up from below
    dir.normalize();
    const curDist = camera.position.distanceTo(c.target);
    const dist = Math.min(curDist, 34); // close-in distance; don't pull back out
    const a = anim.current;
    a.fromPos.copy(camera.position);
    a.toPos.copy(f).add(dir.multiplyScalar(dist));
    a.fromTgt.copy(c.target);
    a.toTgt.copy(f);
    a.elapsed = 0;
    a.dur = 1.1;
    a.active = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  // Click empty map → make that point the new orbit pivot, gliding the camera by
  // the same offset (a re-centre pan) without changing distance or angle. Then
  // dragging rotates around the clicked point.
  useEffect(() => {
    if (!recenter) return;
    const c = controls.current;
    if (!c) return;
    const p = new THREE.Vector3(recenter[0], recenter[1], recenter[2]);
    const delta = p.clone().sub(c.target);
    const a = anim.current;
    a.fromPos.copy(camera.position);
    a.toPos.copy(camera.position).add(delta);
    a.fromTgt.copy(c.target);
    a.toTgt.copy(p);
    a.elapsed = 0;
    a.dur = 0.7;
    a.active = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a.active) {
      a.elapsed += Math.min(dt, 1 / 30);
      const t = Math.min(1, a.elapsed / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(a.fromPos, a.toPos, e);
      c.target.lerpVectors(a.fromTgt, a.toTgt, e);
      if (t >= 1) a.active = false;
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping
      dampingFactor={0.08}
      panSpeed={1.1}
      rotateSpeed={0.9}
      screenSpacePanning={false}
      minDistance={20}
      maxDistance={520}
      maxPolarAngle={Math.PI / 2.15}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}

// ── Label declutter ──────────────────────────────────────────────────────────
// Each label is a per-anchor drei <Html>, so drei keeps it glued to its 3D point
// every frame (robust across pan/rotate/zoom/resize). We only compute the
// vertical stacking OFFSET here and apply it as a CSS transform, with a leader
// line back down to the anchor.
function SmartLabels({ items }) {
  const { camera, size } = useThree();
  const vec = useMemo(() => new THREE.Vector3(), []);
  const nodes = useRef(new Map());
  const setRef = (id, key, el) => {
    let n = nodes.current.get(id);
    if (!n) {
      n = {};
      nodes.current.set(id, n);
    }
    n[key] = el;
  };
  useFrame(() => {
    camera.updateMatrixWorld();
    const proj = items.map((it) => {
      vec.set(it.world[0], it.world[1], it.world[2]).project(camera);
      return { id: it.id, sy: (-vec.y * 0.5 + 0.5) * size.height, behind: vec.z > 1 };
    });
    proj.sort((a, b) => b.sy - a.sy);
    const gap = 22;
    const rise = 34;
    let last = Infinity;
    for (const pr of proj) {
      const n = nodes.current.get(pr.id);
      if (!n || !n.chip) continue;
      if (n.wrap) n.wrap.style.opacity = pr.behind ? "0" : "1";
      if (pr.behind) continue;
      let top = pr.sy - rise;
      if (top > last - gap) top = last - gap;
      top = Math.max(top, 6);
      last = top;
      const off = Math.min(pr.sy - top, 220);
      n.chip.style.transform = `translate(-50%, calc(-100% - ${off}px))`;
      if (n.leader) {
        n.leader.style.top = `${-off}px`;
        n.leader.style.height = `${Math.max(0, off)}px`;
      }
    }
  });
  return items.map((it) => {
    const storm = it.storm;
    return (
      <Html key={it.id} position={it.world} zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
        <div
          ref={(el) => setRef(it.id, "wrap", el)}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <div
            ref={(el) => setRef(it.id, "leader", el)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 1,
              height: 0,
              background: "rgba(205, 216, 232, 0.32)",
            }}
          />
          <div
            ref={(el) => setRef(it.id, "chip", el)}
            className={
              storm
                ? "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-bold tracking-wide uppercase"
                : "whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold"
            }
            style={
              storm
                ? {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    background: "rgba(4,8,14,.92)",
                    color: it.color,
                    border: `1.5px solid ${it.color}`,
                    boxShadow: `0 0 16px ${it.color}66`,
                  }
                : {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    background: "rgba(6,12,20,.85)",
                    color: it.sel ? it.color : "#dce4ef",
                    border: `1px solid ${it.color}${it.sel ? "aa" : "55"}`,
                  }
            }
          >
            {storm && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "9999px",
                  background: it.color,
                  boxShadow: `0 0 8px ${it.color}`,
                }}
              />
            )}
            {it.text}
          </div>
        </div>
      </Html>
    );
  });
}

// ── Level-0 globe: a rotating hemisphere with storm hotspots to drill into ───
// Reuses the Control Room globe vocabulary (graticule + world coastlines +
// highlighted US). Clicking a storm hotspot flies down into the regional map.
function lonLatToVec3(lon, lat, r) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}
function buildGraticule(r) {
  const pts = [];
  for (let lat = -80; lat <= 80; lat += 20) {
    let prev = null;
    for (let lon = -180; lon <= 180; lon += 6) {
      const v = lonLatToVec3(lon, lat, r);
      if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
      prev = v;
    }
  }
  for (let lon = -180; lon < 180; lon += 20) {
    let prev = null;
    for (let lat = -90; lat <= 90; lat += 6) {
      const v = lonLatToVec3(lon, lat, r);
      if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
      prev = v;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
function buildGlobeLines(r, rings) {
  const pts = [];
  for (const ring of rings) {
    let prev = null;
    for (const [lon, lat] of ring) {
      const v = lonLatToVec3(lon, lat, r);
      if (prev) pts.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
      prev = v;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function PanelHotspot({ x, y, z, color, label, sub, onEnter }) {
  const pulse = useRef();
  const [hover, setHover] = useState(false);
  useFrame((st) => {
    if (pulse.current) {
      const t = (st.clock.elapsedTime * 0.9) % 1;
      pulse.current.scale.setScalar(1 + t * 2.2);
      pulse.current.material.opacity = 0.5 * (1 - t);
    }
  });
  return (
    <group position={[x, y, z]}>
      {/* generous invisible hitbox so the system is easy to click */}
      <mesh
        position={[0, 2.5, 0]}
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onEnter();
        }}
      >
        <cylinderGeometry args={[4.5, 4.5, 9, 16]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.0, 2.8, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hover ? 1 : 0.85}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={pulse} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[2.8, 3.3, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <sphereGeometry args={[1.25, 20, 20]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 2.6, 0]} color={color} intensity={8} distance={44} decay={2} />
      <Html center distanceFactor={42} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <button
          onClick={onEnter}
          className="whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-bold tracking-wide uppercase"
          style={{
            pointerEvents: "auto",
            transform: "translateY(-52px)",
            background: "rgba(4,8,14,.9)",
            color,
            border: `2px solid ${color}${hover ? "" : "aa"}`,
            boxShadow: `0 0 22px ${color}${hover ? "cc" : "66"}`,
          }}
        >
          {label}
          <span className="block text-[10px] font-medium tracking-normal normal-case opacity-80">
            {sub} · drill in →
          </span>
        </button>
      </Html>
    </group>
  );
}

function GlobeScene({ storms, hour, onEnter, accent = "#3f96ff" }) {
  const R = 52;
  const LIFT = 60;
  const GC = useMemo(() => [0, -34, -8], []);
  const spin = useRef();
  const controls = useRef();
  const { camera } = useThree();
  const map = useMemo(() => buildUSMap(), []);
  const grat = useMemo(() => buildGraticule(R * 0.999), []);
  const world = useMemo(() => buildGlobeLines(R * 1.004, WORLD), []);
  const nation = useMemo(() => buildGlobeLines(R * 1.012, NATION), []);
  const present = useMemo(() => new THREE.Vector3(0, 0.95, 0.3).normalize(), []);
  // Orient the globe so the US faces up toward the floating panel.
  const baseQuat = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        lonLatToVec3(-98, 39, 1).normalize(),
        present.clone(),
      ),
    [present],
  );
  const tether = useMemo(() => {
    const base = new THREE.Vector3(GC[0], GC[1], GC[2]).add(
      present.clone().multiplyScalar(R * 1.02),
    );
    return [[0, LIFT - 2, 0], base.toArray()];
  }, [GC, present]);
  useEffect(() => {
    camera.position.set(6, 150, 182);
    controls.current?.target.set(0, 12, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += (dt || 0.016) * 0.05;
  });
  const hotspots = useMemo(
    () =>
      storms
        .map((s) => {
          const p = interpolate(s, hour);
          if (!p) return null;
          const [x, z] = project(p.lon, p.lat);
          const tropical = s.kind === "hurricane" || s.kind === "tropical_storm";
          return {
            id: s.id,
            x,
            z,
            y: Math.max(0.5, map.heightAt(x, z)),
            color: categoryColor(p.category, p.windMph),
            label: s.name,
            sub: tropical
              ? `${categoryLabel(p.category, p.windMph)} · ${Math.round(p.windMph)} mph`
              : `${Math.round(p.windMph)} mph wind`,
            storm: s,
            pos: p,
          };
        })
        .filter(Boolean),
    [storms, hour, map],
  );
  return (
    <>
      <color attach="background" args={["#02040a"]} />
      <fog attach="fog" args={["#02040a", 240, 680]} />
      <hemisphereLight intensity={0.06} groundColor={"#0a0f18"} color={"#33405a"} />
      <directionalLight position={[150, 120, 90]} intensity={0.9} color={"#fff2d6"} />
      <directionalLight position={[40, 120, 60]} intensity={0.28} color={"#5f79b8"} />
      <StarField full count={2800} radius={560} />
      {/* the sun — a bright HDR core; bloom turns it into a soft glow */}
      <mesh position={[150, 30, -190]}>
        <sphereGeometry args={[16, 32, 32]} />
        <meshBasicMaterial color={SUN_COLOR} toneMapped={false} fog={false} />
      </mesh>
      {/* rotating hologram globe (behind / below the panel) */}
      <group position={GC}>
        <group ref={spin}>
          <group quaternion={baseQuat.toArray()}>
            <mesh>
              <sphereGeometry args={[R, 48, 48]} />
              <meshStandardMaterial
                color="#05101d"
                emissive="#0a1e33"
                emissiveIntensity={0.5}
                metalness={0.2}
                roughness={0.9}
              />
            </mesh>
            <lineSegments geometry={grat}>
              <lineBasicMaterial color={accent} transparent opacity={0.14} toneMapped={false} />
            </lineSegments>
            <lineSegments geometry={world}>
              <lineBasicMaterial color="#46d6b6" transparent opacity={0.6} toneMapped={false} />
            </lineSegments>
            <lineSegments geometry={nation}>
              <lineBasicMaterial color={accent} transparent opacity={0.98} toneMapped={false} />
            </lineSegments>
          </group>
        </group>
        <mesh>
          <sphereGeometry args={[R * 1.05, 48, 48]} />
          <meshBasicMaterial
            color="#2f7fff"
            transparent
            opacity={0.12}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* tether from the panel down to the US on the globe */}
      <Line points={tether} color={accent} lineWidth={1.5} transparent opacity={0.55} />
      {/* floating textured US panel (the "globe texture" from the Control Room) */}
      <group position={[0, LIFT, 0]}>
        <primitive object={map.terrain} />
        <CityLights points={map.cityLights} />
        <Line points={map.nationLine} color={accent} lineWidth={2.4} transparent opacity={0.95} />
        {map.stateLines.map((pts, i) => (
          <Line key={i} points={pts} color="#1f6f9c" lineWidth={1.1} transparent opacity={0.5} />
        ))}
        {hotspots.map((h) => (
          <PanelHotspot
            key={h.id}
            x={h.x}
            y={h.y}
            z={h.z}
            color={h.color}
            label={h.label}
            sub={h.sub}
            onEnter={() => onEnter(h.storm, h.pos)}
          />
        ))}
      </group>
      <Html fullscreen zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center">
          <div className="text-[13px] font-semibold tracking-wide text-slate-200">
            Active systems
          </div>
          <div className="text-[11px] text-slate-400">Select a storm to drill into the map</div>
        </div>
      </Html>
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={70}
        maxDistance={340}
        maxPolarAngle={Math.PI / 2.05}
      />
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.0} luminanceSmoothing={0.2} />
      </EffectComposer>
    </>
  );
}

function Scene({ assets, risks, events, hour, selectedId, onSelect, entry, onBackToGlobe }) {
  const [hovered, setHovered] = useState(null);
  const [pivot, setPivot] = useState(null);
  const map = useMemo(() => buildUSMap(), []);
  const storms = useMemo(() => (events || []).filter(Boolean), [events]);
  // Click empty map (not a drag, not an asset) → set that point as the orbit pivot.
  const onGround = (e) => {
    if (e.delta > 4) return; // ignore drags
    e.stopPropagation();
    setPivot({ point: [e.point.x, e.point.y, e.point.z], key: Date.now() });
  };

  // All on-screen labels (storms + major infrastructure + selected/hovered).
  // Anchored at the pin/eye; the declutter layer lifts the chip above it in
  // screen space with a subtle leader — no coloured 3D lines drawn on the map.
  const labelItems = useMemo(() => {
    const out = [];
    for (const s of storms) {
      const p = interpolate(s, hour);
      if (!p) continue;
      const [x, z] = project(p.lon, p.lat);
      const tropical = s.kind === "hurricane" || s.kind === "tropical_storm";
      const rMi =
        THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p.windMph, 30, 160, 90, 190), 80, 210) *
        UNITS_PER_MI;
      const text = tropical
        ? `${s.name} · ${categoryLabel(p.category, p.windMph)} · ${Math.round(p.windMph)} mph`
        : `${s.name} · ${Math.round(p.windMph)} mph wind`;
      out.push({
        id: `storm-${s.id}`,
        world: [x, (tropical ? rMi * 0.55 : 2) + 2, z],
        text,
        color: categoryColor(p.category, p.windMph),
        sel: false,
        storm: true,
      });
    }
    for (const a of assets) {
      const sel = selectedId === a.id;
      const hov = hovered === a.id;
      if (!(LABEL_TYPES.has(a.type) || sel || hov)) continue;
      const [x, z] = project(a.lon, a.lat);
      const y = Math.max(0.05, map.heightAt(x, z)) + (MAJOR_SET.has(a.type) ? 1.2 : 0.4);
      out.push({
        id: `asset-${a.id}`,
        world: [x, y, z],
        text: a.name,
        color: riskColor(risks?.get?.(a.id)?.level),
        sel,
      });
    }
    return out;
  }, [storms, hour, assets, selectedId, hovered, risks, map]);

  // World position of the selected asset, for click-to-zoom.
  const focus = useMemo(() => {
    if (!selectedId) return null;
    const a = assets.find((x) => x.id === selectedId);
    if (!a) return null;
    const [x, z] = project(a.lon, a.lat);
    return [x, Math.max(0.05, map.heightAt(x, z)), z];
  }, [selectedId, assets, map]);

  // Where to frame the camera when we drill in from the globe (a storm region).
  const entryWorld = useMemo(() => {
    if (!entry) return null;
    const [x, z] = project(entry.lon, entry.lat);
    return [x, 4, z];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <color attach="background" args={["#02040a"]} />
      <fog attach="fog" args={["#02040a", 340, 900]} />
      <hemisphereLight intensity={0.12} groundColor={"#0a0f18"} color={"#33405a"} />
      {/* warm "sun" keys the topography; cool fill lifts the shadow side */}
      <directionalLight position={[70, 150, 90]} intensity={0.75} color={"#fff2d6"} />
      <directionalLight position={[-90, 120, -40]} intensity={0.25} color={"#5f79b8"} />
      <StarField />
      {/* deep-water plane revealed through the discarded-sea terrain fragments */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 0]} onClick={onGround}>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color="#04121f" metalness={0.2} roughness={0.95} />
      </mesh>
      <primitive object={map.terrain} onClick={onGround} />
      <CityLights points={map.cityLights} />
      {map.stateLines.map((pts, i) => (
        <Line
          key={`st${i}`}
          points={pts}
          color="#1f6f9c"
          lineWidth={1.1}
          transparent
          opacity={0.5}
        />
      ))}
      {storms.map((s) => (
        <StormLayer key={s.id} event={s} hour={hour} />
      ))}
      {assets.map((a) => {
        const Marker = MAJOR_SET.has(a.type) ? AssetPin : WellMarker;
        return (
          <Marker
            key={a.id}
            asset={a}
            level={risks?.get?.(a.id)?.level}
            selected={selectedId === a.id}
            hovered={hovered === a.id}
            onSelect={onSelect}
            onHover={setHovered}
            heightAt={map.heightAt}
          />
        );
      })}
      <CameraRig
        focus={focus}
        focusKey={selectedId}
        recenter={pivot?.point}
        recenterKey={pivot?.key}
        entry={entryWorld}
      />
      {/* Rendered after CameraRig so its projection runs once the camera is
          finalised for the frame — keeps labels pinned to their markers. */}
      <SmartLabels items={labelItems} />
      {onBackToGlobe && (
        <Html fullscreen zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
          <button
            onClick={onBackToGlobe}
            className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur"
            style={{
              pointerEvents: "auto",
              background: "rgba(6,12,20,.85)",
              color: "#dce4ef",
              borderColor: "rgba(120,150,190,.5)",
            }}
          >
            ◀ Globe
          </button>
        </Html>
      )}
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.42} luminanceSmoothing={0.28} />
        <Vignette eskil={false} offset={0.22} darkness={0.5} />
      </EffectComposer>
    </>
  );
}

/**
 * Holographic 3D weather map — the flagship "storm room" view. Consumes the same
 * props as OpsMap (assets, risks, event, hour, selectedId, onSelect). Opens on a
 * Level-0 globe of active systems; clicking a storm drills into the regional map.
 */
export default function WeatherHoloScene({
  assets = [],
  risks,
  event,
  events,
  hour = 0,
  selectedId,
  onSelect,
  autoPlay = false,
  initialFocusEventId,
}) {
  const storms = events && events.length ? events : event ? [event] : [];
  const focusStorm = initialFocusEventId ? storms.find((s) => s.id === initialFocusEventId) : null;
  // When embedded (e.g. the Overview) we auto-advance our own playhead so the
  // storm animates without an external timeline.
  const [internalHour, setInternalHour] = useState(0);
  useEffect(() => {
    if (!autoPlay) return;
    const id = setInterval(() => setInternalHour((h) => (h >= 120 ? 0 : h + 0.375)), 90);
    return () => clearInterval(id);
  }, [autoPlay]);
  const activeHour = autoPlay ? internalHour : hour;
  // Open framed on a specific storm (skip the globe) when asked; else start on
  // the globe if there are systems, otherwise straight to the map.
  const [level, setLevel] = useState(focusStorm || !storms.length ? "map" : "globe");
  const [entry, setEntry] = useState(() => {
    if (!focusStorm) return null;
    const p = interpolate(focusStorm, 0);
    return p ? { lon: p.lon, lat: p.lat, key: 1 } : null;
  });
  const allowGlobe = !initialFocusEventId && storms.length > 0;
  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      camera={{ position: [0, 140, 185], fov: 45 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
    >
      {level === "globe" ? (
        <GlobeScene
          storms={storms}
          hour={activeHour}
          onEnter={(_s, pos) => {
            setEntry({ lon: pos.lon, lat: pos.lat, key: Date.now() });
            setLevel("map");
          }}
        />
      ) : (
        <Scene
          assets={assets}
          risks={risks}
          events={storms}
          hour={activeHour}
          selectedId={selectedId}
          onSelect={onSelect}
          entry={entry}
          onBackToGlobe={allowGlobe ? () => setLevel("globe") : null}
        />
      )}
    </Canvas>
  );
}
