/**
 * PI-Fabric Chat Agent — Node.js API server.
 * Serves the chat API that the HTML frontend calls.
 * Uses GitHub Copilot API for reasoning + Kusto/DAX for data queries.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askDataAgent } = require('./mcp');

const PORT = process.env.PORT || 3456;
// Corporate proxy uses self-signed certs locally. In Azure App Service
// (WEBSITE_INSTANCE_ID is set) keep TLS verification ON. Force either way
// with DISABLE_TLS_VERIFY=1 (disable) or DISABLE_TLS_VERIFY=0 (enable).
const _onAzure = !!process.env.WEBSITE_INSTANCE_ID;
if (process.env.DISABLE_TLS_VERIFY === '1' || (!_onAzure && process.env.DISABLE_TLS_VERIFY !== '0')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const CONFIG = {
    // Connection targets come from env (set by deploy.ps1 / the report server that spawns
    // this agent). No hardcoded tenant fallbacks — a missing value must fail visibly, not
    // silently query a stale/foreign workspace. kustoDb keeps the standard db name default.
    kustoCluster: process.env.KUSTO_CLUSTER || '',
    kustoDb: process.env.KUSTO_DATABASE || 'pi-realtime-db',
    pbiWorkspace: process.env.PBI_WORKSPACE || '',
    pbiDataset: process.env.PBI_DATASET || '',
    // Fabric Data Agent (published) — consumed over its MCP endpoint for NL queries
    // grounded in the OneGrid ontology / semantic model.
    dataAgentWorkspace: process.env.DATA_AGENT_WORKSPACE || process.env.PBI_WORKSPACE || '',
    dataAgentId: process.env.DATA_AGENT_ID || '',
    fabricApiBase: (process.env.FABRIC_API_BASE || 'https://api.fabric.microsoft.com').replace(/\/$/, ''),
    copilotModel: process.env.COPILOT_MODEL || 'gpt-4o'
};
// Foundry IQ equipment-manuals knowledge base is served by the report backend; the tool is
// only offered when it's configured (env inherited from the parent report server).
const MANUALS_ON = !!(process.env.MANUALS_SEARCH_ENDPOINT && process.env.MANUALS_SEARCH_KEY);

// ── AI provider ───────────────────────────────────────────────────────────
// 'foundry'  → Azure AI Foundry unified inference (customer-facing; no GH token).
// 'copilot'  → GitHub Copilot API (local dev convenience).
// Auto-selects foundry when an endpoint is configured, else copilot.
const AI = {
    provider: (process.env.AI_PROVIDER || (process.env.AZURE_AI_ENDPOINT ? 'foundry' : 'copilot')).toLowerCase(),
    endpoint: (process.env.AZURE_AI_ENDPOINT || '').replace(/\/$/, ''), // e.g. https://<your-foundry-resource>.cognitiveservices.azure.com
    key: process.env.AZURE_AI_KEY || '',                                 // optional; else Entra token is used
    apiVersion: process.env.AZURE_AI_API_VERSION || '2024-05-01-preview',
    defaultModel: process.env.AI_DEFAULT_MODEL || process.env.COPILOT_MODEL || 'gpt-4o',
    // Optional explicit model list for the selector: "id|Label|Vendor, id2|Label2".
    // If unset in foundry mode, the server lists live deployments via ARM.
    modelsList: process.env.AI_MODELS || '',
    // ARM identifiers so the server can enumerate deployed models for the selector.
    subId: process.env.AZURE_AI_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID || '',
    resourceGroup: process.env.AZURE_AI_RESOURCE_GROUP || '',
    accountName: process.env.AZURE_AI_ACCOUNT || ''
};
const AI_SCOPE = 'https://cognitiveservices.azure.com';
const ARM_SCOPE = 'https://management.azure.com';

// ── GitHub Copilot token: env var (server/Azure) or `gh` CLI (local dev) ──
function getGithubToken() {
    const envTok = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim();
    if (envTok) return envTok;
    return execSync('gh auth token', { encoding: 'utf8', timeout: 10000 }).trim();
}

// ── List chat-capable models the current Copilot token can access ─────────
async function listCopilotModels(ghToken) {
    ghToken = (ghToken && ghToken.trim()) || getGithubToken();
    const resp = await fetch('https://api.githubcopilot.com/models', {
        headers: { 'Authorization': `Bearer ${ghToken}`, 'Copilot-Integration-Id': 'pi-fabric-chat-agent' }
    });
    if (!resp.ok) throw new Error(`models ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const items = Array.isArray(data.data) ? data.data : [];
    const seen = {};
    const models = [];
    for (const m of items) {
        const id = m.id || m.model;
        if (!id || seen[id]) continue;
        const cap = m.capabilities || {};
        if (cap.type && cap.type !== 'chat') continue; // skip embeddings, etc.
        seen[id] = true;
        models.push({ id, name: m.name || id, vendor: m.vendor || '' });
    }
    return models;
}

// ── Azure AI Foundry: auth header (api-key or Entra bearer) ───────────────
async function foundryAuthHeaders() {
    if (AI.key) return { 'api-key': AI.key };
    const token = await getToken(AI_SCOPE);
    return { 'Authorization': `Bearer ${token}` };
}

// ── Azure AI Foundry: unified chat/completions (OpenAI-compatible) ────────
async function foundryChat(body) {
    if (!AI.endpoint) throw new Error('AZURE_AI_ENDPOINT not configured');
    const url = `${AI.endpoint}/models/chat/completions?api-version=${AI.apiVersion}`;
    // Retry on 429 (rate limit) with backoff, honouring Retry-After, so brief spikes over
    // the deployment's TPM don't surface as a hard error to the user.
    for (let attempt = 0; ; attempt++) {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, await foundryAuthHeaders());
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (resp.status !== 429 || attempt >= 3) return resp;
        const ra = Number(resp.headers.get('retry-after')) || 0;
        const waitMs = ra > 0 ? ra * 1000 : Math.min(8000, 800 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, waitMs));
    }
}

// ── Azure AI Foundry: list deployed models for the selector ───────────────
function parseModelsList(str) {
    return String(str).split(',').map(s => s.trim()).filter(Boolean).map(entry => {
        const [id, name, vendor] = entry.split(/[|~]/).map(x => (x || '').trim());
        return { id, name: name || id, vendor: vendor || '' };
    });
}
async function listFoundryModels() {
    // 1) Explicit list wins (fully deterministic for customers).
    if (AI.modelsList) return parseModelsList(AI.modelsList);
    // 2) Enumerate live deployments via ARM when identifiers are provided.
    if (AI.subId && AI.resourceGroup && AI.accountName) {
        const token = await getToken(ARM_SCOPE);
        const url = `https://management.azure.com/subscriptions/${AI.subId}/resourceGroups/${AI.resourceGroup}` +
            `/providers/Microsoft.CognitiveServices/accounts/${AI.accountName}/deployments?api-version=2023-05-01`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) throw new Error(`ARM deployments ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        const seen = {};
        const models = [];
        for (const d of (data.value || [])) {
            const id = d.name; // deployment name is what the inference API expects as `model`
            if (!id || seen[id]) continue;
            const m = d.properties && d.properties.model;
            const modelName = (m && m.name) || id;
            // Skip embedding / non-chat deployments (they can't serve chat/completions).
            if (/embed|whisper|tts|dall-?e|image/i.test(modelName) || /embed/i.test(id)) continue;
            seen[id] = true;
            models.push({ id, name: modelName, vendor: (m && m.format) || '' });
        }
        return models;
    }
    // 3) Nothing to enumerate — expose just the default.
    return [{ id: AI.defaultModel, name: AI.defaultModel, vendor: 'Azure AI Foundry' }];
}

// Whether the SERVER can do Copilot without a user-supplied token (env token or gh CLI).
let _copilotServerAvail = null;
function copilotServerAvailable() {
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) return true;
    if (_copilotServerAvail !== null) return _copilotServerAvail;
    try { execSync('gh auth token', { stdio: 'pipe', timeout: 5000 }); _copilotServerAvail = true; }
    catch { _copilotServerAvail = false; }
    return _copilotServerAvail;
}

// ── Unified model list for the UI selector ────────────────────────────────
async function listModels(providerOverride, ghToken) {
    const prov = (String(providerOverride || '').toLowerCase() || AI.provider);
    const providers = { foundry: !!AI.endpoint, copilot: copilotServerAvailable() };
    if (prov === 'copilot') return { default: CONFIG.copilotModel, provider: 'copilot', providers, models: await listCopilotModels(ghToken) };
    return { default: AI.defaultModel, provider: 'foundry', providers, models: await listFoundryModels() };
}

// ── Token acquisition ────────────────────────────────────────────────────
// Uses a service principal (client-credentials) when AZURE_CLIENT_ID/SECRET/TENANT
// are set (headless / Azure App Service); otherwise falls back to the local `az` CLI.
const _tokenCache = {};
async function getTokenSP(resource) {
    const tenant = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const secret = process.env.AZURE_CLIENT_SECRET;
    const cacheKey = resource;
    const now = Date.now();
    if (_tokenCache[cacheKey] && _tokenCache[cacheKey].exp > now + 60000) {
        return _tokenCache[cacheKey].token;
    }
    const scope = resource.endsWith('/.default') ? resource : resource.replace(/\/$/, '') + '/.default';
    const params = new URLSearchParams({
        client_id: clientId, client_secret: secret,
        grant_type: 'client_credentials', scope
    });
    const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    if (!resp.ok) throw new Error(`SP token failed for ${resource}: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    _tokenCache[cacheKey] = { token: data.access_token, exp: now + (data.expires_in || 3600) * 1000 };
    return data.access_token;
}

function getTokenCli(resource) {
    try {
        const result = execSync(
            `az account get-access-token --resource "${resource}" --query accessToken -o tsv`,
            { encoding: 'utf8', env: { ...process.env, AZURE_CLI_DISABLE_CONNECTION_VERIFICATION: '1' }, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const lines = result.trim().split('\n');
        const token = lines.find(l => l.startsWith('eyJ'));
        if (!token) throw new Error('No JWT found in az output');
        return token.trim();
    } catch (e) {
        throw new Error(`Token acquisition failed for ${resource}: ${e.message}`);
    }
}

// App Service / Container managed identity via IMDS (IDENTITY_ENDPOINT).
async function getTokenMI(resource) {
    const idEndpoint = process.env.IDENTITY_ENDPOINT;
    const idHeader = process.env.IDENTITY_HEADER;
    if (!idEndpoint || !idHeader) throw new Error('managed identity not available');
    const cacheKey = 'mi:' + resource;
    const now = Date.now();
    if (_tokenCache[cacheKey] && _tokenCache[cacheKey].exp > now + 60000) {
        return _tokenCache[cacheKey].token;
    }
    // App Service IMDS uses the AAD *resource* form (no /.default suffix).
    const res = resource.replace(/\/\.default$/, '');
    const url = `${idEndpoint}?resource=${encodeURIComponent(res)}&api-version=2019-08-01`;
    const resp = await fetch(url, { headers: { 'X-IDENTITY-HEADER': idHeader } });
    if (!resp.ok) throw new Error(`MI token failed for ${resource}: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    const expMs = data.expires_on ? (parseInt(data.expires_on, 10) * 1000) : (now + 3600 * 1000);
    _tokenCache[cacheKey] = { token: data.access_token, exp: expMs };
    return data.access_token;
}

async function getToken(resource) {
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
        return await getTokenSP(resource);
    }
    if (process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER) {
        return await getTokenMI(resource);
    }
    return getTokenCli(resource);
}

// ── KQL query ────────────────────────────────────────────────────────────
async function queryKql(kql) {
    const token = await getToken(CONFIG.kustoCluster);
    const resp = await fetch(`${CONFIG.kustoCluster}/v1/rest/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csl: kql, db: CONFIG.kustoDb })
    });
    if (!resp.ok) throw new Error(`KQL error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    if (!data.Tables?.[0]?.Rows) return [];
    const cols = data.Tables[0].Columns.map(c => c.ColumnName);
    return data.Tables[0].Rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// ── DAX query ────────────────────────────────────────────────────────────
async function queryDax(dax) {
    const token = await getToken('https://analysis.windows.net/powerbi/api');
    const url = `https://api.powerbi.com/v1.0/myorg/groups/${CONFIG.pbiWorkspace}/datasets/${CONFIG.pbiDataset}/executeQueries`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } })
    });
    if (!resp.ok) throw new Error(`DAX error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data.results?.[0]?.tables?.[0]?.rows || [];
}

// ── Chart spec builder ───────────────────────────────────────────────────
// Turns query rows into a line-chart spec: first column = x axis, remaining
// numeric columns = series. Non-numeric/null values become gaps (null).
function cleanName(k) { const m = String(k).match(/\[([^\]]+)\]$/); return m ? m[1] : String(k); }
function formatX(v) {
    if (v == null) return '';
    if (typeof v === 'number' && v >= 19000101 && v <= 99991231) {
        const s = String(v); return `${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    const s = String(v);
    const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (dt) {
        const [, , mo, da, hh, mi] = dt;
        return (hh && !(hh === '00' && mi === '00')) ? `${mo}-${da} ${hh}:${mi}` : `${mo}-${da}`;
    }
    return s;
}
function toNum(v) { if (v == null || v === '') return null; const n = Number(v); return isFinite(n) ? n : null; }
function buildChartSpec(title, yLabel, rows, seriesUnits) {
    if (!Array.isArray(rows) || !rows.length) return { title: title || '', yLabel: yLabel || '', labels: [], series: [] };
    const cols = Object.keys(rows[0]);
    const xKey = cols[0];
    const units = Array.isArray(seriesUnits) ? seriesUnits : [];
    const labels = rows.map(r => formatX(r[xKey]));
    const series = [];
    cols.slice(1).forEach((k, i) => {
        if (rows.some(r => toNum(r[k]) !== null)) {
            series.push({ name: cleanName(k), unit: units[i] != null ? String(units[i]).trim() : '', data: rows.map(r => toNum(r[k])) });
        }
    });
    return { title: title || '', yLabel: yLabel || '', xKey: cleanName(xKey), labels, series };
}

// Best-effort extraction of the primary table/entity a query touches, for UI badges.
function guessTable(type, query) {
    if (!query) return '';
    if (type === 'kql') {
        const m = String(query).match(/^[\s(]*([A-Za-z_][A-Za-z0-9_]*)/);
        return m ? m[1] : '';
    }
    // dax (also chart dax): first single-quoted table name, else a bare table before [col]
    let m = String(query).match(/'([^']+)'/);
    if (m) return m[1];
    m = String(query).match(/([A-Za-z_][A-Za-z0-9_]*)\s*\[/);
    return m ? m[1] : '';
}

// Real per-series statistics + data-plausibility flags so the model interprets the
// ACTUAL values (not a generic guess). Flags impossible temps and high variability.
function roundSig(v) { if (v == null || !isFinite(v)) return null; const a = Math.abs(v); const d = a >= 100 ? 1 : a >= 1 ? 2 : 3; return Math.round(v * 10 ** d) / 10 ** d; }
function seriesStats(chart) {
    return (chart.series || []).map(s => {
        const vals = s.data.filter(v => v != null && isFinite(v));
        const unit = s.unit || '';
        if (!vals.length) return { name: s.name, unit, points: 0 };
        const n = vals.length;
        const min = Math.min(...vals), max = Math.max(...vals);
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
        const isTemp = /deg|°|temp|fahrenheit|celsius/i.test(unit) || /(^|[^a-z])[fc]$/i.test(unit.trim()) || /temp/i.test(s.name);
        const flags = [];
        if (min < 0 && isTemp) flags.push('NEGATIVE temperature values (physically impossible — bad data / sensor fault, NOT normal operation)');
        else if (min < 0) flags.push('negative values present');
        const cov = mean !== 0 ? std / Math.abs(mean) : (std > 0 ? 99 : 0);
        if ((max - min) > 0 && (cov > 0.4 || (max - min) > Math.abs(mean) * 1.5)) flags.push('HIGH variability / large swings — NOT stable');
        return { name: s.name, unit, points: n, min: roundSig(min), max: roundSig(max), mean: roundSig(mean), std: roundSig(std), first: roundSig(vals[0]), last: roundSig(vals[n - 1]), range: roundSig(max - min), flags };
    });
}

// Normalize an x-axis value (date_key int OR datetime string) to a 'YYYY-MM-DD' day key.
function toDayKey(v) {
    if (v == null) return null;
    if (typeof v === 'number' && v >= 19000101 && v <= 99991231) {
        const s = String(v); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// Day-grain running-state filter: keep only days where the unit's running indicator
// (MW load / RPM) averaged >= threshold, so offline periods are excluded. Works for
// KQL trends (running data from PiEvents — full history) and legacy DAX/fact_pi trends.
async function applyRunningFilter(rows, runningTag, runningMin, source) {
    if (!Array.isArray(rows) || !rows.length || !runningTag) return { rows, removed: 0, applied: false };
    const xKey = Object.keys(rows[0])[0];
    const minV = (typeof runningMin === 'number' && isFinite(runningMin)) ? runningMin : 10;
    const safeTag = String(runningTag).replace(/"/g, '');
    const runMap = {};
    if (source === 'kql') {
        const days = rows.map(r => toDayKey(r[xKey])).filter(Boolean).sort();
        if (!days.length) return { rows, removed: 0, applied: false };
        const lo = days[0], hi = days[days.length - 1];
        const runQ = `PiEvents | where Tag == "${safeTag}" and Ts >= datetime(${lo}) and Ts < datetime(${hi}) + 1d and not(Questionable) | summarize run=avg(todouble(Value)) by d=format_datetime(bin(Ts, 1d), 'yyyy-MM-dd')`;
        const runRows = await queryKql(runQ);
        if (!runRows.length) return { rows, removed: 0, applied: false };
        runRows.forEach(rr => { runMap[rr.d] = Number(rr.run); });
    } else {
        const dks = rows.map(r => r[xKey]).filter(v => typeof v === 'number' && v >= 19000101 && v <= 99991231);
        if (!dks.length) return { rows, removed: 0, applied: false };
        const lo = Math.min(...dks), hi = Math.max(...dks);
        const runQ = `EVALUATE SUMMARIZECOLUMNS('fact_pi'[date_key], KEEPFILTERS(FILTER('fact_pi', 'fact_pi'[Tag] = "${safeTag}" && 'fact_pi'[date_key] >= ${lo} && 'fact_pi'[date_key] <= ${hi})), "run", AVERAGE('fact_pi'[ValueNumeric]))`;
        const runRows = await queryDax(runQ);
        if (!runRows.length) return { rows, removed: 0, applied: false };
        const rk = Object.keys(runRows[0]);
        runRows.forEach(rr => { runMap[toDayKey(rr[rk[0]])] = Number(rr[rk[1]]); });
    }
    const kept = rows.filter(r => { const v = runMap[toDayKey(r[xKey])]; return v != null && isFinite(v) && v >= minV; });
    if (!kept.length) return { rows, removed: 0, applied: false }; // never blank the chart
    return { rows: kept, removed: rows.length - kept.length, applied: true, threshold: minV, tag: safeTag };
}

// ── Deterministic sensor correlation (Pearson, model-independent) ─────────
// Pulls each tag as an aligned, time-binned average series from PiEvents,
// optionally restricts to running periods, then computes Pearson r for every
// tag pair in JS. An optional lead/lag search reports whether one signal leads
// another. This does NOT rely on the LLM to compute statistics.
function _pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    const cov = sxy - (sx * sy) / n;
    const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
    if (vx <= 0 || vy <= 0) return null;
    return cov / Math.sqrt(vx * vy);
}
function _strength(r) {
    const a = Math.abs(r);
    const mag = a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'negligible';
    return `${mag} ${r >= 0 ? 'positive' : 'negative'}`;
}
async function correlateSensors(args) {
    const tags = (args.tags || []).map(t => String(t).trim()).filter(Boolean);
    if (tags.length < 2) throw new Error('Provide at least 2 tag IDs to correlate.');
    const hours = Math.min(Math.max(Number(args.hours) || 168, 1), 24 * 60);   // default 7d, cap 60d
    const binMin = Math.min(Math.max(Number(args.bin_minutes) || 60, 1), 1440); // default 1h
    const runTag = args.running_tag ? String(args.running_tag).trim() : '';
    const runMin = args.running_min != null ? Number(args.running_min) : 10;
    const maxLagBins = Math.min(Math.max(Number(args.max_lag_bins) || 0, 0), 24); // optional lead/lag search

    // One query: binned average per tag (plus running tag if given).
    const allTags = runTag && !tags.includes(runTag) ? tags.concat(runTag) : tags;
    const tagList = allTags.map(t => `"${t.replace(/"/g, '')}"`).join(', ');
    const kql = `PiEvents
| where Ts > ago(${hours}h)
| where Tag in (${tagList})
| summarize v = avg(todouble(Value)) by Tag, t = bin(Ts, ${binMin}m)
| order by t asc`;
    const rows = await queryKql(kql);

    // Pivot into t -> {tag: value}
    const byBin = new Map();
    for (const r of rows) {
        const t = r.t, tag = r.Tag, v = Number(r.v);
        if (t == null || !isFinite(v)) continue;
        if (!byBin.has(t)) byBin.set(t, {});
        byBin.get(t)[tag] = v;
    }
    let bins = [...byBin.keys()].sort();
    // Running-state filter: keep bins where running tag avg >= threshold.
    let excluded = 0;
    if (runTag) {
        const before = bins.length;
        bins = bins.filter(t => { const v = byBin.get(t)[runTag]; return v != null && v >= runMin; });
        excluded = before - bins.length;
    }
    const idx = new Map(bins.map((t, i) => [t, i]));

    // Build per-tag aligned arrays over the (filtered) bins; NaN where missing.
    const series = {};
    for (const tag of tags) series[tag] = bins.map(t => { const v = byBin.get(t)[tag]; return v == null ? NaN : v; });

    const perTag = tags.map(tag => ({ tag, points: series[tag].filter(isFinite).length }));

    const pairs = [];
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
        const A = series[tags[i]], B = series[tags[j]];
        // zero-lag on common finite bins
        const ax = [], bx = [];
        for (let k = 0; k < bins.length; k++) if (isFinite(A[k]) && isFinite(B[k])) { ax.push(A[k]); bx.push(B[k]); }
        const r0 = _pearson(ax, bx);
        const pair = { a: tags[i], b: tags[j], n: ax.length, r: r0 == null ? null : +r0.toFixed(3), strength: r0 == null ? 'insufficient data' : _strength(r0) };
        // optional lead/lag: shift B by L bins, find |r| peak
        if (maxLagBins > 0 && r0 != null) {
            let best = { lag: 0, r: r0 };
            for (let L = -maxLagBins; L <= maxLagBins; L++) {
                if (L === 0) continue;
                const px = [], py = [];
                for (let k = 0; k < bins.length; k++) { const kk = k + L; if (kk < 0 || kk >= bins.length) continue; if (isFinite(A[k]) && isFinite(B[kk])) { px.push(A[k]); py.push(B[kk]); } }
                const rr = _pearson(px, py);
                if (rr != null && Math.abs(rr) > Math.abs(best.r)) best = { lag: L, r: rr };
            }
            if (best.lag !== 0) {
                const mins = best.lag * binMin;
                // B index shifted by +L aligns A[k] with B[k+L]: positive L means B lags A (A leads).
                pair.best_lag_minutes = mins;
                pair.best_lag_r = +best.r.toFixed(3);
                pair.lead_lag = mins > 0 ? `${tags[i]} leads ${tags[j]} by ~${Math.abs(mins)} min` : `${tags[j]} leads ${tags[i]} by ~${Math.abs(mins)} min`;
            }
        }
        pairs.push(pair);
    }

    return {
        window_hours: hours, bin_minutes: binMin, bins_analyzed: bins.length,
        running_filter: runTag ? { tag: runTag, min: runMin, bins_excluded: excluded } : null,
        per_tag: perTag, pairs,
        note: 'Pearson r computed server-side over aligned time bins (real math, not estimated). |r|>=0.8 very strong, 0.6 strong, 0.4 moderate, 0.2 weak. Report each pair\'s r, strength and (if present) the lead/lag. Correlation is not causation — corroborate with root_cause / work requests before asserting a mechanism. If n is small or bins_analyzed is low, say the result is tentative.'
    };
}

// ── GitHub Copilot API ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are OneGrid Analyst, a power-plant analyst for the OneGrid generation fleet. You have access to real-time sensor data (PI), maintenance work orders (AIMM), and ML anomaly scores stored in Microsoft Fabric.

AVAILABLE DATA TOOLS:
- query_kql: Eventhouse (PiEvents, AimmWorkRequestsRaw, SmartSignalIncidents, IcareEvents, GadsEvents, PCIOutages)
- query_dax: Semantic model (fact_pi 197M rows, watchlist, root_cause, dim_equipment, bridge_pi_tag_to_asset, predictions)
- search_manuals: Foundry IQ equipment-manuals knowledge base — operating limits, specs, procedures, and troubleshooting/work-order resolution. Use for "how do I / what's the limit / what's the procedure / how do I resolve this" questions and cite the manual + section.

ABOUT THE FABRIC DATA AGENT (answer accurately if asked):
- OneGrid includes a published **Microsoft Fabric Data Agent** ("OneGridOntologyAgent"). It is a governed, natural-language querying agent grounded in the OneGrid **semantic model** (watchlist, predictions_shortterm/longterm, anomaly_advisories, root_cause, dim_asset, dim_equipment, dim_date, etc.). It translates plain-language questions into queries over that model and returns grounded, explainable answers.
- It is NOT an ingestion/ETL/data-movement tool. Do not describe it as being for "data movement" or "integrations" — that is incorrect. It is for natural-language analytics over the governed semantic model.
- Users reach it via the "Ask Fabric Data Agent" toggle in this chat (a separate path from you). You, by contrast, run precise KQL/DAX directly and can trend, chart, correlate, and search manuals. Both query the same Fabric data; the Data Agent is the governed NL-over-semantic-model option, while you offer fine-grained tool control.
- If asked which to use: the Data Agent is great for quick, governed NL questions over modeled entities (risk, watchlist, predictions); your direct tools are better for real-time sensor trends (KQL), custom aggregations (DAX), correlation, charts, and manual lookups.

KEY RULES:
1. ALWAYS filter to running (online) periods before trending or comparing values — offline/shutdown data distorts everything. "Running" = the unit's load/speed running_indicator above a threshold:
   - RV2 (Unit 2): net load RV2:GEJU2GE00.AG > ~10 MW (or turbine speed RV2:TXSU2TS14.AG > 3500 RPM)
   - RV3 (Unit 3): gross load RV3:GEJU3GE03.AG > ~10 MW (or turbine speed RV3:TXSU3TS15A.AG > 3500 RPM)
   - Other units: resolve the running_indicator from bridge_pi_tag_to_asset (tag_role = "running_indicator").
   For charts, pass running_tag (+ running_min) to plot_line_chart so offline days are dropped automatically. For query_dax comparisons, restrict to running days similarly.
2. Use 30+ day baselines at similar conditions for Z-score comparisons
3. Exclude startup/shutdown transition days from analysis
4. Cross-reference sensor anomalies with AIMM work requests
5. The AAKR watchlist may have false positives from shutdown data in baselines
6. For fact_pi: filter by date_key (YYYYMMDD int) and Tag. Never scan without filters.
7. SENSOR SANITY / DATA QUALITY: readings must be physically plausible. Temperatures in °F for air/steam/water are never negative and are not near zero during operation; pressures/flows are non-negative. Treat impossible or wildly out-of-range values (negative temps, huge swings) as BAD DATA or a sensor fault, not normal operation — and if the tag is a watchlist anomaly, treat the swings as the anomaly. NEVER describe negative-temperature, highly variable, or flagged data as "stable"/"consistent"/"normal". Always actually inspect the values before concluding.

UNIT ONLINE/OFFLINE STATUS (check and state this FIRST for any status / health / "how is X" question):
- A unit is ONLINE if its generator load is above ~10 MW right now, otherwise OFFLINE (shut down). Check the LATEST real-time reading via PiEvents:
  PiEvents | where Tag == "RV3:GEJU3GE03.AG" and Ts > ago(3h) | top 1 by Ts desc | project Ts, MW=todouble(Value)
- Load tags: RV3 = RV3:GEJU3GE03.AG (gross MW); RV2 = RV2:GEJU2GE00.AG (net MW). Other units: the running_indicator MW tag from bridge_pi_tag_to_asset.
- State it plainly up front, e.g. "RV2 Unit 2 is ONLINE at ~380 MW" or "RV3 is OFFLINE (0 MW, unit down)". When the unit is OFFLINE, say so clearly and note that live sensor/watchlist anomalies are lower priority until it restarts.

WHY IS A UNIT DOWN / OUTAGE REASON (for "why is RV3 down", "why is X offline/derated", "what happened to RV3", "is RV3 down and why"):
1. State ONLINE/OFFLINE first (the load check above).
2. The authoritative REASON is PCIOutages.reason. Query the unit's current outage and read reason + priority + MW + dates:
   PCIOutages | where unit_name contains "RIVERTON3" and (outage_status == "Implemented" or end_date >= now()) | project event_type, mw, begin_date, end_date, outage_status, priority, reason | order by begin_date desc | take 1
   CRITICAL: outage_status == "Implemented" means the unit is CURRENTLY OUT even if the planned end_date has already passed (the estimated return slipped) — do NOT require now() <= end_date, and do NOT say "no current outage" when end_date is in the past but status is still Implemented. If nothing is Implemented, drop the status filter, take the most recent row, and give it as the last known reason.
3. Corroborate / add detail from AIMM work requests for that unit: AimmWorkRequestsRaw | where trim(' ',site_code)=='LG' and trim(' ',parent_descr)=='Unit 3' | where problem_descr has_any('FO','forced outage','leak','trip','H2','hydrogen') | order by obsrv_date desc | take 5. "FO" in a problem_descr = Forced Outage.
4. Optionally confirm with the PI signal behind the reason (e.g. a hydrogen seal leak shows RV3:GHPU3GP00.AG H2 pressure falling from ~50 toward 0 PSIG).
5. Answer plainly: status + the PCIOutages reason + priority/dates, then the corroborating WR / sensor. Example: "RV3 is OFFLINE (0 MW). It is on a FORCED MISO outage since Jul 15 for a hydrogen seal leak at the #8 generator bearing (PCIOutages). Corroborated by AIMM WR 378430 'Generator Bearing #8 H2 Leak FO' and generator H2 pressure (GHPU3GP00) now ~0 PSIG."

WORKING DAX EXAMPLES (use these exact patterns):
- fact_pi daily avg for a tag:
  EVALUATE SUMMARIZECOLUMNS('fact_pi'[date_key], KEEPFILTERS(FILTER('fact_pi', 'fact_pi'[Tag] = "RV3:CHPU3TP28.AG" && 'fact_pi'[date_key] >= 20260701 && 'fact_pi'[date_key] <= 20260712)), "Avg", AVERAGE('fact_pi'[ValueNumeric]), "Count", COUNT('fact_pi'[ValueNumeric])) ORDER BY 'fact_pi'[date_key]
- WATCHLIST is FLEET-WIDE (assets include RV2_U2_Boiler, RV3_*, etc.). scoring_date is TEXT "YYYY-MM-DD". Do NOT filter to a single unit unless the user explicitly names one.
  "What should I watch / monitor?" → filter to the target day and rank by severity, then risk. Severity of recommended_action: CRITICAL > HIGH > MEDIUM > LOW. Use this exact shape (substitute the desired day; for "today" use the CURRENT DATE given below):
  EVALUATE TOPN(50, FILTER('watchlist', 'watchlist'[scoring_date] = "YYYY-MM-DD"), SWITCH(TRUE(), 'watchlist'[recommended_action]="CRITICAL",4, 'watchlist'[recommended_action]="HIGH",3, 'watchlist'[recommended_action]="MEDIUM",2, 'watchlist'[recommended_action]="LOW",1, 0), DESC, 'watchlist'[risk_contribution], DESC) ORDER BY SWITCH(TRUE(), 'watchlist'[recommended_action]="CRITICAL",4, 'watchlist'[recommended_action]="HIGH",3, 'watchlist'[recommended_action]="MEDIUM",2, 'watchlist'[recommended_action]="LOW",1, 0) DESC, 'watchlist'[risk_contribution] DESC
  IMPORTANT: TOPN does not return sorted rows on its own — always append the ORDER BY (as above) so CRITICAL/HIGH items appear first in the result you read.
  Useful watchlist columns: asset_id, model_name, recommended_action, descriptor, tag_name, current_value, baseline_mean, baseline_std, risk_contribution, trend_direction, recommendation_text, watch_horizon_days.
  risk_contribution scales differ by model_name (SmartSignal/AAKR = z-score up to ~100; GBM/Cox = probability 0-1) — rank by recommended_action FIRST, not raw risk across models. Summarize by asset, list the CRITICAL/HIGH items with their descriptor and recommendation_text.
  If a day returns 0 rows it may not be scored yet — run EVALUATE ROW("latest", MAX('watchlist'[scoring_date])), then re-query with that date and tell the user which date you used.
  To restrict to one unit only when asked, add: && SEARCH("RV3", 'watchlist'[asset_id], 1, 0) > 0
- ROOT CAUSE of a CRITICAL tag (for "what caused X", "why did X go critical", "root cause of X", "explain the anomaly on X", "why is X behaving that way"):
  The 'root_cause' table has ONE row per CRITICAL watchlist tag for the current day, with a diagnosed cause and the correlated signals. Query it by tag:
  EVALUATE SELECTCOLUMNS(FILTER('root_cause', 'root_cause'[tag] = "RV2:FLZU2HLV51XFB.AG"), "mechanism", 'root_cause'[failure_mechanism], "cause", 'root_cause'[root_cause], "contributing", 'root_cause'[contributing_tag_names], "action", 'root_cause'[recommended_action], "confidence", 'root_cause'[confidence])
  Columns: tag, descriptor, failure_mechanism (short label), root_cause (full narrative), contributing_tags (human readable), contributing_tag_names (semicolon-separated PI Tag ids), recommended_action, confidence (0-1).
  To list every critical cause at once: EVALUATE SELECTCOLUMNS('root_cause', "tag",'root_cause'[tag], "mechanism",'root_cause'[failure_mechanism], "action",'root_cause'[recommended_action]).
  ANSWER SHAPE (do BOTH): (1) State the failure_mechanism, give the root_cause narrative + recommended_action + confidence. (2) SHOW the correlation with a DENSE chart — split contributing_tag_names on ";" and call plot_line_chart with source "kql" (NOT dax) over PiEvents, and DO NOT pass running_tag for this chart (you want the full recent window so the signals are dense and the correlation is visible). Use ~48-72h binned hourly, pivoted by Tag so the CRITICAL tag and each contributing tag are separate series. Exact pattern (substitute the real tag ids):
     let tags = dynamic(["<CRITICAL_TAG>", "<CONTRIB1>", "<CONTRIB2>", "<CONTRIB3>"]);
     PiEvents | where Tag in (tags) and Ts > ago(72h) | summarize Value=avg(toreal(Value)) by bin(Ts, 1h), Tag | evaluate pivot(Tag, any(Value)) | order by Ts asc
     Pass series_units if you know the eng_units. If the signals have very different magnitudes (e.g. a turbine SPEED in RPM alongside valve % or pressures), you MUST pass series_units (look each tag up in bridge_pi_tag_to_asset) in the SAME column order as the pivot output, so the chart splits them onto separate stacked panels instead of one axis where the largest signal flattens the rest. This visual correlation is the whole point of the question — ALWAYS produce that chart, and read what it shows (which contributing signal moves with the critical tag).
  If root_cause has no row for the tag (e.g. it is not one of today's CRITICAL tags), say so, then fall back to the watchlist row (descriptor, recommendation_text, trend_direction) plus the tag's own trend.
- row count:
  EVALUATE ROW("count", COUNTROWS('fact_pi'))
- DO NOT use DATE() function with scoring_date — it is a text column, use string comparison.
- DO NOT use CALCULATETABLE with INFO functions.
- Always wrap column references with table name: 'table'[column]

KEY TAGS (RV3):
- Back pressure: RV3:CHPU3TP28.AG (inHgA)
- Air in-leakage: RV3:CHLU3CDIA2.AG (SCFM)  
- CW temps: RV3:CWTU3CT11.AG, RV3:CWTU3CT12.AG (°F)
- Turbine speed: RV3:TXSU3TS15A.AG (RPM)
- Turbine valve: RV3:TVZU3TS17V1.AG (%)
- Bearing vibs: RV3:TBYU3TS01Y.AG through TS10Y (MILS)
- Generator H2 (hydrogen) pressure: RV3:GHPU3GP00.AG (PSIG) — the hydrogen-seal-leak indicator (a healthy H2-cooled generator holds ~50 PSIG; a sustained fall toward 0 = seal leak / generator degassed for repair).
- Generator bearing metal temps: bearings 7 and 8 (the GENERATOR-end bearings) are RV3:GBTU3GB01.AG and RV3:GBTU3GB02.AG (°F). Generator bearings use the GB prefix, so "#8 generator bearing" = RV3:GBTU3GB02.AG. Turbine bearings 1-6 are the SEPARATE RV3:TBTU3TB01.AG-TB06.AG — do NOT map a "generator bearing 8" to a turbine-bearing tag.
- Generator H2 cooled-gas temps: RV3:GCTU3GT15.AG-GT18.AG (°F). Stator cooling water: RV3:GCPU3GP20.AG (inlet PSIG), RV3:GCTU3GT21.AG-GT23.AG (°F).
- GENERATOR/H2 SYNONYMS: "hydrogen seal" / "H2 seal" / "gen hydrogen" -> RV3:GHPU3GP00.AG; "generator bearing 8" / "#8 bearing" -> RV3:GBTU3GB02.AG. These generator/H2 tags are NOT on the ML watchlist, so resolve them from here or bridge_pi_tag_to_asset (search "HYDROGEN" or "BEARING  8"), not the watchlist.
- H2 PRESSURE IS AN EXCEPTION TO THE RUNNING-ONLY RULE (rule 1): a hydrogen seal leak shows up as RV3:GHPU3GP00.AG decaying while the unit is OFFLINE (a sound generator holds ~50 PSIG even shut down; a leaking one falls toward 0 and stays there once degassed for repair). When trending H2 pressure or investigating a seal leak, INCLUDE offline days — do NOT pass running_tag and do NOT restrict to running periods, or you will hide the leak. Inspect the full window and call out any sustained fall toward 0 as the leak; NEVER label a H2 trend that drops to 0 as "stable".

TAGS vs DESCRIPTIONS (critical for trends — this is where trend queries lose all rows):
- fact_pi and PiEvents filter ONLY by the Tag ID (e.g. "RV2:BATU2BT22.AG"). They do NOT contain human descriptions. NEVER put a description like "Air From 2A Airpreheater" or "Throttle Press B" into a Tag/where filter — it returns 0 rows.
- To trend/query a metric named in words, FIRST resolve the description to a Tag id, THEN query fact_pi/PiEvents with that Tag.
- RESOLUTION ORDER (do this every time you resolve a named metric to a Tag for trending):
  1. FIRST check the WATCHLIST: search 'watchlist'[descriptor] for the metric's keyword(s). If it appears, USE that row's tag_name — a metric name can map to several sibling sensors and the watchlist tag is the SPECIFIC one flagged as anomalous, which is the one the user wants to see (not a clean sibling). Prefer the most recent scoring_date. Query:
     EVALUATE SELECTCOLUMNS(TOPN(6, FILTER('watchlist', SEARCH("Airpreheater", 'watchlist'[descriptor],1,0)>0), 'watchlist'[scoring_date], DESC), "descriptor", 'watchlist'[descriptor], "tag_name", 'watchlist'[tag_name], "action", 'watchlist'[recommended_action], "scoring_date", 'watchlist'[scoring_date])
  2. Only if it is NOT on the watchlist, look it up in 'bridge_pi_tag_to_asset' (fleet-wide). Columns: Tag (id), tag_description (human name), eng_units, tag_role, downtime_relevance. SEARCH() is case-insensitive.
- SEARCH matches a substring, and stored descriptions often differ from the user's phrasing (user "2A airpreheater air temp" vs stored "AIR FROM 2A AIRPREHEATER"). So search on the 1-2 most DISTINCTIVE keywords (the equipment noun + unit/side token), NOT the whole phrase. If a search returns 0 rows, broaden to a single keyword and review the returned rows to pick the right Tag — do NOT conclude "no data" from a failed name lookup.
- bridge fallback Lookup DAX (a description may map to multiple tags — pick the one whose plant/unit matches, else the first, and tell the user the Tag used):
  EVALUATE SELECTCOLUMNS(FILTER('bridge_pi_tag_to_asset', SEARCH("AIRPREHEATER", 'bridge_pi_tag_to_asset'[tag_description],1,0)>0 || SEARCH("THROTTLE PRESS", 'bridge_pi_tag_to_asset'[tag_description],1,0)>0), "Tag", 'bridge_pi_tag_to_asset'[Tag], "desc", 'bridge_pi_tag_to_asset'[tag_description], "units", 'bridge_pi_tag_to_asset'[eng_units])
- Then plot the resolved Tag ids. Use eng_units for the chart y_label. Watchlist-flagged examples: "Air From 2A Airpreheater"=RV2:BATU2BT22.AG (CRITICAL, the anomalous tag), "Throttle Press A"=RV2:TSPU2TP01.AG, "Throttle Press B"=RV2:TSPU2TP02.AG.
- If the resolved-Tag trend query still returns 0 rows, only then report that no sensor data exists for that range.
- When trending SEVERAL metrics, resolve and plot each independently: if some resolve and have data, PLOT THOSE and only note the specific one(s) you could not resolve. NEVER report a blanket "no data" when at least one metric resolved — that is almost always a lookup miss, not missing data.

AIMM WORK REQUESTS (KQL table: AimmWorkRequestsRaw):
- String columns have trailing spaces — ALWAYS trim() when filtering (e.g. trim(' ', site_code)).
- Column roles: site_code = 2-letter PLANT code only; parent_descr = the UNIT/system ("Unit 1"/"Unit 2"/"Unit 3"/"Common"); entity_descr = the specific equipment; problem_descr = the issue text. date columns (create_date, update_date, complete_date) are datetime.
- MAPPING a watchlist asset_id to AIMM (this is where queries usually lose all rows):
  asset_id format is <PLANT><unit>_U<unit>_<Equipment>, e.g. "RV2_U2_Boiler" = Riverton, Unit 2, Boiler.
  * PLANT: LG = Riverton. site_code is 'LG' — NEVER 'RV2'/'RV3'. Putting the unit number in site_code returns 0 rows.
  * UNIT: the digit maps to parent_descr = "Unit 2" (trim). NEVER filter unit via site_code or entity_descr.
  * EQUIPMENT: there is NO "Boiler" column value. Match equipment inside entity_descr with keywords, because e.g. "Boiler" appears as "Blr" and is spread across systems.
- Equipment keyword sets for entity_descr has_any(...):
  * Boiler: 'Blr','APH','air preheat','Fuel Gas','Burner','Furnace','Superheat','Economizer','Drum','Waterwall','Soot','Windbox','FD Fan','ID Fan','BFP','Feedwater'
  * Turbine: 'Turbine','Turb','HP','IP','LP','Lube Oil','Bearing','Governor','Throttle'
  * Generator: 'Generator','Gen','Exciter','Stator','Hydrogen','H2'
  * Condenser/CW: 'Condenser','Circ Wtr','Circ Water','Hotwell','Vacuum','Cond Pump'
- WORKING EXAMPLES:
  All recent LG WRs:  AimmWorkRequestsRaw | where trim(' ', site_code) == 'LG' | order by update_date desc | take 10 | project wr_id, wr_status, entity=trim(' ',entity_descr), problem=substring(tostring(problem_descr),0,100), update_date
  LG Unit 3 WRs:      AimmWorkRequestsRaw | where trim(' ', site_code) == 'LG' and trim(' ', parent_descr) == 'Unit 3' | order by update_date desc | take 20
  LG Unit 2 BOILER:   AimmWorkRequestsRaw | where trim(' ', site_code) == 'LG' and trim(' ', parent_descr) == 'Unit 2' | where entity_descr has_any('Blr','APH','air preheat','Fuel Gas','Burner','Furnace','Superheat','Economizer','Drum','Waterwall','Soot','Windbox','FD Fan','ID Fan','BFP','Feedwater') | order by update_date desc | take 20 | project wr_id, wr_status, entity=trim(' ',entity_descr), problem=substring(tostring(problem_descr),0,120), update_date
- FALLBACK: if an equipment keyword filter returns 0 rows, drop the equipment filter and show that unit's recent WRs (parent_descr == "Unit N"), and tell the user you widened to unit level. Only report "no records" after the unit-level query is also empty.

PCI / GADS / OUTAGES (KQL table: PCIOutages):
- Users call this data "PCI", "GADS", or "Outages" — all three refer to the PCIOutages table. It holds MISO outage & derate events for the ENTIRE OneGrid fleet (every plant), one row per outage/derate request.
- Key columns: unit_name (e.g. "IRE.L_RIVERTON3"), plant (e.g. "Riverton"), event_type ("MOOS - MISO Outage" = full outage; "MDE - MISO Derate" = partial derate), mw (real, MW impact), begin_date, end_date, planned_start, planned_end (datetime, UTC), reason (free-text why the unit is out), cause_code, outage_status (Completed / Implemented [currently out] / Submitted / Cancelled / Study / Approved), priority (Forced / Urgent / Emergency / Planned), approved, modified_on, edition, unit_category.
- UNIT MAPPING: "RV3" / "Riverton 3" / "LG Unit 3" = unit_name "IRE.L_RIVERTON3"; "RV2" = "IRE.L_RIVERTON2" (both plant == "Riverton"). IMPORTANT: use contains or ==, NOT the has operator — KQL has matches whole tokens so (unit_name has "RIVERTON") returns 0 because the token is "RIVERTON3". Match either LG unit with: plant == "Riverton"; a specific unit with unit_name == "IRE.L_RIVERTON3" or unit_name contains "RIVERTON3". Other units use PLANT.UNIT codes (e.g. IRE.Ashford1, IRA.BROOKSIDE1) — filter by plant == "<Plant>" or unit_name contains "<token>".
- "Currently out" = outage_status == "Implemented" OR (begin_date <= now() and end_date >= now()). "Current + upcoming" = end_date >= now(). Completed rows are historical (still queryable — do not say "no outages" without checking history too).
- Example — outages for a specific unit (e.g. RV3), including history:
  PCIOutages | where plant == "Riverton" and unit_name contains "RIVERTON3" | project unit_name, plant, event_type, mw, begin_date, end_date, outage_status, priority, reason | order by begin_date desc
- FLEET OUTAGE LIST (use when a user asks for "the outages", "PCI list", "GADS list", "outage list", or outages "for every plant / the fleet"): query PCIOutages for current + upcoming outages across ALL plants and present them grouped by plant with their reasons. Default:
  PCIOutages | where end_date >= now() | project plant, unit_name, event_type, mw, begin_date, end_date, outage_status, reason | order by plant asc, begin_date asc
  Present as a table or grouped list showing plant, unit, event type, MW, dates, status, and reason. If the user asks for "all"/"historical"/"completed", drop the end_date filter. PERSONA NOTE: for Analyst/Maintenance show the full list. For EXECUTIVE, give a SHORT summary instead (e.g. "12 active outages across 8 plants; biggest is Chestnut CC -740 MW; RV3 out for a hydrogen seal leak") and let a follow-up suggestion pill offer the full list — do not dump the whole list for an exec.
- Cross-reference: an active PCIOutages entry explains WHY a unit is offline/derated and often matches sensor anomalies and AIMM work requests (e.g. RV3 "hydrogen seal leak at #8 generator bearing" ↔ bearing watchlist alerts). When analyzing a unit's health, check PCIOutages for a concurrent outage/derate.

When providing analysis, structure as: Finding → Evidence → Root Cause → Recommended Actions.

CHARTS (trends): When the user asks to trend/plot/graph/chart a metric, or to compare metrics over time, call plot_line_chart. Sensor trends come from the real-time store PiEvents (KQL), which holds the FULL sensor history — ALWAYS use source "kql" for sensor trends. Do NOT use fact_pi/DAX for trends: fact_pi is only a rolling 2-day window and will look empty. The query's FIRST column must be the time axis (a binned Ts) and each remaining numeric column a series. PiEvents.Value is dynamic — ALWAYS wrap it in todouble(). ALWAYS pass running_tag (the unit's load Tag, e.g. RV2:GEJU2GE00.AG or RV3:GEJU3GE03.AG) so offline periods are excluded — the server computes running days from PiEvents and drops non-running days. ALSO pass series_units — the eng_units of each series in column order (from bridge_pi_tag_to_asset) — so metrics with different units are drawn on separate stacked panels instead of one distorted axis. The chart renders in the chat automatically; still add a 1-2 sentence read of the trend and say it covers running periods only. Do not also dump the raw numbers. If the user names metrics in words (e.g. "Throttle Press B"), FIRST resolve each to a Tag id (see TAGS vs DESCRIPTIONS) — never filter PiEvents by the description.
- Daily trend over ~30 days (source "kql"), single series:
  PiEvents | where Tag == "RV3:CHPU3TP28.AG" and Ts > ago(30d) and not(Questionable) | summarize BackPressure=avg(todouble(Value)) by bin(Ts, 1d) | order by Ts asc
- Multiple series daily (source "kql") — pivot tags to columns:
  PiEvents | where Tag in ("RV3:CHPU3TP28.AG","RV3:CHLU3CDIA2.AG") and Ts > ago(30d) and not(Questionable) | summarize Value=avg(todouble(Value)) by bin(Ts, 1d), Tag | evaluate pivot(Tag, any(Value)) | order by Ts asc
- Real-time intraday trend (source "kql"), finer bins:
  PiEvents | where Tag == "RV3:CHPU3TP28.AG" and Ts > ago(24h) and not(Questionable) | summarize Value=avg(todouble(Value)) by bin(Ts, 30m) | order by Ts asc


RESPONSE FORMATTING (the UI renders markdown into styled cards, so follow this):
- Open with a one-sentence summary of the answer.
- Group watch/alert items by severity using a heading whose text is the severity word: "### CRITICAL", "### HIGH", "### MEDIUM", "### LOW". Only include groups that actually have items, highest severity first.
- Under each heading use a numbered list. For each item put labeled fields in bold, each on its own line: **Asset**, **Descriptor**, **Recommendation**, **Horizon** (add **Tag**, **Value**, or **Trend** when useful). Keep every field to one short line.
- Use markdown tables for numeric comparisons or short time series.
- Keep prose tight. Do not paste raw query JSON or DAX/KQL unless the user asks to see it.

CORRELATION (for "is X correlated with Y", "which signals move together", "how do these sensors relate", or to quantify a root_cause link): call correlate_sensors with the Tag IDs — it returns the REAL Pearson r per pair computed server-side. NEVER estimate a correlation coefficient yourself from raw numbers; always use this tool. Pass running_tag so offline periods are excluded, and set max_lag_bins (e.g. 6) when the user asks which signal moves first / leads. Report each pair's r + strength label and any lead/lag, and remember correlation is not causation — corroborate with root_cause or work requests before naming a mechanism.

FOLLOW-UP SUGGESTIONS: At the very END of every response, append a machine tag on its own line: [[SUGGESTIONS: question one | question two | question three]] with up to 3 suggested next questions the user is likely to click. Each must be a short, specific question or command the user would type next (<=12 words), grounded in THIS conversation's data — reference concrete tags/equipment/units in play (e.g. "Trend the LV-55N level controller", "Compare 2A vs 2B airpreheater", "Show open work requests for the boiler"). Use these INSTEAD of a prose "Would you like me to..." offer — do not also ask it in sentence form. The tag is stripped before display; never mention it.`;

const TOOLS = [
    { type: 'function', function: { name: 'query_kql', description: 'Query Fabric Eventhouse (KQL). Use for: real-time PI, AIMM work requests, SmartSignal.', parameters: { type: 'object', properties: { kql: { type: 'string' } }, required: ['kql'] } } },
    { type: 'function', function: { name: 'query_dax', description: 'Query Power BI semantic model (DAX). Use for: historical fact_pi, watchlist, equipment dim. ALWAYS filter fact_pi by date_key and Tag.', parameters: { type: 'object', properties: { dax: { type: 'string' } }, required: ['dax'] } } },
    { type: 'function', function: { name: 'plot_line_chart', description: 'Render a line chart in the chat to trend metric(s) over time. Use a KQL query over PiEvents (source "kql") — it holds the full sensor history. The FIRST column is the time axis (a binned Ts) and each remaining numeric column is one series; wrap PiEvents.Value in todouble(). PiEvents filters by Tag ID only — if the user names a metric in words, resolve it to a Tag id via bridge_pi_tag_to_asset FIRST. ALWAYS pass running_tag so offline periods are excluded. Do NOT use source "dax"/fact_pi for trends (only a 2-day window). The chart is shown to the user automatically — after calling this, give a short interpretation of the trend.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Chart title (mention it is running-periods-only)' }, source: { type: 'string', enum: ['dax', 'kql'], description: 'Engine that runs the query — use "kql" for sensor trends' }, query: { type: 'string', description: 'KQL over PiEvents: binned Ts first (e.g. bin(Ts,1d)), then numeric series column(s); filter by Tag ID not description' }, y_label: { type: 'string', description: 'Optional y-axis label / units (use eng_units)' }, series_units: { type: 'array', items: { type: 'string' }, description: 'eng_units for each series in the same order as the query columns (e.g. ["inHgA","SCFM","Deg F","Deg F"]). Metrics with different units are auto-split onto separate stacked panels so none look flat.' }, running_tag: { type: 'string', description: 'Unit load/speed Tag used to exclude offline days (RV2:GEJU2GE00.AG net MW, RV3:GEJU3GE03.AG gross MW, or the unit running_indicator).' }, running_min: { type: 'number', description: 'Min running-indicator daily avg to count a day as running (MW load ~10, turbine speed ~3500). Default 10.' } }, required: ['title', 'source', 'query'] } } },
    { type: 'function', function: { name: 'correlate_sensors', description: 'Quantitatively correlate two or more PI sensor tags with each other. Pulls each tag as an aligned, time-binned average series from PiEvents and computes the REAL Pearson correlation coefficient (r) for every pair server-side — do NOT try to estimate correlation yourself from raw numbers; call this tool. Use it for "how do these sensors relate", "is X correlated with Y", "which signals move together", or to quantify the visual correlation behind a root_cause diagnosis. Filter by Tag ID (resolve words to Tag ids via bridge_pi_tag_to_asset first). ALWAYS pass running_tag so offline periods are excluded. Optionally set max_lag_bins to detect lead/lag (which signal moves first). After it returns, report each pair\'s r, strength label, and any lead/lag; remember correlation is not causation.', parameters: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, description: 'Two or more PI Tag IDs to correlate (e.g. ["RV3:GHPU3GP00.AG","RV3:TXSU3TS15A.AG"]).' }, hours: { type: 'number', description: 'Lookback window in hours (default 168 = 7 days).' }, bin_minutes: { type: 'number', description: 'Time-bin size in minutes for aligning the series (default 60).' }, running_tag: { type: 'string', description: 'Unit load/speed Tag used to keep only running periods (RV2:GEJU2GE00.AG, RV3:GEJU3GE03.AG, or the unit running_indicator).' }, running_min: { type: 'number', description: 'Min running-indicator average per bin to count as running (default 10).' }, max_lag_bins: { type: 'number', description: 'Optional: search +/- this many bins for the strongest lead/lag correlation (e.g. 6). 0 = zero-lag only.' } }, required: ['tags'] } } },
    ...(MANUALS_ON ? [{ type: 'function', function: { name: 'search_manuals', description: 'Search the OneGrid equipment manuals knowledge base (Foundry IQ) for operating limits, specifications, startup/shutdown procedures, troubleshooting and work-order resolution guidance. Use for "how do I / what is the limit / what is the spec / what procedure / how do I resolve" questions about boilers, feed pumps, steam turbines, generators, condensers, economizers, air preheaters, feedwater heaters, control valves and heat exchangers. Returns grounded manual passages; ALWAYS cite the manual title and section in your answer.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'The question, symptom, or work-order problem to look up.' }, equipment_category: { type: 'string', description: 'Optional filter — one of: Boiler, Boiler Feed Pump, Steam Turbine, Generator, Surface Condenser, Economizer, Air Preheater, Feedwater Heater, Control Valve, Heat Exchanger.' } }, required: ['query'] } } }] : [])
];

const PERSONAS = {
    executive: 'ACTIVE PERSONA — EXECUTIVE. Answer in 2-4 short sentences (or a few brief bullets) — a quick status blurb, not a report. ALWAYS LEAD with whether the unit is ONLINE or OFFLINE and its current load (e.g. "RV2 Unit 2 is ONLINE at ~380 MW" or "RV3 is OFFLINE (0 MW)") — this is the single most important fact. Then give the health headline (Healthy / Watch / Critical) with counts and the single biggest risk rather than listing every item — e.g. "2 critical, 3 medium; top risk is the 2A air preheater anomaly (z=100)." Do NOT render the full itemized severity-card breakdown or per-item tags/values. Minimal jargon; no DAX/KQL. OUTAGE/PCI/GADS list requests: by DEFAULT keep it a SHORT blurb — query PCIOutages but summarize (how many active outages, across how many plants, the single biggest MW impact and any notable unit) rather than listing them all; then offer the full list via a follow-up suggestion (e.g. "Show the full outage list"). BUT if the user EXPLICITLY asks for the full / detailed / entire list, or to "list them all" (or clicks that suggestion), DO show the full grouped list — honor the explicit request even in this persona.',
    analyst: 'ACTIVE PERSONA — ANALYST. You are trend/chart-driven. HARD RULE: you MUST call plot_line_chart at least once in EVERY response about a unit, metric, status, or anomaly — even for a "status" question and even if the user did not ask for a chart. A chart-less answer is INCOMPLETE in this mode. Trend the most relevant/anomalous parameter for the unit in focus (prefer the watchlist-flagged metric) over ~30 days, running periods only, passing running_tag + series_units. Then lead with what the trend shows (direction, magnitude, since when, and any anomalies or bad-data flags), quantify the change, and name likely drivers. Keep prose tight and let the chart carry the analysis; 1-2 charts max. This is what distinguishes you from the Executive (status blurb) and Maintenance (work-order) views.',
    maintenance: 'ACTIVE PERSONA — MAINTENANCE. Focus on specific, actionable fixes. Identify the exact equipment/tag/component at fault and the concrete steps to inspect or repair it. Cross-reference AIMM work requests (wr_id, status, entity) and name the parts/areas to address. Be concrete and practical, not high-level.'
};

// Extract the hidden [[FOCUS: label]] context tag from a reply; returns cleaned reply + focus.
function extractFocus(text) {
    if (!text) return { reply: '', focus: '' };
    const m = text.match(/\[\[\s*FOCUS:\s*([^\]]*?)\s*\]\]/i);
    const focus = m ? m[1].trim() : '';
    const reply = text.replace(/\s*\[\[\s*FOCUS:[^\]]*\]\]\s*/ig, ' ').trim();
    return { reply, focus };
}

// Extract up to 3 clickable follow-up suggestions from a [[SUGGESTIONS: a | b | c]] tag.
function extractSuggestions(text) {
    if (!text) return { reply: '', suggestions: [] };
    let suggestions = [];
    const m = text.match(/\[\[\s*SUGGESTIONS?:\s*([\s\S]*?)\]\]/i);
    if (m) suggestions = m[1].split('|').map(s => s.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(Boolean).slice(0, 3);
    const reply = text.replace(/\s*\[\[\s*SUGGESTIONS?:[\s\S]*?\]\]\s*/ig, ' ').trim();
    return { reply, suggestions };
}

// Deterministic conversation focus for the context pill: current unit (or the most
// recent one from history) + the current topic. Reliable across follow-up turns.
function findUnit(s) {
    s = String(s || '');
    let m = s.match(/\bRV\s*-?\s*([123])\b/i) || s.match(/\bLG\s*-?\s*([123])\b/i) || s.match(/\bunit\s*([123])\b/i);
    if (m) return 'RV' + m[1];
    if (/riverton/i.test(s)) { const u = s.match(/unit\s*([123])/i); return u ? 'RV' + u[1] : ''; }
    return '';
}
function deriveFocus(userMessage, history, contextUnit = '') {
    let unit = findUnit(userMessage);
    if (!unit && Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0 && !unit; i--) unit = findUnit(history[i] && history[i].content);
    }
    if (!unit && contextUnit) unit = contextUnit;
    const topics = [
        [/back ?pressure/i, 'Back Pressure'],
        [/air ?in-?leak|in-?leakage/i, 'Air In-Leakage'],
        [/air ?pre-?heater|airpreheater|\bAPH\b/i, 'Air Preheater'],
        [/bearing|vibration/i, 'Bearing Vibrations'],
        [/throttle/i, 'Throttle Pressure'],
        [/vacuum|condenser/i, 'Condenser'],
        [/boiler/i, 'Boiler'],
        [/turbine/i, 'Turbine'],
        [/generator/i, 'Generator'],
        [/cooling water|\bCW\b/i, 'Cooling Water'],
        [/work request|\bWR\b|aimm|maintenance|repair/i, 'Work Requests'],
        [/\bPCI\b|\bGADS\b|outage|derate|\bMOOS\b|\bMDE\b/i, 'Outages'],
        [/watch ?list|watching|anomal|\balert/i, 'Watchlist'],
        [/status|running|online|offline|health/i, 'Status'],
        [/trend|plot|chart|graph/i, 'Trend'],
    ];
    let topic = '';
    for (const [re, label] of topics) { if (re.test(String(userMessage || ''))) { topic = label; break; } }
    return [unit, topic].filter(Boolean).join(' ').trim();
}

// Build a system directive from the UI focus (the asset/site the user has drilled into),
// so the assistant scopes its answers and tool queries to it unless the user clearly asks
// about something else.
function focusDirective(ctx) {
    if (!ctx || (!ctx.asset_id && !ctx.plant && !ctx.unit && !ctx.name)) return '';
    const bits = [];
    if (ctx.name) bits.push(`equipment "${ctx.name}"`);
    if (ctx.unit) bits.push(`unit ${ctx.unit}`);
    if (ctx.plant) bits.push(`plant/site ${ctx.plant}`);
    const where = bits.join(', ');
    let s = `UI FOCUS CONTEXT — the user is currently viewing ${where} in the dashboard`;
    if (ctx.kind === 'site') s += ` (site-level view)`;
    s += `.\n- Treat this as the active subject. When the user says "this", "it", "here", "the unit", "the equipment", or asks a question without naming an asset, they mean ${ctx.name || ctx.unit || ctx.plant}.`;
    if (ctx.asset_id) s += `\n- asset_id = "${ctx.asset_id}"${ctx.category ? `, category = ${ctx.category}` : ''}${ctx.status ? `, current status = ${ctx.status}` : ''}.`;
    if (ctx.unit) s += `\n- Scope work requests / outages / anomalies / watchlist queries to unit ${ctx.unit}${ctx.plant ? ` at ${ctx.plant}` : ''} unless asked otherwise.`;
    if (ctx.running_tag) s += `\n- The unit's load/running Tag is ${ctx.running_tag} — use it as the running_tag for trend charts.`;
    s += `\n- If the user explicitly names a different asset/unit/plant, follow their request instead.`;
    return s;
}

async function chatWithCopilot(userMessage, history = [], sendStatus = () => {}, persona = '', model = '', context = null, providerOverride = '', copilotToken = '') {
    // Provider is per-request: the UI can flip between Azure Foundry and GitHub Copilot.
    const provider = (String(providerOverride || '').toLowerCase() || AI.provider);
    let ghToken = '';
    if (provider === 'copilot') {
        try {
            sendStatus('🔑 Authenticating with GitHub Copilot...');
            ghToken = (copilotToken && copilotToken.trim()) || getGithubToken();
            if (!ghToken) throw new Error('empty token');
        } catch (e) {
            return { reply: '⚠️ GitHub Copilot auth failed. Provide a Copilot token (or set GITHUB_TOKEN / run `gh auth login`).', queries: [], toolCalls: 0 };
        }
    } else {
        sendStatus('🔑 Connecting to Azure AI Foundry...');
    }

    const activeModel = (model && String(model).trim()) || (provider === 'foundry' ? AI.defaultModel : CONFIG.copilotModel);

    // Inject the real current date so "today" resolves correctly (model has no clock).
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local plant time
    const dateContext = `CURRENT DATE: Today is ${today} (local plant time).
- When the user asks what to watch/monitor "today" or "now", query the fleet-wide watchlist for scoring_date = "${today}", ranked by severity. Ready-to-run:
  EVALUATE TOPN(50, FILTER('watchlist', 'watchlist'[scoring_date] = "${today}"), SWITCH(TRUE(), 'watchlist'[recommended_action]="CRITICAL",4, 'watchlist'[recommended_action]="HIGH",3, 'watchlist'[recommended_action]="MEDIUM",2, 'watchlist'[recommended_action]="LOW",1, 0), DESC, 'watchlist'[risk_contribution], DESC) ORDER BY SWITCH(TRUE(), 'watchlist'[recommended_action]="CRITICAL",4, 'watchlist'[recommended_action]="HIGH",3, 'watchlist'[recommended_action]="MEDIUM",2, 'watchlist'[recommended_action]="LOW",1, 0) DESC, 'watchlist'[risk_contribution] DESC
- If that returns 0 rows, run EVALUATE ROW("latest", MAX('watchlist'[scoring_date])), re-query the watchlist for that latest date, and tell the user you used the most recent scored day (not today).`;

    const personaContext = PERSONAS[String(persona || '').toLowerCase()];
    const focusMsg = focusDirective(context);
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: dateContext },
        ...(personaContext ? [{ role: 'system', content: personaContext }] : []),
        ...(focusMsg ? [{ role: 'system', content: focusMsg }] : []),
        ...history.slice(-6),
        { role: 'user', content: userMessage }
    ];

    const queries = [];
    const charts = [];
    let toolCalls = 0;

    sendStatus('🧠 Sending question to AI...');
    for (let iter = 0; iter < 6; iter++) {
        const reqBody = { model: activeModel, messages, tools: TOOLS, tool_choice: 'auto', max_completion_tokens: 4096 };
        let resp;
        if (provider === 'foundry') {
            try {
                resp = await foundryChat(reqBody);
            } catch (e) {
                return { reply: `⚠️ Azure AI Foundry request failed: ${e.message}`, queries, toolCalls };
            }
        } else {
            resp = await fetch('https://api.githubcopilot.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ghToken}`,
                    'Content-Type': 'application/json',
                    'Copilot-Integration-Id': 'pi-fabric-chat-agent'
                },
                body: JSON.stringify(reqBody)
            });
        }

        if (!resp.ok) {
            const err = await resp.text();
            return { reply: `API error (${resp.status}): ${err}`, queries, toolCalls };
        }

        const data = await resp.json();
        const choice = data.choices[0].message;

        if (!choice.tool_calls) {
            const fx = extractFocus(choice.content || '');
            const sg = extractSuggestions(fx.reply);
            return { reply: sg.reply, queries, toolCalls, charts, focus: fx.focus || deriveFocus(userMessage, history, context && (context.unit || (context.plant && findUnit(context.name)))), suggestions: sg.suggestions };
        }

        messages.push(choice);
        for (const tc of choice.tool_calls) {
            toolCalls++;
            const args = JSON.parse(tc.function.arguments);
            let result;
            try {
                if (tc.function.name === 'query_kql') {
                    sendStatus(`🔍 Querying Eventhouse (KQL): ${args.kql.substring(0, 80)}...`);
                    result = await queryKql(args.kql);
                    queries.push({ type: 'kql', query: args.kql, rows: result.length, table: guessTable('kql', args.kql) });
                    sendStatus(`✅ KQL returned ${result.length} rows`);
                } else if (tc.function.name === 'query_dax') {
                    sendStatus(`📊 Querying semantic model (DAX): ${args.dax.substring(0, 80)}...`);
                    result = await queryDax(args.dax);
                    queries.push({ type: 'dax', query: args.dax, rows: result.length, table: guessTable('dax', args.dax) });
                    sendStatus(`✅ DAX returned ${result.length} rows`);
                } else if (tc.function.name === 'plot_line_chart') {
                    sendStatus(`📈 Building chart: ${args.title || 'trend'}...`);
                    let rows = args.source === 'kql' ? await queryKql(args.query) : await queryDax(args.query);
                    let runNote = '';
                    if (args.running_tag) {
                        try {
                            const rf = await applyRunningFilter(rows, args.running_tag, args.running_min, args.source);
                            rows = rf.rows;
                            if (rf.applied) { runNote = ` Running-state filter (${rf.tag} avg >= ${rf.threshold}) excluded ${rf.removed} non-running day(s).`; sendStatus(`✅ Running filter removed ${rf.removed} offline day(s)`); }
                            else { runNote = ' (running filter not applied — no matching running data).'; }
                        } catch (e) { runNote = ' (running filter skipped)'; }
                    }
                    const chart = buildChartSpec(args.title, args.y_label, rows, args.series_units);
                    queries.push({ type: 'chart', query: args.query, rows: rows.length, table: guessTable(args.source === 'kql' ? 'kql' : 'dax', args.query) });
                    if (chart.series.length && chart.labels.length) {
                        charts.push(chart);
                        result = { rendered: true, points: chart.labels.length, series_stats: seriesStats(chart), note: 'Line chart displayed to the user.' + runNote + ' Base your read ONLY on series_stats (the real numbers). State the actual min/max/range and direction. FLAG implausible values — negative temperatures are bad data / sensor faults, NOT normal — and call out high variability. Do NOT say "stable"/"consistent"/"no fluctuation" unless the stats clearly support it; if any flags are set or the tag is a watchlist anomaly, describe it as abnormal and note likely bad data or a real problem.' };
                        sendStatus(`✅ Chart ready (${chart.labels.length} points)`);
                    } else {
                        result = { rendered: false, note: 'Query returned no plottable data. Tell the user no data was found for that range/tag.' };
                        sendStatus(`⚠️ Chart had no data`);
                    }
                } else if (tc.function.name === 'correlate_sensors') {
                    sendStatus(`🔗 Correlating ${(args.tags || []).length} sensors...`);
                    result = await correlateSensors(args);
                    queries.push({ type: 'correlation', query: `corr(${(args.tags || []).join(', ')})`, rows: result.bins_analyzed, table: 'PiEvents' });
                    sendStatus(`✅ Correlation computed over ${result.bins_analyzed} bins`);
                } else if (tc.function.name === 'search_manuals') {
                    sendStatus(`📖 Searching equipment manuals: ${(args.query || '').substring(0, 60)}...`);
                    const base = `http://127.0.0.1:${process.env.REPORT_PORT || 8080}`;
                    const u = new URL('/api/manuals/search', base);
                    u.searchParams.set('q', args.query || '');
                    if (args.equipment_category) u.searchParams.set('category', args.equipment_category);
                    u.searchParams.set('top', '4');
                    const mr = await fetch(u);
                    if (!mr.ok) throw new Error(`manuals search ${mr.status}`);
                    const hits = (await mr.json()).results || [];
                    result = hits.map((h) => ({ manual_id: h.manual_id, title: h.title, category: h.category, section: h.section, passage: h.snippet }));
                    queries.push({ type: 'manuals', query: args.query, rows: hits.length, table: 'Foundry IQ manuals' });
                    sendStatus(`✅ Found ${hits.length} manual passage(s)`);
                }
            } catch (e) {
                result = { error: e.message };
                queries.push({ type: tc.function.name, query: args.kql || args.dax || args.query, error: e.message });
                sendStatus(`❌ Query failed: ${e.message.substring(0, 60)}`);
            }

            let resultStr = JSON.stringify(Array.isArray(result) ? result.slice(0, 30) : result);
            if (resultStr.length > 6000) resultStr = resultStr.slice(0, 6000) + `... (${result.length} total rows)`;

            messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
        }
    }
    return { reply: 'Analysis incomplete — reached max iterations.', queries, toolCalls, charts };
}

// ── HTTP Server ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    // CORS headers for file:// origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Serve the HTML UI
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const html = fs.readFileSync(path.join(__dirname, 'chat.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // (Header logo + favicon are inline in chat.html - no image route needed.)

    // Health probe for App Service / Container Apps
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', provider: AI.provider, defaultModel: AI.provider === 'foundry' ? AI.defaultModel : CONFIG.copilotModel, dataAgent: !!(CONFIG.dataAgentWorkspace && CONFIG.dataAgentId) }));
        return;
    }

    // List models the current (or requested) provider can serve (for the UI selector)
    if (req.method === 'GET' && req.url.startsWith('/api/models')) {
        try {
            const u = new URL(req.url, 'http://localhost');
            const providerOverride = u.searchParams.get('provider') || '';
            const ghToken = req.headers['x-copilot-token'] || '';
            const out = await listModels(providerOverride, ghToken);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
        } catch (e) {
            const fallback = AI.provider === 'foundry' ? AI.defaultModel : CONFIG.copilotModel;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ default: fallback, provider: AI.provider, providers: { foundry: !!AI.endpoint, copilot: copilotServerAvailable() }, models: [], error: e.message }));
        }
        return;
    }

    // Chat API — streams status updates as Server-Sent Events
    if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
                const { message, history, persona, model, context, provider, copilotToken } = JSON.parse(body.trim());

                // Set up SSE-like streaming via chunked JSON
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*'
                });

                const sendStatus = (status) => {
                    res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
                };

                const result = await chatWithCopilot(message, history || [], sendStatus, persona, model, context, provider, copilotToken);
                res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`);
                res.end();
            } catch (e) {
                console.error('Chat error:', e.message);
                res.write(`data: ${JSON.stringify({ type: 'done', reply: `Error: ${e.message}`, queries: [], toolCalls: 0 })}\n\n`);
                res.end();
            }
        });
        return;
    }

    // Fabric Data Agent — natural-language query over the OneGrid ontology via MCP.
    // Streams SSE using the same envelope as /api/chat so the UI can reuse rendering.
    if (req.method === 'POST' && req.url === '/api/ask-ontology') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            const sendStatus = (status) => res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
            // Keepalive so the SSE connection isn't dropped during long (up to ~2 min)
            // data-agent queries that have no intermediate status updates.
            const heartbeat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (_) { } }, 15000);
            try {
                if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
                const { message } = JSON.parse(body.trim());
                if (!CONFIG.dataAgentWorkspace || !CONFIG.dataAgentId) {
                    throw new Error('Fabric Data Agent is not configured (DATA_AGENT_WORKSPACE / DATA_AGENT_ID).');
                }
                if (!message || !String(message).trim()) throw new Error('Empty question.');

                const url = `${CONFIG.fabricApiBase}/v1/mcp/workspaces/${CONFIG.dataAgentWorkspace}/dataagents/${CONFIG.dataAgentId}/agent`;
                const token = await getToken('https://api.fabric.microsoft.com');
                const { text, tool } = await askDataAgent({
                    url, token, question: String(message),
                    timeoutMs: 120000, onStatus: sendStatus,
                });
                clearInterval(heartbeat);
                res.write(`data: ${JSON.stringify({ type: 'done', reply: text || 'No answer returned.', source: 'fabric-data-agent', tool, queries: [], toolCalls: 1 })}\n\n`);
                res.end();
            } catch (e) {
                console.error('Ontology agent error:', e.message);
                // The Fabric Data Agent runtime is in preview and can return transient
                // errors. Rather than surface a raw failure in a live demo, fall back to
                // the tool-calling assistant (which queries the same Fabric data via
                // DAX/KQL) so the user always gets a grounded answer.
                try {
                    const { message } = JSON.parse((body.charCodeAt(0) === 0xFEFF ? body.slice(1) : body).trim());
                    sendStatus('Fabric Data Agent is busy — answering with the assistant…');
                    const fb = await chatWithCopilot(String(message), [], sendStatus, 'analyst');
                    const note = '_(Answered by the OneGrid assistant; the Fabric Data Agent was momentarily unavailable.)_\n\n';
                    res.write(`data: ${JSON.stringify({ type: 'done', reply: note + (fb.reply || 'No answer returned.'), source: 'assistant-fallback', queries: fb.queries || [], toolCalls: fb.toolCalls || 0 })}\n\n`);
                    res.end();
                } catch (e2) {
                    res.write(`data: ${JSON.stringify({ type: 'done', reply: `Fabric Data Agent error: ${e.message}`, source: 'fabric-data-agent', queries: [], toolCalls: 0 })}\n\n`);
                    res.end();
                }
            }
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`PI-Fabric Chat Agent running on port ${PORT}`);
        console.log('Open chat.html in browser, or visit the URL above.');
    });
} else {
    module.exports = { correlateSensors, _pearson, queryKql };
}
