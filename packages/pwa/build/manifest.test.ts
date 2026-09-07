import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestFrom, writeManifest, type PwaManifestConfig } from './manifest';

const CONFIG: PwaManifestConfig = {
  name: 'Acquire — Startups',
  shortName: 'Acquire',
  description: 'A game.',
  id: '/acquire/',
  scope: '/acquire/',
  startUrl: '/acquire/',
  themeColor: '#0a936c',
  backgroundColor: '#f4f1e8',
  icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }],
};

describe('manifestFrom', () => {
  it('carries the install-identity trio through verbatim', () => {
    const m = manifestFrom(CONFIG);
    expect(m.id).toBe('/acquire/');
    expect(m.scope).toBe('/acquire/');
    expect(m.start_url).toBe('/acquire/');
  });

  it('defaults display and orientation, passes everything else through', () => {
    const m = manifestFrom(CONFIG);
    expect(m).toMatchObject({
      name: 'Acquire — Startups',
      short_name: 'Acquire',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#0a936c',
      background_color: '#f4f1e8',
    });
    expect(m.icons).toEqual(CONFIG.icons);
  });

  it('omits description when absent rather than writing undefined', () => {
    const { description: _dropped, ...rest } = CONFIG;
    expect('description' in manifestFrom(rest)).toBe(false);
  });
});

describe('writeManifest', () => {
  it('writes pretty JSON with a trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwa-manifest-'));
    try {
      const out = join(dir, 'manifest.webmanifest');
      writeManifest(CONFIG, out);
      const text = readFileSync(out, 'utf8');
      expect(text.endsWith('\n')).toBe(true);
      expect(JSON.parse(text)).toEqual(manifestFrom(CONFIG));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
