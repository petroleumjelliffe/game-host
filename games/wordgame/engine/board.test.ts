import { colOf, coordName, isBoardPos, parseCoord, posOf, premiumAt, rowOf } from './board';
import { BOARD_SQUARES, CENTER } from './constants';

describe('position arithmetic', () => {
  it('round-trips pos ↔ (row, col) for every square', () => {
    for (let pos = 0; pos < BOARD_SQUARES; pos++) {
      expect(posOf(rowOf(pos), colOf(pos))).toBe(pos);
    }
  });

  it('the center is row 7, col 7', () => {
    expect(rowOf(CENTER)).toBe(7);
    expect(colOf(CENTER)).toBe(7);
  });

  it('isBoardPos accepts 0..224 integers only', () => {
    expect(isBoardPos(0)).toBe(true);
    expect(isBoardPos(224)).toBe(true);
    expect(isBoardPos(225)).toBe(false);
    expect(isBoardPos(-1)).toBe(false);
    expect(isBoardPos(3.5)).toBe(false);
  });
});

describe('coordName', () => {
  it('is the inverse of parseCoord', () => {
    for (const name of ['A1', 'H8', 'O15', 'B14', 'K5']) {
      expect(coordName(parseCoord(name))).toBe(name);
    }
  });
});

describe('premiumAt', () => {
  it('reads the layout, null off it', () => {
    expect(premiumAt(CENTER)).toBe('DW');
    expect(premiumAt(parseCoord('F6'))).toBe('TL');
    expect(premiumAt(parseCoord('G8'))).toBeNull();
    expect(premiumAt(999)).toBeNull();
  });
});
