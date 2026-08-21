/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        name: 'node',
        test: {
          globals: true,
          environment: 'node',
          include: [
            'protocol/**/*.test.ts',
            'server/**/*.test.ts',
          ],
        },
      },
      {
        name: 'jsdom',
        test: {
          globals: true,
          environment: 'jsdom',
          // The client reaches localStorage only through the lobby's
          // identity store (net/singletons.ts), and no test exercised that
          // path before 2026-08-20 — but any that does needs Node's
          // experimental localStorage global not to shadow jsdom's: the
          // same flag packages/lobby and both other games' jsdom projects
          // carry. The setup shim that used to live here never ran: its
          // guard was `!window.localStorage`, and jsdom always provides
          // one. Proven with a planted throw before deletion. (2026-08-20)
          pool: 'forks',
          execArgv: ['--no-experimental-webstorage'],
          include: ['client/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
