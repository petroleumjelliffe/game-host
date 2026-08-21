// The server serving its own built client — the "one process is the whole
// game" half of LAN hosting. A real dist directory is faked per test so the
// suite doesn't depend on `npm run build` having run.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_PATH } from '../basePath.js';
import { startServer, type RunningServer } from './index.js';

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(distDir?: string): Promise<string> {
  const gamesDir = await mkdtemp(join(tmpdir(), 'rb-static-games-'));
  server = await startServer(
    distDir === undefined ? { port: 0, gamesDir } : { port: 0, gamesDir, distDir },
  );
  return `http://localhost:${server.port}`;
}

async function fakeDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'rb-static-dist-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>rb-marker</title>');
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'assets', 'app.js'), 'export const marker = 1;');
  return dist;
}

describe('serving the built client', () => {
  it(`serves index.html at ${BASE_PATH}/`, async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('rb-marker');
  });

  it('serves real files as themselves', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('marker = 1');
  });

  it('hands client-side routes back to the router (SPA fallback)', async () => {
    // A refresh on /railbaron/room/ABCD is a route, not a file: index.html,
    // not a 404 — the job 404.html does on GitHub Pages, done properly here.
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/room/ABCD`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('rb-marker');
  });

  it('leaves non-GETs to fall through rather than answering with a page', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/room/ABCD`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('boots fine with no build present, and the base path 404s', async () => {
    // `npm run dev:server` without `npm run build` is the ordinary dev case —
    // Vite serves the client then. The server must not crash or half-serve.
    const emptyDist = await mkdtemp(join(tmpdir(), 'rb-static-empty-'));
    const url = await boot(emptyDist);
    expect((await fetch(`${url}${BASE_PATH}/`)).status).toBe(404);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('keeps /health at the root regardless', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });

  it(`twins health under ${BASE_PATH}, winning over the SPA fallback`, async () => {
    // The game-host front door forwards only the base path, so a bare
    // /health is unreachable through it — the twin is what Caddy can see.
    // Booted with a dist so the SPA fallback is armed: this asserts the
    // twin is registered ahead of it, JSON rather than index.html.
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/health`);
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });
});

describe('cross-origin access', () => {
  // Headers, not behaviour: a Node client ignores CORS, so only the response
  // can testify. See docs/plans/2026-08-21-cors.md.
  it('sends no CORS headers, even when asked as another origin', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
