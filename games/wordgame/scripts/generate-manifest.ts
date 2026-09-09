// Writes public/manifest.webmanifest through the shared generator
// (@game-host/pwa) at every build (`prebuild`) — this replaces the
// hand-written manifest the game carried while its worker was push-only.
// Runs under tsx.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeManifest } from '@game-host/pwa/build/manifest';
import { BASE_PATH } from '../basePath';
import { BACKGROUND_COLOR, THEME_COLOR } from '../appColors';

writeManifest(
  {
    name: 'Word Game',
    shortName: 'Word Game',
    // The install-identity trio: an installed home-screen icon is bound to
    // these, so they are append-only — change one and every installed app
    // becomes a different app. `id` equals `start_url`, the value browsers
    // computed while the field was absent, so declaring it re-keys no
    // existing install.
    id: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    startUrl: `${BASE_PATH}/`,
    display: 'standalone',
    themeColor: THEME_COLOR,
    backgroundColor: BACKGROUND_COLOR,
    icons: [
      { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
  },
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'manifest.webmanifest'),
);
console.log(`✓ manifest.webmanifest written (theme ${THEME_COLOR})`);
