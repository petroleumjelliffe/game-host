/**
 * The one copy of the GitHub Pages base path.
 *
 * Root-level rather than in `src/` because `vite.config.ts` and build
 * scripts run under Node, outside the app graph. Acquire's equivalent
 * records having lived in three places — the Vite config, the entry point
 * and the manifest generator — before it was consolidated; this file exists
 * before that can happen here.
 *
 * Deployed to GitHub Pages by .github/workflows/deploy.yml, which serves the
 * repository at this path. Change it here and the Vite config, the router's
 * basename and the built asset URLs all follow.
 */
export const BASE_PATH = '/railbaron';
