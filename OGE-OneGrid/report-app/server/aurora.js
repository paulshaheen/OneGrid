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

// Starts the scheduled job immediately — the same cycle the cron trigger runs
// (fetch initial conditions → detect storms → run the endpoint → publish
// weather-events.json). Does NOT accept storm coordinates: Aurora only
// propagates cyclones it detects in real, current atmospheric conditions
// (see aurora_pipeline/tracking.py) — there is nothing to "aim" it at.
export async function runAuroraNow() {
  const base = armJobBase();
  if (!base) {
    return {
      ok: false,
      message: 'The Aurora scheduled job is not configured for this deployment (deployAuroraSchedule was not enabled, or AURORA_JOB_NAME/AURORA_JOB_RESOURCE_GROUP are unset).',
    };
  }
  const token = await getToken('https://management.azure.com');
  const resp = await fetch(`${base}/start?api-version=${ARM_API_VERSION}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status !== 202 && !resp.ok) {
    return { ok: false, message: `Failed to start the Aurora job (HTTP ${resp.status}): ${await resp.text()}` };
  }
  return {
    ok: true,
    message: 'Aurora forecast cycle triggered. It runs on the same GPU endpoint as the scheduled job and can take several minutes; check status below.',
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
