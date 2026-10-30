// ---------------------------------------------------------------------------
//  SRE demo control plane: break / reset the scenarios used to demonstrate
//  Azure SRE Agent against the OneGrid dev site (pcpro).
//
//    storage   public network access on the OneGrid storage account is disabled
//              (what the MCAPS StorageAccount_PublicNetwork_Modify policy does)
//    deploy    the site is switched to a known-bad build (run-from-package)
//    capacity  the Fabric capacity backing the workspace is suspended
//    sensor    a turbine vibration sensor flatlines at 0.0 (rows injected into
//              Eventhouse PiEvents, marked Tier == "sre-demo")
//
//  Read-only status is public; inject/reset require the SRE_DEMO_KEY header.
//  All Azure calls use the app's identity (managed identity in Azure, `az` locally).
//  Mirrors sre-demo/sre-demo.ps1 — keep the two in sync.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { getToken, kql, kqlMgmt } from './fabric.js';
import { resolveTarget } from './target.js';
import { trackTrace } from './aiTelemetry.js';
import * as live from './liveIncident.js';

const ARM = 'https://management.azure.com';
const ACTIVE_TAG = 'sre-demo-active';
// Injected telemetry is marked with this Tier so it can be found and deleted exactly.
const SENSOR_MARK = 'sre-demo';
const SENSOR_TAG = process.env.SRE_DEMO_SENSOR_TAG || 'FV1:STM.VIBR';
const SENSOR_ASSET = process.env.SRE_DEMO_SENSOR_ASSET || 'FV_U1_Steam_Turbine';

function cfg() {
  const e = process.env;
  const sub = e.SRE_DEMO_SUBSCRIPTION || '';
  const rg = e.SRE_DEMO_RESOURCE_GROUP || '';
  return {
    enabled: e.SRE_DEMO_ENABLED === '1' && !!sub && !!rg && !!e.SRE_DEMO_APP,
    key: e.SRE_DEMO_KEY || '',
    sub,
    rg,
    appId: `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${e.SRE_DEMO_APP || ''}`,
    storageId: `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Storage/storageAccounts/${e.SRE_DEMO_DATA_STORAGE || ''}`,
    goodPkg: e.SRE_DEMO_GOOD_PACKAGE || '',
    badPkg: e.SRE_DEMO_BAD_PACKAGE || '',
    capacityId: e.SRE_DEMO_CAPACITY_ID || '',
    agentUrl: e.SRE_DEMO_AGENT_URL || 'https://sre.azure.com',
  };
}

export const SCENARIOS = [
  {
    id: 'storage',
    number: '01',
    name: 'Storage access cut by policy',
    component: 'Azure Storage',
    breaks: 'Public network access on the OneGrid storage account is turned off — exactly what the MCAPS security policy does.',
    symptom: 'Silent failure: the site list and Aurora weather go empty. No errors on screen.',
    fix: 'Agent finds the configuration change in the activity log and proposes re-enabling access (plus the policy opt-out tag).',
    alerts: ['sre-demo-01-storage-config-change', 'sre-demo-01-storage-failed-requests'],
  },
  {
    id: 'deploy',
    number: '02',
    name: 'Bad deployment',
    component: 'App Service',
    breaks: 'The dev site is switched to a build with a regression in the fleet-health code.',
    symptom: 'HTTP 500s on equipment data; the executive brief shows "Equipment data is unavailable".',
    fix: 'Agent correlates the errors with the deployment and proposes rolling back to the known-good package.',
    alerts: ['sre-demo-02-pcpro-http-5xx'],
  },
  {
    id: 'capacity',
    number: '03',
    name: 'Fabric capacity paused',
    component: 'Microsoft Fabric',
    breaks: 'The Fabric capacity (ogestu) behind the OneGrid workspace is suspended.',
    symptom: 'Dashboards show "capacity paused"; every workspace on the capacity goes dark.',
    fix: 'Agent finds the capacity in a Paused state and proposes resuming it.',
    alerts: ['sre-demo-03-capacity-paused'],
    warning: 'Affects every workspace on ogestu (including production OneGrid and customer demos) until reset.',
  },
  {
    id: 'sensor',
    number: '04',
    name: 'Faulty sensor',
    component: 'Grid telemetry (Eventhouse)',
    breaks: 'The vibration sensor on the Fairview steam turbine dies and reports a flat 0.0.',
    symptom: 'The turbine looks perfectly calm — the dead sensor hides the #1 equipment risk on the executive brief.',
    fix: 'Agent reads the sensor-health findings through the OneGrid MCP server, diagnoses a failed transducer and proposes a repair work order, which you approve or reject on this page.',
    alerts: ['sre-demo-04-sensor-fault'],
  },
  {
    id: 'bearing',
    number: '05',
    name: 'Live: bearing failure → work order',
    component: 'Grid telemetry + OneGrid MCP',
    live: true,
    breaks: 'Vibration and bearing temperature on the Fairview steam turbine start climbing in real time — alarm in about 30 seconds, and OneGrid pages Azure SRE Agent the moment it trips.',
    symptom: 'OneGrid raises a high-vibration alarm; the turbine is heading for a forced outage.',
    fix: 'Agent pulls the sensor trend, root cause and asset history through the OneGrid MCP server and proposes a work order, which you approve or reject on this page.',
    alerts: ['sre-demo-05-bearing-vibration'],
  },
];

async function arm(method, path, body, apiVersion) {
  const token = await getToken(ARM);
  const sep = path.includes('?') ? '&' : '?';
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${ARM}${path}${apiVersion ? `${sep}api-version=${apiVersion}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // App Service returns 429/409 while another operation holds the site lock; back off and retry.
    if ((res.status === 429 || res.status === 409) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
  }
  if (!res.ok) throw new Error(`${method} ${path.split('/providers/').pop()} -> ${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
  }
}

async function appSettings(c) {
  return (await arm('POST', `${c.appId}/config/appsettings/list`, undefined, '2023-12-01')).properties || {};
}

async function setPackage(c, url) {
  const props = await appSettings(c);
  props.WEBSITE_RUN_FROM_PACKAGE = url;
  props.WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID = 'SystemAssigned';
  // PUT replaces the full set, so send everything back with the two keys changed.
  await arm('PUT', `${c.appId}/config/appsettings`, { properties: props }, '2023-12-01');
  // Changing the package URL alone does not always remount it; restart explicitly.
  await arm('POST', `${c.appId}/restart`, undefined, '2023-12-01');
}

async function capacityState(c) {
  return (await arm('GET', c.capacityId, undefined, '2023-11-01')).properties?.state || 'Unknown';
}

async function getActive(c) {
  const r = await arm('GET', `${c.appId}/providers/Microsoft.Resources/tags/default`, undefined, '2021-04-01');
  return r.properties?.tags?.[ACTIVE_TAG] || null;
}

// Cached active-scenario lookup for hot paths (health checks, status polling).
let activeCache = { at: 0, val: null };
async function activeCached(c) {
  if (Date.now() - activeCache.at < 60_000) return activeCache.val;
  const val = await getActive(c).catch(() => null);
  activeCache = { at: Date.now(), val };
  return val;
}

/** Work-order tag of a scenario, e.g. "sre-demo-04". */
const scenarioTag = (s) => `sre-demo-${s.number}`;

/** The scenario an agent work order belongs to: the active non-live scenario (with its start,
 *  so duplicates are only checked within this run), else the live scenario 05. */
export async function workOrderScenario() {
  const c = cfg();
  const active = c.enabled ? await getActive(c).catch(() => null) : null;
  const [id, at] = String(active || '').split('@');
  const s = SCENARIOS.find((x) => x.id === id && !x.live);
  return s ? { scenario: scenarioTag(s), since: at ? new Date(at).getTime() - 60_000 : 0 } : { scenario: live.LIVE_SCENARIO };
}

/** Drop scenario 04's agent work orders in the background (on its inject and reset). */
function clearSensorWorkOrders() {
  live.clearScenarioWorkOrders(scenarioTag(SCENARIOS.find((s) => s.id === 'sensor')))
    .catch((e) => console.warn('[sre-demo] clearing scenario 04 work orders failed:', String(e.message || e).slice(0, 160)));
}

async function setActive(c, value) {
  activeCache = { at: 0, val: null };
  const op = value
    ? { operation: 'Merge', properties: { tags: { [ACTIVE_TAG]: value } } }
    : { operation: 'Delete', properties: { tags: { [ACTIVE_TAG]: (await getActive(c)) || '' } } };
  if (!value && !op.properties.tags[ACTIVE_TAG]) return;
  await arm('PATCH', `${c.appId}/providers/Microsoft.Resources/tags/default`, op, '2021-04-01');
}

async function scenarioState(c, id) {
  if (id === 'bearing') {
    const s = await live.liveState();
    return { broken: s.running || s.readings > 0, detail: s.detail };
  }
  if (id === 'sensor') {
    const n = await injectedSensorRows();
    return { broken: n > 0, detail: n > 0 ? `${SENSOR_TAG} reporting a flat 0.0 (${n} injected readings)` : `${SENSOR_TAG} reporting normally` };
  }
  if (id === 'storage') {
    const pna = (await arm('GET', c.storageId, undefined, '2023-05-01')).properties?.publicNetworkAccess || 'Unknown';
    return { broken: pna !== 'Enabled', detail: `Public network access: ${pna}` };
  }
  if (id === 'deploy') {
    const pkg = (await appSettings(c)).WEBSITE_RUN_FROM_PACKAGE || '';
    const which = pkg === c.badPkg ? 'Bad build' : pkg === c.goodPkg ? 'Known-good build' : 'Manually deployed package';
    return { broken: pkg === c.badPkg, detail: `Running: ${which}` };
  }
  const state = await capacityState(c);
  return { broken: state !== 'Active', detail: `Capacity ogestu: ${state}` };
}

async function recentAlerts(c) {
  const path = `/subscriptions/${c.sub}/providers/Microsoft.AlertsManagement/alerts?targetResourceGroup=${encodeURIComponent(c.rg)}&timeRange=1d`;
  const r = await arm('GET', path, undefined, '2019-05-05-preview');
  return (r.value || [])
    .filter((a) => String(a.name || '').startsWith('sre-demo'))
    .map((a) => ({
      name: a.name,
      state: a.properties?.essentials?.monitorCondition || '',
      severity: a.properties?.essentials?.severity || '',
      firedAt: a.properties?.essentials?.startDateTime || null,
      resolvedAt: a.properties?.essentials?.monitorConditionResolvedDateTime || null,
    }))
    .sort((a, b) => String(b.firedAt).localeCompare(String(a.firedAt)));
}

export async function sreStatus() {
  const c = cfg();
  if (!c.enabled) return { enabled: false, scenarios: SCENARIOS };
  const [active, alerts, ...states] = await Promise.all([
    getActive(c).catch(() => null),
    recentAlerts(c).catch((e) => ({ error: String(e.message || e) })),
    ...SCENARIOS.map((s) => scenarioState(c, s.id).catch((e) => ({ broken: null, detail: `Status unavailable: ${String(e.message || e).slice(0, 160)}` }))),
  ]);
  const activeId = active ? String(active).split('@')[0] : null;
  const activeScenario = SCENARIOS.find((s) => s.id === activeId && !s.live);
  const agent = activeScenario && Array.isArray(alerts)
    ? await scenarioAgent(activeScenario, String(active).split('@')[1], alerts).catch(() => null)
    : null;
  return {
    enabled: true,
    canControl: !!c.key,
    agentUrl: c.agentUrl,
    active,
    alertsError: Array.isArray(alerts) ? null : alerts.error,
    scenarios: SCENARIOS.map((s, i) => ({
      ...s,
      ...states[i],
      alertEvents: Array.isArray(alerts) ? alerts.filter((a) => s.alerts.includes(a.name)) : [],
      ...(s === activeScenario && agent ? { agent } : {}),
    })),
    checkedAt: new Date().toISOString(),
  };
}

function keyOk(c, provided) {
  if (!c.key || !provided) return false;
  const a = Buffer.from(String(provided)), b = Buffer.from(c.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Approve / reject a work order the agent proposed (requires the demo key). */
export async function decideWorkOrder(wrId, decision, decidedBy, providedKey) {
  const c = cfg();
  if (!c.enabled) return { status: 404, body: { ok: false, message: 'The SRE demo is not enabled on this deployment.' } };
  if (!keyOk(c, providedKey)) return { status: 401, body: { ok: false, message: 'A valid demo key is required.' } };
  const who = String(decidedBy || '').trim().slice(0, 120);
  if (!/^WR-[0-9-]+$/.test(String(wrId || ''))) return { status: 400, body: { ok: false, message: 'Unknown work order id.' } };
  if (decision !== 'approve' && decision !== 'reject') return { status: 400, body: { ok: false, message: 'Decision must be approve or reject.' } };
  if (!who) return { status: 400, body: { ok: false, message: 'Enter your name to record the decision.' } };
  return live.decideWorkOrder(wrId, decision === 'approve', who);
}

// ── Deep link to the agent's investigation thread ────────────────────────────
// The SRE Agent portal opens a thread at views/thread/<id>; threads are listed through the
// agent's data-plane API. Best effort: needs SRE_DEMO_AGENT_ID and read access to the agent.
const SRE_AGENT_API = '2025-05-01-preview';
let agentEndpoint = null;
let threadCache = { at: 0, list: [] };
const ts = (v) => new Date(v || 0).getTime();

const threadLink = (agentId, id) =>
  `${(process.env.SRE_DEMO_AGENT_URL || 'https://sre.azure.com').replace(/\/$/, '')}/agents${agentId}/views/thread/${encodeURIComponent(id)}`;

/** Link to the agent's thread for this run: the thread OneGrid paged (threadId), else the
 *  newest thread opened for a scenario 05 alert or trigger since the run started. */
export async function agentThreadUrl(since, threadId) {
  const agentId = process.env.SRE_DEMO_AGENT_ID || '';
  if (!agentId) return null;
  if (threadId) return threadLink(agentId, threadId);
  const after = since ? ts(since) - 60_000 : 0;
  // Only a thread opened during this run; never link to an older investigation.
  const thread = (await agentThreads())
    .filter((t) => /sre-demo-05|onegrid-equipment-alarm/.test(String(t.title || '')) && ts(t.createdTimestamp) >= after)
    .sort((a, b) => ts(b.createdTimestamp) - ts(a.createdTimestamp))[0];
  // New SRE Agent experience (sre.azure.com): /agents<agent resource id>/views/thread/<id>.
  return thread ? threadLink(agentId, thread.id) : null;
}

/** The agent's investigation of the active (non-live) scenario's alert and any work order it
 *  proposed since, so the page can follow the run: investigating → complete → decided. A
 *  stateful alert can still be firing from before this injection, so its thread counts too. */
async function scenarioAgent(s, activeSince, alerts) {
  const agentId = process.env.SRE_DEMO_AGENT_ID || '';
  // Alert episodes that overlap this run (a stateful alert can predate the injection).
  const start = activeSince ? ts(activeSince) : Date.now();
  const fired = alerts
    .filter((a) => s.alerts.includes(a.name) && a.firedAt && (a.state === 'Fired' || ts(a.resolvedAt) >= start))
    .map((a) => ts(a.firedAt));
  const since = Math.min(start, ...fired) - 60_000;
  const thread = agentId
    ? (await agentThreads())
      .filter((t) => s.alerts.some((n) => String(t.incidentDetails?.incidentTitle || t.title || '').includes(n)) && ts(t.createdTimestamp) >= since)
      .sort((a, b) => ts(b.createdTimestamp) - ts(a.createdTimestamp))[0]
    : null;
  const records = await live.agentRecordsSince(since, scenarioTag(s)).catch(() => []);
  return {
    status: !thread ? 'waiting' : thread.incidentDetails?.investigationStatus === 'Complete' ? 'complete' : 'investigating',
    threadUrl: thread ? threadLink(agentId, thread.id) : null,
    updatedAt: thread?.modifiedTimestamp || null,
    proposal: records.find((w) => w.wr_status === live.PENDING) || null,
    decided: records.find((w) => w.wr_status !== live.PENDING) || null,
  };
}

/** The agent's threads, cached briefly (the SRE page polls). */
async function agentThreads() {
  const agentId = process.env.SRE_DEMO_AGENT_ID || '';
  if (!agentId) return [];
  if (Date.now() - threadCache.at < 15_000) return threadCache.list;
  threadCache.at = Date.now();
  try {
    agentEndpoint ||= String((await arm('GET', agentId, undefined, SRE_AGENT_API)).properties?.agentEndpoint || '').replace(/\/$/, '');
    if (!agentEndpoint) return [];
    const token = await getToken('https://azuresre.dev');
    const res = await fetch(`${agentEndpoint}/api/v1/threads`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`threads -> ${res.status}`);
    threadCache.list = (await res.json()).value || [];
  } catch (e) {
    console.warn('[sre-demo] agent thread lookup failed:', String(e.message || e).slice(0, 160));
  }
  return threadCache.list;
}

/** action: "inject" | "reset"; scenario: id or "all" (reset only). */
export async function sreControl(action, scenario, providedKey, force = false) {
  const c = cfg();
  if (!c.enabled) return { status: 404, body: { ok: false, message: 'The SRE demo is not enabled on this deployment.' } };
  if (!keyOk(c, providedKey)) return { status: 401, body: { ok: false, message: 'A valid demo key is required.' } };
  const ids = scenario === 'all' && action === 'reset' ? SCENARIOS.map((s) => s.id) : [scenario];
  if (!ids.every((id) => SCENARIOS.some((s) => s.id === id))) return { status: 400, body: { ok: false, message: `Unknown scenario: ${scenario}` } };

  if (action === 'inject') {
    const active = await getActive(c);
    if (active && !active.startsWith(`${scenario}@`) && !force) {
      return { status: 409, body: { ok: false, message: `Scenario "${active.split('@')[0]}" is already active. Reset it first.` } };
    }
    await setActive(c, `${scenario}@${new Date().toISOString().slice(0, 16)}Z`);
    if (scenario === 'storage') await arm('PATCH', c.storageId, { properties: { publicNetworkAccess: 'Disabled' } }, '2023-05-01');
    else if (scenario === 'deploy') await setPackage(c, c.badPkg);
    else if (scenario === 'sensor') { clearSensorWorkOrders(); await injectSensorFault(); }
    else if (scenario === 'bearing') await live.startLive();
    else await arm('POST', `${c.capacityId}/suspend`, undefined, '2023-11-01');
    return { status: 200, body: { ok: true, message: scenario === 'bearing' ? 'Live incident started — alarm in about 30 seconds.' : `Injected "${scenario}". Alerts usually fire within 5 minutes.` } };
  }

  for (const id of ids) {
    if (id === 'storage') await arm('PATCH', c.storageId, { properties: { publicNetworkAccess: 'Enabled' } }, '2023-05-01');
    else if (id === 'sensor') { clearSensorWorkOrders(); await clearSensorFault(); }
    else if (id === 'bearing') await live.resetLive();
    else if (id === 'deploy') {
      const pkg = (await appSettings(c)).WEBSITE_RUN_FROM_PACKAGE || '';
      if (pkg !== c.goodPkg) await setPackage(c, c.goodPkg);
    } else if ((await capacityState(c)) !== 'Active') await arm('POST', `${c.capacityId}/resume`, undefined, '2023-11-01');
  }
  const active = await getActive(c).catch(() => null);
  if (active && (scenario === 'all' || active.startsWith(`${scenario}@`))) await setActive(c, '');
  return { status: 200, body: { ok: true, message: scenario === 'all' ? 'Everything reset.' : `Reset "${scenario}".` } };
}

// ── Scenario 04: faulty sensor (grid telemetry in Eventhouse) ────────────────
function kusto() {
  const t = resolveTarget();
  if (!t.kustoUri || !t.kqlDatabase) throw new Error('Eventhouse is not configured for this deployment.');
  return t;
}

let sensorRowsCache = { at: 0, n: 0 };
async function injectedSensorRows(fresh = false) {
  if (!fresh && Date.now() - sensorRowsCache.at < 60_000) return sensorRowsCache.n;
  const t = kusto();
  const rows = await kql(t.kustoUri, t.kqlDatabase, `PiEvents | where Tier == "${SENSOR_MARK}" | count`);
  sensorRowsCache = { at: Date.now(), n: Number(rows?.[0]?.Count ?? 0) };
  return sensorRowsCache.n;
}

/** Append 60 one-minute readings of a flat 0.0 just after the newest real reading:
 *  the sensor "died an hour ago". Every injected row carries Tier == "sre-demo". */
async function injectSensorFault() {
  const t = kusto();
  await clearSensorFault();
  const rows = await kql(t.kustoUri, t.kqlDatabase, 'PiEvents | summarize a = max(Timestamp)');
  const anchor = new Date(rows?.[0]?.a ?? Date.now()).getTime();
  const lines = [];
  for (let i = 1; i <= 60; i++) {
    lines.push(`${new Date(anchor + i * 60_000).toISOString()},${SENSOR_TAG},${SENSOR_ASSET},0,${SENSOR_MARK}`);
  }
  await kqlMgmt(t.kustoUri, t.kqlDatabase, `.ingest inline into table PiEvents with (format="csv") <|\n${lines.join('\n')}`);
  sensorRowsCache = { at: 0, n: 0 };
}

async function clearSensorFault() {
  const t = kusto();
  await kqlMgmt(t.kustoUri, t.kqlDatabase, `.delete table PiEvents records <| PiEvents | where Tier == "${SENSOR_MARK}"`);
  sensorRowsCache = { at: 0, n: 0 };
}

const lastTrace = new Map(); // tag -> epoch ms, throttles App Insights traces

/** Flatline detector: any sensor with 10+ readings in the newest hour and zero variance.
 *  Public + read-only; the availability test alerts when faultySensors > 0. The scan only
 *  runs while scenario 04 is active, so the 5-minute health probes don't load the Eventhouse. */
export async function sensorHealth() {
  const c = cfg();
  if (c.enabled) {
    const active = await activeCached(c);
    if (!active || !active.startsWith('sensor@')) {
      return { faultySensors: 0, sensors: [], checkedAt: new Date().toISOString(), note: 'Scan runs only while the faulty-sensor scenario is active.' };
    }
  }
  const t = kusto();
  const rows = await kql(t.kustoUri, t.kqlDatabase, `let a = toscalar(PiEvents | summarize max(Timestamp));
    PiEvents | where Timestamp > a - 60m
    | summarize n = count(), sd = stdev(Value), v = avg(Value), since = min(Timestamp), latest = max(Timestamp) by Tag, AssetId
    | where n >= 10 and sd == 0`);
  const sensors = (rows || []).map((r) => ({
    tag: r.Tag, assetId: r.AssetId, value: Number(r.v), readings: Number(r.n), since: r.since, latest: r.latest,
  }));
  for (const s of sensors) {
    const prev = lastTrace.get(s.tag) || 0;
    if (Date.now() - prev < 5 * 60_000) continue;
    lastTrace.set(s.tag, Date.now());
    await trackTrace(
      `Sensor fault: ${s.tag} on ${s.assetId} has been flatlined at ${s.value.toFixed(2)} for ${s.readings} consecutive readings (since ${s.since}). ` +
        'A healthy vibration signal is never perfectly constant, so this indicates a failed transducer, cable or I/O card. ' +
        'The equipment is effectively unmonitored: its vibration-based failure risk cannot be trusted until the sensor is repaired.',
      { sensorTag: s.tag, assetId: s.assetId, flatValue: String(s.value), readings: String(s.readings), since: String(s.since), scenario: 'sre-demo-04' },
    );
  }
  return { faultySensors: sensors.length, sensors, checkedAt: new Date().toISOString() };
}
