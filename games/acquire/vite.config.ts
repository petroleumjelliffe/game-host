import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { BASE_PATH } from "./basePath";
import { APP_COLORS } from "./src/game/tokens";

/** Every file under dir, as paths relative to it. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, root) : [relative(root, full)];
  });
}

export default defineConfig(() => ({
  plugins: [
    react(),
    // Substitutes the PWA placeholders in index.html.
    //
    // __THEME_COLOR__ comes from the same token the manifest generator reads
    // (APP_COLORS in src/game/tokens.ts), so a palette change — the Aqua
    // Titanium reskin rewrites that file — flows into both without either
    // being typed by hand. Safe to import here: tokens.ts depends only on
    // engine/, which is Node-clean by construction.
    //
    // __PWA_BASE__ substitutes to a bare "/", not BASE_PATH. Vite applies
    // config.base itself to every root-relative attribute URL it finds in
    // index.html — href="/manifest.webmanifest", rel="icon", apple-touch-icon
    // — in both dev (via its devHtmlHook) and build (via the equivalent
    // asset-URL rewrite), and base is now BASE_PATH uniformly in both (it
    // used to be "/" in dev only). Substituting BASE_PATH here too made Vite
    // prepend it a *second* time, doubling the path to
    // "/acquire-startups-m1/acquire-startups-m1/manifest.webmanifest" — which
    // the SPA fallback answered with a silent 200 text/html instead of a
    // 404. A bare "/" lets Vite's own base-prefixing run exactly once, so
    // dev and build both end up at "/acquire-startups-m1/manifest.webmanifest".
    //
    // replaceAll, not replace: the first __THEME_COLOR__ in the file is in
    // the comment explaining it, and .replace() substituted the comment and
    // left the actual meta tag carrying the placeholder. Caught by grepping
    // dist, which is why the verification step exists.
    //
    // order: 'pre' (Vite 7 regression fix, 2026-08-09; still required):
    // Vite's own dev-only devHtmlHook runs before any transformIndexHtml
    // hook that doesn't declare 'pre', and it treats an unsubstituted href
    // like "__PWA_BASE__manifest.webmanifest" as a *bare relative* specifier
    // (isBareRelative: starts with a word character, no ':') rather than a
    // root-relative one — a different, import-resolution code path, not a
    // simple base-prepend. 'pre' makes this plugin's substitution run first,
    // so devHtmlHook only ever sees the real root-relative
    // "/manifest.webmanifest" and applies its ordinary base-prefixing to it,
    // same as build. Build is unaffected either way: it never runs
    // devHtmlHook.
    {
      name: "pwa-placeholders-from-tokens",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html
            .replaceAll("__THEME_COLOR__", APP_COLORS.theme)
            .replaceAll("__PWA_BASE__", "/"),
      },
    },
    // Writes dist/sw.js after the build, from scripts/sw.template.js.
    //
    // The precache list is *derived* — every file the build emitted (plus the
    // public/ copies), never a hand-maintained array, so a renamed chunk
    // cannot silently rot it. The cache name is a hash of the listed files'
    // contents: identical builds reuse their cache, any real change mints a
    // new one, and activation prunes the rest. `closeBundle` rather than
    // `writeBundle` because the public/ copies (manifest, icons) are not in
    // the bundle object and this list must include them.
    {
      name: "sw-from-build",
      apply: "build",
      closeBundle() {
        const dist = join(__dirname, "dist");
        const files = walk(dist)
          .filter((f) => !f.endsWith(".map") && f !== "sw.js" && f !== "404.html")
          .sort();
        const hash = createHash("sha256");
        for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
        // replaceAll, always. A .replace() here substituted the first
        // occurrence — which was the template's own comment naming the
        // placeholder — and shipped a worker whose PRECACHE was still the
        // placeholder. The same mistake as index.html's theme colour, made
        // twice in one day; replaceAll is now the house rule for templating.
        const sw = readFileSync(join(__dirname, "scripts", "sw.template.js"), "utf8")
          .replaceAll("__CACHE_NAME__", `acquire-${hash.digest("hex").slice(0, 12)}`)
          .replaceAll("__BASE__", `${BASE_PATH}/`)
          .replaceAll("__PRECACHE__", JSON.stringify(
            files.map((f) => `${BASE_PATH}/${f.replaceAll("\\", "/")}`),
            null, 2,
          ));
        writeFileSync(join(dist, "sw.js"), sw);
        console.log(`✓ sw.js written (${files.length} files precached)`);
      },
    },
  ],
  // 7932 is Acquire's dev-client slot in the cross-game port registry (the
  // game-host repo's PORTS.md); strictPort fails loudly rather than sliding
  // into a neighbour's slot. allowedHosts covers the host machine's mDNS
  // name, which Vite's DNS-rebind guard would otherwise refuse.
  server: {
    port: 7932, strictPort: true, allowedHosts: ['.local'],
    // Dev plays the part Caddy plays in hosting: the client is origin-relative
    // and this proxy carries its socket path to the game server. 4002 per
    // game-host PORTS.md — build tooling, not shipped code.
    //
    // One key: the client's path follows its base, and base is now BASE_PATH
    // in dev and build alike, so there is only one path it ever asks for.
    proxy: {
      [`${BASE_PATH}/socket.io`]: { target: 'http://localhost:4002', ws: true },
    },
  },
  // One base, dev and build alike. The asymmetry this replaces was the sole
  // reason dev needed its own socket path, its own manifest rewrite and a
  // differently-substituted __PWA_BASE__ — see the deletions below.
  base: BASE_PATH,
  test: {
    globals: true,
    environment: 'jsdom',
    // No root-level `setupFiles`: vitest 4's `extends: true` merges arrays,
    // so a child project's `setupFiles: []` does not override a root value —
    // it only adds nothing to it. The `node` project's own `[]` below only
    // means what it says because there is nothing here for it to inherit.
    // Confirmed by the boundary assertion in `session/nodeEnvironment.test.ts`:
    // without this, `globalThis.localStorage` was live under `--project
    // node` too, silently disarming the guard the split below exists for.
    //
    // Two projects, one reason: `engine/`, `session/` and `server/` must not
    // depend on browser globals. They run under Node in production — the
    // server process — and are imported by `src/` as well, so a stray
    // `window.` is a production crash. Under a single jsdom suite `window`
    // always exists and no test can ever catch it. Running them under
    // `environment: 'node'` makes that boundary enforced instead of merely
    // documented. `src/` keeps the jsdom + jest-dom setup it had.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: [
            'engine/**/*.test.ts',
            'session/**/*.test.ts',
            'server/**/*.test.ts',
            // The shared lobby, as a submodule. Its protocol and server
            // halves are node-side; its client half is jsdom and belongs to
            // the `app` project below. A consumer that does not run these
            // will not notice when a submodule bump breaks it.
            'vendor/lobby/protocol/**/*.test.ts',
            'vendor/lobby/server/**/*.test.ts',
          ],
          environment: 'node',
          globals: true,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          include: ['src/**/*.test.{ts,tsx}', 'vendor/lobby/client/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: './src/test/setup.ts',
        },
      },
    ],
  },
}));
