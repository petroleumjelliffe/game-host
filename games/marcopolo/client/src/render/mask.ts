// Builds the letter mask the tile shader samples — one RGBA texel per tile.
// Red marks a tile the wordmark occupies; green carries the corner-cut code
// (0–4) scaled by 63 so it survives a byte round-trip. Deliberately a plain
// pixel array rather than a canvas: it is testable without a DOM, and WebGL
// uploads it directly.

import { GLYPHS_CUT, GLYPHS_PLAIN, MASK_GRID, WORDMARK } from './glyphs';

export function buildMask(cut: boolean): Uint8Array {
  const { cols, rows } = MASK_GRID;
  const data = new Uint8Array(cols * rows * 4);
  const glyphs = cut ? GLYPHS_CUT : GLYPHS_PLAIN;

  for (const { word, x: ox, y: oy } of WORDMARK) {
    let cx = ox;
    for (const ch of word) {
      const glyph = glyphs[ch];
      if (!glyph) throw new Error(`tile font has no glyph for ${ch}`);
      const lines = glyph.split(',');
      lines.forEach((line, y) => {
        [...line].forEach((v, x) => {
          if (v === '.' || v === '0') return;
          const code = cut && v !== '#' ? Number.parseInt(v, 10) : 0;
          const tx = cx + x;
          const ty = oy + y;
          if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) return;
          const i = (ty * cols + tx) * 4;
          data[i] = 255;
          data[i + 1] = code * 63;
          data[i + 3] = 255;
        });
      });
      cx += (lines[0]?.length ?? 0) + 1;
    }
  }
  return data;
}
