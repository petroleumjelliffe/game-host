// The shared lobby contract, run against this game's real mount — see
// packages/lobby/server/conformance.ts for what it asserts and why Marco
// Polo was pointed at first (lobby pass, task 5: this game had no
// lobby-over-the-wire coverage at all).
import type { AddressInfo } from 'node:net';
import { describeLobbyConformance } from '@game-host/lobby/server/conformance.js';
import { PROTOCOL_VERSION } from '../protocol/game.js';
import { createAppServer, SOCKET_PATH } from './app.js';

let app: ReturnType<typeof createAppServer> | null = null;

describeLobbyConformance({
  name: 'Marco Polo',
  protocolVersion: PROTOCOL_VERSION,
  socketPath: SOCKET_PATH,
  async start() {
    app = createAppServer();
    await new Promise<void>((resolve) => app!.httpServer.listen(0, resolve));
    return { url: `http://localhost:${(app!.httpServer.address() as AddressInfo).port}` };
  },
  async stop() {
    await app?.stop();
  },
});
