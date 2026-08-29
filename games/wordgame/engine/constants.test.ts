import {
  ALL_TILES,
  BOARD_SIZE,
  BOARD_SQUARES,
  CENTER,
  PLAYER_EMOJI,
  PREMIUMS,
  TILE_DISTRIBUTION,
  TILE_VALUES,
  isLetter,
  isTile,
  parseCoord,
  type Premium,
} from './constants';
import { colOf, posOf, rowOf } from './board';

describe('the premium layout', () => {
  const count = (premium: Premium): number =>
    PREMIUMS.filter((p) => p === premium).length;

  it('has length 225', () => {
    expect(PREMIUMS).toHaveLength(BOARD_SQUARES);
  });

  it('has exactly 8 TW squares', () => {
    expect(count('TW')).toBe(8);
  });

  it('has exactly 17 DW squares, the center included', () => {
    expect(count('DW')).toBe(17);
    expect(PREMIUMS[CENTER]).toBe('DW');
  });

  it('has exactly 12 TL squares', () => {
    expect(count('TL')).toBe(12);
  });

  it('has exactly 24 DL squares', () => {
    expect(count('DL')).toBe(24);
  });

  it('is symmetric under 90° rotation', () => {
    for (let pos = 0; pos < BOARD_SQUARES; pos++) {
      const rotated = posOf(colOf(pos), BOARD_SIZE - 1 - rowOf(pos));
      expect(PREMIUMS[rotated]).toBe(PREMIUMS[pos]);
    }
  });

  it('puts TW on the corners and edge centers', () => {
    expect(PREMIUMS[parseCoord('A1')]).toBe('TW');
    expect(PREMIUMS[parseCoord('O15')]).toBe('TW');
    expect(PREMIUMS[parseCoord('H1')]).toBe('TW');
    expect(PREMIUMS[parseCoord('A8')]).toBe('TW');
  });
});

describe('the tile set', () => {
  it('totals 100 tiles', () => {
    const total = ALL_TILES.reduce((sum, tile) => sum + TILE_DISTRIBUTION[tile], 0);
    expect(total).toBe(100);
  });

  it('lists every tile exactly once', () => {
    expect(ALL_TILES).toHaveLength(27);
    expect(new Set(ALL_TILES).size).toBe(27);
  });

  it('values Q and Z at 10, J and X at 8, blanks at 0', () => {
    expect(TILE_VALUES.Q).toBe(10);
    expect(TILE_VALUES.Z).toBe(10);
    expect(TILE_VALUES.J).toBe(8);
    expect(TILE_VALUES.X).toBe(8);
    expect(TILE_VALUES._).toBe(0);
  });

  it('spot-checks the distribution: 12 E, 9 A, 9 I, 2 blanks, 1 Q', () => {
    expect(TILE_DISTRIBUTION.E).toBe(12);
    expect(TILE_DISTRIBUTION.A).toBe(9);
    expect(TILE_DISTRIBUTION.I).toBe(9);
    expect(TILE_DISTRIBUTION._).toBe(2);
    expect(TILE_DISTRIBUTION.Q).toBe(1);
  });
});

describe('parseCoord', () => {
  it('maps corners and center: A1=0, O1=14, A15=210, O15=224, H8=112', () => {
    expect(parseCoord('A1')).toBe(0);
    expect(parseCoord('O1')).toBe(14);
    expect(parseCoord('A15')).toBe(210);
    expect(parseCoord('O15')).toBe(224);
    expect(parseCoord('H8')).toBe(CENTER);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => parseCoord('P1')).toThrow();
    expect(() => parseCoord('A16')).toThrow();
    expect(() => parseCoord('A0')).toThrow();
    expect(() => parseCoord('8H')).toThrow();
    expect(() => parseCoord('')).toThrow();
  });
});

describe('type guards', () => {
  it('isLetter accepts A–Z only', () => {
    expect(isLetter('A')).toBe(true);
    expect(isLetter('Z')).toBe(true);
    expect(isLetter('a')).toBe(false);
    expect(isLetter('_')).toBe(false);
    expect(isLetter('AB')).toBe(false);
    expect(isLetter(3)).toBe(false);
    expect(isLetter(null)).toBe(false);
  });

  it('isTile accepts letters and the blank', () => {
    expect(isTile('Q')).toBe(true);
    expect(isTile('_')).toBe(true);
    expect(isTile('-')).toBe(false);
    expect(isTile('')).toBe(false);
    expect(isTile(undefined)).toBe(false);
  });
});

describe('PLAYER_EMOJI', () => {
  it('carries at least 6 distinct emoji for the 6 seats', () => {
    expect(PLAYER_EMOJI.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PLAYER_EMOJI).size).toBe(PLAYER_EMOJI.length);
  });
});
