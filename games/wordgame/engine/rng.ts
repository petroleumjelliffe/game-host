/**
 * Deterministic randomness from a string seed: xmur3 to hash the seed into
 * 32-bit state, mulberry32 to stream numbers from it. Implemented here
 * rather than imported so the shuffle a save was built with can never drift
 * under a dependency update — state must stay a pure function of
 * (seed, intent history).
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A [0, 1) stream, fully determined by the seed string. */
export function createRng(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

/**
 * A uniform shuffle over a copy — the input array is never mutated.
 *
 * Draw-and-remove rather than in-place Fisher–Yates: `splice` hands back a
 * `T[]`, so no index access ever types as `T | undefined` and no assertion
 * is needed under `noUncheckedIndexedAccess`. Quadratic, but the largest
 * thing shuffled here is a 100-tile bag.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = createRng(seed);
  const src = [...items];
  const out: T[] = [];
  while (src.length > 0) {
    const j = Math.floor(rng() * src.length);
    out.push(...src.splice(j, 1));
  }
  return out;
}
