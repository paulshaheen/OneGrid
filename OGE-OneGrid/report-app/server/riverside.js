// ---------------------------------------------------------------------------
//  Riverside substation (transformer T2): the AgentCraft Asset Health scenario served from OneGrid.
//
//  The scenario's generated tables live in the Eventhouse as Riverside_* (loaded by data/riverside/load_riverside.py).
//  OneGrid asset ids for this site carry the RS_ prefix (RS_T2 = the scenario's T2). The scenario is historical:
//  its "now" is SCENARIO_NOW and T2 tripped on 20 Oct 2026 at 14:32, so time windows default to that clock.
//  Read-only except proposeWorkOrder, which goes through the same approval flow as every agent work order.
// ---------------------------------------------------------------------------
import { kql } from './fabric.js';
import { resolveTarget } from './target.js';
import * as live from './liveIncident.js';

export const SCENARIO = 'agentcraft-riverside';
export const SCENARIO_NOW = '2026-10-21T08:00';
const SITE = { plant: 'Riverside', unit: 'Riverside 132/11 kV' };

export const isRiverside = (id) => /^RS_/i.test(String(id || ''));
const local = (id) => String(id).replace(/^RS_/i, '').replace(/[^A-Za-z0-9_\-]/g, '');
const lit = (s) => String(s).replace(/[^A-Za-z0-9_:.\- ]/g, '');
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(String(s || ''));

async function q(query) {
  const t = resolveTarget();
  if (!t.kustoUri) throw new Error('Eventhouse is not configured.');
  return live.withRetry(() => kql(t.kustoUri, t.kqlDatabase, query));
}

/** Drop empty cells and parse JSON cells, so tool results stay compact. */
function tidy(rows) {
  return (rows || []).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => {
    if (typeof v === 'string' && /^[[{]/.test(v)) { try { return [k, JSON.parse(v)]; } catch { /* keep text */ } }
    return [k, v];
  })));
}

const shiftIso = (iso, minutes) => new Date(new Date(`${iso}Z`).getTime() + minutes * 60_000).toISOString().slice(0, 16);

export async function sensorTrend({ asset_id, hours = 24, from, to, tags }) {
  const id = local(asset_id);
  const end = isoOk(to) ? to : SCENARIO_NOW;
  const start = isoOk(from) ? from : shiftIso(end, -60 * Math.max(1, Math.min(24 * 30, Number(hours) || 24)));
  const spanMin = (new Date(`${end}Z`) - new Date(`${start}Z`)) / 60000;
  if (!(spanMin > 0)) throw new Error('`from` must be before `to`.');
  const binMin = Math.max(5, Math.ceil(spanMin / 48));
  const wanted = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map((x) => lit(x).trim()).filter(Boolean);
  const tagFilter = wanted.length ? `| where ${wanted.map((x) => `tag has "${x}"`).join(' or ')}` : '';
  const window = `let pts = Riverside_ScadaPoints | where asset == "${id}" ${tagFilter};
    let s = Riverside_ScadaSeries | where tag in ((pts | project tag)) and t between (datetime(${start}) .. datetime(${end}));`;
  const [stats, series, events] = await Promise.all([
    q(`${window} s | summarize (latest_t, latest) = arg_max(t, value), (first_t, first_v) = arg_min(t, value), lo = min(value), hi = max(value), readings = count() by tag
      | join kind=inner (pts | project tag, quantity, unit, alarm, trip) on tag | project-away tag1 | order by tag asc`),
    // Series only for tags with alarm or trip settings (the ones a diagnosis turns on), or the tags asked for.
    q(`${window} s | join kind=inner (pts | where ${wanted.length ? 'true' : 'isnotempty(alarm) or isnotempty(trip)'} | project tag) on tag
      | summarize v = round(avg(value), 2) by tag, at = bin(t, ${binMin}m) | order by tag asc, at asc`),
    q(`Riverside_ScadaEvents | where asset == "${id}" | where todatetime(['at']) between (datetime(${start}) .. datetime(${end})) | order by ['at'] asc`),
  ]);
  if (!stats.length) return { asset_id, message: `No SCADA readings for ${asset_id} between ${start} and ${end}.` };
  const byTag = {};
  for (const r of series) (byTag[r.tag] ||= []).push([String(r.at).slice(0, 16), Number(r.v)]);
  const n = (x) => (x === '' || x === null || x === undefined ? null : Number(x));
  return {
    asset_id, site: SITE.plant, window: { from: start, to: end, bin_minutes: binMin },
    clock_note: `Riverside is a historical scenario: its "now" is ${SCENARIO_NOW} (site-local). T2 tripped on 2026-10-20 at 14:32.`,
    sensors: stats.map((s) => ({
      tag: s.tag, quantity: s.quantity, unit: s.unit, alarm: n(s.alarm), trip: n(s.trip),
      latest_at: String(s.latest_t).slice(0, 16), latest: n(s.latest), window_first: n(s.first_v), window_min: n(s.lo), window_max: n(s.hi),
      readings: Number(s.readings), ...(byTag[s.tag] ? { series: byTag[s.tag] } : {}),
    })),
    events: tidy(events),
  };
}

export async function assetContext({ asset_id }) {
  const id = local(asset_id);
  const [asset, specs, config, comps, events, trends] = await Promise.all([
    q(`Riverside_Assets | where id == "${id}" | project-away sld_col, sld_row`),
    q(`Riverside_AssetSpecs | where asset == "${id}" | order by toint(seq) asc | project key, value`),
    q(`Riverside_AssetConfig | where asset == "${id}" | order by toint(seq) asc | project ['group'], key, value, unit, standard, deviation, consequence`),
    q(`Riverside_Components | where asset == "${id}" | project id, name, ['kind'], state, priority, note, fails, ['last'], ['next'], ticket | order by priority asc`),
    q(`Riverside_ScadaEvents | where asset == "${id}" | order by ['at'] asc`),
    q(`Riverside_Trends | where asset == "${id}" | summarize arg_max(month, value, warn, crit) by metric`),
  ]);
  if (!asset.length) return { asset_id, message: `Unknown Riverside asset: ${asset_id}.` };
  const work = await workOrders({ asset_id }).catch(() => null);
  return {
    asset: { asset_id, ...tidy(asset)[0], site: SITE.plant },
    specs: tidy(specs), configuration: tidy(config), components: tidy(comps), scada_events: tidy(events),
    latest_trends: tidy(trends), open_work: work ? { tickets: work.tickets.filter((t) => t.status !== 'closed'), work_orders: work.work_orders } : null,
    clock_note: `Scenario "now" is ${SCENARIO_NOW}.`,
  };
}

export async function workOrders({ asset_id }) {
  const id = local(asset_id);
  const [tickets, history, wos, events, agent] = await Promise.all([
    q(`Riverside_Tickets | where asset == "${id}" | order by opened desc | take 15 | project-away labour`),
    q(`Riverside_TicketHistory | join kind=inner (Riverside_Tickets | where asset == "${id}" | project ticket = id) on ticket
      | order by ticket asc, toint(seq) asc | project ticket, ['at'], ['by'], action, text`),
    q(`Riverside_WorkOrders | where asset == "${id}" and status != "recurring" | order by planned desc | take 10`),
    q(`Riverside_Events | where asset == "${id}" and isnotempty(anchor) | order by ['at'] asc | project ['at'], task, ['kind'], ticket, work_order, ['by'], owner, should, rule, label`),
    live.agentRecordsSince(0, SCENARIO).catch(() => []),
  ]);
  const hist = {};
  for (const h of history) (hist[h.ticket] ||= []).push(`${h.at} ${h.by || 'system'} ${h.action}: ${h.text}`);
  const agentRows = agent.filter((w) => local(w.asset_id) === id).map((w) => ({
    id: w.wr_id, title: w.problem_descr, status: w.wr_status, priority: w.priority, created: w.create_date, created_by: w.created_by, approved_by: w.approved_by || null,
    source: 'OneGrid approval queue',
  }));
  return {
    asset_id,
    tickets: tidy(tickets).map((t) => ({ ...t, history: hist[t.id] || [] })),
    work_orders: [...agentRows, ...tidy(wos).map((w) => ({
      ...w, source: 'Riverside EAM record',
      ...(String(w.status).toLowerCase() === 'draft' ? { approval: 'Draft in the EAM system: not raised, and not awaiting approval in OneGrid.' } : {}),
    }))],
    story_events: tidy(events),
  };
}

export async function searchDocuments({ query, asset_id, type }) {
  const words = [...new Set(String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9\-]{2,}/g) || [])].slice(0, 8);
  if (!words.length) throw new Error('Give a query with at least one word of three letters or more.');
  const score = words.map((w) => `countof(hay, "${lit(w)}")`).join(' + ');
  const first = lit(words[0]);
  const rows = await q(`Riverside_Documents
    ${asset_id ? `| where assets has "${local(asset_id)}"` : ''} ${type ? `| where ['type'] =~ "${lit(type)}"` : ''}
    | extend hay = tolower(strcat(id, " ", ['title'], " ", doc_no, " ", body)) | extend score = ${score} | where score > 0 | top 5 by score desc
    | extend pos = indexof(tolower(body), "${first}") | extend snippet = substring(body, max_of(0, pos - 160), 700)
    | project id, ['title'], ['type'], doc_no, rev, assets, score, snippet`);
  return { query, results: tidy(rows) };
}

export async function getDocument({ doc_id }) {
  const rows = await q(`Riverside_Documents | where id == "${lit(doc_id)}" | project doc`);
  if (!rows.length) return { doc_id, message: 'No such document.' };
  return JSON.parse(rows[0].doc);
}

export async function areaStatus() {
  const [sites, lines, assets] = await Promise.all([
    q('Riverside_AreaSites | project-away x, y, label_above, drill'),
    q('Riverside_AreaLines'),
    q("Riverside_Assets | project id, name, ['kind'], health, score, customers, note | order by toint(score) asc"),
  ]);
  return { site: SITE.plant, area_sites: tidy(sites), area_lines: tidy(lines), riverside_assets: tidy(assets).map((a) => ({ ...a, asset_id: `RS_${a.id}` })) };
}

export async function proposeWorkOrder(args) {
  const id = local(args.asset_id);
  const rows = await q(`Riverside_Assets | where id == "${id}" | project name`);
  if (!rows.length) throw new Error(`Unknown Riverside asset: ${args.asset_id}`);
  return live.proposeWorkOrder({
    assetId: `RS_${id}`,
    asset: { name: rows[0].name, ...SITE },
    problem: String(args.problem).slice(0, 300),
    recommendation: String(args.recommendation).slice(0, 3000),
    evidence: String(args.evidence || '').slice(0, 3000),
    priority: args.priority,
    createdBy: args.created_by ? String(args.created_by).slice(0, 80) : 'OneGrid asset agent',
    scenario: SCENARIO,
  });
}
