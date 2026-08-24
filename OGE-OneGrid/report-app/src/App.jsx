import { useState, useEffect, Component, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MODES, PERSONAS } from './lib/themes.js';
import { FocusProvider } from './lib/focus.js';
import { useCapacityStatus } from './lib/api.js';
import Executive from './personas/Executive.jsx';
// Non-landing personas are code-split so their heavy deps (notably the three.js 3D engine in
// Control-Room) stay out of the initial/landing bundle — this is the main LCP win.
const ControlRoom = lazy(() => import('./personas/ControlRoom.jsx'));
const Maintenance = lazy(() => import('./personas/Maintenance.jsx'));
const Ontology = lazy(() => import('./personas/Ontology.jsx'));
import Governance, { ShieldIcon } from './personas/Governance.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import { Tour, TOUR_STEPS } from './components/Tour.jsx';

const PAGES = { executive: Executive, controlroom: ControlRoom, maintenance: Maintenance, ontology: Ontology };

// Guards a view so a render error inside one page can never blank the whole app.
class ViewErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.viewKey !== this.props.viewKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      const theme = this.props.theme || {};
      return (
        <div className="h-full grid place-items-center p-8">
          <div className={`max-w-md text-center ${theme.panel || ''} p-6`}>
            <div className={`text-base font-semibold mb-1 ${theme.heading || ''}`}>This view hit an error</div>
            <div className={`text-sm mb-4 ${theme.sub || ''}`}>{String(this.state.error.message || this.state.error)}</div>
            <button onClick={() => { this.setState({ error: null }); this.props.onReset && this.props.onReset(); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: `${theme.accent || '#4f6bff'}22`, color: theme.accent || '#4f6bff', border: `1px solid ${theme.accent || '#4f6bff'}55` }}>
              Back to dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Full-width strip shown when the live data plane is unavailable — either the Fabric capacity
// is genuinely paused, or the app can't reach the semantic model (sign-in/permission/target).
// Explains why values are blank; auto-hides when the connection recovers.
function CapacityPausedBanner({ status }) {
  const [dismissed, setDismissed] = useState(false);
  // Never nag on a locally-hosted preview (there's usually no live data plane attached), and
  // only ever surface this for a GENUINELY paused capacity — not for auth/target/connection
  // failures, which are a configuration issue rather than a paused capacity.
  const isLocal = typeof location !== 'undefined' && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  const show = status && status.capacityPaused && !status.connectionError && !isLocal && !dismissed;
  const isPaused = status && status.capacityPaused && !status.connectionError;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }} role="status" aria-live="polite"
          className="relative z-10 overflow-hidden"
          style={{ background: 'linear-gradient(90deg, rgba(245,158,11,.16), rgba(245,158,11,.08))', borderBottom: '1px solid rgba(245,158,11,.45)' }}>
          <div className="flex items-center gap-3 px-4 sm:px-6 py-2.5">
            <span className="grid place-items-center w-6 h-6 rounded-full shrink-0" style={{ background: 'rgba(245,158,11,.25)', color: '#f59e0b' }}>
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            </span>
            <div className="leading-tight min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: '#fbbf24' }}>
                {isPaused ? (status.inferred ? 'Live data unavailable' : 'Fabric capacity paused') : 'Live data unavailable'}
              </div>
              <div className="text-[12px] opacity-80" style={{ color: '#fde68a' }}>
                {status.message || 'Live data is available during operating hours, 8 AM–9 PM EST daily. It refreshes automatically when the capacity restarts.'}
              </div>
            </div>
            <button onClick={() => setDismissed(true)} title="Dismiss" aria-label="Dismiss"
              className="shrink-0 w-6 h-6 grid place-items-center rounded-md hover:opacity-70" style={{ color: '#fbbf24' }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const [personaId, setPersonaId] = useState('executive');
  const [gov, setGov] = useState(false);
  const [mode, setMode] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('pm.theme.mode')) || 'dark');
  const [tourOpen, setTourOpen] = useState(false);
  const capacityStatus = useCapacityStatus();
  const theme = MODES[mode] || MODES.light;
  const Persona = PAGES[personaId] || Executive;
  const toggleMode = () => { const m = mode === 'light' ? 'dark' : 'light'; setMode(m); try { localStorage.setItem('pm.theme.mode', m); } catch { /* ignore */ } };

  // Mark the tour as "seen" on first visit but DON'T auto-launch it — the tour renders a
  // full-screen click-catching overlay, and auto-opening it traps the user's first clicks
  // (nav/close appear dead). It remains available on demand from the header "?" button.
  useEffect(() => {
    try { localStorage.setItem('pm.tour.seen', '1'); } catch { /* ignore */ }
  }, []);

  return (
    <FocusProvider>
    <div className={`h-full w-full flex flex-col ${theme.app} ${theme.gridClass}`} style={theme.appStyle}>
      <header className={`relative z-20 flex items-center gap-4 px-4 sm:px-6 h-14 ${theme.nav}`}>
        <button onClick={() => { setGov(false); setPersonaId('executive'); }} className="flex items-center gap-2.5 text-left" title="Home">
          <div className="w-7 h-7 grid place-items-center font-bold text-[13px] rounded-[5px]"
            style={{ background: theme.accent, color: '#fff', letterSpacing: '-0.03em' }}>OG</div>
          <div className="leading-tight">
            <div className={`text-[15px] font-semibold tracking-tight ${theme.heading}`}>OneGrid</div>
            <div className={`eyebrow ${theme.sub}`}>{gov ? 'Governance & security' : PERSONAS.find((p) => p.id === personaId)?.tagline}</div>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <div data-tour="tabs" className="flex items-center gap-1 p-1 rounded-xl" style={{ background: theme.mode === 'light' ? 'rgba(0,0,0,.04)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
            {PERSONAS.map((t) => (
              <button key={t.id} onClick={() => { setPersonaId(t.id); setGov(false); }} title={t.tagline}
                className={`relative px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${personaId === t.id && !gov ? '' : `${theme.navText} hover:opacity-100`}`}
                style={personaId === t.id && !gov ? { color: theme.accent } : {}}>
                {personaId === t.id && !gov && <motion.span layoutId="personapill" className="absolute inset-0 rounded-lg" style={{ background: `${theme.accent}1f`, border: `1px solid ${theme.accent}55` }} />}
                <span className="relative">{t.name}</span>
              </button>
            ))}
          </div>

          {/* Light / Dark toggle — applies to every tab */}
          <button data-tour="theme" onClick={toggleMode} title={`Switch to ${mode === 'light' ? 'dark' : 'light'} theme`}
            className="relative w-14 h-8 rounded-full transition shrink-0"
            style={{ background: theme.mode === 'light' ? 'rgba(15,23,42,.08)' : 'rgba(255,255,255,.10)', border: `1px solid ${theme.mode === 'light' ? 'rgba(15,23,42,.12)' : 'rgba(255,255,255,.14)'}` }}>
            <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              className="absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full grid place-items-center"
              style={{ left: mode === 'light' ? 3 : 'calc(100% - 27px)', background: theme.accent, color: theme.mode === 'light' ? '#fff' : '#06121f' }}>
              {mode === 'light'
                ? <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><circle cx="12" cy="12" r="5" /><g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></g></svg>
                : <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
            </motion.span>
          </button>

          {/* Governance / OneLake-security review plane */}
          <button data-tour="governance" onClick={() => setGov((v) => !v)} title="Governance & OneLake security"
            className="w-8 h-8 rounded-full grid place-items-center shrink-0 transition hover:opacity-80"
            style={{ background: gov ? `${theme.accent}33` : `${theme.accent}1f`, color: theme.accent, border: `1px solid ${theme.accent}55` }}>
            <ShieldIcon className="w-4 h-4" />
          </button>

          {/* Help / guided tour */}
          <button onClick={() => setTourOpen(true)} title="Take a quick tour"
            className="w-8 h-8 rounded-full grid place-items-center shrink-0 transition hover:opacity-80"
            style={{ background: `${theme.accent}1f`, color: theme.accent, border: `1px solid ${theme.accent}55` }}>
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9.1 9a3 3 0 1 1 4.5 2.6c-.9.5-1.6 1.2-1.6 2.4" strokeLinecap="round" /><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" /></svg>
          </button>
        </div>
      </header>

      {!gov && <CapacityPausedBanner status={capacityStatus} />}

      <main className="relative flex-1 min-h-0">
        {/* Deterministic view swap: a keyed motion.div remounts on change and fades in. We do
            NOT use <AnimatePresence mode="wait"> here — its exit-then-enter handoff can, in some
            browsers / reduced-motion settings, fail to mount the next view and leave the screen
            blank. A plain keyed remount always renders exactly one live view. */}
        <motion.div key={gov ? 'governance' : personaId}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}
          className="absolute inset-0">
          <ViewErrorBoundary theme={theme} viewKey={gov ? 'governance' : personaId} onReset={() => { setGov(false); setPersonaId('executive'); }}>
            <Suspense fallback={<div className="h-full grid place-items-center"><div className={`text-sm ${theme.sub}`}>Loading…</div></div>}>
              {gov
                ? <Governance theme={theme} onClose={() => setGov(false)} />
                : <Persona theme={theme} onNavigate={setPersonaId} onOpenGovernance={() => setGov(true)} />}
            </Suspense>
          </ViewErrorBoundary>
        </motion.div>
      </main>

      <ChatPanel theme={theme} persona={personaId} />
      <Tour open={tourOpen} steps={TOUR_STEPS} theme={theme} onNavigate={setPersonaId} onClose={() => setTourOpen(false)} />
    </div>
    </FocusProvider>
  );
}
