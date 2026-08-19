import { describe, expect, it } from 'vitest';
import { BONUS_FACES, PIPS, WHITE_FACES, dieTurn, pipCells } from './dice';

describe('the pip layouts', () => {
  it('lights the middle cell alone for a one', () => {
    expect(PIPS[1]).toEqual([4]);
  });

  it('lights nothing for the blank face', () => {
    expect(PIPS[0]).toEqual([]);
  });

  it('lights as many cells as the face is worth', () => {
    for (let face = 0; face <= 6; face++) expect(PIPS[face]!).toHaveLength(face);
  });

  it('never lights a cell that is not on the die', () => {
    for (const cells of Object.values(PIPS)) {
      for (const cell of cells) expect(cell).toBeGreaterThanOrEqual(0);
      for (const cell of cells) expect(cell).toBeLessThan(9);
    }
  });
});

describe('a rendered face', () => {
  it('is always nine cells, lit or not', () => {
    expect(pipCells(3, '#141210')).toHaveLength(9);
  });

  it('paints the lit cells and leaves the rest to the leaf beneath', () => {
    const cells = pipCells(2, '#141210');
    expect(cells[0]).toEqual({ bg: '#141210' });
    expect(cells[8]).toEqual({ bg: '#141210' });
    expect(cells[4]).toEqual({ bg: 'transparent' });
  });

  it('shows no pips at all on the blank', () => {
    expect(pipCells(0, '#fdf3e6').every(cell => cell.bg === 'transparent')).toBe(true);
  });
});

describe('how far a drum turns', () => {
  it('runs a full lap plus the distance when it must be seen to turn', () => {
    expect(dieTurn(0, 0, WHITE_FACES, true)).toBe(6);
    expect(dieTurn(0, 3, WHITE_FACES, true)).toBe(9);
    expect(dieTurn(5, 0, WHITE_FACES, true)).toBe(7);
  });

  it('turns only the distance when it need not', () => {
    expect(dieTurn(3, 0, BONUS_FACES, false)).toBe(4);
    expect(dieTurn(0, 0, BONUS_FACES, false)).toBe(0);
  });

  it('reckons the bonus drum over seven faces, blank included', () => {
    expect(BONUS_FACES).toBe(7);
    expect(WHITE_FACES).toBe(6);
  });
});
