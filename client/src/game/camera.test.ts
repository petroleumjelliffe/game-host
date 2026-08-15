import { describe, expect, it } from 'vitest';
import { screenToWorld, worldScale, worldToScreen } from './camera';

describe('camera', () => {
  it('maps world center to screen center and edges to edges', () => {
    expect(worldToScreen(0, 0, 400)).toEqual({ x: 200, y: 200 });
    expect(worldToScreen(1, 0, 400)).toEqual({ x: 400, y: 200 });
    expect(worldToScreen(0, -1, 400)).toEqual({ x: 200, y: 0 });
  });

  it('round-trips', () => {
    const w = screenToWorld(300, 100, 400);
    const back = worldToScreen(w.x, w.y, 400);
    expect(back.x).toBeCloseTo(300);
    expect(back.y).toBeCloseTo(100);
  });

  it('scales lengths by half the canvas', () => {
    expect(worldScale(0.5, 400)).toBe(100);
  });
});
