/**
 * Every example here is computed by hand in a comment before it is asserted —
 * the tests exist to catch the engine disagreeing with the arithmetic of the
 * printed rules, so none of these numbers may come from running the code.
 */
import { applyIntent } from './intents';
import { scoreWord } from './score';
import { parseCoord, premiumAt } from './board';
import type { FormedWord } from './words';
import { fixtureDict, makeState, place, placeWord, setBoardWord, tiles } from './testHelpers';

const dict = fixtureDict(
  'HAT', 'CAT', 'FAT', 'AN', 'BA', 'EN', 'DOG', 'AIRLINE', 'BANANAS', 'AT', 'BT',
);

describe('play scoring, worked by hand', () => {
  it('first move over the center DW: HAT = (4+1+1) × 2 = 12', () => {
    // H8 is the center DW; G8 and I8 carry no premium.
    const state = makeState();
    state.players[0]!.rack = tiles('HATXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('G8', 'row', 'HAT') },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'HAT', score: 12 }]);
    expect(next.players[0]?.score).toBe(12);
  });

  it('a TL under a placed letter: F on F6 in FAT = 4×3 + 1 + 1 = 14', () => {
    // F6 is a TL; G6 and H6 hold the existing A and T (no premium re-count,
    // and neither square is premium anyway).
    expect(premiumAt(parseCoord('F6'))).toBe('TL');
    const state = makeState();
    setBoardWord(state.board, 'G6', 'row', 'AT');
    state.players[0]!.rack = tiles('FXXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('F6', 'F')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'FAT', score: 14 }]);
  });

  it('a crossword sharing a premium square counts it in BOTH words', () => {
    // Board: BE across G8–H8 (E sits on the center DW, spent). Play AN across
    // G9–H9. G9 is a DL under the new A.
    //   AN  = A(1×2 DL) + N(1)            = 3
    //   BA  = B(3) + A(1×2 DL)           = 5   ← the same DL again
    //   EN  = E(1) + N(1)                 = 2   ← E's DW is spent, no ×2
    // Total: 10.
    expect(premiumAt(parseCoord('G9'))).toBe('DL');
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'BE');
    state.players[0]!.rack = tiles('ANXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('G9', 'row', 'AN') },
      dict,
    );
    expect(next.log[0]?.words).toEqual([
      { word: 'AN', score: 3 },
      { word: 'BA', score: 5 },
      { word: 'EN', score: 2 },
    ]);
    expect(next.players[0]?.score).toBe(10);
  });

  it('a premium under an existing tile is not recounted: CAT through a spent DW = 5', () => {
    // A sits on H8 (the center DW) from an earlier turn; playing C and T
    // around it scores 3 + 1 + 1 = 5, with no doubling.
    const state = makeState();
    setBoardWord(state.board, 'H8', 'row', 'A');
    state.players[0]!.rack = tiles('CTXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('G8', 'C'), place('I8', 'T')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'CAT', score: 5 }]);
  });

  it('a blank scores 0 but still fires the DW under it: D_G as DOG = (2+0+2) × 2 = 8', () => {
    // D at H7, G at H9; the blank lands on H8, the center DW.
    const state = makeState();
    setBoardWord(state.board, 'H7', 'row', 'D');
    setBoardWord(state.board, 'H9', 'row', 'G');
    state.players[0]!.rack = tiles('_XXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('H8', '_', 'O')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'DOG', score: 8 }]);
    expect(next.board[parseCoord('H8')]).toEqual({ letter: 'O', isBlank: true });
  });

  it('a lone tile on a DW doubles both words it forms: T at H8 makes AT=4 and BT=8', () => {
    // A at G8, B at H7. T lands on the center DW and joins both words:
    //   AT = (1+1) × 2 = 4      BT = (3+1) × 2 = 8      total 12.
    const state = makeState();
    setBoardWord(state.board, 'G8', 'row', 'A');
    setBoardWord(state.board, 'H7', 'row', 'B');
    state.players[0]!.rack = tiles('TXXXXXX');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: [place('H8', 'T')] },
      dict,
    );
    expect(next.log[0]?.words).toEqual([
      { word: 'AT', score: 4 },
      { word: 'BT', score: 8 },
    ]);
    expect(next.players[0]?.score).toBe(12);
  });

  it('bingo: a 7-tile first move adds 50 — AIRLINE = 7 × 2 + 50 = 64', () => {
    // E8..K8: only H8 (DW) is premium in that stretch. A+I+R+L+I+N+E = 7.
    const state = makeState();
    state.players[0]!.rack = tiles('AIRLINE');
    const next = applyIntent(
      state,
      { type: 'play', playerId: 'p1', placements: placeWord('E8', 'row', 'AIRLINE') },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'AIRLINE', score: 14 }]);
    expect(next.log[0]?.bingo).toBe(true);
    expect(next.players[0]?.score).toBe(64);
  });

  it('a word covering two DWs multiplies 4×: BANANAS across E5 and K5 = 9 × 4 = 36', () => {
    // Row 5: E5 and K5 are DWs, nothing else premium between them. The two
    // existing N tiles bridge the gaps; 5 tiles placed, so no bingo.
    // B3+A1+N1+A1+N1+A1+S1 = 9; ×2 ×2 = 36.
    expect(premiumAt(parseCoord('E5'))).toBe('DW');
    expect(premiumAt(parseCoord('K5'))).toBe('DW');
    const state = makeState();
    setBoardWord(state.board, 'G5', 'row', 'N');
    setBoardWord(state.board, 'I5', 'row', 'N');
    state.players[0]!.rack = tiles('BAAASXX');
    const next = applyIntent(
      state,
      {
        type: 'play',
        playerId: 'p1',
        placements: placeWord('E5', 'row', 'BANANAS', ['G5', 'I5']),
      },
      dict,
    );
    expect(next.log[0]?.words).toEqual([{ word: 'BANANAS', score: 36 }]);
    expect(next.log[0]?.bingo).toBeFalsy();
    expect(next.players[0]?.score).toBe(36);
  });
});

describe('scoreWord on synthetic words', () => {
  it('two TWs multiply 9×: eight new As down column A = 9 × 9 = 81', () => {
    // Column A rows 1–8: TW at A1 and A8, DL at A4, nothing else.
    // Letters: 7×A(1) + the DL A counting double = 9; ×3 ×3 = 81.
    const squares = Array.from({ length: 8 }, (_, row) => ({
      pos: row * 15,
      letter: 'A' as const,
      isBlank: false,
      isNew: true,
    }));
    const word: FormedWord = { word: 'AAAAAAAA', squares };
    expect(scoreWord(word)).toBe(81);
  });

  it('a blank on a TL still scores 0', () => {
    // F6 is a TL; a blank there contributes 0 × 3 = 0.
    const word: FormedWord = {
      word: 'XA',
      squares: [
        { pos: parseCoord('F6'), letter: 'X', isBlank: true, isNew: true },
        { pos: parseCoord('G6'), letter: 'A', isBlank: false, isNew: true },
      ],
    };
    expect(scoreWord(word)).toBe(1);
  });
});
