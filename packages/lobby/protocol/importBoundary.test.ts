// The contract, now that this is its own repo: every relative import must
// resolve back inside it. The rule is an allowlist, not a blocklist — a
// blocklist of a consuming game's directories would leave anything *else*
// importable, and an import reaching out of this repo is broken for every
// consumer, not just the one it was written against.
//
// The lift happened on 2026-08-13: `lobby/`, `server/lobby/` and `src/lobby/`
// left Acquire and became `protocol/`, `server/` and `client/` here, carried
// by `git filter-repo` with all fifteen commits. That is why this test's
// history is longer than this repo's directory names are old.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

// import.meta.url, not __dirname: the node vitest project runs ESM.
// One level up from `protocol/` is this repo's root — which, inside a
// consumer, is `vendor/lobby/`. The roots below resolve either way.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const LOBBY_ROOTS = ['protocol', 'server', 'client'].map((p) => resolve(REPO, p));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('every relative import under the lobby resolves back inside the lobby', () => {
  const files = LOBBY_ROOTS.flatMap((root) => sourceFiles(root));
  // Fourteen files: protocol/{protocol,importBoundary.test},
  // server/{handlers,rooms,rooms.test,genericConsumer.test},
  // client/{connection,fakeConnection,identity,identity.test,useLobbyRoom,
  // useLobbyRoom.test,view,view.test}.
  //
  // Exact rather than a floor. The floor was here so an empty walk could not
  // pass vacuously; an exact count also catches a file quietly *leaving* the
  // lobby, which is the failure this directory now exists to prevent — what
  // remains here is precisely what moves to the shared repo.
  //
  // The UI left for src/game/lobby/ on 2026-08-12: it was Acquire's screens,
  // not a themeable kit, and Rail Baron has neither Tailwind nor className.
  //
  // 12 -> 14 on 2026-08-20: client/fakeConnection.ts and
  // client/useLobbyRoom.test.ts, the lobby pass's task 0. Note that
  // `fakeConnection.ts` is shipped source and not a `.test.ts`, deliberately
  // — the games import it from their own suites, so it has to resolve
  // through this package's exports map like anything else, and it is subject
  // to the same import boundary as the code it doubles.
  expect(files.length).toBe(14);

  const offences: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      // `string | undefined` under `noUncheckedIndexedAccess`, which Rail
      // Baron sets and Acquire does not. Shared code has to satisfy the
      // strictest consumer rather than the first one: this line compiled
      // inside Acquire for as long as it existed and failed the moment a
      // second game compiled it.
      const spec = match[1];
      if (spec === undefined || !spec.startsWith('.')) continue; // bare imports are fine
      const target = resolve(dirname(file), spec);
      if (!LOBBY_ROOTS.some((root) => target.startsWith(root + sep)))
        offences.push(`${file} imports ${spec}`);
    }
  }
  expect(offences).toEqual([]);
});
