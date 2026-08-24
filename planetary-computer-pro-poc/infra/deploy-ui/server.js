// ============================================================================
//  OneGrid Solution - Local Deployment Wizard (localhost)
//  Node HTTP server (no external deps). Discovers Azure/Fabric options, writes
//  config.json, runs deploy.ps1, and streams live progress to the browser (SSE).
//  Start with: node deploy-ui/server.js   (or launch-deploy-ui.ps1)
// ============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = process.env.DEPLOY_UI_PORT || 7333;
const ROOT = path.resolve(__dirname, '..');          // solution root
const CONFIG_PATH = path.join(ROOT, 'config.json');

let deployChild = null;          // active deploy process
const sseClients = new Set();    // connected log listeners
const logBuffer = [];            // replay for late joiners
let lastDemo = null;             // { notebookId, jobUrl, startedAt } for status polling

function broadcast(line) {
  logBuffer.push(line);
  if (logBuffer.length > 5000) logBuffer.shift();
  const payload = `data: ${JSON.stringify({ line })}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch (e) {} }
}

// Run an az/pwsh command and return stdout as a string (Promise).
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 32, shell: true, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}
const az = (query) => run('az', query.split(' '));

// Read a JSON file written by PowerShell (which may be UTF-16 or UTF-8-with-BOM).
function readJsonLoose(file) {
  const buf = fs.readFileSync(file);
  let text;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) text = buf.toString('utf16le');
  else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) text = buf.slice(3).toString('utf8');
  else text = buf.toString('utf8');
  return JSON.parse(text);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ---- static UI ----
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  // ---- saved config.json (for prefilling the wizard) ----
  if (req.method === 'GET' && p === '/api/config') {
    try { return send(res, 200, readJsonLoose(CONFIG_PATH)); }
    catch (e) { return send(res, 200, {}); }
  }

  // ---- who am I / subscriptions ----
  if (req.method === 'GET' && p === '/api/account') {
    const acct = await az('account show -o json');
    if (!acct.ok) return send(res, 200, { loggedIn: false });
    const subs = await az('account list --query "[].{id:id,name:name,tenantId:tenantId,isDefault:isDefault}" -o json');
    const me = JSON.parse(acct.stdout || '{}');
    return send(res, 200, {
      loggedIn: true,
      user: me.user && me.user.name,
      subscriptions: subs.ok ? JSON.parse(subs.stdout || '[]') : []
    });
  }

  // ---- trigger az login (device/interactive) ----
  if (req.method === 'POST' && p === '/api/login') {
    broadcast('Launching az login in a new window...');
    run('az', ['login']);   // opens browser; user completes, then re-checks account
    return send(res, 200, { started: true });
  }

  // ---- Fabric capacities (for the chosen subscription) ----
  if (req.method === 'GET' && p === '/api/capacities') {
    const sub = url.searchParams.get('sub');
    if (sub) await az(`account set --subscription ${sub}`);
    const tok = await az('account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv');
    if (!tok.ok) return send(res, 200, { capacities: [], error: 'token' });
    try {
      const data = await new Promise((resolve, reject) => {
        const opts = { headers: { Authorization: `Bearer ${tok.stdout}` } };
        https_get('https://api.fabric.microsoft.com/v1/capacities', opts, resolve, reject);
      });
      const caps = (data.value || []).map(c => ({ id: c.id, name: c.displayName, sku: c.sku, state: c.state, region: c.region }));
      return send(res, 200, { capacities: caps });
    } catch (e) { return send(res, 200, { capacities: [], error: String(e).slice(0, 200) }); }
  }

  // ---- prerequisite checks (run before deploy) ----
  if (req.method === 'GET' && p === '/api/prereqs') {
    const sub = url.searchParams.get('sub');
    const skipData = url.searchParams.get('skipData') === '1';
    const capSku = (url.searchParams.get('capSku') || '').trim();
    if (sub) await az(`account set --subscription ${sub}`);
    const checks = [];
    const add = (name, status, detail) => checks.push({ name, status, detail }); // status: ok|warn|fail

    // az CLI
    const azv = await run('az', ['version', '-o', 'json']);
    if (azv.ok) { try { add('Azure CLI', 'ok', 'v' + JSON.parse(azv.stdout)['azure-cli']); } catch { add('Azure CLI', 'ok', 'installed'); } }
    else add('Azure CLI', 'fail', 'az not found - install the Azure CLI');

    // logged in
    const acct = await az('account show -o json');
    add('Azure sign-in', acct.ok ? 'ok' : 'fail', acct.ok ? (JSON.parse(acct.stdout).user || {}).name || 'signed in' : 'run az login');

    // PowerShell
    const ps = await run('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
    add('PowerShell', ps.ok ? 'ok' : 'fail', ps.ok ? 'v' + ps.stdout : 'powershell not found');

    // containerapp extension (deploy auto-installs, so warn not fail)
    const ext = await az('extension list --query "[?name==\'containerapp\'].version" -o tsv');
    add('containerapp extension', (ext.ok && ext.stdout) ? 'ok' : 'warn', (ext.ok && ext.stdout) ? 'v' + ext.stdout : 'not installed (deploy will auto-install)');

    // Fabric API reachable for this tenant
    const ftok = await az('account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv');
    if (ftok.ok && ftok.stdout) {
      try {
        await new Promise((resolve, reject) => https_get('https://api.fabric.microsoft.com/v1/capacities', { headers: { Authorization: `Bearer ${ftok.stdout}` } }, resolve, reject));
        add('Fabric API access', 'ok', 'reachable');
      } catch (e) { add('Fabric API access', 'fail', 'cannot reach Fabric API (is Fabric enabled for the tenant?)'); }
    } else add('Fabric API access', 'fail', 'could not acquire a Fabric token');

    // Fabric capacity size: must be at least F8 (Trial ~64 CU also qualifies).
    (() => {
      if (!capSku) { add('Fabric capacity \u2265 F8', 'warn', 'no capacity selected yet - pick one above and re-run'); return; }
      if (/^ft/i.test(capSku) || /trial/i.test(capSku)) { add('Fabric capacity \u2265 F8', 'ok', `${capSku} (Trial, ~64 CU) meets the F8 minimum`); return; }
      const m = capSku.match(/^f(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 8) add('Fabric capacity \u2265 F8', 'ok', `${capSku} meets the F8 minimum`);
        else add('Fabric capacity \u2265 F8', 'fail', `${capSku} is below the required minimum - select an F8 or larger capacity`);
      } else {
        add('Fabric capacity \u2265 F8', 'warn', `unrecognized SKU '${capSku}' - ensure it is F8 or larger`);
      }
    })();

    // Cognitive Services / App registration providers
    const cs = await az('provider show -n Microsoft.CognitiveServices --query registrationState -o tsv');
    add('Microsoft.CognitiveServices provider', (cs.ok && /Registered/i.test(cs.stdout)) ? 'ok' : 'warn', cs.stdout || 'will be registered on demand');

    // deploy.ps1 present
    add('deploy.ps1', fs.existsSync(path.join(ROOT, 'deploy.ps1')) ? 'ok' : 'fail', fs.existsSync(path.join(ROOT, 'deploy.ps1')) ? 'found' : 'missing');

    // data bundle: local (full clone) uploads directly; absent = cloud-seeded at deploy time
    if (skipData) {
      add('Historical data bundle', 'warn', 'skipped (Skip data load is checked)');
    } else {
      const dataDir = path.join(ROOT, 'data');
      const sample = fs.existsSync(dataDir) ? findFirstParquet(dataDir) : null;
      if (!sample) {
        // Lightweight wizard: no local parquet -> the deploy seeds it cloud-to-cloud into OneLake.
        add('Historical data bundle', 'ok', 'not bundled locally - seeded cloud-to-cloud from the public repo at deploy time');
      } else {
        const sz = fs.statSync(sample).size;
        if (sz < 1024) {
          // LFS pointer files are ~130 bytes and start with "version https://git-lfs"
          const head = fs.readFileSync(sample, 'utf8').slice(0, 40);
          if (head.startsWith('version https://git-lfs')) { add('Historical data bundle', 'fail', 'data is Git LFS pointers - run: git lfs pull (or delete data/ to cloud-seed instead)'); }
          else { add('Historical data bundle', 'warn', 'data files unexpectedly small'); }
        } else {
          add('Historical data bundle', 'ok', `local bundle materialized (${(dirSizeMB(dataDir)).toFixed(0)} MB) - uploaded directly`);
        }
      }
    }

    const worst = checks.some(c => c.status === 'fail') ? 'fail' : (checks.some(c => c.status === 'warn') ? 'warn' : 'ok');
    return send(res, 200, { checks, worst });
  }

  // ---- Azure regions ----
  if (req.method === 'GET' && p === '/api/regions') {
    const r = await az('account list-locations --query "[?metadata.regionType==\'Physical\'].name" -o json');
    return send(res, 200, { regions: r.ok ? JSON.parse(r.stdout || '[]') : ['eastus2','eastus','westus3','westeurope'] });
  }

  // ---- start deployment ----
  if (req.method === 'POST' && p === '/api/deploy') {
    if (deployChild) return send(res, 409, { error: 'A deployment is already running.' });
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let cfg;
      try { cfg = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad config' }); }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      logBuffer.length = 0;
      broadcast('=== Starting deployment (this can take 20-40 min) ===');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'deploy.ps1'), '-ConfigPath', CONFIG_PATH];
      if (cfg._skipData) args.push('-SkipData');
      deployChild = spawn('powershell', args, { cwd: ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
      const onData = (buf) => String(buf).split(/\r?\n/).forEach(l => { if (l.trim()) broadcast(l); });
      deployChild.stdout.on('data', onData);
      deployChild.stderr.on('data', onData);
      deployChild.on('close', (code) => {
        broadcast(`=== Deployment process exited (code ${code}) ===`);
        broadcast('__DONE__');
        deployChild = null;
      });
      send(res, 200, { started: true });
    });
    return;
  }

  // ---- cancel a running deploy/teardown (kills the process tree) ----
  if (req.method === 'POST' && p === '/api/cancel') {
    if (!deployChild) return send(res, 200, { cancelled: false, message: 'nothing is running' });
    const pid = deployChild.pid;
    broadcast('=== Cancel requested - stopping the running process... ===');
    try {
      if (process.platform === 'win32') {
        // Kill the whole tree (powershell -> az/azd children) by PID.
        execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, (err, so, se) => {
          if (err && se) broadcast('cancel: ' + String(se).trim());
        });
      } else {
        try { process.kill(-pid, 'SIGTERM'); } catch { deployChild.kill('SIGTERM'); }
      }
    } catch (e) { broadcast('cancel error: ' + String(e)); }
    return send(res, 200, { cancelled: true });
  }

  // ---- opt-in: wire the data-plane bolt-on (build + run PI/SQL/Oracle forwarders locally) ----
  if (req.method === 'POST' && p === '/api/dataplane') {
    if (deployChild) return send(res, 409, { error: 'A process is already running.' });
    if (!fs.existsSync(CONFIG_PATH)) return send(res, 400, { error: 'no config.json found - deploy first' });
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      // Merge the opt-in Data Plane selections into config.json (if the panel sent any).
      if (body && body.trim()) {
        try {
          const dp = JSON.parse(body);
          const cfg = readJsonLoose(CONFIG_PATH);
          cfg.dataPlane = dp;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
        } catch (e) { return send(res, 400, { error: 'bad data-plane config: ' + String(e).slice(0, 200) }); }
      }
      logBuffer.length = 0;
      broadcast('=== Data Plane: building + running the selected forwarders locally ===');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'deploy.ps1'), '-ConfigPath', CONFIG_PATH, '-Only', 'dataplane'];
      deployChild = spawn('powershell', args, { cwd: ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
      const onData = (buf) => String(buf).split(/\r?\n/).forEach(l => { if (l.trim()) broadcast(l); });
      deployChild.stdout.on('data', onData);
      deployChild.stderr.on('data', onData);
      deployChild.on('close', (code) => {
        broadcast(`=== Data-plane step exited (code ${code}) ===`);
        broadcast('__DONE__');
        deployChild = null;
      });
      send(res, 200, { started: true });
    });
    return;
  }

  // ---- list candidate deployments (Fabric workspaces + resource groups) for teardown ----
  if (req.method === 'GET' && p === '/api/deployments') {
    const wsRes = await run('az', ['rest', '--method', 'get', '--url', 'https://api.fabric.microsoft.com/v1/workspaces', '--resource', 'https://api.fabric.microsoft.com']);
    let workspaces = [];
    if (wsRes.ok) { try { workspaces = (JSON.parse(wsRes.stdout).value || []).map(w => ({ id: w.id, name: w.displayName })); } catch {} }
    let defaultWs = ''; try { defaultWs = (readJsonLoose(CONFIG_PATH).fabric || {}).workspaceName || ''; } catch {}
    return send(res, 200, { workspaces, defaultWorkspaceName: defaultWs });
  }

  // ---- resource groups scoped to a SELECTED workspace (safe teardown targeting) ----
  // Definitive matches come from the 'onegrid-workspace=<id>' tag the deploy stamps on every
  // resource group it creates. Anything found only by name is returned UNSELECTED and flagged,
  // so a broad name match can never silently delete an unrelated group. Shared/protected groups
  // (telemetry, Log Analytics, network watcher, cloud shell) are always excluded.
  if (req.method === 'GET' && p === '/api/teardown-plan') {
    const wsId = (url.searchParams.get('workspaceId') || '').trim();
    const wsName = (url.searchParams.get('name') || '').trim();
    const PROTECT = /(^|[-_])telemetry([-_]|$)|[-_]law$|log-?analytics|networkwatcher|^cloud-shell|^defaultresourcegroup|dashboards$/i;
    let tagged = [];
    if (wsId) {
      const r = await az(`group list --tag onegrid-workspace=${wsId} --query "[].name" -o json`);
      if (r.ok) { try { tagged = JSON.parse(r.stdout) || []; } catch {} }
    }
    tagged = tagged.filter(n => !PROTECT.test(n));
    let all = [];
    const ar = await az('group list --query "[].name" -o json');
    if (ar.ok) { try { all = JSON.parse(ar.stdout) || []; } catch {} }
    const stop = new Set(['onegrid','oge','fabric','demo','test','e2e','prod','dev','poc','solution','app','grid','main','deploy','azure','rgpoc']);
    const tokens = (wsName.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length >= 5 && !stop.has(t));
    const named = all.filter(n => !PROTECT.test(n) && !tagged.includes(n) && tokens.some(t => n.toLowerCase().includes(t)));
    const rgs = [
      ...tagged.map(n => ({ name: n, match: 'tag', selected: true })),
      ...named.map(n => ({ name: n, match: 'name', selected: false }))
    ];
    return send(res, 200, { rgs, hasTagged: tagged.length > 0, tokens });
  }

  // ---- tear down a SELECTED deployment (Fabric workspace + chosen resource groups) ----
  if (req.method === 'POST' && p === '/api/teardown') {
    if (deployChild) return send(res, 409, { error: 'A process is already running - cancel it first.' });
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let sel = {}; try { sel = body ? JSON.parse(body) : {}; } catch {}
      const haveConfig = fs.existsSync(CONFIG_PATH);
      // The picker supplies the workspace + resource groups explicitly, so a saved
      // config.json is only needed when nothing was selected.
      if (!haveConfig && !sel.workspaceId) return send(res, 400, { error: 'Nothing to tear down: no saved config.json and no deployment selected.' });
      logBuffer.length = 0;
      broadcast('=== Starting teardown (removing the selected Fabric workspace + resource groups) ===');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'deploy.ps1'), '-Teardown'];
      if (haveConfig) args.push('-ConfigPath', CONFIG_PATH);
      if (sel.workspaceId) args.push('-TeardownWorkspaceId', sel.workspaceId);
      if (Array.isArray(sel.resourceGroups) && sel.resourceGroups.length) args.push('-TeardownResourceGroups', sel.resourceGroups.join(','));
      deployChild = spawn('powershell', args, { cwd: ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
      const onData = (buf) => String(buf).split(/\r?\n/).forEach(l => { if (l.trim()) broadcast(l); });
      deployChild.stdout.on('data', onData);
      deployChild.stderr.on('data', onData);
      deployChild.on('close', (code) => {
        broadcast(`=== Teardown process exited (code ${code}) ===`);
        broadcast('__DONE__');
        deployChild = null;
      });
      send(res, 200, { started: true });
    });
    return;
  }

  // ---- launch targets (URLs/paths for the post-deploy launch buttons) ----
  if (req.method === 'GET' && p === '/api/launch-targets') {
    let state = {};
    try { state = readJsonLoose(path.join(ROOT, 'last-deploy-state.json')); } catch {}
    const ws = state.WorkspaceId;
    const targets = {
      chatAgent: state.AppUrl && state.AppUrl !== 'https://' ? state.AppUrl : null,
      workspace: ws ? `https://app.fabric.microsoft.com/groups/${ws}` : null,
      webReport: null,
      realtimeReport: null
    };
    if (ws) {
      const itemsRes = await run('az', ['rest', '--method', 'get', '--url', `https://api.fabric.microsoft.com/v1/workspaces/${ws}/items`, '--resource', 'https://api.fabric.microsoft.com']);
      if (itemsRes.ok) {
        try {
          const items = JSON.parse(itemsRes.stdout).value || [];
          const report = items.find(i => i.type === 'Report' && /Main Overview/i.test(i.displayName));
          const dash = items.find(i => i.type === 'KQLDashboard' && /realtime|pi-realtime|real.?time/i.test(i.displayName)) || items.find(i => i.type === 'KQLDashboard');
          if (report) targets.webReport = `https://app.fabric.microsoft.com/groups/${ws}/reports/${report.id}`;
          if (dash) targets.realtimeReport = `https://app.fabric.microsoft.com/groups/${ws}/kqldashboards/${dash.id}`;
        } catch {}
      }
    }
    // If the chat agent URL isn't in state (e.g. phases were re-run), resolve it live from Azure.
    if (!targets.chatAgent) {
      try {
        const c = readJsonLoose(CONFIG_PATH);
        const app = c.chatAgent && c.chatAgent.appName, rg = c.chatAgent && c.chatAgent.resourceGroup;
        if (app && rg) {
          const fq = await az(`containerapp show -n ${app} -g ${rg} --query properties.configuration.ingress.fqdn -o tsv`);
          if (fq.ok && fq.stdout) targets.chatAgent = `https://${fq.stdout}`;
        }
      } catch {}
    }
    return send(res, 200, targets);
  }

  // ---- launch the demo: trigger the Demo-Prep-RunOnce notebook (backfill + live stream, all sites) ----
  if (req.method === 'POST' && p === '/api/launch-demo') {
    let state = {};
    try { state = readJsonLoose(path.join(ROOT, 'last-deploy-state.json')); } catch {}
    const ws = state.WorkspaceId;
    if (!ws) return send(res, 400, { error: 'No deployed workspace found (last-deploy-state.json missing). Deploy first.' });
    const tokRes = await run('az', ['account', 'get-access-token', '--resource', 'https://api.fabric.microsoft.com', '--query', 'accessToken', '-o', 'tsv']);
    if (!tokRes.ok || !tokRes.stdout) return send(res, 401, { error: 'Could not acquire a Fabric token - run az login.' });
    const H = { Authorization: 'Bearer ' + tokRes.stdout.trim(), 'Content-Type': 'application/json' };
    try {
      const list = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${ws}/items?type=Notebook`, { headers: H }).then(r => r.json());
      const nb = (list.value || []).find(i => i.displayName === 'Demo-Prep-RunOnce');
      if (!nb) return send(res, 404, { error: 'Demo-Prep-RunOnce notebook not found in the deployed workspace.' });
      const job = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${ws}/items/${nb.id}/jobs/instances?jobType=RunNotebook`, { method: 'POST', headers: H, body: '{}' });
      if ([200, 201, 202].includes(job.status)) {
        const jobUrl = job.headers.get('location') || null;
        lastDemo = { notebookId: nb.id, jobUrl, startedAt: Date.now() };
        return send(res, 200, { started: true, notebookId: nb.id, jobUrl, message: 'Demo-Prep-RunOnce started' });
      }
      const txt = await job.text();
      return send(res, 502, { error: `Failed to start the notebook (HTTP ${job.status}): ${String(txt).slice(0, 200)}` });
    } catch (e) {
      return send(res, 500, { error: String((e && e.message) || e) });
    }
  }

  // ---- poll the demo run status (stage-level via the notebook's OneLake status file,
  //      with a coarse job-instance fallback for workspaces deployed before this feature) ----
  if (req.method === 'GET' && p === '/api/demo-status') {
    let state = {};
    try { state = readJsonLoose(path.join(ROOT, 'last-deploy-state.json')); } catch {}
    const ws = state.WorkspaceId, lh = state.LakehouseId;

    // 1) Preferred: the notebook writes Files/demo-status.json to lh_poc (stage-level).
    if (ws && lh) {
      const tok = await run('az', ['account', 'get-access-token', '--resource', 'https://storage.azure.com', '--query', 'accessToken', '-o', 'tsv']);
      if (tok.ok && tok.stdout) {
        try {
          const url = `https://onelake.dfs.fabric.microsoft.com/${ws}/${lh}/Files/demo-status.json`;
          const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok.stdout.trim() } });
          if (r.ok) {
            const s = await r.json();
            return send(res, 200, { source: 'notebook', ...s });
          }
        } catch {}
      }
    }

    // 2) Fallback: coarse job-instance status (Running / Completed / Failed).
    if (lastDemo && lastDemo.jobUrl) {
      const tokRes = await run('az', ['account', 'get-access-token', '--resource', 'https://api.fabric.microsoft.com', '--query', 'accessToken', '-o', 'tsv']);
      if (tokRes.ok && tokRes.stdout) {
        try {
          const r = await fetch(lastDemo.jobUrl, { headers: { Authorization: 'Bearer ' + tokRes.stdout.trim() } });
          const j = await r.json().catch(() => ({}));
          const st = j.status || 'Unknown';
          const map = {
            NotStarted: { step: 0, stage: 'queued', label: 'Queued\u2026', ready: false },
            InProgress: { step: 1, stage: 'running', label: 'Demo prep running\u2026 (seeding data, this can take several minutes)', ready: false },
            Completed:  { step: 6, stage: 'done', label: 'Demo run complete.', ready: true },
            Deduped:    { step: 6, stage: 'done', label: 'Demo already up to date.', ready: true },
            Failed:     { step: -1, stage: 'error', label: 'Demo run failed \u2014 see the Fabric monitor.', ready: false },
            Cancelled:  { step: -1, stage: 'error', label: 'Demo run cancelled.', ready: false }
          };
          return send(res, 200, { source: 'job', total: 6, ...(map[st] || { step: 1, stage: 'running', label: 'Demo prep running\u2026', ready: false }) });
        } catch {}
      }
    }

    return send(res, 200, { source: 'none', step: 0, total: 6, stage: 'pending', label: 'Waiting for the demo to start\u2026', ready: false });
  }

  // ---- live log stream (SSE) ----
  if (req.method === 'GET' && p === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    logBuffer.forEach(line => res.write(`data: ${JSON.stringify({ line })}\n\n`));
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'GET' && p === '/api/status') {
    return send(res, 200, { running: !!deployChild });
  }

  res.writeHead(404); res.end('not found');
});

// tiny https GET helper (built-in)
function https_get(u, opts, resolve, reject) {
  const https = require('https');
  https.get(u, opts, (r) => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
}

// Find the first .parquet file under a directory (shallow-first walk).
function findFirstParquet(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.shift();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith('.parquet')) return full;
    }
  }
  return null;
}

// Approximate total size (MB) of a directory tree.
function dirSizeMB(dir) {
  let total = 0; const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else { try { total += fs.statSync(full).size; } catch {} }
    }
  }
  return total / (1024 * 1024);
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`\n  The deployment wizard is already running at http://localhost:${PORT}`);
    console.log(`  Open that URL in your browser, or close the other wizard window to restart.\n`);
    process.exit(0);
  }
  console.error('  Wizard server error:', (err && err.message) ? err.message : err);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Deployment wizard:  http://localhost:${PORT}\n`);
});

