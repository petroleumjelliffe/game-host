// apps/host/compiled.test.ts
// The composed host, compiled — and the two things compiling can break.
//
// Both deployments run this artifact, so "it works under tsx" stops being the
// question. Everything else in this package boots the host in-process through
// `startTestHost`, which is the right shape for testing composition and the
// wrong shape for testing the build: it never leaves the transpiler behind.
//
// What compiling breaks, and why each gets a test:
//
// 1. **Where each game looks for its built client.** Every game resolved that
//    from `import.meta.url` until 2026-08-20, which is correct under `tsx`
//    and wrong under every emit shape there is — an `outDir` moves the module
//    to a different depth, and a bundle collapses all three game modules into
//    one file, so all three compute the same path and at most one can be
//    right. Bundled, Rail Baron and Acquire both looked in `apps/host/dist`.
//
//    The failure is quiet, which is why it gets a test rather than a comment:
//    a game with the wrong dist path does not crash, it logs "no built
//    client", skips its static mount and 404s at its own base path. That
//    reads as a proxy problem, or a build problem, or anything but what it is.
//
// 2. **Three socket.io servers on one HTTP server.** The comments in every
//    game's `mount` are emphatic that this arrangement is delicate —
//    `destroyUpgrade: false`, `serveClient: false`, never `io.close()` — and
//    every one of those hazards is about module-level wiring that a bundler
//    is free to reorder and to deduplicate. Nothing about bundling *should*
//    disturb it. "Should" is doing enough work there to deserve a client that
//    actually connects.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, describe, expect, it } from 'vitest';
import { hostBuildOptions } from './build.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, '.compiled-test');

/**
 * Where each game's built client actually lives, spelled out rather than
 * derived, so this fails when a layout changes instead of following it.
 * Marco Polo's client is a subdirectory of its package; the other two build
 * to their package root. That asymmetry is exactly why the host cannot own
 * these paths and each game must.
 */
const EXPECTED_DIST: Readonly<Record<string, string>> = {
  'Rail Baron': join(REPO, 'games', 'railbaron', 'dist'),
  Acquire: join(REPO, 'games', 'acquire', 'dist'),
  'Marco Polo': join(REPO, 'games', 'marcopolo', 'client', 'dist'),
};

/** Every game's socket mount, which is its base path and not the bare default. */
const SOCKET_PATHS = ['/railbaron/socket.io', '/acquire/socket.io', '/marcopolo/socket.io'];

/**
 * Bundles an entry with the **shipped** build options and returns the output.
 *
 * `hostBuildOptions` rather than a local copy, and that is the difference
 * between this suite meaning something and not. The bugs it exists to catch
 * are all consequences of how modules get resolved and merged, so a suite
 * bundling by its own rules could pass green while the real build resolved
 * something else entirely. The only deviation permitted is the entry point.
 *
 * Output lands inside the repo rather than in a temp directory: a bundle with
 * external packages still resolves them at runtime, and from `/tmp` there is
 * no `node_modules` to walk up to.
 */
async function compile(name: string, source: string): Promise<string> {
  await mkdir(OUT, { recursive: true });
  const entry = join(OUT, `${name}.ts`);
  const outfile = join(OUT, `${name}.mjs`);
  await writeFile(entry, source);
  await build({ ...hostBuildOptions(outfile, entry), logLevel: 'silent' });
  return outfile;
}

const dataDirs: string[] = [];
const running: ChildProcess[] = [];

async function freshDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compiled-host-'));
  dataDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const child of running) child.kill();
  await Promise.all(dataDirs.map((d) => rm(d, { recursive: true, force: true })));
  await rm(OUT, { recursive: true, force: true });
});

/**
 * Mounts every game under plain `node` and returns everything it printed.
 *
 * Mounting is all this needs: each game resolves its dist while mounting and
 * prints it either way, found or missing. Not listening keeps the check free
 * of ports — and of the flakes that come with them — and means it needs no
 * built clients to be meaningful.
 */
async function mountCompiled(): Promise<string> {
  const bundle = await compile('mount-only', [
    "import { createHost } from '../host.js';",
    'await createHost({ dataDir: process.env.DATA_DIR as string });',
    "console.log('MOUNTED');",
    'process.exit(0);',
  ].join('\n'));

  const dataDir = await freshDataDir();
  return new Promise<string>((res, rej) => {
    const child = spawn(process.execPath, [bundle], {
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('error', rej);
    // The output is the diagnostic. A compiled host that cannot boot at all is
    // a different bug from one that boots and looks in the wrong place, and
    // the message has to be able to tell them apart.
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`exited ${code}:\n${out}`))));
  });
}

/** The compiled host, listening on an ephemeral port, as a real process. */
async function listenCompiled(): Promise<{ url: string }> {
  const bundle = await compile('listening', [
    "import type { AddressInfo } from 'node:net';",
    "import { createHost } from '../host.js';",
    'const host = await createHost({ dataDir: process.env.DATA_DIR as string });',
    'host.httpServer.listen(0, () => {',
    "  console.log(`PORT ${(host.httpServer.address() as AddressInfo).port}`);",
    '});',
  ].join('\n'));

  const dataDir = await freshDataDir();
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.push(child);

  return new Promise((res, rej) => {
    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString();
      const port = /^PORT (\d+)$/m.exec(out)?.[1];
      if (port) res({ url: `http://127.0.0.1:${port}` });
    });
    child.on('error', rej);
    child.on('exit', (code) => rej(new Error(`compiled host exited ${code} before listening`)));
  });
}

describe('the host, compiled', () => {
  it('boots under plain node with no transpiler', async () => {
    expect(await mountCompiled()).toContain('MOUNTED');
  });

  it.each(Object.entries(EXPECTED_DIST))(
    'serves %s from its own package, not from wherever the code was emitted',
    async (_title, dist) => {
      expect(await mountCompiled()).toContain(dist);
    },
  );

  it('still gives every game its own socket.io server', async () => {
    const { url } = await listenCompiled();

    // Connected one at a time rather than in parallel, on purpose: the
    // engine.io upgrade hazard these paths guard against is a race between
    // attached engines, and three simultaneous handshakes would make a
    // failure land on whichever game lost, differently each run.
    for (const path of SOCKET_PATHS) {
      const socket: Socket = connect(url, { path, transports: ['websocket'], reconnection: false });
      try {
        await new Promise<void>((res, rej) => {
          socket.on('connect', () => res());
          socket.on('connect_error', (e) => rej(new Error(`${path}: ${e.message}`)));
        });
        expect(socket.connected).toBe(true);
      } finally {
        socket.disconnect();
      }
    }
  });

  it('answers the aggregate health for all three games', async () => {
    const { url } = await listenCompiled();
    const body = await (await fetch(`${url}/health`)).json() as {
      ok: boolean; games: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.games).sort()).toEqual(['/acquire', '/marcopolo', '/railbaron']);
  });
});
