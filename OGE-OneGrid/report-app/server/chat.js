// ---------------------------------------------------------------------------
//  Chat proxy: runs the SAME chat agent that ships with the accelerator
//  (../chatagent) as a managed child process, pointed at the report's resolved
//  Fabric target, and proxies /api/chat (SSE stream) + /api/models to it.
//  This gives the report app a "chat with your data" experience identical to
//  the deployed site, without duplicating the agent's reasoning/tool logic.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from './target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AGENT_SCRIPT = path.join(REPO_ROOT, 'chatagent', 'server.js');
const CHAT_PORT = Number(process.env.CHAT_AGENT_PORT || 7701);
const EXTERNAL_URL = process.env.CHAT_AGENT_URL || '';           // point at an already-running agent
const CHAT_BASE = EXTERNAL_URL || `http://127.0.0.1:${CHAT_PORT}`;

let child = null;
let starting = null;

function spawnAgent() {
  if (!fs.existsSync(AGENT_SCRIPT)) { console.warn(`[chat] agent script not found at ${AGENT_SCRIPT}`); return null; }
  const t = resolveTarget();
  const env = {
    ...process.env,
    PORT: String(CHAT_PORT),
    PBI_WORKSPACE: t.workspaceId || '',
    PBI_DATASET: t.datasetId || '',
    KUSTO_CLUSTER: t.kustoUri || '',
    KUSTO_DATABASE: t.kqlDatabase || 'pi-realtime-db',
  };
  const c = spawn(process.execPath, [AGENT_SCRIPT], { env, cwd: path.dirname(AGENT_SCRIPT), stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => process.stdout.write(`[chat] ${d}`));
  c.stderr.on('data', (d) => process.stderr.write(`[chat] ${d}`));
  c.on('exit', (code) => { console.log(`[chat] agent process exited (${code})`); child = null; });
  return c;
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${CHAT_BASE}/healthz`, (r) => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

export async function ensureAgent() {
  if (await ping()) return true;
  if (EXTERNAL_URL) return false; // don't spawn when told to use an external agent
  if (!starting) {
    starting = (async () => {
      console.log('[chat] starting agent…');
      child = spawnAgent();
      if (!child) return false;
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ping()) { console.log('[chat] agent ready'); return true; } }
      console.warn('[chat] agent did not become ready in time');
      return false;
    })().finally(() => { starting = null; });
  }
  return starting;
}

export async function proxyChat(req, res, bodyBuf, agentPath = '/api/chat') {
  const ok = await ensureAgent();
  if (!ok) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Chat agent is not available. Ensure `gh auth login` and `az login` are done.' }));
  }
  const preq = http.request(new URL(agentPath, CHAT_BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyBuf) },
  }, (pres) => {
    res.writeHead(pres.statusCode || 200, {
      'Content-Type': pres.headers['content-type'] || 'text/event-stream',
      'Cache-Control': 'no-cache', 'Connection': 'keep-alive',
    });
    pres.pipe(res);
  });
  preq.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  });
  preq.end(bodyBuf);
}

export async function proxyModels(req, res) {
  const ok = await ensureAgent();
  if (!ok) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: [] })); }
  const src = new URL(req.url, 'http://localhost');
  const target = new URL('/api/models', CHAT_BASE);
  target.search = src.search; // forward ?provider=...
  const headers = {};
  if (req.headers['x-copilot-token']) headers['x-copilot-token'] = req.headers['x-copilot-token'];
  http.get(target, { headers }, (pres) => {
    res.writeHead(pres.statusCode || 200, { 'Content-Type': 'application/json' });
    pres.pipe(res);
  }).on('error', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ models: [] })); });
}

// Warm the agent shortly after boot so the first message is snappy.
export function warmAgent() { setTimeout(() => { ensureAgent().catch(() => {}); }, 1500); }
