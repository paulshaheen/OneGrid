// ---------------------------------------------------------------------------
//  Synthetic sensor completion — fills 3D-twin hotspots that the real PI tag
//  schema doesn't cover.
//
//  The 3D twin (webapp/src/report/three/Equipment.jsx `anchorsFor`) defines a
//  fixed set of clickable hotspots per equipment archetype (e.g. a Steam Turbine
//  has HP Casing / IP Section / LP Exhaust / bearings / rotor). The generated
//  estate, however, only emits mechanical-health tags (vibration, speed, bearing
//  temp), so the steam-path / process hotspots render blank ("no data").
//
//  This module completes each asset's tag list: for every hotspot the real tags
//  don't already cover, it appends a synthetic sensor whose descriptor matches the
//  hotspot's frontend `hint` (so the twin's matcher assigns it correctly) and
//  serves a deterministic, gently-drifting value + 24h trend. Synthetic stems are
//  deliberately DISTINCT from every real stem so the value/trend paths can tell
//  them apart and never shadow real telemetry.
//
//  Keep ARCHETYPE_HOTSPOTS in sync with Equipment.jsx `anchorsFor` (same ids,
//  order and hint keywords).
// ---------------------------------------------------------------------------

// stem -> reading spec. `min`/`max` bound the (normal-range) synthetic value.
export const SENSOR_SPECS = {
  // ---- turbine (steam path + fallbacks for bearing/rotor on sparse assets) ----
  'STM.HP_PRESS':   { desc: 'HP throttle steam inlet pressure', units: 'bar',   min: 118, max: 172, dec: 1 },
  'STM.IP_TEMP':    { desc: 'IP reheat mid-section temp',       units: 'degC',  min: 528, max: 566, dec: 1 },
  'STM.LP_VAC':     { desc: 'LP exhaust hood / condenser vacuum', units: 'kPa a', min: 5,  max: 13,  dec: 2 },
  'STM.FR_BRG_TEMP':{ desc: 'Front thrust bearing metal temp',  units: 'degC',  min: 58,  max: 96,  dec: 1 },
  'STM.RE_BRG_TEMP':{ desc: 'Generator-end bearing / seal temp', units: 'degC', min: 58,  max: 96,  dec: 1 },
  'STM.SHAFT_RPM':  { desc: 'Turbine rotor speed',              units: 'rpm',   min: 3580, max: 3620, dec: 0 },
  // ---- boiler ----
  'BLR.DRUM_LVL':   { desc: 'Steam drum level',                units: '%',     min: 40,  max: 62,  dec: 1 },
  'BLR.FURN_TEMP':  { desc: 'Furnace burner-zone temp',        units: 'degC',  min: 1150, max: 1320, dec: 0 },
  'BLR.SH_OUT_TEMP':{ desc: 'Superheater outlet steam temp',   units: 'degC',  min: 535, max: 572, dec: 1 },
  'BLR.ECON_FW_TEMP':{ desc: 'Economizer feedwater inlet temp', units: 'degC', min: 218, max: 262, dec: 1 },
  'BLR.APH_GAS_TEMP':{ desc: 'Air preheater flue-gas temp',    units: 'degC',  min: 118, max: 168, dec: 1 },
  // ---- pump ----
  'PMP.MOTOR_AMP':  { desc: 'Motor winding current',           units: 'A',     min: 165, max: 245, dec: 1 },
  'PMP.MOTOR_BRG_TEMP':{ desc: 'Motor bearing temp',           units: 'degC',  min: 50,  max: 88,  dec: 1 },
  'PMP.SEAL_PRESS': { desc: 'Mechanical seal flush pressure',   units: 'bar',   min: 6,   max: 11,  dec: 2 },
  'PMP.DISCH_PRESS':{ desc: 'Discharge header pressure',       units: 'bar',   min: 38,  max: 64,  dec: 1 },
  'PMP.SUCT_PRESS': { desc: 'Suction inlet pressure',          units: 'bar',   min: 2,   max: 6,   dec: 2 },
  'PMP.PUMP_BRG_TEMP':{ desc: 'Pump thrust bearing temp',      units: 'degC',  min: 50,  max: 90,  dec: 1 },
  // ---- generator ----
  'GEN.STATOR_V':   { desc: 'Stator terminal voltage',         units: 'kV',    min: 20,  max: 24,  dec: 2 },
  'GEN.FIELD_AMP':  { desc: 'Exciter field current',           units: 'A',     min: 1800, max: 2600, dec: 0 },
  'GEN.H2_SEAL_TEMP':{ desc: 'Hydrogen seal / bearing temp',   units: 'degC',  min: 52,  max: 92,  dec: 1 },
  // ---- generic skid / static ----
  'SKD.PRESS':      { desc: 'Process pressure',                units: 'bar',   min: 5,   max: 42,  dec: 1 },
  'SKD.TEMP':       { desc: 'Process temperature',             units: 'degC',  min: 40,  max: 120, dec: 1 },
  'SKD.FLOW':       { desc: 'Process flow',                    units: '%',     min: 30,  max: 96,  dec: 1 },
};

// archetype -> ordered hotspots (mirror Equipment.jsx `anchorsFor`): id, hint, and
// the synthetic stem to use when the hotspot is not covered by a real tag.
export const ARCHETYPE_HOTSPOTS = {
  turbine: [
    { id: 'hp',    hint: 'throttle|hp|steam|inlet',              stem: 'STM.HP_PRESS' },
    { id: 'ip',    hint: 'ip|reheat|mid',                        stem: 'STM.IP_TEMP' },
    { id: 'lp',    hint: 'lp|exhaust|hood|vacuum|condenser',     stem: 'STM.LP_VAC' },
    { id: 'fbrg',  hint: 'thrust|front|brg|bearing|vibration',   stem: 'STM.FR_BRG_TEMP' },
    { id: 'rbrg',  hint: 'gen|rear|brg|bearing|seal',            stem: 'STM.RE_BRG_TEMP' },
    { id: 'shaft', hint: 'speed|rpm|rotor|turb speed',           stem: 'STM.SHAFT_RPM' },
  ],
  boiler: [
    { id: 'drum',  hint: 'drum|level|steam|press',               stem: 'BLR.DRUM_LVL' },
    { id: 'furn',  hint: 'furnace|fire|burner|temp',             stem: 'BLR.FURN_TEMP' },
    { id: 'sh',    hint: 'superheat|sh|outlet|temp',             stem: 'BLR.SH_OUT_TEMP' },
    { id: 'econ',  hint: 'econ|feedwater|fw|inlet',              stem: 'BLR.ECON_FW_TEMP' },
    { id: 'aph',   hint: 'air|aph|preheat|damper',               stem: 'BLR.APH_GAS_TEMP' },
  ],
  pump: [
    { id: 'motor',   hint: 'motor|winding|current|amp',          stem: 'PMP.MOTOR_AMP' },
    { id: 'mbrg',    hint: 'motor brg|bearing|vibration',        stem: 'PMP.MOTOR_BRG_TEMP' },
    { id: 'seal',    hint: 'seal|leak',                          stem: 'PMP.SEAL_PRESS' },
    { id: 'volute',  hint: 'discharge|press|flow|head',          stem: 'PMP.DISCH_PRESS' },
    { id: 'suction', hint: 'suction|inlet|npsh',                 stem: 'PMP.SUCT_PRESS' },
    { id: 'pbrg',    hint: 'pump brg|thrust|vertical|horizontal', stem: 'PMP.PUMP_BRG_TEMP' },
  ],
  generator: [
    { id: 'stator', hint: 'stator|voltage|volt',                 stem: 'GEN.STATOR_V' },
    { id: 'exc',    hint: 'exciter|field|reactive',              stem: 'GEN.FIELD_AMP' },
    { id: 'brg',    hint: 'bearing|brg|h2|hydrogen',             stem: 'GEN.H2_SEAL_TEMP' },
  ],
  skid: [
    { id: 'a', hint: '', stem: 'SKD.PRESS' },
    { id: 'b', hint: '', stem: 'SKD.TEMP' },
    { id: 'c', hint: '', stem: 'SKD.FLOW' },
  ],
};

// Pure archetype classifier — mirror of webapp Equipment.jsx `equipmentType`.
export function archetypeOf(name, category, group) {
  const n = String(name || '').toLowerCase();
  const t = (re) => re.test(n);
  if (t(/boiler|furnace|drum|economizer|superheat/)) return 'boiler';
  if (t(/turbine/)) return 'turbine';
  if (t(/pump|bfp|feed\s*pump/)) return 'pump';
  if (t(/gen(erator)?|alternator|exciter/)) return 'generator';
  const s = `${category || ''} ${group || ''}`.toLowerCase();
  if (/boiler/.test(s)) return 'boiler';
  if (/pump/.test(s)) return 'pump';
  if (/turbine/.test(s)) return 'turbine';
  return 'skid';
}

export function stemOf(tag) {
  const i = String(tag).indexOf(':');
  return i < 0 ? String(tag) : String(tag).slice(i + 1);
}
export function isSyntheticTag(tag) {
  return Object.prototype.hasOwnProperty.call(SENSOR_SPECS, stemOf(tag));
}

// Deterministic tag-name hash (FNV-1a).
function seed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand01(x) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return (x >>> 0) / 4294967295; }
function round(v, dec = 1) { const p = Math.pow(10, dec); return Math.round(v * p) / p; }

// A smooth, deterministic reading for `tag` at time `tsMs`: a slow diurnal drift +
// bounded per-30-min noise, clamped to the sensor's normal range. Same seed => same
// value, so the snapshot value and the trend series line up.
export function synthValueAt(tag, tsMs = Date.now(), spec = SENSOR_SPECS[stemOf(tag)]) {
  if (!spec) return null;
  const base = seed(tag);
  const mid = (spec.min + spec.max) / 2;
  const span = spec.max - spec.min;
  const bucket = Math.floor(tsMs / (30 * 60 * 1000));
  const noise = rand01(base ^ Math.imul(bucket, 2654435761)) - 0.5;
  const drift = Math.sin(tsMs / 3600000 * (0.5 + (base % 9) / 24) + (base % 628) / 100);
  let v = mid + drift * span * 0.16 + noise * span * 0.22;
  v = Math.max(spec.min, Math.min(spec.max, v));
  return round(v, spec.dec ?? 1);
}

// Deterministic 24h-style trend for a synthetic tag: [{ ts, v }] oldest→newest.
export function synthSeries(tag, hours = 24, binMin = 15, anchorMs = Date.now()) {
  const spec = SENSOR_SPECS[stemOf(tag)];
  if (!spec) return [];
  const step = binMin * 60 * 1000;
  const start = anchorMs - hours * 3600 * 1000;
  const out = [];
  for (let ts = start; ts <= anchorMs; ts += step) out.push({ ts: new Date(ts).toISOString(), v: synthValueAt(tag, ts, spec) });
  return out;
}
export function synthStat(tag) {
  const spec = SENSOR_SPECS[stemOf(tag)];
  if (!spec) return null;
  const v = synthValueAt(tag, Date.now(), spec);
  return { value: v, mean: (spec.min + spec.max) / 2, sd: (spec.max - spec.min) * 0.14, min: spec.min, max: spec.max, valueType: null };
}

// The tag prefix (e.g. "FV1") for synthetic tag names: reuse an existing real tag's
// prefix, else derive from the asset id ("FV_U1_Steam_Turbine" -> "FV1").
export function tagPrefix(assetId, existingTags = []) {
  const real = existingTags.find((t) => String(t.tag).includes(':'));
  if (real) return String(real.tag).split(':')[0];
  const parts = String(assetId).split('_');
  const site = parts[0] || 'AS';
  const unitNum = (String(parts[1] || '').match(/(\d+)/) || [])[1] || '';
  return site + unitNum;
}

// Given an asset (name/category/group), its id and the real tags already resolved,
// return the extra SYNTHETIC tag rows needed so every twin hotspot has a reading.
// Mirrors the frontend 2-pass matcher: hint match first, then leftover fill for
// hint-less (skid) hotspots; only genuinely-uncovered hotspots get a synthetic tag.
export function completionTags(assetId, name, category, group, tags = []) {
  const arche = archetypeOf(name, category, group);
  const spots = ARCHETYPE_HOTSPOTS[arche];
  if (!spots) return [];
  const pool = tags.map((t) => ({ used: false, hay: `${t.desc || ''} ${t.tag || ''}`.toLowerCase() }));
  const covered = new Set();
  // Pass 1 — hint match (named hotspots claim their matching real tag).
  for (const h of spots) {
    if (!h.hint) continue;
    const words = h.hint.split('|').filter(Boolean);
    const m = pool.find((p) => !p.used && words.some((w) => p.hay.includes(w)));
    if (m) { m.used = true; covered.add(h.id); }
  }
  // Pass 2 — leftover real tags fill hint-less hotspots (generic skid a/b/c), in order.
  for (const h of spots) {
    if (h.hint || covered.has(h.id)) continue;
    const m = pool.find((p) => !p.used);
    if (m) { m.used = true; covered.add(h.id); }
  }
  const prefix = tagPrefix(assetId, tags);
  const nowIso = new Date().toISOString();
  const add = [];
  for (const h of spots) {
    if (covered.has(h.id)) continue;
    const spec = SENSOR_SPECS[h.stem];
    if (!spec) continue;
    const tag = `${prefix}:${h.stem}`;
    if (tags.some((t) => t.tag === tag) || add.some((t) => t.tag === tag)) continue;
    add.push({ tag, desc: spec.desc, units: spec.units, value: synthValueAt(tag, Date.now(), spec), ts: nowIso, role: 'sensor', synthetic: true });
  }
  return add;
}
