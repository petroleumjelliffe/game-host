// apps/host/main.ts
// The boot block: read the environment, listen, say what happened, and stop
// cleanly when something asks.

import { createHost } from './host.js';

// 4000 is the composed host's slot in the cross-game port registry (this
// repo's PORTS.md). It sits outside the 4001+ block on purpose: that block is
// game servers, and this is not a game. Render injects PORT, so the default
// is local-only.
const port = Number(process.env.PORT ?? 4000);

// No default, and the message names the variable. A relative fallback would
// resolve against a working directory that is wherever the plist says, and
// the failure mode is not an error — it is every saved room appearing to have
// vanished.
const dataDir = process.env.DATA_DIR?.trim();
if (!dataDir) {
  console.error(
    '\n✗ DATA_DIR is not set.\n\n'
    + '  Every game saves beneath it, one directory each:\n'
    + '    DATA_DIR=/var/data      on Render (a mounted disk)\n'
    + '    DATA_DIR=$(mktemp -d)   to try it locally\n\n'
    + '  There is deliberately no default — a relative path resolves against\n'
    + '  whatever directory this process happened to start in.\n',
  );
  process.exit(1);
}

const host = await createHost({ dataDir });

host.httpServer.listen(port, () => {
  console.log(`✓ game-host listening on ${port}, saves under ${dataDir}`);
  for (const game of host.games) {
    // Base path and socket path on every line, because a client asking at the
    // wrong socket mount does not error — it hangs on "Connecting…", and this
    // is the only place the effective mount is visible. All three games print
    // this alone; composed, it is needed three times over.
    console.log(`  ${game.title}: ${game.basePath}/  sockets at ${game.io.path()}`);
  }
});

// launchd and `brew services stop` speak SIGTERM, Ctrl-C speaks SIGINT. A
// second signal skips the drain: if close() is wedged, the way out should not
// have to be `kill -9`.
let closing = false;
const stop = (): void => {
  if (closing) process.exit(1);
  closing = true;
  void host.close().then(() => { process.exit(0); });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
