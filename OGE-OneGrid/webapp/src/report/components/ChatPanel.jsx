import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Feedback } from './Feedback.jsx';
import { useFocus } from '../lib/focus.js';

// Map the report persona to the chat agent's response persona.
const PERSONA_MAP = { executive: 'executive', controlroom: 'analyst', maintenance: 'maintenance' };

const STARTERS = {
  executive: ['What is the overall fleet health right now?', 'Which asset is the biggest risk this week?', 'Summarize what I should watch today'],
  controlroom: ['Show the top anomalies in the last 24h', 'Which tags are trending abnormally?', 'Correlate steam drum level with feedwater flow'],
  maintenance: ['What work orders are open on the boiler?', 'What is the recommended fix for the economizer?', 'Which bearing needs attention first?'],
};

// Very small markdown → HTML (bold, code, bullets, line breaks).
function mdToHtml(t) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = esc(t || '');
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-black/20">$1</code>');
  const lines = h.split('\n');
  let out = '', inList = false;
  for (const ln of lines) {
    const m = ln.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { if (!inList) { out += '<ul class="list-disc pl-5 space-y-0.5 my-1">'; inList = true; } out += `<li>${m[1]}</li>`; }
    else { if (inList) { out += '</ul>'; inList = false; } out += ln.trim() ? `<p class="my-1">${ln}</p>` : ''; }
  }
  if (inList) out += '</ul>';
  return out;
}

function Sparkline({ spec, theme }) {
  const series = (spec.series || []).filter((s) => s.data && s.data.some((v) => v != null));
  if (!series.length) return null;
  const W = 320, H = 90, pad = 6;
  const all = series.flatMap((s) => s.data.filter((v) => v != null));
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const colors = theme.chart.series;
  return (
    <div className="mt-2 rounded-lg p-2" style={{ background: 'rgba(127,147,172,.08)', border: '1px solid rgba(127,147,172,.15)' }}>
      {spec.title && <div className="text-[10px] mb-1 opacity-70">{spec.title}</div>}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {series.map((s, si) => {
          const d = s.data.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
          return <polyline key={si} points={d} fill="none" stroke={colors[si % colors.length]} strokeWidth="1.6" />;
        })}
      </svg>
      <div className="flex flex-wrap gap-2 mt-1">
        {series.map((s, si) => (
          <span key={si} className="inline-flex items-center gap-1 text-[9px] opacity-80">
            <span className="w-2 h-0.5 rounded" style={{ background: colors[si % colors.length] }} />{s.name}{s.unit ? ` (${s.unit})` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Focus-aware conversation starters when the user has drilled into an asset / site.
function focusStarters(f) {
  if (!f) return null;
  if (f.kind === 'site') return [`Summarize ${f.plant}'s health right now`, `What outages or derates affect ${f.plant}?`, `Which unit at ${f.plant} needs attention first?`];
  const who = f.name || f.unit || 'this asset';
  return [`What's the current status of ${who}?`, `Show anomalies on ${who} in the last 24h`, `Any open work orders for ${f.unit || who}?`, `Trend the key sensors for ${who}`];
}

export default function ChatPanel({ theme, persona: pagePersona }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [scoped, setScoped] = useState(true);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('pm.chat.model')) || '');
  const [modelOpen, setModelOpen] = useState(false);
  const [provider, setProvider] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('pm.chat.provider')) || '');
  const [copilotToken, setCopilotToken] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('pm.copilot.token')) || '');
  const [providers, setProviders] = useState({ foundry: true, copilot: false });
  const [activeProvider, setActiveProvider] = useState('foundry');
  const [tokenPrompt, setTokenPrompt] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [dataAgentAvailable, setDataAgentAvailable] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const scrollRef = useRef(null);
  const persona = PERSONA_MAP[pagePersona] || 'analyst';
  const dark = theme.mode !== 'light';
  const { focus } = useFocus();
  const activeFocus = scoped ? focus : null;
  const focusLabel = focus ? (focus.kind === 'site' ? focus.plant : `${focus.name || focus.unit || 'asset'}`) : null;
  const onCopilot = (provider || activeProvider) === 'copilot';

  useEffect(() => {
    const headers = {};
    if (copilotToken) headers['x-copilot-token'] = copilotToken;
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    fetch('/api/models' + qs, { headers }).then((r) => r.json()).then((d) => {
      if (d.providers) setProviders(d.providers);
      if (d.provider) setActiveProvider(d.provider);
      const list = (d.models || []).filter((m) => m.id && !/compaction|embedding/i.test(m.id));
      setModels(list);
      // Snap to the active provider's default when the current model isn't in the new list.
      setModel((prev) => (list.some((m) => m.id === prev) ? prev : (d.default || (list[0] && list[0].id) || '')));
    }).catch(() => {});
  }, [provider, copilotToken]);
  const chooseModel = (id) => { setModel(id); try { localStorage.setItem('pm.chat.model', id); } catch { /* ignore */ } setModelOpen(false); };
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setDataAgentAvailable(!!d.dataAgent)).catch(() => {});
  }, []);
  const toggleAgentMode = () => setAgentMode((v) => { const n = !v; try { localStorage.setItem('pm.chat.agentMode', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const switchProvider = (p) => {
    if (p === 'copilot' && !providers.copilot && !copilotToken) { setTokenPrompt(true); return; }
    setProvider(p); try { localStorage.setItem('pm.chat.provider', p); } catch { /* ignore */ }
  };
  const saveToken = () => {
    const t = tokenInput.trim(); if (!t) return;
    setCopilotToken(t); try { localStorage.setItem('pm.copilot.token', t); localStorage.setItem('pm.chat.provider', 'copilot'); } catch { /* ignore */ }
    setProvider('copilot'); setTokenPrompt(false); setTokenInput('');
  };
  const clearCopilot = () => {
    setCopilotToken(''); setProvider('');
    try { localStorage.removeItem('pm.copilot.token'); localStorage.setItem('pm.chat.provider', ''); } catch { /* ignore */ }
  };
  const currentModel = models.find((m) => m.id === model);
  const byVendor = useMemo(() => {
    const g = {};
    for (const m of models) (g[m.vendor || 'Other'] ||= []).push(m);
    return g;
  }, [models]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, status, open]);

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput(''); setSuggestions([]);
    const history = msgs.map((m) => ({ role: m.role, content: m.content })).slice(-10);
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setBusy(true); setStatus('Thinking…');
    const useAgent = agentMode && dataAgentAvailable;
    const context = activeFocus ? {
      kind: activeFocus.kind, asset_id: activeFocus.asset_id, name: activeFocus.name,
      plant: activeFocus.plant, unit: activeFocus.unit, category: activeFocus.category,
      status: activeFocus.status, running_tag: activeFocus.running_tag,
    } : undefined;
    try {
      const resp = useAgent
        ? await fetch('/api/ask-ontology', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          })
        : await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history, persona, context, model: model || undefined, provider: provider || undefined, copilotToken: copilotToken || undefined }),
          });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '', final = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === 'status') setStatus(data.status);
          else if (data.type === 'done') final = data;
        }
      }
      if (final) {
        setMsgs((m) => [...m, { role: 'assistant', content: final.reply || '(no answer)', meta: final }]);
        setSuggestions(final.suggestions || []);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, meta: null }]);
    } finally { setBusy(false); setStatus(''); }
  }

  // Let other screens (e.g. the Ontology graph) open the assistant and ask a
  // ready-made question via window events.
  const sendRef = useRef(send); sendRef.current = send;
  useEffect(() => {
    const onAsk = (e) => { setOpen(true); const msg = e.detail && e.detail.message; if (msg) setTimeout(() => sendRef.current && sendRef.current(msg), 80); };
    const onOpen = () => setOpen(true);
    window.addEventListener('pm-chat-ask', onAsk);
    window.addEventListener('pm-chat-open', onOpen);
    return () => { window.removeEventListener('pm-chat-ask', onAsk); window.removeEventListener('pm-chat-open', onOpen); };
  }, []);

  const bg = dark ? '#0b1420' : '#ffffff';
  const surface = dark ? 'rgba(255,255,255,.05)' : '#f4f7fb';
  const border = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)';
  const text = dark ? '#e6eef8' : '#0f1b2d';
  const sub = dark ? '#8ea3bd' : '#5b6b82';

  return (
    <>
      {/* Launcher */}
      <motion.button data-tour="chat" onClick={() => setOpen(true)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: open ? 0 : 1, y: open ? 12 : 0 }}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-3.5 py-2.5 rounded-[8px] font-semibold text-[13px]"
        style={{ background: theme.accent, color: '#fff', border: '1px solid rgba(255,255,255,0.14)', pointerEvents: open ? 'none' : 'auto' }}
        whileTap={{ scale: 0.98 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        Ask the data
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(4,8,14,.35)', backdropFilter: 'blur(2px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="fixed top-0 right-0 z-50 h-full w-[min(440px,92vw)] flex flex-col"
              style={{ background: bg, color: text, borderLeft: `1px solid ${border}`, boxShadow: '-20px 0 60px rgba(0,0,0,.35)' }}
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
              {/* header */}
              <div className="flex items-center gap-3 px-4 py-3.5 shrink-0" style={{ borderBottom: `1px solid ${border}` }}>
                <div className="w-8 h-8 rounded-[6px] grid place-items-center" style={{ background: theme.accent, color: '#fff' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                </div>
                <div className="leading-tight flex-1 min-w-0">
                  <div className="font-bold text-[15px]">Chat with your data</div>
                  <div className="relative">
                    <button onClick={() => setModelOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] rounded-md px-1.5 py-0.5 -ml-1.5 hover:opacity-90 transition max-w-full"
                      style={{ color: sub, background: modelOpen ? surface : 'transparent' }} title="Switch AI model">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />
                      <span className="truncate">{currentModel?.name || model || 'Select model'}</span>
                      <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    {modelOpen && (
                      <>
                        <div className="fixed inset-0 z-[55]" onClick={() => setModelOpen(false)} />
                        <div className="absolute z-[60] mt-1 left-0 w-64 max-h-72 overflow-y-auto rounded-xl py-1 shadow-2xl"
                          style={{ background: bg, border: `1px solid ${border}`, boxShadow: '0 20px 50px rgba(0,0,0,.5)' }}>
                          {Object.keys(byVendor).length === 0 && <div className="px-3 py-2 text-[11px]" style={{ color: sub }}>Loading models…</div>}
                          {Object.entries(byVendor).map(([vendor, list]) => (
                            <div key={vendor}>
                              <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: sub }}>{vendor}</div>
                              {list.map((m) => (
                                <button key={m.id} onClick={() => chooseModel(m.id)}
                                  className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition hover:opacity-90"
                                  style={{ background: m.id === model ? `${theme.accent}1f` : 'transparent', color: text }}>
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.id === model ? theme.accent : 'transparent', border: m.id === model ? 'none' : `1px solid ${border}` }} />
                                  <span className="flex-1 truncate">{m.name || m.id}</span>
                                  {m.id === model && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke={theme.accent} strokeWidth="3"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* provider switch: Azure Foundry ↔ your Copilot license */}
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="inline-flex rounded-md overflow-hidden text-[10px] font-bold" style={{ border: `1px solid ${border}` }}>
                      <button onClick={() => switchProvider('foundry')} disabled={!providers.foundry}
                        className="px-2 py-0.5 transition disabled:opacity-40"
                        style={!onCopilot ? { background: theme.accent, color: dark ? '#06121f' : '#fff' } : { color: sub }}>Azure</button>
                      <button onClick={() => switchProvider('copilot')}
                        className="px-2 py-0.5 transition inline-flex items-center gap-1"
                        style={onCopilot ? { background: theme.accent, color: dark ? '#06121f' : '#fff' } : { color: sub }}>
                        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.4L12 15l-1.9-4.6L5.5 9l4.6-1.4L12 3z" /></svg>
                        Copilot
                      </button>
                    </div>
                    {onCopilot && copilotToken && <button onClick={clearCopilot} className="text-[9px] hover:opacity-80" style={{ color: sub }} title="Disconnect your Copilot token">disconnect</button>}
                  </div>
                  {dataAgentAvailable && (
                    <button data-tour="chat-agent" onClick={toggleAgentMode}
                      className="flex items-center gap-1.5 mt-1 text-[10px] font-bold rounded-md px-2 py-0.5 transition"
                      style={agentMode ? { background: theme.accent, color: dark ? '#06121f' : '#fff' } : { color: sub, border: `1px solid ${border}` }}
                      title="Answer directly from the published Fabric Data Agent, grounded in the OneGrid semantic model">
                      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zm0 0v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Fabric Data Agent {agentMode ? 'on' : 'off'}
                    </button>
                  )}
                  {tokenPrompt && (
                    <div className="mt-1.5 p-2 rounded-lg" style={{ background: surface, border: `1px solid ${border}` }}>
                      <div className="text-[10px] mb-1 leading-snug" style={{ color: sub }}>Paste a GitHub token with Copilot access to use your own license. It stays in your browser and is only forwarded to power your Copilot requests.</div>
                      <div className="flex gap-1">
                        <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="ghp_… / gho_…"
                          onKeyDown={(e) => { if (e.key === 'Enter') saveToken(); }}
                          className="flex-1 rounded px-2 py-1 text-[11px] outline-none" style={{ background: bg, border: `1px solid ${border}`, color: text }} />
                        <button onClick={saveToken} className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: theme.accent, color: dark ? '#06121f' : '#fff' }}>Use</button>
                        <button onClick={() => setTokenPrompt(false)} className="px-1.5 text-[13px]" style={{ color: sub }}>×</button>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => setOpen(false)} className="text-2xl leading-none opacity-60 hover:opacity-100">×</button>
              </div>

              {/* focus / context chip — stays aware of the asset or site you drilled into */}
              {focusLabel && (
                <div className="px-4 py-2 shrink-0 flex items-center gap-2" style={{ borderBottom: `1px solid ${border}`, background: scoped ? `${theme.accent}12` : 'transparent' }}>
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke={scoped ? theme.accent : sub} strokeWidth="2"><path d="M12 21s-7-5.2-7-11a7 7 0 1 1 14 0c0 5.8-7 11-7 11z" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.4" /></svg>
                  <div className="text-[11px] flex-1 min-w-0 truncate" style={{ color: scoped ? text : sub }}>
                    {scoped ? 'Scoped to ' : 'Ignoring '}<b className="font-semibold">{focusLabel}</b>
                    {focus?.unit && focus.kind !== 'site' ? <span style={{ color: sub }}> · {focus.unit}</span> : null}
                  </div>
                  <button onClick={() => setScoped((v) => !v)} className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: scoped ? `${theme.accent}22` : surface, color: scoped ? theme.accent : sub, border: `1px solid ${scoped ? `${theme.accent}55` : border}` }}>
                    {scoped ? 'On' : 'Off'}
                  </button>
                </div>
              )}

              {/* Fabric Data Agent notice — sets expectations on governed reasoning + slower responses */}
              <AnimatePresence initial={false}>
                {agentMode && dataAgentAvailable && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="shrink-0 overflow-hidden" style={{ borderBottom: `1px solid ${border}`, background: `linear-gradient(90deg, ${theme.accent}14, ${theme.accent}06)` }}>
                    <div className="px-4 py-2 flex items-start gap-2.5">
                      <span className="w-5 h-5 mt-[1px] rounded-md grid place-items-center shrink-0" style={{ background: theme.accent, color: dark ? '#06121f' : '#fff' }}>
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zm0 0v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <div className="text-[11px] leading-snug flex-1 min-w-0" style={{ color: sub }}>
                        <b style={{ color: text }}>Fabric Data Agent</b> is answering — a governed agent reasons over your semantic model and generates its own queries.
                        <span style={{ color: theme.accent }}> Expect longer, more deliberate responses.</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {msgs.length === 0 && (
                  <div className="space-y-3">
                    <div className="text-[13px]" style={{ color: sub }}>
                      {activeFocus
                        ? <>Ask about <b style={{ color: text }}>{focusLabel}</b> — I'll keep answers scoped to it. Grounded in your Fabric workspace.</>
                        : <>Ask questions about live sensor data, anomalies, root cause, work orders and predictions — grounded in your Fabric workspace.</>}
                    </div>
                    <div className="space-y-1.5">
                      {(focusStarters(activeFocus) || STARTERS[pagePersona] || STARTERS.controlroom).map((s, i) => (
                        <button key={i} onClick={() => send(s)} className="w-full text-left text-[13px] px-3 py-2 rounded-lg transition hover:opacity-90"
                          style={{ background: surface, border: `1px solid ${border}` }}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[88%] text-[13px] leading-relaxed rounded-2xl px-3.5 py-2.5"
                      style={m.role === 'user'
                        ? { background: theme.accent, color: theme.persona === 'executive' ? '#fff' : '#06121f', borderBottomRightRadius: 6 }
                        : { background: surface, border: `1px solid ${border}`, borderBottomLeftRadius: 6 }}>
                      {m.role === 'assistant'
                        ? <div dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                        : m.content}
                      {m.meta?.charts?.map((c, ci) => <Sparkline key={ci} spec={c} theme={theme} />)}
                      {m.meta?.queries?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {m.meta.queries.map((q, qi) => (
                            <span key={qi} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(127,147,172,.15)', color: sub }}>
                              {q.type}{q.table ? ` ${q.table}` : ''}: {q.error ? 'error' : `${q.rows ?? 0} rows`}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.role === 'assistant' && (
                        <div className="mt-2 pt-2 flex items-center gap-1 border-t" style={{ borderColor: border }}>
                          <span className="text-[9px] uppercase tracking-wide" style={{ color: sub }}>Was this helpful?</span>
                          <Feedback theme={theme} itemType="chat" itemRef={(msgs[i - 1]?.content || '').slice(0, 120)} persona={persona}
                            context={{ question: msgs[i - 1]?.content, answer: m.content, queries: m.meta?.queries }} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="text-[12px] rounded-2xl px-3.5 py-2.5 inline-flex items-center gap-2" style={{ background: surface, border: `1px solid ${border}`, color: sub }}>
                      <span className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: `${theme.accent}40`, borderTopColor: theme.accent }} />
                      {status || 'Working…'}
                    </div>
                  </div>
                )}
              </div>

              {/* suggestions */}
              {suggestions.length > 0 && !busy && (
                <div className="px-4 pb-1 flex flex-wrap gap-1.5 shrink-0">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => send(s)} className="text-[11px] px-2.5 py-1 rounded-full transition hover:opacity-90"
                      style={{ background: `${theme.accent}18`, color: theme.accent, border: `1px solid ${theme.accent}44` }}>{s}</button>
                  ))}
                </div>
              )}

              {/* input */}
              <div className="p-3 shrink-0" style={{ borderTop: `1px solid ${border}` }}>
                <div className="flex items-end gap-2 rounded-xl px-3 py-2" style={{ background: surface, border: `1px solid ${border}` }}>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Ask about your fleet…" disabled={busy}
                    className="flex-1 bg-transparent resize-none outline-none text-[13px] max-h-28" style={{ color: text }} />
                  <button onClick={() => send()} disabled={busy || !input.trim()}
                    className="shrink-0 w-8 h-8 rounded-lg grid place-items-center transition disabled:opacity-40"
                    style={{ background: theme.accent, color: theme.persona === 'executive' ? '#fff' : '#06121f' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor"/></svg>
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
