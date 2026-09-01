import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * Run every app test under the base path the BUILD actually gets. Vitest
 * serves BASE_URL as '/', where a naive `BASE_URL + 'api/...'` join is
 * accidentally correct — which is how the entry list shipped fetching
 * '/wordgameapi/summaries' and 404ed on every deployment while 220 tests
 * stayed green (2026-08-31). With the build's real, slashless value stubbed
 * here, any code that trusts a trailing slash fails in the suite instead of
 * in production. Mirrors vite.config's `base: BASE_PATH` — keep in sync.
 */
vi.stubEnv('BASE_URL', '/wordgame');

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
