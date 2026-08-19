import { describe, expect, it } from 'vitest';
import { pickNextMarco, survivors } from './rounds.js';

describe('pickNextMarco', () => {
  it('picks the player who has waited longest (never-marco = 0)', () => {
    expect(pickNextMarco(['p1', 'p2', 'p3'], { p1: 2, p2: 1 }, () => 0)).toBe('p3');
  });

  it('breaks ties with rng', () => {
    const history = { p1: 1 };
    expect(pickNextMarco(['p1', 'p2', 'p3'], history, () => 0)).toBe('p2');
    expect(pickNextMarco(['p1', 'p2', 'p3'], history, () => 0.99)).toBe('p3');
  });
});

describe('survivors', () => {
  it('is every polo on a timeout', () => {
    expect(survivors(['p2', 'p3'], null)).toEqual(['p2', 'p3']);
  });

  it('excludes the caught polo', () => {
    expect(survivors(['p2', 'p3'], 'p3')).toEqual(['p2']);
  });
});
