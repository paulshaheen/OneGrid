import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { statusOf } from '../lib/format.js';

export function Modal({ open, onClose, theme, children, size = 'max-w-3xl' }) {
  // Portal to <body> so an ancestor with a transform (framer-motion) / overflow-hidden
  // can never clip or mis-position this fixed overlay (the briefing modal bug).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${theme.overlay}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={`w-full ${size} max-h-[92vh] overflow-hidden ${theme.modal}`}
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function StatusDot({ status, size = 8 }) {
  const s = statusOf(status);
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full" style={{ background: s.color }} />
      {status !== 'ok' && <span className="absolute inset-0 rounded-full animate-pingslow" style={{ background: s.color }} />}
    </span>
  );
}

// Colorblind-safe status glyph: a distinct SHAPE per status (check / triangle / octagon-x)
// so severity is legible without relying on color. Filled shape + white symbol reads in
// grayscale. Use anywhere a bare status dot would otherwise carry meaning by color alone.
export function StatusGlyph({ status, size = 14, title }) {
  const s = statusOf(status);
  const label = title || s.label;
  const common = { width: size, height: size, viewBox: '0 0 24 24', role: 'img', 'aria-label': label };
  if (s.shape === 'check') {
    return (
      <svg {...common} fill="none"><title>{label}</title>
        <circle cx="12" cy="12" r="10" fill={s.color} />
        <path d="M7.5 12.5l3 3 6-6.5" stroke="#06121f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (s.shape === 'triangle') {
    return (
      <svg {...common} fill="none"><title>{label}</title>
        <path d="M12 2.5l10 18H2z" fill={s.color} />
        <path d="M12 9v5" stroke="#3a2c00" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="17.4" r="1.25" fill="#3a2c00" />
      </svg>
    );
  }
  // octagon (critical / stop)
  return (
    <svg {...common} fill="none"><title>{label}</title>
      <path d="M7.6 2.5h8.8L21.5 7.6v8.8L16.4 21.5H7.6L2.5 16.4V7.6z" fill={s.color} />
      <path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Pill({ status, children, theme }) {
  const s = statusOf(status);
  return (
    <span className="eyebrow inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}3a` }}>
      <StatusGlyph status={status} size={12} /> {children || s.label}
    </span>
  );
}

export function Chip({ theme, children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${theme.chip} ${className}`}>{children}</span>;
}

export function SectionTitle({ theme, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="eyebrow" style={{ color: theme.accent }}>{children}</h3>
      {right}
    </div>
  );
}

export function Spinner({ theme, label = 'Loading…' }) {
  return (
    <div className={`flex items-center gap-3 ${theme.sub} text-sm py-10 justify-center`}>
      <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      {label}
    </div>
  );
}
