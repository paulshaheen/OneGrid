// ---------------------------------------------------------------------------
//  Local report backend: serves the data API + realtime WebSocket, and hosts
//  the unified webapp under /webapp (the sole frontend). Any other path
//  redirects to /webapp/app. Authenticates to Fabric via the signed-in az CLI.
//  Run: npm run server   (listens on :7700)
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRealtime } from './realtime.js';
import { resolveTarget } from './target.js';
import { proxyChat, proxyModels, warmAgent } from './chat.js';
import { proxyWebapp, warmWebapp } from './webapp.js';
import { isCapacityPausedError } from './fabric.js';
import * as api from './dataApi.js';
import * as gov from './governance.js';
import * as manuals from './manuals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.REPORT_PORT || 7700;
const ONTOLOGY_FILE = path.resolve(__dirname, 'ontology.json');
let _ontologyCache = null;
function loadOntology() {
  if (_ontologyCache) return _ontologyCache;
  try { _ontologyCache = JSON.parse(fs.readFileSync(ONTOLOGY_FILE, 'utf8')); }
  catch { _ontologyCache = { error: 'ontology.json not found — run _gen-ontology.py', nodes: [], edges: [], categories: {} }; }
  return _ontologyCache;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, target: resolveTarget(), dataAgent: !!(process.env.DATA_AGENT_WORKSPACE && process.env.DATA_AGENT_ID), manuals: manuals.manualsEnabled() });
    // ── Foundry IQ equipment manuals (knowledge base) ─────────────────────
    if (p === '/api/manuals/health') return json(res, 200, { enabled: manuals.manualsEnabled(), categories: manuals.listCategories() });
    if (p === '/api/manuals/search') {
      const q = url.searchParams.get('q') || '';
      const category = url.searchParams.get('category') || null;
      const top = Math.min(10, Number(url.searchParams.get('top')) || 5);
      if (!q.trim()) return json(res, 400, { error: 'q is required' });
      return json(res, 200, { results: await manuals.searchManuals(q, { category, top }) });
    }
    if (p.startsWith('/api/manuals/category/')) {
      return json(res, 200, { manuals: manuals.manualsForCategory(decodeURIComponent(p.slice('/api/manuals/category/'.length))) });
    }
    if (p.startsWith('/api/manuals/item/')) {
      const m = manuals.getManual(decodeURIComponent(p.slice('/api/manuals/item/'.length)));
      return m ? json(res, 200, m) : json(res, 404, { error: 'manual not found' });
    }
    if (p === '/api/manuals/resolve') {
      const category = url.searchParams.get('category') || null;
      const problem = url.searchParams.get('problem') || '';
      const asset = { category: url.searchParams.get('assetCategory') || '', name: url.searchParams.get('assetName') || '', assetType: url.searchParams.get('assetType') || '' };
      return json(res, 200, await manuals.resolveForWorkOrder({ category, asset, problem }));
    }
    if (p === '/api/status') return json(res, 200, await api.status());
    if (p === '/api/fleet-health') return json(res, 200, await api.fleetHealth());
    if (p === '/api/fleet-assets') return json(res, 200, await api.fleetAssets());
    if (p === '/api/facility-model') return json(res, 200, await api.facilityModel());
    if (p === '/api/watchlist') return json(res, 200, await api.watchlistTop(Number(url.searchParams.get('limit')) || 60));
    if (p === '/api/anomalies') return json(res, 200, await api.anomaliesTop(Number(url.searchParams.get('limit')) || 60));
    if (p === '/api/work-orders') return json(res, 200, await api.workOrders(Number(url.searchParams.get('limit')) || 80));
    if (p === '/api/work-orders-summary') return json(res, 200, await api.workOrdersSummary());
    if (p === '/api/outages') return json(res, 200, await api.outages());
    if (p === '/api/predictions') return json(res, 200, await api.predictionsDetail());
    if (p.startsWith('/api/asset-workorders/')) return json(res, 200, await api.assetWorkOrders(decodeURIComponent(p.split('/api/asset-workorders/')[1])));
    if (p === '/api/narrative') return json(res, 200, await api.narrative());
    if (p === '/api/ontology') return json(res, 200, loadOntology());
    // ── Governance / OneLake-security review plane (read-only) ──────────────
    if (p.startsWith('/api/governance/')) {
      if (!gov.isAuthorized(req)) return json(res, 403, { error: 'forbidden: Governance.Reader required' });
      const sub = p.slice('/api/governance/'.length);
      if (sub === 'posture') return json(res, 200, await gov.posture());
      if (sub === 'principals') return json(res, 200, await gov.principals());
      if (sub === 'resources') return json(res, 200, await gov.resources());
      if (sub === 'changes') return json(res, 200, await gov.changes());
      if (sub === 'tests') return json(res, 200, await gov.tests());
      if (sub === 'explain') return json(res, 200, await gov.explain(url.searchParams.get('principal'), url.searchParams.get('resource')));
      if (sub.startsWith('principals/')) return json(res, 200, await gov.principalAccess(decodeURIComponent(sub.slice('principals/'.length))));
      if (sub.startsWith('resources/')) return json(res, 200, await gov.resourcePrincipals(decodeURIComponent(sub.slice('resources/'.length))));
      return json(res, 404, { error: 'unknown governance endpoint' });
    }
    if (p === '/api/realtime-pulse') return json(res, 200, await api.realtimePulse());
    if (p.startsWith('/api/asset/')) return json(res, 200, await api.assetDetail(decodeURIComponent(p.split('/api/asset/')[1])));
    if (p === '/api/tag-values') {
      const tags = (url.searchParams.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
      return json(res, 200, await api.tagValues(tags));
    }
    if (p === '/api/tag-trend') {
      const tag = url.searchParams.get('tag');
      return json(res, 200, await api.tagTrend(tag, Number(url.searchParams.get('hours')) || 24, Number(url.searchParams.get('bin')) || 15));
    }
    return json(res, 404, { error: 'unknown endpoint' });
  } catch (e) {
    // A paused/suspended capacity isn't a server bug — surface it as 503 with a flag so the
    // client can show a clear "capacity paused" banner instead of a generic error/blank page.
    const paused = isCapacityPausedError(e);
    return json(res, paused ? 503 : 500, { error: String(e.message || e), capacityPaused: paused });
  }
}

// The legacy report-app SPA has been retired; the unified webapp under /webapp
// is now the sole frontend. Any non-API, non-/webapp request redirects there.
function redirectToWebapp(req, res) {
  res.writeHead(302, { Location: '/webapp/app', 'Cache-Control': 'no-store' });
  res.end();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Embedded Planetary-Compute-Pro web app (the "Explorer" tab) — reverse-proxy
  // everything under /webapp to its SSR child process, streaming both ways.
  if (url.pathname === '/webapp' || url.pathname.startsWith('/webapp/')) return proxyWebapp(req, res);
  // Chat agent proxy (streamed SSE) — collect body then forward.
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => proxyChat(req, res, Buffer.concat(chunks)));
    return;
  }
  // Fabric Data Agent (MCP) proxy — same SSE forwarding as /api/chat.
  if (url.pathname === '/api/ask-ontology' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => proxyChat(req, res, Buffer.concat(chunks), '/api/ask-ontology'));
    return;
  }
  if (url.pathname === '/api/models' && req.method === 'GET') return proxyModels(req, res);
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        let body = Buffer.concat(chunks).toString('utf8');
        if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
        const result = await api.submitFeedback(JSON.parse(body || '{}'));
        json(res, 200, result);
      } catch (e) { json(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return redirectToWebapp(req, res);
});

attachRealtime(server);
warmAgent();
warmWebapp();
server.listen(PORT, () => {
  const t = resolveTarget();
  console.log(`\n  Report backend on http://localhost:${PORT}`);
  console.log(`  Target workspace: ${t.workspaceId || '(none)'}  dataset: ${t.datasetId || '(none)'}`);
  console.log(`  Eventhouse: ${t.kustoUri || '(none)'} / ${t.kqlDatabase}\n`);
});
