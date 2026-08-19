#!/usr/bin/env node
// Renders the app icons with a real headless Chrome and writes the PNGs to
// public/icons/. Run once when the art changes; the PNGs are committed.
// (The manifest's *colours* regenerate every build; the icon art does not —
// see the PWA design spec.)
//
// The art is the game's own tile: a light rounded tile face carrying "A1" on
// the action-blue ground. Colours are inlined deliberately — icon art is a
// drawing, not a binding; if the palette changes enough to matter, rerun this
// with new values.
//
// Reuses the layout gate's Chrome recipe: throwaway profile,
// --remote-debugging-port=0, real port read back from DevToolsActivePort.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// tileScale: how much of the canvas the tile face occupies. Maskable icons
// get 0.72 so the art survives every mask shape (the safe zone is the centre
// 80%); the plain ones get 0.86 and read larger in a browser tab or dock.
const ICONS = [
  { file: 'icon-512.png', size: 512, tileScale: 0.86 },
  { file: 'icon-192.png', size: 192, tileScale: 0.86 },
  { file: 'icon-maskable-512.png', size: 512, tileScale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, tileScale: 0.86 },
];

const page = (size, tileScale) => {
  const tile = Math.round(size * tileScale);
  const radius = Math.round(tile * 0.14);
  const font = Math.round(tile * 0.44);
  return `data:text/html,${encodeURIComponent(`<!doctype html><html><body style="margin:0">
    <div style="width:${size}px;height:${size}px;background:#2563eb;display:flex;align-items:center;justify-content:center">
      <div style="width:${tile}px;height:${tile}px;background:#f9fafb;border-radius:${radius}px;
                  box-shadow:inset 0 -${Math.max(2, Math.round(tile * 0.03))}px 0 rgba(0,0,0,0.12);
                  display:flex;align-items:center;justify-content:center;
                  font-family:system-ui,sans-serif;font-weight:600;font-size:${font}px;color:#374151">A1</div>
    </div></body></html>`)}`;
};

function readDevToolsPort(dir, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const first = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      if (first) return Number(first);
    } catch { /* not written yet */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error('Chrome never wrote DevToolsActivePort');
}

const profile = mkdtempSync(join(tmpdir(), 'acquire-icons-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill('SIGTERM'); } catch { /* gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ }
};
process.on('exit', cleanup);

const port = readDevToolsPort(profile);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${port}/json/version`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));

let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const myId = (id += 1);
  const timer = setTimeout(() => { pending.delete(myId); reject(new Error(`CDP ${method} timed out`)); }, 30000);
  pending.set(myId, (msg) => { clearTimeout(timer); resolve(msg); });
  ws.send(JSON.stringify({ id: myId, method, params }));
});

mkdirSync(OUT_DIR, { recursive: true });
await send('Page.enable');
for (const { file, size, tileScale } of ICONS) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: page(size, tileScale) });
  await new Promise((r) => setTimeout(r, 400));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, file), Buffer.from(shot.result.data, 'base64'));
  console.log(`✓ ${file} (${size}x${size})`);
}

ws.close();
cleanup();
process.exit(0);
