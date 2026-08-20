// apps/host/compiled.test.ts
// The composed host, compiled — and the one property compilation breaks.
//
// Every game finds its built client relative to something. Until this suite
// existed, that something was the game module's own file location
// (`import.meta.url`), which is correct under `tsx` and wrong under every
// emit shape there is: an `outDir` moves the module to a different depth, and
// a bundle collapses all three game modules into one file, so all three
// compute the *same* path and at most one of them could be right.
//
// The failure is quiet, which is why it gets a test rather than a comment. A
// game whose dist path is wrong does not crash; Rail Baron and Acquire log
// "no built client" and skip their static mount, so the game simply 404s at
// its own base path. That looks like a proxy problem, or a build problem, or
// anything except what it is.
//
// So: bundle the real composition into a directory at a different depth, boot
// it under plain `node`, and read back which dist directory each game
// resolved. No ports, no built clients required — mounting is what computes
// the path, and both the found and the missing branch print it.

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, '.compiled-test');

/**
 * Where each game's built client actually lives, spelled out rather than
 * derived, so this suite fails when a layout changes instead of following it.
 * Marco Polo's client is a subdirectory of its package; the other two build
 * to their package root. That asymmetry is exactly why the host cannot own
 * these paths and each game must.
 */
const EXPECTED_DIST: Readonly<Record<string, string>> = {
  'Rail Baron': join(REPO, 'games', 'railbaron', 'dist'),
  Acquire: join(REPO, 'games', 'acquire', 'dist'),
  'Marco Polo': join(REPO, 'games', 'marcopolo', 'client', 'dist'),
};

/**
 * Bundles `createHost` and everything it reaches, then runs it once.
 *
 * `node_modules` stays external — express and socket.io are not what is under
 * test, and bundling them would only add ways for this to fail for an
 * unrelated reason. Everything of ours is inlined, which is the whole point:
 * it is what erases the per-game module locations.
 *
 * The output lands inside the repo rather than in a temp directory because a
 * bundle with external packages still resolves them at runtime, and from
 * `/tmp` there is no `node_modules` to walk up to.
 */
async function bootCompiled(): Promise<string> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Mounting is all this needs to do: every game resolves its dist while
  // mounting, and prints it either way. Not listening keeps the test free of
  // ports, and free of the flakes that come with them.
  await writeFile(
    join(OUT, 'entry.ts'),
    [
      "import { createHost } from '../host.js';",
      'await createHost({ dataDir: process.env.DATA_DIR as string });',
      "console.log('MOUNTED');",
      'process.exit(0);',
    ].join('\n'),
  );

  await build({
    entryPoints: [join(OUT, 'entry.ts')],
    outfile: join(OUT, 'entry.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'silent',
    plugins: [{
      name: 'externalise-node-modules',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          if (a.kind === 'entry-point') return null;
          if (a.path.startsWith('.') || a.path.startsWith('/')) return null;
          if (a.path.startsWith('@game-host/')) return null;
          return { external: true };
        });
      },
    }],
  });

  const dataDir = await mkdtemp(join(tmpdir(), 'compiled-host-'));
  try {
    return await new Promise<string>((res, rej) => {
      const child = spawn(process.execPath, [join(OUT, 'entry.mjs')], {
        env: { ...process.env, DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
      child.on('error', rej);
      child.on('exit', (code) => {
        if (code === 0) res(out);
        // The output is the diagnostic. A compiled host that cannot boot at
        // all is a different bug from one that boots and looks in the wrong
        // place, and the message has to be able to tell them apart.
        else rej(new Error(`compiled host exited ${code}:\n${out}`));
      });
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe('the host, compiled', () => {
  it('boots under plain node with no transpiler', async () => {
    expect(await bootCompiled()).toContain('MOUNTED');
  });

  it.each(Object.entries(EXPECTED_DIST))(
    'serves %s from its own package, not from wherever the code was emitted',
    async (_title, dist) => {
      expect(await bootCompiled()).toContain(dist);
    },
  );
});
