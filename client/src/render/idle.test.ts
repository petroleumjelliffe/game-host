import { describe, expect, it } from 'vitest';
import { idleAt, IDLE_PERIOD_MS } from './idle';

const BOUNDS = { left: 0, top: 0, right: 380, bottom: 524 };

describe('idleAt', () => {
  it('keeps every swimmer inside the water, never over the deck', () => {
    for (let seat = 0; seat < 8; seat++) {
      for (let t = 0; t < IDLE_PERIOD_MS; t += 250) {
        const p = idleAt(seat, BOUNDS, t, 26);
        expect(p.x).toBeGreaterThanOrEqual(BOUNDS.left + 26);
        expect(p.x).toBeLessThanOrEqual(BOUNDS.right - 26);
        expect(p.y).toBeGreaterThanOrEqual(BOUNDS.top + 26);
        expect(p.y).toBeLessThanOrEqual(BOUNDS.bottom - 26);
      }
    }
  });

  it('loops, so nobody teleports on the seam', () => {
    const a = idleAt(2, BOUNDS, 400, 26);
    const b = idleAt(2, BOUNDS, 400 + IDLE_PERIOD_MS, 26);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
  });

  it('spreads the seats out rather than stacking them', () => {
    const one = idleAt(0, BOUNDS, 0, 26);
    const two = idleAt(1, BOUNDS, 0, 26);
    expect(Math.hypot(one.x - two.x, one.y - two.y)).toBeGreaterThan(40);
  });

  it('reports a unit heading that follows the path', () => {
    const p = idleAt(3, BOUNDS, 1200, 26);
    expect(Math.hypot(p.heading.x, p.heading.y)).toBeCloseTo(1, 4);
  });
});
