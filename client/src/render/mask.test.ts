import { describe, expect, it } from 'vitest';
import { MASK_GRID } from './glyphs';
import { buildMask } from './mask';

const at = (data: Uint8Array, x: number, y: number) => {
  const i = (y * MASK_GRID.cols + x) * 4;
  return { r: data[i]!, g: data[i + 1]! };
};

describe('buildMask', () => {
  it('is one RGBA texel per tile', () => {
    expect(buildMask(false).length).toBe(MASK_GRID.cols * MASK_GRID.rows * 4);
  });

  it('lights the tiles of the plain M, and only those', () => {
    const m = buildMask(false);
    // 'MARCO' starts at tile (1,12); the M's first row is '10001'.
    expect(at(m, 1, 12).r).toBe(255);
    expect(at(m, 2, 12).r).toBe(0);
    expect(at(m, 5, 12).r).toBe(255);
    // The middle row '10101' of the same glyph.
    expect(at(m, 3, 14).r).toBe(255);
  });

  it('leaves water everywhere the wordmark is not', () => {
    const m = buildMask(false);
    expect(at(m, 0, 0).r).toBe(0);
    expect(at(m, 31, 59).r).toBe(0);
  });

  it('carries corner codes in green for the cut font', () => {
    const m = buildMask(true);
    // The cut M's first row is '3....1': a code-3 tile then a code-1 tile.
    expect(at(m, 1, 12)).toEqual({ r: 255, g: 3 * 63 });
    expect(at(m, 6, 12)).toEqual({ r: 255, g: 1 * 63 });
    // A '#' tile is lit with no cut.
    expect(at(m, 1, 13)).toEqual({ r: 255, g: 0 });
  });

  it('advances by glyph width plus one tile, so POLO clears MARCO', () => {
    const m = buildMask(false);
    // 'POLO' starts at (4,22); P's first row is '11110'.
    expect(at(m, 4, 22).r).toBe(255);
    expect(at(m, 8, 22).r).toBe(0);
  });

  it('advances to the next glyph by its own width plus a tile of air', () => {
    const m = buildMask(false);
    // MARCO's A starts at x=7; its first row is '01110', so the origin column
    // itself is empty and the lit run is 8..10. Butting the glyphs together
    // or over-advancing moves that run.
    expect(at(m, 7, 12).r).toBe(0);
    expect(at(m, 8, 12).r).toBe(255);
    expect(at(m, 10, 12).r).toBe(255);
    // The same check one word down: POLO's first O opens at x=11.
    expect(at(m, 10, 22).r).toBe(0);
    expect(at(m, 11, 22).r).toBe(255);
  });

  it('advances the cut M by its own six columns, not the usual five', () => {
    const m = buildMask(true);
    // The cut M is the one 6-wide glyph, so A lands at x=8 and opens on a
    // code-1 corner. A fixed five-wide advance would put that corner at x=7.
    expect(at(m, 8, 12)).toEqual({ r: 255, g: 63 });
    expect(at(m, 7, 12)).toEqual({ r: 0, g: 0 });
  });

  it('leaves the plain font free of corner codes', () => {
    const m = buildMask(false);
    for (let i = 1; i < m.length; i += 4) expect(m[i]).toBe(0);
  });

  it('marks lit tiles opaque, so the texture uploads as more than colour', () => {
    const m = buildMask(false);
    const lit = (12 * MASK_GRID.cols + 1) * 4;
    const water = 0;
    expect(m[lit + 3]).toBe(255);
    expect(m[water + 3]).toBe(0);
  });

  it('fits both wordmarks inside the grid', () => {
    for (const cut of [false, true]) {
      const m = buildMask(cut);
      let count = 0;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < MASK_GRID.rows; y++) {
        for (let x = 0; x < MASK_GRID.cols; x++) {
          if (at(m, x, y).r !== 255) continue;
          count++;
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      // Golden values: the cut font's wider M pushes MARCO one tile further.
      expect(count).toBe(cut ? 168 : 140);
      expect(maxX).toBe(cut ? 30 : 29);
      expect(maxY).toBe(28);
    }
  });
});
