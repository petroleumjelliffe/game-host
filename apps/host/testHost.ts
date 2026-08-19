// apps/host/testHost.ts
// Booting the composed host on an ephemeral port, and talking to it the way a
// phone does. Shared by every suite in this package; not a test file itself.
//
// Nothing is mocked, deliberately. The failures this package exists to catch —
// two engine.io instances racing one websocket upgrade, one game's close
// taking down a shared listener, a fallback answering for the wrong game —
// are all invisible to anything that fakes the transport.

import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { createHost, type RunningHost } from './host.js';

export interface TestHost {
  url: string;
  dataDir: string;
  host: RunningHost;
  /** Connect a client to one game, by its base path. */
  client(basePath: string): Promise<Socket>;
  close(): Promise<void>;
}

/**
 * A composed host on port 0, with a fresh save directory.
 *
 * `keepDataDir` leaves the directory behind so a second host can be booted
 * against it — the restart case in saves.test.ts.
 */
export async function startTestHost(opts: { dataDir?: string } = {}): Promise<TestHost> {
  const dataDir = opts.dataDir ?? await mkdtemp(join(tmpdir(), 'game-host-'));
  const host = await createHost({ dataDir });
  await new Promise<void>((resolve) => host.httpServer.listen(0, resolve));
  const port = (host.httpServer.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  const open: Socket[] = [];

  return {
    url,
    dataDir,
    host,
    async client(basePath: string) {
      // websocket only: polling never performs the upgrade, so a polling
      // client sails straight past the destroyUpgrade race.
      const socket = connect(url, {
        path: `${basePath}/socket.io`,
        transports: ['websocket'],
      });
      open.push(socket);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no connection at ${basePath}/socket.io`)),
          4000,
        );
        socket.on('connect', () => { clearTimeout(timer); resolve(); });
        socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
      });
      return socket;
    },
    async close() {
      for (const socket of open) socket.disconnect();
      await host.close();
    },
  };
}

/**
 * Remove a directory a test made.
 *
 * `maxRetries` is not defensive padding. Acquire's registry has no `settled()`
 * — Rail Baron's does — so its `close()` cannot wait for an in-flight save,
 * and a write can land in the directory just after the host has stopped. That
 * raced this cleanup into a real ENOTEMPTY. The save itself is safe either
 * way (the store writes to a temp file and renames, so an interrupted write
 * leaves the previous record intact), but the directory is briefly busy.
 */
export async function cleanup(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/** The next message of a kind, with a deadline rather than a hang. */
export function next<T>(socket: Socket, event: string, timeoutMs = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${event}' arrived`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** The next message of a kind that satisfies a predicate. */
export function nextWhere<T>(
  socket: Socket,
  event: string,
  ok: (value: T) => boolean,
  timeoutMs = 6000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`no matching '${event}' arrived`));
    }, timeoutMs);
    const handler = (value: T): void => {
      if (!ok(value)) return;
      clearTimeout(timer);
      socket.off(event, handler as (...args: unknown[]) => void);
      resolve(value);
    };
    socket.on(event, handler as (...args: unknown[]) => void);
  });
}

/** Collect every message of a kind, so absence is assertable too. */
export function collect<T>(socket: Socket, event: string): T[] {
  const seen: T[] = [];
  socket.on(event, (payload: T) => seen.push(payload));
  return seen;
}

export interface Joined { roomId: string; playerId: string }

/**
 * The lobby half is identical across all three games — same events, same
 * payload shapes — because all three sit on `@game-host/lobby`. Only the
 * protocol version differs, which is why it is an argument.
 */
export async function createRoom(
  socket: Socket, protocolVersion: number, name?: string,
): Promise<Joined> {
  const joined = next<Joined>(socket, 'joined');
  socket.emit('createRoom', name === undefined
    ? { protocolVersion }
    : { protocolVersion, name });
  return joined;
}

export async function joinRoom(
  socket: Socket, roomId: string, protocolVersion: number, name?: string,
): Promise<Joined> {
  const joined = next<Joined>(socket, 'joined');
  socket.emit('joinRoom', name === undefined
    ? { roomId, protocolVersion }
    : { roomId, protocolVersion, name });
  return joined;
}
