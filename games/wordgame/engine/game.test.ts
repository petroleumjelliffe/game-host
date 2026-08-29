/**
 * A short scripted game: two players, a hand-built opening state, five
 * intents, and every intermediate number asserted from arithmetic done in
 * the comments — never from running the engine.
 */
import { applyIntent } from './intents';
import { getCurrentActor } from './actor';
import type { GameState } from './gameTypes';
import { fixtureDict, makeState, place, placeWord, tiles } from './testHelpers';

const dict = fixtureDict('HAT', 'CAT', 'HATS');

describe('a scripted two-player game', () => {
  it('plays five turns with every score computed by hand', () => {
    let state: GameState = makeState({
      players: [
        { id: 'p1', name: 'Alice', rack: tiles('HATERSB'), score: 0 },
        { id: 'p2', name: 'Bob', rack: tiles('CTOINDG'), score: 0 },
      ],
      bag: tiles('QUEENSABCDEFG'), // 13 tiles, drawn from the front
    });

    // ── Move 1, Alice: HAT across G8–I8, first move over the center DW.
    //    H4 + A1 + T1 = 6, ×2 = 12.
    state = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') },
      dict,
    );
    expect(state.players[0]?.score).toBe(12);
    expect(state.log[0]?.words).toEqual([{ word: 'HAT', score: 12 }]);
    // Rack E,R,S,B refilled with Q,U,E off the bag front.
    expect(state.players[0]?.rack).toEqual(tiles('ERSBQUE'));
    expect(state.bag).toEqual(tiles('ENSABCDEFG'));
    expect(state.scorelessTurns).toBe(0);
    expect(getCurrentActor(state)).toBe('p2');

    // ── Move 2, Bob: C at H7 and T at H9, reading down through the played A
    //    → CAT. No premiums (H7 and H9 are plain; H8's DW is spent).
    //    C3 + A1 + T1 = 5.
    state = applyIntent(
      state,
      { type: 'play', playerId: 'p2', placements: [place('H7', 'C'), place('H9', 'T')] },
      dict,
    );
    expect(state.players[1]?.score).toBe(5);
    expect(state.log[1]?.words).toEqual([{ word: 'CAT', score: 5 }]);
    // Rack O,I,N,D,G refilled with E,N.
    expect(state.players[1]?.rack).toEqual(tiles('OINDGEN'));
    expect(state.bag).toEqual(tiles('SABCDEFG'));
    expect(getCurrentActor(state)).toBe('p1');

    // ── Move 3, Alice: exchanges Q and U (bag holds 8 ≥ 7). Replacements S
    //    and A come off the front first; Q and U go back and the bag
    //    reshuffles. Scoreless turn one.
    state = applyIntent(state, { type: 'exchange', playerId: 'p1', tiles: tiles('QU') }, dict);
    expect(state.players[0]?.rack).toEqual(tiles('ERSBESA'));
    expect(state.bag).toHaveLength(8);
    expect([...state.bag].sort()).toEqual(tiles('BCDEFGQU').sort());
    expect(state.players[0]?.score).toBe(12); // unchanged
    expect(state.scorelessTurns).toBe(1);
    expect(state.log[2]).toEqual({ playerId: 'p1', kind: 'exchange', score: 0, tilesPlayed: 2 });

    // ── Move 4, Bob: passes. Scoreless turn two.
    state = applyIntent(state, { type: 'pass', playerId: 'p2' }, dict);
    expect(state.scorelessTurns).toBe(2);
    expect(state.moveCount).toBe(4);
    expect(getCurrentActor(state)).toBe('p1');

    // ── Move 5, Alice: S at J8 extends HAT to HATS.
    //    H4 + A1 + T1 + S1 = 7, J8 is premium-free, the center DW is spent.
    state = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('J8', 'S')] },
      dict,
    );
    expect(state.players[0]?.score).toBe(19); // 12 + 7
    expect(state.log[4]?.words).toEqual([{ word: 'HATS', score: 7 }]);
    expect(state.scorelessTurns).toBe(0); // the scoring play resets the run
    expect(state.players[0]?.rack).toHaveLength(7); // refilled from the shuffled bag
    expect(state.bag).toHaveLength(7);
    expect(state.stage).toBe('playing');
    expect(state.moveCount).toBe(5);
    expect(getCurrentActor(state)).toBe('p2');
  });
});
