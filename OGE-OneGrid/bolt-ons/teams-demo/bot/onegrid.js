// Bridges the Teams bot to the already-deployed OneGrid assistant.
// The app exposes two SSE endpoints that both emit `data: {type:'status'|'done', ...}`:
//   POST /api/chat          — the tool-calling assistant (KQL/DAX, grounded in Fabric)
//   POST /api/ask-ontology  — the published Fabric Data Agent (semantic-model grounded)
// We POST the question, read the stream, and return the final `done` payload's reply.

const APP_URL = (process.env.ONEGRID_APP_URL || '').replace(/\/$/, '');

async function readSse(resp, onStatus) {
  if (!resp.ok) throw new Error(`OneGrid ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buf = '';
  let done = null;
  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.type === 'status' && onStatus) onStatus(evt.status);
      else if (evt.type === 'done') done = evt;
    }
  }
  return done || { reply: 'No answer returned.' };
}

// Ask the tool-calling assistant. `history` is [{role, content}].
async function askChat(message, { history = [], persona = 'analyst', onStatus } = {}) {
  if (!APP_URL) throw new Error('ONEGRID_APP_URL is not configured.');
  const resp = await fetch(`${APP_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, persona }),
  });
  return readSse(resp, onStatus);
}

// Ask the published Fabric Data Agent (grounded in the OneGrid semantic model).
async function askOntology(message, { onStatus } = {}) {
  if (!APP_URL) throw new Error('ONEGRID_APP_URL is not configured.');
  const resp = await fetch(`${APP_URL}/api/ask-ontology`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return readSse(resp, onStatus);
}

async function dataAgentAvailable() {
  if (!APP_URL) return false;
  try {
    const r = await fetch(`${APP_URL}/api/health`);
    const j = await r.json();
    return !!j.dataAgent;
  } catch { return false; }
}

module.exports = { askChat, askOntology, dataAgentAvailable, APP_URL };
