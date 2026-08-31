import { createRng, seededShuffle } from './rng';

describe('createRng', () => {
  it('is deterministic per seed', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs across seeds', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-2');
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 1000; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it('does not mutate its input', () => {
    const input = [...items];
    seededShuffle(input, 'seed');
    expect(input).toEqual(items);
  });

  it('returns the same permutation for the same seed', () => {
    expect(seededShuffle(items, 'seed')).toEqual(seededShuffle(items, 'seed'));
  });

  it('returns different permutations for different seeds', () => {
    expect(seededShuffle(items, 'seed-1')).not.toEqual(seededShuffle(items, 'seed-2'));
  });

  it('returns a permutation — same elements, same counts', () => {
    const shuffled = seededShuffle(items, 'perm');
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('actually shuffles', () => {
    expect(seededShuffle(items, 'seed')).not.toEqual(items);
  });

  it('handles empty and single-element arrays', () => {
    expect(seededShuffle([], 'seed')).toEqual([]);
    expect(seededShuffle(['x'], 'seed')).toEqual(['x']);
  });
});
