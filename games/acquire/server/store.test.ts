import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createFileStore, createNullStore, SAVE_VERSION, type SavedRoom } from './store.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import type { RoomPlayer } from './room.js';

// `spy: true` auto-mocks every export but calls through to the real
// implementation by default, which is what makes it safe for the other
// tests in this file: only the one test below overrides `rename`.
// `vi.spyOn` cannot do this in-place — a Node ESM built-in's module
// namespace is non-configurable, so redefining one of its properties at
// runtime throws. `vi.mock` works because it rewrites the import at the
// module-loader level instead.
vi.mock('node:fs/promises', { spy: true });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acquire-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
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

describe('the file store', () => {
  it('round-trips a record, tokens and all', async () => {
    const store = createFileStore(dir);
    const saved = record();

    await store.save(saved);
    const { records: loaded } = await store.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.roomId).toBe('ABC123');
    // The whole point of version 4: a restored room is one people can rejoin.
    expect(loaded[0]!.players.map((p) => p.token)).toEqual(['tok-1', 'tok-2']);
    expect(loaded[0]!.state.board).toEqual(saved.state.board);
  });

  it('ignores a record from an older save version rather than coercing it', async () => {
    await writeFile(
      join(dir, 'OLD123.json'),
      JSON.stringify({ ...record({ roomId: 'OLD123' }), version: SAVE_VERSION - 1 }),
      'utf-8',
    );

    // A stale-version file is real behaviour, not silence: loadAll promises to
    // ignore what it cannot use, and warns which file it skipped. Spying keeps
    // that promise honest without printing it during the test run.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await createFileStore(dir).loadAll()).records).toEqual([]);
    expect(warn).toHaveBeenCalledWith('! Ignoring unreadable save OLD123.json');
  });

  it('ignores a file that is not a record at all', async () => {
    await writeFile(join(dir, 'JUNK01.json'), '{ this is not json', 'utf-8');
    await writeFile(join(dir, 'HALF02.json'), JSON.stringify({ roomId: 'HALF02' }), 'utf-8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await createFileStore(dir).loadAll()).records).toEqual([]);
    expect(warn).toHaveBeenCalledWith('! Ignoring unreadable save JUNK01.json');
    expect(warn).toHaveBeenCalledWith('! Ignoring unreadable save HALF02.json');
  });

  it('is empty, not broken, when the directory does not exist yet', async () => {
    expect(await createFileStore(join(dir, 'not-created')).loadAll()).toEqual({ records: [], unreadable: [] });
  });

  it('removes a record', async () => {
    const store = createFileStore(dir);
    await store.save(record());

    await store.remove('ABC123');

    expect((await store.loadAll()).records).toEqual([]);
  });

  // What this proves: after a completed save, nothing named `*.tmp` is left for a
  // later `loadAll` glob to trip over — the directory holds exactly the final name.
  // What it does not prove: that the record was ever staged through a temp file and
  // `rename`d into place at all. Writing straight to the target file, with no temp
  // step, leaves this same directory listing — verified as break 2 while building
  // this test. So this assertion is not a check on the temp+rename mechanism itself,
  // only on its absence of leftovers. The thing `rename`'s atomicity actually guards
  // — a process dying between the write finishing and the rename landing — has no
  // window a synchronous unit test can open, which is why no test here covers it.
  it('leaves no partial file behind — every write lands whole, under a final name', async () => {
    const store = createFileStore(dir);
    await store.save(record());

    // A temp file left in place would be picked up by a later `loadAll` glob,
    // or worse, read half-written. Nothing but the final name may survive.
    expect(await readdir(dir)).toEqual(['ABC123.json']);
  });
});

describe('two saves for the same room, in flight at once', () => {
  it('lands the second one last even when the first write is slower', async () => {
    // Without a per-room promise chain, these two writes race: the first
    // one's `rename` is delayed past the second's, so the *older* record is
    // what survives on disk. Serialising them is what makes last-call-wins
    // true rather than lucky. The delay makes the race deterministic instead
    // of relying on scheduling.
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const fsp = await import('node:fs/promises');
    let first = true;
    vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 30));
      }
      return real.rename(from, to);
    });

    const store = createFileStore(dir);
    const a = store.save(record({ savedAt: 1 }));
    const b = store.save(record({ savedAt: 2 }));
    await Promise.all([a, b]);

    const { records: loaded } = await store.loadAll();
    expect(loaded[0]!.savedAt).toBe(2);
  });
});

describe('the null store', () => {
  it('accepts saves and holds nothing, so a registry with no store still runs', async () => {
    const store = createNullStore();
    await store.save(record());
    await store.remove('ABC123');
    expect((await store.loadAll()).records).toEqual([]);
  });
});

describe('the record carries what a resumed room needs', () => {
  it('round-trips the protocol version and the previous segment start', async () => {
    const store = createFileStore(dir);
    await store.save(record({ protocolVersion: PROTOCOL_VERSION, previousSegmentStart: 7 }));

    const [loaded] = (await store.loadAll()).records;

    expect(loaded!.protocolVersion).toBe(PROTOCOL_VERSION);
    // Without this the step stack's "previous turn" is blank after a restart —
    // the exact gap the field was added to close, left open for the restart
    // case until now.
    expect(loaded!.previousSegmentStart).toBe(7);
  });

  it('accepts a record from before any segment had closed', async () => {
    // `previousSegmentStart` is genuinely absent until a first segment closes,
    // so undefined has to survive the round trip as undefined rather than
    // failing the shape guard.
    const store = createFileStore(dir);
    await store.save(record({ protocolVersion: PROTOCOL_VERSION }));

    const [loaded] = (await store.loadAll()).records;

    expect(loaded!.previousSegmentStart).toBeUndefined();
    expect(loaded!.roomId).toBe('ABC123');
  });

  it('refuses a record with no protocol version at all', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createFileStore(dir);
    // Written by hand rather than through `save`: this is what a file left by
    // an older server looks like, and nothing in this process can produce one.
    const { protocolVersion, ...older } = record({ protocolVersion: PROTOCOL_VERSION });
    await writeFile(join(dir, 'game-older.json'), JSON.stringify(older), 'utf8');

    expect((await store.loadAll()).records).toEqual([]);
  });

  it('refuses the previous save format outright', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createFileStore(dir);
    await writeFile(
      join(dir, 'game-v4.json'),
      JSON.stringify(record({ version: SAVE_VERSION - 1, protocolVersion: PROTOCOL_VERSION })),
      'utf8',
    );

    // A version-4 record has no `protocolVersion` and no `previousSegmentStart`
    // — it is not upgradable, only discardable.
    expect((await store.loadAll()).records).toEqual([]);
  });
});

/**
 * Phase 4 left eviction deleting only records that are too *old* — a
 * permanently unreadable file was refused and kept, so 23 stale files warned
 * at every boot, forever. The ruling (Stage 1): quarantine, do not delete.
 * Renaming a file you could not parse preserves it for a human to look at;
 * unlinking it is a reflex the carry-forward explicitly warned against.
 */
describe('what loadAll says about files it cannot read', () => {
  it('names them, so the registry can decide what to do', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createFileStore(dir);
    await store.save(record());
    await writeFile(join(dir, 'game-rotten.json'), '{ not json', 'utf8');

    const { records, unreadable } = await store.loadAll();

    expect(records).toHaveLength(1);
    expect(unreadable).toEqual(['game-rotten.json']);
  });

  it('quarantines by rename, and the file stops being read at the next load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createFileStore(dir);
    await writeFile(join(dir, 'game-rotten.json'), '{ not json', 'utf8');

    await store.quarantine('game-rotten.json');

    // Renamed, not unlinked: still on disk for a human, out of the boot path.
    const names = await readdir(dir);
    expect(names).toEqual(['game-rotten.json.bad']);
    const { unreadable } = await store.loadAll();
    expect(unreadable).toEqual([]);
  });

  it('survives quarantining a file that vanished in the meantime', async () => {
    // Two processes sharing a directory over a redeploy is the ordinary case,
    // and the loser of that race must not throw out of the boot path.
    const store = createFileStore(dir);
    await expect(store.quarantine('game-gone.json')).resolves.toBeUndefined();
  });
});
