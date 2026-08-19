import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_GOLDEN_GAMES } from './index';
import { runGoldenGame } from './runner';
import { replayGoldenGame } from './replay';

describe('replayGoldenGame', () => {
  it('imports nothing from vitest, directly or transitively', () => {
    const src = readFileSync(new URL('./replay.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]vitest['"]/);
    expect(src).not.toMatch(/from ['"]\.\/runner['"]/);
  });

  it.each(ALL_GOLDEN_GAMES.map((g) => [g.id, g] as const))(
    '%s — replay ends where the asserting runner ends',
    (_id, game) => {
      const states = replayGoldenGame(game);
      expect(JSON.stringify(states[states.length - 1])).toBe(JSON.stringify(runGoldenGame(game)));
    },
  );

  it.each(ALL_GOLDEN_GAMES.map((g) => [g.id, g] as const))(
    '%s — yields one state per step plus the fixture',
    (_id, game) => {
      expect(replayGoldenGame(game)).toHaveLength(game.steps.length + 1);
    },
  );
});
