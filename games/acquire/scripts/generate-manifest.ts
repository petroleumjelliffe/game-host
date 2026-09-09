// Writes public/manifest.webmanifest from the app's own tokens, through the
// shared generator (@game-host/pwa).
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

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest } from '@game-host/pwa/build/manifest';
import { BASE_PATH } from '../basePath';
import { APP_COLORS } from '../src/game/tokens';

writeManifest(
  {
    name: 'Acquire — Startups',
    shortName: 'Acquire',
    description: 'The classic tile-and-shares board game, with startups. Pass-and-play works fully offline; online games need a network.',
    // The install-identity trio: an installed home-screen icon is bound to
    // these, so they are append-only — change one and every installed app
    // becomes a different app. `id` equals `start_url`, which is the value
    // browsers computed while the field was absent, so declaring it re-keys
    // no existing install.
    id: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    startUrl: `${BASE_PATH}/`,
    // The owner's ruling (2026-08-08): standalone, not fullscreen. iOS treats
    // fullscreen as standalone anyway, so the two differ only by hiding the
    // Android status bar — not worth diverging per platform.
    display: 'standalone',
    themeColor: APP_COLORS.theme,
    backgroundColor: APP_COLORS.background,
    orientation: 'any',
    // Relative to the manifest's own URL, so these resolve under the base
    // path in both dev and build — base is uniform — without it being
    // written down here.
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'manifest.webmanifest'),
);
console.log(`✓ manifest.webmanifest written (theme ${APP_COLORS.theme}, background ${APP_COLORS.background})`);
