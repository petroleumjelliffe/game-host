import { describe, it, expect, afterEach } from 'vitest';
import { prefersReducedMotion, STEP_RISE_EASE, STEP_RISE_MS } from './stepMotion';

describe('the step motion values', () => {
  it('is long enough to read as a reveal', () => {
    // A step travels its own height, which is 187px in a merger. The two
    // earlier attempts ran at 280ms and 340ms and were both reported as too
    // quick to follow.
    expect(STEP_RISE_MS).toBeGreaterThanOrEqual(400);
  });

  it('does not use the front-loaded arrival curve', () => {
    // `step-up`'s curve spends 70% of its distance in the first 20% of its
    // time, which suits a fade where the element is visible throughout. Here
    // the distance is the reveal, so the same curve hid the whole motion in the
    // first fifth of it — measured, twice, on a real page.
    expect(STEP_RISE_EASE).not.toContain('0.2, 0.7');
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('is false where matchMedia does not exist, rather than throwing', () => {
    // jsdom has no matchMedia, and an unguarded call throws before any
    // assertion in any test that renders the panel is reached.
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports what the device asked for', () => {
    const queries: string[] = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => {
        queries.push(q);
        return { matches: true };
      },
    });

    expect(prefersReducedMotion()).toBe(true);
    expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
  });
});
