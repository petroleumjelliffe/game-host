// Pure math for the board's pinch-zoom: no DOM, no React, fully unit-tested
// because jsdom can't do layout and a phone can't do CI. transform-origin is
// 0 0 throughout; the transformed content is the same size as the viewport.

export interface Point { x: number; y: number }
export interface BoardTransform { scale: number; tx: number; ty: number }

export const IDENTITY: BoardTransform = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Clamp scale to [MIN_SCALE, MAX_SCALE] and translation so the content's
 * edges never pull inside the viewport (w×h). Scale ≤ 1 is EXACT identity —
 * returning a not-quite-zero tx here is how zoom UIs accumulate drift. */
export function clampTransform(t: BoardTransform, w: number, h: number): BoardTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
  if (scale <= 1) return IDENTITY;
  return {
    scale,
    tx: Math.min(0, Math.max(w * (1 - scale), t.tx)),
    ty: Math.min(0, Math.max(h * (1 - scale), t.ty)),
  };
}

/** One pinch step: previous transform plus both fingers' previous (a0, b0)
 * and current (a1, b1) viewport-relative positions. The content point under
 * the old midpoint lands under the new midpoint, so the board tracks the
 * fingers through combined zoom + pan. */
export function pinch(
  prev: BoardTransform,
  a0: Point, b0: Point, a1: Point, b1: Point,
  w: number, h: number,
): BoardTransform {
  const d0 = dist(a0, b0);
  if (d0 === 0) return prev;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (dist(a1, b1) / d0)));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return clampTransform({
    scale,
    tx: m1.x - ((m0.x - prev.tx) / prev.scale) * scale,
    ty: m1.y - ((m0.y - prev.ty) / prev.scale) * scale,
  }, w, h);
}
