// The payload half of the record contract. The mechanics tests — staging,
// chains, settled, quarantine, the null store — moved to
// packages/room-store/store.test.ts on 2026-08-20, with the store they
// test. What stays is what stayed in store.ts: Acquire's record shape and
// the guard that checks it, exercised through the configured store because
// that is how every record actually reaches disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createFileStore, SAVE_VERSION, type SavedRoom } from './store.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import type { RoomPlayer } from './room.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acquire-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function players(): RoomPlayer[] {
  return [
    { id: 'p1', name: 'Alex', token: 'tok-1', isHost: true, connected: true },
    { id: 'p2', name: 'Sam', token: 'tok-2', isHost: false, connected: false },
  ];
}

function record(overrides: Partial<SavedRoom> = {}): SavedRoom {
  return {
    roomId: 'ABC123',
    version: SAVE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    savedAt: 1_000,
    players: players(),
    state: buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: [],
    }),
    ...overrides,
  };
}

describe('the record round-trips what a resumed room needs', () => {
  it('tokens, state, and all', async () => {
    const store = createFileStore(dir);
    const saved = record();

    await store.save(saved);
    const { records: loaded } = await store.loadAll();

    expect(loaded).toHaveLength(1);
    // The whole point of version 4: a restored room is one people can rejoin.
    expect(loaded[0]!.players.map((p) => p.token)).toEqual(['tok-1', 'tok-2']);
    expect(loaded[0]!.state.board).toEqual(saved.state.board);
  });

  it('round-trips the protocol version and the previous segment start', async () => {
    const store = createFileStore(dir);
    await store.save(record({ previousSegmentStart: 7 }));

    const [loaded] = (await store.loadAll()).records;

    expect(loaded!.protocolVersion).toBe(PROTOCOL_VERSION);
    // Without this the step stack's "previous turn" is blank after a restart.
    expect(loaded!.previousSegmentStart).toBe(7);
  });

  it('accepts a record from before any segment had closed', async () => {
    // `previousSegmentStart` is genuinely absent until a first segment
    // closes, so undefined has to survive the round trip as undefined
    // rather than failing the shape guard.
    const store = createFileStore(dir);
    await store.save(record());

    const [loaded] = (await store.loadAll()).records;

    expect(loaded!.previousSegmentStart).toBeUndefined();
    expect(loaded!.roomId).toBe('ABC123');
  });
});

describe('what the guard refuses', () => {
  it('a record from an older save version, rather than coercing it', async () => {
    // A version-4 record has no `protocolVersion` and no
    // `previousSegmentStart` — it is not upgradable, only discardable.
    await writeFile(
      join(dir, 'OLD123.json'),
      JSON.stringify({ ...record({ roomId: 'OLD123' }), version: SAVE_VERSION - 1 }),
      'utf-8',
    );

    const { records, unreadable } = await createFileStore(dir).loadAll();
    expect(records).toEqual([]);
    expect(unreadable).toEqual(['OLD123.json']);
  });

  it('a record with no protocol version at all', async () => {
    // Written by hand rather than through `save`: this is what a file left
    // by an older server looks like, and nothing in this process can
    // produce one.
    const { protocolVersion, ...older } = record();
    await writeFile(join(dir, 'game-older.json'), JSON.stringify(older), 'utf8');

    expect((await createFileStore(dir).loadAll()).records).toEqual([]);
  });

  it('a previousSegmentStart that is neither absent nor a number', async () => {
    await writeFile(
      join(dir, 'EDITED.json'),
      JSON.stringify({ ...record({ roomId: 'EDITED' }), previousSegmentStart: 'seven' }),
      'utf8',
    );

    expect((await createFileStore(dir).loadAll()).records).toEqual([]);
  });
});
