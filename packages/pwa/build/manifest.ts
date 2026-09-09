// packages/pwa/build/manifest.ts
// The manifest writer, extracted from acquire's scripts/generate-manifest.ts
// and made a function of a config object — no game imports here. Each game
// keeps a tiny prebuild script that assembles its config (reading its own
// tokens, which is the point of generating: a reskin flows into the manifest
// without hand-copied hex) and calls writeManifest.

import { writeFileSync } from 'node:fs';

export interface PwaIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface PwaManifestConfig {
  name: string;
  shortName: string;
  description?: string;
  /**
   * The install-identity trio. An installed home-screen icon is bound to
   * these three fields; everything *behind* them updates through the
   * service-worker flow, but changing any of them makes the installed app a
   * different app — "never re-added to the home screen" is bought by keeping
   * them stable forever. They are required rather than derived so that
   * changing one is a deliberate edit to a named field, never a drifted
   * default. `id` should equal `startUrl` unless there is a reason it
   * cannot: that is the value browsers computed while the field was absent,
   * so declaring it re-keys nothing.
   */
  id: string;
  scope: string;
  startUrl: string;
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  themeColor: string;
  backgroundColor: string;
  orientation?: string;
  /** Paths relative to the manifest's own URL, so they resolve under the
   * base path in dev and build alike without naming it. */
  icons: PwaIcon[];
}

export function manifestFrom(config: PwaManifestConfig): Record<string, unknown> {
  return {
    name: config.name,
    short_name: config.shortName,
    ...(config.description === undefined ? {} : { description: config.description }),
    id: config.id,
    display: config.display ?? 'standalone',
    start_url: config.startUrl,
    scope: config.scope,
    theme_color: config.themeColor,
    background_color: config.backgroundColor,
    orientation: config.orientation ?? 'any',
    // Where the OS routes an in-scope link into the installed app at all
    // (Android Chrome by default, desktop Chrome per-app opt-in; never iOS
    // or macOS Safari, which always hand a link from Mail to the browser),
    // reuse the window that is already open rather than launching a second
    // one — a turn nudge lands on the game that is up. Ignored elsewhere,
    // and not part of the install-identity trio.
    launch_handler: { client_mode: 'navigate-existing' },
    icons: config.icons,
  };
}

export function writeManifest(config: PwaManifestConfig, outFile: string): void {
  writeFileSync(outFile, `${JSON.stringify(manifestFrom(config), null, 2)}\n`);
}
