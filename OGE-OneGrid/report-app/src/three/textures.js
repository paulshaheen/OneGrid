// Photoreal PBR materials for the equipment models. Loads real CC0 texture sets
// (ambientCG) bundled under /public/textures and served same-origin, so there is no
// runtime network/CORS dependency. Each set provides color + normal (GL) + roughness
// (+ metalness) maps that drive meshStandardMaterial for authentic metal, plated steel
// and concrete surfaces.
//
// Guarded for environments without `document` (SSR/tests) — callers get empty fragments
// and materials fall back to flat color/metalness/roughness.
import * as THREE from 'three';

const BASE = '/textures';
const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;
const _cache = new Map();

function tex(url, srgb, rx, ry) {
  if (!loader) return null;
  const key = `${url}@${rx}x${ry}`;
  if (_cache.has(key)) return _cache.get(key);
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(rx, ry);
  _cache.set(key, t);
  return t;
}

// Build a material-prop fragment for a texture set folder at a given tiling.
function set(kind, rx, ry, { metal = true } = {}) {
  const frag = {};
  const c = tex(`${BASE}/${kind}/color.jpg`, true, rx, ry);
  const n = tex(`${BASE}/${kind}/normal.jpg`, false, rx, ry);
  const r = tex(`${BASE}/${kind}/rough.jpg`, false, rx, ry);
  if (c) frag.map = c;
  if (n) frag.normalMap = n;
  if (r) frag.roughnessMap = r;
  if (metal) {
    const m = tex(`${BASE}/${kind}/metal.jpg`, false, rx, ry);
    if (m) frag.metalnessMap = m;
  }
  return frag;
}

// Tiling tuned per surface so detail reads well on both small parts and large boxes.
export const STEEL_TEX    = set('steel', 2.0, 1.6);
export const PLATES_TEX   = set('plates', 1.6, 1.3);
export const DARK_TEX     = set('dark', 2.0, 1.6);
export const PAINTED_TEX  = set('painted', 1.4, 1.4);
export const CONCRETE_TEX = set('concrete', 3.0, 3.0, { metal: false });

// Whether real textures are available (used to pick scalar fallbacks).
export const HAS_TEX = !!(STEEL_TEX.map || PLATES_TEX.map);

// Soft radial puff sprite for animated steam/smoke (generated once).
export const STEAM_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
