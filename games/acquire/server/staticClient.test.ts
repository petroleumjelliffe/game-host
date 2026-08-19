// The server serving its own built client — one process as the whole game,
// for LAN hosting behind the game-host repo's front door. A dist directory
// is faked per test so the suite doesn't depend on `npm run build`.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_PATH } from '../basePath.js';
import { createServer, type ServerHandle } from './index.js';

let handle: ServerHandle | undefined;

afterEach(async () => {
  handle?.io.close();
  await new Promise<void>((resolve) => {
    if (handle === undefined) { resolve(); return; }
    handle.httpServer.close(() => { resolve(); });
  });
  handle = undefined;
});

async function boot(distDir: string): Promise<string> {
  handle = createServer({ distDir });
  await new Promise<void>((resolve) => { handle?.httpServer.listen(0, resolve); });
  const { port } = handle.httpServer.address() as AddressInfo;
  return `http://localhost:${port}`;
}

async function fakeDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'acq-static-dist-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>acq-marker</title>');
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'assets', 'app.js'), 'export const marker = 1;');
  return dist;
}

describe('serving the built client', () => {
  it(`serves index.html at ${BASE_PATH}/`, async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('acq-marker');
  });

  it('serves real files as themselves', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('marker = 1');
  });

  it('hands client-side routes back to the router (SPA fallback)', async () => {
    const url = await boot(await fakeDist());
    const res = await fetch(`${url}${BASE_PATH}/room/ABCD`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('acq-marker');
  });

  it('boots fine with no build present, and the base path 404s', async () => {
    const emptyDist = await mkdtemp(join(tmpdir(), 'acq-static-empty-'));
    const url = await boot(emptyDist);
    expect((await fetch(`${url}${BASE_PATH}/`)).status).toBe(404);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });
});
