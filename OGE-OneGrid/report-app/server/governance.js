// ---------------------------------------------------------------------------
//  Governance / OneLake-security review plane (READ-ONLY).
//
//  This module powers the app's /governance experience: it inventories "who can
//  access what" across the Fabric workspace, the Lakehouse's OneLake data-access
//  roles, and the persona Entra groups, then explains each grant path and flags
//  posture findings (excessive access, memberless roles, direct-user grants, a
//  runtime identity holding a broad workspace role, DefaultReader breadth…).
//
//  IMPORTANT: Fabric / OneLake / Power BI remain the AUTHORITATIVE enforcement
//  layer. Everything here is inventory, correlation and explanation computed from
//  current grants — never an enforcement point. The UI labels it as such.
//
//  Collection is best-effort: admin/OneLake APIs may be preview or unavailable in
//  a given tenant, so every collector degrades gracefully and the deploy-written
//  governance-manifest.json is the always-present source of truth for the demo.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToken, RES_FABRIC, RES_PBI } from './fabric.js';
import { resolveTarget } from './target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SNAPSHOT_FILE = path.join(__dirname, 'governance-snapshots.json');

const CACHE_TTL_MS = 30_000;
let _cache = { at: 0, data: null };

// ── config / manifest ──────────────────────────────────────────────────────
function readJsonLoose(file) {
  const buf = fs.readFileSync(file);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.slice(3).toString('utf8');
  else text = buf.toString('utf8');
  return JSON.parse(text);
}
function tryRead(file) { try { return readJsonLoose(file); } catch { return null; } }

// A demo-safe fallback manifest so the review plane always renders something coherent,
// even before a governance-enabled deploy has run.
function fallbackManifest() {
  const t = resolveTarget();
  return {
    generatedAt: null,
    source: 'fallback',
    workspaceId: t.workspaceId || '',
    lakehouseId: '',
    lakehouseName: 'lh_poc',
    mode: 'demo',
    appGrant: 'workspace Member',
    reviewers: '',
    roles: [
      { name: 'ExecutiveCuratedReader', groupObjectId: '', paths: ['/Tables/gold'], rowFilter: null, hiddenColumns: [], description: 'Curated fleet KPIs only; no raw telemetry or maintenance notes.', membersConfigured: false },
      { name: 'ControlRoomSiteReader', groupObjectId: '', paths: ['/Tables/gold', '/Tables/ml'], rowFilter: 'site_id IN (assigned sites)', hiddenColumns: [], description: 'Live operational + ML tables, filtered to assigned sites (RLS).', membersConfigured: false },
      { name: 'MaintenanceReader', groupObjectId: '', paths: ['/Tables/gold', '/Tables/ml'], rowFilter: null, hiddenColumns: ['labor_rate', 'vendor_cost', 'contract_id'], description: 'Asset health, work orders, predictions; commercial columns hidden (CLS).', membersConfigured: false },
      { name: 'OntologyReader', groupObjectId: '', paths: ['/Tables/oge'], rowFilter: null, hiddenColumns: [], description: 'Ontology / approved entity relationships (read-only).', membersConfigured: false },
    ],
  };
}

export function getManifest() {
  // Prefer the deploy-written manifest; else the Governance block of last-deploy-state.json;
  // else the committed sample manifest (so the review plane is populated for local preview);
  // else a minimal hardcoded fallback.
  const m = tryRead(path.join(REPO_ROOT, 'governance-manifest.json'));
  if (m) return { ...m, source: m.source || 'manifest' };
  const s = tryRead(path.join(REPO_ROOT, 'last-deploy-state.json'));
  if (s && s.Governance) return { ...s.Governance, source: 'deploy-state' };
  const sample = tryRead(path.join(REPO_ROOT, 'governance-manifest.sample.json'));
  if (sample) return { ...sample, source: 'sample' };
  return fallbackManifest();
}

// ── live collectors (best-effort) ──────────────────────────────────────────
async function fetchJson(url, resource) {
  const token = await getToken(resource);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('?')[0]}`);
  return r.json();
}

async function collectWorkspaceRoles(workspaceId) {
  if (!workspaceId) return { items: [], error: 'no workspaceId' };
  try {
    const j = await fetchJson(`${RES_FABRIC}/v1/workspaces/${workspaceId}/roleAssignments`, RES_FABRIC);
    const items = (j.value || []).map((a) => ({
      principalId: a.principal?.id || a.id,
      principalType: a.principal?.type || 'Unknown',
      displayName: a.principal?.displayName || a.principal?.userDetails?.userPrincipalName || a.principal?.id,
      role: a.role,
    }));
    return { items };
  } catch (e) { return { items: [], error: String(e.message || e) }; }
}

async function collectOneLakeRoles(workspaceId, itemId) {
  if (!workspaceId || !itemId) return { items: [], error: 'no lakehouse item' };
  try {
    const j = await fetchJson(`${RES_FABRIC}/v1/workspaces/${workspaceId}/items/${itemId}/dataAccessRoles`, RES_FABRIC);
    const items = (j.value || []).map((r) => ({
      name: r.name,
      members: (r.members?.microsoftEntraMembers || []).map((m) => m.objectId),
      itemMembers: (r.members?.fabricItemMembers || []).length,
      paths: (r.decisionRules || []).flatMap((d) => (d.permission || []).filter((p) => p.attributeName === 'Path').flatMap((p) => p.attributeValueIncludedIn || [])),
    }));
    return { items };
  } catch (e) { return { items: [], error: String(e.message || e) }; }
}

async function collectDatasetUsers(workspaceId, datasetId) {
  if (!workspaceId || !datasetId) return { items: [], error: 'no dataset' };
  try {
    const j = await fetchJson(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/users`, RES_PBI);
    const items = (j.value || []).map((u) => ({
      principalId: u.identifier,
      principalType: u.principalType,
      displayName: u.displayName || u.emailAddress || u.identifier,
      access: u.datasetUserAccessRight,
    }));
    return { items };
  } catch (e) { return { items: [], error: String(e.message || e) }; }
}

// ── effective-access graph + findings ──────────────────────────────────────
function severityRank(s) { return { high: 3, medium: 2, low: 1, info: 0 }[s] ?? 0; }

function buildFindings(manifest, live) {
  const findings = [];
  const add = (severity, title, detail, fix) => findings.push({ id: `f${findings.length + 1}`, severity, title, detail, fix });

  // Runtime identity holding a broad workspace role.
  const grant = String(manifest.appGrant || '');
  if (/member|contributor|admin/i.test(grant)) {
    add('high', 'Runtime app identity has a broad workspace role',
      `The container-app identity is granted "${grant}". Workspace Member/Contributor/Admin can bypass semantic-model RLS and write to the workspace.`,
      'Enable governance.leastPrivilegeApp so the identity gets workspace Viewer + dataset ReadWrite only, then re-run the permissions phase.');
  } else if (grant) {
    add('info', 'Runtime app identity is least-privilege', `App identity grant: "${grant}".`, null);
  }

  // OneLake roles with no members.
  const roleSource = (live.onelake?.items?.length ? live.onelake.items : manifest.roles) || [];
  for (const r of roleSource) {
    const hasMembers = live.onelake?.items?.length ? (r.members?.length > 0) : r.membersConfigured;
    if (!hasMembers) {
      add('low', `OneLake role "${r.name}" has no members`,
        'The role is defined but no Entra security group is assigned, so it grants nothing yet.',
        'Set the matching group object id under governance.groups and re-run the governance phase.');
    }
  }

  // Direct-user grants on the workspace (prefer groups).
  for (const a of live.workspace?.items || []) {
    if (a.principalType === 'User' && /admin|member|contributor/i.test(a.role || '')) {
      add('medium', `Direct user grant on workspace: ${a.displayName}`,
        `"${a.displayName}" holds workspace ${a.role} directly rather than via a security group.`,
        'Move the user into an Entra security group and assign the group instead of the individual.');
    }
  }

  // Reviewers group not configured.
  if (!manifest.reviewers) {
    add('info', 'No governance reviewers group configured',
      'Anyone reaching the /governance route in dev can read the review plane. In production, gate it on a reviewers group.',
      'Set governance.groups.reviewersObjectId to an Entra security group.');
  }

  // SQL user-identity mode still pending.
  if (manifest.sqlUserIdentityModeRequested && manifest.source !== 'fallback') {
    add('low', 'SQL endpoint user-identity mode is a manual step',
      'OneLake row/column security is only enforced through the SQL endpoint when it runs in user-identity mode.',
      'Switch the Lakehouse SQL analytics endpoint to user-identity mode in workspace settings.');
  }

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return findings;
}

// Normalize principals across every source into one list.
function buildPrincipals(manifest, live) {
  const map = new Map();
  const upsert = (id, patch) => {
    if (!id) return;
    const cur = map.get(id) || { id, displayName: id, type: 'Group', sources: [], resources: [] };
    map.set(id, { ...cur, ...patch, sources: [...new Set([...cur.sources, ...(patch.sources || [])])] });
  };

  // From the manifest role blueprint (group object ids + explicit members).
  for (const r of manifest.roles || []) {
    if (r.groupObjectId) upsert(r.groupObjectId, { type: 'Group', sources: ['onelake-role'], displayName: `group:${r.groupObjectId.slice(0, 8)}…` });
    for (const mem of r.members || []) {
      upsert(mem.objectId, { type: mem.type || 'Group', sources: ['onelake-role'], displayName: mem.displayName || mem.objectId });
    }
  }
  // From live OneLake role members.
  for (const r of live.onelake?.items || []) {
    for (const m of r.members || []) upsert(m, { type: 'Group', sources: ['onelake-role'] });
  }
  // From workspace role assignments.
  for (const a of live.workspace?.items || []) {
    upsert(a.principalId, { type: a.principalType, displayName: a.displayName, sources: ['workspace-role'] });
  }
  // From dataset users.
  for (const u of live.dataset?.items || []) {
    upsert(u.principalId, { type: u.principalType, displayName: u.displayName, sources: ['dataset'] });
  }

  // Attach the resources each principal can reach (effective-access paths).
  for (const p of map.values()) p.resources = resourcesForPrincipal(p.id, manifest, live);
  return [...map.values()];
}

// Effective-access paths for one principal: which resources, via which grant.
function resourcesForPrincipal(principalId, manifest, live) {
  const out = [];
  const liveRoles = live.onelake?.items || [];
  const roleList = manifest.roles || [];

  for (const r of roleList) {
    const liveMatch = liveRoles.find((lr) => lr.name === r.name);
    const manifestMembers = (r.members || []).map((m) => m.objectId);
    const isMember = liveMatch
      ? (liveMatch.members || []).includes(principalId)
      : (r.groupObjectId === principalId || manifestMembers.includes(principalId));
    if (!isMember) continue;
    const inheritedAs = (r.members || []).find((m) => m.objectId === principalId)?.type === 'User' ? 'direct' : 'group';
    for (const pth of r.paths || []) {
      out.push({
        resource: `${manifest.lakehouseName}${pth}`,
        resourceId: `onelake:${r.name}:${pth}`,
        action: 'Read',
        via: `OneLake role ${r.name}`,
        source: 'OneLake',
        rowFilter: r.rowFilter || null,
        allowedColumns: r.hiddenColumns?.length ? `all except ${r.hiddenColumns.join(', ')}` : 'all',
        inherited: inheritedAs,
        confidence: liveMatch ? 'confirmed' : 'declared',
      });
    }
  }
  // Workspace role -> broad access to the workspace items.
  for (const a of live.workspace?.items || []) {
    if (a.principalId === principalId) {
      out.push({
        resource: `workspace:${manifest.workspaceId?.slice(0, 8) || ''}…`,
        resourceId: `workspace:${manifest.workspaceId}`,
        action: /admin|member|contributor/i.test(a.role) ? 'ReadWrite (broad)' : 'Read',
        via: `Workspace ${a.role}`,
        source: 'Fabric workspace',
        rowFilter: null,
        allowedColumns: 'all',
        inherited: 'direct',
        confidence: 'confirmed',
      });
    }
  }
  return out;
}

// Resource-centric view: who can see a given resource.
function principalsForResource(resourceId, principals) {
  return principals
    .filter((p) => p.resources.some((r) => r.resourceId === resourceId))
    .map((p) => ({ id: p.id, displayName: p.displayName, type: p.type, grant: p.resources.find((r) => r.resourceId === resourceId) }));
}

function listResources(principals) {
  const map = new Map();
  for (const p of principals) for (const r of p.resources) {
    if (!map.has(r.resourceId)) map.set(r.resourceId, { resourceId: r.resourceId, resource: r.resource, source: r.source, principals: 0 });
    map.get(r.resourceId).principals++;
  }
  return [...map.values()];
}

// Change tracking: diff the current principal→resource edges against the last snapshot.
function edgeKey(pid, rid) { return `${pid}|${rid}`; }
function computeChanges(principals) {
  const current = new Set();
  for (const p of principals) for (const r of p.resources) current.add(edgeKey(p.id, r.resourceId));
  let prev = tryRead(SNAPSHOT_FILE);
  const prevEdges = new Set((prev?.edges) || []);
  const added = [...current].filter((e) => !prevEdges.has(e));
  const removed = [...prevEdges].filter((e) => !current.has(e));
  const changes = [
    ...added.map((e) => ({ type: 'granted', principalId: e.split('|')[0], resourceId: e.split('|')[1] })),
    ...removed.map((e) => ({ type: 'revoked', principalId: e.split('|')[0], resourceId: e.split('|')[1] })),
  ];
  // Persist the new snapshot (best-effort; ignored if the fs is read-only).
  try { fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ at: new Date().toISOString(), edges: [...current] }, null, 2)); } catch {}
  return { since: prev?.at || null, changes };
}

// ── aggregate (cached) ──────────────────────────────────────────────────────
async function collectAll() {
  if (_cache.data && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;
  const manifest = getManifest();
  const t = resolveTarget();
  // In local preview (sample / fallback manifest with no deployed workspace) we don't hit live
  // admin APIs — they'd fail against a stale/unrelated workspace and look like errors. The
  // manifest is authoritative for the demo; live enrichment only runs after a real deploy.
  const isPreview = manifest.source === 'sample' || manifest.source === 'fallback' || !manifest.workspaceId;
  const workspaceId = manifest.workspaceId || t.workspaceId;
  const itemId = manifest.lakehouseId;
  const datasetId = t.datasetId;

  let workspace, onelake, dataset;
  if (isPreview) {
    const skip = { items: [], skipped: true };
    workspace = { ...skip }; onelake = { ...skip }; dataset = { ...skip };
  } else {
    [workspace, onelake, dataset] = await Promise.all([
      collectWorkspaceRoles(workspaceId),
      collectOneLakeRoles(workspaceId, itemId),
      collectDatasetUsers(workspaceId, datasetId),
    ]);
  }
  const live = { workspace, onelake, dataset, isPreview };
  const principals = buildPrincipals(manifest, live);
  const findings = buildFindings(manifest, live);
  const resources = listResources(principals);

  const data = { manifest, live, principals, findings, resources };
  _cache = { at: Date.now(), data };
  return data;
}

// Friendly collector status string (never leaks raw URLs / ids to the UI).
function collectorStatus(c, kind) {
  if (!c) return 'unknown';
  if (c.skipped) return 'local preview — using sample manifest';
  if (c.error) return `not connected (sign in to the deployed tenant to enable live ${kind})`;
  return `${c.items.length} ${kind}`;
}

// ── public handlers (return plain objects; the http server serializes them) ──
export async function posture() {
  const { manifest, findings, principals, resources, live } = await collectAll();
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return {
    generatedAt: manifest.generatedAt,
    source: manifest.source,
    connected: !live.isPreview,
    mode: manifest.mode,
    appGrant: manifest.appGrant,
    workspaceId: manifest.workspaceId,
    lakehouse: manifest.lakehouseName,
    collectors: {
      workspaceRoles: collectorStatus(live.workspace, 'assignments'),
      onelakeRoles: collectorStatus(live.onelake, 'roles'),
      datasetUsers: collectorStatus(live.dataset, 'users'),
    },
    totals: { principals: principals.length, resources: resources.length, roles: (manifest.roles || []).length },
    findingCounts: counts,
    findings,
    disclaimer: 'Computed from current grants. Microsoft Fabric / OneLake remain authoritative — validate sensitive decisions with native access testing.',
  };
}

export async function principals() {
  const { principals } = await collectAll();
  return { principals: principals.map((p) => ({ id: p.id, displayName: p.displayName, type: p.type, sources: p.sources, resourceCount: p.resources.length })) };
}

export async function principalAccess(id) {
  const { principals } = await collectAll();
  const p = principals.find((x) => x.id === id);
  if (!p) return { error: 'principal not found', id };
  return { principal: { id: p.id, displayName: p.displayName, type: p.type, sources: p.sources }, resources: p.resources };
}

export async function resources() {
  const { resources } = await collectAll();
  return { resources };
}

export async function resourcePrincipals(resourceId) {
  const { principals } = await collectAll();
  return { resourceId, principals: principalsForResource(resourceId, principals) };
}

// Explain a specific principal→resource grant path ("why can X see Y?").
export async function explain(principalId, resourceId) {
  const { principals } = await collectAll();
  const p = principals.find((x) => x.id === principalId);
  const grant = p?.resources.find((r) => r.resourceId === resourceId);
  if (!p || !grant) return { error: 'no such access path', principalId, resourceId };
  const steps = [
    { step: 'Principal', detail: `${p.displayName} (${p.type})` },
    grant.inherited === 'group'
      ? { step: 'Group membership', detail: `member of the security group assigned to ${grant.via}` }
      : { step: 'Direct assignment', detail: `assigned directly to ${grant.via}` },
    { step: 'Grant', detail: `${grant.via} permits ${grant.action} on ${grant.resource}` },
    { step: 'Row filter', detail: grant.rowFilter || 'none (all rows)' },
    { step: 'Columns', detail: grant.allowedColumns },
    { step: 'Enforced by', detail: `${grant.source} (${grant.confidence})` },
  ];
  return { principalId, resourceId, resource: grant.resource, steps, confidence: grant.confidence };
}

export async function changes() {
  const { principals } = await collectAll();
  return computeChanges(principals);
}

// Persona policy expectations rendered as a checklist (positive + negative intent).
export async function tests() {
  const { manifest } = await collectAll();
  const rows = [];
  for (const r of manifest.roles || []) {
    for (const pth of r.paths || []) rows.push({ persona: r.name, expectation: `CAN read ${manifest.lakehouseName}${pth}`, kind: 'positive' });
    if (r.rowFilter) rows.push({ persona: r.name, expectation: `rows filtered: ${r.rowFilter}`, kind: 'row' });
    for (const c of r.hiddenColumns || []) rows.push({ persona: r.name, expectation: `CANNOT read column ${c}`, kind: 'negative' });
  }
  rows.push({ persona: 'ExecutiveCuratedReader', expectation: 'CANNOT read raw /Tables (non-gold)', kind: 'negative' });
  return { note: 'Declared policy expectations. Run these as native queries per persona identity to verify enforcement.', tests: rows };
}

// ── authorization guard ─────────────────────────────────────────────────────
// Local dev is open. In production (GOVERNANCE_REQUIRE_AUTH=1), require a Container
// Apps EasyAuth principal that carries the Governance.Reader app role or is a member
// of the configured reviewers group.
export function isAuthorized(req) {
  if (process.env.GOVERNANCE_REQUIRE_AUTH !== '1') return true;
  const b64 = req.headers['x-ms-client-principal'];
  if (!b64) return false;
  try {
    const principal = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const claims = principal.claims || [];
    const roles = claims.filter((c) => /(^|\/)roles$/.test(c.typ) || c.typ === 'roles').map((c) => c.val);
    if (roles.includes('Governance.Reader')) return true;
    const groups = claims.filter((c) => c.typ === 'groups').map((c) => c.val);
    const reviewers = getManifest().reviewers;
    if (reviewers && groups.includes(reviewers)) return true;
    return false;
  } catch { return false; }
}
