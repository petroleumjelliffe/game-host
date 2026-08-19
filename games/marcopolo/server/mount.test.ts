// server/mount.test.ts
// Marco Polo in somebody else's process, at the smallest possible scale: one
// game, one borrowed app, one borrowed HTTP server.
//
// This exists so `mount` is exercised now rather than in three tasks' time,
// after Rail Baron and Acquire have copied whatever is wrong with it. The
// three-game version of these assertions lives in apps/host; this is the
// cheapest place to find out that the shape is wrong.

import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { MountedGame } from '@game-host/host/contract.js';
import { PROTOCOL_VERSION } from '../protocol/game.js';
import { mount, SOCKET_PATH } from './app.js';

let httpServer: HttpServer | undefined;
let game: MountedGame | undefined;
const open: ClientSocket[] = [];

afterEach(async () => {
  for (const socket of open) socket.disconnect();
  open.length = 0;
  await game?.close();
  game = undefined;
  if (httpServer) {
    const server = httpServer;
    httpServer = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** A bare app and server, standing in for the host. */
async function boot(): Promise<{ url: string; game: MountedGame }> {
  const app = express();
  httpServer = createServer(app);
  game = await mount({ app, httpServer });
  await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return { url: `http://localhost:${port}`, game };
}

function client(url: string): Promise<ClientSocket> {
  const socket = connect(url, { path: SOCKET_PATH, transports: ['websocket'] });
  open.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never connected')), 4000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe('mounting into an app it does not own', () => {
  it('describes itself the way the menu and /health need', async () => {
    const { game: mounted } = await boot();

    expect(mounted.basePath).toBe('/marcopolo');
    expect(mounted.title).toBe('Marco Polo');
    expect(mounted.version()).toEqual({ protocolVersion: PROTOCOL_VERSION });
  });

  it('accepts sockets at its prefixed path', async () => {
    const { url } = await boot();
    const socket = await client(url);

    expect(socket.connected).toBe(true);
  });

  it('answers its prefixed health twin', async () => {
    const { url } = await boot();

    const res = await fetch(`${url}/marcopolo/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });

  it('registers no bare /health — that route belongs to whoever owns the app', async () => {
    // Composed, three games registering `/health` means whichever mounted
    // first silently owns it. The host registers its own aggregate instead,
    // and `createAppServer` adds the bare twin back for a lone process.
    const { url } = await boot();

    expect((await fetch(`${url}/health`)).status).toBe(404);
  });

  it('serves nothing at the root — that is the menu\'s job', async () => {
    const { url } = await boot();

    expect((await fetch(`${url}/`)).status).toBe(404);
  });

  it('leaves the HTTP server listening when it closes', async () => {
    // The io.close() hazard, caught at the cheapest possible moment: one
    // game, no other game to confuse the diagnosis. socket.io's own close()
    // would take the listener down here, and in a composed process that
    // listener belongs to two other games as well.
    const { url, game: mounted } = await boot();
    await client(url);

    await mounted.close();
    game = undefined;

    const res = await fetch(`${url}/marcopolo/health`);
    expect(res.status).toBe(200);
  });
});
