import { describe, it } from 'vitest';
import { GAMES } from './games';
import { runGoldenGame } from './runner';

describe('golden games', () => {
  for (const game of GAMES) {
    it(`${game.id}: ${game.title}`, () => { runGoldenGame(game); });
  }
});
