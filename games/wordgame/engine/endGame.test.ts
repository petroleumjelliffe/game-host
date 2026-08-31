import { applyIntent, type Intent } from './intents';
import { getCurrentActor } from './actor';
import type { GameState } from './gameTypes';
import { fixtureDict, makeState, place, setBoardWord, tiles } from './testHelpers';

const dict = fixtureDict('CAT', 'AT');

describe('six consecutive scoreless turns', () => {
  it('ends the game on the sixth pass, deducting rack values', () => {
    // p1 holds A (1 point), score 10; p2 holds Q (10 points), score 5.
    let state: GameState = makeState();
    state.players[0]!.rack = tiles('A');
    state.players[0]!.score = 10;
    state.players[1]!.rack = tiles('Q');
    state.players[1]!.score = 5;

    for (let i = 0; i < 5; i++) {
      const actor = getCurrentActor(state);
      expect(actor).not.toBeNull();
      if (actor === null) return;
      state = applyIntent(state, { type: 'pass', playerId: actor }, dict);
      expect(state.stage).toBe('playing'); // not over yet
    }
    const actor = getCurrentActor(state);
    expect(actor).toBe('p2'); // sixth pass is p2's
    state = applyIntent(state, { type: 'pass', playerId: 'p2' }, dict);

    expect(state.stage).toBe('over');
    expect(getCurrentActor(state)).toBeNull();
    // Final: p1 = 10 - 1 = 9, p2 = 5 - 10 = -5. Nobody played out.
    expect(state.players[0]?.score).toBe(9);
    expect(state.players[1]?.score).toBe(-5);
    expect(state.final).toEqual({
      adjustments: [
        { playerId: 'p1', rackValue: 1, playedOutBonus: 0 },
        { playerId: 'p2', rackValue: 10, playedOutBonus: 0 },
      ],
      winnerIds: ['p1'],
    });
  });

  it('counts exchanges toward the scoreless run', () => {
    const state = makeState({ scorelessTurns: 5, bag: tiles('ABCDEFG') });
    const next = applyIntent(state, { type: 'exchange', playerId: 'p1', tiles: tiles('A') }, dict);
    expect(next.stage).toBe('over');
    expect(next.final?.adjustments.every((a) => a.playedOutBonus === 0)).toBe(true);
  });

  it('counts a 0-point play toward the scoreless run', () => {
    // An existing blank A at F8; a blank played as T at G8 forms AT worth
    // 0 + 0 = 0 on premium-free squares — scoreless, and it ends the game.
    const state = makeState({ scorelessTurns: 5 });
    setBoardWord(state.board, 'F8', 'row', 'a'); // lowercase = blank
    state.players[0]!.rack = tiles('_XXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', '_', 'T')] },
      dict,
    );
    expect(next.log[0]?.score).toBe(0);
    expect(next.scorelessTurns).toBe(6);
    expect(next.stage).toBe('over');
  });

  it('a scoring play interrupts the run', () => {
    const state = makeState({ scorelessTurns: 5 });
    state.players[0]!.rack = tiles('CATXXXX');
    setBoardWord(state.board, 'H8', 'row', 'A');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'C'), place('I8', 'T')] },
      dict,
    );
    expect(next.scorelessTurns).toBe(0);
    expect(next.stage).toBe('playing');
  });

  it('ties in the final score share the win', () => {
    // Both players at 5 with empty racks: 6 passes end it, nothing deducted.
    let state: GameState = makeState();
    state.players[0]!.rack = [];
    state.players[0]!.score = 5;
    state.players[1]!.rack = [];
    state.players[1]!.score = 5;
    for (let i = 0; i < 6; i++) {
      const actor = getCurrentActor(state);
      if (actor === null) break;
      state = applyIntent(state, { type: 'pass', playerId: actor }, dict);
    }
    expect(state.stage).toBe('over');
    expect(state.final?.winnerIds).toEqual(['p1', 'p2']);
  });
});

describe('playing out with an empty bag', () => {
  it('ends immediately and pays the played-out player everyone else’s rack', () => {
    // Board: C at F8. p1 (rack A, T; score 0) plays AT after it → CAT, with
    // the T landing on the center DW: (3+1+1) × 2 = 10. Rack empty, bag
    // empty → game over. p2 still holds Q+Z = 20.
    // Final: p1 = 10 - 0 + 20 = 30; p2 = 0 - 20 = -20.
    const state = makeState({ bag: [] });
    setBoardWord(state.board, 'F8', 'row', 'C');
    state.players[0]!.rack = tiles('AT');
    state.players[1]!.rack = tiles('QZ');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'A'), place('H8', 'T')] },
      dict,
    );
    expect(next.stage).toBe('over');
    expect(getCurrentActor(next)).toBeNull();
    expect(next.turnIndex).toBe(0); // stays where it was
    expect(next.players[0]?.score).toBe(30);
    expect(next.players[1]?.score).toBe(-20);
    expect(next.final).toEqual({
      adjustments: [
        { playerId: 'p1', rackValue: 0, playedOutBonus: 20 },
        { playerId: 'p2', rackValue: 20, playedOutBonus: 0 },
      ],
      winnerIds: ['p1'],
    });
  });

  it('does not end the game when the bag still has tiles to refill from', () => {
    // Same play, but one tile left in the bag: the rack refills and play
    // continues.
    const state = makeState({ bag: tiles('E') });
    setBoardWord(state.board, 'F8', 'row', 'C');
    state.players[0]!.rack = tiles('AT');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'A'), place('H8', 'T')] },
      dict,
    );
    expect(next.stage).toBe('playing');
    expect(next.players[0]?.rack).toEqual(tiles('E'));
    expect(next.bag).toEqual([]);
  });

  it('the played-out bonus is added once, not doubled', () => {
    // Three players: p1 plays out; p2 holds D+D = 4, p3 holds V+W = 8.
    // p1 gains exactly 4 + 8 = 12 — the classic rule adds the sum once.
    const p3 = { id: 'p3', name: 'Cara', rack: tiles('VW'), score: 0 }; // V4+W4=8
    const state = makeState({ bag: [] });
    state.players.push(p3);
    setBoardWord(state.board, 'F8', 'row', 'C');
    state.players[0]!.rack = tiles('AT');
    state.players[1]!.rack = tiles('DD'); // 2+2 = 4
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'A'), place('H8', 'T')] },
      dict,
    );
    // p1: 10 (CAT doubled) + 4 + 8 = 22.
    expect(next.players[0]?.score).toBe(22);
    expect(next.final?.adjustments[0]?.playedOutBonus).toBe(12);
  });
});

describe('after the game is over', () => {
  it('every further intent is rejected with gameOver', () => {
    const state = makeState({ stage: 'over' });
    const intents: Intent[] = [
      { type: 'pass', playerId: 'p1' },
      { type: 'exchange', playerId: 'p1', tiles: tiles('A') },
    ];
    for (const intent of intents) {
      expect(() => applyIntent(state, intent, dict)).toThrow(/game is over/);
    }
  });
});
