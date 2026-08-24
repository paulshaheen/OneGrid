// Minimal, zero-dependency MCP (Model Context Protocol) client over streamable HTTP.
// Purpose: consume a published Microsoft Fabric Data Agent, whose runtime endpoint is
//   https://api.fabric.microsoft.com/v1/mcp/workspaces/{ws}/dataagents/{id}/agent
// The endpoint speaks JSON-RPC 2.0 over streamable HTTP: an `initialize` handshake,
// a `tools/list` discovery, then a `tools/call`. Responses may come back as either
// application/json or text/event-stream, so we parse both. No npm packages required.

const PROTOCOL_VERSION = '2025-06-18';

// Parse a text/event-stream body into the JSON-RPC messages it carries.
function parseSse(text) {
    const msgs = [];
    for (const frame of text.split(/\r?\n\r?\n/)) {
        const dataLines = [];
        for (const line of frame.split(/\r?\n/)) {
            if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        try { msgs.push(JSON.parse(dataLines.join('\n'))); } catch (_) { /* ignore keep-alives */ }
    }
    return msgs;
}

// POST one JSON-RPC message and return { messages, sessionId } from the response.
async function rpc(url, token, sessionId, payload, timeoutMs) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
        'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
    let resp;
    try {
        resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }

    const newSession = resp.headers.get('mcp-session-id') || sessionId || null;
    if (resp.status === 202) return { messages: [], sessionId: newSession }; // notification ack
    const bodyText = await resp.text();
    if (!resp.ok) throw new Error(`MCP ${payload.method} failed: ${resp.status} ${bodyText.slice(0, 400)}`);

    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    let messages;
    if (ct.includes('text/event-stream')) {
        messages = parseSse(bodyText);
    } else if (bodyText.trim()) {
        try { messages = [JSON.parse(bodyText)]; } catch (e) { messages = parseSse(bodyText); }
    } else {
        messages = [];
    }
    return { messages, sessionId: newSession };
}

function pickResult(messages, id) {
    const m = messages.find(x => x && x.id === id) || messages.find(x => x && (x.result || x.error));
    if (!m) throw new Error('MCP: no JSON-RPC response received');
    if (m.error) throw new Error(`MCP error ${m.error.code}: ${m.error.message}`);
    return m.result;
}

// Ask a published Fabric Data Agent a single natural-language question.
// Returns { text, raw } where text is the concatenated answer.
async function askDataAgent({ url, token, question, timeoutMs, onStatus }) {
    const status = onStatus || (() => {});
    let session = null;

    // 1) initialize
    status('Connecting to Fabric Data Agent…');
    let r = await rpc(url, token, session, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'onegrid-chat', version: '1.0' },
        },
    }, timeoutMs);
    session = r.sessionId;
    pickResult(r.messages, 1);

    // 2) initialized notification (best-effort)
    try {
        await rpc(url, token, session, { jsonrpc: '2.0', method: 'notifications/initialized' }, 30000);
    } catch (_) { /* some servers don't require it */ }

    // 3) discover the single tool the agent exposes
    status('Discovering agent tool…');
    r = await rpc(url, token, session, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, timeoutMs);
    const tools = (pickResult(r.messages, 2) || {}).tools || [];
    if (!tools.length) throw new Error('MCP: data agent exposes no tools');
    const tool = tools[0];
    const schema = tool.inputSchema || tool.input_schema || {};
    const argName = Object.keys(schema.properties || { userQuestion: {} })[0] || 'userQuestion';

    // 4) call the tool. The preview data-agent runtime is slow (many valid queries take
    // 60-90s) and also intermittently returns transient 500s. Give each attempt a
    // generous timeout so legitimate queries complete, retry transient 5xx errors, but do
    // NOT retry a timeout/abort (that just doubles the wait) — let the caller fall back.
    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        status(attempt === 1 ? 'Querying the ontology…' : `Retrying the query (attempt ${attempt})…`);
        try {
            r = await rpc(url, token, session, {
                jsonrpc: '2.0', id: 3 + attempt, method: 'tools/call',
                params: { name: tool.name, arguments: { [argName]: question } },
            }, timeoutMs);
            const result = pickResult(r.messages, 3 + attempt) || {};
            const parts = (result.content || [])
                .filter(b => b && (b.type === 'text' || typeof b.text === 'string'))
                .map(b => b.text);
            const text = parts.join('\n').trim();
            if (result.isError) throw new Error(text || 'MCP: tool call reported an error');
            return { text, tool: tool.name, raw: result };
        } catch (e) {
            lastErr = e;
            // A timeout/abort means the runtime is hung — don't burn another full timeout
            // retrying; stop so the caller can fall back promptly.
            const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
            if (aborted) break;
            if (attempt < maxAttempts) await new Promise((res) => setTimeout(res, 1500));
        }
    }
    throw lastErr || new Error('MCP: tool call failed');
}

module.exports = { askDataAgent };
