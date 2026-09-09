// Foundry IQ knowledge-base access for the OneGrid manuals corpus.
// Retrieval-augmented grounding over ~100 synthetic equipment manuals indexed in Azure AI
// Search (vector + semantic). Powers the chat `search_manuals` tool and the work-order
// "resolve with manual" experience. Embeddings use the Foundry text-embedding deployment
// via the container's managed identity (or an api key); Search uses a query/admin key.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getToken } from './fabric.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CFG = {
  searchEndpoint: (process.env.MANUALS_SEARCH_ENDPOINT || '').replace(/\/$/, ''),
  searchKey: process.env.MANUALS_SEARCH_KEY || '',
  index: process.env.MANUALS_SEARCH_INDEX || 'onegrid-manuals',
  aoaiEndpoint: (process.env.MANUALS_AOAI_ENDPOINT || process.env.AZURE_AI_ENDPOINT || '').replace(/\/$/, ''),
  embed: process.env.MANUALS_EMBED || 'text-embedding-3-large',
  aoaiKey: process.env.MANUALS_AOAI_KEY || process.env.AZURE_AI_KEY || '',
  apiVersion: '2024-07-01',
};

// Azure AI Search + Foundry embeddings power the full hybrid RAG. When they aren't
// configured we fall back to an OFFLINE keyword search over the bundled corpus so the
// "how to fix" manual grounding still works locally (real manual passages, no vectors).
const AZURE_RAG = !!(CFG.searchEndpoint && CFG.searchKey && CFG.aoaiEndpoint);
export function manualsEnabled() {
  return AZURE_RAG || CORPUS.length > 0;
}

// Bundled corpus (source of truth for full-manual viewing + category lookup).
let CORPUS = [];
try {
  CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, 'manuals.json'), 'utf8'));
} catch { CORPUS = []; }

const CATEGORIES = [...new Set(CORPUS.map((m) => m.equipment_category))].sort();

// Map an asset's free-text type/name to one of our manual equipment categories.
export function categoryForAsset({ category, name, assetType } = {}) {
  const hay = `${category || ''} ${assetType || ''} ${name || ''}`.toLowerCase();
  const rules = [
    ['Boiler Feed Pump', /(feed\s*pump|bfp|feedwater pump)/],
    ['Steam Turbine', /(steam turbine|\bstg\b|\bturbine\b)/],
    ['Generator', /(generator|\bgen\b|stator|exciter)/],
    ['Surface Condenser', /(condenser|vacuum|hotwell)/],
    ['Economizer', /(economi[sz]er|\beco\b)/],
    ['Air Preheater', /(air\s*pre\s*heater|preheater|\baph\b|ljung)/],
    ['Feedwater Heater', /(feedwater heater|\bfwh\b|\bhp heater\b|\blp heater\b|deaerat)/],
    ['Control Valve', /(control valve|\bvalve\b|\bcv\b|positioner)/],
    ['Heat Exchanger', /(heat exchanger|\bhx\b|cooler)/],
    ['Boiler', /(boiler|drum|furnace|superheater|\bblr\b)/],
  ];
  for (const [cat, re] of rules) if (re.test(hay)) return cat;
  return null;
}

async function embedQuery(text) {
  const url = `${CFG.aoaiEndpoint}/openai/deployments/${CFG.embed}/embeddings?api-version=2024-02-01`;
  const headers = { 'Content-Type': 'application/json' };
  if (CFG.aoaiKey) headers['api-key'] = CFG.aoaiKey;
  else headers['Authorization'] = `Bearer ${await getToken('https://cognitiveservices.azure.com')}`;
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ input: [text] }) });
  if (!resp.ok) throw new Error(`embed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const j = await resp.json();
  return j.data[0].embedding;
}

// Hybrid (vector + semantic) search over the manuals index, optionally scoped to a category.
export async function searchManuals(query, { category = null, top = 5 } = {}) {
  if (!AZURE_RAG) return offlineSearch(query, { category, top });
  const vector = await embedQuery(query);
  const body = {
    search: query,
    top,
    queryType: 'semantic',
    semanticConfiguration: 'sem',
    vectorQueries: [{ kind: 'vector', vector, fields: 'content_vector', k: 30 }],
    select: 'manual_id,title,manufacturer,model,equipment_category,section,chunk,related_tags',
  };
  if (category) body.filter = `equipment_category eq '${category.replace(/'/g, "''")}'`;
  const resp = await fetch(`${CFG.searchEndpoint}/indexes/${CFG.index}/docs/search?api-version=${CFG.apiVersion}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': CFG.searchKey }, body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`search ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const j = await resp.json();
  return (j.value || []).map((d) => ({
    manual_id: d.manual_id, title: d.title, manufacturer: d.manufacturer, model: d.model,
    category: d.equipment_category, section: d.section, snippet: d.chunk,
    score: d['@search.rerankerScore'] ?? d['@search.score'],
  }));
}

export function listCategories() { return CATEGORIES; }
export function getManual(id) { return CORPUS.find((m) => m.id === id) || null; }
export function manualsForCategory(category) {
  return CORPUS.filter((m) => m.equipment_category === category)
    .map((m) => ({ id: m.id, title: m.title, manufacturer: m.manufacturer, model: m.model, category: m.equipment_category }));
}

// Split a manual's markdown into (section heading, body) chunks on its ## / ### headings.
function splitSections(md) {
  const out = [];
  let cur = { section: 'Overview', body: '' };
  for (const line of String(md || '').split('\n')) {
    const h = line.match(/^#{1,3}\s+(.*\S)\s*$/);
    if (h) {
      if (cur.body.trim()) out.push(cur);
      cur = { section: h[1].replace(/^\d+[.)]\s*/, '').trim(), body: '' };
    } else {
      cur.body += line + '\n';
    }
  }
  if (cur.body.trim()) out.push(cur);
  return out;
}

// Offline grounding: keyword-score the bundled manuals' sections against the problem text,
// boosting a manual whose fault_symptoms/related_tags match and troubleshooting sections.
// Returns the same shape as the Azure search path so callers are identical.
function offlineSearch(query, { category = null, top = 5 } = {}) {
  const terms = [...new Set((String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []))];
  const pool = CORPUS.filter((m) => !category || m.equipment_category === category);
  const scored = [];
  for (const m of pool) {
    const symptomHay = `${(m.fault_symptoms || []).join(' ')} ${(m.related_tags || []).join(' ')}`.toLowerCase();
    const mBoost = terms.reduce((s, t) => s + (symptomHay.includes(t) ? 1 : 0), 0);
    for (const sec of splitSections(m.body_markdown)) {
      const hay = `${sec.section} ${sec.body}`.toLowerCase();
      let score = mBoost;
      for (const t of terms) if (hay.includes(t)) score += 1;
      if (/troubleshoot|fault|diagnos|resolution|corrective|repair|procedure|remed/i.test(sec.section)) score += 2;
      if (score > 0) {
        scored.push({
          manual_id: m.id, title: m.title, manufacturer: m.manufacturer, model: m.model,
          category: m.equipment_category, section: sec.section,
          snippet: sec.body.trim().replace(/\n{3,}/g, '\n\n').slice(0, 700), score,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  // Sparse query with no keyword hits: surface each category manual's troubleshooting section.
  if (!scored.length) {
    for (const m of pool.slice(0, 3)) {
      const ts = splitSections(m.body_markdown).find((s) => /troubleshoot|fault|resolution|corrective/i.test(s.section));
      if (ts) {
        scored.push({
          manual_id: m.id, title: m.title, manufacturer: m.manufacturer, model: m.model,
          category: m.equipment_category, section: ts.section, snippet: ts.body.trim().slice(0, 700), score: 1,
        });
      }
    }
  }
  return scored.slice(0, top);
}

// Resolve the most relevant manual guidance for a work order on a given asset.
export async function resolveForWorkOrder({ category, asset, problem, top = 4 } = {}) {
  const cat = category || categoryForAsset(asset || {});
  const q = (problem && problem.trim()) || `common faults and recommended resolution for a ${cat || 'plant'} asset`;
  const hits = await searchManuals(q, { category: cat, top });
  // Distinct manuals referenced, best snippet first.
  const seen = new Set();
  const manuals = [];
  for (const h of hits) {
    if (seen.has(h.manual_id)) continue;
    seen.add(h.manual_id);
    manuals.push({ id: h.manual_id, title: h.title, manufacturer: h.manufacturer, model: h.model, category: h.category });
  }
  return { category: cat, query: q, manuals, passages: hits };
}
