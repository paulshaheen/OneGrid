// ---------------------------------------------------------------------------
//  Manual trigger for the Aurora forecast pipeline (the same Container Apps Job
//  the cron schedule runs — see planetary-computer-pro-poc/aurora/README.md).
//  Uses the app's own managed identity (granted "Container Apps Jobs Operator",
//  scoped to just this one job — see main.bicep chatAgentAuroraJobOperator), so
//  no separate credentials are needed to start/read the job.
// ---------------------------------------------------------------------------
import { getToken } from './fabric.js';

const ARM_API_VERSION = '2024-03-01';

function armJobBase() {
  const sub = process.env.AZURE_AI_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID;
  const rg = process.env.AURORA_JOB_RESOURCE_GROUP;
  const job = process.env.AURORA_JOB_NAME;
  if (!sub || !rg || !job) return null;
  return `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.App/jobs/${job}`;
}

export function auroraJobConfigured() {
  return Boolean(armJobBase());
}

const SYNOPTIC_HOURS = new Set([0, 6, 12, 18]);
const VALID_SOURCES = new Set(['hres_t0', 'gfs', 'era5']);

// Validate a historical-replay request and turn it into per-execution env overrides.
// Returns { env: [{name,value},…] } — empty when no replay fields were supplied (a
// plain real-time run) — or { error } describing the first invalid field. The pipeline
// reads exactly these env vars (see aurora_pipeline/config.py): ANALYSIS_TIME,
// INITIAL_CONDITION_SOURCE, DETECTION_BBOX, STORM_NAMES, AURORA_NUM_STEPS.
function buildReplayEnv(overrides) {
  if (!overrides || typeof overrides !== 'object') return { env: [] };
  const { analysisTime, source, bbox, stormName, numSteps } = overrides;
  if (!analysisTime && !source && !bbox && !stormName && numSteps == null) return { env: [] };

  const env = [];

  if (analysisTime) {
    const d = new Date(analysisTime);
    if (Number.isNaN(d.getTime())) return { error: 'analysisTime is not a valid date/time.' };
    if (!SYNOPTIC_HOURS.has(d.getUTCHours()) || d.getUTCMinutes() !== 0) {
      return { error: 'analysisTime must fall on a synoptic hour — 00, 06, 12 or 18 UTC.' };
    }
    const iso =
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00`;
    env.push({ name: 'ANALYSIS_TIME', value: iso });
  }

  if (source) {
    if (!VALID_SOURCES.has(source)) {
      return { error: `source must be one of ${[...VALID_SOURCES].join(', ')}.` };
    }
    env.push({ name: 'INITIAL_CONDITION_SOURCE', value: source });
  }

  if (bbox) {
    const parts = String(bbox).split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      return { error: 'bbox must be four numbers: minLon,minLat,maxLon,maxLat.' };
    }
    const [minLon, minLat, maxLon, maxLat] = parts;
    if (minLon >= maxLon || minLat >= maxLat) {
      return { error: 'bbox must have min < max for both longitude and latitude.' };
    }
    env.push({ name: 'DETECTION_BBOX', value: parts.join(',') });
  }

  if (stormName) {
    const name = String(stormName).trim().slice(0, 80);
    if (name) env.push({ name: 'STORM_NAMES', value: name });
  }

  if (numSteps != null && numSteps !== '') {
    const n = Number(numSteps);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      return { error: 'numSteps must be a whole number between 1 and 60.' };
    }
    env.push({ name: 'AURORA_NUM_STEPS', value: String(n) });
  }

  return { env };
}

// Read the job's own container template so a replay run can inherit the image,
// resources and existing env (identity, storage URLs, endpoint) and only override
// the few replay knobs — the /start action replaces the container spec for that
// execution, so we must send a complete container, not just the deltas.
async function fetchJobContainers(base, token) {
  const resp = await fetch(`${base}?api-version=${ARM_API_VERSION}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const body = await resp.json();
  const containers = body?.properties?.template?.containers;
  return Array.isArray(containers) && containers.length ? containers : null;
}

// Starts the Aurora job immediately. With no arguments it runs the exact cycle the
// cron trigger runs (fetch current conditions → detect storms → forecast → publish).
// With replay overrides ({ analysisTime, source, bbox, stormName, numSteps }) it
// re-forecasts a past storm from a public archive — Aurora still only propagates a
// cyclone it actually detects in that historical snapshot; the overrides just point
// it at the right date and search box (see aurora_pipeline/tracking.py).
export async function runAuroraNow(overrides) {
  const base = armJobBase();
  if (!base) {
    return {
      ok: false,
      message: 'The Aurora scheduled job is not configured for this deployment (deployAuroraSchedule was not enabled, or AURORA_JOB_NAME/AURORA_JOB_RESOURCE_GROUP are unset).',
    };
  }

  const { env, error } = buildReplayEnv(overrides);
  if (error) return { ok: false, message: `Invalid replay settings: ${error}` };
  const replay = env.length > 0;

  const token = await getToken('https://management.azure.com');

  let startInit = { method: 'POST', headers: { Authorization: `Bearer ${token}` } };
  if (replay) {
    const containers = await fetchJobContainers(base, token);
    if (!containers) {
      return { ok: false, message: 'Could not read the Aurora job template to apply the replay settings. Check the app identity still has access to the job.' };
    }
    const overrideNames = new Set(env.map((e) => e.name));
    const merged = containers.map((c) => {
      const existing = Array.isArray(c.env) ? c.env : [];
      const kept = existing.filter((e) => !overrideNames.has(e.name));
      const out = { name: c.name, image: c.image, env: [...kept, ...env] };
      if (c.command) out.command = c.command;
      if (c.args) out.args = c.args;
      if (c.resources) out.resources = c.resources;
      if (c.volumeMounts) out.volumeMounts = c.volumeMounts;
      return out;
    });
    startInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: { containers: merged } }),
    };
  }

  const resp = await fetch(`${base}/start?api-version=${ARM_API_VERSION}`, startInit);
  if (resp.status !== 202 && !resp.ok) {
    return { ok: false, message: `Failed to start the Aurora job (HTTP ${resp.status}): ${await resp.text()}` };
  }
  return {
    ok: true,
    message: replay
      ? 'Historical storm replay triggered. Aurora is re-forecasting from the selected date on the same GPU endpoint; it can take several minutes — watch the run status below.'
      : 'Aurora forecast cycle triggered. It runs on the same GPU endpoint as the scheduled job and can take several minutes; check status below.',
  };
}

// Most recent execution of the job (running the button just triggered, or a
// past cron run), so the UI can show real progress instead of a fire-and-forget button.
export async function auroraStatus() {
  const base = armJobBase();
  if (!base) return { ok: false, configured: false, message: 'The Aurora scheduled job is not configured for this deployment.' };
  const token = await getToken('https://management.azure.com');
  const resp = await fetch(`${base}/executions?api-version=${ARM_API_VERSION}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { ok: false, configured: true, message: `Could not read job executions (HTTP ${resp.status}).` };
  const body = await resp.json();
  const executions = (body.value || []).slice().sort((a, b) => {
    const at = new Date(a.properties?.startTime || 0).getTime();
    const bt = new Date(b.properties?.startTime || 0).getTime();
    return bt - at;
  });
  const latest = executions[0];
  return {
    ok: true,
    configured: true,
    latest: latest
      ? {
          name: latest.name,
          status: latest.properties?.status,
          startTime: latest.properties?.startTime,
          endTime: latest.properties?.endTime,
        }
      : null,
  };
}
