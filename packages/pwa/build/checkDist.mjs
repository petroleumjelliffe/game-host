#!/usr/bin/env node
// The artifact-level PWA gate, run as each game's `postbuild` against the
// built dist — never the dev server: the vitest/BASE_URL split has hidden a
// shipped 404 before, and a substitution miss has shipped a literal
// placeholder before (twice in one day; the whole reason `replaceAll` is
// the house rule). Cheap enough to sit inside `npm run build`, which is
// what CI and deploy.sh both run.
//
// Usage: node <path-to>/checkDist.mjs <basePath>   (e.g. /acquire)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2];
if (!base || !base.startsWith('/')) {
  console.error('usage: checkDist.mjs <basePath>  (e.g. /acquire)');
  process.exit(2);
}
const dist = join(process.cwd(), 'dist');
const failures = [];

function read(name) {
  const path = join(dist, name);
  if (!existsSync(path)) {
    failures.push(`${name} missing from dist/`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

const sw = read('sw.js');
if (sw !== null) {
  if (!sw.includes(`'${base}/'`)) failures.push(`sw.js does not carry the base '${base}/'`);
  const leftover = sw.match(/__[A-Z_]+__/);
  if (leftover) failures.push(`sw.js still carries the placeholder ${leftover[0]}`);
}

const manifestText = read('manifest.webmanifest');
if (manifestText !== null) {
  try {
    const manifest = JSON.parse(manifestText);
    for (const field of ['scope', 'start_url', 'id']) {
      if (manifest[field] !== `${base}/`) {
        failures.push(`manifest ${field} is ${JSON.stringify(manifest[field])}, expected "${base}/"`);
      }
    }
  } catch {
    failures.push('manifest.webmanifest is not valid JSON');
  }
}

const html = read('index.html');
if (html !== null) {
  const leftover = html.match(/__[A-Z_]+__/);
  if (leftover) failures.push(`index.html still carries the placeholder ${leftover[0]}`);
  if (!html.includes(`${base}/manifest.webmanifest`)) {
    failures.push(`index.html does not link ${base}/manifest.webmanifest`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ PWA dist check: ${failure}`);
  process.exit(1);
}
console.log(`✓ PWA dist check passed (${base})`);
