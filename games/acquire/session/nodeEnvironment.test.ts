import { describe, it, expect } from 'vitest';

/**
 * The boundary `vite.config.ts`'s two-project split exists to enforce:
 * `engine/`, `session/` and `server/` run under `environment: 'node'` and
 * must never depend on a browser global, because `src/test/setup.ts`'s jsdom
 * `localStorage` shim is exactly the kind of stray global that would be a
 * production crash in the server process if it silently became available
 * here too.
 *
 * This is not hypothetical: a root-level `test.setupFiles` in
 * `vite.config.ts` once leaked that shim into this project regardless of the
 * `node` project's own `setupFiles: []`, because vitest 4's `extends: true`
 * merges setup-file arrays rather than letting a child override them with an
 * empty one. The fix moved `setupFiles` off the shared root entirely — this
 * test is what keeps that fix checked rather than merely documented.
 *
 * Checking the descriptor's *shape*, not `globalThis.localStorage` itself,
 * is deliberate: reading the value can't tell "the shim never loaded" from
 * "it did, and returns undefined anyway" — and on a Node that exposes the
 * experimental global, reading it is exactly what prints
 * `ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided`, defeating the point of a pristine
 * `npx vitest run`. Inspecting the shape never invokes a getter.
 *
 * `src/test/setup.ts`'s shim installs with
 * `Object.defineProperty(..., { value: {...} })` — a **data** descriptor. So
 * the thing that must never be true here is "a data descriptor exists", and
 * that is what this asserts.
 *
 * What is deliberately *not* asserted is that Node's own accessor is present.
 * It was, when this test was written; on Node 24 (v24.18.0, measured
 * 2026-08-07) `globalThis` carries no `localStorage` own property at all, and
 * the original `expect(typeof descriptor?.get).toBe('function')` failed on a
 * clean checkout with nothing to do with the shim. Either shape is fine — an
 * accessor, or nothing — because neither is what a leak looks like.
 */
describe('the node project sees no browser globals', () => {
  it('keeps the jsdom-only localStorage shim out of this environment', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    // The leak signature, stated directly: a data descriptor carrying the
    // shim object. Absent (Node 24+) and accessor (older Node) both pass.
    expect(descriptor?.value).toBeUndefined();
    expect(descriptor === undefined || typeof descriptor.get === 'function').toBe(true);
  });
});
