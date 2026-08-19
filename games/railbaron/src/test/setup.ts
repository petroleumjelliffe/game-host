import '@testing-library/jest-dom/vitest';

/**
 * Bridge jsdom's real localStorage to globalThis.localStorage.
 *
 * Node 26 ships with an experimental globalThis.localStorage that returns
 * undefined unless the process starts with --localstorage-file. Vitest's
 * populateGlobal only bridges jsdom properties not already on global.
 * Since Node already defines localStorage (even if broken), jsdom's real
 * Storage never gets bridged through. We do it manually here so that code
 * using the global localStorage API gets the jsdom implementation.
 */
const g = globalThis as any;
if (typeof g.jsdom !== 'undefined' && g.jsdom.window?.localStorage) {
  g.localStorage = g.jsdom.window.localStorage;
}
