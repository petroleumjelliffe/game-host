import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Default environment is Node; client/identity.test.ts opts into jsdom
    // per-file via a `@vitest-environment` pragma, since it is the only
    // suite that needs a browser Storage.
    pool: 'forks',
    // Node 22+'s built-in `localStorage` global (experimental, and undefined
    // without --localstorage-file) shadows jsdom's own Storage
    // implementation on globalThis. Disable it so jsdom's localStorage wins
    // wherever a test file opts into the jsdom environment.
    execArgv: ['--no-experimental-webstorage'],
  },
});
