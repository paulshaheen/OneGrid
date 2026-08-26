import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApi, getJson } from '../lib/api.js';
import { SectionTitle, Spinner, Chip } from '../components/ui.jsx';

const SEV = {
  high: { c: '#ff5470', label: 'High' },
  medium: { c: '#f5a524', label: 'Medium' },
  low: { c: '#5aa9ff', label: 'Low' },
  info: { c: '#7c8aa0', label: 'Info' },
};

function SevPill({ severity }) {
  const s = SEV[severity] || SEV.info;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ background: `${s.c}22`, color: s.c, border: `1px solid ${s.c}44` }}>
      <span className="w-2 h-2 rounded-full" style={{ background: s.c }} /> {s.label}
    </span>
  );
}

// Small posture summary badge — used on the Executive page to surface governance.
export function GovernanceBadge({ theme, onOpen }) {
  const { data } = useApi('/api/governance/posture', { pollMs: 120000 });
  if (!data) return null;
  const fc = data.findingCounts || {};
  const high = fc.high || 0;
  const tone = high > 0 ? '#ff5470' : '#2fd07a';
  return (
    <button onClick={onOpen} className={`w-full text-left ${theme.card} px-4 py-2.5 flex items-center gap-3 hover:opacity-90 transition`}>
      <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${tone}1f`, color: tone, border: `1px solid ${tone}55` }}>
        <ShieldIcon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${theme.heading}`}>Governance posture</div>
        <div className={`text-xs ${theme.sub} truncate`}>
          {high > 0 ? `${high} high-severity finding${high > 1 ? 's' : ''}` : 'No high-severity findings'} · {data.totals?.roles ?? 0} OneLake roles
        </div>
      </div>
      <span className={`text-xs font-semibold ${theme.accentText}`}>Review →</span>
    </button>
  );
}

export function ShieldIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9.2 12l2 2 3.6-4" />
    </svg>
  );
}

const TABS = [
  { id: 'posture', label: 'Posture' },
  { id: 'principals', label: 'Who has access' },
  { id: 'resources', label: 'Who can see this' },
  { id: 'changes', label: 'Changes' },
  { id: 'tests', label: 'Policy tests' },
];

export default function Governance({ theme, onClose }) {
  const [tab, setTab] = useState('posture');
  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 lg:px-12 py-6 max-w-[1500px] mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: `${theme.accent}1f`, color: theme.accent, border: `1px solid ${theme.accent}55` }}>
          <ShieldIcon className="w-6 h-6" />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className={`text-lg font-bold ${theme.heading}`}>Governance &amp; OneLake Security</h1>
          <div className={`text-xs ${theme.sub}`}>Who can access what — inventory &amp; explanation over the Fabric workspace, Lakehouse OneLake roles and persona groups.</div>
        </div>
        {onClose && (
          <button onClick={onClose} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${theme.chip} hover:opacity-80`}>Close</button>
        )}
      </div>

      <div className={`${theme.panelSolid} p-3 mb-5 text-[11px] ${theme.sub} flex items-start gap-2`} style={{ borderLeft: `3px solid ${theme.accent}` }}>
        <span className="mt-0.5">ⓘ</span>
        <span>Computed from current grants. Microsoft Fabric / OneLake remain the authoritative enforcement layer — validate sensitive decisions with native access testing. This plane is read-only.</span>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-xl mb-5 w-fit" style={{ background: theme.mode === 'light' ? 'rgba(0,0,0,.04)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`relative px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.id ? '' : `${theme.navText} hover:opacity-100`}`}
            style={tab === t.id ? { color: theme.accent } : {}}>
            {tab === t.id && <motion.span layoutId="govpill" className="absolute inset-0 rounded-lg" style={{ background: `${theme.accent}1f`, border: `1px solid ${theme.accent}55` }} />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'posture' && <PostureTab theme={theme} />}
      {tab === 'principals' && <PrincipalsTab theme={theme} />}
      {tab === 'resources' && <ResourcesTab theme={theme} />}
      {tab === 'changes' && <ChangesTab theme={theme} />}
      {tab === 'tests' && <TestsTab theme={theme} />}

      <NativeControls theme={theme} />
    </div>
  );
}

function PostureTab({ theme }) {
  const { data, loading } = useApi('/api/governance/posture', { pollMs: 60000 });
  if (loading || !data) return <Spinner theme={theme} label="Collecting access inventory…" />;
  const t = data.totals || {};
  const stat = (label, value) => (
    <div className={`${theme.card} p-4`}>
      <div className={`text-2xl font-bold ${theme.heading} tabular-nums`}>{value}</div>
      <div className={`text-xs ${theme.sub}`}>{label}</div>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stat('Principals', t.principals ?? 0)}
        {stat('Resources', t.resources ?? 0)}
        {stat('OneLake roles', t.roles ?? 0)}
        {stat('High findings', data.findingCounts?.high ?? 0)}
      </div>

      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme} right={
          <span className="flex items-center gap-2">
            <Chip theme={theme}>source: {data.source}</Chip>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium"
              style={{ background: data.connected ? '#2fd07a22' : '#f5a52422', color: data.connected ? '#2fd07a' : '#f5a524', border: `1px solid ${data.connected ? '#2fd07a44' : '#f5a52444'}` }}>
              {data.connected ? 'live tenant' : 'local preview'}
            </span>
          </span>
        }>Environment</SectionTitle>
        {!data.connected && (
          <div className={`text-[11px] ${theme.sub} mb-3`}>Showing the bundled sample governance manifest. Live collectors run automatically after a governance-enabled deploy (or when signed in to the deployed tenant).</div>
        )}
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row theme={theme} k="Mode" v={data.mode} />
          <Row theme={theme} k="App identity grant" v={data.appGrant} warn={/member|contributor|admin/i.test(data.appGrant || '')} />
          <Row theme={theme} k="Lakehouse" v={data.lakehouse} />
          <Row theme={theme} k="Generated" v={data.generatedAt || '— (not yet deployed)'} />
          <Row theme={theme} k="Workspace roles" v={data.collectors?.workspaceRoles} />
          <Row theme={theme} k="OneLake roles" v={data.collectors?.onelakeRoles} />
          <Row theme={theme} k="Dataset users" v={data.collectors?.datasetUsers} />
        </div>
      </div>

      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme}>Findings</SectionTitle>
        {(!data.findings || data.findings.length === 0) ? (
          <div className={`text-sm ${theme.sub} py-6 text-center`}>No findings — posture looks clean.</div>
        ) : (
          <div className="space-y-2">
            {data.findings.map((f) => (
              <div key={f.id} className={`${theme.panelSolid} p-3 flex items-start gap-3`}>
                <SevPill severity={f.severity} />
                <div className="min-w-0 flex-1">
                  <div className={`font-semibold text-sm ${theme.heading}`}>{f.title}</div>
                  <div className={`text-xs ${theme.sub} mt-0.5`}>{f.detail}</div>
                  {f.fix && <div className={`text-xs mt-1 ${theme.accentText}`}>Fix: {f.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ theme, k, v, warn }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-black/5">
      <span className={`text-xs uppercase tracking-wide ${theme.sub}`}>{k}</span>
      <span className={`text-sm font-medium text-right ${warn ? '' : theme.heading}`} style={warn ? { color: '#ff5470' } : {}}>{String(v ?? '—')}</span>
    </div>
  );
}

function PrincipalsTab({ theme }) {
  const { data, loading } = useApi('/api/governance/principals');
  const [sel, setSel] = useState(null);
  const [access, setAccess] = useState(null);
  const [explain, setExplain] = useState(null);

  const open = async (id) => {
    setSel(id); setAccess(null); setExplain(null);
    try { setAccess(await getJson(`/api/governance/principals/${encodeURIComponent(id)}`)); } catch (e) { setAccess({ error: String(e.message || e) }); }
  };
  const why = async (resourceId) => {
    try { setExplain(await getJson(`/api/governance/explain?principal=${encodeURIComponent(sel)}&resource=${encodeURIComponent(resourceId)}`)); } catch (e) { setExplain({ error: String(e.message || e) }); }
  };

  if (loading || !data) return <Spinner theme={theme} label="Loading principals…" />;
  const list = data.principals || [];
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme}>Principals ({list.length})</SectionTitle>
        {list.length === 0 ? (
          <div className={`text-sm ${theme.sub} py-6 text-center`}>No principals resolved yet. Configure persona group object IDs and run the governance phase.</div>
        ) : (
          <div className="space-y-2">
            {list.map((p) => (
              <button key={p.id} onClick={() => open(p.id)} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl ${theme.panelSolid} hover:opacity-90 transition ${sel === p.id ? 'ring-1' : ''}`} style={sel === p.id ? { boxShadow: `0 0 0 1px ${theme.accent}` } : {}}>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${theme.heading} truncate`}>{p.displayName}</div>
                  <div className={`text-xs ${theme.sub}`}>{p.type} · {p.sources.join(', ')}</div>
                </div>
                <Chip theme={theme}>{p.resourceCount} resources</Chip>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme}>Effective access</SectionTitle>
        {!sel ? <div className={`text-sm ${theme.sub} py-6 text-center`}>Select a principal to see what they can reach.</div>
          : !access ? <Spinner theme={theme} />
          : access.error ? <div className="text-sm py-6 text-center" style={{ color: '#ff5470' }}>{access.error}</div>
          : (
            <div className="space-y-2">
              {(access.resources || []).length === 0 && <div className={`text-sm ${theme.sub} py-6 text-center`}>No resources reachable.</div>}
              {(access.resources || []).map((r, i) => (
                <div key={i} className={`${theme.panelSolid} p-3`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-xs ${theme.heading} flex-1 min-w-0 truncate`}>{r.resource}</span>
                    <Chip theme={theme}>{r.action}</Chip>
                    <button onClick={() => why(r.resourceId)} className={`text-xs font-semibold ${theme.accentText} hover:opacity-80`}>Why?</button>
                  </div>
                  <div className={`text-xs ${theme.sub} mt-1`}>via {r.via} · {r.inherited} · rows: {r.rowFilter || 'all'} · cols: {r.allowedColumns} · <span style={{ color: r.confidence === 'confirmed' ? '#2fd07a' : '#f5a524' }}>{r.confidence}</span></div>
                </div>
              ))}
            </div>
          )}
        {explain && (
          <div className={`${theme.panelSolid} p-3 mt-3`} style={{ borderLeft: `3px solid ${theme.accent}` }}>
            <div className={`text-xs font-semibold uppercase ${theme.sub} mb-2`}>Grant path</div>
            {explain.error ? <div className="text-xs" style={{ color: '#ff5470' }}>{explain.error}</div> : (
              <ol className="space-y-1">
                {explain.steps.map((s, i) => (
                  <li key={i} className="text-xs flex gap-2"><span className={`font-semibold ${theme.heading} w-28 shrink-0`}>{s.step}</span><span className={theme.sub}>{s.detail}</span></li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResourcesTab({ theme }) {
  const { data, loading } = useApi('/api/governance/resources');
  const [sel, setSel] = useState(null);
  const [who, setWho] = useState(null);
  const open = async (id) => {
    setSel(id); setWho(null);
    try { setWho(await getJson(`/api/governance/resources/${encodeURIComponent(id)}`)); } catch (e) { setWho({ error: String(e.message || e) }); }
  };
  if (loading || !data) return <Spinner theme={theme} label="Loading resources…" />;
  const list = data.resources || [];
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme}>Resources ({list.length})</SectionTitle>
        {list.length === 0 ? <div className={`text-sm ${theme.sub} py-6 text-center`}>No resources resolved yet.</div> : (
          <div className="space-y-2">
            {list.map((r) => (
              <button key={r.resourceId} onClick={() => open(r.resourceId)} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl ${theme.panelSolid} hover:opacity-90 transition`} style={sel === r.resourceId ? { boxShadow: `0 0 0 1px ${theme.accent}` } : {}}>
                <span className={`font-mono text-xs flex-1 min-w-0 truncate ${theme.heading}`}>{r.resource}</span>
                <Chip theme={theme}>{r.source}</Chip>
                <Chip theme={theme}>{r.principals} can see</Chip>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`${theme.panel} p-5`}>
        <SectionTitle theme={theme}>Who can see this</SectionTitle>
        {!sel ? <div className={`text-sm ${theme.sub} py-6 text-center`}>Select a resource.</div>
          : !who ? <Spinner theme={theme} />
          : who.error ? <div className="text-sm py-6 text-center" style={{ color: '#ff5470' }}>{who.error}</div>
          : (
            <div className="space-y-2">
              {(who.principals || []).length === 0 && <div className={`text-sm ${theme.sub} py-6 text-center`}>No principals.</div>}
              {(who.principals || []).map((p, i) => (
                <div key={i} className={`${theme.panelSolid} p-3`}>
                  <div className={`font-semibold text-sm ${theme.heading}`}>{p.displayName}</div>
                  <div className={`text-xs ${theme.sub}`}>{p.type} · via {p.grant?.via} · rows: {p.grant?.rowFilter || 'all'}</div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function ChangesTab({ theme }) {
  const { data, loading } = useApi('/api/governance/changes');
  if (loading || !data) return <Spinner theme={theme} label="Diffing snapshots…" />;
  return (
    <div className={`${theme.panel} p-5`}>
      <SectionTitle theme={theme} right={<Chip theme={theme}>since {data.since || 'first snapshot'}</Chip>}>Access changes</SectionTitle>
      {(!data.changes || data.changes.length === 0) ? (
        <div className={`text-sm ${theme.sub} py-6 text-center`}>No changes since the last snapshot.</div>
      ) : (
        <div className="space-y-2">
          {data.changes.map((c, i) => (
            <div key={i} className={`${theme.panelSolid} p-3 flex items-center gap-3`}>
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: c.type === 'granted' ? '#2fd07a22' : '#ff547022', color: c.type === 'granted' ? '#2fd07a' : '#ff5470' }}>{c.type}</span>
              <span className={`font-mono text-xs ${theme.sub}`}>{c.principalId}</span>
              <span className={theme.sub}>→</span>
              <span className={`font-mono text-xs ${theme.heading} truncate`}>{c.resourceId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TestsTab({ theme }) {
  const { data, loading } = useApi('/api/governance/tests');
  if (loading || !data) return <Spinner theme={theme} label="Loading policy expectations…" />;
  const kindColor = { positive: '#2fd07a', negative: '#ff5470', row: '#5aa9ff' };
  return (
    <div className={`${theme.panel} p-5`}>
      <SectionTitle theme={theme}>Policy expectations</SectionTitle>
      <div className={`text-xs ${theme.sub} mb-3`}>{data.note}</div>
      <div className="space-y-1.5">
        {data.tests.map((t, i) => (
          <div key={i} className={`${theme.panelSolid} p-2.5 flex items-center gap-3`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: kindColor[t.kind] || theme.accent }} />
            <span className={`text-sm font-semibold ${theme.heading} w-52 shrink-0 truncate`}>{t.persona}</span>
            <span className={`text-sm ${theme.sub}`}>{t.expectation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NativeControls({ theme }) {
  const { data } = useApi('/api/governance/posture');
  const ws = data?.workspaceId;
  const links = [
    { label: 'OneLake Catalog — Secure', href: ws ? `https://app.fabric.microsoft.com/groups/${ws}` : 'https://app.fabric.microsoft.com', desc: 'Native OneLake data-access role editor' },
    { label: 'Workspace access', href: ws ? `https://app.fabric.microsoft.com/groups/${ws}/settings` : 'https://app.fabric.microsoft.com', desc: 'Manage workspace roles' },
    { label: 'Microsoft Purview — Audit', href: 'https://purview.microsoft.com', desc: 'Activity & audit log' },
    { label: 'OneLake security docs', href: 'https://learn.microsoft.com/fabric/onelake/security/data-access-control-model', desc: 'Access-control model reference' },
  ];
  return (
    <div className={`${theme.panel} p-5 mt-5`}>
      <SectionTitle theme={theme}>Native controls (authoritative)</SectionTitle>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className={`${theme.panelSolid} p-3 block hover:opacity-90 transition`}>
            <div className={`text-sm font-semibold ${theme.accentText}`}>{l.label} ↗</div>
            <div className={`text-xs ${theme.sub} mt-0.5`}>{l.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
