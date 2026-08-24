import { useState } from 'react';
import { Modal } from './ui.jsx';
import { postJson } from '../lib/api.js';

// Thumbs up/down control. Clicking opens a comment modal; on submit the vote + comment
// is persisted to the Fabric MLFeedback table (POST /api/feedback) for future ML training.
export function Feedback({ theme, itemType, itemRef, asset, tag, persona, context, size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const [vote, setVote] = useState(null);       // 'up' | 'down'
  const [sent, setSent] = useState(null);        // last submitted vote
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const start = (v) => { setVote(v); setComment(''); setOpen(true); };
  const submit = async () => {
    setBusy(true);
    try {
      await postJson('/api/feedback', {
        vote, item_type: itemType, item_ref: itemRef, persona,
        asset_id: asset?.asset_id, plant: asset?.plant, unit: asset?.unit, tag,
        comment, context,
      });
      setSent(vote); setOpen(false);
    } catch (e) { /* keep modal open on error */ }
    setBusy(false);
  };

  const dim = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const Icon = ({ up, filled }) => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      {up
        ? <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm4-7 4 7h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 18.7 21H7V10l4-7z" strokeLinejoin="round" />
        : <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zm-4 7-4-7H4a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 5.3 3H17v11l-4 7z" strokeLinejoin="round" />}
    </svg>
  );

  return (
    <>
      <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button title="Helpful — this is correct" onClick={() => start('up')}
          className={`${dim} grid place-items-center rounded-md transition`}
          style={{ color: sent === 'up' ? '#2fd07a' : '#8ea3bd', background: sent === 'up' ? '#2fd07a1f' : 'transparent' }}>
          <Icon up filled={sent === 'up'} />
        </button>
        <button title="Not helpful — flag for the model" onClick={() => start('down')}
          className={`${dim} grid place-items-center rounded-md transition`}
          style={{ color: sent === 'down' ? '#ff5470' : '#8ea3bd', background: sent === 'down' ? '#ff54701f' : 'transparent' }}>
          <Icon up={false} filled={sent === 'down'} />
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} theme={theme} size="max-w-md">
        <div className="p-5 rounded-2xl" style={{ background: '#0b1220', border: `2px solid ${vote === 'up' ? '#2fd07a' : '#ff5470'}`, boxShadow: `0 24px 70px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04)` }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: vote === 'up' ? '#2fd07a' : '#ff5470', boxShadow: `0 0 8px ${vote === 'up' ? '#2fd07a' : '#ff5470'}` }} />
            <h3 className="text-base font-bold text-white">{vote === 'up' ? 'Confirm this finding' : 'Flag this finding'}</h3>
          </div>
          <p className="text-xs mb-3 text-slate-400">Your feedback trains future model runs. {itemType} · {itemRef ? `"${String(itemRef).slice(0, 80)}"` : ''}</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} autoFocus
            placeholder={vote === 'up' ? 'What made this correct / useful? (optional)' : 'What was wrong or misleading? (optional)'}
            className="w-full rounded-lg p-3 text-sm outline-none text-slate-100 placeholder:text-slate-500"
            style={{ background: '#111c2e', border: '1px solid rgba(255,255,255,.12)' }} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white">Cancel</button>
            <button onClick={submit} disabled={busy}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: vote === 'up' ? '#2fd07a' : '#ff5470', color: '#06121f' }}>{busy ? 'Saving…' : 'Submit feedback'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
