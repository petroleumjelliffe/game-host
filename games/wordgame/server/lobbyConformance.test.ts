// The shared lobby contract, run against this game's real server — see
// packages/lobby/server/conformance.ts for what it asserts. A tiny injected
// dictionary keeps ENABLE's 1.7MB out of a suite that never plays a word.
import type { AddressInfo } from 'node:net';
import { describeLobbyConformance } from '@game-host/lobby/server/conformance.js';
import { createDictionary } from '../engine/dictionary.js';
import { BASE_PATH } from '../basePath.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { createServer, type ServerHandle } from './index.js';
import { closeSockets } from '@game-host/host/close.js';

let handle: ServerHandle | null = null;

describeLobbyConformance({
  name: 'Word Game',
  protocolVersion: PROTOCOL_VERSION,
  socketPath: `${BASE_PATH}/socket.io`,
  async start() {
    handle = createServer({ dictionary: createDictionary(['CAT']) });
    await new Promise<void>((resolve) => handle?.httpServer.listen(0, resolve));
    const address = handle?.httpServer.address() as AddressInfo;
    return { url: `http://localhost:${address.port}` };
  },
  async stop() {
    if (!handle) return;
    closeSockets(handle.io);
    await new Promise<void>((resolve) => handle?.httpServer.close(() => resolve()));
    handle = null;
  },
});
