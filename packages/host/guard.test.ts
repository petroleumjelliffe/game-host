// packages/host/guard.test.ts
// Against a real socket.io server and real clients, not a hand-rolled
// `{ on() {} }`. A stub can tell you the wrapper wraps; only the real thing
// can tell you the patch survives contact with socket.io's own Socket, which
// is the entire question — three games are about to depend on it.

import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as SocketServer, type Socket as ServerSocket } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardSocket, guardTick } from './guard.js';

let httpServer: HttpServer;
let io: SocketServer;
let port: number;
let serverSockets: ServerSocket[];
const open: ClientSocket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  io = new SocketServer(httpServer);
  serverSockets = [];

  io.on('connection', (socket) => {
    // Before any handler — the ordering the guard's own doc requires.
    guardSocket(socket, 'testgame');
    serverSockets.push(socket);

    socket.on('boom', () => {
      throw new Error('handler exploded');
    });
    socket.on('echo', (msg: string, ack: (m: string) => void) => {
      ack(msg);
    });
    socket.once('boom-once', () => {
      throw new Error('once-handler exploded');
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const socket of open) socket.disconnect();
  open.length = 0;
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  vi.restoreAllMocks();
});

async function client(): Promise<ClientSocket> {
  const socket = connect(`http://localhost:${port}`, { transports: ['websocket'] });
  open.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never connected')), 4000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return socket;
}

/** The next message of a kind, or a rejection if it never arrives. */
function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${event}' arrived`)), 4000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** A round trip the server always answers, to order an assertion after it. */
function settle(socket: ClientSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never settled')), 4000);
    socket.emit('echo', 'ping', (reply: string) => {
      clearTimeout(timer);
      resolve(reply);
    });
  });
}

describe('guardSocket', () => {
  it('contains a throw instead of letting it end the process', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = await client();

    socket.emit('boom');
    await next(socket, 'rejected');

    // Still here, still connected — which is the whole claim.
    expect(socket.connected).toBe(true);
    expect(await settle(socket)).toBe('ping');
    expect(errors).toHaveBeenCalledWith(
      "[testgame] handler for 'boom' threw",
      expect.any(Error),
    );
  });

  it('tells the socket that threw, on the channel every game already speaks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = await client();

    socket.emit('boom');
    const rejection = await next<{ code: string; message: string }>(socket, 'rejected');

    expect(rejection.code).toBe('serverError');
    expect(rejection.message).toBeTruthy();
  });

  it('leaves every other connection working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrower = await client();
    const bystander = await client();

    thrower.emit('boom');
    await next(thrower, 'rejected');

    // The point of composition: one game's bad payload is one game's problem.
    expect(bystander.connected).toBe(true);
    expect(await settle(bystander)).toBe('ping');
  });

  it('guards `once` as well as `on`', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = await client();

    socket.emit('boom-once');
    const rejection = await next<{ code: string }>(socket, 'rejected');

    expect(rejection.code).toBe('serverError');
    expect(socket.connected).toBe(true);
  });

  it('leaves the socket itself intact — id, rooms, join, emit, disconnect', async () => {
    // The identity claim, tested rather than asserted. A Proxy would pass the
    // first three of these and split identity everywhere else in the process;
    // patching the instance is what makes `socketsFor()` and
    // `io.sockets.sockets` hand back this same guarded object.
    const socket = await client();
    await settle(socket);
    const server = serverSockets[0];
    expect(server).toBeDefined();
    if (!server) return;

    expect(typeof server.id).toBe('string');
    expect(server.id.length).toBeGreaterThan(0);

    server.join('a-room');
    expect(server.rooms.has('a-room')).toBe(true);
    expect(io.sockets.sockets.get(server.id)).toBe(server);

    const greeting = next<string>(socket, 'greeting');
    server.emit('greeting', 'hello');
    expect(await greeting).toBe('hello');

    server.disconnect(true);
    await new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    expect(socket.connected).toBe(false);
  });

  it('applies from the call onwards, never retroactively', async () => {
    // Documents the ordering requirement its doc comment states. Deliberately
    // *not* tested by letting an earlier handler throw: an uncontained throw
    // ends the process, which is precisely the property under test, so
    // demonstrating it would take the test runner down with it. The mechanism
    // is observable without that.
    const socket = await client();
    await settle(socket);
    const server = serverSockets[0];
    expect(server).toBeDefined();
    if (!server) return;

    const patched = server.on;
    guardSocket(server, 'testgame');
    expect(server.on).not.toBe(patched);
  });
});

describe('guardTick', () => {
  it('swallows a throw and says so', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tick = guardTick('marcopolo', () => {
      throw new Error('sim exploded');
    });

    expect(() => tick()).not.toThrow();
    expect(errors).toHaveBeenCalledWith('[marcopolo] tick threw', expect.any(Error));
  });

  it('passes arguments through and stays out of the way otherwise', () => {
    const seen: number[] = [];
    const tick = guardTick('marcopolo', (n: number) => {
      seen.push(n);
    });

    tick(1);
    tick(2);

    expect(seen).toEqual([1, 2]);
  });
});
