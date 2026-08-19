import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Extensionless, matching Acquire. Vite 8's native config loader warns and
// wants './basePath.ts', but tsc rejects that without
// allowImportingTsExtensions — a repo-wide compiler flag is too much to
// spend on a deprecation warning that has not landed yet.
import { BASE_PATH } from './basePath';

/**
 * GitHub Pages serves static files and knows nothing about client-side
 * routes, so a direct load or a refresh on /pass-and-play/game returns its
 * own 404 page rather than the app. Pages falls back to 404.html for any
 * path it cannot find, so shipping a copy of index.html under that name
 * hands those URLs back to the router.
 *
 * Written at build time rather than kept as a second file in the repo, which
 * would be an identical copy that silently stops matching.
 */
function pagesFallback(): Plugin {
  return {
    name: 'railbaron:pages-fallback',
    apply: 'build',
    closeBundle() {
      const built = resolve('dist', 'index.html');
      if (existsSync(built)) copyFileSync(built, resolve('dist', '404.html'));
    }
  };
}

/**
 * The state tests that are pure — no DOM, no storage — and therefore belong in
 * the `node` project alongside the code the server actually runs.
 *
 * `storage.test.ts` is the single exception, and the extglob names it rather
 * than a hand-kept list going stale: localStorage is the subject of that file,
 * so jsdom (and `src/test/setup.ts`'s bridge) is not incidental to it. One
 * constant, used by both projects, so the two halves cannot drift into
 * running a file twice or not at all.
 */
const PURE_STATE_TESTS = 'src/state/!(storage).test.ts';

export default defineConfig({
  base: BASE_PATH,
  server: {
    // 7931 is Rail Baron's dev-client slot in the cross-game port registry
    // (the game-host repo's PORTS.md); the reverse proxy points at it, so
    // strictPort fails loudly rather than sliding to 7932 — which is
    // Acquire's slot — and leaving the proxy serving the wrong game.
    port: 7931,
    strictPort: true,
    // Listen on the LAN, not just localhost: friends' devices reach this
    // machine directly (Tier 1) or via the reverse proxy (Tier 2) — see
    // docs/superpowers/specs/2026-08-16-lan-hosting-design.md.
    host: true,
    // Vite's DNS-rebind guard refuses Host headers it doesn't know. The
    // leading dot is Vite's suffix wildcard: any mDNS name — this machine's
    // and its next rename — without opening the server to arbitrary hosts
    // the way `allowedHosts: true` would.
    allowedHosts: ['.local'],
    // Dev plays the part Caddy plays in hosting: the client is origin-relative
    // and this proxy carries its socket path to the game server. One key
    // suffices because `base` is BASE_PATH in dev and build alike, so the
    // client always asks at the prefixed path — the mount a bare
    // `tsx server/index.ts` answers. 4001 per game-host PORTS.md — build
    // tooling, not shipped code.
    proxy: { [`${BASE_PATH}/socket.io`]: { target: 'http://localhost:4001', ws: true } },
  },
  plugins: [react(), pagesFallback()],
  test: {
    globals: true,
    // No setupFiles here, deliberately: vitest 4 merges a root-level setup
    // into *every* project, which would load jsdom's storage bridge into the
    // node project and silently disarm the boundary that session/
    // nodeEnvironment.test.ts exists to guard.
    projects: [
      {
        extends: true,
        test: {
          // Everything that runs inside the server process in production:
          // the engine, the wire, the server itself, and the pure state that
          // replay is made of. A stray `window.` in any of it is a production
          // crash, and running them under node is what catches it.
          name: 'node',
          environment: 'node',
          include: [
            'engine/**/*.test.ts',
            'session/**/*.test.ts',
            'server/**/*.test.ts',
            PURE_STATE_TESTS
          ]
        }
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          // Spread the defaults back: supplying `exclude` replaces them, and
          // dropping them would set vitest scanning node_modules.
          exclude: [...configDefaults.exclude, PURE_STATE_TESTS],
          setupFiles: ['src/test/setup.ts']
        }
      }
    ]
  }
});
