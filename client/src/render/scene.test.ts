import { describe, expect, it } from 'vitest';
import { HeadingTracker, bobOffset, lastCallLabel, mmss, poolLayout, segmentsLit } from './scene';

describe('poolLayout', () => {
  it('inscribes the arena in the short side and centers it', () => {
    expect(poolLayout(380, 720)).toEqual({ size: 380, offsetX: 0, offsetY: 170 });
    expect(poolLayout(900, 500)).toEqual({ size: 500, offsetX: 200, offsetY: 0 });
  });

  it('keeps the half-pixel on an odd viewport, so pointers and paint agree', () => {
    expect(poolLayout(901, 500)).toEqual({ size: 500, offsetX: 200.5, offsetY: 0 });
  });
});

describe('mmss', () => {
  it('formats the round clock the way the design shows it', () => {
    expect(mmss(74)).toBe('1:14');
    expect(mmss(90)).toBe('1:30');
    expect(mmss(9)).toBe('0:09');
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-3)).toBe('0:00');
  });

  it('carries a two-digit minute', () => {
    expect(mmss(600)).toBe('10:00');
    expect(mmss(3599)).toBe('59:59');
  });
});

describe('segmentsLit', () => {
  it('lights ten of sixteen at 62%, as the design does', () => {
    expect(segmentsLit(0.62, 16)).toBe(10);
    expect(segmentsLit(0, 16)).toBe(0);
    expect(segmentsLit(1, 16)).toBe(16);
  });

  it('clamps nonsense', () => {
    expect(segmentsLit(-1, 16)).toBe(0);
    expect(segmentsLit(2, 16)).toBe(16);
  });
});

describe('lastCallLabel', () => {
  it('counts up from the call, not down to the next one', () => {
    expect(lastCallLabel(5, 5)).toBe('LAST CALL 0s AGO');
    expect(lastCallLabel(3, 5)).toBe('LAST CALL 2s AGO');
    expect(lastCallLabel(0, 5)).toBe('CALL READY');
    expect(lastCallLabel(null, 5)).toBe('CALL READY');
  });

  it('never shows a negative age when the cooldown outruns its total', () => {
    expect(lastCallLabel(7, 5)).toBe('LAST CALL 0s AGO');
  });
});

describe('bobOffset', () => {
  it('is a bounded oscillation, and seats do not bob in lockstep', () => {
    const a = bobOffset(0, 0);
    expect(Math.abs(a)).toBeLessThanOrEqual(1);
    expect(bobOffset(0, 0)).not.toBeCloseTo(bobOffset(0, 3));
    expect(bobOffset(2400, 0)).toBeCloseTo(bobOffset(0, 0), 5);
  });

  it('completes one cycle every 2400ms, not some divisor of it', () => {
    // A quarter phase in: the crest. Testing only the zero crossing at 2400
    // would be satisfied by any period that divides it.
    expect(bobOffset(600, 0)).toBeCloseTo(1, 5);
  });
});

describe('HeadingTracker', () => {
  it('starts pointing right and turns toward the direction of travel', () => {
    const t = new HeadingTracker();
    expect(t.update('p1', 0, 0)).toEqual({ x: 1, y: 0 });
    let h = { x: 1, y: 0 };
    for (let i = 1; i <= 40; i++) h = t.update('p1', 0, i * 0.01);
    expect(h.y).toBeGreaterThan(0.9);
    expect(Math.hypot(h.x, h.y)).toBeCloseTo(1, 5);
  });

  it('holds the last heading when a swimmer stops', () => {
    const t = new HeadingTracker();
    for (let i = 0; i <= 40; i++) t.update('p1', i * 0.01, 0);
    const moving = t.update('p1', 0.41, 0);
    const stopped = t.update('p1', 0.41, 0);
    expect(stopped).toEqual(moving);
  });

  it('forgets players who left', () => {
    const t = new HeadingTracker();
    t.update('p1', 0, 0);
    t.retain(new Set(['p2']));
    expect(t.update('p1', 0, 0)).toEqual({ x: 1, y: 0 });
  });

  it('keeps the players it was told to keep', () => {
    const t = new HeadingTracker();
    let heading = { x: 1, y: 0 };
    for (let i = 1; i <= 40; i++) heading = t.update('p1', 0, i * 0.01);
    t.update('p2', 0, 0);
    expect(heading.y).toBeGreaterThan(0.9);

    t.retain(new Set(['p1']));

    // Standing still returns the heading p1 had, which it could only still
    // have if retain kept it — a retain that cleared everything would hand
    // back the default instead.
    expect(t.update('p1', 0, 0.4)).toEqual(heading);
    expect(t.update('p2', 0, 0)).toEqual({ x: 1, y: 0 });
  });
});
