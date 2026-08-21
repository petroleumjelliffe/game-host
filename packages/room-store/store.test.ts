// Ported from the two files this package replaced — Rail Baron's and
// Acquire's server/store.test.ts — with each game's payload swapped for a
// stub that is deliberately neither: like genericConsumer.test.ts in the
// lobby, a payload that looked like one game's would hide the store growing
// a requirement only that game satisfies. The per-game guard tests (log
// events, previousSegmentStart) stayed behind with the guards.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileStore,
  createNullStore,
  hasEnvelope,
  type SavedRoomEnvelope,
} from './store.js';

// `spy: true` auto-mocks every export but calls through to the real
// implementation by default, which is what makes it safe for the other
// tests in this file: only the race and settled tests override `rename`.
// `vi.spyOn` cannot do this in-place — a Node ESM built-in's module
// namespace is non-configurable, so redefining one of its properties at
// runtime throws. `vi.mock` works because it rewrites the import at the
// module-loader level instead.
vi.mock('node:fs/promises', { spy: true });

const STUB_VERSION = 3;

interface StubRecord extends SavedRoomEnvelope {
  note: string;
}

function isStubRecord(value: unknown): value is StubRecord {
  const r = value as Record<string, unknown>;
  return hasEnvelope(value, STUB_VERSION) && typeof r.note === 'string';
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'room-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function record(overrides: Partial<StubRecord> = {}): StubRecord {
  return {
    roomId: 'ABC123',
    version: STUB_VERSION,
    protocolVersion: 1,
    savedAt: 1_000,
    players: [
      { id: 'p1', name: 'Alex', token: 'tok-1', isHost: true, connected: true },
      { id: 'p2', name: 'Sam', token: 'tok-2', isHost: false, connected: false },
    ],
    note: 'a payload the store never reads',
    ...overrides,
  };
}

const store = () => createFileStore<StubRecord>(dir, isStubRecord);

/** Delay the next `rename` so a write is verifiably still in flight. */
async function delayNextRename(ms: number): Promise<void> {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const fsp = await import('node:fs/promises');
  let first = true;
  vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, ms));
    }
    return real.rename(from, to);
  });
}

describe('the file store', () => {
  it('round-trips a record, tokens and payload and all', async () => {
    const s = store();
    await s.save(record());

    const { records, unreadable } = await s.loadAll();
    expect(unreadable).toEqual([]);
    expect(records).toHaveLength(1);
    // The tokens are the whole point: a restored room is one people can rejoin.
    expect(records[0]!.players.map((p) => p.token)).toEqual(['tok-1', 'tok-2']);
    expect(records[0]!.note).toBe('a payload the store never reads');
  });

  it('hands guard-refused and unparseable files back by name, silently', async () => {
    const s = store();
    await s.save(record());
    await writeFile(join(dir, 'JUNK01.json'), '{ this is not json', 'utf-8');
    await writeFile(join(dir, 'HALF02.json'), JSON.stringify({ roomId: 'HALF02' }), 'utf-8');
    await writeFile(
      join(dir, 'OLD003.json'),
      JSON.stringify(record({ roomId: 'OLD003', version: STUB_VERSION - 1 })),
      'utf-8',
    );

    // Silently is load-bearing: the registries own the one warn line per
    // file, and the store logging a second was the redundancy the merge
    // removed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { records, unreadable } = await s.loadAll();
    expect(warn).not.toHaveBeenCalled();

    expect(records.map((r) => r.roomId)).toEqual(['ABC123']);
    expect(unreadable.sort()).toEqual(['HALF02.json', 'JUNK01.json', 'OLD003.json']);
  });

  it('is empty, not broken, when the directory does not exist yet', async () => {
    const s = createFileStore<StubRecord>(join(dir, 'never-written'), isStubRecord);
    expect(await s.loadAll()).toEqual({ records: [], unreadable: [] });
  });

  it('remove() makes a room unloadable, and removing it again is fine', async () => {
    const s = store();
    await s.save(record());
    await s.remove('ABC123');
    await s.remove('ABC123');
    expect((await s.loadAll()).records).toEqual([]);
  });

  // What this proves: after a completed save, nothing named `*.tmp` is left
  // for a later `loadAll` glob to trip over — the directory holds exactly
  // the final name. What it does not prove: that the record was staged
  // through a temp file at all; writing straight to the target leaves the
  // same listing. The thing `rename`'s atomicity actually guards — a
  // process dying between write and rename — has no window a unit test can
  // open. (Both original suites carried this same honesty note.)
  it('leaves no partial file behind — every write lands whole, under a final name', async () => {
    const s = store();
    await s.save(record());
    expect(await readdir(dir)).toEqual(['ABC123.json']);
  });
});

describe('two saves for the same room, in flight at once', () => {
  it('lands the second one last even when the first write is slower', async () => {
    // Without the per-room promise chain these two writes race: the first
    // one's `rename` is delayed past the second's, so the *older* record is
    // what survives on disk. Serialising them is what makes last-call-wins
    // true rather than lucky.
    await delayNextRename(30);

    const s = store();
    const a = s.save(record({ savedAt: 1 }));
    const b = s.save(record({ savedAt: 2 }));
    await Promise.all([a, b]);

    const { records } = await s.loadAll();
    expect(records[0]!.savedAt).toBe(2);
  });
});

describe('settled()', () => {
  it('resolves only after an in-flight save has landed', async () => {
    // The shutdown case: a handler saved fire-and-forget, the process is
    // stopping. Without the drain, the read below sees an empty directory
    // and the room restores a move behind — or not at all.
    await delayNextRename(30);

    const s = store();
    void s.save(record());
    await s.settled();

    const { records } = await s.loadAll();
    expect(records).toHaveLength(1);
  });

  it('resolves immediately when nothing is in flight', async () => {
    await store().settled();
  });

  it('waits out a save queued while another was already in flight', async () => {
    await delayNextRename(30);

    const s = store();
    void s.save(record({ savedAt: 1 }));
    void s.save(record({ savedAt: 2 }));
    await s.settled();

    expect((await s.loadAll()).records[0]!.savedAt).toBe(2);
  });
});

describe('what loadAll says about files it cannot read', () => {
  it('quarantines by rename, and the file stops being read at the next load', async () => {
    const s = store();
    await writeFile(join(dir, 'game-rotten.json'), '{ not json', 'utf8');

    await s.quarantine('game-rotten.json');

    // Renamed, not unlinked: still on disk for a human, out of the boot path.
    expect(await readdir(dir)).toEqual(['game-rotten.json.bad']);
    expect((await s.loadAll()).unreadable).toEqual([]);
  });

  it('survives quarantining a file that vanished in the meantime', async () => {
    // Two processes sharing a directory over a redeploy is the ordinary
    // case, and the loser of that race must not throw out of the boot path.
    await expect(store().quarantine('game-gone.json')).resolves.toBeUndefined();
  });
});

describe('the null store', () => {
  it('accepts everything, holds nothing, settles instantly', async () => {
    const s = createNullStore<StubRecord>();
    await s.save(record());
    await s.remove('ABC123');
    await s.quarantine('anything.json');
    await s.settled();
    expect(await s.loadAll()).toEqual({ records: [], unreadable: [] });
  });
});

describe('the envelope guard', () => {
  it('accepts the envelope at its own version and refuses everything else', () => {
    expect(hasEnvelope(record(), STUB_VERSION)).toBe(true);
    expect(hasEnvelope(record(), STUB_VERSION + 1)).toBe(false);
    expect(hasEnvelope(null, STUB_VERSION)).toBe(false);
    expect(hasEnvelope({ ...record(), savedAt: 'yesterday' }, STUB_VERSION)).toBe(false);
    expect(hasEnvelope({ ...record(), players: [{ id: 'p1' }] }, STUB_VERSION)).toBe(false);
  });
});
