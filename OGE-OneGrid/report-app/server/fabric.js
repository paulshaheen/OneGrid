// ---------------------------------------------------------------------------
//  Fabric data access: token acquisition + DAX (Power BI executeQueries) + KQL.
//  Local dev acquires tokens via the signed-in `az` CLI (the demo owner's identity).
//  In the container this same module can be pointed at the managed-identity token
//  endpoint instead (see getToken()).
// ---------------------------------------------------------------------------
import { execFile } from 'node:child_process';
import https from 'node:https';

const RES_PBI = 'https://analysis.windows.net/powerbi/api';
const RES_FABRIC = 'https://api.fabric.microsoft.com';

const tokenCache = new Map(); // resource -> { token, exp }

function azToken(resource) {
  return new Promise((resolve, reject) => {
    execFile(
      'az',
      ['account', 'get-access-token', '--resource', resource, '--query', 'accessToken', '-o', 'tsv'],
      { shell: true, windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))
    );
  });
}

// Service principal (client-credentials) — set AZURE_CLIENT_ID/SECRET/TENANT.
async function spToken(resource) {
  const tenant = process.env.AZURE_TENANT_ID, clientId = process.env.AZURE_CLIENT_ID, secret = process.env.AZURE_CLIENT_SECRET;
  const scope = resource.endsWith('/.default') ? resource : resource.replace(/\/$/, '') + '/.default';
  const params = new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials', scope });
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  });
  if (!resp.ok) throw new Error(`SP token failed for ${resource}: ${resp.status} ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// Azure Container Apps / App Service managed identity via IMDS (IDENTITY_ENDPOINT).
async function miToken(resource) {
  const idEndpoint = process.env.IDENTITY_ENDPOINT, idHeader = process.env.IDENTITY_HEADER;
  const res = resource.replace(/\/\.default$/, '');
  const url = `${idEndpoint}?resource=${encodeURIComponent(res)}&api-version=2019-08-01`;
  const resp = await fetch(url, { headers: { 'X-IDENTITY-HEADER': idHeader } });
  if (!resp.ok) throw new Error(`MI token failed for ${resource}: ${resp.status} ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// Acquire a token via the best-available identity: service principal → managed identity
// (in Azure) → local `az` CLI (dev). Lets the same server run locally and in a container.
async function acquireToken(resource) {
  if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) return spToken(resource);
  if (process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER) return miToken(resource);
  return azToken(resource);
}

export async function getToken(resource) {
  const now = Date.now();
  const cached = tokenCache.get(resource);
  if (cached && cached.exp > now + 60_000) return cached.token;
  const token = await acquireToken(resource);
  // az tokens last ~60-90 min; cache for 45 min to be safe.
  tokenCache.set(resource, { token, exp: now + 45 * 60_000 });
  return token;
}

// Real tokens can expire before our cache TTL (or be revoked). Detect an auth failure so
// callers can drop the cached token and retry with a fresh one.
function isAuthError(e) {
  const m = String((e && e.message) || '');
  return /HTTP 40[13]\b/.test(m) || /TokenExpired|token has expired|Authentication_?Failed|Unauthorized/i.test(m);
}

// Detect a paused/suspended Fabric capacity. When the capacity backing the workspace is
// paused (e.g. auto-paused outside operating hours), DAX/KQL queries fail rather than
// returning data — so the UI can show a clear "capacity paused" banner instead of blanks.
export function isCapacityPausedError(e) {
  const m = String((e && e.message) || '').toLowerCase();
  if (/\bpaused\b|\bsuspended\b|\bsuspend\b/.test(m)) return true;
  if (/capacity/.test(m) && /(not\s*active|inactive|unavailable|disabled|paused|suspended|is off)/.test(m)) return true;
  if (/capacitynotactive|powerbicapacity|premiumcapacity|f-?sku/.test(m) && /(paus|suspend|inactiv|unavail|disab)/.test(m)) return true;
  // A paused capacity can't load the model: DAX fails to open the Analysis Services connection.
  if (/failed to open the msolap connection|msolap connection|analysis services.*(unavailable|not.*available)/.test(m)) return true;
  return false;
}

// Run `fn(token)` with a cached token; on an auth error, invalidate the cache, acquire a
// fresh token and retry ONCE. This makes the backend self-heal from token expiry without a
// manual restart.
async function withToken(resource, fn) {
  const token = await getToken(resource);
  try {
    return await fn(token);
  } catch (e) {
    if (!isAuthError(e)) throw e;
    tokenCache.delete(resource);
    const fresh = await getToken(resource);
    return await fn(fresh);
  }
}

// Plain GET returning parsed JSON (used for Fabric control-plane reads like capacity state).
function httpGet(url, token) {
  const u = new URL(url);
  const opts = { method: 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: 'Bearer ' + token } };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad json: ' + out.slice(0, 200))); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Authoritative paused-capacity signal: resolve the workspace's capacity and read its state.
// Fabric returns "Active" when running and "Inactive" (or Paused/Suspended) when paused.
// Returns { state, capacityId } — state is null when it can't be read (permissions/unknown).
export async function getCapacityState(workspaceId) {
  if (!workspaceId) return { state: null };
  return withToken(RES_FABRIC, async (token) => {
    let capacityId = null;
    try {
      const ws = await httpGet(`${RES_FABRIC}/v1/workspaces/${workspaceId}`, token);
      capacityId = ws.capacityId || null;
    } catch (e) { return { state: null, error: String((e && e.message) || e) }; }
    if (!capacityId) return { state: null };
    try {
      const list = await httpGet(`${RES_FABRIC}/v1/capacities`, token);
      const c = (list.value || []).find((x) => x.id === capacityId);
      return { state: c ? c.state : null, capacityId };
    } catch (e) { return { state: null, capacityId, error: String((e && e.message) || e) }; }
  });
}

function postJson(url, token, body) {
  const data = Buffer.from(JSON.stringify(body));
  const u = new URL(url);
  const opts = {
    method: 'POST',
    hostname: u.hostname,
    path: u.pathname + u.search,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': data.length,
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad json: ' + out.slice(0, 200))); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 400)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// DAX returns columns as "table[col]" (grouping) or "[measure]". Reduce both to "col".
function cleanRows(table) {
  const rows = (table && table.rows) || [];
  return rows.map((r) => {
    const o = {};
    for (const k of Object.keys(r)) o[k.replace(/^.*\[/, '').replace(/\]$/, '')] = r[k];
    return o;
  });
}

// Run one or more DAX EVALUATE queries. The Power BI executeQueries API allows only
// ONE query per request, so we issue them as parallel single-query requests.
export async function dax(workspaceId, datasetId, queries) {
  const list = Array.isArray(queries) ? queries : [queries];
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;
  return withToken(RES_PBI, (token) => Promise.all(
    list.map(async (query) => {
      const resp = await postJson(url, token, { queries: [{ query }], serializerSettings: { includeNulls: true } });
      return cleanRows(((resp.results || [])[0] || {}).tables?.[0]);
    })
  ));
}

export async function dax1(workspaceId, datasetId, query) {
  const [rows] = await dax(workspaceId, datasetId, query);
  return rows;
}

// Run a KQL query against the Eventhouse; returns array of row-objects.
export async function kql(kustoUri, database, query) {
  const url = `${kustoUri.replace(/\/$/, '')}/v1/rest/query`;
  const resp = await withToken(kustoUri, (token) => postJson(url, token, { db: database, csl: query }));
  const table = (resp.Tables || []).find((t) => (t.TableName || '').toLowerCase() === 'table_0') || (resp.Tables || [])[0];
  if (!table) return [];
  const cols = table.Columns.map((c) => c.ColumnName);
  return table.Rows.map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

// Run a KQL management/ingest command (.ingest, .set-or-append, etc.) against the Eventhouse.
export async function kqlMgmt(kustoUri, database, csl) {
  const url = `${kustoUri.replace(/\/$/, '')}/v1/rest/mgmt`;
  return withToken(kustoUri, (token) => postJson(url, token, { db: database, csl }));
}

export { RES_PBI, RES_FABRIC };
