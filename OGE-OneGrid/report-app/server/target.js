// Resolve which Fabric workspace / dataset / eventhouse the report queries.
// Order: env vars > repo last-deploy-state.json (+config.json) > local target.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..'); // PredictiveMaintenanceSolution

function readJsonLoose(file) {
  const buf = fs.readFileSync(file);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.slice(3).toString('utf8');
  else text = buf.toString('utf8');
  return JSON.parse(text);
}

export function resolveTarget() {
  const t = {
    workspaceId: process.env.PBI_WORKSPACE || '',
    datasetId: process.env.PBI_DATASET || '',
    kustoUri: process.env.KUSTO_CLUSTER || '',
    kqlDatabase: process.env.KUSTO_DATABASE || 'pi-realtime-db',
  };

  // From the repo's last-deploy-state.json (written at the end of a deploy).
  try {
    const s = readJsonLoose(path.join(REPO_ROOT, 'last-deploy-state.json'));
    t.workspaceId ||= s.WorkspaceId || '';
    t.datasetId ||= s.DatasetId || '';
    t.kustoUri ||= s.KustoUri || '';
  } catch {}
  try {
    const c = readJsonLoose(path.join(REPO_ROOT, 'config.json'));
    t.kqlDatabase ||= (c.fabric && c.fabric.kqlDatabaseName) || t.kqlDatabase;
  } catch {}

  // Local override / fallback (known-good workspace for dev).
  try {
    const local = readJsonLoose(path.join(__dirname, 'target.json'));
    t.workspaceId ||= local.workspaceId || '';
    t.datasetId ||= local.datasetId || '';
    t.kustoUri ||= local.kustoUri || '';
    t.kqlDatabase ||= local.kqlDatabase || t.kqlDatabase;
  } catch {}

  return t;
}
