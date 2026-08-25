// ---------------------------------------------------------------------------
//  Webapp proxy: runs the Planetary-Compute-Pro web app (../../webapp, a
//  TanStack Start SSR app) as a managed child process and reverse-proxies
//  everything under /webapp to it. The child owns the /webapp base path
//  (APP_BASE_PATH), so requests pass through unmodified — assets, SSR routes
//  and server functions all resolve under the one origin. This is what makes
//  the "Explorer" tab a first-class part of the single OneGrid deployment
//  without forking or re-implementing the webapp's logic.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBAPP_DIR = path.join(REPO_ROOT, 'webapp');
const SERVER_SCRIPT = path.join(WEBAPP_DIR, 'server.mjs');
const BASE_PATH = '/webapp';
const WEBAPP_PORT = Number(process.env.WEBAPP_PORT || 7702);
const EXTERNAL_URL = process.env.WEBAPP_URL || '';        // point at an already-running webapp
const WEBAPP_BASE = EXTERNAL_URL || `http://127.0.0.1:${WEBAPP_PORT}`;

let child = null;
let starting = null;

function spawnWebapp() {
  if (!fs.existsSync(SERVER_SCRIPT)) { console.warn(`[webapp] server not found at ${SERVER_SCRIPT}`); return null; }
  if (!fs.existsSync(path.join(WEBAPP_DIR, 'dist', 'server', 'server.js'))) {
    console.warn('[webapp] build missing (webapp/dist) — run `npm --prefix webapp run build` (with APP_BASE_PATH=/webapp)');
    return null;
  }
  const env = {
    ...process.env,
    PORT: String(WEBAPP_PORT),
    APP_BASE_PATH: BASE_PATH,
  };
  const c = spawn(process.execPath, [SERVER_SCRIPT], { env, cwd: WEBAPP_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => process.stdout.write(`[webapp] ${d}`));
  c.stderr.on('data', (d) => process.stderr.write(`[webapp] ${d}`));
  c.on('exit', (code) => { console.log(`[webapp] process exited (${code})`); child = null; });
  return c;
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${WEBAPP_BASE}${BASE_PATH}/`, (r) => { r.resume(); resolve((r.statusCode || 0) < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

export async function ensureWebapp() {
  if (await ping()) return true;
  if (EXTERNAL_URL) return false; // don't spawn when told to use an external instance
  if (!starting) {
    starting = (async () => {
      console.log('[webapp] starting…');
      child = spawnWebapp();
      if (!child) return false;
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ping()) { console.log('[webapp] ready'); return true; } }
      console.warn('[webapp] did not become ready in time');
      return false;
    })().finally(() => { starting = null; });
  }
  return starting;
}

// Reverse-proxy any /webapp* request to the child, streaming both directions so
// SSR documents, hashed assets and server-function POSTs all pass through intact.
export async function proxyWebapp(req, res) {
  const ok = await ensureWebapp();
  if (!ok) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>Explorer unavailable</h1><p>The webapp failed to start. Ensure <code>webapp/</code> is built (APP_BASE_PATH=/webapp).</p>');
  }
  const target = new URL(req.url, WEBAPP_BASE);
  const headers = { ...req.headers, host: target.host };
  const preq = http.request(target, { method: req.method, headers }, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  preq.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`webapp proxy error: ${e.message}`);
  });
  req.pipe(preq);
}

export function warmWebapp() { ensureWebapp().catch(() => {}); }
