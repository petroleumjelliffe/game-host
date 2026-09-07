// packages/pwa/build/plugins.ts
// The two Vite plugins every game's PWA rides, extracted from acquire's
// vite.config.ts and parameterized on game identity only — paths, base and
// outDir all come from Vite's own resolved config, so a game cannot hand
// this a location that disagrees with its build.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Plugin, ResolvedConfig } from 'vite';

/** Every file under dir, as paths relative to it. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, root) : [relative(root, full)];
  });
}

/**
 * Substitutes the PWA placeholders in index.html.
 *
 * The theme color comes from the same value the game's manifest config
 * carries, so a palette change flows into both without either being typed
 * by hand.
 *
 * The base placeholder substitutes to a bare "/", never the base path. Vite
 * applies config.base itself to every root-relative attribute URL it finds
 * in index.html — manifest link, icons, apple-touch-icon — in both dev (via
 * its devHtmlHook) and build. Substituting the base path here too made Vite
 * prepend it a *second* time, doubling the path — which the SPA fallback
 * answered with a silent 200 text/html instead of a 404. A bare "/" lets
 * Vite's own base-prefixing run exactly once.
 *
 * replaceAll, not replace: the first occurrence of a placeholder in the
 * file may be in a comment explaining it, and .replace() once substituted
 * the comment and left the actual meta tag carrying the placeholder.
 * Caught by grepping dist, which is why the artifact checks exist.
 *
 * order: 'pre' (Vite 7 regression fix, 2026-08-09; still required): Vite's
 * own dev-only devHtmlHook runs before any transformIndexHtml hook that
 * doesn't declare 'pre', and it treats an unsubstituted href starting with
 * a placeholder as a *bare relative* specifier (isBareRelative: starts with
 * a word character, no ':') rather than a root-relative one — a different,
 * import-resolution code path, not a simple base-prepend. 'pre' makes this
 * substitution run first, so devHtmlHook only ever sees the real
 * root-relative URL and applies its ordinary base-prefixing, same as build.
 */
export function pwaPlaceholders(options: { themeColor: string }): Plugin {
  return {
    name: 'pwa:placeholders',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html
          .replaceAll('__THEME_COLOR__', options.themeColor)
          .replaceAll('__PWA_BASE__', '/'),
    },
  };
}

/**
 * Writes dist/sw.js after the build, from sw.template.js beside this file.
 *
 * The precache list is *derived* — every file the build emitted (plus the
 * public/ copies), never a hand-maintained array, so a renamed chunk cannot
 * silently rot it. The cache name is a hash of the listed files' contents:
 * identical builds reuse their cache, any real change mints a new one, and
 * activation prunes the rest — the upgrade check with no version string to
 * maintain. `closeBundle` rather than `writeBundle` because the public/
 * copies (manifest, icons) are not in the bundle object and this list must
 * include them.
 *
 * `cachePrefix` names the cache (usually the game id); `appName` is the
 * push notification's fallback title for a malformed payload.
 */
export function swFromBuild(options: { cachePrefix: string; appName: string }): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'pwa:sw-from-build',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const dist = resolve(config.root, config.build.outDir);
      // Vite normalizes a resolved base to carry its trailing slash.
      const base = config.base;
      const files = walk(dist)
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js' && f !== '404.html')
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      // replaceAll, always — see pwaPlaceholders. And placeholder names stay
      // out of the template's own comments, for the same reason.
      const template = fileURLToPath(new URL('./sw.template.js', import.meta.url));
      const sw = readFileSync(template, 'utf8')
        .replaceAll('__CACHE_NAME__', `${options.cachePrefix}-${hash.digest('hex').slice(0, 12)}`)
        .replaceAll('__APP_NAME__', JSON.stringify(options.appName))
        .replaceAll('__BASE__', base)
        .replaceAll('__PRECACHE__', JSON.stringify(
          files.map((f) => `${base}${f.replaceAll('\\', '/')}`),
          null, 2,
        ));
      writeFileSync(join(dist, 'sw.js'), sw);
      config.logger.info(`✓ sw.js written (${files.length} files precached)`);
    },
  };
}
