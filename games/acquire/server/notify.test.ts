// server/notify.test.ts
// What Acquire owes the turn-notification service beyond the commit-branch
// `turnChanged`: the seat credentials that make an emailed link a sign-in
// link, the re-report after a restore, the eviction bridge to `roomRemoved`,
// and the seat-vacated bridge. Booted through `mount` — the path the
// composed host takes — against a recording notifier, so every assertion is
// about the calls the service would actually receive.
//
// The end-to-end half (a real notify service, a real bound profile) lives in
// `apps/host/notifications.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  GameTurnReporter,
  MountedGame,
  NotifyGameRegistration,
  TurnNotifier,
} from '@game-host/host/contract.js';
import {
  LOBBY_CLIENT_EVENTS,
  LOBBY_SERVER_EVENTS,
  type JoinedMessage,
} from '@game-host/lobby/protocol/protocol.js';
import { mount } from './index.js';
import { MAX_AGE_MS } from './rooms.js';
import { createFileStore, SAVE_VERSION, type SavedRoom } from './store.js';
import { settleSocket, SOCKET_PATH } from './socketHarness.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import type { FixtureSpec } from '../engine/golden/types.js';
import type { GameState } from '../engine/gameTypes.js';

type Call =
  | { kind: 'turnChanged'; roomId: string; playerId: string | null; turnKey: string }
  | { kind: 'seatVacated'; roomId: string; playerId: string }
  | { kind: 'roomRemoved'; roomId: string };

/** A notifier that records every call and keeps the registration. */
function recordingNotifier() {
  const calls: Call[] = [];
  let registration: NotifyGameRegistration | null = null;
  const reporter: GameTurnReporter = {
    turnChanged: (roomId, playerId, turnKey) => { calls.push({ kind: 'turnChanged', roomId, playerId, turnKey }); },
    seatVacated: (roomId, playerId) => { calls.push({ kind: 'seatVacated', roomId, playerId }); },
    roomRemoved: (roomId) => { calls.push({ kind: 'roomRemoved', roomId }); },
  };
  const notify: TurnNotifier = {
    registerGame(r) { registration = r; return reporter; },
  };
  return {
    notify,
    calls,
    registration: () => {
      if (registration === null) throw new Error('acquire never registered');
      return registration;
    },
  };
}

let dir: string;
let httpServer: HttpServer;
let game: MountedGame | null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acquire-notify-'));
  httpServer = createHttpServer(express());
  game = null;
});

afterEach(async () => {
  await game?.close();
  await new Promise<void>((r) => { httpServer.close(() => r()); });
  await rm(dir, { recursive: true, force: true });
});

const seats = (names: string[]) =>
  names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    token: `tok-${name.toLowerCase()}`,
    isHost: i === 0,
    connected: true,
  }));

/** Writes one save file the way a previous process would have. */
async function seed(roomId: string, state: GameState, overrides: Partial<SavedRoom> = {}) {
  const record: SavedRoom = {
    roomId,
    version: SAVE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    savedAt: Date.now(),
    players: seats(state.players.map((p) => p.name)),
    state,
    ...overrides,
  };
  const store = createFileStore(dir);
  await store.save(record);
  await store.settled();
}

const twoPlayers = (extra: Partial<FixtureSpec> = {}) =>
  buildFixture({ players: [{ name: 'Alex' }, { name: 'Sam' }], ...extra });

async function boot(notifier: ReturnType<typeof recordingNotifier>) {
  const app = express();
  httpServer.removeAllListeners('request');
  httpServer.on('request', app);
  game = await mount({ app, httpServer, dataDir: dir, notify: notifier.notify });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('after a restore, every live room re-reports its turn', () => {
  it('names the player the restored board waits on', async () => {
    await seed('PLAY01', twoPlayers({ currentPlayerIndex: 1 }));
    const n = recordingNotifier();
    await boot(n);
    const turns = n.calls.filter((c) => c.kind === 'turnChanged');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ roomId: 'PLAY01', playerId: 'p2' });
    expect(turns[0]).toHaveProperty('turnKey', expect.stringMatching(/^\d+$/));
  });

  it('names the shareholder when a merger decision is what the board waits on', async () => {
    const state = buildFixture({
      players: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }],
      currentPlayerIndex: 0,
      stage: 'mergerLiquidation',
    });
    state.mergerContext = {
      survivorId: 'Gobble',
      absorbedIds: ['Messla'],
      payoutQueue: [],
      currentChoiceIndex: 0,
      absorbedPrices: {},
      currentLiquidationIndex: 0,
      shareholderQueue: ['p2', 'p3'],
      currentShareholderIndex: 1,
    };
    await seed('MERG01', state);
    const n = recordingNotifier();
    await boot(n);
    // Jo, not Alex: the current player placed the tile, but the table is
    // waiting on Jo's sell/trade/keep, so Jo is who gets the push.
    expect(n.calls).toContainEqual(expect.objectContaining({ kind: 'turnChanged', roomId: 'MERG01', playerId: 'p3' }));
  });

  it('clears the turn of a finished game rather than naming anyone', async () => {
    await seed('DONE01', twoPlayers({ stage: 'end' }));
    const n = recordingNotifier();
    await boot(n);
    expect(n.calls).toContainEqual(expect.objectContaining({ kind: 'turnChanged', roomId: 'DONE01', playerId: null }));
  });
});

describe('eviction reaches notify', () => {
  it('reports an aged-out room as removed, after its save is gone', async () => {
    await seed('OLD001', twoPlayers(), { savedAt: Date.now() - MAX_AGE_MS - 60_000 });
    await seed('NEW001', twoPlayers());
    const n = recordingNotifier();
    await boot(n);
    expect(n.calls.filter((c) => c.kind === 'roomRemoved')).toEqual([{ kind: 'roomRemoved', roomId: 'OLD001' }]);
    expect(await readdir(dir)).not.toContain('OLD001.json');
    // Evicted means gone: no turn report for it either.
    expect(n.calls).not.toContainEqual(expect.objectContaining({ kind: 'turnChanged', roomId: 'OLD001' }));
  });

  it('stays silent about a room skipped for protocol skew, which a rollback may want back', async () => {
    await seed('SKEW01', twoPlayers(), { protocolVersion: PROTOCOL_VERSION + 1 });
    const n = recordingNotifier();
    await boot(n);
    expect(n.calls).toEqual([]);
    expect(await readdir(dir)).toContain('SKEW01.json');
  });
});

describe('seat credentials', () => {
  it('hands back the live seat, and null for anything that is not one', async () => {
    await seed('CRED01', twoPlayers());
    const n = recordingNotifier();
    await boot(n);
    const reg = n.registration();
    expect(reg.getSeatCredentials?.('CRED01', 'p2')).toEqual({ playerId: 'p2', token: 'tok-sam', name: 'Sam' });
    expect(reg.getSeatCredentials?.('CRED01', 'p6')).toBeNull();
    expect(reg.getSeatCredentials?.('NOPE01', 'p1')).toBeNull();
  });
});

describe('seat vacated', () => {
  function open(port: number): Promise<Socket> {
    const socket = connect(`http://localhost:${port}`, { transports: ['websocket'], path: SOCKET_PATH });
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }
  function joined(socket: Socket): Promise<JoinedMessage> {
    return new Promise((resolve) => socket.once(LOBBY_SERVER_EVENTS.joined, resolve));
  }

  it('reports a lobby leaver, so notify drops that seat\'s bindings', async () => {
    const n = recordingNotifier();
    const port = await boot(n);
    const host = await open(port);
    const guest = await open(port);
    try {
      const hostJoined = joined(host);
      host.emit(LOBBY_CLIENT_EVENTS.createRoom, { protocolVersion: PROTOCOL_VERSION, name: 'Cass' });
      const { roomId } = await hostJoined;

      const guestJoined = joined(guest);
      guest.emit(LOBBY_CLIENT_EVENTS.joinRoom, { protocolVersion: PROTOCOL_VERSION, roomId, name: 'Dee' });
      const { playerId } = await guestJoined;

      guest.emit(LOBBY_CLIENT_EVENTS.leaveSeat);
      await settleSocket(guest);

      expect(n.calls).toContainEqual({ kind: 'seatVacated', roomId, playerId });
    } finally {
      host.disconnect();
      guest.disconnect();
    }
  });
});
