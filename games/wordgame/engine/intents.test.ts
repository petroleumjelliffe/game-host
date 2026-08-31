import { applyIntent, IllegalIntentError, type Intent } from './intents';
import { getCurrentActor } from './actor';
import { parseCoord } from './board';
import type { GameState } from './gameTypes';
import { fixtureDict, makeState, place, placeWord, setBoardWord, tiles } from './testHelpers';

const dict = fixtureDict('HAT', 'CAT', 'AT', 'BE', 'AN', 'BA', 'EN');

function codeOf(state: GameState, intent: Intent): string {
  try {
    applyIntent(state, intent, dict);
    return 'no-error';
  } catch (error) {
    if (error instanceof IllegalIntentError) return error.code;
    throw error;
  }
}

describe('turn and stage gates', () => {
  it('rejects every intent kind once the game is over', () => {
    const state = makeState({ stage: 'over' });
    expect(codeOf(state, { type: 'pass', playerId: 'p1' })).toBe('gameOver');
    expect(codeOf(state, { type: 'exchange', playerId: 'p1', tiles: tiles('A') })).toBe('gameOver');
    expect(
      codeOf(state, { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') }),
    ).toBe('gameOver');
  });

  it('rejects a player acting out of turn', () => {
    const state = makeState(); // turnIndex 0 → p1 to act
    expect(codeOf(state, { type: 'pass', playerId: 'p2' })).toBe('notYourTurn');
    expect(codeOf(state, { type: 'pass', playerId: 'nobody' })).toBe('notYourTurn');
  });
});

describe('play intent shape', () => {
  it('rejects an empty placement list', () => {
    expect(codeOf(makeState(), { type: 'play', playerId: 'p1', placements: [] })).toBe('badIntent');
  });

  it('rejects positions off the board', () => {
    const state = makeState();
    expect(codeOf(state, { type: 'play', playerId: 'p1', placements: [{ pos: 225, tile: 'A' }] })).toBe('badIntent');
    expect(codeOf(state, { type: 'play', playerId: 'p1', placements: [{ pos: -1, tile: 'A' }] })).toBe('badIntent');
    expect(codeOf(state, { type: 'play', playerId: 'p1', placements: [{ pos: 12.5, tile: 'A' }] })).toBe('badIntent');
  });

  it('rejects a blank without a declared letter', () => {
    const state = makeState();
    state.players[0]!.rack = tiles('_AXXXXX');
    expect(
      codeOf(state, {
        type: 'play',
        playerId: 'p1',
        placements: [place('H8', '_'), place('I8', 'A')],
      }),
    ).toBe('badIntent');
  });

  it('rejects tiles the rack does not hold, counting duplicates', () => {
    const state = makeState();
    state.players[0]!.rack = tiles('AEBCDFG'); // one E only
    expect(
      codeOf(state, {
        type: 'play',
        playerId: 'p1',
        // Needs two E's.
        placements: [place('G8', 'E'), place('H8', 'E')],
      }),
    ).toBe('notInRack');
  });

  it('rejects a blank the rack does not hold', () => {
    const state = makeState(); // rack ABCDEFG, no blank
    expect(
      codeOf(state, {
        type: 'play',
        playerId: 'p1',
        placements: [place('H8', '_', 'A'), place('I8', 'B')],
      }),
    ).toBe('notInRack');
  });
});

describe('invalid words', () => {
  it('lists every offending word and leaves the state untouched', () => {
    // Board BE across G8–H8; playing QX under it forms QX, BQ and EX — none
    // of which the fixture dictionary has.
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'BE');
    state.players[0]!.rack = tiles('QXABCDE');
    const before = structuredClone(state);
    try {
      applyIntent(
        state,
        { type: 'play', playerId: 'p1', placements: [place('G9', 'Q'), place('H9', 'X')] },
        dict,
      );
      expect.unreachable('the play should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalIntentError);
      if (error instanceof IllegalIntentError) {
        expect(error.code).toBe('invalidWord');
        expect(error.words).toEqual(['QX', 'BQ', 'EX']);
        expect(error.message).toContain('QX');
      }
    }
    expect(state).toEqual(before);
  });

  it('rejects a play whose main word is fine but a crossword is not', () => {
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'BE');
    state.players[0]!.rack = tiles('ANXXXXX');
    // AN is in the dictionary; drop EN from a narrower fixture so the
    // crossword fails while the main word passes.
    const narrow = fixtureDict('AN', 'BA');
    try {
      applyIntent(
        state,
        { type: 'play', playerId: 'p1', placements: placeWord('G9', 'row', 'AN') },
        narrow,
      );
      expect.unreachable('the crossword should have failed');
    } catch (error) {
      if (error instanceof IllegalIntentError) {
        expect(error.code).toBe('invalidWord');
        expect(error.words).toEqual(['EN']);
      } else {
        throw error;
      }
    }
  });
});

describe('a successful play', () => {
  it('never mutates the input state', () => {
    const state = makeState();
    state.players[0]!.rack = tiles('HATXXXX');
    const before = structuredClone(state);
    applyIntent(state, { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') }, dict);
    expect(state).toEqual(before);
  });

  it('places tiles, spends the rack, refills from the bag front, logs, and advances', () => {
    const state = makeState({ bag: tiles('QUIZOTS') });
    state.players[0]!.rack = tiles('HATBCDE');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') },
      dict,
    );
    expect(next.board[parseCoord('G8')]).toEqual({ letter: 'H', isBlank: false });
    // B, C, D, E kept; Q, U, I drawn in bag order.
    expect(next.players[0]?.rack).toEqual(tiles('BCDEQUI'));
    expect(next.bag).toEqual(tiles('ZOTS'));
    expect(next.players[0]?.score).toBe(12);
    expect(next.log).toEqual([
      {
        playerId: 'p1',
        kind: 'play',
        words: [{ word: 'HAT', score: 12 }],
        score: 12,
        tilesPlayed: 3,
        bingo: false,
      },
    ]);
    expect(next.moveCount).toBe(1);
    expect(next.turnIndex).toBe(1);
    expect(getCurrentActor(next)).toBe('p2');
  });

  it('a scoring play resets the scoreless counter', () => {
    const state = makeState({ scorelessTurns: 3 });
    state.players[0]!.rack = tiles('HATXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') },
      dict,
    );
    expect(next.scorelessTurns).toBe(0);
  });

  it('spends a blank as a blank and commits it as its declared letter', () => {
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'A');
    state.players[0]!.rack = tiles('_BCDEFG');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('H8', '_', 'T')] },
      dict,
    );
    expect(next.board[parseCoord('H8')]).toEqual({ letter: 'T', isBlank: true });
    expect(next.players[0]?.rack).not.toContain('_');
  });
});

describe('exchange', () => {
  it('is blocked when the bag holds fewer than 7 tiles', () => {
    const state = makeState({ bag: tiles('ABCDEF') }); // 6
    expect(codeOf(state, { type: 'exchange', playerId: 'p1', tiles: tiles('A') })).toBe('exchangeBlocked');
  });

  it('is allowed when the bag holds exactly 7', () => {
    const state = makeState({ bag: tiles('ABCDEFG') });
    state.players[0]!.rack = tiles('QZXJKVW');
    const next = applyIntent(state, { type: 'exchange', playerId: 'p1', tiles: tiles('QZ') }, dict);
    // Replacements come off the bag front (A, B) BEFORE the exchanged tiles
    // go back — Q and Z cannot be their own replacements.
    expect(next.players[0]?.rack).toEqual(tiles('XJKVWAB'));
    expect(next.bag).toHaveLength(7);
    expect([...next.bag].sort()).toEqual(tiles('CDEFGQZ').sort());
    expect(next.players[0]?.score).toBe(0);
    expect(next.scorelessTurns).toBe(1);
    expect(next.moveCount).toBe(1);
    expect(next.turnIndex).toBe(1);
    expect(next.log).toEqual([
      { playerId: 'p1', kind: 'exchange', score: 0, tilesPlayed: 2 },
    ]);
  });

  it('is deterministic: the same state and intent give the identical result', () => {
    const state = makeState({ bag: tiles('ABCDEFGHIJ'), moveCount: 4 });
    const intent: Intent = { type: 'exchange', playerId: 'p1', tiles: tiles('AB') };
    expect(applyIntent(state, intent, dict)).toEqual(applyIntent(state, intent, dict));
  });

  it('rejects tiles not in the rack, and an empty exchange', () => {
    const state = makeState({ bag: tiles('ABCDEFG') });
    expect(codeOf(state, { type: 'exchange', playerId: 'p1', tiles: tiles('Z') })).toBe('notInRack');
    expect(codeOf(state, { type: 'exchange', playerId: 'p1', tiles: [] })).toBe('badIntent');
  });

  it('can exchange the whole rack when the bag allows', () => {
    const state = makeState({ bag: tiles('OOOOOOO') });
    state.players[0]!.rack = tiles('ABCDEFG');
    const next = applyIntent(
      state,
      { type: 'exchange', playerId: 'p1', tiles: tiles('ABCDEFG') },
      dict,
    );
    expect(next.players[0]?.rack).toEqual(tiles('OOOOOOO'));
    expect([...next.bag].sort()).toEqual(tiles('ABCDEFG').sort());
  });
});

describe('pass', () => {
  it('logs, counts a scoreless turn, and advances', () => {
    const state = makeState({ scorelessTurns: 2, moveCount: 5 });
    const next = applyIntent(state, { type: 'pass', playerId: 'p1' }, dict);
    expect(next.log).toEqual([{ playerId: 'p1', kind: 'pass', score: 0 }]);
    expect(next.scorelessTurns).toBe(3);
    expect(next.moveCount).toBe(6);
    expect(next.turnIndex).toBe(1);
    expect(next.stage).toBe('playing');
  });

  it('wraps the rotation back to the first player', () => {
    const state = makeState({ turnIndex: 1 });
    const next = applyIntent(state, { type: 'pass', playerId: 'p2' }, dict);
    expect(next.turnIndex).toBe(0);
  });
});
