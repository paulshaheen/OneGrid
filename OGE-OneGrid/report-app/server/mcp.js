// ---------------------------------------------------------------------------
//  OneGrid MCP server (Streamable HTTP, stateless) for the Azure SRE Agent.
//
//  POST /mcp  JSON-RPC 2.0 (single message or batch), JSON responses only.
//  Auth: header  x-api-key: <SRE_MCP_KEY>  (or  Authorization: Bearer <key>).
//  Disabled (404) unless SRE_MCP_KEY is set.
//
//  Tools give the agent the operational context an SRE has in OneGrid: active
//  equipment alarms, sensor trends, asset health/root cause/history, open work,
//  and proposing a corrective work order that a human approves in OneGrid.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import * as api from './dataApi.js';
import { kql } from './fabric.js';
import { resolveTarget } from './target.js';
import * as live from './liveIncident.js';
import * as sre from './sreDemo.js';

const SERVER_INFO = { name: 'onegrid', title: 'OneGrid operations', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const UNITS = { VIBR: 'mm/s', BRG_TEMP: 'degC', TEMP: 'degC', RPM: 'rpm', PRESS: 'bar', MW: 'MW' };
const unitsOf = (tag) => { const k = Object.keys(UNITS).find((u) => String(tag).toUpperCase().includes(u)); return k ? UNITS[k] : ''; };
const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_:.\-]/g, '');
const CLOCK_NOTE = 'OneGrid replays a historian dataset, so raw telemetry timestamps are on a replay clock (mid-2026). ' +
  'The newest reading is the live one (now); use the relative ages in this response, not the replay dates.';

const INSTRUCTIONS = 'OneGrid is the operations platform for a fleet of power plants and offshore assets. ' +
  'For equipment alarms use get_active_alarms first; for sensor-fault alerts use get_sensor_health first. Then use get_sensor_trend and get_asset_context to diagnose. ' +
  'Submit your corrective work order with propose_work_order: a human approves or rejects it in OneGrid, so do not ask for approval in the conversation.';

const TOOLS = [
  {
    name: 'get_active_alarms',
    title: 'Active equipment alarms',
    description: 'Equipment alarms currently active in OneGrid (live process alarms on sensors), with the latest readings, thresholds, when the alarm tripped, and any work order already raised.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_sensor_health',
    title: 'Faulty (flatlined) sensors',
    description: 'Sensor-health scan of the newest hour of telemetry: sensors that report a constant value (zero variance over 10+ readings), i.e. a dead transducer or signal channel. ' +
      'For each faulty sensor: tag, asset, the flat value, how many readings and since when. This is what the sre-demo-04-sensor-fault alert checks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_sensor_trend',
    title: 'Sensor trend for an asset',
    description: 'Per-sensor statistics and a downsampled time series for one asset over the most recent N minutes of telemetry (OneGrid Eventhouse PiEvents), compared with the prior 6-hour baseline. Use it to confirm whether readings are rising, how fast, and which sensors moved together.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'OneGrid asset id, e.g. FV_U1_Steam_Turbine' },
        minutes: { type: 'integer', minimum: 5, maximum: 240, default: 15, description: 'Window size in minutes ending at the newest reading' },
      },
      required: ['asset_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_asset_context',
    title: 'Asset health, root cause and history',
    description: 'Health and failure-risk context for an asset: identity and location, ML root-cause analysis, short/long-term failure predictions, top watchlist sensors, and open work orders.',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string', description: 'OneGrid asset id, e.g. FV_U1_Steam_Turbine' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_work_orders',
    title: 'Open work orders for an asset',
    description: 'Open maintenance work orders for an asset (including ones raised by the SRE agent), highest priority first.',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'propose_work_order',
    title: 'Propose a corrective work order',
    description: 'Submit a corrective maintenance work order for human approval. It appears at once on the OneGrid SRE page as "Pending approval" with Approve / Reject buttons; ' +
      'only once a human approves it there does it become a real work order (Maintenance page, executive brief). Do not ask for approval in the conversation. ' +
      'If a proposal is already pending, or an approved agent work order already exists for the asset, that one is returned instead of creating a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'OneGrid asset id' },
        problem: { type: 'string', description: 'One-line problem statement for the work order title, e.g. "Outboard bearing wear — vibration 11.6 mm/s and rising"' },
        recommendation: { type: 'string', description: 'The corrective work to perform and any interim operating limits' },
        evidence: { type: 'string', description: 'Key evidence: readings, rates of change, thresholds, history' },
        priority: { type: 'string', enum: ['emergency', 'urgent', 'high', 'routine'], default: 'urgent' },
      },
      required: ['asset_id', 'problem', 'recommendation'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function slim(rows, n, maxLen = 300) {
  return (rows || []).slice(0, n).map((r) => Object.fromEntries(
    Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '' && String(v).length <= maxLen),
  ));
}

async function getActiveAlarms() {
  const s = await live.liveStatus(1);
  const alarms = [];
  if (s.latest && (s.latest.vib >= s.thresholds.vibAlarm || s.latest.temp >= s.thresholds.tempAlarm)) {
    alarms.push({
      asset_id: s.asset.id, asset_name: s.asset.name,
      alarm: s.latest.vib >= s.thresholds.vibAlarm ? 'High vibration' : 'High bearing temperature',
      tripped_at: s.alarmAt, stream_running: s.running,
      readings: [
        { tag: s.tags.vibration, value: s.latest.vib, units: 'mm/s', alarm: s.thresholds.vibAlarm, trip: s.thresholds.vibTrip, baseline: s.baseline?.vib },
        { tag: s.tags.bearingTemp, value: s.latest.temp, units: 'degC', alarm: s.thresholds.tempAlarm, baseline: s.baseline?.temp },
      ],
      reading_time: s.running ? new Date().toISOString() : s.stoppedAt,
      seconds_since_trip: s.alarmAt ? Math.round((Date.now() - new Date(s.alarmAt).getTime()) / 1000) : null,
      work_orders: [...(s.proposal ? [s.proposal] : []), ...s.workOrders].filter((w) => w.asset_id === s.asset.id).map((w) => ({ wr_id: w.wr_id, problem: w.problem_descr, status: w.wr_status, priority: w.priority, approved_by: w.approved_by || null })),
    });
  }
  return { alarm_count: alarms.length, alarms, checked_at: s.checkedAt };
}

async function getSensorTrend({ asset_id, minutes = 15 }) {
  const id = safeId(asset_id);
  const m = Math.max(5, Math.min(240, Number(minutes) || 15));
  const binSec = Math.max(10, Math.round((m * 60) / 30));
  const t = resolveTarget();
  if (!t.kustoUri) throw new Error('Eventhouse is not configured.');
  const q = (body) => live.withRetry(() => kql(t.kustoUri, t.kqlDatabase, `let id = "${id}";
    let a = toscalar(PiEvents | where AssetId == id | summarize max(Timestamp));
    let w = PiEvents | where AssetId == id and Timestamp > a - ${m}m;
    ${body}`));
  const [stats, series] = await Promise.all([
    q(`let base = PiEvents | where AssetId == id and Timestamp between ((a - ${m}m - 6h) .. (a - ${m}m)) | summarize baseline = avg(Value), baseline_sd = stdev(Value) by Tag;
      w | summarize (latest_ts, latest) = arg_max(Timestamp, Value), (first_ts, first_v) = arg_min(Timestamp, Value), lo = min(Value), hi = max(Value), readings = count() by Tag
      | join kind=leftouter base on Tag | project-away Tag1 | order by Tag asc`),
    q(`w | summarize v = round(avg(Value), 3) by Tag, Ts = bin(Timestamp, ${binSec}s) | order by Tag asc, Ts asc`),
  ]);
  if (!stats.length) return { asset_id: id, message: 'No telemetry found for this asset id.' };
  const newest = stats.reduce((mx, s) => (String(s.latest_ts) > mx ? String(s.latest_ts) : mx), '');
  const newestMs = new Date(newest).getTime();
  const byTag = {};
  for (const r of series) (byTag[r.Tag] ||= []).push([Math.round((new Date(r.Ts).getTime() - newestMs) / 1000), Number(r.v)]);
  const r3 = (x) => (x === null || x === undefined || x === '' ? null : Math.round(Number(x) * 1000) / 1000);
  return {
    asset_id: id,
    window_minutes: m,
    clock_note: CLOCK_NOTE,
    newest_reading_replay_time: newest,
    series_format: '[seconds relative to the newest reading (0 = now), value]',
    sensors: stats.map((s) => {
      const spanMin = (new Date(s.latest_ts) - new Date(s.first_ts)) / 60000;
      const z = s.baseline_sd ? (Number(s.latest) - Number(s.baseline)) / Number(s.baseline_sd) : null;
      return {
        tag: s.Tag, units: unitsOf(s.Tag), latest: r3(s.latest),
        latest_age_seconds: Math.round((newestMs - new Date(s.latest_ts).getTime()) / 1000),
        window_first: r3(s.first_v), window_min: r3(s.lo), window_max: r3(s.hi), readings: Number(s.readings),
        change_per_minute: spanMin > 0 ? r3((Number(s.latest) - Number(s.first_v)) / spanMin) : null,
        baseline_6h_avg: r3(s.baseline), baseline_6h_sd: r3(s.baseline_sd), z_vs_baseline: z === null ? null : Math.round(z * 10) / 10,
        series: byTag[s.Tag] || [],
      };
    }),
  };
}

async function getAssetContext({ asset_id }) {
  const id = safeId(asset_id);
  const [d, wo] = await Promise.all([api.assetDetail(id), listWorkOrders({ asset_id: id }).catch(() => null)]);
  if (!d.asset) return { asset_id: id, message: 'Unknown asset id.' };
  const a = d.asset;
  return {
    asset: { asset_id: id, name: a.name || a.asset_display_name, plant: a.plant, unit: a.unit, category: a.equipment_category, group: a.equipment_group, region: a.region },
    root_cause: slim(d.rootCause, 3),
    predictions_short_term: slim(d.predShort, 2),
    predictions_long_term: slim(d.predLong, 2),
    watchlist_top: slim(d.watchlist, 5),
    sensors: (d.tags || []).filter((t) => !t.synthetic).slice(0, 12).map((t) => ({ tag: t.tag, description: t.desc, units: t.units || unitsOf(t.tag), role: t.role, last_value: t.value })),
    open_work_orders: wo?.work_orders || [],
  };
}

async function listWorkOrders({ asset_id }) {
  const id = safeId(asset_id);
  const res = await live.mergeAssetWorkOrders(id, await api.assetWorkOrders(id).catch(() => ({ rows: [] })));
  const rows = (res?.rows || []).filter((r) => r.open).slice(0, 15);
  return {
    asset_id: id, open: rows.length,
    work_orders: rows.map((r) => ({ wr_id: r.wr_id, problem: r.problem, status: r.status, priority: r.priority, type: r.type, created: r.create_date, created_by: r.created_by || null })),
  };
}

async function proposeWorkOrder(args) {
  const id = safeId(args.asset_id);
  const [d, belongsTo] = await Promise.all([api.assetDetail(id), sre.workOrderScenario()]);
  if (!d.asset) throw new Error(`Unknown asset id: ${id}`);
  const r = await live.proposeWorkOrder({
    assetId: id,
    asset: { name: d.asset.name || d.asset.asset_display_name, plant: d.asset.plant, unit: d.asset.unit },
    problem: String(args.problem).slice(0, 300),
    recommendation: String(args.recommendation).slice(0, 3000),
    evidence: String(args.evidence || '').slice(0, 3000),
    priority: args.priority,
    createdBy: 'Azure SRE Agent',
    ...belongsTo,
  });
  const w = r.workOrder;
  const pending = w.wr_status === live.PENDING;
  return {
    proposed: r.proposed, duplicate: !!r.duplicate,
    work_order: { wr_id: w.wr_id, asset_id: id, problem: w.problem_descr, priority: w.priority, status: w.wr_status, site: w.site_name, created: w.create_date, approved_by: w.approved_by || null },
    message: r.duplicate
      ? `${pending ? 'A proposal is already awaiting approval' : 'An approved agent work order already exists'} for ${id}: ${w.wr_id}.`
      : `Work order ${w.wr_id} is pending approval on the OneGrid SRE page. Tell the user it is ready for them to approve or reject in OneGrid; it is raised only when they approve.`,
  };
}

const HANDLERS = {
  get_active_alarms: getActiveAlarms,
  get_sensor_health: () => sre.sensorHealth(),
  get_sensor_trend: getSensorTrend,
  get_asset_context: getAssetContext,
  list_work_orders: listWorkOrders,
  propose_work_order: proposeWorkOrder,
};

async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return isNotification ? null : err(-32600, 'Invalid request');
  if (isNotification) return null;
  switch (method) {
    case 'initialize': {
      const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[1];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const h = HANDLERS[params?.name];
      if (!h) return err(-32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await h(params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${String(e.message || e).slice(0, 500)}` }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${method}`);
  }
}

function authorized(req) {
  const key = process.env.SRE_MCP_KEY || '';
  const auth = String(req.headers.authorization || '');
  const given = String(req.headers['x-api-key'] || (auth.startsWith('Bearer ') ? auth.slice(7) : ''));
  if (!key || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function handleMcp(req, res) {
  const send = (code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (!process.env.SRE_MCP_KEY) return send(404, { error: 'Not found' });
  if (!authorized(req)) return send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
  if (req.method === 'GET' || req.method === 'DELETE') return send(405, { error: 'This server does not offer an SSE stream or sessions.' }, { Allow: 'POST' });
  if (req.method !== 'POST') return send(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size < 1_000_000) chunks.push(c); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const batch = Array.isArray(body);
    const replies = (await Promise.all((batch ? body : [body]).map(handleMessage))).filter(Boolean);
    if (!replies.length) return send(202);
    return send(200, batch ? replies : replies[0]);
  });
}
