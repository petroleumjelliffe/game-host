// Refuse to start a dev server onto a port somebody already holds, and say
// who holds it.
//
// Node's own answer to a taken port is an EADDRINUSE stack trace, which
// names the port and nothing else. The useful facts are which process, how
// old it is, and which checkout it is serving — a server from another tree,
// or one old enough to predate a change to `dev:server` itself, keeps
// answering requests and is indistinguishable from the one you meant to
// start. That happened on 2026-08-19: a four-day-old `tsx watch` held 4002,
// had reloaded into new code, and was serving it under a stale environment.
//
// The listening process is almost never the one to stop. Under `dev:all` it
// is the innermost child of `npm run dev:all → concurrently → npm run
// dev:server → tsx watch → node`, and killing it only makes the watcher
// respawn it, so the port stays held and the advice looks broken. Hence the
// ancestor walk: report the chain, and name the outermost process that is
// still part of the dev stack as the thing to kill.
//
// This reports and exits; it never kills. An auto-kill would have destroyed
// exactly the evidence that made the collision worth investigating, and
// picking someone else's process to terminate is not a thing a dev script
// should decide on its own.

import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  console.error('usage: node scripts/check-port.mjs <port>');
  process.exit(2);
}

/** `lsof` and `ps` exit non-zero when nothing matches, which is routine here. */
function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Part of a JS dev stack rather than the terminal or editor hosting it. */
const IS_DEV_STACK = /(^|\/)(node|npm|npx|tsx|concurrently|vite)\b/;

function describe(pid) {
  const out = run('ps', ['-o', 'ppid=,command=', '-p', pid]).trim();
  if (!out) return null;
  const [ppid, ...rest] = out.split(/\s+/);
  return { pid, ppid, command: rest.join(' ') };
}

const pids = [
  ...new Set(
    run('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

if (pids.length === 0) process.exit(0);

console.error(`\n✗ Port ${port} is already held — not starting a second server.\n`);

const killTargets = [];

for (const pid of pids) {
  // `lstart` rather than `etime`: an absolute timestamp is what makes "this
  // predates the change you are testing" obvious at a glance.
  const started = run('ps', ['-o', 'lstart=', '-p', pid]).trim();
  // The working directory names the checkout, which is the fact that
  // distinguishes your tree's server from another one's.
  const cwd = run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);

  console.error(`  listening pid ${pid}`);
  if (started) console.error(`    started  ${started}`);
  if (cwd) console.error(`    cwd      ${cwd}`);

  let node = describe(pid);
  let outermost = pid;
  const chain = [];
  while (node) {
    chain.push(node);
    const parent = node.ppid === '1' ? null : describe(node.ppid);
    if (!parent || !IS_DEV_STACK.test(parent.command)) break;
    outermost = parent.pid;
    node = parent;
  }

  console.error('    process chain (innermost first):');
  for (const entry of chain) {
    const mark = entry.pid === outermost && chain.length > 1 ? ' ← stop this one' : '';
    console.error(`      ${entry.pid.padStart(6)}  ${entry.command.slice(0, 88)}${mark}`);
  }
  console.error('');
  killTargets.push(outermost);
}

console.error(
  `  If that is a server you still want, leave it. If it is stale, stop it:\n` +
    `      kill ${[...new Set(killTargets)].join(' ')}\n\n` +
    `  Stopping the listening process alone is usually not enough — under a\n` +
    `  watcher it is respawned and the port stays held, which is why the\n` +
    `  outermost process is the one named above.\n\n` +
    `  A watched dev server reloads its code but never the environment it was\n` +
    `  launched with, so an old one can serve today's code under yesterday's\n` +
    `  settings. When a dev:* script's environment changes, restart it.\n`,
);

process.exit(1);
