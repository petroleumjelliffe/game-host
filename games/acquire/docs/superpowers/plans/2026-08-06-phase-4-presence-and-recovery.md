# Phase 4 — Presence and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an online game survive a page refresh, a dropped socket, and a server restart, and make a dropped player visible instead of an unexplained stall.

**Architecture:** The server gains durable rooms — a store holding the roster, its rejoin tokens and the last committed state, read back at boot. The wire gains one new `StateReason` (`resume`) that hands a reconnecting actor their own open draft instead of the turn-start state they get today, and two new rejection codes that tell "no such room" from "your seat was refused". The client's reconnect path already exists; the work there is presence, copy, and the screens for a room that is gone.

**Tech Stack:** TypeScript, React 18, Vite, vitest (two projects: `node` and `app`/jsdom), socket.io 4, Express, Tailwind.

**Design:** [../specs/2026-08-06-phase-4-presence-and-recovery-design.md](../specs/2026-08-06-phase-4-presence-and-recovery-design.md)

## Global Constraints

- **No `as any`.** Narrow with the engine's type guards. This is a `CLAUDE.md` rule.
- **Never import `engine/golden/runner` from `src/`** — it pulls vitest into the bundle. Use `replayGoldenGame`.
- **Derive from the engine, never hardcode** prices, totals or board positions.
- **Five gates, all green, per task:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`.
- **Never run bare `tsc`** — use `npm run typecheck`.
- **Baseline before this phase, measured 2026-08-06:** 622 tests in 60 files, all passing, no warning line in the output. Any task that leaves a warning in `npx vitest run` has regressed the baseline.
- **`engine/` and `session/` and `server/` must not touch browser globals** — they run under `environment: 'node'` in vitest for exactly that reason.
- **Every test that claims "X received Y" or "nobody received Z" ships with a named break that must turn it red.** Four of this project's eight historical hollow gates are that shape. Absence assertions follow the eight-run rule: run the assertion's test eight times before trusting it.
- **Panel zone order** is `stepstack → active → staging → hand → players`, and zone heights are floors, not fixed heights.
- **Copy, verbatim, where this plan gives it.** `Waking the server — this can take up to 30 seconds` uses an em dash. `This room is no longer available` is sentence case.

## Known errors in this plan, found during execution

Recorded here rather than silently patched, because the task text below still contains them and an
implementer reading a task in isolation needs the warning at the top.

**Board adjacency is wrong in three tasks' fixtures.** Tasks 3, 5 and 6 each build what they call a
"plain placement" out of a lone tile at `E5` and a hand tile at `E6`. **Those two squares are
adjacent**, so the placement founds a chain, the stage moves to `foundStartup`, and the `endTurn`
that follows is refused with `wrongStage`. Three separate implementers hit this and traced it
independently before finding it.

The rule, from `engine/gameHelpers.ts`: rows are `A`–`I`, columns `1`–`12`, and two squares are
adjacent when they share a row and differ by one column, or share a column and differ by one row.
For a placement that founds nothing, the tile must touch no placed tile at all — `I5` beside a hand
of `E6` and `A1` works, and is what the tasks actually shipped.

**Check adjacency yourself before trusting any fixture in this document.** The same care applies to
any new fixture: a placement that quietly founds a chain produces a test that passes for the wrong
reason, or fails somewhere unrelated to what it meant to prove.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `server/store.ts` | The `RoomStore` interface, `SavedRoom`, `SAVE_VERSION`, `createFileStore`, `createNullStore`. Storage mechanics only — no policy about age or lifecycle. |
| `server/store.test.ts` | Round trip, version and shape rejection, atomic write, serialised writes. |
| `server/recovery.test.ts` | Test 3 — a server restarted with a game in progress, and the paired empty-store negative. |
| `src/game/online/RoomGone.tsx` | The screen for a room the server does not have. |

**Deleted**

| File | Why |
|---|---|
| `server/persistence.ts` | Becomes `server/store.ts`. Its `saveGame` had one caller and its header documents its own unrestorability. |

**Modified**

| File | Change |
|---|---|
| `server/room.ts` | `lifecycle` derives `'over'` from `state.stage`; tracks and exposes `previousSegmentStart()`. |
| `server/rooms.ts` | Registry takes a `RoomStore`; `persist` writes the roster too; new `restore()` with the 7-day age policy. |
| `server/index.ts` | `createServer` accepts a store; restores before `listen`; `resume` on rejoin; `noSuchRoom`/`seatRefused` split; `previousSegmentStart` on every send. |
| `session/protocol.ts` | `StateReason` gains `'resume'`; `StateMessage` gains `previousSegmentStart?`; `RejectionCode` gains two codes. |
| `src/net/NetworkSession.ts` | Adopts the server's `previousSegmentStart` when present. |
| `src/net/useRoom.ts` | A `gone` phase driven by the `noSuchRoom` code. |
| `src/net/connection.ts` | socket.io reconnection options stated rather than inherited. |
| `src/pages/RoomPage.tsx` | Derives `presence` from the roster; renders `RoomGone`. |
| `src/game/GameScreen.tsx` | New `presence` prop, threaded to `PlayersStrip` and `TurnToast`. |
| `src/game/panel/PlayersStrip.tsx` | A connected dot per seat. |
| `src/game/online/TurnToast.tsx` | Says the actor is disconnected. |
| `src/game/online/ConnectionStrip.tsx` | Explains a slow connect after ~3s. |
| `server/clientOverWire.test.ts` | Test 2 — a dropped and restored socket mid-turn. |
| `server/projectionOverWire.test.ts` | The resume case, as the privacy oracle. |
| `src/pages/RoomPage.test.tsx` | Test 1 — refresh mid-turn; the stale-identity test moves to `seatRefused`. |

---

### Task 1: The store

Storage mechanics, with no knowledge of rooms, ages or lifecycles. Replaces `server/persistence.ts`, whose record shape (`{ roomId, version, state }`) carries no roster and therefore cannot be restored into a game anyone could rejoin.

**Files:**
- Create: `server/store.ts`
- Create: `server/store.test.ts`
- Delete: `server/persistence.ts`
- Modify: `server/rooms.ts:4` (the `saveGame` import), `server/rooms.ts:88-95` (`persist`)

**Interfaces:**
- Consumes: `RoomPlayer` from `./room.js`, `GameState` from `../engine/gameTypes.js`.
- Produces:
  - `interface SavedRoom { roomId: string; version: number; savedAt: number; players: RoomPlayer[]; state: GameState }`
  - `interface RoomStore { save(record: SavedRoom): Promise<void>; loadAll(): Promise<SavedRoom[]>; remove(roomId: string): Promise<void> }`
  - `const SAVE_VERSION = 4`
  - `function createFileStore(dir: string): RoomStore`
  - `function createNullStore(): RoomStore`

- [ ] **Step 1: Write the failing tests**

Create `server/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createFileStore, createNullStore, SAVE_VERSION, type SavedRoom } from './store.js';
import type { RoomPlayer } from './room.js';

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
    const loaded = await store.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].roomId).toBe('ABC123');
    // The whole point of version 4: a restored room is one people can rejoin.
    expect(loaded[0].players.map((p) => p.token)).toEqual(['tok-1', 'tok-2']);
    expect(loaded[0].state.board).toEqual(saved.state.board);
  });

  it('ignores a record from an older save version rather than coercing it', async () => {
    await writeFile(
      join(dir, 'OLD123.json'),
      JSON.stringify({ ...record({ roomId: 'OLD123' }), version: SAVE_VERSION - 1 }),
      'utf-8',
    );

    expect(await createFileStore(dir).loadAll()).toEqual([]);
  });

  it('ignores a file that is not a record at all', async () => {
    await writeFile(join(dir, 'JUNK01.json'), '{ this is not json', 'utf-8');
    await writeFile(join(dir, 'HALF02.json'), JSON.stringify({ roomId: 'HALF02' }), 'utf-8');

    expect(await createFileStore(dir).loadAll()).toEqual([]);
  });

  it('is empty, not broken, when the directory does not exist yet', async () => {
    expect(await createFileStore(join(dir, 'not-created')).loadAll()).toEqual([]);
  });

  it('removes a record', async () => {
    const store = createFileStore(dir);
    await store.save(record());

    await store.remove('ABC123');

    expect(await store.loadAll()).toEqual([]);
  });

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
    let first = true;
    vi.spyOn(await import('node:fs/promises'), 'rename').mockImplementation(async (from, to) => {
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

    const loaded = await store.loadAll();
    expect(loaded[0].savedAt).toBe(2);
  });
});

describe('the null store', () => {
  it('accepts saves and holds nothing, so a registry with no store still runs', async () => {
    const store = createNullStore();
    await store.save(record());
    await store.remove('ABC123');
    expect(await store.loadAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node server/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store.js"`.

- [ ] **Step 3: Write the store**

Create `server/store.ts`:

```ts
// server/store.ts
// Where a room lives between processes.
//
// Storage mechanics only. How old a record may be before it is worthless, and
// what a restored room means, are the registry's business — this file will
// hand back anything it can parse.
//
// The interface exists so the file implementation can be swapped for one that
// survives a host with an ephemeral filesystem (Render's free tier resets its
// disk on every restart — see DEPLOYMENT.md). Deliberately one implementation:
// a second, speculative backend would be a guess about a decision nobody has
// made yet.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameState } from '../engine/gameTypes.js';
import type { RoomPlayer } from './room.js';

/**
 * Bumped to 4 for Phase 4: a record now carries the roster and its rejoin
 * tokens, which version 3 did not. Version 3's own header said why that
 * mattered — a game restored without them is one nobody can rejoin — so a
 * version-3 file is not upgradable, only discardable.
 */
export const SAVE_VERSION = 4;

export interface SavedRoom {
  roomId: string;
  version: number;
  /** Epoch ms. The registry's eviction policy reads this; the store does not. */
  savedAt: number;
  /** Including `token`, which is the whole reason a restored room is rejoinable. */
  players: RoomPlayer[];
  /** Committed only. A draft is never written — it was never real. */
  state: GameState;
}

export interface RoomStore {
  save(record: SavedRoom): Promise<void>;
  loadAll(): Promise<SavedRoom[]>;
  remove(roomId: string): Promise<void>;
}

function isRoomPlayer(value: unknown): value is RoomPlayer {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.token === 'string' &&
    typeof p.isHost === 'boolean' &&
    typeof p.connected === 'boolean'
  );
}

/**
 * Field-level, and deliberately not deeper.
 *
 * A file on disk is text that has outlived whatever wrote it, so the shape is
 * checked before anything dereferences it. The `state` is trusted past
 * "is an object": it came from this server's own engine, and re-validating a
 * whole `GameState` here would be a second copy of the engine's types that
 * could drift from the first.
 */
function isSavedRoom(value: unknown): value is SavedRoom {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.roomId === 'string' &&
    r.version === SAVE_VERSION &&
    typeof r.savedAt === 'number' &&
    Array.isArray(r.players) &&
    r.players.every(isRoomPlayer) &&
    typeof r.state === 'object' &&
    r.state !== null
  );
}

export function createFileStore(dir: string): RoomStore {
  /**
   * One promise per room, so two commits landing in the same tick queue
   * rather than race. `deliver` calls `persist` fire-and-forget on every
   * commit, so "two writes in flight for one room" is the ordinary case, not
   * an edge one — and the loser of that race is the *newer* state.
   */
  const chains = new Map<string, Promise<void>>();

  async function writeRecord(record: SavedRoom): Promise<void> {
    const target = join(dir, `${record.roomId}.json`);
    // `.tmp` then rename: `rename` is atomic on POSIX, so a crash mid-write
    // leaves either the old record or the new one, never half of either.
    // Truncated JSON is exactly what a restart-recovery feature must not
    // produce for itself.
    const temp = `${target}.tmp`;
    try {
      // `recursive: true` makes this idempotent, so there is no boot-time
      // setup step left to forget.
      await mkdir(dir, { recursive: true });
      await writeFile(temp, JSON.stringify(record), 'utf-8');
      await rename(temp, target);
    } catch (e) {
      console.error(`✗ Could not save room ${record.roomId}:`, e);
    }
  }

  return {
    save(record) {
      const queued = (chains.get(record.roomId) ?? Promise.resolve())
        .then(() => writeRecord(record));
      chains.set(record.roomId, queued);
      return queued;
    },

    async loadAll() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        // No directory yet is the ordinary first-boot case, not a fault.
        return [];
      }

      const out: SavedRoom[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf-8'));
          if (isSavedRoom(parsed)) out.push(parsed);
          else console.warn(`✗ Ignoring unreadable save ${name}`);
        } catch {
          console.warn(`✗ Ignoring unreadable save ${name}`);
        }
      }
      return out;
    },

    async remove(roomId) {
      try {
        await unlink(join(dir, `${roomId}.json`));
      } catch {
        // Already gone is the outcome asked for.
      }
    },
  };
}

/**
 * Holds nothing, forgets everything, never fails.
 *
 * The registry's default, so every existing caller of `createRoomRegistry()`
 * — and every test that does not care about durability — keeps working
 * without a store to hand it.
 */
export function createNullStore(): RoomStore {
  return {
    save: async () => {},
    loadAll: async () => [],
    remove: async () => {},
  };
}
```

- [ ] **Step 4: Point the registry at the store and delete `persistence.ts`**

In `server/rooms.ts`, replace the `saveGame` import:

```ts
import { createNullStore, SAVE_VERSION, type RoomStore, type SavedRoom } from './store.js';
```

and replace `persist` (currently `server/rooms.ts:88-95`):

```ts
    async persist(room) {
      // `committed()` throws before a game begins, so the lifecycle check is
      // load-bearing rather than an optimisation. Drafts are never written:
      // uncommitted work was never real, which is the segment model stated as
      // a storage fact.
      if (room.lifecycle() === 'lobby') return;
      const record: SavedRoom = {
        roomId: room.id,
        version: SAVE_VERSION,
        savedAt: Date.now(),
        // Copied, not referenced: `connected` mutates under a live socket and
        // a record is a snapshot. The value written is irrelevant — `restore`
        // forces every seat disconnected — but a record that keeps changing
        // after it was handed over is a trap for the next reader.
        players: room.players.map((p) => ({ ...p })),
        state: room.committed(),
      };
      await store.save(record);
    },
```

Give the factory its store parameter — the default keeps all seven existing `createRoomRegistry()` call sites working unchanged:

```ts
export function createRoomRegistry(store: RoomStore = createNullStore()): RoomRegistry {
```

Then delete the old file:

```bash
git rm server/persistence.ts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project node server/store.test.ts server/rooms.test.ts`
Expected: PASS — 13 store tests, 7 registry tests.

- [ ] **Step 6: Break it, and watch it fail**

Two breaks, each run and then reverted:

1. In `createFileStore.save`, drop the chain — return `writeRecord(record)` directly. Expected: **"lands the second one last even when the first write is slower" fails**, with `savedAt` 1 instead of 2. This is the break that proves the serialisation is load-bearing rather than decorative.
2. In `writeRecord`, write straight to `target` instead of `temp` + `rename`. Expected: the atomicity test still passes (there is no crash to observe) but the serialisation test above **also** passes — record that in the task report. This is a break that cannot succeed against these tests: `rename`'s atomicity guards a crash window no unit test can open. State the limit in the test file rather than pretending otherwise.

- [ ] **Step 7: Run all five gates**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
```

Expected: all green; test count 622 + 13 new.

- [ ] **Step 8: Commit**

```bash
git add server/store.ts server/store.test.ts server/rooms.ts
git commit -m "feat(server): a room store that keeps the roster, not just the state"
```

---

### Task 2: Restore at boot

The read side. Nothing has ever read a save back — `loadAllGames` lost its only caller when `gameManagerXState.ts` was deleted in Phase 3a.

**Files:**
- Modify: `server/room.ts:64` (lifecycle derivation)
- Modify: `server/rooms.ts` (`restore`, `fromRecord`)
- Modify: `server/index.ts:39-46` (`createServer` signature)
- Modify: `server/rooms.test.ts` (new describe blocks)

**Interfaces:**
- Consumes: `RoomStore`, `SavedRoom`, `SAVE_VERSION` from Task 1.
- Produces:
  - `RoomRegistry.restore(now?: number): Promise<number>` — returns how many rooms were seated.
  - `const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000` exported from `server/rooms.ts`.
  - `createServer(options?: { store?: RoomStore }): ServerHandle` — `ServerHandle` unchanged otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `server/rooms.test.ts` (and add these imports at the top):

```ts
import { createRoomRegistry, MAX_AGE_MS } from './rooms.js';
import { createFileStore, SAVE_VERSION, type SavedRoom } from './store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

```ts
describe('restoring rooms at boot', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-restore-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  /** Saves a room through a live registry, exactly as a commit would. */
  async function seedSavedRoom(roomId: string): Promise<SavedRoom> {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    const room = rooms.fromState(roomId, ['Alex', 'Sam'], fixture());
    await rooms.persist(room);
    const [saved] = await store.loadAll();
    return saved;
  }

  it('seats a saved room again, with its tokens intact', async () => {
    const saved = await seedSavedRoom('ABC123');

    const rooms = createRoomRegistry(createFileStore(dir));
    const count = await rooms.restore();

    expect(count).toBe(1);
    const room = rooms.get('ABC123');
    expect(room).toBeDefined();
    expect(room!.lifecycle()).toBe('playing');
    // The rejoin material survived the process, which is the whole feature.
    const token = saved.players[1].token;
    expect(rooms.join('ABC123', 'Sam', 'p2', token)?.player.id).toBe('p2');
  });

  it('brings every restored seat back disconnected', async () => {
    await seedSavedRoom('ABC123');

    const rooms = createRoomRegistry(createFileStore(dir));
    await rooms.restore();

    // Presence is a fact about live sockets. Nothing is connected to a
    // process that has only just started.
    expect(rooms.get('ABC123')!.players.every((p) => !p.connected)).toBe(true);
  });

  it('restores a finished game as over, not as still playing', async () => {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    const room = rooms.fromState('END123', ['Alex', 'Sam'], { ...fixture(), stage: 'end' });
    await rooms.persist(room);

    const revived = createRoomRegistry(createFileStore(dir));
    await revived.restore();

    // `createGameRoom` used to derive lifecycle as `initial ? 'playing' :
    // 'lobby'`, which would bring a finished game back as one still waiting
    // for a move nobody can make.
    expect(revived.get('END123')!.lifecycle()).toBe('over');
  });

  it('drops and deletes a record older than the age limit', async () => {
    await seedSavedRoom('OLD123');
    const store = createFileStore(dir);

    const rooms = createRoomRegistry(store);
    const count = await rooms.restore(Date.now() + MAX_AGE_MS + 1);

    expect(count).toBe(0);
    expect(rooms.get('OLD123')).toBeUndefined();
    // Deleted, not merely skipped — otherwise the directory grows forever
    // and every boot re-reads records it will never use.
    expect(await store.loadAll()).toEqual([]);
  });

  it('is zero, not a crash, with nothing saved', async () => {
    const rooms = createRoomRegistry(createFileStore(dir));
    expect(await rooms.restore()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node server/rooms.test.ts`
Expected: FAIL — `rooms.restore is not a function`, and `MAX_AGE_MS` unresolved.

- [ ] **Step 3: Fix the lifecycle derivation**

In `server/room.ts`, replace line 64:

```ts
  // A restored game that has already ended comes back `over`, not `playing`.
  // Deriving this from the state rather than from "was I handed one" is what
  // stops a finished game reviving as one still waiting on a move nobody can
  // legally make.
  let lifecycle: Lifecycle = initial ? (initial.stage === 'end' ? 'over' : 'playing') : 'lobby';
```

- [ ] **Step 4: Add `restore` to the registry**

In `server/rooms.ts`, add to the `RoomRegistry` interface:

```ts
  /**
   * Seats every saved room this store still holds. Returns how many.
   *
   * `now` is injectable so the age policy can be tested without waiting a
   * week; the server never passes it.
   */
  restore(now?: number): Promise<number>;
```

Export the policy and implement it:

```ts
/**
 * How long a saved room is worth reviving.
 *
 * Long enough that a game abandoned over a weekend is still there on Monday;
 * short enough that the directory does not grow without bound and `restore`
 * does not delay `listen` behind a boot-time read of every game ever played.
 */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
```

```ts
    async restore(now = Date.now()) {
      const saved = await store.loadAll();
      let seated = 0;

      for (const record of saved) {
        if (now - record.savedAt > MAX_AGE_MS) {
          await store.remove(record.roomId);
          continue;
        }

        // Never `connected: true`, whatever the record says. A record is a
        // snapshot of a moment when sockets were open; this process has
        // none. The roster broadcast that follows each rejoin is what turns
        // these back on, one seat at a time.
        const players = record.players.map((p) => ({ ...p, connected: false }));
        rooms.set(record.roomId, createGameRoom(record.roomId, players, record.state));
        seated++;
      }

      return seated;
    },
```

Note there is deliberately no lobby branch: `persist` never writes a room that has not begun, so a record always carries a state to seat.

- [ ] **Step 5: Call it at boot**

In `server/index.ts`, take a store and restore before listening:

```ts
export interface ServerOptions {
  /** Defaults to the null store, so every test that boots a bare server keeps working. */
  store?: RoomStore;
}

export function createServer(options: ServerOptions = {}): ServerHandle {
  const app = express();
  ...
  const rooms = createRoomRegistry(options.store ?? createNullStore());
```

and, at the bottom of the file, in the run-directly block:

```ts
if (process.argv[1]?.endsWith('index.ts')) {
  const store = createFileStore(join(process.cwd(), 'server', 'games'));
  const { httpServer, rooms } = createServer({ store });
  const port = Number(process.env.PORT ?? 3001);

  // Before `listen`, not after: a client that connects into a half-restored
  // registry would be told its room does not exist and would clear the very
  // identity that was about to work.
  void rooms.restore().then((count) => {
    if (count > 0) console.log(`✓ Restored ${count} room(s)`);
    httpServer.listen(port, () => console.log(`✓ Server listening on ${port}`));
  });
}
```

with the imports `import { join } from 'node:path';` and `import { createFileStore, createNullStore, type RoomStore } from './store.js';`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project node server/`
Expected: PASS — all server tests, including the 6 new restore tests.

- [ ] **Step 7: Break it, and watch it fail**

1. In `restore`, pass `record.players` through unchanged instead of forcing `connected: false`. Expected: **"brings every restored seat back disconnected" fails**.
2. Revert `server/room.ts:64` to `initial ? 'playing' : 'lobby'`. Expected: **"restores a finished game as over" fails** with `'playing'`.
3. In `restore`, `continue` on an expired record without calling `store.remove`. Expected: **"drops and deletes a record older than the age limit" fails** on the `loadAll` assertion, while the `count` and `get` assertions still pass — which is the point of asserting all three.

- [ ] **Step 8: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add server/room.ts server/rooms.ts server/rooms.test.ts server/index.ts
git commit -m "feat(server): rooms come back after a restart, tokens and all"
```

---

### Task 3: `resume`, and the draft a reconnecting actor gets back

The bug this phase exists to fix. A socket rejoining mid-turn is sent `reason: 'commit'` (`server/index.ts:209`), which resolves to `room.committed()` — the state at the *start* of the turn — while shipping the open draft's `segmentStart` alongside it. The server still holds the draft, so the player's next intent lands on a state they cannot see.

**Files:**
- Modify: `session/protocol.ts:126-133`
- Modify: `server/room.ts` (track `previousSegmentStart`)
- Modify: `server/index.ts:57-75` (`sendState`), `:209` (the rejoin send)
- Modify: `src/net/NetworkSession.ts:56-64`, `:84-101`
- Modify: `server/room.test.ts`, `src/net/NetworkSession.test.ts`

**Interfaces:**
- Produces:
  - `type StateReason = 'commit' | 'correction' | 'reset' | 'resume'`
  - `StateMessage` gains `previousSegmentStart?: number`
  - `GameRoom.previousSegmentStart(): number | undefined`

- [ ] **Step 1: Write the failing tests**

Append to `server/room.test.ts`:

```ts
describe('the segment before the open one', () => {
  it('is undefined until a commit has replaced one', () => {
    const room = createGameRoom('R1', roomPlayers(), fixture());
    expect(room.previousSegmentStart()).toBeUndefined();
  });

  it('is where the finished segment began, once one commits', () => {
    const room = createGameRoom('R1', roomPlayers(), fixture());
    const opened = room.segmentStart();

    // A placement that founds nothing and ends the turn: the shortest path
    // to a segment boundary against this fixture.
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });
    room.dispatch('p1', { type: 'endTurn' });

    expect(room.segmentStart()).not.toBe(opened);
    expect(room.previousSegmentStart()).toBe(opened);
  });
});
```

Append to `src/net/NetworkSession.test.ts`:

```ts
describe('a resume', () => {
  it('adopts the server previousSegmentStart rather than starting blind', () => {
    const t = fakeTransport();
    const state = openingState();
    const session = createNetworkSession({
      transport: t.transport,
      playerId: 'p2',
      initial: { state, reason: 'resume', segmentStart: 12, previousSegmentStart: 4 },
    });

    // A refresh builds this session from one message. Without the field, the
    // step stack's read-only previous turn is blank until the next commit —
    // recovery that forgets what you were reading.
    expect(session.getView().previousSegmentStart).toBe(4);
  });

  it('clears a parked disconnection message when the state comes back', () => {
    const t = fakeTransport();
    const state = openingState();
    const session = createNetworkSession({
      transport: t.transport,
      playerId: 'p2',
      initial: { state, reason: 'commit', segmentStart: state.nextStepId },
    });

    session.connectionLost();
    expect(session.getView().error?.code).toBe('notConnected');

    t.sendState({ state, reason: 'resume', segmentStart: state.nextStepId });

    expect(session.getView().error).toBeNull();
  });
});
```

(Reuse whatever `fakeTransport` / `openingState` helpers `NetworkSession.test.ts` already defines rather than adding new ones.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node server/room.test.ts` and `npx vitest run --project app src/net/NetworkSession.test.ts`
Expected: FAIL — `room.previousSegmentStart is not a function`; and a type error on `reason: 'resume'`.

- [ ] **Step 3: Widen the protocol**

In `session/protocol.ts`, replace lines 121-133:

```ts
/**
 * Why a state arrived.
 *
 * `commit` went to the whole table; `correction`, `reset` and `resume` went to
 * one player. Tests assert on this: "a non-actor never receives a correction"
 * is the draft-privacy guarantee, stated directly.
 *
 * `resume` is what a rejoining socket gets. It is deliberately not `commit`:
 * `sendState`'s draft rule keys off "is this a commit", so sending `commit`
 * here handed a reconnecting actor the state at the *start* of their turn
 * while the server still held their open draft — and their next intent then
 * landed on a state they could not see. `resume` is also not `reset`, because
 * a reset is the rollback half of a rejection and deliberately preserves the
 * error explaining it; a resume has nothing to explain and should clear one.
 */
export type StateReason = 'commit' | 'correction' | 'reset' | 'resume';

export interface StateMessage {
  /** Projected for this recipient: no seed, no bag, no other player's hand. */
  state: GameState;
  reason: StateReason;
  segmentStart: number;
  /**
   * Where the segment before the open one began, when there is one.
   *
   * The client can derive this by watching `segmentStart` change across
   * messages, and does — but a client rebuilt from a single message after a
   * refresh has no earlier message to have watched. Sending it is what lets
   * the step stack show the previous turn immediately rather than after the
   * next commit.
   */
  previousSegmentStart?: number;
}
```

- [ ] **Step 4: Track it in the room**

In `server/room.ts`, add to the `GameRoom` interface:

```ts
  /** Where the segment before the open one began, once one has closed. */
  previousSegmentStart(): number | undefined;
```

Add the state, next to `committed`:

```ts
  let previousSegmentStart: number | undefined;
```

Expose it alongside `segmentStart`:

```ts
    previousSegmentStart: () => previousSegmentStart,
```

And record it at the one place a segment closes, in `dispatch` (currently `server/room.ts:115`):

```ts
      if (view.segmentStart !== opened) {
        // `opened` was read before the dispatch, so it is where the segment
        // that just closed began — recorded here rather than derived later,
        // because after the commit nothing remembers it.
        previousSegmentStart = opened;
        return commit(view.state);
      }
```

- [ ] **Step 5: Send it, and send `resume` on rejoin**

In `server/index.ts`, extend the message built in `sendState`:

```ts
    const message: StateMessage = {
      state: project(source, playerId),
      reason,
      segmentStart: room.segmentStart(),
      previousSegmentStart: room.previousSegmentStart(),
    };
```

and widen the comment above `ownsDraft` to name the new reason:

```ts
    // A draft belongs to exactly one player: the one the game is waiting on.
    // `reset` follows a rejection, and a rejection can be addressed to someone
    // who is *not* the actor — an out-of-turn intent, or an undo from the
    // wrong player. Sending them the draft hands over the actor's uncommitted
    // board, cash and log, which is the leak this rule exists to prevent.
    // They get the committed state: it is what they already had, which is what
    // "reset" should mean for them.
    //
    // `resume` rides the same rule, and that is the point of it being a
    // separate reason: a reconnecting actor is by definition the player the
    // game is waiting on, so they get their own open draft back, and every
    // other reconnecting player gets the committed state — the same privacy
    // boundary, applied to a new arrival rather than a rejection.
    const ownsDraft = reason !== 'commit' && playerId === room.actorId();
```

Then change the rejoin send (currently `server/index.ts:209`):

```ts
      // `resume`, not `commit`: this socket may belong to the player the game
      // is waiting on, mid-segment, with work the server still holds.
      if (seat.room.lifecycle() !== 'lobby') sendState(seat.room, seat.player.id, 'resume');
```

- [ ] **Step 6: Adopt it on the client**

In `src/net/NetworkSession.ts`, seed from the initial message (currently line 64):

```ts
  let previousSegmentStart: number | undefined = initial.previousSegmentStart;
```

and prefer the server's value in the state handler (currently lines 86-87):

```ts
    // The server's own answer wins when it has one. The local derivation
    // below it is the fallback for the only case the server cannot answer —
    // before any segment has closed, when there is no previous one to name.
    if (msg.previousSegmentStart !== undefined) previousSegmentStart = msg.previousSegmentStart;
    else if (msg.segmentStart !== segmentStart) previousSegmentStart = segmentStart;
    segmentStart = msg.segmentStart;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --project node server/ session/ && npx vitest run --project app src/net/`
Expected: PASS.

- [ ] **Step 8: Break it, and watch it fail**

1. Change the rejoin send back to `'commit'`. Expected: Task 5's socket-drop test fails (write it before trusting this break — if run now, note that nothing yet covers it, which is exactly why Task 5 exists).
2. Drop `previousSegmentStart` from the `StateMessage` built in `sendState`. Expected: **"adopts the server previousSegmentStart" fails** — undefined instead of 4.
3. In `dispatch`, set `previousSegmentStart = view.segmentStart` instead of `opened`. Expected: **"is where the finished segment began" fails**.

- [ ] **Step 9: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add session/protocol.ts server/room.ts server/room.test.ts server/index.ts src/net/NetworkSession.ts src/net/NetworkSession.test.ts
git commit -m "fix(net): a reconnecting player gets their own open segment back"
```

---

### Task 4: `noSuchRoom` and `seatRefused`

Today both failures reject with `unknownIntent` and the message `cannot join ABC123` (`server/index.ts:190-196`), so a typo'd code and a game lost to a restart are indistinguishable. They have different remedies and need different screens.

**Files:**
- Modify: `session/protocol.ts:108-119`
- Modify: `server/index.ts:153-210` (the `joinRoom` handler)
- Modify: `server/room.test.ts` or `server/rooms.test.ts` — add to `server/oneSeatPerSocket.test.ts`, which already boots a real server and drives joins
- Modify: `src/pages/RoomPage.test.tsx:327` (the existing stale-identity test's code)

**Interfaces:**
- Produces: `type RejectionCode = IllegalIntentCode | 'undoOutOfSegment' | 'notConnected' | 'noSuchRoom' | 'seatRefused'`

- [ ] **Step 1: Write the failing tests**

Append to `server/oneSeatPerSocket.test.ts` (follow that file's existing helpers for booting a server and raw-joining):

```ts
describe('a join that cannot be honoured', () => {
  it('says the room does not exist, by name', async () => {
    const server = await startTestServer();
    const socket = connect(`http://localhost:${server.port}`, { transports: ['websocket'] });
    const rejections: RejectedMessage[] = [];
    socket.on(SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));
    await new Promise<void>((r) => socket.on('connect', () => r()));

    socket.emit(CLIENT_EVENTS.joinRoom, { roomId: 'NOPE12', name: 'Sam' });
    await settleSocket(socket);

    // The distinction the gone-room screen is built on: nothing the player
    // can do reaches this room, so it is an ending, not a retry.
    expect(rejections.map((r) => r.code)).toEqual(['noSuchRoom']);

    socket.disconnect();
    await server.close();
  });

  it('says the seat was refused when the room is there but the token is not', async () => {
    const server = await startTestServer();
    const { room } = server.rooms.create('Alex');
    const socket = connect(`http://localhost:${server.port}`, { transports: ['websocket'] });
    const rejections: RejectedMessage[] = [];
    socket.on(SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));
    await new Promise<void>((r) => socket.on('connect', () => r()));

    socket.emit(CLIENT_EVENTS.joinRoom, {
      roomId: room.id, name: 'Ghost', playerId: 'p1', token: 'not-the-token',
    });
    await settleSocket(socket);

    // The room is still there. The remedy is to join it fresh, which is a
    // different screen from "this game is gone".
    expect(rejections.map((r) => r.code)).toEqual(['seatRefused']);

    socket.disconnect();
    await server.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node server/oneSeatPerSocket.test.ts`
Expected: FAIL — received `['unknownIntent']` for both.

- [ ] **Step 3: Add the codes**

In `session/protocol.ts`, replace lines 108-119:

```ts
/**
 * Everything the engine can refuse, plus the refusals the engine knows nothing
 * about.
 *
 * Undo is not an intent — it never reaches `applyIntent` — so
 * `IllegalIntentCode` has no word for "that step belongs to a segment you no
 * longer own". `notConnected` is not a refusal at all in the protocol sense —
 * the server never sends it — it is the client's own signal that the transport
 * is down, given a real member here rather than borrowing an unrelated wire
 * code.
 *
 * `noSuchRoom` and `seatRefused` are one refusal split in two, because they
 * have different remedies. Nothing reaches a room that is not there, so that
 * is an ending: the game may have finished, or the server may have restarted
 * with an ephemeral disk. A room that is there but refuses this seat means the
 * stored identity is stale, and joining fresh works. Sending one code for both
 * made every wiped game read as `cannot join ABC123`.
 *
 * Adding these here keeps `engine/` untouched.
 */
export type RejectionCode =
  | IllegalIntentCode
  | 'undoOutOfSegment'
  | 'notConnected'
  | 'noSuchRoom'
  | 'seatRefused';
```

- [ ] **Step 4: Split the two failures on the server**

In `server/index.ts`, restructure the `joinRoom` handler's seat resolution. The `rooms.get` check moves *above* the binding shortcut, because a room that does not exist cannot have a binding worth honouring:

```ts
      const target = rooms.get(msg.roomId);
      if (!target) {
        socket.emit(SERVER_EVENTS.rejected, {
          code: 'noSuchRoom',
          message: `Room ${msg.roomId} is no longer available`,
        });
        return;
      }

      // One socket holds one seat per room.
      //
      // A `joinRoom` with no `playerId`/`token` seats a *new* player — that is
      // what makes a first join work, and it is why a second one from the same
      // socket used to seat a second. Found by hand: two browsers produced a
      // three-player roster, and the orphaned seat is one the game waits on
      // forever when its turn comes, because nobody is behind it.
      //
      // A client cannot reliably prevent this on its own. It has no token to
      // present until its own `joined` reply lands, so a socket blip during
      // that window leaves it re-joining as a stranger with no way to say who
      // it already is. The binding this server already keeps is the answer:
      // if this socket is bound to a seat in the room it is asking to join,
      // that seat is the answer to the request.
      let seat: Seat | null = null;
      const bound = bindings.get(socket.id);
      if (bound && bound.roomId === msg.roomId) {
        const player = target.players.find((p) => p.id === bound.playerId);
        if (player) seat = { room: target, player };
      }

      seat ??= rooms.join(msg.roomId, msg.name, msg.playerId, msg.token);

      if (!seat) {
        socket.emit(SERVER_EVENTS.rejected, {
          code: 'seatRefused',
          message: `That seat in ${msg.roomId} is no longer yours — join again to take a new one`,
        });
        return;
      }

      seat.player.connected = true;
```

Note the `seat.player.connected = true` moves below the guard: it used to run on a possibly-null seat guarded only by `if (seat)`, which is now redundant.

- [ ] **Step 5: Update the client test that asserted the old code**

In `src/pages/RoomPage.test.tsx:327`, change the rejection the stale-identity test sends:

```ts
    f.sendRejected({ code: 'seatRefused', message: 'That seat in ABC123 is no longer yours' });
```

The behaviour under test — a refused rejoin clears the stored identity — is unchanged; only the code it arrives under is.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project node server/ && npx vitest run --project app src/pages/RoomPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Break it, and watch it fail**

1. Emit `seatRefused` for the missing-room case. Expected: **"says the room does not exist, by name" fails**.
2. Emit `noSuchRoom` for the bad-token case. Expected: **"says the seat was refused" fails**. Run both — a single shared code passing both tests is exactly the state this task replaces, so each direction needs its own proof.

- [ ] **Step 8: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add session/protocol.ts server/index.ts server/oneSeatPerSocket.test.ts src/pages/RoomPage.test.tsx
git commit -m "feat(net): a room that is gone says so, and a stale seat says something else"
```

---

### Task 5: Test 2 — a dropped and restored socket, mid-turn

The first of the phase's three recovery tests. `server/clientOverWire.test.ts` opens real sockets and has never dropped one.

**Files:**
- Modify: `server/clientOverWire.test.ts` (a new describe block)
- Modify: `server/projectionOverWire.test.ts` (the resume privacy case)

**Interfaces:**
- Consumes: `resume` and `previousSegmentStart` (Task 3); `startTestServer`, `connectPlayer`, `settleSocket` from `server/socketHarness.ts`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Append to `server/clientOverWire.test.ts`:

```ts
describe('a socket that drops mid-segment and comes back', () => {
  it('returns the actor to their own open draft, not to the start of the turn', async () => {
    const server = await startTestServer();
    const room = server.rooms.fromState('DROP01', ['Alex', 'Sam'], midTurnFixture());
    const [alex, sam] = room.players;

    const a = await connectPlayer(server.port, 'DROP01', 'Alex', alex.id, alex.token);
    const s = await connectPlayer(server.port, 'DROP01', 'Sam', sam.id, sam.token);

    // Alex opens a segment and does not close it.
    await a.send({ type: 'placeTile', coord: 'E6' });
    const draftedBoard = room.draft().board;
    expect(draftedBoard).not.toEqual(room.committed().board);

    const seenBySamBefore = s.states.length;

    // The drop.
    a.socket.disconnect();
    await settleSocket(s.socket);
    expect(room.players.find((p) => p.id === alex.id)!.connected).toBe(false);

    // The return: a new socket presenting the same token, which is exactly
    // what `useRoom` sends when the transport comes back.
    const again = await connectPlayer(server.port, 'DROP01', 'Alex', alex.id, alex.token);

    const resumed = again.latest()!;
    expect(resumed.reason).toBe('resume');
    // The tile Alex placed is still placed. Sending `commit` here — which is
    // what this did before Phase 4 — handed back the pre-placement board
    // while the server still held the placement.
    expect(resumed.state.board).toEqual(draftedBoard);
    expect(resumed.segmentStart).toBe(room.segmentStart());
    expect(room.players.find((p) => p.id === alex.id)!.connected).toBe(true);

    // And the next intent lands on the state Alex can actually see.
    await again.send({ type: 'endTurn' });
    expect(again.rejections).toEqual([]);

    // Sam never received any of it. The draft is one player's, and a
    // reconnection is not an excuse to broadcast one.
    await settleSocket(s.socket);
    const samsNew = s.states.slice(seenBySamBefore);
    for (const message of samsNew) {
      expect(message.reason).toBe('commit');
    }

    a.close(); s.close(); again.close();
    await server.close();
  });
});
```

Add `midTurnFixture()` to that file if it has no equivalent — a two-player fixture at `stage: 'play'` with `E6` in Alex's hand and a lone tile at `E5`, built with `buildFixture` exactly as `server/rooms.test.ts:5-14` does.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project node server/clientOverWire.test.ts`
Expected: PASS if Task 3 landed. **Before trusting it, revert Task 3's rejoin send to `'commit'` and re-run** — it must fail on `resumed.reason` and `resumed.state.board`. Restore the change afterwards. A test written after its feature is guilty until a break proves it can fail.

- [ ] **Step 3: Add the privacy oracle case**

Append to `server/projectionOverWire.test.ts`, following that file's existing shape-assertion style:

```ts
describe('a resume, as a projection', () => {
  it('gives a non-actor the committed state with no foreign hand, bag or seed', async () => {
    const server = await startTestServer();
    const room = server.rooms.fromState('PROJ01', ['Alex', 'Sam'], midTurnFixture());
    const [alex, sam] = room.players;

    const a = await connectPlayer(server.port, 'PROJ01', 'Alex', alex.id, alex.token);
    await a.send({ type: 'placeTile', coord: 'E6' });

    // Sam arrives mid-segment — a rejoin, a refresh, or a first connection
    // after someone else has already started their turn.
    const s = await connectPlayer(server.port, 'PROJ01', 'Sam', sam.id, sam.token);
    const resumed = s.latest()!;

    expect(resumed.reason).toBe('resume');
    // Committed, not Alex's draft: `resume` rides `sendState`'s draft rule,
    // and Sam is not the actor.
    expect(resumed.state.board).toEqual(room.committed().board);
    // The literal privacy shape, asserted here rather than inferred from a
    // consistency check — `clientOverWire` compares both sides through the
    // same `project` and would not notice `project` itself leaking.
    expect(resumed.state.players.find((p) => p.id === alex.id)!.hand).toEqual([]);
    expect(resumed.state.bag).toEqual([]);
    expect(resumed.state.seed).toBeUndefined();

    a.close(); s.close();
    await server.close();
  });
});
```

Match the exact `bag`/`seed` assertions that file already uses for a projected state — if it asserts a different shape (e.g. `seed: ''`), use that, not this.

- [ ] **Step 4: Run both to verify they pass**

Run: `npx vitest run --project node server/clientOverWire.test.ts server/projectionOverWire.test.ts`
Expected: PASS.

- [ ] **Step 5: Break it, and watch it fail**

1. In `sendState`, change `ownsDraft` to ignore the actor check (`const ownsDraft = reason !== 'commit'`). Expected: **the projection resume test fails** — Sam receives Alex's drafted board. This is the leak the new reason could have introduced, and the reason the privacy oracle case exists.
2. In the disconnect handler, stop setting `player.connected = false`. Expected: **the drop test fails** on the `connected` assertion.
3. Run the "Sam never received any of it" loop **eight times** (`npx vitest run --project node server/clientOverWire.test.ts --repeat 7`). It is an absence assertion, and this project's rule for those is eight runs before trusting them.

- [ ] **Step 6: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add server/clientOverWire.test.ts server/projectionOverWire.test.ts
git commit -m "test(server): a dropped socket returns to its own open segment"
```

---

### Task 6: Test 3 — a server restart with a game in progress

**Files:**
- Create: `server/recovery.test.ts`

**Interfaces:**
- Consumes: `createFileStore` (Task 1), `restore` (Task 2), `noSuchRoom` (Task 4), `startTestServer`/`connectPlayer` from the harness.

Note `startTestServer()` takes no arguments today and calls `createServer()`. This task needs a server bound to a specific store, so it boots one inline rather than extending the harness — a second harness parameter used by one file would be a worse trade than eight lines here.

- [ ] **Step 1: Write the failing test**

Create `server/recovery.test.ts`:

```ts
// server/recovery.test.ts
// The phase's third recovery test: a real server process's worth of state,
// thrown away and rebuilt from disk, with real clients reconnecting into it.
//
// Two servers, not one restarted in place — a new `createServer()` against the
// same store directory is what a process restart actually is from the room
// registry's point of view: an empty Map, an empty bindings table, and a
// directory of files.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { createServer } from './index.js';
import { createFileStore } from './store.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { connectPlayer, settleSocket } from './socketHarness.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type RejectedMessage,
} from '../session/protocol.js';

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-recovery-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function fixture() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

/** Boots a server on an ephemeral port against `dir`. */
async function boot() {
  const handle = createServer({ store: createFileStore(dir) });
  await new Promise<void>((r) => handle.httpServer.listen(0, r));
  const address = handle.httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    rooms: handle.rooms,
    close: () => new Promise<void>((r) => {
      handle.io.close();
      handle.httpServer.close(() => r());
    }),
  };
}

describe('a server restarted with a game in progress', () => {
  it('comes back with the roster, the tokens and the last committed state', async () => {
    const first = await boot();
    const room = first.rooms.fromState('KEEP01', ['Alex', 'Sam'], fixture());
    const [alex, sam] = room.players;

    const a = await connectPlayer(first.port, 'KEEP01', 'Alex', alex.id, alex.token);
    const s = await connectPlayer(first.port, 'KEEP01', 'Sam', sam.id, sam.token);

    // A whole turn, so what survives is a real commit rather than the seeded
    // fixture: place, then end. `endTurn` draws from the bag, so the state
    // after it is one only the server could have produced.
    await a.send({ type: 'placeTile', coord: 'E6' });
    await a.send({ type: 'endTurn' });
    const lastCommitted = room.committed();
    expect(lastCommitted.board).not.toEqual(fixture().board);

    a.close(); s.close();
    await first.close();

    // The restart.
    const second = await boot();
    expect(await second.rooms.restore()).toBe(1);

    // Both clients reconnect on the tokens they were holding — no form, no
    // new seat, nothing re-entered.
    const a2 = await connectPlayer(second.port, 'KEEP01', 'Alex', alex.id, alex.token);
    const s2 = await connectPlayer(second.port, 'KEEP01', 'Sam', sam.id, sam.token);

    expect(a2.latest()!.state.board).toEqual(lastCommitted.board);
    expect(s2.latest()!.state.board).toEqual(lastCommitted.board);
    // Their own seats, not each other's and not new ones.
    expect(second.rooms.get('KEEP01')!.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    // Each sees only their own hand, because a restored room is projected
    // like any other.
    expect(a2.latest()!.state.players.find((p) => p.id === sam.id)!.hand).toEqual([]);

    // And play continues.
    await s2.send({ type: 'placeTile', coord: 'A1' });
    expect(s2.rejections).toEqual([]);

    a2.close(); s2.close();
    await second.close();
  });

  it('tells a client the room is gone rather than seating them as a stranger', async () => {
    const first = await boot();
    const room = first.rooms.fromState('LOST01', ['Alex', 'Sam'], fixture());
    const [alex] = room.players;
    await first.close();

    // A server that never restored — the Render free-tier case, where the
    // filesystem resets and there is nothing on disk to read back.
    const second = await boot();
    expect(await second.rooms.restore()).toBe(0);

    const socket = connect(`http://localhost:${second.port}`, { transports: ['websocket'] });
    const rejections: RejectedMessage[] = [];
    socket.on(SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));
    await new Promise<void>((r) => socket.on('connect', () => r()));

    socket.emit(CLIENT_EVENTS.joinRoom, {
      roomId: 'LOST01', name: 'Alex', playerId: alex.id, token: alex.token,
    });
    await settleSocket(socket);

    // The silent failure this guards: seating them as a *new* player in a
    // *new* room, which would look like it worked and be a different game.
    expect(rejections.map((r) => r.code)).toEqual(['noSuchRoom']);
    expect(second.rooms.get('LOST01')).toBeUndefined();

    socket.disconnect();
    await second.close();
  });
});
```

Note the second test's first server is closed **without** a commit, so nothing is ever written for `LOST01` — `fromState` seats a room but only `persist` writes one, and `persist` runs on commit.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project node server/recovery.test.ts`
Expected: FAIL before Tasks 1-4 land. After them, expected PASS — so run the breaks in Step 3 before believing it.

- [ ] **Step 3: Break it, and watch it fail**

1. In `restore`, skip seating entirely (`return 0` immediately). Expected: **"comes back with the roster" fails** on the restore count and then on the reconnect.
2. In `persist`, write `state: room.draft()` instead of `room.committed()`. Expected: the restore test **still passes** here, because the test's last action is a commit and the two are equal at that instant — report this rather than bending the test. Then extend the first test with a trailing uncommitted placement before the restart and assert the restored board equals the *committed* one; re-run the break, which must now fail.
3. In `rooms.join`, drop the token check. Expected: the second test still passes (the room is absent, so `join` returns null before any token is examined) — a break that cannot succeed against this test. The token check is covered by `server/rooms.test.ts`'s existing "refuses a rejoin presenting the wrong token".

- [ ] **Step 4: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add server/recovery.test.ts
git commit -m "test(server): a game survives the process that was running it"
```

---

### Task 7: Presence, in the game

The roster has carried `connected` since Phase 3a and it reaches no screen but the lobby (`src/game/online/RoomLobby.tsx:35`). In game, a player dropping is invisible and the turn simply stops.

**Files:**
- Modify: `src/game/panel/PlayersStrip.tsx`
- Modify: `src/game/online/TurnToast.tsx`
- Modify: `src/game/GameScreen.tsx:50-57`, `:191-219`
- Modify: `src/pages/RoomPage.tsx:27-43`
- Modify: `src/game/panel/PlayersStrip.test.tsx`, `src/pages/RoomPage.test.tsx`

**Interfaces:**
- Produces:
  - `PlayersStripPlayer` gains `connected?: boolean` (default true)
  - `TurnToastProps` gains `disconnected?: boolean`
  - `GameScreenProps` gains `presence?: Record<string, boolean>`

The reason goes to `TurnToast` rather than the panel because Phase 5 deliberately removed the panel's grey "Waiting for Alex" line and moved whose-turn-it-is to the toast (`src/game/screen/useTurnPanel.tsx:141-157`). The toast is that line's successor.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/panel/PlayersStrip.test.tsx`:

```ts
describe('presence', () => {
  it('marks a seat whose player is not connected', () => {
    render(
      <PlayersStrip
        players={[
          { id: 'p1', emoji: '🦊', name: 'Alex', cash: 6000, active: true },
          { id: 'p2', emoji: '🐸', name: 'Sam', cash: 6000, connected: false },
        ]}
      />,
    );

    const sam = document.querySelector('[data-seat="p2"]')!;
    expect(sam.querySelector('[data-presence="away"]')).not.toBeNull();
    // Scoped to the seat, not the document: an away marker rendered on the
    // wrong seat would otherwise pass.
    const alex = document.querySelector('[data-seat="p1"]')!;
    expect(alex.querySelector('[data-presence="away"]')).toBeNull();
  });

  it('leaves every seat unmarked when presence is not passed at all', () => {
    // Pass-and-play passes no presence: everyone is at the same device by
    // definition, and an away dot there would be a lie.
    render(
      <PlayersStrip
        players={[
          { id: 'p1', emoji: '🦊', name: 'Alex', cash: 6000, active: true },
          { id: 'p2', emoji: '🐸', name: 'Sam', cash: 6000 },
        ]}
      />,
    );

    expect(document.querySelectorAll('[data-presence="away"]')).toHaveLength(0);
  });
});
```

Append to `src/pages/RoomPage.test.tsx`:

```ts
describe('a player who has dropped', () => {
  it('is named in the toast when the game is waiting on them', () => {
    const f = fakeConnection();
    renderRoom(f.connection);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    // Alex is up, and Alex has dropped. Without this the panel shows a turn
    // that never advances and nothing on screen says why.
    f.sendRoster({
      roomId: 'ABC123',
      lifecycle: 'playing',
      players: [
        { id: 'p1', name: 'Alex', isHost: true, connected: false },
        { id: 'p2', name: 'Sam', isHost: false, connected: true },
      ],
    });

    expect(screen.getByTestId('turn-toast')).toHaveTextContent(/disconnected/i);
  });

  it('says nothing about disconnection while everyone is present', () => {
    const f = seated('Sam', false);
    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    expect(screen.getByTestId('turn-toast')).not.toHaveTextContent(/disconnected/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project app src/game/panel/PlayersStrip.test.tsx src/pages/RoomPage.test.tsx`
Expected: FAIL — no `[data-presence="away"]`, and the toast has no "disconnected".

- [ ] **Step 3: The seat dot**

In `src/game/panel/PlayersStrip.tsx`, add the field:

```ts
export interface PlayersStripPlayer {
  id: string;
  emoji: string;
  name: string;
  cash: number;
  active?: boolean;
  /**
   * Omitted means present. Pass-and-play passes nothing — everyone is at the
   * same device, and an away dot there would be a lie about a person sitting
   * in the room.
   */
  connected?: boolean;
}
```

and render it inside the seat, immediately after the emoji span:

```tsx
          <span className="flex-none text-base leading-none">{p.emoji || '•'}</span>
          {p.connected === false && (
            // A dot, not a word: the strip is one clipped row and a seat that
            // grew by a label would push the seat that matters off the end.
            <span
              data-presence="away"
              aria-label={`${p.name} is disconnected`}
              className="h-1.5 w-1.5 flex-none rounded-full bg-gray-400"
            />
          )}
```

- [ ] **Step 4: The toast**

In `src/game/online/TurnToast.tsx`, add the prop:

```ts
export interface TurnToastProps {
  /** The player being waited on. */
  name: string;
  emoji?: string;
  /** True when that player is the one at this device. */
  mine?: boolean;
  /**
   * True when the player being waited on has no live socket.
   *
   * The unexplained stall is the actual complaint: the game waits
   * indefinitely by design (no turn timeouts), so the only thing missing is
   * saying why nothing is happening.
   */
  disconnected?: boolean;
}
```

and the copy — the standing "someone else is up" form is the only one that can carry it, since your own turn arriving while you are disconnected is not a state that reaches a screen:

```tsx
export function TurnToast({ name, emoji, mine = false, disconnected = false }: TurnToastProps) {
```

```tsx
      <span>{mine ? 'Your turn' : `${name} is up${disconnected ? ' — disconnected' : ''}`}</span>
```

- [ ] **Step 5: Thread presence through the screen**

In `src/game/GameScreen.tsx`, add the prop:

```ts
  /**
   * Who has a live socket, by player id. Omitted — pass-and-play — means
   * everyone: there is no transport for anyone to be missing from.
   */
  presence?: Record<string, boolean>;
```

```ts
export function GameScreen({ session, viewerId, connected = true, presence, onNewGame, onExit }: GameScreenProps) {
```

Pass it to the strip (currently `src/game/GameScreen.tsx:192-200`):

```tsx
          <PlayersStrip
            players={state.players.map((p) => ({
              id: p.id,
              emoji: p.emoji,
              name: p.name,
              cash: p.cash,
              active: turnKnown && p.id === actorId,
              connected: presence?.[p.id] ?? true,
            }))}
          />
```

and to the toast (currently `:212-219`):

```tsx
      {viewerId !== undefined && actor && (
        <TurnToast
          key={`${actorId}-${view.segmentStart}`}
          name={actor.name}
          emoji={actor.emoji}
          mine={actorId === viewerId}
          disconnected={actorId !== null && presence?.[actorId] === false}
        />
      )}
```

- [ ] **Step 6: Derive it from the roster**

In `src/pages/RoomPage.tsx`, above the `phase === 'playing'` branch:

```tsx
  // The roster is the only thing that knows who is connected — the engine
  // state has no idea a socket exists. Undefined until one arrives, which
  // reads as "everyone present" rather than "everyone away".
  const presence = room.roster
    ? Object.fromEntries(room.roster.players.map((p) => [p.id, p.connected]))
    : undefined;
```

and pass `presence={presence}` to `GameScreen`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --project app`
Expected: PASS.

- [ ] **Step 8: Break it, and watch it fail**

1. In `GameScreen`, hardcode `connected: true` on the strip's players. Expected: **"marks a seat whose player is not connected" still passes** (it tests `PlayersStrip` directly) but no `RoomPage` test catches it — so add the missing coverage: assert `document.querySelector('[data-seat="p1"] [data-presence="away"]')` is non-null in the first `RoomPage` presence test. Re-run the break; it must now fail.
2. In `TurnToast`, ignore `disconnected` in the copy. Expected: **"is named in the toast" fails**.
3. In `RoomPage`, pass `presence={undefined}` always. Expected: both new `RoomPage` tests fail.

- [ ] **Step 9: Run all five gates and commit**

`verify:layout` matters here — the strip gained an element inside a clipped row.

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/panel/PlayersStrip.tsx src/game/panel/PlayersStrip.test.tsx src/game/online/TurnToast.tsx src/game/GameScreen.tsx src/pages/RoomPage.tsx src/pages/RoomPage.test.tsx
git commit -m "feat(online): a dropped player is on the seat and in the toast"
```

---

### Task 8: The cold start

Render's free tier sleeps after 15 minutes and takes ~30s to wake (`DEPLOYMENT.md:185`). Every player currently sees the same amber `Connecting…` pill they would see for a two-second blip.

**Files:**
- Modify: `src/game/online/ConnectionStrip.tsx`
- Modify: `src/net/connection.ts:38`
- Create: `src/game/online/ConnectionStrip.test.tsx`

**Interfaces:**
- Produces: no prop changes — `ConnectionStrip({ status })` is unchanged. The timer is internal.

- [ ] **Step 1: Write the failing test**

Create `src/game/online/ConnectionStrip.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStrip } from './ConnectionStrip';

afterEach(() => { vi.useRealTimers(); });

describe('the connection strip', () => {
  it('says nothing at all while the socket is open', () => {
    render(<ConnectionStrip status="open" />);
    expect(screen.queryByTestId('connection-strip')).toBeNull();
  });

  it('starts with the short form', () => {
    render(<ConnectionStrip status="connecting" />);
    expect(screen.getByTestId('connection-strip')).toHaveTextContent('Connecting…');
  });

  it('explains the wait once it has gone on a while', () => {
    vi.useFakeTimers();
    render(<ConnectionStrip status="connecting" />);

    act(() => { vi.advanceTimersByTime(3000); });

    // A 30-second wake and a two-second blip look identical for the first
    // few seconds. After that they should not.
    expect(screen.getByTestId('connection-strip'))
      .toHaveTextContent('Waking the server — this can take up to 30 seconds');
  });

  it('drops back to the short form when the connection recovers and drops again', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ConnectionStrip status="connecting" />);
    act(() => { vi.advanceTimersByTime(3000); });

    rerender(<ConnectionStrip status="open" />);
    rerender(<ConnectionStrip status="closed" />);

    // A fresh drop is a fresh two-second blip until proven otherwise —
    // latching "waking" from a previous outage would claim a 30-second wait
    // that is not happening.
    expect(screen.getByTestId('connection-strip')).toHaveTextContent('Disconnected — reconnecting…');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project app src/game/online/ConnectionStrip.test.tsx`
Expected: FAIL on the third and fourth tests — the copy never changes.

- [ ] **Step 3: Add the timer**

Rewrite `src/game/online/ConnectionStrip.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../../net/connection';

/**
 * How long a connect may take before it is worth explaining.
 *
 * Short enough that nobody watches an unexplained pill for long; long enough
 * that an ordinary blip — a laptop lid, a tunnel — never triggers the longer
 * copy and makes a two-second reconnect sound like a thirty-second one.
 */
const EXPLAIN_AFTER_MS = 3000;

/**
 * Connection state, and only inside the room.
 *
 * Its predecessor was fixed across every route, which put a bar over the top
 * of pass-and-play and the catalog — neither of which has a server to be
 * disconnected from. A centred pill rather than a full-width bar, because the
 * board underneath it is the thing the player is trying to read.
 *
 * The long form names the deployment's own worst case: the free Render tier
 * sleeps after fifteen minutes and takes about thirty seconds to wake
 * (DEPLOYMENT.md). A player who knows that waits; a player watching
 * "Connecting…" for half a minute assumes it is broken.
 */
export function ConnectionStrip({ status }: { status: ConnectionStatus }) {
  const [slow, setSlow] = useState(false);

  // Declared above the early return, because hooks cannot run conditionally.
  useEffect(() => {
    if (status === 'open') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), EXPLAIN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'open') return null;

  return (
    <div
      data-testid="connection-strip"
      role="status"
      className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
    >
      {slow
        ? 'Waking the server — this can take up to 30 seconds'
        : status === 'connecting' ? 'Connecting…' : 'Disconnected — reconnecting…'}
    </div>
  );
}
```

- [ ] **Step 4: State the socket options**

In `src/net/connection.ts`, replace line 38:

```ts
  const socket: Socket = io(SERVER_URL, {
    transports: ['websocket'],
    // Stated rather than inherited, because this deployment's worst case is
    // longer than the default connect timeout. A sleeping Render free
    // instance takes ~30s to wake, so the *first* attempt times out at 20s
    // and it is the retry that actually lands. Relying on a default for the
    // behaviour that makes cold starts work at all is how it silently stops
    // working when a dependency changes its mind.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project app src/game/online/ src/pages/RoomPage.test.tsx`
Expected: PASS. `RoomPage.test.tsx:289` asserts the strip's disconnected copy and must be unaffected — it never advances timers.

- [ ] **Step 6: Break it, and watch it fail**

1. Drop the `setSlow(false)` from the `open` branch. Expected: **"drops back to the short form" fails** — the strip stays on the waking copy through a recovery.
2. Change `EXPLAIN_AFTER_MS` to 30000. Expected: **"explains the wait" fails** at 3000ms, proving the test actually drives the timer rather than the copy always being present.

- [ ] **Step 7: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/online/ConnectionStrip.tsx src/game/online/ConnectionStrip.test.tsx src/net/connection.ts
git commit -m "feat(online): a slow connect says it is waking the server"
```

---

### Task 9: The room that is gone

`noSuchRoom` exists on the wire since Task 4; nothing on the client does anything with it. Today a wiped room lands on the join form with `cannot join ABC123` in red.

**Files:**
- Create: `src/game/online/RoomGone.tsx`
- Modify: `src/net/useRoom.ts:7`, `:99-116`, `:179-187`
- Modify: `src/pages/RoomPage.tsx`
- Modify: `src/pages/RoomPage.test.tsx`

**Interfaces:**
- Produces:
  - `type RoomPhase = 'connecting' | 'joining' | 'needName' | 'lobby' | 'playing' | 'error' | 'gone'`
  - `function RoomGone({ roomId, onExit }: { roomId?: string; onExit(): void })`

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/RoomPage.test.tsx`:

```tsx
describe('a room that is gone', () => {
  it('reads as an ending, with a way back, rather than a join form', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    f.sendRejected({ code: 'noSuchRoom', message: 'Room ABC123 is no longer available' });

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
    // Not a join form: there is nothing to join, and offering one invites a
    // player to keep trying a room the server will keep refusing.
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
  });

  it('sends a refused seat to the join form instead, because that one is fixable', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p9', token: 'stale', name: 'Ghost' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    f.sendRejected({ code: 'seatRefused', message: 'That seat in ABC123 is no longer yours' });

    // The room is still there. The identity was stale and has been cleared,
    // so joining fresh is exactly the remedy.
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --project app src/pages/RoomPage.test.tsx`
Expected: FAIL — the first lands on the join form.

- [ ] **Step 3: Add the phase**

In `src/net/useRoom.ts`, widen the type:

```ts
export type RoomPhase = 'connecting' | 'joining' | 'needName' | 'lobby' | 'playing' | 'error' | 'gone';
```

Add the state, beside the others:

```ts
  const [gone, setGone] = useState(false);
```

Set it in the rejection handler, alongside the existing identity clearing:

```ts
    const offRejected = connection.transport.onRejected((msg) => {
      // Once a game is running, a rejection belongs to the session, which
      // shows it in the panel. Surfacing it here as well would replace the
      // board with an error screen over a refused click.
      if (sessionRef.current === null) setMessage(msg.message);

      // Nothing this player can do reaches this room: it has ended, or the
      // server restarted onto a disk that no longer holds it. A join form
      // would invite them to keep trying something that cannot work.
      if (msg.code === 'noSuchRoom') setGone(true);

      // A rejection that arrives before we have ever been seated can only be
      // the join itself being refused — and if it was attempted with a
      // stored identity, that identity is what got refused: a stale token,
      // or a seat the server has forgotten. Nothing downstream can turn it
      // into a working seat, so keeping it only guarantees every future visit
      // repeats the same doomed rejoin. Clearing it is what lets a later load
      // offer a clean join instead.
      if (!seatedRef.current && identityRef.current !== null) {
        clearIdentity(roomId);
        identityRef.current = null;
      }
    });
```

Rank it in the phase expression:

```ts
  // Order matters. A roster means we are seated, and a refusal that arrives
  // afterwards ("only the host may begin") is a note to show *in* the lobby —
  // ranking `message` above `roster` would throw a seated player back to a
  // join form over a button they were not allowed to press.
  //
  // `gone` outranks all of those and yields only to `playing`: a room that
  // does not exist cannot be joined, listed or corrected, so no earlier
  // screen has anything useful to offer. It sits below `playing` because a
  // running session means we are in a room that plainly does exist.
  const phase: RoomPhase =
    session !== null ? 'playing'
      : gone ? 'gone'
        : roster !== null ? 'lobby'
          : message !== null ? 'error'
            : status !== 'open' ? 'connecting'
              : joining ? 'joining'
                : 'needName';
```

- [ ] **Step 4: Write the screen**

Create `src/game/online/RoomGone.tsx`:

```tsx
/**
 * A room the server does not have.
 *
 * Two ways to get here and one screen for both, because the player cannot act
 * on the difference: the game finished and its room was cleared, or the server
 * restarted onto a filesystem that no longer held it (the free Render tier
 * resets its disk — see DEPLOYMENT.md, and the Phase 4 design's ruling that
 * this is an accepted limit rather than a thing to engineer around).
 *
 * Deliberately not a join form. The stored identity has already been cleared
 * by the time this renders, and offering a name field over a room that cannot
 * be joined invites a player to keep trying something that will keep failing.
 */
export interface RoomGoneProps {
  roomId?: string;
  onExit(): void;
}

export function RoomGone({ roomId, onExit }: RoomGoneProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div
        data-testid="room-gone"
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-lg font-bold text-gray-900">This room is no longer available</h1>
        <p className="mt-2 text-sm text-gray-600">
          {roomId ? `${roomId} has ended, ` : 'It has ended, '}
          or the server restarted and did not keep it.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-5 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to the lobby
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Render it**

In `src/pages/RoomPage.tsx`, add the import and a branch above the `needName`/`error` one:

```tsx
  if (room.phase === 'gone') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomGone roomId={roomId} onExit={leave} />
      </>
    );
  }
```

`leave` already calls `closeConnection()` and navigates to `/`, which is exactly what is wanted here.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project app`
Expected: PASS.

- [ ] **Step 7: Break it, and watch it fail**

1. Set `gone` on any rejection rather than on `noSuchRoom`. Expected: **"sends a refused seat to the join form" fails**, and so does the existing "a refusal that arrives after being seated shows inside the lobby" test — which is the more valuable catch of the two.
2. Rank `gone` below `message` in the phase expression. Expected: **"reads as an ending" fails** — `message` is set by the same handler, so the error phase wins and the join form renders.

- [ ] **Step 8: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/online/RoomGone.tsx src/net/useRoom.ts src/pages/RoomPage.tsx src/pages/RoomPage.test.tsx
git commit -m "feat(online): a room that is gone is an ending, not an error"
```

---

### Task 10: Test 1 — a refresh mid-turn

The last of the three recovery tests, and the one where this harness approximates rather than reproduces. Say so in the file.

**Files:**
- Modify: `src/pages/RoomPage.test.tsx`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

Append to `src/pages/RoomPage.test.tsx`:

```tsx
/**
 * A refresh, as closely as jsdom can hold one.
 *
 * **This is a remount, not a reload**, and the difference is worth stating
 * where it can be read next to the assertions rather than in a document
 * nobody opens. A real `F5` destroys the module-level socket `getConnection()`
 * holds, every listener on it, and all React state, then rebuilds from
 * whatever `localStorage` kept. What this reproduces: the component tree is
 * destroyed and rebuilt, the connection is a *new* object with no listeners
 * carried over, and `localStorage` is the only thing that survives — which is
 * what makes the second mount a rejoin rather than a first visit. What it
 * cannot reproduce: a real browser's page teardown, module re-evaluation, or
 * anything about socket.io's own reconnect. The prod by-hand pass covers
 * those; this covers the identity-and-resume path underneath them.
 *
 * `closeConnection()` is deliberately not called: it acts on the module
 * singleton, which `RoomPage`'s injected `connect` bypasses entirely. A fresh
 * fake is the honest stand-in.
 */
describe('a refresh mid-turn', () => {
  it('rejoins the same seat and comes back to the open segment, not the start of the turn', () => {
    const first = fakeConnection();
    const { unmount } = renderRoom(first.connection);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    first.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const opening = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
      currentPlayerIndex: 1,
    });
    first.sendState({ state: opening, reason: 'commit', segmentStart: opening.nextStepId });
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'hand');

    // Sam plays their tile. The segment is open and uncommitted: the server
    // holds a draft, and nothing has been broadcast.
    fireEvent.click(onBoard('A1'));
    expect(onBoard('A1')).not.toHaveAttribute('data-tile-state', 'hand');

    // The refresh.
    unmount();
    const second = fakeConnection();
    renderRoom(second.connection);

    // The stored identity is what makes this the same seat rather than a new
    // one — the token, not the name.
    expect(second.joins).toEqual([
      { roomId: 'ABC123', name: 'Sam', playerId: 'p2', token: 'tok' },
    ]);

    second.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    // What the server sends a reconnecting actor: its own open draft, under
    // `resume`. Built here the way the server builds it — from the state
    // after the placement, with the draft's own segmentStart.
    const drafted = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: [] },
      ],
      loners: ['E5', 'A1'],
      bag: ['I11', 'I12'],
      currentPlayerIndex: 1,
      stage: 'buy',
    });
    second.sendState({
      state: drafted,
      reason: 'resume',
      segmentStart: opening.nextStepId,
      previousSegmentStart: 0,
    });

    // Back on the board, still played. A `commit` carrying the pre-placement
    // state — which is what a rejoin got before Phase 4 — would put A1 back
    // in the hand while the server still believed it was played.
    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(onBoard('A1')).not.toHaveAttribute('data-tile-state', 'hand');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project app src/pages/RoomPage.test.tsx`
Expected: PASS if Tasks 3 and 4 landed. **Do not trust that** — go straight to the breaks.

- [ ] **Step 3: Break it, and watch it fail**

1. In the test, change the second mount to reuse `first.connection`. Expected: the rejoin assertion fails — no new `joinRoom` is sent, because the fake's status never left `open` and the join latch belongs to a hook instance that a shared connection makes indistinguishable. This is the break that proves the fresh-fake decision is load-bearing rather than stylistic. Revert.
2. In `src/net/identity.ts`, make `saveIdentity` a no-op. Expected: the rejoin assertion fails — the second mount joins as a stranger with no `playerId`/`token`.
3. Send the resume as `reason: 'commit'` with the `opening` state instead of `drafted`. Expected: the final assertion fails — A1 is back in the hand. This is the original bug, reproduced from the client's side.

- [ ] **Step 4: Run all five gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/pages/RoomPage.test.tsx
git commit -m "test(online): a refresh mid-turn comes back to the open segment"
```

---

### Task 11: The by-hand pass on prod, and the carry-forward

Code-complete is not phase-complete. The roadmap asks for the same three recoveries by hand against the deployed pair.

**Files:**
- Create: `docs/superpowers/specs/2026-08-06-phase-4-by-hand-notes.md`
- Create: `docs/superpowers/specs/2026-08-06-phase-4-carry-forward.md`
- Modify: `CLAUDE.md` (the "Current focus" section)
- Modify: `docs/superpowers/specs/2026-07-31-react-app-revamp-roadmap-design.md` (the Phase 4 section)

- [ ] **Step 1: Deploy**

```bash
npm run build:server   # then deploy per DEPLOYMENT.md
npm run build && npm run deploy
```

- [ ] **Step 2: Run the three by hand, in two browser profiles, writing down what happens**

1. **Refresh mid-turn.** Place a tile, do not end the turn, press `F5`. Expect: the same seat, the tile still placed, the step stack showing the previous turn.
2. **Dropped socket mid-turn.** Mid-turn, kill the network (DevTools offline, or wifi off) for ~10s, then restore. Expect: the amber pill, then the waking copy after 3s, then the board back with the open segment intact; the other browser shows the away dot on that seat and "— disconnected" in the toast while it is out.
3. **Server restart.** Redeploy, or let the instance sleep 15 minutes and wake it. Expect: **the gone-room screen**, by design — Render free's filesystem is ephemeral. That is a pass, not a failure. Also record the cold-start wake time to check the "30 seconds" copy is not a lie.

- [ ] **Step 3: Write the notes**

Create `docs/superpowers/specs/2026-08-06-phase-4-by-hand-notes.md` following the shape of `2026-08-04-phase-2b-by-hand-notes.md`: what was driven, what was found, what was not touched. Findings become their own tasks — do not fix them inline in this task.

- [ ] **Step 4: Write the carry-forward**

Create `docs/superpowers/specs/2026-08-06-phase-4-carry-forward.md` following `2026-08-05-phase-3b-carry-forward.md`'s shape. It must state, plainly:

- Before/after test counts, measured (before: **622 in 60 files**), not cited.
- Any hollow gates found, and how — the project's running total is **eight**; this phase adds a socket-drop test, a restart test and a remount test, all of the exact shape that produced four of those eight.
- Any break named in this plan that turned out **not** to be able to succeed. Three are flagged in advance (Task 1 step 6 break 2, Task 6 step 3 breaks 2 and 3). Report what actually happened rather than what this plan predicted.
- What Phase 4 does **not** close: the two-browser full game to final scoring still owed from 3b; durability on Render free; the Playwright harness; spectator mode and the phone view.
- The still-carried items from 3b: `LiqQueue` has no design review; seat names truncate at 768px; `Board.tsx` renders read-only cells as buttons; the catalog builds every fixture at module load; the per-player turn-order draw is unbuilt.

- [ ] **Step 5: Update the roadmap and CLAUDE.md**

In the roadmap's Phase 4 section, replace the "Coverage is part of the phase" paragraph with what actually shipped, linking the design and this plan. In `CLAUDE.md`, move "Current focus" off Phase 4 and onto whatever comes next, and update the `server/` and `src/net/` rows in the layout table to mention the store and `resume`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-phase-4-by-hand-notes.md docs/superpowers/specs/2026-08-06-phase-4-carry-forward.md docs/superpowers/specs/2026-07-31-react-app-revamp-roadmap-design.md CLAUDE.md
git commit -m "docs: Phase 4 is built — a game survives the things that used to end it"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the store and its record shape, restore-at-boot, the lifecycle fix, eviction and atomic ordered writes → Tasks 1-2. `resume`, `previousSegmentStart` → Task 3. `noSuchRoom`/`seatRefused` → Task 4. The three recovery tests and the privacy oracle → Tasks 5, 6, 10. Presence → Task 7. Cold start → Task 8. The gone-room screen → Task 9. The prod passes and carry-forward → Task 11. The design's "zeroth" item needs no task: the warning it inherited is already fixed, verified before this plan was written.

**Type consistency.** `SavedRoom`, `RoomStore`, `SAVE_VERSION`, `createFileStore`, `createNullStore` (Task 1) are used under those exact names in Tasks 2 and 6. `MAX_AGE_MS` is exported from `server/rooms.ts` and imported by name in its own test. `restore(now?)` is declared and called with and without the argument. `StateReason`'s `'resume'` and `StateMessage.previousSegmentStart` (Task 3) are used in Tasks 5, 6 and 10. `presence`, `connected`, `disconnected` (Task 7) are consistent across `GameScreen`, `PlayersStrip`, `TurnToast` and `RoomPage`.

**One thing this plan does on purpose that looks like a gap.** Tasks 5, 6 and 10 write tests for behaviour that already exists by the time they run, so their "run it to verify it fails" step cannot fail honestly. Each replaces that step with a break-first instruction instead, because the alternative — reordering so every e2e test precedes its feature — would mean three tasks that cannot compile. Where a break was predicted not to be able to succeed, the plan says so up front and asks for the real result.
