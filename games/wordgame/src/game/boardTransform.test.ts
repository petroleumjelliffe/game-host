import { describe, expect, it } from 'vitest';
import { IDENTITY, MAX_SCALE, clampTransform, pinch } from './boardTransform';

// Viewport is 300×300 in every case; transform-origin is 0 0.
const W = 300;
const H = 300;

describe('pinch', () => {
  it('doubles the scale when finger distance doubles', () => {
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    expect(t.scale).toBeCloseTo(2);
  });

  it('keeps the point under the pinch midpoint stationary', () => {
    // Midpoint (150,100) before and after; the content point under it must map back to it.
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    const contentX = (150 - 0) / 1; // under the midpoint before, identity transform
    expect(contentX * t.scale + t.tx).toBeCloseTo(150);
    const contentY = (100 - 0) / 1;
    expect(contentY * t.scale + t.ty).toBeCloseTo(100);
  });

  it('clamps at MAX_SCALE', () => {
    let t = IDENTITY;
    for (let i = 0; i < 5; i += 1) {
      t = pinch(t, { x: 140, y: 150 }, { x: 160, y: 150 }, { x: 50, y: 150 }, { x: 250, y: 150 }, W, H);
    }
    expect(t.scale).toBe(MAX_SCALE);
  });

  it('snaps to exact identity when pinched back out to 1×', () => {
    const zoomed = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    const back = pinch(zoomed, { x: 50, y: 100 }, { x: 250, y: 100 }, { x: 120, y: 100 }, { x: 180, y: 100 }, W, H);
    expect(back).toEqual(IDENTITY);
  });

  it('ignores a degenerate pinch with both fingers at one point', () => {
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    expect(t).toEqual(IDENTITY);
  });
});

describe('clampTransform', () => {
  it('never lets the board edge pull inside the viewport', () => {
    expect(clampTransform({ scale: 2, tx: 50, ty: -900 }, W, H)).toEqual({ scale: 2, tx: 0, ty: -300 });
  });

  it('collapses scale ≤ 1 to exact identity — no residual drift', () => {
    expect(clampTransform({ scale: 0.8, tx: -20, ty: -20 }, W, H)).toEqual(IDENTITY);
    expect(clampTransform({ scale: 1, tx: -20, ty: 0 }, W, H)).toEqual(IDENTITY);
  });
});
