// Client-side sample data for the Control Room 3D twin — replaces the Fabric-backed
// server so the real Facility/Equipment render without a backend. The facility-model
// mirrors dataApi.facilityModel()'s exact shape (plants -> unitList -> assets, with
// campus/unit/asset grid layout), and useSampleRealtime ports realtime.js's per-second
// Ornstein-Uhlenbeck simulator to the browser.

// Plant names must match Facility.jsx's PLANT_GEO so they land on the US map.
const PLANTS = [
  { name: "Riverton", units: ["RV3", "RV4"] },
  { name: "Fairview", units: ["FV2"] },
  { name: "Ashford", units: ["AS3"] },
  { name: "Deepwater", units: ["DW1"] },
  { name: "Harbor Point", units: ["HP2"] },
  { name: "Cedar Falls", units: ["CF1"] },
];

// archetype -> display name + category + tag stems. Names trigger equipmentType().
const TRAIN = [
  {
    type: "pump",
    name: "Boiler Feed Pump",
    category: "Rotating",
    stems: ["BFP.VIBR", "BFP.BRG_TEMP"],
  },
  {
    type: "boiler",
    name: "Boiler",
    category: "Fired",
    stems: ["BLR.DRUM_PRESS", "BLR.STEAM_TEMP"],
  },
  {
    type: "turbine",
    name: "Steam Turbine",
    category: "Rotating",
    stems: ["STM.VIBR", "STM.RPM", "STM.BRG_TEMP"],
  },
  { type: "generator", name: "Generator", category: "Electrical", stems: ["GEN.STATOR_TEMP"] },
];

// A couple of seeded conditions so the fleet isn't uniformly healthy.
const CONDITION = {
  RV3_Steam_Turbine: "critical",
  FV2_Boiler_Feed_Pump: "watch",
  DW1_Boiler: "watch",
};

export function deriveMwTag(unit) {
  const prefix = String(unit || "").trim();
  if (!prefix) return null;
  const n = (prefix.match(/(\d+)/) || [])[1] || "";
  return `${prefix}:GEJU${n}NLOAD.AG`;
}

// Build the flat asset list (dim_asset-equivalent), then group + lay out exactly like the server.
function sampleAssets() {
  const assets = [];
  for (const p of PLANTS) {
    for (const unit of p.units) {
      for (const t of TRAIN) {
        const key = `${unit}_${t.name.replace(/ /g, "_")}`;
        const tags = t.stems.map((s) => ({
          tag: `${unit}:${s}`,
          role: "watch",
          units: "",
          desc: s,
        }));
        if (t.type === "generator")
          tags.push({ tag: deriveMwTag(unit), role: "watch", units: "MW", desc: "Net load" });
        assets.push({
          asset_id: key,
          name: t.name,
          unit,
          plant: p.name,
          category: t.category,
          group: t.type,
          running_tag: tags[0].tag,
          tags,
          status: CONDITION[key] || "ok",
        });
      }
    }
  }
  return assets;
}

export function buildFacilityModel() {
  const assets = sampleAssets();
  const plants = {};
  for (const a of assets) {
    const p = (plants[a.plant] ||= { name: a.plant, units: {} });
    const u = (p.units[a.unit] ||= { name: a.unit, assets: [] });
    u.assets.push({ ...a, health: a.status === "critical" ? 54 : a.status === "watch" ? 74 : 92 });
  }
  const plantList = Object.values(plants);
  const cols = Math.ceil(Math.sqrt(plantList.length));
  const PLANT_GAP = 60;
  plantList.forEach((p, pi) => {
    p.pos = [
      (pi % cols) * PLANT_GAP - ((cols - 1) * PLANT_GAP) / 2,
      0,
      Math.floor(pi / cols) * PLANT_GAP - ((cols - 1) * PLANT_GAP) / 2,
    ];
    const units = Object.values(p.units);
    p.unitList = units;
    const ucols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
    const UGAP = 30;
    units.forEach((u, ui) => {
      u.pos = [
        (ui % ucols) * UGAP - ((ucols - 1) * UGAP) / 2,
        0,
        Math.floor(ui / ucols) * UGAP - ((ucols - 1) * UGAP) / 2,
      ];
      u.status = u.assets.reduce(
        (s, a) =>
          a.status === "critical"
            ? "critical"
            : s === "critical"
              ? "critical"
              : a.status === "watch"
                ? "watch"
                : s,
        "ok",
      );
      const acols = Math.max(1, Math.ceil(Math.sqrt(u.assets.length)));
      const AGAP = 9;
      u.assets.forEach((a, ai) => {
        a.pos = [
          (ai % acols) * AGAP - ((acols - 1) * AGAP) / 2,
          0,
          Math.floor(ai / acols) * AGAP - ((acols - 1) * AGAP) / 2,
        ];
      });
    });
    delete p.units;
  });
  const tagCount = assets.reduce((s, a) => s + a.tags.length, 0);
  return {
    plants: plantList,
    counts: { plants: plantList.length, assets: assets.length, tags: tagCount },
  };
}

export function fleetAssets() {
  return sampleAssets().map((a) => ({ ...a }));
}

export function sampleNarrative() {
  return {
    briefing: [
      {
        asset: "RV3 Steam Turbine",
        level: "critical",
        severity: "CRITICAL",
        headline: "Bearing vibration trending to trip; stop model predicts ~26h.",
      },
      {
        asset: "FV2 Boiler Feed Pump",
        level: "watch",
        severity: "WATCH",
        headline: "Seal drift rising above baseline; monitor over next cycle.",
      },
      {
        asset: "DW1 Boiler",
        level: "watch",
        severity: "WATCH",
        headline: "Drum pressure oscillation flagged by anomaly model.",
      },
      {
        asset: "Riverton RV4",
        level: "ok",
        severity: "INFO",
        headline: "Unit healthy; net load steady this cycle.",
      },
    ],
  };
}

// ---- Ornstein-Uhlenbeck per-second simulator (ported from server/realtime.js) ----
import { useCallback, useEffect, useRef, useState } from "react";

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
function gaussian() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function baseline(tag) {
  const t = tag.toUpperCase();
  let mean, sd;
  if (/NLOAD|MW/.test(t)) {
    mean = 250 + (hash(tag) % 320);
    sd = mean * 0.03;
  } else if (/VIBR/.test(t)) {
    mean = 3.2 + (hash(tag) % 5);
    sd = 0.55;
  } else if (/TEMP/.test(t)) {
    mean = 62 + (hash(tag) % 42);
    sd = 2.4;
  } else if (/PRESS/.test(t)) {
    mean = 42 + (hash(tag) % 46);
    sd = 1.7;
  } else if (/RPM/.test(t)) {
    mean = 3000 + (hash(tag) % 640);
    sd = 14;
  } else {
    mean = 40 + (hash(tag) % 60);
    sd = mean * 0.04;
  }
  return { value: mean, mean, sd, min: mean - sd * 4, max: mean + sd * 4, range: sd * 8 };
}
const THETA = 0.08,
  SIGMA = 0.06;
function tickState(st) {
  const noise = SIGMA * st.sd * gaussian();
  let v = st.value + THETA * (st.mean - st.value) + noise;
  const pad = st.range * 0.15;
  const lo = st.min - pad,
    hi = st.max + pad;
  if (v < lo) v = lo + Math.abs(noise);
  if (v > hi) v = hi - Math.abs(noise);
  st.value = v;
  return v;
}

export function useSampleRealtime() {
  const [pulse, setPulse] = useState({
    live: true,
    totalTags: 0,
    eventsPerMin: 0,
    lastTs: Date.now(),
  });
  const [values, setValues] = useState({});
  const sim = useRef(new Map());
  const active = useRef(new Set());

  const subscribe = useCallback((tags) => {
    active.current = new Set(tags || []);
    for (const t of active.current) if (!sim.current.has(t)) sim.current.set(t, baseline(t));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const next = {};
      let n = 0;
      for (const tag of active.current) {
        const st = sim.current.get(tag);
        if (!st) continue;
        next[tag] = {
          value: Math.round(tickState(st) * 100) / 100,
          ts: now,
          plant: null,
          rxAt: now,
          changedAt: now,
        };
        n++;
      }
      if (n) setValues((prev) => ({ ...prev, ...next }));
      setPulse({ live: true, totalTags: n, eventsPerMin: n * 60, lastTs: now });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return { connected: true, pulse, values, subscribe };
}
