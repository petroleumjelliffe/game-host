// server/gamesDir.test.ts
// Where rooms are persisted, which on Render decides whether they survive a
// restart at all.
//
// The file store was always durable; it was writing to the instance's
// ephemeral filesystem, which is not. `GAMES_DIR` is what points it at a
// mounted disk, so getting this wrong is the difference between "a deploy
// loses every room" and "it does not" — with no test failing either way,
// because nothing else reads it.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { gamesDir } from './index.js';

describe('gamesDir', () => {
  it('falls back to server/games when nothing is configured', () => {
    expect(gamesDir({})).toBe(join(process.cwd(), 'server', 'games'));
  });

  it('uses GAMES_DIR when it is set, so a mounted disk can be pointed at', () => {
    expect(gamesDir({ GAMES_DIR: '/var/data/games' })).toBe('/var/data/games');
  });

  it('treats a blank or whitespace GAMES_DIR as unset', () => {
    // An env var set to the empty string is how a dashboard "clears" one, and
    // `''` is falsy but `'   '` is not — a service that persisted rooms to a
    // directory literally named "   " would look like it was working.
    expect(gamesDir({ GAMES_DIR: '' })).toBe(join(process.cwd(), 'server', 'games'));
    expect(gamesDir({ GAMES_DIR: '   ' })).toBe(join(process.cwd(), 'server', 'games'));
  });
});
