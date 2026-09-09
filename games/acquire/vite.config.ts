import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaPlaceholders, swFromBuild } from "@game-host/pwa/build/plugins";
import { BASE_PATH } from "./basePath";
import { APP_COLORS } from "./src/game/tokens";

export default defineConfig(() => ({
  plugins: [
    react(),
    // The two shared PWA plugins (@game-host/pwa — this is where acquire's
    // hand-rolled originals moved, comments and all; the history of the
    // double-prefixed base, the in-a-comment substitution and the Vite 7
    // 'pre' ordering lives with them in build/plugins.ts).
    //
    // __THEME_COLOR__ comes from the same token the manifest generator reads
    // (APP_COLORS in src/game/tokens.ts), so a palette change — the Aqua
    // Titanium reskin rewrites that file — flows into both without either
    // being typed by hand. Safe to import here: tokens.ts depends only on
    // engine/, which is Node-clean by construction.
    pwaPlaceholders({ themeColor: APP_COLORS.theme }),
    swFromBuild({ cachePrefix: "acquire", appName: "Acquire" }),
  ],
  // 7932 is Acquire's dev-client slot in the cross-game port registry (the
  // game-host repo's PORTS.md); strictPort fails loudly rather than sliding
  // into a neighbour's slot. allowedHosts covers the host machine's mDNS
  // name, which Vite's DNS-rebind guard would otherwise refuse.
  server: {
    port: 7932, strictPort: true, allowedHosts: ['.local'],
    // Dev plays the part Caddy plays in hosting: the client is origin-relative
    // and this proxy carries its socket path to the game server. 4002 per
    // game-host PORTS.md — build tooling, not shipped code.
    //
    // One key: the client's path follows its base, and base is now BASE_PATH
    // in dev and build alike, so there is only one path it ever asks for.
    proxy: {
      [`${BASE_PATH}/socket.io`]: { target: 'http://localhost:4002', ws: true },
    },
  },
  // One base, dev and build alike. The asymmetry this replaces was the sole
  // reason dev needed its own socket path, its own manifest rewrite and a
  // differently-substituted __PWA_BASE__ — see the deletions below.
  base: BASE_PATH,
  test: {
    globals: true,
    environment: 'jsdom',
    // No root-level `setupFiles`: vitest 4's `extends: true` merges arrays,
    // so a child project's `setupFiles: []` does not override a root value —
    // it only adds nothing to it. The `node` project's own `[]` below only
    // means what it says because there is nothing here for it to inherit.
    // Confirmed by the boundary assertion in `session/nodeEnvironment.test.ts`:
    // without this, `globalThis.localStorage` was live under `--project
    // node` too, silently disarming the guard the split below exists for.
    //
    // Two projects, one reason: `engine/`, `session/` and `server/` must not
    // depend on browser globals. They run under Node in production — the
    // server process — and are imported by `src/` as well, so a stray
    // `window.` is a production crash. Under a single jsdom suite `window`
    // always exists and no test can ever catch it. Running them under
    // `environment: 'node'` makes that boundary enforced instead of merely
    // documented. `src/` keeps the jsdom + jest-dom setup it had.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['engine/**/*.test.ts', 'session/**/*.test.ts', 'server/**/*.test.ts'],
          environment: 'node',
          globals: true,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: './src/test/setup.ts',
          // Keeps Node's experimental localStorage global out of these
          // workers so jsdom's real Storage reaches globalThis — the story
          // is in src/test/setup.ts, where the shim this replaces lived.
          // Scoped: the `node` project's workers do not get the flag.
          // execArgv needs the forks pool. (2026-08-20)
          pool: 'forks',
          execArgv: ['--no-experimental-webstorage'],
        },
      },
    ],
  },
}));
