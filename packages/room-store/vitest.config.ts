import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Node throughout: this package is filesystem mechanics for the servers.
    // Nothing here has a DOM, and nothing here should grow one.
  },
});
