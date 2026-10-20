#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--root' && args[1])) {
  console.error('Usage: node scripts/verify-esu-integrity.mjs [--root /path/to/integrated/module]');
  process.exit(2);
}
const root = args.length ? path.resolve(args[1]) : packageRoot;
const manifestPath = path.join(packageRoot, 'integration', 'CORE_INTEGRITY.json');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 1 || manifest.algorithm !== 'sha256'
      || !Array.isArray(manifest.files) || manifest.files.length !== 7) {
    throw new Error('Invalid baseline manifest.');
  }
  const seen = new Set();
  let failures = 0;
  for (const entry of manifest.files) {
    const relative = entry.path;
    if (typeof relative !== 'string' || path.isAbsolute(relative)
        || relative.split(/[\\/]/).includes('..') || seen.has(relative)
        || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error('Invalid baseline file entry.');
    }
    seen.add(relative);
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('File escapes module root.');
    try {
      const bytes = fs.readFileSync(filename);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== entry.sha256) {
        failures++;
        console.error('FAIL ' + relative + ' — contents differ from the release baseline.');
        console.error('  expected: ' + entry.sha256);
        console.error('  actual:   ' + actual);
      } else {
        console.log('PASS ' + relative);
      }
    } catch (error) {
      failures++;
      console.error('FAIL ' + relative + ' — ' + error.message);
    }
  }
  console.log('\nBaseline commit: ' + manifest.sourceCommit);
  if (failures) {
    console.error(failures + ' protected file(s) failed. Preserve the baseline; review the changes.');
    process.exitCode = 1;
  } else {
    console.log('All 7 protected files match the supplied ESU Compass release.');
  }
} catch (error) {
  console.error('Integrity verification could not complete: ' + error.message);
  process.exitCode = 2;
}
