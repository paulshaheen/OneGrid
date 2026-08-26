import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

// Interactive guided tour: spotlights real elements (via data-tour selectors), switches
// persona tabs as it steps, and (for interactive steps) advances when you actually click
// the highlighted element. No dependencies.
export function Tour({ open, steps, theme, onClose, onNavigate }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [cardH, setCardH] = useState(210);
  const cardRef = useRef(null);
  const advanced = useRef(false);
  const dark = theme.mode !== 'light';
  const step = steps[i] || {};
  const last = i === steps.length - 1;
  const interactive = !!step.interactive && !!step.target;

  const go = (n) => { advanced.current = false; setI(Math.max(0, Math.min(steps.length - 1, n))); };
  const next = () => { if (last) onClose(); else go(i + 1); };

  useEffect(() => { if (open) { advanced.current = false; setI(0); } }, [open]);

  // Resolve the current step's target: switch tab if needed, then locate + measure it.
  // We DON'T clear the previous rect first — the spotlight smoothly animates to the new
  // element instead of flashing to full-dark between steps.
  useEffect(() => {
    if (!open) return;
    const st = steps[i]; if (!st) return;
    advanced.current = false;
    if (st.persona) onNavigate(st.persona);
    // Some steps spotlight elements that only exist inside the open chat panel (e.g. the
    // Fabric Data Agent toggle). Ask the ChatPanel to open so the target can be found even
    // if the user skipped the interactive "open chat" step.
    if (st.openChat && typeof window !== 'undefined') window.dispatchEvent(new Event('pm-chat-open'));
    if (!st.target) { setRect(null); return; }
    let cancelled = false, tries = 0, timer;
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(st.target);
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
        setTimeout(() => { if (!cancelled) setRect(el.getBoundingClientRect()); }, 200);
      } else if (tries++ < 30) { timer = setTimeout(find, 120); }
    };
    timer = setTimeout(find, st.persona ? 380 : 40);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, i]);

  // Keep the spotlight glued to the element on resize / scroll.
  useEffect(() => {
    if (!open || !step.target) return;
    const onR = () => { const el = document.querySelector(step.target); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener('resize', onR, true);
    window.addEventListener('scroll', onR, true);
    return () => { window.removeEventListener('resize', onR, true); window.removeEventListener('scroll', onR, true); };
  }, [open, i]);

  useLayoutEffect(() => { if (cardRef.current) setCardH(cardRef.current.offsetHeight); }, [i, rect]);

  // Interactive steps advance when the user clicks inside the spotlight (capture phase so
  // we still register even though the real element handles the click too).
  useEffect(() => {
    if (!open || !interactive || !rect) return;
    const onClick = (e) => {
      const within = e.clientX >= rect.left - 6 && e.clientX <= rect.right + 6 && e.clientY >= rect.top - 6 && e.clientY <= rect.bottom + 6;
      if (within && !advanced.current) { advanced.current = true; setTimeout(next, 400); }
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [open, interactive, rect, i]);

  if (!open || typeof document === 'undefined') return null;

  const darkFill = dark ? 'rgba(2,6,15,.74)' : 'rgba(15,23,42,.5)';
  const PAD = 8, GAP = 14, W = 344;

  // Card placement — flip above/below so it never covers the highlighted element.
  let cardBox = null;
  if (rect && rect.width) {
    const below = window.innerHeight - rect.bottom, above = rect.top;
    let top;
    if (below > cardH + GAP + 8) top = rect.bottom + GAP;
    else if (above > cardH + GAP + 8) top = rect.top - cardH - GAP;
    else top = Math.max(GAP, Math.min(window.innerHeight - cardH - GAP, rect.top));
    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.min(Math.max(GAP, left), window.innerWidth - W - GAP);
    cardBox = { top, left };
  }

  const cardBg = dark ? '#0d1826' : '#ffffff';
  const cardText = dark ? '#e6eef8' : '#0f1b2d';
  const cardSub = dark ? '#8ea3bd' : '#5b6b82';
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.12)';

  const Card = (
    <motion.div ref={cardRef} key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="rounded-2xl p-4 pointer-events-auto" style={{ width: W, background: cardBg, color: cardText, border: `1px solid ${border}`, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${theme.accent}22`, color: theme.accent }}>{step.tag || 'Tour'}</span>
        <span className="text-[11px]" style={{ color: cardSub }}>{i + 1} / {steps.length}</span>
        <button onClick={onClose} className="ml-auto text-lg leading-none" style={{ color: cardSub }}>×</button>
      </div>
      <h3 className="text-base font-bold mb-1">{step.title}</h3>
      <p className="text-[13px] leading-relaxed" style={{ color: cardSub }}>{step.body}</p>

      {interactive && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: theme.accent }}>
          <motion.svg animate={{ y: [0, -3, 0] }} transition={{ duration: 1.1, repeat: Infinity }} viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M9 11V6a2 2 0 1 1 4 0v5m0 0V4a2 2 0 1 1 4 0v9m0-2a2 2 0 1 1 4 0v3a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.6-2.8L3 15s1.2-1.2 2.3-.6L9 16" /></motion.svg>
          {step.hint || 'Click the highlighted area to continue'}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-3 mb-3">
        {steps.map((_, k) => (
          <span key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 18 : 6, background: k === i ? theme.accent : border }} />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onClose} className="text-[12px] font-medium mr-auto" style={{ color: cardSub }}>Skip tour</button>
        {i > 0 && (
          <button onClick={() => go(i - 1)} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold"
            style={{ background: dark ? 'rgba(255,255,255,.06)' : 'rgba(15,23,42,.05)', color: cardText }}>Back</button>
        )}
        {interactive
          ? <button onClick={next} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold" style={{ background: dark ? 'rgba(255,255,255,.06)' : 'rgba(15,23,42,.05)', color: cardSub }}>Skip step →</button>
          : <button onClick={next} className="px-4 py-1.5 rounded-lg text-[13px] font-bold" style={{ background: theme.accent, color: dark ? '#06121f' : '#fff' }}>{last ? 'Done' : 'Next'}</button>}
      </div>
    </motion.div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: 'none' }}>
      {rect && rect.width ? (
        <>
          {/* spotlight highlight — darkens everything except the element (animates smoothly) */}
          <div className="absolute rounded-xl pointer-events-none"
            style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD, boxShadow: `0 0 0 9999px ${darkFill}`, border: `2px solid ${theme.accent}`, transition: 'left .35s, top .35s, width .35s, height .35s' }} />
          {interactive ? (
            /* leave the element clickable (hole passes clicks through); block only OUTSIDE */
            <>
              <div className="absolute" style={{ pointerEvents: 'auto', left: 0, top: 0, right: 0, height: Math.max(0, rect.top - PAD) }} onClick={(e) => e.stopPropagation()} />
              <div className="absolute" style={{ pointerEvents: 'auto', left: 0, top: rect.bottom + PAD, right: 0, bottom: 0 }} onClick={(e) => e.stopPropagation()} />
              <div className="absolute" style={{ pointerEvents: 'auto', left: 0, top: rect.top - PAD, width: Math.max(0, rect.left - PAD), height: rect.height + 2 * PAD }} onClick={(e) => e.stopPropagation()} />
              <div className="absolute" style={{ pointerEvents: 'auto', left: rect.right + PAD, top: rect.top - PAD, right: 0, height: rect.height + 2 * PAD }} onClick={(e) => e.stopPropagation()} />
            </>
          ) : (
            /* non-interactive: block the whole screen (use Next) */
            <div className="absolute inset-0" style={{ pointerEvents: 'auto' }} onClick={onClose} />
          )}
        </>
      ) : (
        <div className="absolute inset-0" style={{ pointerEvents: 'auto', background: darkFill }} onClick={onClose} />
      )}

      {/* card: anchored next to the target, or dead-centered when there's no target */}
      {cardBox
        ? <div className="absolute" style={{ top: cardBox.top, left: cardBox.left, pointerEvents: 'auto' }}>{Card}</div>
        : <div className="absolute inset-0 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>{Card}</div>}
    </div>,
    document.body
  );
}

// Tour script. `persona` switches the active tab; `target` is a data-tour selector.
// `interactive: true` requires the user to click the highlighted element to advance.
export const TOUR_STEPS = [
  { tag: 'Welcome', title: 'Welcome to OneGrid', body: 'A quick, hands-on tour of the dashboard — fleet analytics, a live 3D control room, equipment manuals, a governed AI assistant and a OneLake security plane. You can skip anytime.' },
  { tag: 'Navigate', target: '[data-tour="tabs"]', interactive: true, hint: 'Click a tab to switch views', title: 'Four ways to work', body: 'Executive (fleet overview), Control-Room (live 3D / list ops), Maintenance (work & diagnostics) and Ontology (the data model as a graph). Give the tabs a click.' },
  { tag: 'Theme', target: '[data-tour="theme"]', interactive: true, hint: 'Click to flip Light / Dark', title: 'Light or dark', body: 'The whole app switches theme with this toggle — and remembers your choice.' },
  { persona: 'executive', tag: 'Executive', target: '[data-tour="sundial"]', interactive: true, hint: 'Click a wedge to drill into a site', title: 'Fleet Health sundial', body: 'Drill Fleet → Site → Unit → Equipment. Use the Back button, breadcrumb, or center hub to go back up. Try clicking a site wedge.' },
  { persona: 'executive', tag: 'Executive', target: '[data-tour="kpis"]', title: 'Every tile is a shortcut', body: 'Fleet Availability → outages, Critical Assets → the live map, Predicted Risks → survival/stop-probability detail, Open Work Orders → Maintenance.' },
  { persona: 'controlroom', tag: 'Control-Room', target: '[data-tour="cr-breadcrumb"]', interactive: true, hint: 'Try the Map / List toggle', title: 'Map or menu — your choice', body: 'Navigate the fleet as an interactive 3D map, or flip to List for a menu-driven site → equipment picker. Same live tags either way.' },
  { persona: 'maintenance', tag: 'Maintenance', target: '[data-tour="mnt-pills"]', interactive: true, hint: 'Pick a condition filter', title: 'Filter by condition', body: 'Healthy / Watch / Critical pills focus the list. Click an asset for its 3D model, root cause, predictions, work orders — and 👍/👎 to train future models.' },
  { persona: 'maintenance', tag: 'Foundry IQ', target: '[data-tour="mnt-workorders"]', title: 'Resolve with the manual', body: 'Every open work order carries a 📖 Resolve action. Foundry IQ pulls the exact procedure from the equipment manuals — grounded by Azure AI Search — and can hand it straight to the assistant. No more hunting through PDFs.' },
  { persona: 'ontology', tag: 'Ontology', target: '[data-tour="ontology"]', title: 'The data model as a graph', body: 'See how assets, sensors, telemetry, ML scores, advisories, outages and work orders connect. Click a node to focus it, then “Ask AI about the model” to reason across the whole semantic model.' },
  { tag: 'Governance', target: '[data-tour="governance"]', interactive: true, hint: 'Open the governance & security plane', title: 'OneLake security & governance', body: 'The shield opens the governance review plane — OneLake security roles, who can see which data, and open compliance findings across the workspace. Give it a click.' },
  { tag: 'Ask', target: '[data-tour="chat"]', interactive: true, hint: 'Open the chat', title: 'Chat with your data', body: 'Ask in plain language. It stays aware of what you\'re viewing, can search the equipment manuals, switch AI models/providers, and every answer can be rated.' },
  { tag: 'Fabric Data Agent', target: '[data-tour="chat-agent"]', openChat: true, title: 'Governed answers, on demand', body: 'Flip on the Fabric Data Agent and questions are answered by a governed agent that reasons over your published semantic model and writes its own queries — deeper, policy-respecting answers (with a little more thinking time). Off by default.' },
  { tag: 'You\'re set', title: 'That\'s it — you\'re ready', body: 'Re-open this tour anytime from the “?” button in the header. Happy monitoring!' },
];
