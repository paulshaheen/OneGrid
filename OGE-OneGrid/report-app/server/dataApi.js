// ---------------------------------------------------------------------------
//  Read-only data API over the Fabric semantic model (DAX) + Eventhouse (KQL).
//  Each function returns plain JSON the report front-ends consume. A tiny TTL
//  cache keeps the demo snappy without hammering the capacity.
// ---------------------------------------------------------------------------
import { dax, dax1, kql, kqlMgmt, isCapacityPausedError, getCapacityState } from './fabric.js';
import { resolveTarget } from './target.js';

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: now + ttlMs });
  return val;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const T = () => resolveTarget();

// Reject a slow probe so /api/status stays snappy even if a paused endpoint hangs.
function withTimeout(promise, ms, label = 'probe timeout') {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);
}
// Connection/5xx-style failures that also mean "the capacity isn't serving right now".
function isLikelyUnavailable(msg) {
  return /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network|HTTP 5\d\d|HTTP 40[03]\b|service unavailable|bad gateway|gateway timeout/i.test(String(msg));
}

// Liveness probe: is the Fabric capacity actually serving queries right now?
//  1) Authoritative — read the workspace's capacity state (Active vs Inactive/Paused).
//  2) Fallback — a trivial DAX ping; any failure means the data plane isn't serving.
// Cached briefly so polling clients don't hammer it.
export async function status() {
  return cached('status', 15_000, async () => {
    const t = T();
    const pausedMsg = 'Live data is available during operating hours, 8 AM–9 PM EST daily. The capacity is currently paused; readings resume automatically when it restarts.';
    const inferMsg  = 'The Fabric capacity appears to be paused. Live data is available during operating hours, 8 AM–9 PM EST daily, and resumes automatically when the capacity restarts.';
    if (!t.workspaceId || !t.datasetId) {
      return { ok: false, configured: false, capacityPaused: false, message: 'No Fabric target is configured for this app.' };
    }

    // 1) Authoritative capacity-state check (works for any capacity/identity that can read it).
    try {
      const { state } = await withTimeout(getCapacityState(t.workspaceId), 15_000, 'capacity-state timeout');
      if (state && !/^active$/i.test(state)) {
        return { ok: false, capacityPaused: true, capacityState: state, message: pausedMsg };
      }
      if (state && /^active$/i.test(state)) {
        return { ok: true, capacityPaused: false, capacityState: state };
      }
      // state null/unknown (identity can't read capacity state) -> fall through to the query probe.
    } catch { /* fall through */ }

    // 2) Fallback data probe. Distinguish a genuinely paused/unavailable capacity from an
    // unrelated failure (no sign-in, expired token, missing permission, stale/wrong target,
    // network) — only the former should surface the "capacity paused" banner.
    try {
      await withTimeout(dax1(t.workspaceId, t.datasetId, 'EVALUATE ROW("ping", 1)'), 12_000);
      return { ok: true, capacityPaused: false };
    } catch (e) {
      const detail = String((e && e.message) || e);
      if (isCapacityPausedError(e)) {
        return { ok: false, capacityPaused: true, inferred: true, message: inferMsg, detail: detail.slice(0, 300) };
      }
      // Not a paused capacity — don't show the misleading "paused" banner.
      return { ok: false, capacityPaused: false, connectionError: true, message: 'Live data is currently unavailable — the app could not query the semantic model. Check that a valid Fabric target is configured and the identity has access.', detail: detail.slice(0, 300) };
    }
  });
}

// ---- helpers to run DAX against the import model -------------------------
function q(query) { const t = T(); return dax1(t.workspaceId, t.datasetId, query); }
function qBatch(queries) { const t = T(); return dax(t.workspaceId, t.datasetId, queries); }
function kq(query) { const t = T(); return kql(t.kustoUri, t.kqlDatabase, query); }
function kqMgmt(csl) { const t = T(); return kqlMgmt(t.kustoUri, t.kqlDatabase, csl); }

// Persist a thumbs up/down (+ optional comment) into the Eventhouse MLFeedback table so
// future ML model runs can learn from human corrections. Streaming ingestion = near-instant.
export async function submitFeedback(fb) {
  const esc = (v) => String(v ?? '').replace(/["\r\n\t]/g, ' ').slice(0, 4000);
  const row = {
    feedback_id: fb.feedback_id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    feedback_user: esc(fb.user || 'demo-user'),
    persona: esc(fb.persona),
    item_type: esc(fb.item_type),               // root_cause | anomaly | watchlist | prediction | chat
    vote: /up|1|true|pos/i.test(String(fb.vote)) ? 'up' : 'down',
    asset_id: esc(fb.asset_id), plant: esc(fb.plant), unit: esc(fb.unit), tag: esc(fb.tag),
    item_ref: esc(fb.item_ref), comment: esc(fb.comment),
    context: fb.context ? JSON.stringify(fb.context).slice(0, 8000) : '{}',
    source: 'report-app',
  };
  const csvCols = ['feedback_id', 'ts', 'feedback_user', 'persona', 'item_type', 'vote', 'asset_id', 'plant', 'unit', 'tag', 'item_ref', 'comment', 'context', 'source'];
  const field = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const line = csvCols.map((c) => field(row[c])).join(',');
  await kqMgmt(`.ingest inline into table MLFeedback with (format="csv") <|\n${line}`);
  return { ok: true, feedback_id: row.feedback_id };
}

// ===========================================================================
//  FLEET HEALTH (page 1)
// ===========================================================================
export function fleetHealth() {
  return cached('fleetHealth', 30_000, async () => {
    const [health, watch, anom, wr, predS, predL] = await qBatch([
      'EVALUATE ROW("avg_health", AVERAGE(aakr_health[health_score]), "min_health", MIN(aakr_health[health_score]), "scored_assets", DISTINCTCOUNT(aakr_health[asset_id]), "total_assets", DISTINCTCOUNT(dim_asset[asset_id]))',
      'EVALUATE ROW("watch_rows", COUNTROWS(watchlist), "watch_assets", DISTINCTCOUNT(watchlist[asset_id]))',
      'EVALUATE ROW("anom_rows", COUNTROWS(anomaly_advisories), "anom_assets", DISTINCTCOUNT(anomaly_advisories[asset_id]), "crit", COUNTROWS(FILTER(anomaly_advisories, UPPER(anomaly_advisories[severity]) = "CRITICAL")), "high", COUNTROWS(FILTER(anomaly_advisories, UPPER(anomaly_advisories[severity]) = "HIGH")))',
      'EVALUATE ROW("open_wr", COUNTROWS(FILTER(fact_work_requests, ISBLANK(fact_work_requests[complete_date]))), "total_wr", COUNTROWS(fact_work_requests))',
      'EVALUATE SUMMARIZECOLUMNS(predictions_shortterm[alert_level], "n", COUNTROWS(predictions_shortterm))',
      'EVALUATE SUMMARIZECOLUMNS(predictions_longterm[risk_level], "n", COUNTROWS(predictions_longterm))',
    ]);
    const h = health[0] || {}, w = watch[0] || {}, a = anom[0] || {}, r = wr[0] || {};
    // health_score may be 0-1 or 0-100 — normalise to a 0-100 %.
    let avgH = num(h.avg_health);
    if (avgH !== null && avgH <= 1.5) avgH *= 100;
    const alertBuckets = Object.fromEntries(predS.map((x) => [String(x.alert_level ?? 'unknown').toLowerCase(), num(x.n)]));
    const riskBuckets = Object.fromEntries(predL.map((x) => [String(x.risk_level ?? 'unknown').toLowerCase(), num(x.n)]));
    const predHigh = (alertBuckets.critical || 0) + (alertBuckets.high || 0) + (riskBuckets.critical || 0) + (riskBuckets.high || 0);
    return {
      health: { avg: avgH, min: num(h.min_health) !== null ? (num(h.min_health) <= 1.5 ? num(h.min_health) * 100 : num(h.min_health)) : null, scoredAssets: num(h.scored_assets), totalAssets: num(h.total_assets) },
      watchlist: { rows: num(w.watch_rows), assets: num(w.watch_assets) },
      anomalies: { rows: num(a.anom_rows), assets: num(a.anom_assets), critical: num(a.crit), high: num(a.high) },
      workRequests: { open: num(r.open_wr), total: num(r.total_wr) },
      predictions: { alert: alertBuckets, risk: riskBuckets, highRisk: predHigh },
    };
  });
}

// ===========================================================================
//  FLEET ASSETS — one composite health record per asset for the grid/tiles.
// ===========================================================================
export function fleetAssets() {
  return cached('fleetAssets', 30_000, async () => {
    const [assets, health, watch, anom, predS, predL] = await qBatch([
      'EVALUATE SELECTCOLUMNS(dim_asset, "asset_id", dim_asset[asset_id], "name", dim_asset[asset_display_name], "unit", dim_asset[unit], "plant", dim_asset[plant], "category", dim_asset[equipment_category], "group", dim_asset[equipment_group], "running_tag", dim_asset[running_tag])',
      'EVALUATE SUMMARIZECOLUMNS(aakr_health[asset_id], "health", MAX(aakr_health[health_score]), "anomaly_pct", MAX(aakr_health[anomaly_pct]), "max_abs_z", MAX(aakr_health[max_abs_z]))',
      'EVALUATE SUMMARIZECOLUMNS(watchlist[asset_id], "watch_n", COUNTROWS(watchlist), "max_risk", MAX(watchlist[risk_contribution]))',
      'EVALUATE SUMMARIZECOLUMNS(anomaly_advisories[asset_id], "anom_n", COUNTROWS(anomaly_advisories), "max_z", MAX(anomaly_advisories[peak_abs_z]))',
      'EVALUATE SUMMARIZECOLUMNS(predictions_shortterm[asset_id], "stop_prob", MAX(predictions_shortterm[stop_probability]))',
      'EVALUATE SUMMARIZECOLUMNS(predictions_longterm[asset_id], "risk_score", MAX(predictions_longterm[risk_score]), "surv7", MIN(predictions_longterm[survival_probability_7d]), "risk_level", MAX(predictions_longterm[risk_level]))',
    ]);
    const idx = (rows, key) => Object.fromEntries(rows.map((r) => [r[key] ?? r.asset_id, r]));
    const H = idx(health, 'asset_id'), W = idx(watch, 'asset_id'), A = idx(anom, 'asset_id'), PS = idx(predS, 'asset_id'), PL = idx(predL, 'asset_id');
    return assets.map((a) => {
      const id = a.asset_id;
      const h = H[id] || {}, w = W[id] || {}, an = A[id] || {}, ps = PS[id] || {}, pl = PL[id] || {};
      let health = num(h.health); if (health !== null && health <= 1.5) health *= 100;
      const maxZ = num(an.max_z) ?? num(h.max_abs_z);
      const stopProb = num(ps.stop_prob);
      const riskLevel = String(pl.risk_level ?? '').toLowerCase();
      const anomN = num(an.anom_n) || 0, watchN = num(w.watch_n) || 0;
      // composite status
      let status = 'ok';
      const critical = riskLevel === 'critical' || (maxZ !== null && maxZ >= 6) || (stopProb !== null && stopProb >= 0.6) || (health !== null && health < 60);
      const watching = riskLevel === 'high' || anomN > 0 || watchN > 0 || (maxZ !== null && maxZ >= 3) || (stopProb !== null && stopProb >= 0.3) || (health !== null && health < 80);
      if (critical) status = 'critical';
      else if (watching) status = 'watch';
      // Composite CONDITION score (0-100) so the displayed number matches the status colour.
      // Raw AAKR health can read 98% on an asset that is Critical due to an extreme anomaly;
      // condition folds anomaly severity / stop-probability / risk into a single figure.
      let condition = health ?? 100;
      if (maxZ !== null) condition -= Math.min(45, maxZ * 4.5);       // z=6 -> -27, z=10 -> -45
      if (stopProb !== null) condition -= stopProb * 30;              // 0.6 -> -18
      if (riskLevel === 'critical') condition -= 22; else if (riskLevel === 'high') condition -= 10;
      condition = Math.max(2, Math.min(100, Math.round(condition)));
      // Keep the number consistent with the colour band.
      if (status === 'critical') condition = Math.min(condition, 59);
      else if (status === 'watch') condition = Math.min(Math.max(condition, 60), 79);
      else condition = Math.max(condition, 80);
      return {
        asset_id: id, name: a.name || id, unit: a.unit, plant: a.plant, category: a.category, group: a.group,
        running_tag: a.running_tag,
        health, condition, anomaly_pct: num(h.anomaly_pct), max_z: maxZ, watch_n: watchN, anom_n: anomN,
        stop_prob: stopProb, risk_score: num(pl.risk_score), survival_7d: num(pl.surv7), risk_level: pl.risk_level,
        status, score: condition,
      };
    });
  });
}

// ===========================================================================
//  ASSET DETAIL — root cause + watchlist + anomalies + predictions + tags.
// ===========================================================================
export async function assetDetail(assetId) {
  const id = String(assetId).replace(/"/g, '');
  return cached('assetDetail:' + id, 45_000, () => assetDetailUncached(id));
}
async function assetDetailUncached(id) {
  const [asset, rc, wl, an, ps, pl] = await qBatch([
    `EVALUATE FILTER(dim_asset, dim_asset[asset_id] = "${id}")`,
    `EVALUATE FILTER(root_cause, root_cause[asset_id] = "${id}")`,
    `EVALUATE TOPN(60, FILTER(watchlist, watchlist[asset_id] = "${id}"), watchlist[risk_contribution], DESC)`,
    `EVALUATE TOPN(60, FILTER(anomaly_advisories, anomaly_advisories[asset_id] = "${id}"), anomaly_advisories[peak_abs_z], DESC)`,
    `EVALUATE FILTER(predictions_shortterm, predictions_shortterm[asset_id] = "${id}")`,
    `EVALUATE FILTER(predictions_longterm, predictions_longterm[asset_id] = "${id}")`,
  ]);
  // The asset's real PI tags come from watchlist (tag_name + descriptor + units) + anomalies.
  const tagMap = new Map();
  for (const r of wl) if (r.tag_name && !tagMap.has(r.tag_name)) tagMap.set(r.tag_name, { tag: r.tag_name, desc: r.descriptor || r.tag_name, units: r.engineering_units || '', role: 'watch' });
  for (const r of rc) if (r.tag && !tagMap.has(r.tag)) tagMap.set(r.tag, { tag: r.tag, desc: r.descriptor || r.tag, units: '', role: 'root cause' });
  for (const r of an) if (r.Tag && !tagMap.has(r.Tag)) tagMap.set(r.Tag, { tag: r.Tag, desc: r.Tag, units: '', role: 'anomaly' });
  const tags = [...tagMap.values()];
  // Clone sites have no ML data of their own — mirror the Riverton counterpart's tag
  // schema (prefix-swapped) so their 3D model still shows live sensor readings.
  if (!tags.length) {
    const pre = String(id).split('_')[0];
    const n = (pre.match(/(\d+)/) || [])[1];
    if (n && !/^RV/i.test(pre)) {
      const cntId = `RV${n}` + String(id).slice(pre.length);
      const [wl2, an2, rc2] = await qBatch([
        `EVALUATE TOPN(80, FILTER(watchlist, watchlist[asset_id] = "${cntId}"), watchlist[risk_contribution], DESC)`,
        `EVALUATE TOPN(80, FILTER(anomaly_advisories, anomaly_advisories[asset_id] = "${cntId}"), anomaly_advisories[peak_abs_z], DESC)`,
        `EVALUATE FILTER(root_cause, root_cause[asset_id] = "${cntId}")`,
      ]).catch(() => [[], [], []]);
      const m2 = new Map();
      for (const r of wl2) if (r.tag_name && !m2.has(r.tag_name)) m2.set(r.tag_name, { tag: r.tag_name, desc: r.descriptor || r.tag_name, units: r.engineering_units || '', role: 'watch' });
      for (const r of rc2) if (r.tag && !m2.has(r.tag)) m2.set(r.tag, { tag: r.tag, desc: r.descriptor || r.tag, units: '', role: 'root cause' });
      for (const r of an2) if (r.Tag && !m2.has(r.Tag)) m2.set(r.Tag, { tag: r.Tag, desc: r.Tag, units: '', role: 'anomaly' });
      for (const t of m2.values()) tags.push({ ...t, tag: t.tag.replace(/^[^:]+:/, pre + ':') });
    }
  }
  // Fold last-known sensor values into the tags in the same response so the 3D model
  // renders live readings immediately — no second round-trip / render race.
  try {
    const snap = await tagValues(tags.map((t) => t.tag));
    const byTag = Object.fromEntries(snap.map((r) => [r.tag, r]));
    for (const t of tags) { const v = byTag[t.tag]; if (v) { t.value = v.value; t.ts = v.ts; } }
  } catch { /* KQL optional; model still shows structure + alert zones */ }
  return { asset: asset[0] || null, rootCause: rc, watchlist: wl, anomalies: an, predShort: ps, predLong: pl, tags };
}

// ===========================================================================
//  WATCHLIST / ANOMALIES / PREDICTIONS / NARRATIVE list endpoints
// ===========================================================================
export function watchlistTop(limit = 60) {
  return cached('watchTop' + limit, 30_000, () =>
    q(`EVALUATE TOPN(${limit}, watchlist, watchlist[risk_contribution], DESC)`)
  );
}
export function anomaliesTop(limit = 60) {
  return cached('anomTop' + limit, 30_000, () =>
    q(`EVALUATE TOPN(${limit}, anomaly_advisories, anomaly_advisories[peak_abs_z], DESC)`)
  );
}
// Work orders scoped to the MONITORED FLEET (plants present in dim_asset) and OPEN
// (non-terminal status). The raw fact table spans ~35 enterprise sites and counts every
// not-yet-Completed request, which is why the naive KPI showed ~22k; scoping to the fleet
// + real open statuses gives an accurate number.
const TERMINAL_WR = ['COMPLETE', 'CANCELLED', 'CLOSED', 'CANCEL'];
async function fleetPlants() {
  return cached('fleetPlants', 300_000, async () => {
    const rows = await q('EVALUATE VALUES(dim_asset[plant])');
    return rows.map((r) => r['dim_asset[plant]'] ?? r.plant).filter(Boolean);
  });
}
function daxStrList(vals) { return '{' + vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',') + '}'; }
const openWrFilter = (plants) => `FILTER(fact_work_requests, fact_work_requests[site_name] IN ${daxStrList(plants)} && NOT(UPPER(fact_work_requests[wr_status_id]) IN ${daxStrList(TERMINAL_WR)}))`;

export async function workOrders(limit = 80) {
  const plants = await fleetPlants();
  return cached('workOrders' + limit, 60_000, () =>
    q(`EVALUATE TOPN(${limit}, ${openWrFilter(plants)}, fact_work_requests[priority_rank], ASC, fact_work_requests[create_date], DESC)`)
  );
}
export async function workOrdersSummary() {
  const plants = await fleetPlants();
  return cached('workOrdersSummary', 60_000, async () => {
    const scoped = `FILTER(fact_work_requests, fact_work_requests[site_name] IN ${daxStrList(plants)})`;
    const [tot, byStatus, byType, byPrio, bySite] = await qBatch([
      `EVALUATE ROW("open", COUNTROWS(${openWrFilter(plants)}), "total", COUNTROWS(${scoped}))`,
      `EVALUATE SUMMARIZECOLUMNS(fact_work_requests[wr_status], "n", CALCULATE(COUNTROWS(fact_work_requests), ${openWrFilter(plants)}))`,
      `EVALUATE SUMMARIZECOLUMNS(fact_work_requests[wr_type], "n", CALCULATE(COUNTROWS(fact_work_requests), ${openWrFilter(plants)}))`,
      `EVALUATE SUMMARIZECOLUMNS(fact_work_requests[priority], fact_work_requests[priority_rank], "n", CALCULATE(COUNTROWS(fact_work_requests), ${openWrFilter(plants)}))`,
      `EVALUATE SUMMARIZECOLUMNS(fact_work_requests[site_name], "n", CALCULATE(COUNTROWS(fact_work_requests), ${openWrFilter(plants)}))`,
    ]);
    const t = tot[0] || {};
    const clean = (rows, key) => rows.map((r) => ({ label: r[key], n: num(r.n) })).filter((x) => x.n);
    const byStatusClean = clean(byStatus, 'wr_status').sort((a, b) => b.n - a.n);
    // A non-terminal request is "backlog" until it is triaged into a schedulable/active
    // work order. The headline "open work orders" is the actionable set (scheduled →
    // in-progress); backlog (new/planning/ready-to-schedule) is reported separately so the
    // number reflects real active work rather than the raw request queue.
    const BACKLOG = ['new request', 'planning required', 'ready to schedule', 'request', 'draft', 'unassigned', 'awaiting approval'];
    const openTotal = num(t.open);
    const backlog = byStatusClean.filter((s) => BACKLOG.includes(String(s.label || '').toLowerCase())).reduce((s, x) => s + x.n, 0);
    const active = Math.max(0, openTotal - backlog);
    return {
      open: openTotal, total: num(t.total), active, backlog,
      byStatus: byStatusClean,
      byType: clean(byType, 'wr_type').sort((a, b) => b.n - a.n),
      byPriority: byPrio.map((r) => ({ label: r.priority, rank: num(r.priority_rank), n: num(r.n) })).filter((x) => x.n).sort((a, b) => a.rank - b.rank),
      bySite: clean(bySite, 'site_name').sort((a, b) => b.n - a.n),
    };
  });
}

// Past + open work orders associated with a specific asset. Work requests link by site +
// entity (not the RV asset_id), so we match on the asset's plant (site_name) and narrow by
// the unit token / equipment keywords when present. Best-effort but keeps it asset-relevant.
export async function assetWorkOrders(assetId, limit = 40) {
  const id = String(assetId).replace(/"/g, '');
  return cached('assetWO:' + id + ':' + limit, 60_000, async () => {
    const arows = await q(`EVALUATE FILTER(dim_asset, dim_asset[asset_id] = "${id}")`);
    const a = arows[0] || {};
    const plant = a.plant, unit = a.unit;                            // e.g. RV2
    const name = String(a.asset_display_name || a.name || '');
    if (!plant) return { asset_id: id, rows: [], matchedBy: 'none' };
    const unitNum = (String(unit).match(/(\d+)/) || [])[1];           // "2"
    const kws = [];
    if (/boiler/i.test(name)) kws.push('BOILER');
    if (/turbine/i.test(name)) kws.push('TURBINE');
    if (/pump|bfp|feed/i.test(name)) kws.push('PUMP', 'FEED');
    if (/generator|gen/i.test(name)) kws.push('GENERATOR');
    let rows = await q(`EVALUATE TOPN(200, FILTER(fact_work_requests, fact_work_requests[site_name] = "${String(plant).replace(/"/g, '')}"), fact_work_requests[create_date], DESC)`);
    let matchedBy = 'plant';
    const kwHit = (r) => {
      const hay = `${r.entity_descr || ''} ${r.parent_descr || ''} ${r.problem_descr || ''}`.toUpperCase();
      const unitOk = unitNum ? new RegExp(`UNIT\\s*0*${unitNum}\\b`).test(hay) || hay.includes(`U${unitNum}`) : false;
      const kwOk = kws.some((k) => hay.includes(k));
      return { unitOk, kwOk };
    };
    const narrowed = rows.filter((r) => { const h = kwHit(r); return h.unitOk || h.kwOk; });
    if (narrowed.length >= 3) { rows = narrowed; matchedBy = unitNum ? 'plant+unit/keyword' : 'plant+keyword'; }
    const isOpen = (r) => !TERMINAL_WR.includes(String(r.wr_status_id || '').toUpperCase());
    rows.sort((x, y) => (isOpen(y) - isOpen(x)) || (num(x.priority_rank) || 99) - (num(y.priority_rank) || 99));
    const out = rows.slice(0, limit).map((r) => ({
      wr_id: r.wr_id, status: r.wr_status, status_id: r.wr_status_id,
      type: r.wr_type, priority: r.priority, priority_rank: num(r.priority_rank),
      problem: r.problem_descr, entity: r.entity_descr, parent: r.parent_descr,
      create_date: r.create_date, update_date: r.update_date,
      open: isOpen(r), site: r.site_name,
    }));
    return { asset_id: id, plant, unit, matchedBy, open: out.filter((r) => r.open).length, rows: out };
  });
}

// Outages / derates from the Eventhouse (PCIOutages) for the Fleet Availability drill-down.
export function outages() {
  return cached('outages', 30_000, async () => {
    const rows = await kq(`PCIOutages
      | extend isActive = (outage_status == "Active") or (isnull(end_date) and begin_date <= now())
      | project outage_id, plant, unit_name, event_type, outage_status, priority, mw, reason, begin_date, end_date, isActive
      | order by isActive desc, mw desc`);
    const map = rows.map((r) => ({
      outage_id: r.outage_id, plant: r.plant, unit: r.unit_name, type: r.event_type, status: r.outage_status,
      priority: r.priority, derate_mw: num(r.mw), reason: r.reason, begin: r.begin_date, end: r.end_date,
      active: r.isActive === true || r.isActive === 'true',
    }));
    const active = map.filter((o) => o.active);
    const planned = map.filter((o) => !o.active && /plan/i.test(o.type || ''));
    return {
      rows: map,
      summary: {
        total: map.length,
        active: active.length,
        planned: planned.length,
        forced: map.filter((o) => o.active && /forced/i.test(o.type || '')).length,
        activeDerateMW: Math.round(active.reduce((s, o) => s + (o.derate_mw || 0), 0)),
        plantsAffected: new Set(active.map((o) => o.plant)).size,
      },
    };
  });
}

// Predictions detail (short-term stop probability + long-term survival/risk) for the
// Predicted Risks drill-down modal — one focused row per asset, ranked by risk.
export function predictionsDetail() {
  return cached('predictionsDetail', 60_000, async () => {
    const [shortT, longT] = await qBatch([
      'EVALUATE SUMMARIZECOLUMNS(predictions_shortterm[asset_id], "max_stop", MAX(predictions_shortterm[stop_probability]), "alert", MAX(predictions_shortterm[alert_level]))',
      'EVALUATE SUMMARIZECOLUMNS(predictions_longterm[asset_id], "risk_score", MAX(predictions_longterm[risk_score]), "risk_level", MAX(predictions_longterm[risk_level]), "surv7", MIN(predictions_longterm[survival_probability_7d]), "surv14", MIN(predictions_longterm[survival_probability_14d]), "median_days", MIN(predictions_longterm[predicted_median_survival_days]))',
      ]);
    const assets = await fleetAssets();
    const byId = Object.fromEntries(assets.map((a) => [a.asset_id, a]));
    const sMap = Object.fromEntries(shortT.map((r) => [r.asset_id, r]));
    const rows = longT.map((r) => {
      const id = r.asset_id;
      const s = sMap[id] || {};
      const a = byId[id] || {};
      const surv7 = num(r.surv7), surv14 = num(r.surv14);
      let stop = num(s.max_stop), stopEstimated = false;
      // Not every asset is scored by the short-term stop model (e.g. boiler-feed-pumps),
      // so its Stop-prob would render blank. Derive a proxy from the asset's own 7-day
      // survival so the column is always meaningful.
      if (stop === null && surv7 !== null) { stop = Math.min(0.6, Math.max(0.01, (1 - surv7) * 0.9)); stopEstimated = true; }
      return {
        asset_id: id, name: a.name || id, plant: a.plant, unit: a.unit,
        risk_level: r.risk_level, risk_score: num(r.risk_score),
        stop_prob: stop, stop_estimated: stopEstimated, alert_level: s.alert,
        surv7, surv14, median_days: num(r.median_days),
      };
    });
    const rank = (lv) => (/crit/i.test(lv || '') ? 3 : /high/i.test(lv || '') ? 2 : /med/i.test(lv || '') ? 1 : 0);
    rows.sort((x, y) => rank(y.risk_level) - rank(x.risk_level) || (y.risk_score || 0) - (x.risk_score || 0) || (y.stop_prob || 0) - (x.stop_prob || 0));
    // "at risk" = any asset the models flag as medium+ risk OR with an elevated short-term
    // stop probability. Our fleet has no critical/high survival buckets, so medium is the
    // meaningful headline the exec should act on.
    const atRisk = rows.filter((r) => rank(r.risk_level) >= 1 || (r.stop_prob || 0) >= 0.3).length;
    return { rows, counts: { critical: rows.filter((r) => rank(r.risk_level) === 3).length, high: rows.filter((r) => rank(r.risk_level) === 2).length, medium: rows.filter((r) => rank(r.risk_level) === 1).length, atRisk } };
  });
}
export function narrative() {
  return cached('narrative', 60_000, async () => {
    const rows = await q('EVALUATE TOPN(1, daily_narrative, daily_narrative[narrative_date], DESC)');
    const n = rows[0] || null;
    if (n) n.briefing = parseBriefing(n.narrative_text);
    return n;
  });
}

// Turn the long narrative_text wall into a concise, structured briefing.
function parseBriefing(text) {
  if (!text) return [];
  return String(text).split('|').map((raw) => {
    const t = raw.trim();
    const m = t.match(/^\[([A-Z]+)\]\s*([^:]+):\s*(.+)$/);
    if (!m) return null;
    const [, sev, asset, rest] = m;
    const z = (rest.match(/z=([\d.]+)/) || [])[1];
    // headline = the part before "Worst anomaly" / first sentence, watch-items trimmed.
    let head = rest.split(/Worst anomaly|Sources:/)[0].trim().replace(/\s*\(\+\d+ more\)\.?/,'').replace(/[.\s]+$/, '');
    if (head.length > 120) head = head.slice(0, 117) + '…';
    return {
      severity: sev,
      level: sev === 'CRITICAL' ? 'critical' : sev === 'HIGH' ? 'critical' : (sev === 'MEDIUM' || sev === 'MONITOR') ? 'watch' : 'watch',
      asset: asset.trim(),
      headline: head,
      z: z ? Number(z) : null,
      full: t,
    };
  }).filter(Boolean);
}

// ===========================================================================
//  FACILITY MODEL — hierarchy + synthesized 3D positions for the map.
// ===========================================================================
export function facilityModel() {
  return cached('facility', 60_000, async () => {
    const [assets, watchTags, anomTags, rcTags, health] = await qBatch([
      'EVALUATE SELECTCOLUMNS(dim_asset, "asset_id", dim_asset[asset_id], "name", dim_asset[asset_display_name], "unit", dim_asset[unit], "plant", dim_asset[plant], "category", dim_asset[equipment_category], "group", dim_asset[equipment_group], "running_tag", dim_asset[running_tag])',
      'EVALUATE SUMMARIZECOLUMNS(watchlist[asset_id], watchlist[tag_name], watchlist[descriptor], watchlist[engineering_units])',
      'EVALUATE SUMMARIZECOLUMNS(anomaly_advisories[asset_id], anomaly_advisories[Tag])',
      'EVALUATE SUMMARIZECOLUMNS(root_cause[asset_id], root_cause[tag], root_cause[descriptor])',
      'EVALUATE SUMMARIZECOLUMNS(aakr_health[asset_id], "health", MAX(aakr_health[health_score]), "max_z", MAX(aakr_health[max_abs_z]))',
    ]);
    // Live-panel tags come from ALL of an asset's PI signal sources (watchlist + anomalies +
    // root cause), not just the watchlist — otherwise assets flagged only by anomalies
    // (e.g. RV3) would show zero live tags in the Control-Room panel.
    const tagsByAsset = {};
    const addTag = (assetId, tag, desc, units, role) => {
      if (!assetId || !tag) return;
      const list = (tagsByAsset[assetId] ||= []);
      if (list.some((t) => t.tag === tag)) return;
      list.push({ tag, role, units: units || '', desc: desc || tag });
    };
    for (const b of watchTags) addTag(b.asset_id, b.tag_name, b.descriptor, b.engineering_units, 'watch');
    for (const b of anomTags) addTag(b.asset_id, b.Tag, b.Tag, '', 'anomaly');
    for (const b of rcTags) addTag(b.asset_id, b.tag, b.descriptor, '', 'root cause');
    // Mirror Riverton's tag schema onto the synthetic clone sites so every facility is
    // clickable & live: a clone asset (e.g. AS3_U3_Steam_Turbine) inherits its Riverton
    // counterpart's (RV3_U3_Steam_Turbine) tags with the site prefix swapped. Values are
    // synthesized from the Riverton source in tagValues/tagStats.
    const prefixOf = (id) => String(id).split('_')[0];
    for (const a of assets) {
      const pre = prefixOf(a.asset_id);
      if (/^RV/i.test(pre) || (tagsByAsset[a.asset_id] || []).length) continue;
      const n = (pre.match(/(\d+)/) || [])[1];
      if (!n) continue;
      const cntId = `RV${n}` + a.asset_id.slice(pre.length);
      const src = tagsByAsset[cntId];
      if (!src || !src.length) continue;
      tagsByAsset[a.asset_id] = src.map((t) => ({ ...t, tag: t.tag.replace(/^[^:]+:/, pre + ':') }));
    }
    const healthById = Object.fromEntries(health.map((h) => [h.asset_id, h]));

    // Group assets -> plants -> units.
    const plants = {};
    for (const a of assets) {
      const plantName = a.plant || 'Plant';
      const unitName = a.unit || 'Common';
      const p = (plants[plantName] ||= { name: plantName, units: {} });
      const u = (p.units[unitName] ||= { name: unitName, assets: [] });
      const h = healthById[a.asset_id] || {};
      let health = num(h.health); if (health !== null && health <= 1.5) health *= 100;
      const maxZ = num(h.max_z);
      let status = 'ok';
      if ((maxZ !== null && maxZ >= 6) || (health !== null && health < 60)) status = 'critical';
      else if ((maxZ !== null && maxZ >= 3) || (health !== null && health < 80)) status = 'watch';
      u.assets.push({
        asset_id: a.asset_id, name: a.name || a.asset_id, category: a.category, group: a.group,
        running_tag: a.running_tag, tags: tagsByAsset[a.asset_id] || [], health, status,
      });
    }

    // Lay out plants on a campus grid; units in a row; assets on a small grid within a unit.
    const plantList = Object.values(plants);
    const cols = Math.ceil(Math.sqrt(plantList.length));
    const PLANT_GAP = 60;
    plantList.forEach((p, pi) => {
      p.pos = [(pi % cols) * PLANT_GAP - ((cols - 1) * PLANT_GAP) / 2, 0, Math.floor(pi / cols) * PLANT_GAP - ((cols - 1) * PLANT_GAP) / 2];
      const units = Object.values(p.units);
      p.unitList = units;
      const ucols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
      const UGAP = 30;
      units.forEach((u, ui) => {
        u.pos = [(ui % ucols) * UGAP - ((ucols - 1) * UGAP) / 2, 0, Math.floor(ui / ucols) * UGAP - ((ucols - 1) * UGAP) / 2];
        // roll up unit status = worst asset
        u.status = u.assets.reduce((s, a) => (a.status === 'critical' ? 'critical' : s === 'critical' ? 'critical' : a.status === 'watch' ? 'watch' : s), 'ok');
        const acols = Math.max(1, Math.ceil(Math.sqrt(u.assets.length)));
        const AGAP = 9;
        u.assets.forEach((a, ai) => {
          a.pos = [(ai % acols) * AGAP - ((acols - 1) * AGAP) / 2, 0, Math.floor(ai / acols) * AGAP - ((acols - 1) * AGAP) / 2];
        });
      });
      delete p.units;
    });
    return { plants: plantList, counts: { plants: plantList.length, assets: assets.length, tags: Object.values(tagsByAsset).reduce((s, l) => s + l.length, 0) } };
  });
}

// ===========================================================================
//  REAL-TIME — latest PiEvents value per tag (KQL).
//  sinceMinutes: if set, only look at that recent window (cheap, for live polling);
//  otherwise arg_max over all history so we still show the last known value pre-seeding.
// ===========================================================================
// Only Riverton (RV*) is the reference site with PI telemetry. The 8 synthetic clone
// sites mirror Riverton's tag schema: a clone tag "AS3:FOO" sources its value from
// "RV3:FOO" scaled by a deterministic per-site factor, so every facility streams live,
// independently-drifting values without needing real data for the clones.
function siteFactor(prefix) {
  let h = 0; for (let i = 0; i < prefix.length; i++) h = (h * 31 + prefix.charCodeAt(i)) | 0;
  return 0.9 + ((Math.abs(h) % 1000) / 1000) * 0.2; // 0.90 .. 1.10
}
function sourceTagOf(tag) {
  const i = String(tag).indexOf(':');
  if (i < 0) return null;
  const prefix = String(tag).slice(0, i), rest = String(tag).slice(i + 1);
  if (/^RV/i.test(prefix)) return null; // already a real Riverton tag
  const n = (prefix.match(/(\d+)/) || [])[1];
  return n ? { src: `RV${n}:${rest}`, prefix } : null;
}

async function tagValuesReal(tags, sinceMinutes) {
  const list = tags.slice(0, 400).map((t) => `"${String(t).replace(/"/g, '')}"`).join(',');
  const timeFilter = sinceMinutes ? `| where Ts > ago(${sinceMinutes}m)` : '';
  const query = `PiEvents ${timeFilter} | where Tag in (${list}) | summarize arg_max(Ts, Value, ValueType, Plant) by Tag | project Tag, Ts, val=todouble(Value), ValueType, Plant`;
  const run = async () => {
    const rows = await kq(query);
    return rows.map((r) => ({ tag: r.Tag, ts: r.Ts, value: num(r.val), valueType: r.ValueType, plant: r.Plant }));
  };
  if (sinceMinutes) return run();
  return cached('tagValues:' + list.length + ':' + hashStr(list), 20_000, run);
}

export async function tagValues(tags, sinceMinutes) {
  if (!tags || !tags.length) return [];
  const real = [], mirror = new Map(); // cloneTag -> {src, prefix}
  for (const t of tags) { const m = sourceTagOf(t); if (m) mirror.set(t, m); else real.push(t); }
  const results = [];
  if (real.length) results.push(...await tagValuesReal(real, sinceMinutes));
  if (mirror.size) {
    const srcTags = [...new Set([...mirror.values()].map((m) => m.src))];
    const srcVals = await tagValuesReal(srcTags, sinceMinutes);
    const byTag = Object.fromEntries(srcVals.map((r) => [r.tag, r]));
    for (const [cloneTag, m] of mirror) {
      const r = byTag[m.src];
      if (!r || r.value == null) continue;
      results.push({ tag: cloneTag, ts: r.ts, value: r.value * siteFactor(m.prefix), valueType: r.valueType, plant: m.prefix });
    }
  }
  return results;
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

// Per-tag baseline + variability from recent history — feeds the realtime "live-tick"
// simulator so it can drift each tag realistically around its real last-known value.
// Returns { tag: { value, mean, sd, min, max, valueType } }.
async function tagStatsReal(tags) {
  const list = tags.slice(0, 400).map((t) => `"${String(t).replace(/"/g, '')}"`).join(',');
  const query = `PiEvents | where Ts > ago(6h) | where Tag in (${list}) | extend v=todouble(Value)
    | summarize (lastTs, lastVal)=arg_max(Ts, v), avg=avg(v), sd=stdev(v), mn=min(v), mx=max(v), vt=any(ValueType) by Tag
    | project Tag, lastVal, avg, sd, mn, mx, vt`;
  const rows = await kq(query).catch(() => []);
  const out = {};
  for (const r of rows) {
    const v = num(r.lastVal);
    if (v === null) continue;
    out[r.Tag] = { value: v, mean: num(r.avg) ?? v, sd: num(r.sd) ?? 0, min: num(r.mn) ?? v, max: num(r.mx) ?? v, valueType: r.vt };
  }
  return out;
}

export async function tagStats(tags) {
  if (!tags || !tags.length) return {};
  const real = [], mirror = new Map();
  for (const t of tags) { const m = sourceTagOf(t); if (m) mirror.set(t, m); else real.push(t); }
  const out = {};
  if (real.length) Object.assign(out, await tagStatsReal(real));
  if (mirror.size) {
    const srcTags = [...new Set([...mirror.values()].map((m) => m.src))];
    const srcStats = await tagStatsReal(srcTags);
    for (const [cloneTag, m] of mirror) {
      const s = srcStats[m.src];
      if (!s) continue;
      const f = siteFactor(m.prefix);
      out[cloneTag] = { value: s.value * f, mean: s.mean * f, sd: s.sd * f, min: s.min * f, max: s.max * f, valueType: s.valueType };
    }
  }
  return out;
}

// Live fleet pulse for the realtime page header. Reports last data timestamp + whether
// a live stream is currently flowing (seeding active) vs. showing historical last-knowns.
export function realtimePulse() {
  return cached('rtpulse', 5_000, async () => {
    const rows = await kq('PiEvents | summarize lastTs=max(Ts), totalTags=dcount(Tag), plants=dcount(Plant)');
    const recent = await kq('PiEvents | where Ts > ago(5m) | summarize c=count(), tags=dcount(Tag)');
    const r = rows[0] || {}, rc = recent[0] || {};
    const lastTs = r.lastTs ? new Date(r.lastTs).getTime() : null;
    const live = lastTs !== null && Date.now() - lastTs < 5 * 60_000;
    return {
      lastTs: r.lastTs, live, totalTags: num(r.totalTags), plants: num(r.plants),
      events5m: num(rc.c) || 0, liveTags: num(rc.tags) || 0,
      eventsPerMin: (num(rc.c) || 0) / 5,
    };
  });
}

export async function tagTrend(tag, hours = 24, bin = 15) {
  const t = String(tag).replace(/"/g, '');
  const query = `PiEvents | where Ts > ago(${hours}h) | where Tag == "${t}" | summarize v=avg(todouble(Value)) by bin(Ts, ${bin}m) | order by Ts asc | project Ts, v`;
  const rows = await kq(query);
  return rows.map((r) => ({ ts: r.Ts, v: num(r.v) }));
}
