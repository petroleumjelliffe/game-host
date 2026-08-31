import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Node throughout: this package is server plumbing — timers, files,
    // HTTP routes. Nothing here has a DOM, and nothing here should grow one.
  },
});
