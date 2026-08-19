import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * Polyfill localStorage for jsdom tests.
 *
 * Under vitest ^4.0.14 with jsdom ^27.2.0, `globalThis.localStorage` reads as
 * `undefined` despite jsdom shipping native localStorage for years. Without
 * this polyfill, tests that read/write localStorage (e.g.,
 * src/net/identity.test.ts) fail with:
 *
 *   TypeError: Cannot read properties of undefined (reading 'clear')
 *
 * This is likely due to jsdom's origin/sandbox handling. The attempted fix
 * via `vite.config.ts` environmentOptions.jsdom.localStorage: true does
 * nothing under this configuration pair.
 *
 * This file is loaded by the `app` (jsdom) vitest project only — see
 * `vite.config.ts`'s comment on why a root-level `setupFiles` would leak it
 * into `node` too. That is also why the install below is unconditional
 * rather than gated on a "does it already work" probe: a probe here turned
 * out not to be able to tell the difference. `globalThis.localStorage`
 * already carries an accessor descriptor before this file ever runs — not
 * from jsdom, but from Node's own still-experimental `localStorage` global,
 * present in the plain `node` project too (confirmed: identical
 * `{ get, set, enumerable: false, configurable: true }` descriptor either
 * way). `Object.getOwnPropertyDescriptor(globalThis, 'localStorage') ===
 * undefined` is therefore never true in either project, and reading the
 * value to check whether it *works* is exactly what prints
 * `ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided` — on every `npx vitest run`, `node`
 * project included, even for a test with nothing to do with storage.
 * `Object.defineProperty` replaces the descriptor outright without ever
 * invoking its getter, so it never reads the value and never fires that
 * warning — and because this file only loads for `app`, there is no longer
 * any environment to distinguish: every jsdom test gets this shim, full stop.
 *
 * This shim implements only the subset used by tests — getItem, setItem, removeItem,
 * clear, length, and key() — with in-memory storage. It does NOT implement storage
 * events (cross-tab sync), per-origin isolation, or persistence. Tests run in isolation
 * with this implementation; production code relies on the browser's real localStorage.
 */
// `Object.create(null)` rather than `{}`: a plain object's inherited
// `Object.prototype` means `getItem('constructor')` would return a function
// instead of `null` — a stored key can be any string a caller chooses, and
// this store should not have blind spots or surprises for the ones that
// collide with `Object.prototype`.
const store: Record<string, string> = Object.create(null);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      // `?? null`, not `|| null`: a stored empty string is a real, distinct
      // value from "nothing was ever stored here," and `||` would collapse
      // the two.
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      for (const key in store) {
        delete store[key];
      }
    },
    get length() {
      return Object.keys(store).length;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
  } as Storage,
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});
