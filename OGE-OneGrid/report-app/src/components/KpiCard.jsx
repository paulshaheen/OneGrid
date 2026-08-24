import { motion } from 'framer-motion';

// A refined, professional KPI card: subtle accent rail, clean typography, optional
// delta + mini trend. No emoji-on-blob. Works across all personas.
export function KpiCard({ theme, label, value, unit, sub, accent, onClick, delay = 0, delta, trend }) {
  const color = accent || theme.accent;
  const clickable = !!onClick;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={clickable ? { y: -3 } : {}}
      onClick={onClick}
      className={`group relative ${theme.card} overflow-hidden ${clickable ? 'cursor-pointer' : ''}`}
    >
      <div className="absolute left-0 top-0 h-full w-[2px]" style={{ background: color }} />
      <div className="p-4 sm:p-5 pl-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow" style={{ color: 'currentColor' }}><span className={theme.sub}>{label}</span></span>
          {clickable && (
            <svg className={`w-3.5 h-3.5 opacity-0 group-hover:opacity-70 transition ${theme.sub}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </div>
        <div className="mt-2.5 flex items-end gap-2">
          <span className={`text-[2rem] sm:text-[2.4rem] leading-none font-bold tabular-nums ${theme.heading}`}>{value}</span>
          {unit && <span className={`text-sm font-medium mb-1 ${theme.sub}`}>{unit}</span>}
          {delta != null && (
            <span className="mb-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: delta >= 0 ? '#2fd07a' : '#ff5470', background: (delta >= 0 ? '#2fd07a' : '#ff5470') + '18' }}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
            </span>
          )}
        </div>
        {sub && <div className={`mt-1.5 text-xs ${theme.sub}`}>{sub}</div>}
        {trend}
      </div>
    </motion.div>
  );
}
