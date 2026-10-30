// ---------------------------------------------------------------------------
//  SRE demo scenario 05 — live bearing failure → agent-created work order.
//
//  startLive() streams 1-second readings for the Fairview Unit 1 steam turbine:
//  vibration (FV1:STM.VIBR) and bearing metal temperature (FV1:STM.BRG_TEMP)
//  sit at their real last-known values for 5 s, then climb together so the
//  vibration alarm trips ~30 s after start and keeps worsening (bearing wear).
//
//    • readings are written to Eventhouse PiEvents every 5 s (Tier "sre-live"),
//      timestamped just after the newest real reading, so every OneGrid view and
//      the agent's MCP tools see the same data;
//    • every 5 s a custom metric goes to Application Insights (the alert rule
//      sre-demo-05-bearing-vibration fires on it) and an error trace is sent when
//      the alarm trips;
//    • the realtime WebSocket (3D twin) shows the live value via liveValue().
//
//  Work orders the Azure SRE Agent creates (via the OneGrid MCP server) land in
//  Eventhouse table AgentWorkOrders and are merged into the work-order APIs.
//  resetLive() deletes every row this scenario wrote.
// ---------------------------------------------------------------------------
import { kql, kqlMgmt } from './fabric.js';
import { resolveTarget } from './target.js';
import { trackTrace, trackMetrics } from './aiTelemetry.js';

export const MARK = 'sre-live';
export const LIVE = {
  assetId: process.env.SRE_LIVE_ASSET || 'FV_U1_Steam_Turbine',
  assetName: 'Fairview Unit 1 steam turbine',
  vibTag: process.env.SRE_LIVE_VIB_TAG || 'FV1:STM.VIBR',
  tempTag: process.env.SRE_LIVE_TEMP_TAG || 'FV1:STM.BRG_TEMP',
  vibAlarm: 11.0, // mm/s RMS — ISO 10816-2 zone C/D boundary for a large steam turbine
  vibTrip: 14.0,
  rampStartSec: 5,
  rampEndSec: 30,
  maxRunMs: 30 * 60_000,
};
const WO_TABLE = 'AgentWorkOrders';

let run = null;          // in-memory state of the current/last run
let woRows = null;       // agent work orders, in memory (see agentWorkOrders)
let woLoadAt = 0;
let woPersist = Promise.resolve(); // chain of background work-order writes
let woTableReady = false;
let restoreTried = false;
// Eventhouse clean-up runs in the background so Start/Reset respond instantly even when
// Fabric is throttling. A new run's writes wait for any clean-up queued before it.
let cleanup = Promise.resolve();
let knownClean = false;  // true once we know no demo rows remain
let hideWoBefore = 0;    // agent work orders created before the last start/reset are hidden at once
let baselineCache = null;
let baselinePending = null;

function kusto() {
  const t = resolveTarget();
  if (!t.kustoUri || !t.kqlDatabase) throw new Error('Eventhouse is not configured for this deployment.');
  return t;
}
/** Retry Eventhouse calls that are throttled (HTTP 429) or hit a transient network error. */
export async function withRetry(fn, attempts = 4) {
  let delay = 1500;
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.message || e);
      if (i >= attempts || !/429|throttl|ENOTFOUND|ECONNRESET|ETIMEDOUT|503/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
      delay *= 2;
    }
  }
}
const kq = (q) => { const t = kusto(); return withRetry(() => kql(t.kustoUri, t.kqlDatabase, q)); };
const mgmt = (q) => { const t = kusto(); return withRetry(() => kqlMgmt(t.kustoUri, t.kqlDatabase, q), 6); };

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Deterministic failure shape + sensor noise for elapsed second e. */
function profile(e, r) {
  const { rampStartSec: a, rampEndSec: b, vibAlarm } = LIVE;
  const vPeak = vibAlarm + 0.6;
  const p = clamp01((e - a) / (b - a));
  let vib = e <= b ? r.baseVib + (vPeak - r.baseVib) * Math.pow(p, 1.8)
    : vPeak + 1.8 * (1 - Math.exp(-(e - b) / 120));
  // Bearing metal temperature lags vibration by a few seconds (frictional heating).
  const tPeak = r.tempAlarm + 2;
  const q = clamp01((e - a - 3) / (b - a + 8));
  let temp = e <= b + 11 ? r.baseTemp + (tPeak - r.baseTemp) * Math.pow(q, 1.6)
    : tPeak + 7 * (1 - Math.exp(-(e - b - 11) / 120));
  vib += 0.07 * gaussian() + (e > b ? 0.12 * Math.sin(e / 3) : 0);
  temp += 0.18 * gaussian();
  return { vib: Number(vib.toFixed(3)), temp: Number(temp.toFixed(2)) };
}

function csvRow(ts, tag, value) { return `${ts},${tag},${LIVE.assetId},${value},${MARK}`; }

/** Write buffered readings for run r. Each run owns its buffer, so a reset or restart
 *  can discard/await in-flight writes without racing a newer run. */
function flush(r = run) {
  if (!r || r.flushing || !r.pending.length || r.discard) return r?.flushing || Promise.resolve();
  const lines = r.pending.splice(0);
  r.flushing = (async () => {
    try {
      await r.gate; // never write before the clean-up queued ahead of this run
      if (r.discard) return;
      await mgmt(`.ingest inline into table PiEvents with (format="csv") <|\n${lines.join('\n')}`);
      r.flushed += lines.length;
      r.lastError = null;
    } catch (e) {
      r.lastError = String(e.message || e).slice(0, 200);
      if (!r.discard && r.pending.length < 2000) r.pending.unshift(...lines); // retry next flush
    } finally { r.flushing = null; }
  })();
  return r.flushing;
}

function alarmMessage(pt) {
  const r = run;
  const rate = r.points.length > 6 ? (pt.vib - r.points[r.points.length - 6].vib) / 5 : 0;
  return `High vibration alarm on ${LIVE.assetName} (${LIVE.assetId}): ${LIVE.vibTag} = ${pt.vib.toFixed(2)} mm/s ` +
    `(alarm ${LIVE.vibAlarm}, trip ${LIVE.vibTrip}, baseline ${r.baseVib.toFixed(2)}) and rising ${rate.toFixed(2)} mm/s per second; ` +
    `bearing metal temperature ${LIVE.tempTag} = ${pt.temp.toFixed(1)} °C (alarm ${r.tempAlarm}, baseline ${r.baseTemp.toFixed(1)}) and rising. ` +
    'Vibration and bearing temperature climbing together is the signature of outboard bearing wear. ' +
    'Use the OneGrid MCP tools to confirm the trend and asset history, then propose a corrective work order for approval.';
}

function tick() {
  if (!run || run.stoppedAt) return;
  const now = Date.now();
  if (now - run.startedAt > LIVE.maxRunMs) { stopLive('auto-stop after 30 minutes'); return; }
  const e = (now - run.startedAt) / 1000;
  const { vib, temp } = profile(e, run);
  const ts = new Date(run.anchorMs + (now - run.startedAt)).toISOString();
  const pt = { e: Math.round(e * 10) / 10, ts, vib, temp };
  run.points.push(pt);
  if (run.points.length > 2400) run.points.shift();
  run.pending.push(csvRow(ts, LIVE.vibTag, vib), csvRow(ts, LIVE.tempTag, temp));

  const props = { assetId: LIVE.assetId, scenario: 'sre-demo-05' };
  if (now - run.lastMetricAt >= 5000) {
    run.lastMetricAt = now;
    trackMetrics([
      { name: LIVE.vibTag, value: vib, properties: { ...props, tag: LIVE.vibTag, units: 'mm/s', alarm: String(LIVE.vibAlarm) } },
      { name: LIVE.tempTag, value: temp, properties: { ...props, tag: LIVE.tempTag, units: 'degC', alarm: String(run.tempAlarm) } },
    ]);
  }
  if (vib >= LIVE.vibAlarm && (!run.alarmAt || now - run.lastAlarmTraceAt > 120_000)) {
    if (!run.alarmAt) run.alarmAt = now;
    run.lastAlarmTraceAt = now;
    trackTrace(alarmMessage(pt), { ...props, sensorTag: LIVE.vibTag, value: String(vib), bearingTemp: String(temp), alarm: String(LIVE.vibAlarm) }, 3);
  }
  if (!run.tempAlarmAt && temp >= run.tempAlarm) run.tempAlarmAt = now;
}

function stopLive(reason, r = run) {
  if (!r || r.stoppedAt) return;
  clearInterval(r.tickTimer); clearInterval(r.flushTimer);
  r.stoppedAt = Date.now();
  r.stopReason = reason;
  flush(r);
}

async function deleteReadings() {
  await mgmt(`.delete table PiEvents records <| PiEvents | where Tier == "${MARK}"`);
}

/** Queue deletion of demo rows (and agent work orders) after any in-flight write lands. */
function scheduleCleanup(inflight) {
  const cutoff = new Date(hideWoBefore || Date.now()).toISOString();
  const job = async () => {
    if (inflight) await inflight.catch(() => {});
    await woPersist; // a work-order write must land before we delete it
    await deleteReadings();
    await ensureWoTable();
    // Only work orders from before this start/reset: one created since then must survive.
    await mgmt(`.delete table ${WO_TABLE} records <| ${WO_TABLE} | where Tier == "${MARK}" and create_date < datetime(${cutoff})`);
    if (!run) knownClean = true;
  };
  cleanup = cleanup.then(job, job).catch((e) => console.warn('[sre-live] clean-up failed:', String(e.message || e).slice(0, 200)));
  return cleanup;
}

/** Stop run r, drop its unwritten readings, and return its in-flight write (if any). */
function retire(r, reason) {
  if (!r) return null;
  r.discard = true;
  r.pending = [];
  stopLive(reason, r);
  return r.flushing || null;
}

/** Anchor (newest real reading) + last-known values; cached so Start is instant. */
function getBaseline() {
  if (baselineCache && Date.now() - baselineCache.at < 60 * 60_000) return Promise.resolve(baselineCache);
  baselinePending ||= (async () => {
    const rows = await kq(`let hist = PiEvents | where not(Tier startswith "sre-");
      let a = toscalar(hist | summarize max(Timestamp));
      hist | where Timestamp > a - 6h and Tag in ("${LIVE.vibTag}", "${LIVE.tempTag}")
      | summarize arg_max(Timestamp, Value) by Tag | extend anchor = a | project Tag, v = todouble(Value), anchor`);
    if (!rows?.[0]?.anchor) throw new Error('No historian data found for the turbine.');
    const by = Object.fromEntries(rows.map((r) => [r.Tag, r]));
    let baseVib = Number(by[LIVE.vibTag]?.v);
    if (!Number.isFinite(baseVib) || baseVib >= LIVE.vibAlarm - 1.5) baseVib = 7.4;
    let baseTemp = Number(by[LIVE.tempTag]?.v);
    if (!Number.isFinite(baseTemp)) baseTemp = 82;
    baselineCache = { at: Date.now(), anchorMs: new Date(rows[0].anchor).getTime(), baseVib, baseTemp };
    return baselineCache;
  })().finally(() => { baselinePending = null; });
  return baselinePending;
}

let starting = null;
export function startLive() {
  if (run && !run.stoppedAt) return Promise.resolve();
  starting ||= startLiveInner().finally(() => { starting = null; });
  return starting;
}

async function startLiveInner() {
  const b = await getBaseline();
  const prev = run;
  run = null;
  restoreTried = true;
  hideWoBefore = Date.now();
  const inflight = retire(prev, 'restarted');
  if (prev || !knownClean) scheduleCleanup(inflight);
  knownClean = false;
  run = {
    startedAt: Date.now(), anchorMs: b.anchorMs, baseVib: b.baseVib, baseTemp: b.baseTemp,
    tempAlarm: Math.max(107, Math.ceil(b.baseTemp + 15)),
    points: [], pending: [], flushed: 0, lastMetricAt: 0, lastAlarmTraceAt: 0,
    alarmAt: null, tempAlarmAt: null, stoppedAt: null, stopReason: null, lastError: null,
    gate: cleanup,
  };
  if (woRows) woRows = woRows.filter((w) => new Date(w.create_date).getTime() >= hideWoBefore);
  const r = run;
  r.tickTimer = setInterval(tick, 1000);
  r.flushTimer = setInterval(() => flush(r), 10_000);
  tick();
  trackTrace(`Live incident demo started on ${LIVE.assetName}: streaming ${LIVE.vibTag} and ${LIVE.tempTag}.`, { assetId: LIVE.assetId, scenario: 'sre-demo-05' }, 1);
}

/** Stops the stream and hides agent work orders immediately; Eventhouse rows are deleted in the background. */
export async function resetLive() {
  if (starting) await starting.catch(() => {});
  const prev = run;
  run = null;
  restoreTried = true;
  hideWoBefore = Date.now();
  if (woRows) woRows = woRows.filter((w) => new Date(w.create_date).getTime() >= hideWoBefore);
  scheduleCleanup(retire(prev, 'reset'));
}

/** Warm the baseline cache (called while the SRE page is open and idle). */
export function prefetchLive() {
  getBaseline().catch(() => {});
}

/** After an app restart the in-memory run is gone; rebuild the chart from Eventhouse. */
async function restoreFromEventhouse() {
  if (run || restoreTried) return;
  restoreTried = true;
  const rows = await kq(`PiEvents | where Tier == "${MARK}"
    | summarize vib = take_anyif(Value, Tag == "${LIVE.vibTag}"), temp = take_anyif(Value, Tag == "${LIVE.tempTag}") by Timestamp
    | order by Timestamp asc | take 2400`).catch(() => null);
  if (rows && !rows.length) knownClean = true;
  if (!rows?.length || run) return;
  const t0 = new Date(rows[0].Timestamp).getTime();
  const points = rows.map((r) => ({ e: (new Date(r.Timestamp).getTime() - t0) / 1000, ts: r.Timestamp, vib: Number(r.vib), temp: Number(r.temp) }));
  const firstAlarm = points.find((p) => p.vib >= LIVE.vibAlarm);
  const startedAt = Date.now() - points[points.length - 1].e * 1000;
  run = {
    startedAt, anchorMs: t0, baseVib: points[0].vib, baseTemp: points[0].temp,
    tempAlarm: 107, points, pending: [], flushed: rows.length * 2, alarmAt: firstAlarm ? startedAt + firstAlarm.e * 1000 : null,
    stoppedAt: Date.now(), stopReason: 'restored after app restart', restored: true,
  };
}

/** Latest live value for a tag (used by the realtime WebSocket), else null. */
export function liveValue(tag) {
  if (!run || !run.points.length || (tag !== LIVE.vibTag && tag !== LIVE.tempTag)) return null;
  const p = run.points[run.points.length - 1];
  return tag === LIVE.vibTag ? p.vib : p.temp;
}

function stageOf(r, wos) {
  if (!r) return 'idle';
  const last = r.points[r.points.length - 1];
  if (wos.some((w) => new Date(w.create_date).getTime() >= r.startedAt - 60_000)) return 'work-order';
  if (r.alarmAt || (last && last.vib >= LIVE.vibAlarm)) return 'alarm';
  if (last && last.vib >= r.baseVib + 0.8) return 'rising';
  return 'normal';
}

export async function liveState() {
  if (!run) await restoreFromEventhouse();
  const r = run;
  if (!r) return { running: false, readings: 0, detail: 'Turbine running normally — no live incident' };
  const last = r.points[r.points.length - 1];
  const v = last ? `vibration ${last.vib.toFixed(1)} mm/s, bearing ${last.temp.toFixed(0)} °C` : 'starting';
  return {
    running: !r.stoppedAt,
    readings: r.points.length * 2,
    detail: r.stoppedAt ? `Stream stopped (${r.stopReason}); ${v}. Reset to clear.` : `Streaming live: ${v}`,
  };
}

/** Public, read-only status for the SRE page chart. */
export async function liveStatus(maxPoints = 240) {
  if (!run) await restoreFromEventhouse();
  const wos = await agentWorkOrders().catch(() => []);
  const r = run;
  const base = {
    asset: { id: LIVE.assetId, name: LIVE.assetName },
    tags: { vibration: LIVE.vibTag, bearingTemp: LIVE.tempTag },
    thresholds: { vibAlarm: LIVE.vibAlarm, vibTrip: LIVE.vibTrip, tempAlarm: r?.tempAlarm ?? 107 },
    workOrders: wos,
    checkedAt: new Date().toISOString(),
  };
  if (!r) { prefetchLive(); return { ...base, running: false, stage: 'idle', points: [] }; }
  const pts = r.points.slice(-maxPoints);
  return {
    ...base,
    running: !r.stoppedAt,
    stage: stageOf(r, wos),
    startedAt: new Date(r.startedAt).toISOString(),
    stoppedAt: r.stoppedAt ? new Date(r.stoppedAt).toISOString() : null,
    stopReason: r.stopReason,
    elapsedSec: Math.round(((r.stoppedAt || Date.now()) - r.startedAt) / 1000),
    alarmAt: r.alarmAt ? new Date(r.alarmAt).toISOString() : null,
    alarmAfterSec: r.alarmAt ? Math.round((r.alarmAt - r.startedAt) / 1000) : null,
    baseline: { vib: r.baseVib, temp: r.baseTemp },
    latest: pts[pts.length - 1] || null,
    points: pts,
    written: r.flushed,
    writeError: r.lastError || null,
  };
}

// ── Agent-created work orders (Eventhouse table AgentWorkOrders) ─────────────
async function ensureWoTable() {
  if (woTableReady) return;
  await mgmt(`.create-merge table ${WO_TABLE} (wr_id:string, create_date:datetime, asset_id:string, asset_name:string, site_name:string, unit:string,
    problem_descr:string, recommendation:string, evidence:string, priority:string, priority_code:int, wr_type:string, wr_status:string,
    created_by:string, approved_by:string, Tier:string)`);
  woTableReady = true;
}

function shapeWo(r) {
  return {
    wr_id: r.wr_id, problem_descr: r.problem_descr, entity_descr: r.asset_name, parent_descr: r.asset_name,
    location: [r.site_name, r.unit].filter(Boolean).join(' · '), site_name: r.site_name, asset_id: r.asset_id,
    wr_type: r.wr_type, wr_status: r.wr_status, wr_status_id: 'READY', status: r.wr_status, status_id: 'READY',
    type: r.wr_type, problem: r.problem_descr, entity: r.asset_name,
    priority: r.priority, priority_code: Number(r.priority_code), priority_rank: Number(r.priority_code),
    create_date: r.create_date, update_date: r.create_date, open: true, site: r.site_name,
    recommendation: r.recommendation, evidence: r.evidence, created_by: r.created_by, approved_by: r.approved_by,
    source: 'sre-agent',
  };
}

/** Open work orders created by the agent since the last start/reset, newest first.
 *  Held in memory: loaded from Eventhouse once per process (so they survive restarts),
 *  then updated on create/reset — status polling never queries Eventhouse. */
export async function agentWorkOrders() {
  if (!woRows && Date.now() - woLoadAt > 60_000) {
    woLoadAt = Date.now();
    try {
      await ensureWoTable();
      const rows = await kq(`${WO_TABLE} | where Tier == "${MARK}" | order by create_date desc | take 50`);
      woRows ||= rows.map(shapeWo);
    } catch { /* retry on a later call */ }
  }
  return (woRows || []).filter((w) => new Date(w.create_date).getTime() >= hideWoBefore);
}

const PRIORITIES = { emergency: [1, '1 - Emergency'], urgent: [2, '2 - Urgent'], high: [3, '3 - High'], routine: [4, '4 - Routine'] };
const csvField = (s) => `"${String(s ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""').slice(0, 4000)}"`;

/** Create a corrective work order. `asset` = { name, plant, unit } resolved by the caller. */
export async function createWorkOrder({ assetId, asset, problem, recommendation, evidence, priority, approvedBy, createdBy }) {
  const existing = (await agentWorkOrders()).find((w) => w.asset_id === assetId && Date.now() - new Date(w.create_date).getTime() < 2 * 3600_000);
  if (existing) return { created: false, duplicate: true, workOrder: existing };
  const [code, label] = PRIORITIES[String(priority || 'urgent').toLowerCase()] || PRIORITIES.urgent;
  const now = new Date();
  const rec = {
    wr_id: `WR-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${String(now.getTime()).slice(-4)}`,
    create_date: now.toISOString(), asset_id: assetId, asset_name: asset?.name || assetId,
    site_name: asset?.plant || '', unit: asset?.unit || '', problem_descr: problem, recommendation, evidence,
    priority: label, priority_code: code, wr_type: 'Corrective', wr_status: 'Ready to schedule',
    created_by: createdBy || 'Azure SRE Agent', approved_by: approvedBy, Tier: MARK,
  };
  const row = Object.entries(rec).map(([k, v]) => (k === 'create_date' || k === 'priority_code' ? String(v) : csvField(v))).join(',');
  const wo = shapeWo(rec);
  woRows = [wo, ...(woRows || [])];
  // Visible immediately; persisted in the background (retries ride out Fabric throttling).
  woPersist = woPersist.then(() => ensureWoTable())
    .then(() => mgmt(`.ingest inline into table ${WO_TABLE} with (format="csv") <|\n${row}`))
    .catch((e) => console.warn('[sre-live] work order not persisted:', String(e.message || e).slice(0, 200)));
  trackTrace(`Work order ${rec.wr_id} created by ${rec.created_by} for ${assetId} (${label}), approved by ${approvedBy}: ${problem}`,
    { assetId, workOrder: rec.wr_id, scenario: 'sre-demo-05' }, 1);
  return { created: true, workOrder: wo };
}

// ── Merge helpers for the existing work-order endpoints ──────────────────────
export async function mergeWorkOrders(rows) {
  const extra = await agentWorkOrders().catch(() => []);
  return extra.length ? [...extra, ...(rows || [])] : rows;
}

export async function mergeWorkOrdersSummary(sum) {
  const extra = await agentWorkOrders().catch(() => []);
  if (!extra.length || !sum) return sum;
  const n = extra.length;
  const bump = (list, label, more = {}) => {
    const out = (list || []).map((x) => ({ ...x }));
    const hit = out.find((x) => x.label === label);
    if (hit) hit.n += 1; else out.push({ label, n: 1, ...more });
    return out;
  };
  let out = { ...sum, open: (sum.open || 0) + n, total: (sum.total || 0) + n, backlog: (sum.backlog || 0) + n };
  for (const w of extra) {
    out = {
      ...out,
      byStatus: bump(out.byStatus, w.wr_status),
      byType: bump(out.byType, w.wr_type),
      byPriority: bump(out.byPriority, w.priority, { rank: w.priority_rank }),
      bySite: bump(out.bySite, w.site_name),
    };
  }
  out.agentCreated = n;
  return out;
}

export async function mergeAssetWorkOrders(assetId, res) {
  const extra = (await agentWorkOrders().catch(() => [])).filter((w) => w.asset_id === assetId);
  if (!extra.length || !res) return res;
  return { ...res, open: (res.open || 0) + extra.length, rows: [...extra, ...(res.rows || [])] };
}
