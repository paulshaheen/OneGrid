import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Styling for rendered manual markdown so it reads like a real O&M manual, not raw .md.
const MANUAL_CSS = `
.manual-body{--mn-bd:rgba(128,148,180,.26)}
.manual-body>*:first-child{margin-top:0}
.manual-body h2{font-size:20px;font-weight:800;line-height:1.25;margin:22px 0 8px;color:var(--mn-accent)}
.manual-body h3{font-size:15.5px;font-weight:700;margin:20px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--mn-bd)}
.manual-body h4{font-size:14px;font-weight:700;margin:16px 0 5px}
.manual-body h5{font-size:13px;font-weight:700;margin:14px 0 5px;color:var(--mn-accent)}
.manual-body p{margin:7px 0;line-height:1.6}
.manual-body ul,.manual-body ol{margin:7px 0;padding-left:22px}
.manual-body ul{list-style:disc}.manual-body ol{list-style:decimal}
.manual-body li{margin:4px 0;line-height:1.55}
.manual-body strong{color:var(--mn-accent);font-weight:650}
.manual-body code{font-family:var(--mono,ui-monospace,monospace);font-size:.88em;background:rgba(128,148,180,.16);padding:1px 5px;border-radius:4px}
.manual-body blockquote{margin:12px 0;padding:9px 13px;border-left:3px solid var(--mn-accent);background:rgba(128,148,180,.10);border-radius:0 8px 8px 0;font-size:.92em;opacity:.9}
.manual-body table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.92em;border:1px solid var(--mn-bd);border-radius:8px;overflow:hidden}
.manual-body thead th{text-align:left;font-weight:700;padding:8px 11px;background:rgba(128,148,180,.14);border-bottom:2px solid var(--mn-bd)}
.manual-body td{padding:7px 11px;border-bottom:1px solid var(--mn-bd);vertical-align:top}
.manual-body tr:last-child td{border-bottom:none}
`;
function ManualStyles() { return <style dangerouslySetInnerHTML={{ __html: MANUAL_CSS }} />; }

// Small markdown -> HTML good enough for the synthetic manuals (headings, bold, lists,
// tables, rules, paragraphs). No external dependency.
export function manualMdToHtml(md) {
  if (!md) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    // table
    if (/^\s*\|/.test(line) && /^\s*\|?[-\s|:]+\|/.test(lines[i + 1] || '')) {
      const head = line.split('|').filter((c) => c.trim() !== '');
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i].split('|').filter((c) => c.trim() !== ''));
        i++;
      }
      html += '<table class="mn-tbl"><thead><tr>' + head.map((h) => `<th>${inline(h.trim())}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { const lvl = h[1].length + 1; html += `<h${lvl}>${inline(h[2])}</h${lvl}>`; i++; continue; }
    if (/^>\s?/.test(line)) { html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      html += '<ul>';
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; }
      html += '</ul>'; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      html += '<ol>';
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; }
      html += '</ol>'; continue;
    }
    html += `<p>${inline(line)}</p>`; i++;
  }
  return html;
}

const overlay = { position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(4,10,20,.62)', backdropFilter: 'blur(2px)', display: 'grid', placeItems: 'center', padding: 16 };

// Full-manual reader.
export function ManualViewer({ theme, id, onClose }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!id) return;
    setM(null); setErr(null);
    fetch(`/api/manuals/item/${encodeURIComponent(id)}`).then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setM(d))).catch((e) => setErr(e.message));
  }, [id]);
  const dark = theme.persona !== 'executive';
  const bg = dark ? '#0d1420' : '#ffffff';
  const text = dark ? '#dbe6f5' : '#0f1b2d';
  const sub = dark ? '#8ea3bd' : '#5b6b82';
  return (
    <AnimatePresence>
      {id && (
        <motion.div style={overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: .96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .97, opacity: 0 }}
            style={{ width: 'min(900px,96vw)', maxHeight: '90vh', overflow: 'auto', background: bg, color: text, border: `1px solid ${theme.accent}44`, borderRadius: 14, padding: '22px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, position: 'sticky', top: -22, background: bg, paddingTop: 4, paddingBottom: 8 }}>
              <div style={{ fontFamily: 'var(--mono,monospace)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.accent }}>Equipment Manual · Foundry IQ</div>
              <button onClick={onClose} style={{ color: sub, fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            {!m && !err && <div style={{ color: sub, padding: 20 }}>Loading manual…</div>}
            {err && <div style={{ color: '#ff6b6b', padding: 20 }}>Could not load manual: {err}</div>}
            {m && <div className="manual-body" style={{ fontSize: 14, lineHeight: 1.6, '--mn-accent': theme.accent }} dangerouslySetInnerHTML={{ __html: manualMdToHtml(m.body_markdown) }} />}
          </motion.div>
        </motion.div>
      )}
      <ManualStyles />
    </AnimatePresence>
  );
}

// "Resolve this work order with the manual" modal.
export function ManualResolveModal({ theme, wo, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openManual, setOpenManual] = useState(null);
  useEffect(() => {
    if (!wo) return;
    setData(null); setErr(null);
    const p = new URLSearchParams();
    p.set('problem', wo.problem_descr || wo.descriptor || '');
    p.set('assetName', wo.parent_descr || wo.location || wo.problem_location || wo.asset_name || '');
    p.set('assetType', wo.wr_type || '');
    fetch(`/api/manuals/resolve?${p.toString()}`).then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d))).catch((e) => setErr(e.message));
  }, [wo]);
  const dark = theme.persona !== 'executive';
  const bg = dark ? '#0d1420' : '#ffffff';
  const surface = dark ? 'rgba(255,255,255,.05)' : '#f4f7fb';
  const text = dark ? '#dbe6f5' : '#0f1b2d';
  const sub = dark ? '#8ea3bd' : '#5b6b82';
  const border = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)';

  const askAssistant = () => {
    const q = `How do I resolve work order ${wo.wr_id || ''}: "${(wo.problem_descr || '').slice(0, 160)}" on ${wo.parent_descr || wo.location || 'this asset'}? Use the equipment manuals.`;
    window.dispatchEvent(new CustomEvent('pm-chat-ask', { detail: { message: q } }));
    onClose();
  };

  return (
    <AnimatePresence>
      {wo && (
        <motion.div style={overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: .96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .97, opacity: 0 }}
            style={{ width: 'min(760px,96vw)', maxHeight: '90vh', overflow: 'auto', background: bg, color: text, border: `1px solid ${theme.accent}44`, borderRadius: 14, padding: '22px 24px' }}>
            <ManualStyles />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--mono,monospace)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.accent }}>Resolve with manual · Foundry IQ</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Work order {wo.wr_id || ''}</div>
                <div style={{ fontSize: 13, color: sub, marginTop: 2 }}>{wo.problem_descr || wo.descriptor}</div>
              </div>
              <button onClick={onClose} style={{ color: sub, fontSize: 22, lineHeight: 1 }}>×</button>
            </div>

            {!data && !err && <div style={{ color: sub, padding: '18px 0' }}>Retrieving relevant manual guidance…</div>}
            {err && <div style={{ color: '#ff6b6b', padding: '18px 0' }}>Could not retrieve guidance: {err}</div>}

            {data && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  {data.category && <span style={{ fontSize: 12, fontWeight: 700, color: theme.accent, background: `${theme.accent}1f`, border: `1px solid ${theme.accent}55`, borderRadius: 999, padding: '3px 10px' }}>{data.category}</span>}
                  <button onClick={askAssistant} style={{ fontSize: 12, fontWeight: 700, color: dark ? '#06121f' : '#fff', background: theme.accent, borderRadius: 8, padding: '5px 12px' }}>Ask the assistant to resolve this →</button>
                </div>

                {data.manuals?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: sub, marginBottom: 6 }}>Relevant manuals</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {data.manuals.map((mn) => (
                        <button key={mn.id} onClick={() => setOpenManual(mn.id)} style={{ textAlign: 'left', background: surface, border: `1px solid ${border}`, borderRadius: 8, padding: '8px 12px', color: text }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{mn.title}</span>
                          <span style={{ display: 'block', fontSize: 11, color: sub, marginTop: 2 }}>{mn.manufacturer} · {mn.model} · open manual →</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: sub, marginBottom: 6 }}>Grounded guidance</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(data.passages || []).slice(0, 3).map((p, k) => (
                    <div key={k} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: theme.accent, marginBottom: 6 }}>{p.section} · <span style={{ color: sub }}>{p.manual_id}</span></div>
                      <div className="manual-body" style={{ fontSize: 13, lineHeight: 1.55, '--mn-accent': theme.accent }} dangerouslySetInnerHTML={{ __html: manualMdToHtml(p.snippet) }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
      <ManualViewer theme={theme} id={openManual} onClose={() => setOpenManual(null)} />
    </AnimatePresence>
  );
}
