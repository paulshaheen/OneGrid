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

export function manualsEnabled() {
  return !!(CFG.searchEndpoint && CFG.searchKey && CFG.aoaiEndpoint);
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
  if (!manualsEnabled()) throw new Error('Manuals knowledge base is not configured.');
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
