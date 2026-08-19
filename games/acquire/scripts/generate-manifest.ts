// Writes public/manifest.webmanifest from the app's own tokens.
//
// Generated, never hand-edited, and that is the point rather than a nicety:
// the Aqua Titanium reskin rewrites the palette in `src/game/tokens.ts`, and a
// manifest carrying hand-copied hex would keep the old theme colour on
// installed devices — where it is hardest to notice — after the reskin lands.
// Running this at every build (`prebuild`) makes the palette flow through.
//
// Runs under tsx. Importing from `src/game/tokens.ts` here is safe because its
// only dependency is `engine/`, which is Node-clean by construction — the
// vitest `node` project exists to keep it that way.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PATH } from '../basePath';
import { APP_COLORS } from '../src/game/tokens';

const manifest = {
  name: 'Acquire — Startups',
  short_name: 'Acquire',
  description: 'The classic tile-and-shares board game, with startups. Pass-and-play works fully offline; online games need a network.',
  // The owner's ruling (2026-08-08): standalone, not fullscreen. iOS treats
  // fullscreen as standalone anyway, so the two differ only by hiding the
  // Android status bar — not worth diverging per platform.
  display: 'standalone',
  start_url: `${BASE_PATH}/`,
  scope: `${BASE_PATH}/`,
  theme_color: APP_COLORS.theme,
  background_color: APP_COLORS.background,
  orientation: 'any',
  // Relative to the manifest's own URL, so these resolve under the base path
  // in both dev and build — base is uniform now — without it being written
  // down here.
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'manifest.webmanifest');
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ manifest.webmanifest written (theme ${APP_COLORS.theme}, background ${APP_COLORS.background})`);
