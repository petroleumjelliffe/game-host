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
});
