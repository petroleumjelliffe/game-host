import { describe, it, expect } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { applyIntent, IllegalIntentError } from '../engine/intents.js';
import type { GameState } from '../engine/gameTypes.js';
import { DRAWS } from '../session/protocol.js';
import { project } from './projection.js';

function twoHands(): GameState {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1', 'B2'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('project', () => {
  it("blanks the seed, the bag, and every hand but the recipient's", () => {
    const projected = project(twoHands(), 'p1');

    expect(projected.seed).toBe('');
    expect(projected.bag).toEqual([]);
    expect(projected.players.find((p) => p.id === 'p1')!.hand).toEqual(['E6', 'H8']);
    expect(projected.players.find((p) => p.id === 'p2')!.hand).toEqual([]);
  });

  it('leaves the source state untouched', () => {
    const state = twoHands();
    project(state, 'p1');

    expect(state.seed).toBe('golden-fixture');
    expect(state.bag).toEqual(['I11', 'I12']);
    expect(state.players[1]!.hand).toEqual(['A1', 'B2']);
  });

  it('keeps what is public', () => {
    const state = twoHands();
    const projected = project(state, 'p1');

    expect(projected.board).toEqual(state.board);
    expect(projected.startups).toEqual(state.startups);
    expect(projected.discarded).toEqual(state.discarded);
    expect(projected.players.map((p) => p.cash)).toEqual([6000, 6000]);
    expect(projected.players.map((p) => p.name)).toEqual(['Alex', 'Sam']);
  });

  it('carries no socketId to anyone', () => {
    const state = twoHands();
    state.players[0]!.socketId = 'sock-1';
    state.players[1]!.socketId = 'sock-2';

    for (const p of project(state, 'p1').players) {
      expect(p.socketId).toBeUndefined();
    }
  });
});

function outcome(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (e) {
    return e instanceof IllegalIntentError ? `rejected:${e.code}` : `threw:${String(e)}`;
  }
}

describe('a projected state reduces exactly like the full one', () => {
  it('the golden corpus holds enough predictable steps to be worth checking', () => {
    const predictable = ALL_GOLDEN_GAMES.flatMap((g) => g.steps).filter(
      (s) => !DRAWS.has(s.intent.type),
    );
    // Measured at 42 when this was written. A floor, not an equality: adding
    // golden games must not break it, but a harness that silently stops
    // finding steps must.
    expect(predictable.length).toBeGreaterThanOrEqual(40);
  });

  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, () => {
      let state = buildFixture(game.setup);

      for (const step of game.steps) {
        const pid = step.intent.playerId;
        const where = `${game.id} / ${step.name}`;

        if (DRAWS.has(step.intent.type)) {
          if (!step.expectError) state = applyIntent(state, step.intent);
          continue;
        }

        const projected = project(state, pid);

        if (step.expectError) {
          expect(outcome(() => applyIntent(projected, step.intent)), where).toBe(
            outcome(() => applyIntent(state, step.intent)),
          );
          continue;
        }

        const next = applyIntent(state, step.intent);
        expect(applyIntent(projected, step.intent), where).toEqual(project(next, pid));
        state = next;
      }
    });
  }
});
