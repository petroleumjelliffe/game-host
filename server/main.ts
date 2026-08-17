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

const port = Number(process.env.PORT ?? 3001);
const { httpServer } = createAppServer();
httpServer.listen(port, () => {
  console.log(`marco-polo listening on ${port}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  phones (prod build): http://${a.address}:${port}`);
        console.log(`  phones (npm run dev:all): http://${a.address}:<the port Vite prints>`);
      }
    }
  }
});
