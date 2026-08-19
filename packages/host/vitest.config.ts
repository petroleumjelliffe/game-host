import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Node throughout: this package is the host contract and the error
    // boundary. Nothing here has a DOM, and nothing here should grow one —
    // a game's client is the game's business.
  },
});
