import { describe, expect, it } from 'vitest';
import { rollRng } from './seed.js';
import { d6 } from './dice.js';

describe('rollRng', () => {
  it('is deterministic: same seed and n, same stream', () => {
    const a = rollRng('game-night', 3);
    const b = rollRng('game-night', 3);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('differs across n and across seeds', () => {
    const draws = (rng: () => number) => Array.from({ length: 8 }, rng);
    expect(draws(rollRng('game-night', 3))).not.toEqual(draws(rollRng('game-night', 4)));
    expect(draws(rollRng('game-night', 3))).not.toEqual(draws(rollRng('other', 3)));
  });

  it('yields values in [0,1) that exercise every d6 face', () => {
    const faces = new Set<number>();
    for (let n = 0; n < 100; n++) {
      const rng = rollRng('spread', n);
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      faces.add(d6(rollRng('spread', n)));
    }
    expect(faces).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });
});
