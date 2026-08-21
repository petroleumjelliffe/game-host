// The mount's close() must not resolve while a save is in flight.
//
// Handlers save fire-and-forget (a player should not wait on a disk to see
// their own move), the store queues the writes — and until 2026-08-20,
// close() then abandoned the queue: closeSockets and resolve, with the last
// commit of a room still unrenamed in a temp file. In production the
// process exits right behind close(), so that write dies with it and the
// room restores a move behind — "the last move of every game is lost
// exactly when it matters most", as Rail Baron's settled() comment put it,
// on every deploy that catches a write in flight. Since git pull became the
// deploy, that window opens on every merge.
//
// In-process, an abandoned write completes anyway — the event loop is still
// alive — so the honest assertion is not "the file eventually exists" but
// "the file exists at the moment close() resolves". The delayed rename is
// what holds the write open long enough for the difference to be visible.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createServer } from './index.js';
import { createFileStore } from './store.js';

// Same device as store.test.ts: spy-mock the module so one test can slow
// `rename` down while everything else calls through.
vi.mock('node:fs/promises', { spy: true });

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-drain-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('close() and the write still in flight', () => {
  it('does not resolve until the last save has landed', async () => {
    const handle = createServer({ store: createFileStore(dir) });
    const room = handle.rooms.fromState('DRAIN1', ['Alex', 'Sam'], buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['I5'],
      bag: ['I11', 'I12'],
    }));

    // Hold the write open across the close, the way a deploy catches one.
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

    // Fire-and-forget, exactly as deliver() calls it on every commit.
    void handle.rooms.persist(room);

    await handle.game.close();

    // At this instant a real process exits. Whatever has not landed is lost.
    expect(await readdir(dir)).toContain('DRAIN1.json');
  });
});
