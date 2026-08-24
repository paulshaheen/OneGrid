// Two global visual MODES — Light and Dark — aligned to the OneGrid design language
// (the public OneGrid-Site theme): deep navy grounds, a single restrained Azure accent,
// blue-tinted hairline borders, subtle graphite surfaces (no heavy glass/neon), Fluent-2
// typography and specific radii. Each mode keeps id/persona = 'executive'/'controlroom'
// so existing light-vs-dark checks (theme.persona === 'executive', theme.id === …) work.
export const MODES = {
  light: {
    id: 'executive', mode: 'light', name: 'Light', persona: 'executive',
    app: 'bg-[#eef1f6] text-[#1e293b]',
    appStyle: { background: '#eef1f6' },
    nav: 'bg-white border-b border-[rgba(15,23,42,0.10)]',
    navText: 'text-[#5b6b82]', navActive: 'text-[#0b3a86]',
    panel: 'bg-white border border-[rgba(15,23,42,0.11)] rounded-[10px]',
    panelSolid: 'bg-white border border-[rgba(15,23,42,0.11)] rounded-[8px]',
    card: 'bg-white border border-[rgba(15,23,42,0.11)] rounded-[10px]',
    heading: 'text-[#0f1b2d]', sub: 'text-[#5b6b82]',
    accent: '#0b6fe8', accentText: 'text-[#0b6fe8]',
    chip: 'bg-[#eef2f8] text-[#5b6b82] border border-[rgba(15,23,42,0.12)]',
    gridClass: '',
    modal: 'bg-white border border-[rgba(15,23,42,0.12)] rounded-[12px] shadow-xl',
    overlay: 'bg-[#0a1020]/30',
    chart: { grid: '#e4e8ef', axis: '#94a3b8', series: ['#0b6fe8', '#2f9e6e', '#c98a12', '#e2494d', '#7c5cf0'] },
    three: { bg: '#e6eaf1', fog: ['#e6eaf1', 70, 260], env: 'city', ground: '#d5dded', emissive: 0.28, bloom: 0.2, ambient: 0.95, sun: 1.15 },
  },
  dark: {
    id: 'controlroom', mode: 'dark', name: 'Dark', persona: 'controlroom',
    app: 'text-[#aeb9cd]',
    appStyle: { background: '#0a0f1a' },
    nav: 'bg-[#0c121e] border-b border-[rgba(120,160,255,0.10)]',
    navText: 'text-[#7d89a1]', navActive: 'text-[#3f96ff]',
    panel: 'bg-[#0f1522] border border-[rgba(120,160,255,0.10)] rounded-[10px]',
    panelSolid: 'bg-[#0f1522] border border-[rgba(120,160,255,0.10)] rounded-[8px]',
    card: 'bg-[#0f1522] border border-[rgba(120,160,255,0.09)] rounded-[10px]',
    heading: 'text-[#f5f8fd]', sub: 'text-[#7d89a1]',
    accent: '#3f96ff', accentText: 'text-[#3f96ff]',
    chip: 'bg-[#141c2c] text-[#aeb9cd] border border-[rgba(120,160,255,0.14)]',
    gridClass: 'ops-grid',
    modal: 'bg-[#0f1522] border border-[rgba(120,160,255,0.16)] rounded-[12px] shadow-2xl',
    overlay: 'bg-[#05070c]/70',
    chart: { grid: 'rgba(120,160,255,.09)', axis: '#5b7085', series: ['#3f96ff', '#3fd08a', '#f0b429', '#ff5a5f', '#a986ff'] },
    three: { bg: '#0a0f1a', fog: ['#0a0f1a', 70, 260], env: 'night', ground: '#0d1420', emissive: 0.4, bloom: 0.35, ambient: 0.42, sun: 0.9 },
  },
};

// The three persona TABS drive layout + content only (colours come from the active MODE).
export const PERSONAS = [
  { id: 'executive', name: 'Executive', tagline: 'Fleet performance at a glance' },
  { id: 'controlroom', name: 'Control-Room', tagline: 'Live mission-control operations' },
  { id: 'maintenance', name: 'Maintenance', tagline: 'Critical issues & work orders' },
  { id: 'ontology', name: 'Ontology', tagline: 'Knowledge graph of the data model' },
];

// Back-compat: some code still imports THEMES keyed by persona id.
export const THEMES = { executive: MODES.light, controlroom: MODES.dark, maintenance: MODES.dark };
export const THEME_LIST = PERSONAS;
