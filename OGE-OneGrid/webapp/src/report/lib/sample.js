// Client-side sample data provider — replaces the Fabric-backed server so the ported
// report-app personas/components run with no backend. Every generator is deterministic
// (seeded by asset/tag id) and returns the EXACT shape dataApi.js produced, so the
// original components render unchanged. Field names mirror the DAX/KQL result columns.

// ── deterministic helpers ────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// seeded RNG in [0,1) from a string
function rng(seed) {
  let x = hash(seed) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const nowIso = () => new Date().toISOString();

// ── fleet definition (kept consistent with the 3D facility model) ─────────
const PLANTS = [
  { name: "Riverton", units: ["RV3", "RV4"] },
  { name: "Fairview", units: ["FV2"] },
  { name: "Ashford", units: ["AS3"] },
  { name: "Deepwater", units: ["DW1"] },
  { name: "Harbor Point", units: ["HP2"] },
  { name: "Cedar Falls", units: ["CF1"] },
];
const TRAIN = [
  {
    type: "pump",
    name: "Boiler Feed Pump",
    category: "Rotating",
    group: "pump",
    stems: [
      ["BFP.VIBR", "Feed pump vibration", "mm/s"],
      ["BFP.BRG_TEMP", "Feed pump bearing temp", "°C"],
      ["BFP.DISCH_PRESS", "Discharge pressure", "bar"],
    ],
  },
  {
    type: "boiler",
    name: "Boiler",
    category: "Fired",
    group: "boiler",
    stems: [
      ["BLR.DRUM_PRESS", "Drum pressure", "bar"],
      ["BLR.STEAM_TEMP", "Main steam temp", "°C"],
      ["BLR.O2", "Flue-gas O₂", "%"],
    ],
  },
  {
    type: "turbine",
    name: "Steam Turbine",
    category: "Rotating",
    group: "turbine",
    stems: [
      ["STM.VIBR", "Turbine vibration", "mm/s"],
      ["STM.RPM", "Turbine speed", "rpm"],
      ["STM.BRG_TEMP", "Bearing metal temp", "°C"],
      ["STM.EXH_TEMP", "Exhaust hood temp", "°C"],
    ],
  },
  {
    type: "generator",
    name: "Generator",
    category: "Electrical",
    group: "generator",
    stems: [
      ["GEN.STATOR_TEMP", "Stator winding temp", "°C"],
      ["GEN.H2_PRESS", "H₂ coolant pressure", "bar"],
    ],
  },
];
// seeded conditions so the fleet isn't uniformly healthy
const CONDITION = {
  RV3_Steam_Turbine: "critical",
  FV2_Boiler_Feed_Pump: "watch",
  DW1_Boiler: "watch",
  HP2_Steam_Turbine: "watch",
};

export function deriveMwTag(unit) {
  const p = String(unit || "").trim();
  if (!p) return null;
  const n = (p.match(/(\d+)/) || [])[1] || "";
  return `${p}:GEJU${n}NLOAD.AG`;
}

// ── canonical flat asset list (dim_asset equivalent) ──────────────────────
function canonicalAssets() {
  const out = [];
  for (const p of PLANTS) {
    for (const unit of p.units) {
      for (const t of TRAIN) {
        const key = `${unit}_${t.name.replace(/ /g, "_")}`;
        const tags = t.stems.map(([s, desc, units]) => ({
          tag: `${unit}:${s}`,
          desc,
          units,
          role: "watch",
        }));
        if (t.type === "generator")
          tags.push({ tag: deriveMwTag(unit), desc: "Net load", units: "MW", role: "root cause" });
        out.push({
          asset_id: key,
          name: t.name,
          unit,
          plant: p.name,
          category: t.category,
          group: t.group,
          type: t.type,
          running_tag: tags[0].tag,
          tags,
          status: CONDITION[key] || "ok",
        });
      }
    }
  }
  return out;
}
const ASSETS = canonicalAssets();
const BY_ID = Object.fromEntries(ASSETS.map((a) => [a.asset_id, a]));

// ── physical baseline per tag ─────────────────────────────────────────────
export function baseline(tag) {
  const t = String(tag).toUpperCase();
  let mean, sd;
  if (/NLOAD|MW/.test(t)) {
    mean = 250 + (hash(tag) % 320);
    sd = mean * 0.03;
  } else if (/VIBR/.test(t)) {
    mean = 3.2 + (hash(tag) % 5);
    sd = 0.55;
  } else if (/BRG_TEMP|STATOR|EXH_TEMP/.test(t)) {
    mean = 68 + (hash(tag) % 40);
    sd = 2.6;
  } else if (/STEAM_TEMP/.test(t)) {
    mean = 538 + (hash(tag) % 12);
    sd = 3.2;
  } else if (/TEMP/.test(t)) {
    mean = 62 + (hash(tag) % 40);
    sd = 2.4;
  } else if (/PRESS/.test(t)) {
    mean = 42 + (hash(tag) % 60);
    sd = 1.7;
  } else if (/RPM/.test(t)) {
    mean = 3000 + (hash(tag) % 620);
    sd = 14;
  } else if (/O2\b|\.O2/.test(t)) {
    mean = 3.2 + (hash(tag) % 2);
    sd = 0.25;
  } else {
    mean = 40 + (hash(tag) % 60);
    sd = mean * 0.04;
  }
  return { mean, sd, min: mean - sd * 4, max: mean + sd * 4, range: sd * 8 };
}

// ── severity profile per asset ────────────────────────────────────────────
function profile(a) {
  const r = rng(a.asset_id + ":prof");
  if (a.status === "critical")
    return {
      maxZ: 6 + r() * 3,
      stop: 0.55 + r() * 0.2,
      surv14: 0.36 + r() * 0.18,
      surv7: 0.6 + r() * 0.12,
      risk: 0.72 + r() * 0.2,
      riskLevel: "critical",
      health: 46 + r() * 12,
    };
  if (a.status === "watch")
    return {
      maxZ: 3 + r() * 2,
      stop: 0.2 + r() * 0.15,
      surv14: 0.7 + r() * 0.12,
      surv7: 0.82 + r() * 0.1,
      risk: 0.4 + r() * 0.25,
      riskLevel: r() > 0.5 ? "high" : "medium",
      health: 68 + r() * 10,
    };
  return {
    maxZ: r() * 2,
    stop: 0.02 + r() * 0.1,
    surv14: 0.9 + r() * 0.09,
    surv7: 0.95 + r() * 0.04,
    risk: r() * 0.2,
    riskLevel: "low",
    health: 84 + r() * 14,
  };
}

// ── FLEET ASSETS (composite grid record) ──────────────────────────────────
export function fleetAssets() {
  return ASSETS.map((a) => {
    const pr = profile(a);
    const health = round(pr.health, 0);
    let condition = health;
    condition -= Math.min(45, pr.maxZ * 4.5);
    condition -= pr.stop * 30;
    if (pr.riskLevel === "critical") condition -= 22;
    else if (pr.riskLevel === "high") condition -= 10;
    condition = Math.max(2, Math.min(100, Math.round(condition)));
    if (a.status === "critical") condition = Math.min(condition, 59);
    else if (a.status === "watch") condition = Math.min(Math.max(condition, 60), 79);
    else condition = Math.max(condition, 80);
    const anomN =
      a.status === "critical"
        ? 3 + (hash(a.asset_id) % 3)
        : a.status === "watch"
          ? 1 + (hash(a.asset_id) % 2)
          : 0;
    const watchN =
      a.status === "critical"
        ? 4 + (hash(a.asset_id) % 3)
        : a.status === "watch"
          ? 2 + (hash(a.asset_id) % 2)
          : hash(a.asset_id) % 2;
    return {
      asset_id: a.asset_id,
      name: a.name,
      unit: a.unit,
      plant: a.plant,
      category: a.category,
      group: a.group,
      running_tag: a.running_tag,
      health,
      condition,
      anomaly_pct: round(pr.maxZ * 3, 0),
      max_z: round(pr.maxZ, 1),
      watch_n: watchN,
      anom_n: anomN,
      stop_prob: round(pr.stop, 3),
      risk_score: round(pr.risk, 3),
      survival_7d: round(pr.surv7, 3),
      risk_level: pr.riskLevel,
      status: a.status,
      score: condition,
    };
  });
}

// ── FLEET HEALTH aggregate ────────────────────────────────────────────────
export function fleetHealth() {
  const fa = fleetAssets();
  const avg = fa.reduce((s, a) => s + a.health, 0) / fa.length;
  const min = Math.min(...fa.map((a) => a.health));
  const anomAssets = fa.filter((a) => a.anom_n > 0);
  const watchAssets = fa.filter((a) => a.watch_n > 0);
  const crit = fa.filter((a) => a.status === "critical");
  const openWr = 38,
    totalWr = 214;
  const alert = {
    critical: crit.length,
    high: fa.filter((a) => a.risk_level === "high").length,
    medium: 3,
    normal: fa.length,
  };
  const risk = {
    critical: crit.length,
    high: fa.filter((a) => a.risk_level === "high").length,
    medium: 2,
    low: fa.filter((a) => a.risk_level === "low").length,
  };
  return {
    health: { avg, min, scoredAssets: fa.length, totalAssets: fa.length },
    watchlist: { rows: watchAssets.reduce((s, a) => s + a.watch_n, 0), assets: watchAssets.length },
    anomalies: {
      rows: anomAssets.reduce((s, a) => s + a.anom_n, 0),
      assets: anomAssets.length,
      critical: crit.length,
      high: alert.high,
    },
    workRequests: { open: openWr, total: totalWr },
    predictions: { alert, risk, highRisk: alert.critical + alert.high + risk.critical + risk.high },
  };
}

// ── per-archetype root-cause narrative ────────────────────────────────────
const RC = {
  turbine: {
    mech: "Outboard bearing wear",
    cause:
      "Rising 1x synchronous vibration coupled with bearing-metal temperature indicates progressing babbitt wear on the outboard journal bearing. Orbit analysis shows increasing ellipticity.",
    action:
      "Inspect outboard bearing at the next weather window (T-72h); stage a spare journal bearing and confirm lube-oil condition.",
    tagRe: /VIBR/,
    contrib: /BRG_TEMP/,
  },
  pump: {
    mech: "Mechanical seal degradation",
    cause:
      "Seal-flush temperature drift and rising vibration point to a degrading mechanical seal face; discharge pressure oscillation confirms internal recirculation.",
    action: "Schedule seal inspection; verify flush-line ΔP and top up barrier fluid.",
    tagRe: /VIBR/,
    contrib: /PRESS/,
  },
  boiler: {
    mech: "Drum-pressure control instability",
    cause:
      "Drum-pressure oscillation beyond the anomaly band with steam-temperature coupling suggests a sticking feedwater control valve or level-control tuning drift.",
    action:
      "Review level-control tuning and stroke the feedwater control valve; inspect for sticking.",
    tagRe: /PRESS/,
    contrib: /STEAM_TEMP/,
  },
  generator: {
    mech: "Stator cooling anomaly",
    cause:
      "Stator-winding temperature rising against stable load with H₂ coolant-pressure drift indicates reduced cooling effectiveness (possible gas purity or cooler fouling).",
    action: "Check H₂ purity and coolant-water differential; inspect stator cooler for fouling.",
    tagRe: /STATOR/,
    contrib: /H2/,
  },
};

// ── ASSET DETAIL (root cause + watchlist + anomalies + predictions + tags) ─
export function assetDetail(id) {
  const a = BY_ID[id];
  if (!a)
    return {
      asset: null,
      rootCause: [],
      watchlist: [],
      anomalies: [],
      predShort: [],
      predLong: [],
      tags: [],
    };
  const pr = profile(a);
  const r = rng(id + ":detail");
  const tags = a.tags.map((t) => {
    const b = baseline(t.tag);
    const v = round(b.mean + (r() - 0.5) * b.sd, 2);
    return { ...t, value: v, ts: nowIso() };
  });
  const rc = RC[a.type] || RC.turbine;
  const primaryTag = (a.tags.find((t) => rc.tagRe.test(t.tag)) || a.tags[0]).tag;
  const contribTag = (a.tags.find((t) => rc.contrib.test(t.tag)) || a.tags[1] || a.tags[0]).tag;
  const nDeg = a.status === "critical" ? 3 : a.status === "watch" ? 2 : 0;

  // watchlist rows (rich — Simulation reads these)
  const watchlist = a.tags.slice(0, a.status === "ok" ? 1 : nDeg + 1).map((t, i) => {
    const b = baseline(t.tag);
    const up = !/O2|PRESS/.test(t.tag) || i % 2 === 0;
    const slope =
      (a.status === "critical" ? 1 : a.status === "watch" ? 0.5 : 0.12) *
      b.sd *
      (up ? 1 : -1) *
      (1 + r());
    const cur = round(b.mean + slope * 2 + (r() - 0.5) * b.sd, 2);
    return {
      tag_name: t.tag,
      descriptor: t.desc,
      engineering_units: t.units,
      current_value: cur,
      baseline_mean: round(b.mean, 2),
      normal_range_low: round(b.min, 2),
      normal_range_high: round(b.max, 2),
      trend_direction: up ? "increasing" : "decreasing",
      trend_slope_per_day: round(slope, 3),
      risk_contribution: round(
        (a.status === "critical" ? 0.7 : a.status === "watch" ? 0.4 : 0.1) * (1 + r()) - i * 0.05,
        2,
      ),
      recommended_action: i === 0 ? rc.action : "",
      recommendation_text: i === 0 ? rc.action : "",
    };
  });

  // anomalies
  const anomalies =
    a.status === "ok"
      ? []
      : a.tags.slice(0, nDeg).map((t, i) => {
          const z = round(pr.maxZ - i * 0.8 + r() * 0.4, 1);
          const b = baseline(t.tag);
          return {
            Tag: t.tag,
            descriptor: t.desc,
            severity: z >= 6 ? "CRITICAL" : z >= 3 ? "HIGH" : "MEDIUM",
            peak_abs_z: z,
            duration_h: round(2 + r() * 20, 1),
            advisory_message: `${t.desc} deviating ${z}σ from AAKR baseline over the last ${Math.round(2 + r() * 20)}h.`,
            latest_value: round(b.mean + z * b.sd * 0.4, 2),
            baseline_median: round(b.mean, 2),
            anomaly_direction: /O2/.test(t.tag) ? "low" : "high",
          };
        });

  // root cause
  const rootCause =
    a.status === "ok"
      ? []
      : [
          {
            failure_mechanism: rc.mech,
            root_cause: rc.cause,
            descriptor: (BY_ID[id].tags.find((t) => t.tag === primaryTag) || {}).desc || "",
            tag: primaryTag,
            priority: a.status === "critical" ? "Critical" : "Medium",
            confidence: round(a.status === "critical" ? 0.82 + r() * 0.12 : 0.62 + r() * 0.15, 2),
            recommended_action: rc.action,
            contributing_tag_names: contribTag,
          },
        ];

  // predictions — short-term stop model
  const HZ = ["4h", "8h", "12h", "24h", "48h", "72h"];
  const predShort =
    a.status === "ok"
      ? []
      : HZ.map((hz, i) => ({
          prediction_horizon: hz,
          stop_probability: round(clamp(pr.stop * (0.5 + i * 0.12), 0.01, 0.95), 3),
          alert_level: pr.stop >= 0.55 && i >= 3 ? "Critical" : pr.stop >= 0.35 ? "High" : "Medium",
          scoring_timestamp: nowIso(),
        }));
  // long-term survival
  const predLong = [
    {
      horizon: "7d",
      risk_level: pr.riskLevel,
      risk_score: round(pr.risk, 3),
      survival_probability_7d: round(pr.surv7, 3),
      survival_probability_14d: round(pr.surv14, 3),
      predicted_median_survival_days: round(pr.surv14 < 0.5 ? 6 + r() * 6 : 40 + r() * 60, 0),
    },
    {
      horizon: "14d",
      risk_level: pr.riskLevel,
      risk_score: round(pr.risk, 3),
      survival_probability_7d: round(pr.surv7, 3),
      survival_probability_14d: round(pr.surv14, 3),
      predicted_median_survival_days: round(pr.surv14 < 0.5 ? 6 + r() * 6 : 40 + r() * 60, 0),
    },
  ];

  return { asset: { ...a }, rootCause, watchlist, anomalies, predShort, predLong, tags };
}

// ── WATCHLIST / ANOMALIES top lists ───────────────────────────────────────
export function watchlistTop(limit = 60) {
  const rows = [];
  for (const a of ASSETS)
    rows.push(
      ...assetDetail(a.asset_id).watchlist.map((w) => ({
        ...w,
        asset_id: a.asset_id,
        plant: a.plant,
        unit: a.unit,
      })),
    );
  return rows.sort((x, y) => y.risk_contribution - x.risk_contribution).slice(0, limit);
}
export function anomaliesTop(limit = 60) {
  const rows = [];
  for (const a of ASSETS)
    rows.push(
      ...assetDetail(a.asset_id).anomalies.map((an) => ({
        ...an,
        asset_id: a.asset_id,
        plant: a.plant,
        unit: a.unit,
      })),
    );
  return rows.sort((x, y) => y.peak_abs_z - x.peak_abs_z).slice(0, limit);
}

// ── WORK ORDERS ───────────────────────────────────────────────────────────
const WR_TYPES = ["Corrective", "Preventive", "Inspection", "Predictive"];
const WR_STATUS = [
  "In Progress",
  "Scheduled",
  "Ready to Schedule",
  "New Request",
  "Planning Required",
  "Awaiting Approval",
];
const PROBLEMS = {
  turbine: [
    "Bearing vibration alarm — investigate outboard journal",
    "Exhaust hood temperature high",
    "Governor valve stroke test overdue",
  ],
  pump: [
    "Mechanical seal leak at feed pump",
    "Bearing temperature trending high",
    "Discharge pressure low — check recirculation",
  ],
  boiler: [
    "Drum level control instability",
    "Soot-blower actuator fault",
    "Flue-gas O₂ analyzer drift",
  ],
  generator: [
    "Stator temperature high — inspect cooling",
    "H₂ purity low",
    "Excitation cubicle cooling fan fault",
  ],
};
function allWorkOrders() {
  const rows = [];
  let n = 48210;
  for (const a of ASSETS) {
    const r = rng(a.asset_id + ":wo");
    const count = a.status === "critical" ? 3 : a.status === "watch" ? 2 : r() > 0.6 ? 1 : 0;
    const probs = PROBLEMS[a.type] || PROBLEMS.turbine;
    for (let i = 0; i < count; i++) {
      const prio =
        a.status === "critical" && i === 0 ? 1 : a.status === "watch" ? 2 : 2 + Math.floor(r() * 3);
      rows.push({
        wr_id: `WR-${n++}`,
        problem_descr: probs[i % probs.length],
        location: `${a.plant} · Unit ${a.unit}`,
        problem_location: `${a.plant} · Unit ${a.unit}`,
        parent_descr: `${a.unit} ${a.name}`,
        entity_descr: a.name,
        wr_type: WR_TYPES[Math.floor(r() * WR_TYPES.length)],
        wr_status: WR_STATUS[Math.floor(r() * WR_STATUS.length)],
        wr_status_id: "OPEN",
        priority: prio,
        priority_code: prio,
        priority_rank: prio,
        site_name: a.plant,
        asset_id: a.asset_id,
        unit: a.unit,
        asset_type: a.type,
        create_date: new Date(Date.now() - r() * 30 * 864e5).toISOString(),
        update_date: nowIso(),
      });
    }
  }
  return rows.sort(
    (x, y) => x.priority_rank - y.priority_rank || (y.create_date > x.create_date ? 1 : -1),
  );
}
export function workOrders(limit = 80) {
  return allWorkOrders().slice(0, limit);
}
export function workOrdersSummary() {
  const all = allWorkOrders();
  const BACKLOG = ["new request", "planning required", "ready to schedule", "awaiting approval"];
  const byKey = (key) => {
    const m = {};
    for (const w of all) {
      const k = w[key];
      m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).map(([label, nn]) => ({ label, n: nn }));
  };
  const byStatus = byKey("wr_status").sort((a, b) => b.n - a.n);
  const backlog = byStatus
    .filter((s) => BACKLOG.includes(String(s.label).toLowerCase()))
    .reduce((s, x) => s + x.n, 0);
  const open = all.length;
  return {
    open,
    total: 214,
    active: Math.max(0, open - backlog),
    backlog,
    byStatus,
    byType: byKey("wr_type").sort((a, b) => b.n - a.n),
    byPriority: [1, 2, 3, 4]
      .map((rank) => ({
        label: `P${rank}`,
        rank,
        n: all.filter((w) => w.priority_rank === rank).length,
      }))
      .filter((x) => x.n),
    bySite: byKey("site_name").sort((a, b) => b.n - a.n),
  };
}
export function assetWorkOrders(id, limit = 40) {
  const a = BY_ID[id];
  if (!a) return { asset_id: id, rows: [], matchedBy: "none", open: 0 };
  const rows = allWorkOrders()
    .filter((w) => w.asset_id === id)
    .map((w) => ({
      wr_id: w.wr_id,
      status: w.wr_status,
      status_id: w.wr_status_id,
      type: w.wr_type,
      priority: w.priority,
      priority_rank: w.priority_rank,
      problem: w.problem_descr,
      entity: w.entity_descr,
      parent: w.parent_descr,
      create_date: w.create_date,
      update_date: w.update_date,
      open: true,
      site: w.site_name,
    }))
    .slice(0, limit);
  return {
    asset_id: id,
    plant: a.plant,
    unit: a.unit,
    matchedBy: "plant+unit/keyword",
    open: rows.length,
    rows,
  };
}

// ── OUTAGES ───────────────────────────────────────────────────────────────
export function outages() {
  const r = rng("outages");
  const rows = [];
  const seed = [
    {
      plant: "Riverton",
      unit: "RV3",
      type: "Forced Outage",
      status: "Active",
      reason: "Turbine bearing vibration",
      mw: 180,
      active: true,
    },
    {
      plant: "Deepwater",
      unit: "DW1",
      type: "Planned Maintenance",
      status: "Active",
      reason: "Boiler inspection",
      mw: 90,
      active: true,
    },
    {
      plant: "Harbor Point",
      unit: "HP2",
      type: "Derate",
      status: "Active",
      reason: "Condenser fouling",
      mw: 45,
      active: true,
    },
    {
      plant: "Fairview",
      unit: "FV2",
      type: "Planned Maintenance",
      status: "Scheduled",
      reason: "Feed pump seal replacement",
      mw: 0,
      active: false,
    },
    {
      plant: "Cedar Falls",
      unit: "CF1",
      type: "Planned Maintenance",
      status: "Scheduled",
      reason: "Annual overhaul",
      mw: 0,
      active: false,
    },
  ];
  seed.forEach((s, i) =>
    rows.push({
      outage_id: `OUT-${1000 + i}`,
      plant: s.plant,
      unit: s.unit,
      type: s.type,
      status: s.status,
      priority: s.active ? "High" : "Medium",
      derate_mw: s.mw,
      reason: s.reason,
      begin: new Date(Date.now() - r() * 5 * 864e5).toISOString(),
      end: s.active ? null : new Date(Date.now() + r() * 10 * 864e5).toISOString(),
      active: s.active,
    }),
  );
  const active = rows.filter((o) => o.active);
  return {
    rows,
    summary: {
      total: rows.length,
      active: active.length,
      planned: rows.filter((o) => !o.active).length,
      forced: rows.filter((o) => o.active && /forced/i.test(o.type)).length,
      activeDerateMW: Math.round(active.reduce((s, o) => s + o.derate_mw, 0)),
      plantsAffected: new Set(active.map((o) => o.plant)).size,
    },
  };
}

// ── PREDICTIONS detail ────────────────────────────────────────────────────
export function predictionsDetail() {
  const fa = fleetAssets();
  const rows = fa.map((a) => {
    const d = assetDetail(a.asset_id);
    const pl = d.predLong[1] || {};
    const ps = (d.predShort || []).reduce((m, x) => Math.max(m, x.stop_probability), 0);
    return {
      asset_id: a.asset_id,
      name: a.name,
      plant: a.plant,
      unit: a.unit,
      risk_level: a.risk_level,
      risk_score: a.risk_score,
      stop_prob: ps || round(clamp((1 - (pl.survival_probability_7d || 1)) * 0.9, 0.01, 0.6), 3),
      stop_estimated: !ps,
      alert_level: (d.predShort[0] || {}).alert_level,
      surv7: pl.survival_probability_7d,
      surv14: pl.survival_probability_14d,
      median_days: pl.predicted_median_survival_days,
    };
  });
  const rank = (lv) =>
    /crit/i.test(lv || "") ? 3 : /high/i.test(lv || "") ? 2 : /med/i.test(lv || "") ? 1 : 0;
  rows.sort(
    (x, y) => rank(y.risk_level) - rank(x.risk_level) || (y.risk_score || 0) - (x.risk_score || 0),
  );
  const atRisk = rows.filter((r) => rank(r.risk_level) >= 1 || (r.stop_prob || 0) >= 0.3).length;
  return {
    rows,
    counts: {
      critical: rows.filter((r) => rank(r.risk_level) === 3).length,
      high: rows.filter((r) => rank(r.risk_level) === 2).length,
      medium: rows.filter((r) => rank(r.risk_level) === 1).length,
      atRisk,
    },
  };
}

// ── NARRATIVE / briefing ──────────────────────────────────────────────────
export function narrative() {
  const fa = fleetAssets();
  const crit = fa.filter((a) => a.status !== "ok").slice(0, 8);
  const critCount = fa.filter((a) => a.status === "critical").length;
  const flagged = fa.filter((a) => a.status !== "ok").length;
  const briefing = crit.map((a) => {
    const d = assetDetail(a.asset_id);
    const rc = d.rootCause[0];
    return {
      severity: a.status === "critical" ? "CRITICAL" : "MONITOR",
      level: a.status === "critical" ? "critical" : "watch",
      asset: `${a.unit} ${a.name}`,
      headline: rc
        ? rc.failure_mechanism + " — " + (rc.recommended_action || "").split(";")[0]
        : "Condition monitoring flagged elevated readings.",
      z: a.max_z,
      full: "",
    };
  });
  return {
    narrative_date: new Date().toISOString().slice(0, 10),
    system_status: critCount > 0 ? "CRITICAL" : flagged > 0 ? "ELEVATED" : "OK",
    critical_alerts: critCount,
    total_alerts: briefing.length,
    assets_flagged: flagged,
    briefing,
  };
}

// ── TAG VALUES / TREND ────────────────────────────────────────────────────
export function tagValues(tags) {
  const list = Array.isArray(tags) ? tags : String(tags).split(",").filter(Boolean);
  return list.map((tag) => {
    const b = baseline(tag);
    const r = rng(tag + ":" + Math.floor(Date.now() / 1000));
    return { tag, value: round(b.mean + (r() - 0.5) * b.sd, 2), ts: nowIso() };
  });
}
export function tagTrend(tag, hours = 24, bin = 15) {
  const b = baseline(tag);
  const r = rng(tag + ":trend");
  const points = Math.round((hours * 60) / bin);
  const out = [];
  let v = b.mean;
  const now = Date.now();
  for (let i = points; i >= 0; i--) {
    v += (b.mean - v) * 0.1 + (r() - 0.5) * b.sd * 0.6;
    out.push({ ts: new Date(now - i * bin * 60000).toISOString(), v: round(v, 2) });
  }
  return out;
}

// ── FACILITY MODEL (grouped + positioned for the 3D map) ──────────────────
export function facilityModel() {
  const plants = {};
  for (const a of ASSETS) {
    const p = (plants[a.plant] ||= { name: a.plant, units: {} });
    const u = (p.units[a.unit] ||= { name: a.unit, assets: [] });
    const pr = profile(a);
    u.assets.push({ ...a, health: Math.round(pr.health) });
  }
  const plantList = Object.values(plants);
  const cols = Math.ceil(Math.sqrt(plantList.length));
  const PG = 60;
  plantList.forEach((p, pi) => {
    p.pos = [
      (pi % cols) * PG - ((cols - 1) * PG) / 2,
      0,
      Math.floor(pi / cols) * PG - ((cols - 1) * PG) / 2,
    ];
    const units = Object.values(p.units);
    p.unitList = units;
    const uc = Math.max(1, Math.ceil(Math.sqrt(units.length)));
    const UG = 30;
    units.forEach((u, ui) => {
      u.pos = [
        (ui % uc) * UG - ((uc - 1) * UG) / 2,
        0,
        Math.floor(ui / uc) * UG - ((uc - 1) * UG) / 2,
      ];
      u.status = u.assets.reduce(
        (s, x) =>
          x.status === "critical"
            ? "critical"
            : s === "critical"
              ? "critical"
              : x.status === "watch"
                ? "watch"
                : s,
        "ok",
      );
      const ac = Math.max(1, Math.ceil(Math.sqrt(u.assets.length)));
      const AG = 9;
      u.assets.forEach((x, ai) => {
        x.pos = [
          (ai % ac) * AG - ((ac - 1) * AG) / 2,
          0,
          Math.floor(ai / ac) * AG - ((ac - 1) * AG) / 2,
        ];
      });
    });
    delete p.units;
  });
  const tagCount = ASSETS.reduce((s, a) => s + a.tags.length, 0);
  return {
    plants: plantList,
    counts: { plants: plantList.length, assets: ASSETS.length, tags: tagCount },
  };
}

// ── REALTIME (Ornstein-Uhlenbeck) singleton simulator ─────────────────────
const THETA = 0.08,
  SIGMA = 0.06;
function gaussian() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
class Simulator {
  constructor() {
    this.sim = new Map();
    this.active = new Set();
    this.values = {};
    this.pulse = { live: true, totalTags: 0, eventsPerMin: 0, lastTs: Date.now() };
    this.subs = new Set();
    this.timer = null;
  }
  ensure() {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setInterval(() => this.tick(), 1000);
  }
  subscribe(tags) {
    this.active = new Set(tags || []);
    for (const t of this.active)
      if (!this.sim.has(t)) this.sim.set(t, { ...baseline(t), value: baseline(t).mean });
    this.ensure();
  }
  tick() {
    const now = Date.now();
    let n = 0;
    const next = { ...this.values };
    for (const tag of this.active) {
      const st = this.sim.get(tag);
      if (!st) continue;
      const noise = SIGMA * st.sd * gaussian();
      let v = st.value + THETA * (st.mean - st.value) + noise;
      const pad = st.range * 0.15;
      if (v < st.min - pad) v = st.min - pad + Math.abs(noise);
      if (v > st.max + pad) v = st.max + pad - Math.abs(noise);
      st.value = v;
      const old = this.values[tag];
      next[tag] = {
        value: round(v, 2),
        ts: now,
        plant: null,
        rxAt: now,
        changedAt: old && old.value !== round(v, 2) ? now : old?.changedAt || now,
      };
      n++;
    }
    this.values = next;
    this.pulse = { live: true, totalTags: n, eventsPerMin: n * 60, lastTs: now };
    for (const cb of this.subs) cb();
  }
  onChange(cb) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
}
export const simulator = new Simulator();
