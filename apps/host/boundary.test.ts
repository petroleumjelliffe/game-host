// apps/host/boundary.test.ts
// One game's throw does not end the other two.
//
// The throw has to be injectable, and none of the three games has a "throw on
// demand" event — deliberately, because such an event would ship. So the
// throwing game is a fake one, defined here: `MountedGame` is a plain
// interface, and a game that does nothing but explode is a couple of dozen
// lines.
//
// That is not a weaker test than making a real game throw. The boundary lives
// in packages/host and is applied identically by all three; what needs
// proving here is that a contained throw in *one* mount leaves the process
// and its neighbours alone, and a fake mount proves that without adding a
// crash switch to a game anyone can reach.

import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSockets } from '@game-host/host/close.js';
import type { HostContext, MountedGame } from '@game-host/host/contract.js';
import { guardSocket, guardTick } from '@game-host/host/guard.js';
import { mount as mountMarcoPolo } from '@game-host/marcopolo/server/app.js';
import { PROTOCOL_VERSION as MP_VERSION } from '@game-host/marcopolo/protocol/game.js';

const BOOM = '/boom';

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
  vi.restoreAllMocks();
});

/** A game whose only feature is failing. */
function mountExploder({ app, httpServer: server }: HostContext): Promise<MountedGame> {
  app.get(`${BOOM}/health`, (_req, res) => { res.json({ ok: true, protocolVersion: 0 }); });

  const io = new SocketServer(server, {
    path: `${BOOM}/socket.io`,
    destroyUpgrade: false,
    serveClient: false,
  });

  io.on('connection', (socket) => {
    guardSocket(socket, 'exploder');
    socket.on('explode', () => {
      throw new Error('the exploder exploded, as advertised');
    });
    socket.on('echo', (ack: () => void) => { if (typeof ack === 'function') ack(); });
  });

  return Promise.resolve({
    basePath: BOOM,
    title: 'Exploder',
    version: () => ({ protocolVersion: 0 }),
    io,
    close: () => { closeSockets(io); return Promise.resolve(); },
  });
}

async function boot(): Promise<string> {
  const app = express();
  httpServer = createServer(app);
  mounted = [
    await mountMarcoPolo({ app, httpServer }),
    await mountExploder({ app, httpServer }),
  ];
  await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
  return `http://localhost:${(httpServer.address() as AddressInfo).port}`;
}

function client(url: string, basePath: string): Promise<ClientSocket> {
  const socket = connect(url, { path: `${basePath}/socket.io`, transports: ['websocket'] });
  open.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no connection at ${basePath}`)), 4000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${event}'`)), 4000);
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}

describe('a throw in one game', () => {
  it('is contained, and the thrower is told', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();
    const socket = await client(url, BOOM);

    socket.emit('explode');
    const rejection = await next<{ code: string }>(socket, 'rejected');

    expect(rejection.code).toBe('serverError');
    expect(socket.connected).toBe(true);
  });

  it('leaves a neighbour connected and playing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();
    // Connected *before* the throw, so this is survival rather than
    // reconnection.
    const marco = await client(url, '/marcopolo');
    const thrower = await client(url, BOOM);

    thrower.emit('explode');
    await next(thrower, 'rejected');

    expect(marco.connected).toBe(true);
    // And it can still do real work: create a room, get a seat back.
    const joined = next<{ roomId: string }>(marco, 'joined');
    marco.emit('createRoom', { protocolVersion: MP_VERSION, name: 'Ann' });
    expect((await joined).roomId).toBeTruthy();
  });

  it('leaves a neighbour\'s HTTP routes answering', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();
    const thrower = await client(url, BOOM);

    thrower.emit('explode');
    await next(thrower, 'rejected');

    expect((await fetch(`${url}/marcopolo/health`)).status).toBe(200);
  });

  it('says which game threw and on which event', async () => {
    // The log line is the only thing that turns "a rejection appeared" into
    // "the exploder's `explode` handler threw" — three games in one process
    // means an unattributed stack trace costs a bisect.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();
    const socket = await client(url, BOOM);

    socket.emit('explode');
    await next(socket, 'rejected');

    expect(errors).toHaveBeenCalledWith(
      "[exploder] handler for 'explode' threw",
      expect.any(Error),
    );
  });

  it('does not stop the guarded socket handling its next message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();
    const socket = await client(url, BOOM);

    socket.emit('explode');
    await next(socket, 'rejected');

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no echo after the throw')), 4000);
      socket.emit('echo', () => { clearTimeout(timer); resolve(); });
    });
  });
});

describe('a throw in a scheduled callback', () => {
  it('is contained, and a real game keeps ticking beside it', async () => {
    // guardTick's half of the boundary. A throwing interval is started
    // alongside a live Marco Polo round; the round must go on.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = await boot();

    const failing = setInterval(guardTick('exploder', () => {
      throw new Error('tick exploded');
    }), 10);

    try {
      // A full Marco Polo room, begun, ticking at 20 Hz next to it.
      const swimmers = await Promise.all([
        client(url, '/marcopolo'),
        client(url, '/marcopolo'),
        client(url, '/marcopolo'),
      ]);
      const [first, ...others] = swimmers as [ClientSocket, ...ClientSocket[]];
      const created = next<{ roomId: string }>(first, 'joined');
      first.emit('createRoom', { protocolVersion: MP_VERSION, name: 'Ann' });
      const { roomId } = await created;
      for (const [i, socket] of others.entries()) {
        const joined = next(socket, 'joined');
        socket.emit('joinRoom', { roomId, protocolVersion: MP_VERSION, name: `Bo ${i}` });
        await joined;
      }

      const snapshots: unknown[] = [];
      first.on('gameState', (s: unknown) => snapshots.push(s));
      first.emit('beginGame');

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the round never ticked')), 6000);
        const poll = setInterval(() => {
          if (snapshots.length < 3) return;
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }, 20);
      });

      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      expect(errors).toHaveBeenCalledWith('[exploder] tick threw', expect.any(Error));
    } finally {
      clearInterval(failing);
    }
  });
});
