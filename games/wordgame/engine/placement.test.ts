import { applyIntent, IllegalIntentError, type Intent } from './intents';
import { validatePlacement } from './placement';
import { parseCoord } from './board';
import { fixtureDict, makeState, place, setBoardWord, tiles } from './testHelpers';
import type { GameState } from './gameTypes';

// A dictionary generous enough that only *placement* can fail these tests.
const dict = fixtureDict('AB', 'AT', 'CAT', 'CATS', 'DO', 'HAT', 'BAD');

function expectRejection(state: GameState, intent: Intent, code: string, messagePart?: string): void {
  try {
    applyIntent(state, intent, dict);
    expect.unreachable('intent should have been rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(IllegalIntentError);
    if (error instanceof IllegalIntentError) {
      expect(error.code).toBe(code);
      if (messagePart !== undefined) expect(error.message).toContain(messagePart);
    }
  }
}

describe('first-move placement rules', () => {
  it('rejects a first move that misses the center square', () => {
    const state = makeState();
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('A1', 'A'), place('B1', 'B')] },
      'badPlacement',
      'center',
    );
  });

  it('rejects a first move of a single tile', () => {
    const state = makeState();
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('H8', 'A')] },
      'badPlacement',
      'two tiles',
    );
  });

  it('accepts a two-tile first move through the center', () => {
    const state = makeState();
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('H8', 'A'), place('I8', 'B')] },
      dict,
    );
    expect(next.board[parseCoord('H8')]).toEqual({ letter: 'A', isBlank: false });
    expect(next.board[parseCoord('I8')]).toEqual({ letter: 'B', isBlank: false });
  });
});

describe('geometry rules after the first move', () => {
  // Board with CAT along row 8 at F8–H8.
  function midGame(): GameState {
    const state = makeState();
    setBoardWord(state.board, 'F8', 'row', 'CAT');
    return state;
  }

  it('rejects tiles not in a single row or column', () => {
    const state = midGame();
    state.players[0]!.rack = tiles('ABCDEFG');
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('I8', 'A'), place('J9', 'B')] },
      'badPlacement',
      'single row',
    );
  });

  it('rejects a gap that no existing tile fills', () => {
    const state = midGame();
    expectRejection(
      state,
      // I8 touches CAT; K8 leaves J8 empty between them.
      { type: 'play', playerId: 'p1', placements: [place('I8', 'A'), place('K8', 'B')] },
      'badPlacement',
      'gap',
    );
  });

  it('rejects a disconnected placement', () => {
    const state = midGame();
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('A1', 'D'), place('B1', 'A')] },
      'badPlacement',
      'connect',
    );
  });

  it('rejects placing on an occupied square', () => {
    const state = midGame();
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'A')] },
      'badPlacement',
      'occupied',
    );
  });

  it('rejects two placements on the same square', () => {
    const state = midGame();
    expectRejection(
      state,
      { type: 'play', playerId: 'p1', placements: [place('I8', 'A'), place('I8', 'B')] },
      'badPlacement',
      'share a square',
    );
  });

  it('accepts a play whose gap is filled by an existing tile', () => {
    // Board holds only A at G8; play C at F8 and T at H8 — the word reads
    // C(F8) A(G8) T(H8), the existing A bridging the two new tiles.
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'A');
    state.players[0]!.rack = tiles('CTXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('F8', 'C'), place('H8', 'T')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'CAT', score: expect.any(Number) as number }]);
  });

  it('accepts a single connected tile after the first move', () => {
    const state = midGame(); // CAT at F8–H8
    state.players[0]!.rack = tiles('SXXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('I8', 'S')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'CATS', score: expect.any(Number) as number }]);
  });
});

describe('validatePlacement directly', () => {
  it('reports the axis and sorted positions', () => {
    const state = makeState();
    setBoardWord(state.board, 'H8', 'col', 'A');
    const line = validatePlacement(
      state.board,
      [parseCoord('H9'), parseCoord('H7')],
      false,
    );
    expect(line.axis).toBe('col');
    expect(line.positions).toEqual([parseCoord('H7'), parseCoord('H9')]);
  });

  it('calls a lone tile a row and lets word finding sort out the axis', () => {
    const state = makeState();
    setBoardWord(state.board, 'H7', 'row', 'A');
    const line = validatePlacement(state.board, [parseCoord('H8')], false);
    expect(line.axis).toBe('row');
  });
});
