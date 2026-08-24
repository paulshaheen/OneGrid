import { useState } from 'react';
import { motion } from 'framer-motion';
import { Modal, Pill } from './ui.jsx';

const lvlColor = (l) => (l === 'critical' ? '#ff5470' : l === 'watch' ? '#ffcc4d' : '#2fd07a');

// Compact "morning briefing" — headline + top items, expandable to the full list.
export function BriefingBar({ theme, narrative }) {
  const [open, setOpen] = useState(false);
  if (!narrative) return null;
  const items = narrative.briefing || [];
  const worst = items[0];
  const sigMatch = worst && worst.full ? worst.full.match(/Watch\s+(.+?)\.\s*Worst risk/i) : null;
  const sigCount = sigMatch ? sigMatch[1].split(',').map((x) => x.trim()).filter(Boolean).length : null;
  const signalsOf = (it) => {
    const m = (it.full || it.headline || '').match(/Watch\s+(.+?)(?:\.\s*Worst risk|\.\s*Sources|$)/i);
    return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  };
  const totalSignals = items.reduce((s, it) => s + signalsOf(it).length, 0);
  const status = narrative.system_status || 'OK';
  const sColor = /(crit)/i.test(status) ? '#ff5470' : /(warn|watch|elev)/i.test(status) ? '#ffcc4d' : '#2fd07a';
  const sLevel = /(crit)/i.test(status) ? 'critical' : /(warn|watch|elev)/i.test(status) ? 'watch' : 'ok';

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={`${theme.panel} overflow-hidden`}>
      <div className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
        {/* headline */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <span className="w-2.5 h-2.5 rounded-full block" style={{ background: sColor, boxShadow: `0 0 12px ${sColor}` }} />
            {sLevel !== 'ok' && <span className="absolute inset-0 rounded-full animate-pingslow" style={{ background: sColor }} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${theme.sub}`}>Daily Briefing</span>
              <span className={`text-[10px] ${theme.sub}`}>{narrative.narrative_date}</span>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-bold" style={{ color: sColor }}>{status}</span>
              <span className={`text-xs ${theme.sub}`}>{narrative.critical_alerts} critical · {narrative.total_alerts} alerts · {narrative.assets_flagged} assets</span>
            </div>
          </div>
        </div>
        {/* single top-risk headline (the ranked list lives in Priority Watch below) */}
        {worst && (
          <div className={`flex-1 min-w-0 flex items-center gap-3 px-3.5 py-2.5 rounded-lg ${theme.panelSolid}`}>
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded shrink-0" style={{ background: `${lvlColor(worst.level)}22`, color: lvlColor(worst.level) }}>Top Risk</span>
            <div className="min-w-0">
              <div className={`text-sm font-semibold truncate ${theme.heading}`}>{worst.asset}</div>
              <div className={`text-[11px] truncate ${theme.sub}`}>
                {worst.severity}{sigCount ? ` · ${sigCount} signal${sigCount === 1 ? '' : 's'} in alarm` : ''}
                {` · ${narrative.assets_flagged} asset${narrative.assets_flagged === 1 ? '' : 's'} flagged`}
              </div>
            </div>
          </div>
        )}
        {items.length > 0 && (
          <button onClick={() => setOpen(true)} className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-lg`} style={{ color: theme.accent, background: `${theme.accent}18`, border: `1px solid ${theme.accent}33` }}>
            Full briefing ({narrative.total_alerts || items.length})
          </button>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} theme={theme} size="max-w-5xl">
        <div className="flex flex-col" style={{ height: '92vh' }}>
          <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
            <div>
              <h2 className={`text-xl font-bold ${theme.heading}`}>Daily Briefing · {narrative.narrative_date}</h2>
              <div className={`text-xs mt-0.5 ${theme.sub}`}>{status} · {totalSignals || narrative.total_alerts} signals in alarm across {narrative.assets_flagged} assets</div>
            </div>
            <button onClick={() => setOpen(false)} className={`text-2xl ${theme.sub} hover:opacity-70`}>×</button>
          </div>
          <div className="p-5 overflow-y-auto space-y-3 flex-1">
            {items.map((it, i) => {
              const signals = signalsOf(it);
              return (
                <div key={i} className={`p-4 rounded-xl ${theme.panelSolid}`}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: lvlColor(it.level) }} />
                    <span className={`text-sm font-semibold ${theme.heading}`}>{it.asset}</span>
                    <Pill status={it.level} theme={theme}>{it.severity}</Pill>
                    <span className={`ml-auto text-[11px] ${theme.sub}`}>{signals.length} signal{signals.length === 1 ? '' : 's'}</span>
                  </div>
                  {signals.length ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {signals.map((sig, j) => (
                        <div key={j} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg" style={{ background: theme.persona === 'executive' ? 'rgba(15,23,42,.04)' : 'rgba(255,255,255,.04)' }}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lvlColor(it.level) }} />
                          <span className={`truncate ${theme.heading}`} title={sig}>{sig}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-[13px] ${theme.sub}`}>{it.full || it.headline}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

// Big circular health gauge for the Executive persona.
export function HealthRadial({ theme, value, size = 210, label = 'Fleet Health' }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = size / 2 - 16;
  const circ = 2 * Math.PI * r;
  const color = v >= 85 ? '#2fd07a' : v >= 70 ? '#ffcc4d' : '#ff5470';
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.chart.grid} strokeWidth="12" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ} initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: circ * (1 - v / 100) }} transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ filter: theme.id !== 'executive' ? `drop-shadow(0 0 8px ${color})` : 'none' }} />
      </svg>
      <div className="absolute text-center">
        <div className={`text-4xl font-extrabold tabular-nums ${theme.heading}`}>{Math.round(v)}<span className="text-xl">%</span></div>
        <div className={`text-[11px] uppercase tracking-widest ${theme.sub}`}>{label}</div>
      </div>
    </div>
  );
}
