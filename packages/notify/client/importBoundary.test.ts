// The client half's contract, same shape as the lobby's: every relative
// import under client/ resolves back inside client/. The rest of this
// package is server plumbing — node timers, node crypto, the file store —
// and one stray import would put nodemailer in a game's bundle. The rule
// is an allowlist with an exact file count, so a file quietly leaving (or
// a server file quietly arriving) names itself.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const CLIENT = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('every relative import under client/ resolves back inside client/', () => {
  const files = sourceFiles(CLIENT);
  // Thirteen files: api, api.test, importBoundary.test, invites, landing,
  // playerKey, push, pushSubscription, useContacts, useEnrollPush,
  // useNotifyBind, useNotifyStatus, useNotifyStatus.test. Exact, not a
  // floor, per the lobby's reasoning: a file leaving or a server file
  // arriving should both name themselves here.
  expect(files.length).toBe(13);

  const offences: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec === undefined || !spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(CLIENT.replace(/[/\\]$/, '') + sep)) {
        offences.push(`${file} imports ${spec}`);
      }
    }
  }
  expect(offences).toEqual([]);
});
