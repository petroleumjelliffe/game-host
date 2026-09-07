// The build half's own suite: placeholder substitution (including the
// in-a-comment trap that bit acquire twice in one day), precache derivation
// against a fixture dist, and the cache-name hash — identical inputs must
// reuse a name, any content change must mint a new one.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IndexHtmlTransformHook, ResolvedConfig } from 'vite';
import { pwaPlaceholders, swFromBuild } from './plugins';

function htmlHandler(themeColor: string): (html: string) => string {
  const plugin = pwaPlaceholders({ themeColor });
  const hook = plugin.transformIndexHtml as { order: string; handler: IndexHtmlTransformHook };
  expect(hook.order).toBe('pre');
  return (html) => hook.handler.call(undefined as never, html, { path: '/', filename: 'index.html' }) as string;
}

describe('pwaPlaceholders', () => {
  it('substitutes every occurrence, comments included', () => {
    const transform = htmlHandler('#123456');
    const html =
      '<!-- __THEME_COLOR__ is substituted; __PWA_BASE__ too -->\n' +
      '<meta name="theme-color" content="__THEME_COLOR__" />\n' +
      '<link rel="manifest" href="__PWA_BASE__manifest.webmanifest" />';
    const out = transform(html);
    expect(out).not.toContain('__THEME_COLOR__');
    expect(out).not.toContain('__PWA_BASE__');
    expect(out).toContain('content="#123456"');
    // A bare "/" — Vite's own base-prefixing runs exactly once on top.
    expect(out).toContain('href="/manifest.webmanifest"');
  });
});

describe('swFromBuild', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pwa-plugin-'));
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), '<html>shell</html>');
    writeFileSync(join(root, 'dist', 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(root, 'dist', 'manifest.webmanifest'), '{}');
    // The three exclusions: sourcemaps, a previous sw.js, the Pages 404 shim.
    writeFileSync(join(root, 'dist', 'assets', 'app-abc123.js.map'), '{}');
    writeFileSync(join(root, 'dist', 'sw.js'), 'stale worker');
    writeFileSync(join(root, 'dist', '404.html'), 'redirect shim');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(base = '/acquire/'): string {
    const plugin = swFromBuild({ cachePrefix: 'acquire', appName: 'Acquire' });
    const config = {
      root,
      base,
      build: { outDir: 'dist' },
      logger: { info: () => undefined },
    } as unknown as ResolvedConfig;
    (plugin.configResolved as (c: ResolvedConfig) => void)(config);
    (plugin.closeBundle as () => void)();
    return readFileSync(join(root, 'dist', 'sw.js'), 'utf8');
  }

  it('derives the precache from the emitted files, under the base path', () => {
    const sw = run();
    expect(sw).toContain('"/acquire/index.html"');
    expect(sw).toContain('"/acquire/assets/app-abc123.js"');
    expect(sw).toContain('"/acquire/manifest.webmanifest"');
    expect(sw).not.toContain('.map');
    expect(sw).not.toContain('404.html');
    // No placeholder survives — the shipped-a-placeholder failure mode.
    expect(sw).not.toMatch(/__[A-Z_]+__/);
  });

  it('names the cache from content: identical builds agree, any change re-mints', () => {
    const first = run().match(/acquire-[0-9a-f]{12}/)?.[0];
    const again = run().match(/acquire-[0-9a-f]{12}/)?.[0];
    expect(first).toBeDefined();
    expect(again).toBe(first);
    writeFileSync(join(root, 'dist', 'assets', 'app-abc123.js'), 'console.log(2)');
    const changed = run().match(/acquire-[0-9a-f]{12}/)?.[0];
    expect(changed).not.toBe(first);
  });

  it('ships both jobs: precache/update flow and the push handlers, no auto skipWaiting', () => {
    const sw = run('/wordgame/');
    // Push half — what wordgame's old worker did, now built in.
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("addEventListener('notificationclick'");
    expect(sw).toContain('"Acquire"'); // the JSON-encoded fallback title
    // Update ruling: skipWaiting only behind the user-initiated message.
    // Comments stripped first — the template's install comment *names* the
    // call precisely to say it is absent.
    const code = sw.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    const installBlock = code.slice(
      code.indexOf("addEventListener('install'"),
      code.indexOf("addEventListener('activate'"),
    );
    expect(installBlock).not.toContain('skipWaiting()');
    expect(sw).toContain('SKIP_WAITING');
  });
});
