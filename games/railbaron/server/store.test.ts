import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RB_PROTOCOL_VERSION, RB_SAVE_VERSION } from '../session/protocol';
import type { GameEvent } from '../src/state/events';
import { createFileStore, type SavedRoom } from './store';

const record = (roomId: string, log: GameEvent[]): SavedRoom => ({
  roomId,
  version: RB_SAVE_VERSION,
  protocolVersion: RB_PROTOCOL_VERSION,
  savedAt: Date.now(),
  players: [{ id: 'red', name: 'ADA', token: 't1', isHost: true, connected: false }],
  log,
});

const freshDir = () => mkdtemp(join(tmpdir(), 'rb-store-'));

describe('the file store', () => {
  it('saves a room and loads it back, log intact', async () => {
    const dir = await freshDir();
    const store = createFileStore(dir);
    const log: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
    ];
    await store.save(record('ABC234', log));

    const { records, skipped } = await store.loadAll();
    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]!.log).toEqual(log);
    expect(records[0]!.players[0]!.token).toBe('t1');
  });

  it('skips a record whose log fails isGameEvent, and names the file', async () => {
    const dir = await freshDir();
    const store = createFileStore(dir);
    await store.save(record('ABC234', [{ type: 'started' }]));

    // Corrupt on disk, as a shape change across a deploy would: a seat colour
    // that never existed. The record is otherwise perfectly well-formed.
    const path = join(dir, 'ABC234.json');
    const raw: { log: unknown } = JSON.parse(await readFile(path, 'utf8'));
    raw.log = [{ type: 'joined', seat: 'octarine', name: 'X' }];
    await writeFile(path, JSON.stringify(raw));

    const { records, skipped } = await store.loadAll();
    expect(records).toEqual([]);
    expect(skipped).toEqual(['ABC234.json']);
  });

  it('skips unparseable files and wrong versions without throwing', async () => {
    const dir = await freshDir();
    const store = createFileStore(dir);
    await writeFile(join(dir, 'BAD.json'), 'not json');
    await store.save({ ...record('OLD234', [{ type: 'started' }]), version: 0 });

    const { records, skipped } = await store.loadAll();
    expect(records).toEqual([]);
    expect(skipped.sort()).toEqual(['BAD.json', 'OLD234.json']);
  });

  it('reports no rooms and no trouble when nothing has ever been saved', async () => {
    const store = createFileStore(join(await freshDir(), 'never-written'));
    expect(await store.loadAll()).toEqual({ records: [], skipped: [] });
  });

  it('remove() makes a room unloadable', async () => {
    const dir = await freshDir();
    const store = createFileStore(dir);
    await store.save(record('ABC234', [{ type: 'started' }]));
    await store.remove('ABC234');
    expect((await store.loadAll()).records).toEqual([]);
  });
});
