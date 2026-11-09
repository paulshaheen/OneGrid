// ---------------------------------------------------------------------------
//  Data feeds — which PI data is live and which is a historical snapshot.
//
//  • Fleet historian: Eventhouse PiEvents on the app's target (KUSTO_CLUSTER /
//    KUSTO_DATABASE). Covers every plant but is a fixed snapshot (Timestamp column).
//  • Live PI stream: optional second Eventhouse (LIVE_KUSTO_CLUSTER /
//    LIVE_KUSTO_DATABASE) continuously seeded for Riverton RV1–RV3 in daily bursts
//    (original PI schema: Ts, Tag, Plant, Value dynamic, IngestedAt).
//
//  feedStatus() tells the assistants which feed is live and whether it is streaming
//  right now; liveTagValues/liveTagTrend read the live stream.
// ---------------------------------------------------------------------------
import { kql } from './fabric.js';
import { resolveTarget } from './target.js';

const LIVE = {
  uri: (process.env.LIVE_KUSTO_CLUSTER || '').replace(/\/$/, ''),
  db: process.env.LIVE_KUSTO_DATABASE || 'pi-realtime-db',
};
// A burst is "streaming" while new rows keep arriving; the seeder writes every few seconds.
const STREAMING_WINDOW_MIN = 10;

export const liveConfigured = () => !!LIVE.uri;
export const isLiveTag = (tag) => liveConfigured() && /^RV[1-3]:/i.test(String(tag || ''));

const tagList = (tags) => tags.slice(0, 400).map((t) => `"${String(t).replace(/"/g, '')}"`).join(',');
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

let statusCache = null;
export async function feedStatus() {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.val;
  const t = resolveTarget();
  const [fleet, live] = await Promise.all([
    t.kustoUri && t.kqlDatabase
      ? kql(t.kustoUri, t.kqlDatabase, 'PiEvents | summarize latest=max(Timestamp), tags=dcount(Tag)')
          .then((r) => r[0] || null).catch(() => null)
      : null,
    liveConfigured()
      ? kql(LIVE.uri, LIVE.db, 'PiEvents | where IngestedAt > ago(7d) | summarize latest=max(Ts), lastIngest=max(IngestedAt), tags=dcount(Tag), units=make_set(Plant)')
          .then((r) => r[0] || null).catch(() => null)
      : null,
  ]);
  const now = Date.now();
  const lastIngest = live && live.lastIngest ? new Date(live.lastIngest).getTime() : null;
  const streaming = lastIngest !== null && now - lastIngest <= STREAMING_WINDOW_MIN * 60_000;
  const val = {
    checkedAt: new Date(now).toISOString(),
    live: liveConfigured()
      ? {
          name: 'Live PI stream',
          database: LIVE.db,
          coverage: 'Riverton RV1, RV2, RV3',
          units: ((live && live.units) || []).filter(Boolean).sort(),
          tags: live ? Number(live.tags) || 0 : 0,
          latest: live ? live.latest : null,
          lastIngest: live ? live.lastIngest : null,
          streaming,
          minutesSinceLastData: lastIngest === null ? null : Math.round((now - lastIngest) / 60_000),
          note: 'Seeded in daily bursts of about 2 hours; between bursts the latest reading is the end of the last burst.',
        }
      : null,
    fleet: {
      name: 'Fleet historian (snapshot)',
      database: t.kqlDatabase || null,
      coverage: 'All plants and units (e.g. Fairview FV1/FV2, Harbor Point, Cedar Falls, Ashford, Deepwater)',
      tags: fleet ? Number(fleet.tags) || 0 : 0,
      latest: fleet ? fleet.latest : null,
      live: false,
      note: 'Fixed historical snapshot; no new data arrives. Only the SRE demo live scenario appends readings (FV1 turbine).',
    },
  };
  statusCache = { at: now, val };
  return val;
}

export async function liveTagValues(tags) {
  if (!liveConfigured() || !tags.length) return [];
  const rows = await kql(LIVE.uri, LIVE.db, `PiEvents | where Tag in (${tagList(tags)}) | summarize arg_max(Ts, Value, Plant) by Tag | project Tag, Ts, val=todouble(Value), Plant`);
  return rows.map((r) => ({ tag: r.Tag, ts: r.Ts, value: num(r.val), valueType: null, plant: r.Plant, source: 'live' }));
}

// Anchored at the tag's newest reading so a trend is never empty between bursts.
export async function liveTagTrend(tag, hours = 6, bin = 2) {
  if (!liveConfigured()) return [];
  const t = String(tag).replace(/"/g, '');
  const rows = await kql(LIVE.uri, LIVE.db, `let anchor = toscalar(PiEvents | where Tag == "${t}" | summarize max(Ts));
    PiEvents | where Tag == "${t}" and Ts > anchor - ${Number(hours) || 6}h | summarize v=avg(todouble(Value)) by bin(Ts, ${Number(bin) || 2}m) | order by Ts asc | project Ts, v`);
  return rows.map((r) => ({ ts: r.Ts, v: num(r.v) }));
}
