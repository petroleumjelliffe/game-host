// apps/host/build.ts
// Compiling the composed host: one bundle, plain node, no transpiler at boot.
//
// Why a bundle rather than `tsc --outDir`: Rail Baron's server imports are
// extensionless and its tsconfig resolves them under `bundler`, so `tsc`
// output would not run under node without first migrating that game to
// NodeNext — a refactor of the one game with no known bugs, to buy an emit
// shape we do not otherwise want. esbuild resolves those imports the same way
// `tsx` does at runtime today, so the question never comes up. `tsc` keeps the
// job it is actually good at, which is saying no: it runs as `--noEmit`
// against every workspace, and nothing here typechecks anything.
//
// Measured 2026-08-20, median of five, spawn to a served /health:
//   tsx apps/host/main.ts   478ms
//   node on this bundle     134ms
// The 344ms is the smaller half of the reason. The larger half is that
// `tsx` and `vite build` both strip types without checking them, so until
// this landed a type error in server code booted and served happily.

import { build, type BuildOptions, type Plugin } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `node_modules` stays external; everything of ours is inlined.
 *
 * Bundling express and socket.io would buy nothing — they are already
 * JavaScript, so there is no transpilation to save — and would cost the one
 * thing that makes this safe, which is that the deployed dependency graph
 * stays the graph npm installed and audited. It would also drag two packages
 * with conditional requires and native optional deps through a bundler that
 * has to guess about both.
 *
 * `@game-host/*` is the exception, and the whole point: those are TypeScript
 * sources, and inlining them is what removes the transpiler from the boot
 * path.
 */
const inlineOnlyOurCode: Plugin = {
  name: 'inline-only-our-code',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return null;
      if (a.path.startsWith('.') || a.path.startsWith('/')) return null;
      if (a.path.startsWith('@game-host/')) return null;
      return { external: true };
    });
  },
};

/**
 * The one build configuration, exported so the suite that boots the compiled
 * host builds it *this* way rather than an approximation.
 *
 * That matters more than it looks: the failure `compiled.test.ts` exists to
 * catch is a path that resolves differently once modules are bundled, and a
 * test carrying its own copy of these options could pass while the shipped
 * build resolved something else.
 */
export function hostBuildOptions(outfile: string, entry = join(HERE, 'main.ts')): BuildOptions {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    // The engines field says >=24 and both deployments run it. Targeting
    // lower would have esbuild down-level syntax node runs natively.
    target: 'node24',
    // On, and worth the file: a stack trace through a bundle names the
    // bundle's line numbers, which are no use to anyone. `start:host:compiled`
    // passes --enable-source-maps so node actually reads this.
    sourcemap: true,
    logLevel: 'info',
    plugins: [inlineOnlyOurCode],
  };
}

export async function buildHost(outfile = join(HERE, 'dist', 'main.mjs')): Promise<void> {
  await build(hostBuildOptions(outfile));
}

// Only when run as a command. Imported — by the suite, or by anything else
// that wants the options without the side effect — this does nothing.
if (import.meta.main) await buildHost();
