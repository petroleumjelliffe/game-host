// The extraction's contract: these directories are game-agnostic, so the lift
// to a second game is a `git mv`. The rule is an allowlist, not a blocklist:
// every relative import must resolve back inside the lobby directories. A
// blocklist of engine/session/src-game would leave server/room.ts and
// src/net/ importable — a GameRoom import in handlers.ts would pass the gate
// while breaking exactly what the gate guards.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

// import.meta.url, not __dirname: the node vitest project runs ESM.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const LOBBY_ROOTS = ['lobby', 'server/lobby', 'src/lobby'].map((p) => resolve(REPO, p));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('every relative import under the lobby resolves back inside the lobby', () => {
  const files = LOBBY_ROOTS.flatMap((root) => sourceFiles(root));
  // Nine files: lobby/{protocol,importBoundary.test},
  // server/lobby/{handlers,rooms,genericConsumer.test},
  // src/lobby/{connection,identity,identity.test,useLobbyRoom}.
  //
  // Exact rather than a floor. The floor was here so an empty walk could not
  // pass vacuously; an exact count also catches a file quietly *leaving* the
  // lobby, which is the failure this directory now exists to prevent — what
  // remains here is precisely what moves to the shared repo.
  //
  // The UI left for src/game/lobby/ on 2026-08-12: it was Acquire's screens,
  // not a themeable kit, and Rail Baron has neither Tailwind nor className.
  expect(files.length).toBe(9);

  const offences: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue; // bare imports (react, socket.io) are fine
      const target = resolve(dirname(file), spec);
      if (!LOBBY_ROOTS.some((root) => target.startsWith(root + sep)))
        offences.push(`${file} imports ${spec}`);
    }
  }
  expect(offences).toEqual([]);
});
