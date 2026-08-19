// engine/, session/, server/ and the pure half of src/state all run inside the
// server process in production. A stray `window.` or `localStorage` there is a
// production crash that a single jsdom suite could never catch — this asserts
// the node project really is node.
//
// If this fails, someone merged the two projects or added a root-level
// `setupFiles` (vitest 4 merges those into every project, which would bridge
// jsdom's Storage in here and hide exactly what this guards).
import { expect, it } from 'vitest';

it('the node project runs without a DOM', () => {
  expect(typeof globalThis.window).toBe('undefined');
  expect(typeof globalThis.localStorage).toBe('undefined');
});
