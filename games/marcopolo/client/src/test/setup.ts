import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver, and Deck measures its own height with one. A
// stub that never fires is enough: no jsdom test asserts on layout, and the
// components only use the observer to re-report a size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom implements no canvas context: every getContext call logs a
// "Not implemented" error and returns null. The renderers already treat a
// null context as the no-GPU fallback path, so answer null without the
// noise — twelve lines of it per HomeScreen render otherwise.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
});
