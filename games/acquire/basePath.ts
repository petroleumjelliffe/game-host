/**
 * The one copy of the GitHub Pages base path.
 *
 * It used to live three times — `vite.config.ts`, `src/main.tsx`, and (with
 * the PWA) the manifest generator would have been a fourth. Each copy was a
 * place for a rename to miss. Now: `vite.config.ts` imports it, `main.tsx`
 * derives its router basename from Vite's `import.meta.env.BASE_URL` (which
 * Vite itself builds from the config), and the manifest generator imports it
 * for `start_url` and `scope`.
 *
 * Root-level rather than in `src/` because `vite.config.ts` and build scripts
 * run under Node, outside the app graph.
 */
export const BASE_PATH = '/acquire-startups-m1';
