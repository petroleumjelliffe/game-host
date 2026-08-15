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
            'vendor/lobby/protocol/**/*.test.ts',
            'vendor/lobby/server/**/*.test.ts',
          ],
        },
      },
      {
        name: 'jsdom',
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.jsdom.setup.ts'],
          include: ['client/**/*.test.{ts,tsx}', 'vendor/lobby/client/**/*.test.ts'],
        },
      },
    ],
  },
});
