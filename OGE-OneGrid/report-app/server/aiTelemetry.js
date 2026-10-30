// Minimal Application Insights sender. Node auto-instrumentation does not capture
// console logs or custom metrics, so demo telemetry is posted straight to the
// ingestion endpoint named in APPLICATIONINSIGHTS_CONNECTION_STRING. Best-effort.
const ROLE = 'onegrid-sensor-monitor';

function conn() {
  const cs = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || '';
  const parts = Object.fromEntries(cs.split(';').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  return parts.InstrumentationKey && parts.IngestionEndpoint ? parts : null;
}

async function send(items) {
  const c = conn();
  if (!c || !items.length) return;
  const envelopes = items.map((it) => ({ iKey: c.InstrumentationKey, tags: { 'ai.cloud.role': ROLE }, time: new Date().toISOString(), ...it }));
  try {
    await fetch(`${c.IngestionEndpoint.replace(/\/$/, '')}/v2.1/track`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelopes),
    });
  } catch { /* telemetry is best-effort */ }
}

/** severity: 0 verbose, 1 info, 2 warning, 3 error, 4 critical */
export function trackTrace(message, properties = {}, severityLevel = 2) {
  return send([{ name: 'Microsoft.ApplicationInsights.Message', data: { baseType: 'MessageData', baseData: { ver: 2, message, severityLevel, properties } } }]);
}

/** metrics: [{ name, value, properties }] */
export function trackMetrics(metrics) {
  return send(metrics.map((m) => ({
    name: 'Microsoft.ApplicationInsights.Metric',
    data: { baseType: 'MetricData', baseData: { ver: 2, metrics: [{ name: m.name, value: m.value, count: 1 }], properties: m.properties || {} } },
  })));
}
