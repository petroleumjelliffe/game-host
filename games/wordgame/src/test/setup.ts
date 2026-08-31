import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * No localStorage shim here any more (2026-08-20). This file used to install
 * an in-memory Storage over globalThis because Node's experimental
 * `localStorage` global — an accessor that warns and returns undefined
 * without --localstorage-file — shadowed jsdom's real one, and no probe
 * could tell the difference without firing the ExperimentalWarning itself.
 * The `app` project now starts its workers with --no-experimental-webstorage
 * instead (see vite.config.ts), so the accessor is never installed, and
 * vitest bridges jsdom's real Storage through on its own. Same mechanism as
 * packages/lobby and Rail Baron: one answer, not four. Under Node 24 the
 * flag is a no-op — the global is opt-in there — which is exactly why it is
 * a flag and not another shim: it costs nothing where the problem is absent
 * and disarms it where it is not.
 */

// Cleanup after each test
afterEach(() => {
  cleanup();
});
