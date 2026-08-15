import { networkInterfaces } from 'node:os';
import { createAppServer } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const { httpServer } = createAppServer();
httpServer.listen(port, () => {
  console.log(`marco-polo listening on ${port}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  phones (prod build): http://${a.address}:${port}`);
        console.log(`  phones (npm run dev): http://${a.address}:5173`);
      }
    }
  }
});
