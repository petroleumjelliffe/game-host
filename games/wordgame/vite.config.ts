import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BASE_PATH } from './basePath';

export default defineConfig(() => ({
  plugins: [react()],
  // 7934 is this game's dev-client slot in the cross-game port registry
  // (PORTS.md); strictPort fails loudly rather than sliding into a
  // neighbour's slot. allowedHosts covers the host machine's mDNS name.
  server: {
    port: 7934,
    strictPort: true,
    allowedHosts: ['.local'],
    // Dev plays the part the composed host plays in hosting: the client is
    // origin-relative and this proxy carries its socket path (and the
    // notification API, which in hosting lives on the composed host) to the
    // game server. 4004 per PORTS.md — build tooling, not shipped code.
    proxy: {
      [`${BASE_PATH}/socket.io`]: { target: 'http://localhost:4004', ws: true },
      // The game's own HTTP API (api/summaries feeds the entry list). Without
      // this line dev 404s the fetch and the entry page silently shows no
      // games — sockets still work, so everything *else* looks fine
      // (2026-08-31, found the evening the entry page shipped).
      [`${BASE_PATH}/api`]: { target: 'http://localhost:4004' },
      '/notify': { target: 'http://localhost:4004' },
    },
  },
  // One base, dev and build alike — the same uniformity Acquire settled on.
  base: BASE_PATH,
  test: {
    globals: true,
    environment: 'jsdom',
    // Two projects, same reason as Acquire's split (see its vite.config.ts):
    // engine/, session/ and server/ run in the server process in production,
    // so a stray browser global there is a production crash a single jsdom
    // suite could never catch. No root-level setupFiles — vitest 4 merges the
    // array into both projects.
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
          pool: 'forks',
          execArgv: ['--no-experimental-webstorage'],
        },
      },
    ],
  },
}));
