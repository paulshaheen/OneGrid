// Build the Azure AI Search knowledge index for the OneGrid manuals corpus.
// Creates a vector + semantic index, chunks each manual, embeds chunks with the Foundry
// text-embedding-3-large deployment, and uploads them. This is the "Foundry IQ knowledge
// base" grounding layer the chat agent and work-order UX retrieve from.
//
// Env:
//   SEARCH_ENDPOINT   e.g. https://<svc>.search.windows.net
//   SEARCH_KEY        admin key
//   SEARCH_INDEX      index name (default: onegrid-manuals)
//   AOAI_ENDPOINT     Foundry endpoint, e.g. https://<acct>.cognitiveservices.azure.com
//   AOAI_EMBED        embedding deployment name (default: text-embedding-3-large)
//   AOAI_TOKEN        AAD bearer token for cognitiveservices (or set AOAI_KEY)
//   AOAI_KEY          optional api key instead of AAD token
// Run: node scripts/index_manuals.js

const fs = require('fs');
const path = require('path');

const SEARCH_ENDPOINT = (process.env.SEARCH_ENDPOINT || '').replace(/\/$/, '');
const SEARCH_KEY = process.env.SEARCH_KEY || '';
const INDEX = process.env.SEARCH_INDEX || 'onegrid-manuals';
const AOAI_ENDPOINT = (process.env.AOAI_ENDPOINT || '').replace(/\/$/, '');
const AOAI_EMBED = process.env.AOAI_EMBED || 'text-embedding-3-large';
const AOAI_TOKEN = process.env.AOAI_TOKEN || '';
const AOAI_KEY = process.env.AOAI_KEY || '';
const API = '2024-07-01';
const DIMS = 3072; // text-embedding-3-large

function aoaiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (AOAI_KEY) h['api-key'] = AOAI_KEY; else h['Authorization'] = `Bearer ${AOAI_TOKEN}`;
  return h;
}
const searchHeaders = () => ({ 'Content-Type': 'application/json', 'api-key': SEARCH_KEY });

async function embed(texts) {
  const url = `${AOAI_ENDPOINT}/openai/deployments/${AOAI_EMBED}/embeddings?api-version=2024-02-01`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const resp = await fetch(url, { method: 'POST', headers: aoaiHeaders(), body: JSON.stringify({ input: texts }) });
    if (resp.status === 429) {
      const ra = parseInt(resp.headers.get('retry-after') || '', 10);
      const wait = (Number.isFinite(ra) ? ra : Math.min(60, 2 ** attempt)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) throw new Error(`embed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const j = await resp.json();
    return j.data.map((d) => d.embedding);
  }
  throw new Error('embed: rate limited after retries');
}

async function createIndex() {
  const body = {
    name: INDEX,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'manual_id', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'manufacturer', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'model', type: 'Edm.String', filterable: true },
      { name: 'equipment_category', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'section', type: 'Edm.String', searchable: true, filterable: true },
      { name: 'chunk', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
      { name: 'related_tags', type: 'Collection(Edm.String)', searchable: true, filterable: true },
      {
        name: 'content_vector', type: 'Collection(Edm.Single)', searchable: true,
        dimensions: DIMS, vectorSearchProfile: 'vprofile',
      },
    ],
    vectorSearch: {
      algorithms: [{ name: 'hnsw', kind: 'hnsw', hnswParameters: { m: 4, efConstruction: 400, metric: 'cosine' } }],
      profiles: [{ name: 'vprofile', algorithm: 'hnsw' }],
    },
    semantic: {
      configurations: [{
        name: 'sem',
        prioritizedFields: {
          titleField: { fieldName: 'title' },
          prioritizedContentFields: [{ fieldName: 'chunk' }],
          prioritizedKeywordsFields: [{ fieldName: 'equipment_category' }],
        },
      }],
    },
  };
  const resp = await fetch(`${SEARCH_ENDPOINT}/indexes/${INDEX}?api-version=${API}`, {
    method: 'PUT', headers: searchHeaders(), body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`createIndex ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  console.log('index created/updated:', INDEX);
}

// Split a manual body into section-aware chunks (~1800 chars, 200 overlap).
function chunkManual(m) {
  const out = [];
  const parts = m.body_markdown.split(/\n(?=## )/); // by top-level section
  for (const p of parts) {
    const secMatch = p.match(/^#{1,3}\s*(.+)/);
    const section = secMatch ? secMatch[1].replace(/^[0-9. ]+/, '').trim() : 'General';
    const text = p.trim();
    const MAX = 1800, OV = 200;
    if (text.length <= MAX) { out.push({ section, chunk: text }); continue; }
    for (let i = 0; i < text.length; i += (MAX - OV)) out.push({ section, chunk: text.slice(i, i + MAX) });
  }
  return out;
}

async function uploadBatch(docs) {
  const resp = await fetch(`${SEARCH_ENDPOINT}/indexes/${INDEX}/docs/index?api-version=${API}`, {
    method: 'POST', headers: searchHeaders(), body: JSON.stringify({ value: docs }),
  });
  if (!resp.ok) throw new Error(`upload ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
}

(async () => {
  if (!SEARCH_ENDPOINT || !SEARCH_KEY || !AOAI_ENDPOINT || (!AOAI_TOKEN && !AOAI_KEY)) {
    throw new Error('Missing env: SEARCH_ENDPOINT/SEARCH_KEY/AOAI_ENDPOINT/(AOAI_TOKEN|AOAI_KEY)');
  }
  const manuals = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'corpus', 'manuals.json'), 'utf8'));
  await createIndex();

  // Build all chunks
  const chunks = [];
  for (const m of manuals) {
    chunkManual(m).forEach((c, i) => chunks.push({
      id: `${m.id}-${i}`, manual_id: m.id, title: m.title, manufacturer: m.manufacturer,
      model: m.model, equipment_category: m.equipment_category, section: c.section,
      chunk: c.chunk, related_tags: m.related_tags,
    }));
  }
  console.log(`chunks: ${chunks.length} from ${manuals.length} manuals`);

  // Embed + upload in batches
  const B = 16;
  let done = 0;
  for (let i = 0; i < chunks.length; i += B) {
    const batch = chunks.slice(i, i + B);
    const vecs = await embed(batch.map((c) => `${c.section}\n${c.chunk}`));
    batch.forEach((c, k) => { c.content_vector = vecs[k]; c['@search.action'] = 'mergeOrUpload'; });
    await uploadBatch(batch);
    done += batch.length;
    if (done % 96 === 0 || done === chunks.length) console.log(`  indexed ${done}/${chunks.length}`);
  }
  console.log('DONE. Index:', INDEX);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
