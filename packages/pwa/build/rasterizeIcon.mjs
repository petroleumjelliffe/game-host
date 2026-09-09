#!/usr/bin/env node
// Renders an SVG icon to a full-bleed PNG with headless Chrome — the shared
// rasterizing tool behind each game's committed apple-touch-icon.png. iOS
// ignores SVG for home-screen icons (both the apple-touch-icon link and
// manifest entries), and the installed app is exactly where push lives on
// iOS, so every installable game needs one real PNG. Run once when the art
// changes; the PNG is committed (acquire's generate-icons.mjs precedent).
//
// Full-bleed deliberately: iOS applies its own corner mask, so the SVG's
// rounded outer rect is drawn over a body of the same background colour and
// the corners disappear rather than shipping as white.
//
// Usage: node rasterizeIcon.mjs <svg> <size> <background> <out.png>
// Chrome comes from CHROME_PATH, falling back to the Playwright install.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [svgPath, sizeArg, background, outPath] = process.argv.slice(2);
const size = Number(sizeArg);
if (!svgPath || !Number.isInteger(size) || !background || !outPath) {
  console.error('usage: rasterizeIcon.mjs <svg> <size> <background> <out.png>');
  process.exit(2);
}

const chrome = process.env.CHROME_PATH
  ?? ['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find(existsSync);
if (!chrome) {
  console.error('rasterizeIcon: no Chrome found — set CHROME_PATH');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'pwa-icon-'));
try {
  // An <img> rather than inline SVG: an image element scales the SVG to its
  // box regardless of the file's own width/height attributes, which inline
  // embedding does not reliably do.
  const svg = Buffer.from(readFileSync(svgPath, 'utf8')).toString('base64');
  const html = `<!doctype html><html><body style="margin:0;background:${background}">` +
    `<img style="display:block;width:${size}px;height:${size}px" ` +
    `src="data:image/svg+xml;base64,${svg}"></body></html>`;
  const page = join(work, 'icon.html');
  const shot = join(work, 'shot.png');
  writeFileSync(page, html);
  execFileSync(chrome, [
    '--headless=new',
    `--user-data-dir=${join(work, 'profile')}`,
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    `--screenshot=${shot}`,
    `file://${page}`,
  ], { stdio: 'pipe' });
  copyFileSync(shot, outPath);
  console.log(`✓ ${outPath} (${size}x${size}, ${background})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
