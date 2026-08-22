// The nth roll of a seeded game is a pure function of (seed, n) — a fresh
// stream per roll event rather than one shared stream, because sharing would
// force every client to agree on how many *draws* each roll consumes (a turn
// roll and a destination roll consume different numbers), while counting
// *events* is derivable from the log every client already holds. See
// specs/2026-08-22-money-phase-1.md, Decision 3.
import type { Rng } from './types.js';

/** xmur3-style string hash — cheap, well-distributed, no dependencies. */
function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny PRNG, deterministic across every JS runtime. */
function mulberry32(state: number): Rng {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stream for roll event n of the game seeded with `seed`. */
export function rollRng(seed: string, n: number): Rng {
  return mulberry32(hashSeed(`${seed} ${n}`) ^ Math.imul(n + 1, 2654435761));
}
