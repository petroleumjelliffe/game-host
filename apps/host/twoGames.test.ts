// apps/host/twoGames.test.ts
// Two games, one Express app, one HTTP server, two socket.io servers.
//
// This is the earliest point in the migration where two engine.io instances
// share a server, which makes it the earliest point where the two hazards
// that motivate the whole design are real rather than argued:
//
//   - every attached engine sees every websocket upgrade, and the ones whose
//     path does not match arm a timer to kill it (`destroyUpgrade: false`)
//   - socket.io's `Server.close()` closes the HTTP server it attached to,
//     which here belongs to both games (`closeSockets`, not `io.close()`)
//
// The three-game version, with a menu and an aggregate /health, is compose.
// test.ts. This one exists so neither hazard waits that long to be checked.

import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { MountedGame } from '@game-host/host/contract.js';
import { mount as mountMarcoPolo } from '@game-host/marcopolo/server/app.js';
import { mount as mountRailBaron } from '@game-host/railbaron/server/index.js';

let httpServer: HttpServer | undefined;
let mounted: MountedGame[] = [];
const open: ClientSocket[] = [];

afterEach(async () => {
  for (const socket of open) socket.disconnect();
  open.length = 0;
  await Promise.allSettled(mounted.map((game) => game.close()));
  mounted = [];
  if (httpServer) {
    const server = httpServer;
    httpServer = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface TwoGames {
  url: string;
  marcopolo: MountedGame;
  railbaron: MountedGame;
}

async function boot(): Promise<TwoGames> {
  const app = express();
  httpServer = createServer(app);
  const dataDir = await mkdtemp(join(tmpdir(), 'host-two-'));

  // Mounted in sequence, exactly as the host will: each adds its routes to
  // the same app and attaches its own engine to the same server.
  const marcopolo = await mountMarcoPolo({ app, httpServer });
  const railbaron = await mountRailBaron({ app, httpServer, dataDir });
  mounted = [marcopolo, railbaron];

  await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return { url: `http://localhost:${port}`, marcopolo, railbaron };
}

function client(url: string, path: string): Promise<ClientSocket> {
  // websocket only, deliberately: polling never performs the upgrade, so a
  // polling client would sail past the very race this file exists to catch.
  const socket = connect(url, { path, transports: ['websocket'] });
  open.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`never connected at ${path}`)), 4000);
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

describe('two games sharing one HTTP server', () => {
  it('takes websocket connections on both paths at once', async () => {
    const { url } = await boot();

    // Concurrently, not one after the other: sequential connections would
    // never have two live upgrades in the same moment.
    const [marco, rail] = await Promise.all([
      client(url, '/marcopolo/socket.io'),
      client(url, '/railbaron/socket.io'),
    ]);

    expect(marco.connected).toBe(true);
    expect(rail.connected).toBe(true);
  });

  it('survives repeated simultaneous upgrades', async () => {
    // The upgrade race is won by the handshake almost every time, so one
    // connection proves very little. Twenty pairs is still not proof, but it
    // is the cheapest available pressure on a timing bug.
    const { url } = await boot();

    for (let i = 0; i < 20; i += 1) {
      const [marco, rail] = await Promise.all([
        client(url, '/marcopolo/socket.io'),
        client(url, '/railbaron/socket.io'),
      ]);
      expect(marco.connected).toBe(true);
      expect(rail.connected).toBe(true);
      marco.disconnect();
      rail.disconnect();
    }
  });

  it('keeps each health twin answering for its own game only', async () => {
    const { url, marcopolo, railbaron } = await boot();

    const marco = await (await fetch(`${url}/marcopolo/health`)).json() as Record<string, unknown>;
    const rail = await (await fetch(`${url}/railbaron/health`)).json() as Record<string, unknown>;

    expect(marco).toEqual({ ok: true, ...marcopolo.version() });
    expect(rail).toEqual({ ok: true, ...railbaron.version() });
    // Rail Baron persists and Marco Polo does not — so the twins genuinely
    // differ, and this would catch one game answering for the other.
    expect(marco.saveVersion).toBeUndefined();
    expect(rail.saveVersion).toBeDefined();
  });

  it('registers no bare /health — that route belongs to the host', async () => {
    const { url } = await boot();

    expect((await fetch(`${url}/health`)).status).toBe(404);
  });

  it('leaves nothing at the root for either game to claim', async () => {
    // Marco Polo's root static mount is the one route that could not be
    // composed; it lives in createAppServer now, and this is what proves it.
    const { url } = await boot();

    expect((await fetch(`${url}/`)).status).toBe(404);
  });

  it('closing one game leaves the other serving and connected', async () => {
    // The io.close() hazard, with a second game present to be harmed by it.
    const { url, railbaron } = await boot();
    const marco = await client(url, '/marcopolo/socket.io');
    await client(url, '/railbaron/socket.io');

    await railbaron.close();

    expect(marco.connected).toBe(true);
    expect((await fetch(`${url}/marcopolo/health`)).status).toBe(200);
    // And a new Marco Polo client can still arrive afterwards — the listener
    // is genuinely still there, not merely holding an old connection open.
    const later = await client(url, '/marcopolo/socket.io');
    expect(later.connected).toBe(true);
  });

  it('disconnects its own sockets when a game closes, and only its own', async () => {
    const { url, railbaron } = await boot();
    const marco = await client(url, '/marcopolo/socket.io');
    const rail = await client(url, '/railbaron/socket.io');

    await railbaron.close();
    await new Promise<void>((resolve) => {
      if (!rail.connected) { resolve(); return; }
      rail.on('disconnect', () => resolve());
    });

    expect(rail.connected).toBe(false);
    expect(marco.connected).toBe(true);
  });
});
