#!/usr/bin/env node
// Runs every workspace package's vitest suite as its own top-level
// `vitest run --root <pkg>` invocation (see CLAUDE.md's Testing section for
// why: a single root `test.projects` array silently drops setupFiles for
// any package — Acquire, Rail Baron — that already nests its own projects).
//
// Spawned in parallel and always let to finish: a plain `&&` chain stops at
// the first failing package, which means a broken lobby suite hides three
// games' worth of results and turns every fix into its own separate
// discovery. Each child's output is buffered and printed as one block after
// it completes, so four suites running concurrently don't interleave their
// output — parallel for speed, but read like a sequential log.
import { spawn } from 'node:child_process';

const packages = [
  ['lobby', 'packages/lobby'],
  ['marcopolo', 'games/marcopolo'],
  ['railbaron', 'games/railbaron'],
  ['acquire', 'games/acquire'],
];

function runOne(name, root) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vitest', 'run', '--root', root], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ name, root, code, out }));
    child.on('error', (err) => resolve({ name, root, code: 1, out: `${out}\n${err.stack ?? err}\n` }));
  });
}

// Vitest's own summary lines, e.g.:
//   " Test Files  5 passed (5)"
//   " Test Files  53 failed | 92 passed (145)"
//   " Tests  393 failed | 1129 passed (1522)"
// The total is always the number in the trailing parentheses.
function parseTotal(out, label) {
  const re = new RegExp(String.raw`${label}\s+.*\((\d+)\)`);
  const match = out.match(re);
  return match ? Number(match[1]) : null;
}

const results = await Promise.all(packages.map(([name, root]) => runOne(name, root)));

for (const r of results) {
  console.log(`\n=== ${r.name} (${r.root}) ===`);
  process.stdout.write(r.out);
}

console.log('\n--- summary ---');
let anyFailed = false;
let totalFiles = 0;
let totalTests = 0;
let allTotalsKnown = true;

for (const r of results) {
  const files = parseTotal(r.out, 'Test Files');
  const tests = parseTotal(r.out, 'Tests');
  if (files == null || tests == null) allTotalsKnown = false;
  else {
    totalFiles += files;
    totalTests += tests;
  }
  const status = r.code === 0 ? 'PASS' : 'FAIL';
  if (r.code !== 0) anyFailed = true;
  const counts = files != null && tests != null ? `${tests} tests / ${files} files` : '(no test summary found)';
  console.log(`${status}  ${r.name.padEnd(10)} exit ${r.code}  ${counts}`);
}

if (allTotalsKnown) {
  console.log(`\n${totalTests} tests / ${totalFiles} files across ${packages.length} packages`);
}

if (anyFailed) {
  console.log('\nAt least one package failed — see its block above for details.');
  process.exit(1);
}
