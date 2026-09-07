import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Node by default: the build/ half is Vite-plugin and filesystem code.
    // The client/ half opts into jsdom per file with a
    // `// @vitest-environment jsdom` pragma, the lobby's arrangement.
    pool: 'forks',
    // Node 22+'s experimental localStorage global would shadow jsdom's;
    // same flag the lobby and every game's app project carries.
    execArgv: ['--no-experimental-webstorage'],
  },
});
