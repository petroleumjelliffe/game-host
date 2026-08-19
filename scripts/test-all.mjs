#!/usr/bin/env node
// Runs every workspace package's vitest suite as its own top-level
// `vitest run --root <pkg>` invocation (see CLAUDE.md's Testing section for
// why: a single root `test.projects` array silently drops setupFiles for
// any package — Acquire, Rail Baron — that already nests its own projects).
//
// Every package is let to finish regardless of another's outcome: a plain
// `&&` chain stops at the first failure, which means a broken lobby suite
// hides three games' worth of results and turns every fix into its own
// separate discovery.
//
// Not spawned all four at once, though. Each vitest process sizes its own
// worker pool to the whole machine, so four full-machine-sized pools
// competing at once oversubscribe by roughly 4x — enough to push
// railbaron's slowest test (120 fake-timer ticks with full DOM queries per
// tick) past its default timeout under contention alone, no code change
// behind it, and CI runners with 2-4 cores feel this worse than a fat dev
// machine does. Railbaron and acquire (the two heavy suites) run one after
// the other; lobby and marcopolo (the two light ones) run together — at
// most three full-machine-sized pools contending at once, never four.
import { spawn } from 'node:child_process';

const packages = [
  ['lobby', 'packages/lobby'],
  ['host', 'packages/host'],
  ['marcopolo', 'games/marcopolo'],
  ['railbaron', 'games/railbaron'],
  ['acquire', 'games/acquire'],
];

// Weight is measured in worker-pool contention, not file count. `host` boots
// a socket.io server per test but holds no DOM and no game state, so it sits
// with the light pair. `apps-host` will not: it boots three whole games per
// file, and belongs with the heavy ones when it arrives.
const LIGHT = new Set(['lobby', 'host', 'marcopolo']);
const light = packages.filter(([name]) => LIGHT.has(name));
const heavy = packages.filter(([name]) => !LIGHT.has(name));

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

// Each package's block is printed as soon as that package finishes, rather
// than buffered until all four are done — so a fast package's result shows
// up while a slow one is still running, and blocks still can't interleave
// with each other since each is written in one shot.
function printResult(r) {
  console.log(`\n=== ${r.name} (${r.root}) ===`);
  process.stdout.write(r.out);
}

async function runParallel(entries) {
  return Promise.all(entries.map(async ([name, root]) => {
    const r = await runOne(name, root);
    printResult(r);
    return r;
  }));
}

async function runSequential(entries) {
  const out = [];
  for (const [name, root] of entries) {
    const r = await runOne(name, root);
    printResult(r);
    out.push(r);
  }
  return out;
}

const [lightResults, heavyResults] = await Promise.all([
  runParallel(light),
  runSequential(heavy),
]);

const byName = new Map([...lightResults, ...heavyResults].map((r) => [r.name, r]));
const results = packages.map(([name]) => byName.get(name));

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

// The failed count sits right after the label, before the trailing total —
// present only when something actually failed ("393 failed | 1129 passed").
// A passing run's "Tests  1522 passed (1522)" has no "failed" to match.
function parseFailed(out, label) {
  const re = new RegExp(String.raw`${label}\s+(\d+) failed`);
  const match = out.match(re);
  return match ? Number(match[1]) : 0;
}

console.log('\n--- summary ---');
let anyFailed = false;
let totalFiles = 0;
let totalTests = 0;
let allTotalsKnown = true;

for (const r of results) {
  const files = parseTotal(r.out, 'Test Files');
  const tests = parseTotal(r.out, 'Tests');
  const testsFailed = parseFailed(r.out, 'Tests');
  if (files == null || tests == null) allTotalsKnown = false;
  else {
    totalFiles += files;
    totalTests += tests;
  }
  const status = r.code === 0 ? 'PASS' : 'FAIL';
  if (r.code !== 0) anyFailed = true;
  const counts = files != null && tests != null
    ? (testsFailed > 0 ? `${testsFailed} failed / ${tests} total` : `${tests} tests / ${files} files`)
    : '(no test summary found)';
  console.log(`${status}  ${r.name.padEnd(10)} exit ${r.code}  ${counts}`);
}

if (allTotalsKnown) {
  console.log(`\n${totalTests} tests / ${totalFiles} files across ${packages.length} packages`);
}

if (anyFailed) {
  console.log('\nAt least one package failed — see its block above for details.');
  process.exit(1);
}
