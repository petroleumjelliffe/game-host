import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './app.js';

// Repo-root .env.local sets PORT for local dev; a var already in the shell
// (or Render's injected PORT) wins over the file. Absent file is the
// ordinary case, not an error.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
} catch {
  // no .env.local — fall through to the shell env or the default below
}

// 4003 is Marco Polo's slot in the cross-game port registry (the game-host
// repo's PORTS.md); a shell/Render PORT still wins, per the loadEnvFile note.
const port = Number(process.env.PORT ?? 4003);
const { httpServer, io, stop } = createAppServer();
httpServer.listen(port, () => {
  // io.path() is the effective mount — a client hanging at the wrong socket
  // path is diagnosable from this line alone.
  console.log(`marco-polo listening on ${port}, sockets at ${io.path()}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  phones (prod build): http://${a.address}:${port}/marcopolo/`);
        console.log(`  phones (npm run dev:all): http://${a.address}:7933/marcopolo/`);
      }
    }
  }
});

// launchd/`brew services stop` speak SIGTERM, Ctrl-C speaks SIGINT. Nothing
// is persisted here, so stop() is only an orderly socket close; a second
// signal exits immediately.
let closing = false;
const shutdown = (): void => {
  if (closing) process.exit(1);
  closing = true;
  void stop().then(() => { process.exit(0); });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
