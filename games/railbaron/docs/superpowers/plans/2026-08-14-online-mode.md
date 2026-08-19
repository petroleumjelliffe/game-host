# Online Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two machines on the internet play one Rail Baron game, through the approved
split-flap lobby boards, against a server that is authoritative over the event log.

**Architecture:** The log is the wire. The acting client rolls locally behind the existing
roll→announce→commit gates and sends the resulting `GameEvent`; the server validates it
(structure, seat identity, turn legality via `replay`), appends, persists, and broadcasts the
full log. Every client's state is `replay(log)`. `vendor/lobby/server/` supplies rooms,
seating, tokens, rejoin and presence; the `SeatSpace` is the six colours, so a lobby seat id
*is* a game seat id.

**Tech Stack:** Express 5, Socket.io 4, tsx (server runtime), socket.io-client (already a
dep), vitest 4 two-project split, Render starter + disk.

**Spec:** `docs/superpowers/specs/2026-08-14-online-mode-design.md`. Read it first.

## Global Constraints

- `RB_PROTOCOL_VERSION = 1` and `RB_SAVE_VERSION = 1`, both reported by `/health` from day one.
- Server accepts an `append` only if **all three** hold: `isGameEvent(event)`; the sending
  socket's seat equals `event.seat` (exception: `orderRolled` may come from any seated
  socket); replaying `log + [event]` is legal for whose turn it is.
- `undo` is granted only to the seat whose action would be popped — the last event's seat.
- The server seeds `joined` + `started` itself at Begin; clients can never append those.
- Full-log broadcast on every change. No incremental sync, no optimistic apply.
- **Each consumer includes only the lobby parts it uses** — this plan adds
  `vendor/lobby/server` to tsconfig/vitest; it was deliberately absent before.
- **Two vitest projects, and the split is load-bearing**: `node` for `engine/`, `session/`,
  `server/`, `src/state/` (pure) and `vendor/lobby/{protocol,server}`; `app` (jsdom) for the
  rest of `src/` and `vendor/lobby/client`. No root-level `setupFiles` — vitest 4 merges them
  into both projects and silently disarms the node boundary.
- No `as any`. `noUncheckedIndexedAccess` is on — index reads are `T | undefined`.
- **Prove every new test can fail** by breaking the code it guards and reading the real
  failure, never by reading the test.
- Commits follow the repo's style: `feat:`/`fix:`/`test:`/`chore:` + a body that says why.

## File structure

| File | Responsibility |
|---|---|
| `session/protocol.ts` (new) | Game wire: versions, event names, message shapes. Node-safe, no React. Imports lobby protocol types only. |
| `src/state/legal.ts` (new) | `appendLegality(log, event, sender)` — the pure decision the server enforces. Lives beside `game.ts` because it is made of `replay` + `turns.ts` helpers. |
| `server/store.ts` (new) | File-backed `SavedRoom` records; validates the log with `isGameEvent` on load. |
| `server/rooms.ts` (new) | `GameRoom` (players + log + lifecycle), registry over `createLobbyRegistry`, Begin seeding, persistence hook. |
| `server/index.ts` (new) | Boot: express, socket.io, lobby handlers + game handlers, `/health`, restore-before-listen. |
| `server/handlers.ts` (new) | The two game socket handlers (`append`, `undo`) and the log broadcast. |
| `session/nodeEnvironment.test.ts` (new) | Asserts the node project really runs under node. |
| `server/gameSocket.test.ts` (new) | Wire tests over real sockets: accept/reject table, seeding, undo. |
| `server/goldenSocket.test.ts` (new) | Keystone: every golden game's story driven through `append`. |
| `server/recovery.test.ts` (new) | Kill the server, reboot on the same store, resume. |
| `src/net/transport.ts` (new) | Game half of the socket: `append`, `undo`, `onLog`. |
| `src/net/useRoom.ts` (new) | Phase machine: lobby phases + `playing`, ranking `stale`/`gone` above it. |
| `src/net/useOnlineGame.ts` (new) | `useGame`'s surface over a server log. |
| `src/GameShell.tsx` (new, extracted from `App.tsx`) | The board-driving glue (announce holds, screens record, row dispatch), shared by pass-and-play and online. |
| `src/board/screens/online.ts` (new) | Boards 1d/1e/1f as `ScreenDef`s from `lobbyView`. |
| `src/App.tsx` (modify) | Routes: `/online`, `/room/:code`; delegates to `GameShell`. |
| `basePath.ts` / `src/config.ts` | `SERVER_URL` from `VITE_SERVER_URL`, defaulting to `http://<hostname>:3001`. |
| `package.json`, `tsconfig.json`, `vite.config.ts` | Deps, scripts, includes, the node project. |

Execution order is the task order: the server stack bottom-up (1–6), then the client
(7–9), then the boards and routes (10), then deploy + docs + the by-hand gate (11).

---

### Task 1: Game protocol and append legality

**Files:**
- Create: `session/protocol.ts`
- Create: `src/state/legal.ts`
- Test: `src/state/legal.test.ts`

**Interfaces:**
- Consumes: `GameEvent`, `isGameEvent`, `SEATS`, `SeatId` from `src/state/events.ts`;
  `replay` from `src/state/game.ts`; `nextHomeSeat`, `homesDone`, `needsDestination` from
  `src/state/turns.ts`; `nodeForCity` from `engine`.
- Produces: `RB_PROTOCOL_VERSION`, `RB_SAVE_VERSION`, `GAME_CLIENT_EVENTS`,
  `GAME_SERVER_EVENTS`, `AppendMessage`, `LogMessage`, `GameRejectionCode`;
  `appendLegality(log, event, sender): GameRejection | null` and
  `undoLegality(log, sender): GameRejection | null` (null = allowed).

- [ ] **Step 1: Write `session/protocol.ts`** (types compile-time; its test is every server test)

```ts
// session/protocol.ts
// The game half of the wire, beside the lobby's. Node-safe: imported by the
// server and the client, so no React and no DOM.
import type { GameEvent } from '../src/state/events';

/** The wire. Bump on any change to message shapes or append semantics. */
export const RB_PROTOCOL_VERSION = 1;
/** The stored-room record format. Independent of the wire. */
export const RB_SAVE_VERSION = 1;

export interface AppendMessage { event: GameEvent }
/** Full log, every time. Self-healing: a client that missed anything is fixed
 *  by the next one. */
export interface LogMessage { roomId: string; events: GameEvent[] }

export const GAME_CLIENT_EVENTS = {
  append: 'append',
  undo: 'undo',
} as const;

export const GAME_SERVER_EVENTS = {
  log: 'log',
} as const;

/**
 * Sent on the lobby's `rejected` channel, which passes unrecognised codes
 * through to the game side — that is its documented contract.
 */
export type GameRejectionCode =
  | 'malformedEvent'   // failed isGameEvent
  | 'notYourSeat'      // event.seat is not the sender's seat
  | 'notNow'           // structurally fine, illegal at this point in the log
  | 'notYourUndo'      // the popped action belongs to someone else
  | 'nothingToUndo';

export interface GameRejection { code: GameRejectionCode; message: string }
```

- [ ] **Step 2: Write the failing legality tests**

`src/state/legal.test.ts`. Build logs with a helper so every case reads as a story. The
seeded prefix mirrors what the server writes at Begin (Task 3).

```ts
import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import { appendLegality, undoLegality } from './legal';

/** The log the server seeds at Begin for a red/blue game, plus extras. */
const seeded = (...rest: GameEvent[]): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'BEN' },
  { type: 'started' },
  ...rest,
];

// Real cities: Chicago is in NC. Region mismatches are isGameEvent's job and
// arrive pre-checked; legality only decides *when*, so fixtures use honest data.
const redHome: GameEvent =
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };
const blueHome: GameEvent =
  { type: 'arrived', seat: 'blue', city: 57, region: 'SE', payout: null };

describe('appendLegality', () => {
  it('rejects joined, renamed and started from a client — the server seeds those', () => {
    for (const event of [
      { type: 'joined', seat: 'red', name: 'X' },
      { type: 'renamed', seat: 'red', name: 'X' },
      { type: 'started' },
    ] as GameEvent[]) {
      expect(appendLegality(seeded(), event, 'red')?.code).toBe('notNow');
    }
  });

  it('lets the next home seat roll its home, and only that seat', () => {
    expect(appendLegality(seeded(), redHome, 'red')).toBeNull();
    expect(appendLegality(seeded(), blueHome, 'blue')?.code).toBe('notNow'); // red is first
  });

  it('rejects an event whose seat is not the sender', () => {
    expect(appendLegality(seeded(), redHome, 'blue')?.code).toBe('notYourSeat');
  });

  it('lets any seated sender append orderRolled once homes are done — and only once', () => {
    const order: GameEvent = { type: 'orderRolled', seat: 'blue', first: 'blue' };
    expect(appendLegality(seeded(redHome), order, 'red')?.code).toBe('notNow'); // homes not done
    expect(appendLegality(seeded(redHome, blueHome), order, 'red')).toBeNull(); // any seat
    expect(appendLegality(seeded(redHome, blueHome, order), order, 'blue')?.code).toBe('notNow');
  });

  it('rejects orderRolled from an unseated sender', () => {
    const order: GameEvent = { type: 'orderRolled', seat: 'red', first: 'red' };
    expect(appendLegality(seeded(redHome, blueHome), order, 'green')?.code)
      .toBe('notYourSeat');
  });

  it('rejects a turn roll out of turn, a second roll, and one before a destination', () => {
    const playing = seeded(redHome, blueHome,
      { type: 'orderRolled', seat: 'red', first: 'red' });
    const roll: GameEvent =
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null };
    expect(appendLegality(playing, roll, 'blue')?.code).toBe('notNow'); // red's turn
    // ... red's equivalents accepted / rejected per the table in Step 4
  });

  it('rejects bonusRolled when none is owed', () => {
    const playing = seeded(redHome, blueHome,
      { type: 'orderRolled', seat: 'red', first: 'red' });
    expect(appendLegality(playing,
      { type: 'bonusRolled', seat: 'red', face: 5 }, 'red')?.code).toBe('notNow');
  });
});

describe('undoLegality', () => {
  it('grants undo only to the seat whose action would be popped', () => {
    const log = seeded(redHome, blueHome,
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'turnRolled', seat: 'red', white: [2, 3], bonus: null });
    expect(undoLegality(log, 'red')).toBeNull();
    expect(undoLegality(log, 'blue')?.code).toBe('notYourUndo');
  });

  it('refuses to undo into the seeded prefix', () => {
    expect(undoLegality(seeded(), 'red')?.code).toBe('nothingToUndo');
  });
});
```

Fixture note: `city: 20` must be Chicago and `city: 57` a real SE city — **verify both against
`engine/cities.ts` before writing the file** (`cityById(20)`), and use whatever ids are actually
correct; the numbers above are from memory and the test must not encode a wrong one.
Destination-roll cases (`regionRequested`, mid-game `arrived`, `moved`) follow the same
pattern; write one test per row of the Step 4 table.

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/state/legal.test.ts`
  Expected: FAIL, `appendLegality` not exported.

- [ ] **Step 4: Implement `src/state/legal.ts`**

The decision table, then the code. "actor" means: during `homes`, `nextHomeSeat(state)`;
during `playing`, `state.turn`.

| Event | Legal when |
|---|---|
| `joined`, `renamed`, `started` | never from a client (server seeds them) |
| `arrived` | sender is actor, and (`awaiting` set — a ballot resolution) or `needsDestination` |
| `regionRequested` | sender is actor, `awaiting` null, `needsDestination` |
| `orderRolled` | any *seated* sender; phase `homes`; `homesDone`; no `orderRolled` yet |
| `turnRolled` | phase `playing`; sender is `state.turn`; `state.rolled === null`; not `needsDestination` |
| `bonusRolled` | phase `playing`; sender is `state.turn`; `state.bonusOwed`; not `needsDestination` |
| `moved` | phase `playing`; sender is `state.turn`; `state.rolled !== null`; `state.leg < 2` |

```ts
// src/state/legal.ts
// What the server may append. Pure — a function of the log and the sender —
// so the whole authority is testable without a socket. Built from the same
// helpers useGame's own guards read (nextHomeSeat, needsDestination, replay),
// so the client's "may I?" and the server's "you may not" cannot drift.
import { nodeForCity } from '../../engine';
import type { GameRejection } from '../../session/protocol';
import { SEATS, type GameEvent, type SeatId } from './events';
import { replay } from './game';
import { homesDone, needsDestination, nextHomeSeat } from './turns';

const not = (code: GameRejection['code'], message: string): GameRejection =>
  ({ code, message });

export function appendLegality(
  log: readonly GameEvent[], event: GameEvent, sender: SeatId,
): GameRejection | null {
  const state = replay([...log]);

  if (event.type === 'joined' || event.type === 'renamed' || event.type === 'started') {
    return not('notNow', 'seating and starting are the server\'s to write');
  }

  if (event.type === 'orderRolled') {
    // The one exception to seat-matching: the roll for first player is a
    // shared ceremony (owner ruling), so any *seated* sender may report it.
    if (state.seats[sender].name === null) return not('notYourSeat', 'take a seat first');
    if (state.phase !== 'homes' || !homesDone(state)) {
      return not('notNow', 'every baron needs a home before the order is rolled');
    }
    return null; // replay ignores a duplicate, but we never store one:
                 // phase is 'playing' after the first, caught above.
  }

  if (event.seat !== sender) return not('notYourSeat', `that seat is ${event.seat}'s`);

  const actor = state.phase === 'homes' ? nextHomeSeat(state) : state.turn;
  if (actor !== sender) return not('notNow', 'not your turn');
  const seat = state.seats[sender];

  switch (event.type) {
    case 'arrived':
      return seat.awaiting !== null || needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination is owed');
    case 'regionRequested':
      return seat.awaiting === null && needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no destination roll is owed');
    case 'turnRolled':
      if (state.phase !== 'playing') return not('notNow', 'the game has not begun');
      if (state.rolled !== null) return not('notNow', 'this turn already has its roll');
      if (needsDestination(seat, nodeForCity)) return not('notNow', 'roll a destination first');
      return null;
    case 'bonusRolled':
      return state.phase === 'playing' && state.bonusOwed
        && !needsDestination(seat, nodeForCity)
        ? null : not('notNow', 'no Bonus Roll is owed');
    case 'moved':
      if (state.phase !== 'playing' || state.rolled === null) {
        return not('notNow', 'no roll to move on');
      }
      return state.leg < 2 ? null : not('notNow', 'this turn has walked both its legs');
  }
}

/**
 * Undo is granted to the seat whose action `undo()` would pop — the last
 * event's seat (owner ruling: a bystander must not yank the actor's turn).
 * The seeded prefix (joined/started) is not undoable: it was never a player
 * action.
 */
export function undoLegality(
  log: readonly GameEvent[], sender: SeatId,
): GameRejection | null {
  const last = log[log.length - 1];
  if (last === undefined || last.type === 'started' || last.type === 'joined') {
    return not('nothingToUndo', 'nothing has happened yet');
  }
  if (last.type === 'renamed' || last.seat !== sender) {
    return not('notYourUndo', 'only the player who acted may take it back');
  }
  return null;
}
```

Note `SEATS` may end up unused in the final body — drop the import if so; typecheck will say.

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/state/legal.test.ts` → PASS.
- [ ] **Step 6: Prove it can fail** — invert the `actor !== sender` check, watch the
  out-of-turn tests go red with the real message, revert.
- [ ] **Step 7: `npm run typecheck` and full `npx vitest run`** — both clean.
- [ ] **Step 8: Commit** — `feat(net): the game wire and the append legality table`

---

### Task 2: The room store

**Files:**
- Create: `server/store.ts`
- Test: `server/store.test.ts` (node project — Task 3 wires the config; until then run it
  with `npx vitest run server/store.test.ts --environment node` if the project split is not
  in place yet)

**Interfaces:**
- Consumes: `GameEvent`, `isGameEvent` from `src/state/events`; `RB_SAVE_VERSION`,
  `RB_PROTOCOL_VERSION` from `session/protocol`; `SeatHolder` from
  `vendor/lobby/server/rooms.js`.
- Produces: `SavedRoom { roomId; version; protocolVersion; savedAt; players: SeatHolder[];
  log: GameEvent[] }`, `RoomStore { save; loadAll; remove }`,
  `createFileStore(dir: string): RoomStore`.

Acquire's `server/store.ts` is the reference (same repo family, read it if unsure), with two
deliberate differences: the record's payload is a `log`, not a `GameState`, and **the log is
validated with `isGameEvent` on load** — cheap here, and it turns a stale-shape record into a
skipped room with a logged reason instead of a room that replays to an empty board.

- [ ] **Step 1: Write the failing tests**

```ts
// server/store.test.ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RB_PROTOCOL_VERSION, RB_SAVE_VERSION } from '../session/protocol';
import type { GameEvent } from '../src/state/events';
import { createFileStore, type SavedRoom } from './store';

const record = (roomId: string, log: GameEvent[]): SavedRoom => ({
  roomId, version: RB_SAVE_VERSION, protocolVersion: RB_PROTOCOL_VERSION,
  savedAt: Date.now(),
  players: [{ id: 'red', name: 'ADA', token: 't1', isHost: true, connected: false }],
  log,
});

describe('the file store', () => {
  it('saves a room and loads it back, log intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-store-'));
    const store = createFileStore(dir);
    const log: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' }, { type: 'started' }];
    await store.save(record('ABC234', log));
    const { records, skipped } = await store.loadAll();
    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]!.log).toEqual(log);
  });

  it('skips a record whose log fails isGameEvent, and names the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-store-'));
    const store = createFileStore(dir);
    await store.save(record('ABC234', [{ type: 'started' }]));
    // Corrupt on disk, as a shape change would: a seat that never existed.
    const path = join(dir, 'ABC234.json');
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.log = [{ type: 'joined', seat: 'octarine', name: 'X' }];
    await writeFile(path, JSON.stringify(raw));
    const { records, skipped } = await store.loadAll();
    expect(records).toEqual([]);
    expect(skipped).toEqual(['ABC234.json']);
  });

  it('skips unparseable files and wrong versions without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-store-'));
    const store = createFileStore(dir);
    await writeFile(join(dir, 'BAD.json'), 'not json');
    await store.save({ ...record('OLD234', [{ type: 'started' }]), version: 0 });
    const { records, skipped } = await store.loadAll();
    expect(records).toEqual([]);
    expect(skipped.sort()).toEqual(['BAD.json', 'OLD234.json']);
  });

  it('remove() makes a room unloadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-store-'));
    const store = createFileStore(dir);
    await store.save(record('ABC234', [{ type: 'started' }]));
    await store.remove('ABC234');
    expect((await store.loadAll()).records).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.
- [ ] **Step 3: Implement `server/store.ts`**

```ts
// server/store.ts
// Where a room lives between processes. Storage mechanics only.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RB_SAVE_VERSION } from '../session/protocol.js';
import { isGameEvent, type GameEvent } from '../src/state/events.js';
import type { SeatHolder } from '../vendor/lobby/server/rooms.js';

export interface SavedRoom {
  roomId: string;
  version: number;         // RB_SAVE_VERSION — the record format
  protocolVersion: number; // the wire that wrote it; policy is the registry's
  savedAt: number;         // epoch ms
  players: SeatHolder[];   // token included — that is what makes rejoin work
  log: GameEvent[];
}

export interface LoadResult { records: SavedRoom[]; skipped: string[] }

export interface RoomStore {
  save(record: SavedRoom): Promise<void>;
  loadAll(): Promise<LoadResult>;
  remove(roomId: string): Promise<void>;
}

function isSeatHolder(value: unknown): value is SeatHolder {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.token === 'string' && typeof p.isHost === 'boolean'
    && typeof p.connected === 'boolean';
}

/**
 * Field-level, *and* event-level for the log — deeper than Acquire's, on
 * purpose: `isGameEvent` exists and is cheap, and a log is data that outlives
 * whatever wrote it. A record whose log fails is a skip, never a boot crash
 * and never a room that replays to an empty board.
 */
function isSavedRoom(value: unknown): value is SavedRoom {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.roomId === 'string'
    && r.version === RB_SAVE_VERSION
    && typeof r.protocolVersion === 'number'
    && typeof r.savedAt === 'number'
    && Array.isArray(r.players) && r.players.every(isSeatHolder)
    && Array.isArray(r.log) && r.log.every(isGameEvent);
}

export function createFileStore(dir: string): RoomStore {
  const file = (roomId: string) => join(dir, `${roomId}.json`);

  return {
    /** Best-effort and atomic: tmp + rename, so a crash mid-write cannot
     *  leave a half-record where a whole one was. Never rejects. */
    async save(record) {
      try {
        await mkdir(dir, { recursive: true });
        const tmp = file(record.roomId) + '.tmp';
        await writeFile(tmp, JSON.stringify(record));
        await rename(tmp, file(record.roomId));
      } catch {
        // A failed save loses the record, not the live room.
      }
    },

    async loadAll() {
      const records: SavedRoom[] = [];
      const skipped: string[] = [];
      let names: string[] = [];
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
      } catch {
        return { records, skipped }; // no dir yet: nothing saved, nothing wrong
      }
      for (const name of names) {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'));
          if (isSavedRoom(parsed)) records.push(parsed);
          else skipped.push(name);
        } catch {
          skipped.push(name);
        }
      }
      return { records, skipped };
    },

    async remove(roomId) {
      try { await unlink(file(roomId)); } catch { /* already gone is gone */ }
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**, then prove the corrupt-log test can fail: change
  `r.log.every(isGameEvent)` to `true`, watch it load the octarine seat, revert.
- [ ] **Step 5: `npm run typecheck`; commit** — `feat(server): file store that validates its logs`

---

### Task 3: Server config — deps, projects, boundary

The config every remaining server task needs, done once, with the tripwires that keep it
honest.

**Files:**
- Modify: `package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `session/nodeEnvironment.test.ts`, `src/test/` stays as is

**Interfaces:**
- Produces: `npm run dev:server`, `npm run dev:all`, `npm run build:server` (guard only),
  `npm run start:server`; vitest `node` project covering `engine/**`, `session/**`,
  `server/**`, `src/state/**/*.test.ts`, `vendor/lobby/protocol/**`, `vendor/lobby/server/**`.

- [ ] **Step 1: Install deps**

```bash
npm install express cors socket.io tsx
npm install -D @types/express @types/cors concurrently
```

- [ ] **Step 2: Scripts** (in `package.json`)

```json
"dev:server": "tsx watch server/index.ts",
"dev:all": "concurrently \"npm run dev\" \"npm run dev:server\"",
"start:server": "tsx server/index.ts",
"build:server": "test -f vendor/lobby/protocol/protocol.ts || { echo 'ERROR: vendor/lobby is empty. The server imports it at runtime and tsx compiles nothing at build time — without this check the build goes green and the process dies at boot. Run: git submodule update --init --recursive'; exit 1; }"
```

- [ ] **Step 3: tsconfig** — `include` gains `"session"`, `"server"`,
  `"vendor/lobby/server"`. (`src/state` is already inside `"src"`.)

- [ ] **Step 4: vitest projects** — in `vite.config.ts`, replace the `engine` project with a
  `node` project and move the pure state tests into it:

```ts
{
  extends: true,
  test: {
    name: 'node', environment: 'node',
    include: [
      'engine/**/*.test.ts', 'session/**/*.test.ts', 'server/**/*.test.ts',
      'src/state/**/*.test.ts',
      'vendor/lobby/protocol/**/*.test.ts', 'vendor/lobby/server/**/*.test.ts',
    ],
  }
},
```

and **exclude** `src/state/**/*.test.ts` from the `app` project's include (it stays
`src/**/*.test.{ts,tsx}` — add `exclude: ['src/state/**/*.test.ts']`) so no test runs twice.
`src/state/useGame.test.tsx` is a `.tsx` hook test and must stay in `app`: the node glob
above is `.ts` only, which handles that without an explicit exception — but **verify the
count**: run `npx vitest run` before and after and account for every moved file. Same total,
different projects.

- [ ] **Step 5: The boundary test**

```ts
// session/nodeEnvironment.test.ts
// engine/, session/, server/ and src/state run inside the server process in
// production. A stray `window.` or `localStorage` there is a production crash
// that a single jsdom suite could never catch — this asserts the node project
// really is node. If this fails, someone merged the projects or added a
// root-level setupFiles (vitest 4 merges those into every project).
import { expect, it } from 'vitest';

it('the node project runs without a DOM', () => {
  expect(typeof globalThis.window).toBe('undefined');
  expect(typeof globalThis.localStorage).toBe('undefined');
});
```

- [ ] **Step 6: Verify by parts** — `npx vitest run --project node` and
  `npx vitest run --project app`; the two totals must sum to the pre-change total plus one
  (this file). `npm run typecheck` clean. Prove the boundary test can fail: temporarily move
  its include into the app project, watch it fail on `window` being defined, revert.
- [ ] **Step 7: Commit** — `chore(server): node/app project split, server deps and scripts`

---

### Task 4: Rooms, seeding, and the game handlers over real sockets

The server exists at the end of this task: create a room over a socket, begin, play by
appending, be refused correctly, undo.

**Files:**
- Create: `server/rooms.ts`, `server/handlers.ts`, `server/index.ts`
- Test: `server/gameSocket.test.ts`

**Interfaces:**
- Consumes: `createLobbyRegistry`, `SeatSpace`, `SeatHolder`, `LobbyRoomLike` from
  `vendor/lobby/server/rooms.js`; `createLobbyHandlers`, `LobbyWiring` from
  `vendor/lobby/server/handlers.js`; `appendLegality`, `undoLegality`; `RoomStore`,
  `SavedRoom`; `undo` from `src/state/game`; protocol constants.
- Produces: `GameRoom { id; players: SeatHolder[]; log: GameEvent[]; lifecycle() }`;
  `createRooms(store): { registry; seedOnBegin(room); persist(room); restore(): Promise<number> }`;
  `attachGameHandlers(io, registry, wiring, persist)`; `startServer({ port, gamesDir }): Promise<{ io; http; close() }>`
  (returned handle is what recovery tests kill and reboot).

- [ ] **Step 1: `server/rooms.ts`**

```ts
// server/rooms.ts
// The game's room: the lobby's seats plus the one thing the game owns — the
// log. lifecycle() is derived from it, the same derivation the app's own
// phase uses: a `started` event is what moves a room out of the lobby.
import {
  createLobbyRegistry, type LobbyRegistry, type SeatHolder, type SeatSpace,
} from '../vendor/lobby/server/rooms.js';
import { RB_PROTOCOL_VERSION, RB_SAVE_VERSION } from '../session/protocol.js';
import { SEATS, type GameEvent } from '../src/state/events.js';
import type { Lifecycle } from '../vendor/lobby/protocol/protocol.js';
import type { RoomStore, SavedRoom } from './store.js';

export interface GameRoom {
  id: string;
  players: SeatHolder[];
  log: GameEvent[];
  lifecycle(): Lifecycle;
}

/** The lobby's seat ids ARE the game's colours. Capacity is SEATS.length. */
const SEAT_SPACE: SeatSpace = {
  ids: SEATS,
  defaultName: (index) => `BARON ${index + 1}`,
};

function makeRoom(id: string, players: SeatHolder[], log: GameEvent[] = []): GameRoom {
  return {
    id, players, log,
    // 'over' is unreachable: the game has no end rule yet. When one lands,
    // it will be derived from the log here, exactly like 'playing'.
    lifecycle() {
      return this.log.some((e) => e.type === 'started') ? 'playing' : 'lobby';
    },
  };
}

export interface Rooms {
  registry: LobbyRegistry<GameRoom>;
  /** Begin: seed joined-per-seat + started, in roster order. Idempotent. */
  seedOnBegin(room: GameRoom): void;
  persist(room: GameRoom): Promise<void>;
  /** Boot-only, before listen. Returns how many rooms came back. */
  restore(): Promise<number>;
  remove(roomId: string): Promise<void>;
}

export function createRooms(store: RoomStore): Rooms {
  const registry = createLobbyRegistry<GameRoom>((id, players) => makeRoom(id, players), SEAT_SPACE);

  function persist(room: GameRoom): Promise<void> {
    const record: SavedRoom = {
      roomId: room.id, version: RB_SAVE_VERSION, protocolVersion: RB_PROTOCOL_VERSION,
      savedAt: Date.now(), players: room.players, log: room.log,
    };
    return store.save(record);
  }

  return {
    registry,
    seedOnBegin(room) {
      if (room.log.length > 0) return; // begun already — the lobby re-checks, this pins it
      for (const p of room.players) {
        // The seat id is a SeatId by construction: SEAT_SPACE.ids is SEATS.
        // Narrow honestly rather than assert.
        const seat = SEATS.find((s) => s === p.id);
        if (seat === undefined) continue;
        room.log.push({ type: 'joined', seat, name: p.name });
      }
      room.log.push({ type: 'started' });
    },
    persist,
    async restore() {
      const { records, skipped } = await store.loadAll();
      for (const name of skipped) {
        console.warn(`✗ Skipped unreadable or stale save: ${name}`);
      }
      for (const r of records) {
        const room = makeRoom(r.roomId, r.players.map((p) => ({ ...p, connected: false })), r.log);
        registry.adopt(room);
      }
      return records.length;
    },
    remove: (roomId) => store.remove(roomId),
  };
}
```

- [ ] **Step 2: `server/handlers.ts`**

```ts
// server/handlers.ts
// The two game handlers. Everything they decide is decided by legal.ts —
// these translate a socket message into (log, event, sender) and back.
import type { Server as SocketServer, Socket } from 'socket.io';
import type { LobbyWiring } from '../vendor/lobby/server/handlers.js';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, type AppendMessage, type LogMessage,
} from '../session/protocol.js';
import { isGameEvent, SEATS, type SeatId } from '../src/state/events.js';
import { appendLegality, undoLegality } from '../src/state/legal.js';
import { undo } from '../src/state/game.js';
import type { GameRoom, Rooms } from './rooms.js';

const asSeat = (id: string): SeatId | undefined => SEATS.find((s) => s === id);

export function attachGameHandlers(
  io: SocketServer, rooms: Rooms, wiring: LobbyWiring<GameRoom>,
): (socket: Socket) => void {
  function broadcastLog(room: GameRoom): void {
    const msg: LogMessage = { roomId: room.id, events: room.log };
    io.to(room.id).emit(GAME_SERVER_EVENTS.log, msg);
  }

  return (socket: Socket) => {
    const refused = (code: string, message: string) =>
      socket.emit('rejected', { code, message });

    /** The bound room and seat, or null after refusing. The client never
     *  says which room — the binding does. */
    function situate(): { room: GameRoom; seat: SeatId } | null {
      const bound = wiring.seatOf(socket.id);
      const room = bound && rooms.registry.get(bound.roomId);
      if (!bound || !room) { refused('notConnected', 'join a room first'); return null; }
      const seat = asSeat(bound.playerId);
      if (seat === undefined) { refused('notConnected', 'no seat bound'); return null; }
      return { room, seat };
    }

    socket.on(GAME_CLIENT_EVENTS.append, (msg: AppendMessage) => {
      const here = situate();
      if (here === null) return;
      // The payload is untrusted text. A malformed event must be a refusal,
      // never a throw — a synchronous throw in a listener kills the process.
      if (!isGameEvent(msg?.event)) {
        refused('malformedEvent', 'that is not a game event');
        return;
      }
      const illegal = appendLegality(here.room.log, msg.event, here.seat);
      if (illegal !== null) { refused(illegal.code, illegal.message); return; }
      here.room.log.push(msg.event);
      void rooms.persist(here.room);
      broadcastLog(here.room);
      // `started` never comes from a client, but `orderRolled` flips nothing
      // in the roster; lifecycle changes only at Begin, which broadcasts
      // its own roster. No roster send needed here.
    });

    socket.on(GAME_CLIENT_EVENTS.undo, () => {
      const here = situate();
      if (here === null) return;
      const illegal = undoLegality(here.room.log, here.seat);
      if (illegal !== null) { refused(illegal.code, illegal.message); return; }
      here.room.log = undo(here.room.log);
      void rooms.persist(here.room);
      broadcastLog(here.room);
    });
  };
}
```

- [ ] **Step 3: `server/index.ts`**

```ts
// server/index.ts
import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { RB_PROTOCOL_VERSION, RB_SAVE_VERSION, GAME_SERVER_EVENTS } from '../session/protocol.js';
import { createLobbyHandlers } from '../vendor/lobby/server/handlers.js';
import { createFileStore } from './store.js';
import { createRooms, type GameRoom } from './rooms.js';
import { attachGameHandlers } from './handlers.js';

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export async function startServer(
  opts: { port: number; gamesDir: string },
): Promise<RunningServer> {
  const app = express();
  app.use(cors());
  app.get('/health', (_req, res) => {
    res.json({ ok: true, protocolVersion: RB_PROTOCOL_VERSION, saveVersion: RB_SAVE_VERSION });
  });

  const http = createServer(app);
  const io = new SocketServer(http, { cors: { origin: '*' } });
  const rooms = createRooms(createFileStore(opts.gamesDir));

  const wiring = createLobbyHandlers<GameRoom>(io, rooms.registry, {
    protocolVersion: RB_PROTOCOL_VERSION,
    onBegin(room) {
      rooms.seedOnBegin(room);
      void rooms.persist(room);
      wiring.broadcastRoster(room); // lifecycle just became 'playing'
      io.to(room.id).emit(GAME_SERVER_EVENTS.log, { roomId: room.id, events: room.log });
    },
    onSeated(room, _playerId) {
      // A joiner or rejoiner needs the game so far, and only this socket
      // does — the roster already went to everyone.
      if (room.log.length > 0) {
        socketToRoomLatest(room);
      }
    },
  });

  // onSeated has no socket parameter — send the log to the room; the full-log
  // broadcast is idempotent and cheap at this scale, and every client treats
  // it as truth. (If this proves noisy, wiring.socketsFor(room.id, playerId)
  // narrows it to the one player.)
  function socketToRoomLatest(room: GameRoom): void {
    io.to(room.id).emit(GAME_SERVER_EVENTS.log, { roomId: room.id, events: room.log });
  }

  const attachGame = attachGameHandlers(io, rooms, wiring);
  io.on('connection', (socket) => { wiring.attach(socket); attachGame(socket); });

  // Boot-only, before listen: every restored seat starts disconnected, and
  // no socket can race the restore because none can connect yet.
  const restored = await rooms.restore();
  if (restored > 0) console.log(`✓ Restored ${restored} room(s)`);

  await new Promise<void>((resolve) => http.listen(opts.port, resolve));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  console.log(`Server listening on ${port}`);

  return {
    port,
    close: () => new Promise((resolve) => { io.close(() => resolve()); }),
  };
}

// Run directly (tsx server/index.ts); imported by tests without starting.
const isMain = process.argv[1]?.endsWith('server/index.ts')
  || process.argv[1]?.endsWith('server/index.js');
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  const gamesDir = process.env.GAMES_DIR ?? 'server/games';
  void startServer({ port, gamesDir });
}
```

Add `server/games/` to `.gitignore`.

- [ ] **Step 4: Write the wire tests** — `server/gameSocket.test.ts`, over real
  `socket.io-client` sockets against `startServer({ port: 0, gamesDir: mkdtemp(...) })`.
  Use a small helper to connect, create, join and begin (the lobby protocol shapes are in
  `vendor/lobby/protocol/protocol.ts`). Cover, as separate `it`s:
  - create + join + begin seeds `joined`×2 + `started`, in roster order, and both sockets
    receive the same `log`;
  - an accepted `append` (red's home `arrived`) broadcasts to **both** sockets;
  - out-of-turn append → `rejected` with `notNow`, log unchanged on the other socket;
  - a seat-mismatch append (blue sends red's event) → `notYourSeat`;
  - a malformed append (`{event: {type: 'joined'...}}` and `{event: 42}`) → refusal, server
    still alive (follow with a legal append that succeeds — that is the liveness assertion);
  - `orderRolled` accepted from the non-host seat once homes are done; a second one →
    `notNow`;
  - `undo` from the wrong seat → `notYourUndo`; from the right seat, the whole last action
    is truncated (append `turnRolled` + `moved`, undo, expect the log back to before
    `turnRolled` — the existing `undo()` semantics, observed over the wire);
  - a rejoin (`joinRoom` with `playerId` + `token`) receives the current log.
- [ ] **Step 5: Run to verify failure, implement fixes, run to pass** —
  `npx vitest run server/gameSocket.test.ts`. Timebox socket plumbing: if a test hangs,
  check the two classic causes first (server not awaited; socket not closed in `afterEach`).
- [ ] **Step 6: Prove one rejection test can fail** — comment out the `appendLegality` call,
  watch out-of-turn go green-to-red correctly (the test expects rejection; with the guard
  gone it must FAIL). Revert.
- [ ] **Step 7: Full suite + typecheck; commit** —
  `feat(server): rooms, Begin seeding, and the append/undo authority`

---

### Task 5: Golden games over sockets

**Files:**
- Test: `server/goldenSocket.test.ts`

**Interfaces:**
- Consumes: `GAMES`, `runGoldenGame` from `engine/golden`; `cityAt`, `cityById` from
  `engine`; `startServer`; the log-building recipe from `src/state/replay.golden.test.ts`
  (read it before writing this — the story→event translation is copied from there, and the
  comment explains why the faces must be the game's real ones).

The keystone. Every golden game's story becomes a sequence of `append`s from a single
client, and the final broadcast log must replay to the same state the runner finished in.
This proves the legality table accepts every legal game — the rejection tests in Task 4
prove it refuses illegal ones; both directions are needed before the authority is trusted.

- [ ] **Step 1: Write the test.** Shape, per golden game:
  1. `startServer`, create a room (seats `red`), begin (seeds `joined` + `started`).
  2. Append red's home: `{ type: 'arrived', seat: 'red', city: home, region: cityById(home).region, payout: null }`
     where `home = cityAt(game.setup.at)` (skip-with-throw if the fixture starts on a dot,
     exactly as `replay.golden.test.ts` does).
  3. Append `{ type: 'orderRolled', seat: 'red', first: 'red' }`.
  4. Walk `runGoldenGame(game).story`, translating `roll` → `turnRolled` (bonus: null),
     `bonus` → `bonusRolled`, `leg` → `moved`, appending each and awaiting its `log` echo.
     **Every append must be accepted** — assert no `rejected` arrives (subscribe and fail
     the test on any).
  5. `replay` the final broadcast log; assert `seats.red.at === finished.at` and the
     sections maps agree (reuse the `sections` comparator from `replay.golden.test.ts`).
  Only Freight games can assert the open-turn shape (same caveat as the replay test); pawn
  and sections are asserted for all.
- [ ] **Step 2: Run.** Every game must pass. A `notNow` on a mid-story bonus event means the
  legality table and the runner disagree about entitlement — that is a real finding, stop
  and investigate rather than loosening the table.
- [ ] **Step 3: Prove it can fail** — flip `bonusOwed` in `appendLegality`'s `bonusRolled`
  arm, expect the bonus-taking games to go red on a rejection, revert.
- [ ] **Step 4: Commit** — `test(server): every golden game plays through the wire`

---

### Task 6: Recovery — kill the server, keep the game

**Files:**
- Test: `server/recovery.test.ts`

**Interfaces:**
- Consumes: `startServer`, lobby protocol join shapes, `GAME_SERVER_EVENTS.log`.

- [ ] **Step 1: Write the test.**
  1. `startServer` on a `mkdtemp` dir; create, join (two sockets), begin; append red's home.
  2. Capture `{roomId, playerId, token}` for both seats from their `joined` messages.
  3. `close()` the server. Start a **new** `startServer` on the **same** dir (port 0 —
     a new port proves nothing was reused).
  4. Rejoin both sockets with their stored ids + tokens. Each must receive a `log` equal to
     the pre-kill log, and an append that was legal before (blue's home) must be accepted
     after.
  5. A second test: write garbage into one room file between boots, assert the boot restores
     the intact room, skips the bad one, and a fresh room can still be created (one bad
     record costs one room, never the boot).
- [ ] **Step 2: Run to pass; prove it can fail** by removing the `restore()` call from
  `startServer` — rejoin must now get `noSuchRoom` and the test goes red. Revert.
- [ ] **Step 3: Commit** — `test(server): a reboot keeps its rooms and their tokens`

---

### Task 7: Client transport and the room phase machine

**Files:**
- Create: `src/net/transport.ts`, `src/net/useRoom.ts`, `src/config.ts`
- Test: `src/net/useRoom.test.tsx` (app project)

**Interfaces:**
- Consumes: `LobbyConnection`, `createLobbyConnection`, `createIdentityStore`,
  `useLobbyRoom`, `LobbyPhase` from `vendor/lobby/client/*`; `GAME_CLIENT_EVENTS`,
  `GAME_SERVER_EVENTS`, `LogMessage`, `AppendMessage`, `RB_PROTOCOL_VERSION`.
- Produces: `SERVER_URL: string`; `createGameTransport(connection): GameTransport`
  where `GameTransport = { append(event: GameEvent): void; undo(): void;
  onLog(handler: (msg: LogMessage) => void): () => void }`;
  `useRoom(roomId): RoomState` where `RoomState = { phase: 'connecting' | 'joining' |
  'lobby' | 'playing' | 'error' | 'gone' | 'stale'; lobby: LobbyRoomState;
  log: GameEvent[]; seat: SeatId | null; transport: GameTransport }`.

- [ ] **Step 1: `src/config.ts`**

```ts
/** The server this client speaks to. The hostname, not localhost, so a phone
 *  on the LAN reaches a dev server on this machine. */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `http://${window.location.hostname}:3001`;
```

- [ ] **Step 2: `src/net/transport.ts`**

```ts
import type { LobbyConnection } from '../../vendor/lobby/client/connection';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, type AppendMessage, type LogMessage,
} from '../../session/protocol';
import type { GameEvent } from '../state/events';

export interface GameTransport {
  append(event: GameEvent): void;
  undo(): void;
  onLog(handler: (msg: LogMessage) => void): () => void;
}

export function createGameTransport(connection: LobbyConnection): GameTransport {
  return {
    append(event) {
      const msg: AppendMessage = { event };
      connection.socket.emit(GAME_CLIENT_EVENTS.append, msg);
    },
    undo() { connection.socket.emit(GAME_CLIENT_EVENTS.undo); },
    onLog(handler) {
      connection.socket.on(GAME_SERVER_EVENTS.log, handler);
      return () => { connection.socket.off(GAME_SERVER_EVENTS.log, handler); };
    },
  };
}
```

- [ ] **Step 3: `src/net/useRoom.ts`** — composes `useLobbyRoom` with the log:

```ts
import { useEffect, useMemo, useState } from 'react';
import { createIdentityStore } from '../../vendor/lobby/client/identity';
import { createLobbyConnection } from '../../vendor/lobby/client/connection';
import { useLobbyRoom, type LobbyRoomState } from '../../vendor/lobby/client/useLobbyRoom';
import { RB_PROTOCOL_VERSION } from '../../session/protocol';
import { SEATS, type GameEvent, type SeatId } from '../state/events';
import { SERVER_URL } from '../config';
import { createGameTransport, type GameTransport } from './transport';

export type RoomPhase =
  | 'connecting' | 'joining' | 'lobby' | 'playing' | 'error' | 'gone' | 'stale';

export interface RoomState {
  phase: RoomPhase;
  lobby: LobbyRoomState;
  log: GameEvent[];
  /** Your colour, or null before you are seated. */
  seat: SeatId | null;
  transport: GameTransport;
}

const identity = createIdentityStore('railbaron');

export function useRoom(roomId: string): RoomState {
  // One connection per mount. StrictMode double-mounts in dev: the cleanup
  // closes the first socket before the second opens, which the lobby lift's
  // step 2 established is survivable — the rejoin binding resolves it.
  const connection = useMemo(
    () => createLobbyConnection({ serverUrl: SERVER_URL, protocolVersion: RB_PROTOCOL_VERSION }),
    [],
  );
  useEffect(() => () => { connection.close(); }, [connection]);

  const lobby = useLobbyRoom(roomId, connection, identity);
  const transport = useMemo(() => createGameTransport(connection), [connection]);

  const [log, setLog] = useState<GameEvent[]>([]);
  useEffect(() => transport.onLog((msg) => {
    if (msg.roomId === roomId) setLog(msg.events);
  }), [transport, roomId]);

  const seat = SEATS.find((s) => s === lobby.playerId) ?? null;

  // stale and gone outrank everything; a started log outranks the lobby.
  const phase: RoomPhase =
    lobby.phase === 'stale' || lobby.phase === 'gone' ? lobby.phase
      : log.some((e) => e.type === 'started') ? 'playing'
        : lobby.phase;

  return { phase, lobby, log, seat, transport };
}
```

- [ ] **Step 4: Test `useRoom`'s ranking** (app project, `renderHook` with a stubbed
  transport is not possible — the connection is internal — so test at the seam that is
  testable without a server: extract the phase-ranking into a pure function
  `rankPhase(lobbyPhase, logHasStarted)` exported from `useRoom.ts`, and table-test it:
  `stale` + started log → `stale`; `lobby` + started → `playing`; `gone` beats `playing`).
  The full hook is covered by the by-hand pass and the server-backed flow; a mocked-socket
  render test would restate the hook (the lobby repo's own reasoning for leaving
  `connection.ts` untested in isolation).
- [ ] **Step 5: Typecheck + suite; commit** — `feat(net): the game transport and the room phase machine`

---

### Task 8: `useOnlineGame`

**Files:**
- Create: `src/net/useOnlineGame.ts`
- Test: `src/net/useOnlineGame.test.tsx` (app project)

**Interfaces:**
- Consumes: `RoomState` (log + transport + seat), everything `useGame` consumes from
  `engine` and `src/state/*`.
- Produces: the exact surface `GameShell` (Task 9) needs:
  `{ state, roll, commitRoll, chooseRegion, rollDice, commitDice, rollBonus, commitBonus,
  commitMove, rollOrder, undoLast }` — `useGame`'s return minus `savedAt`, `rename`,
  `start`, `reset` (the lobby owns names and beginning; there is no online reset).

- [ ] **Step 1: Write the failing test.** The hook is pure over `(log, transport, seat)`
  props, so it tests without any socket:

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../state/events';
import { useOnlineGame } from './useOnlineGame';

const transport = () => ({ append: vi.fn(), undo: vi.fn(), onLog: () => () => {} });

const playing: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'BEN' },
  { type: 'started' },
  // homes + orderRolled — build with the same real-city fixtures as legal.test
];

describe('useOnlineGame', () => {
  it('derives state from the log it is handed', () => {
    const { result } = renderHook(() =>
      useOnlineGame(playing, transport(), 'red', () => 0.5));
    expect(result.current.state.phase).toBe('homes');
  });

  it('commitDice appends over the transport and appends nothing locally', () => {
    const t = transport();
    const { result } = renderHook(() => useOnlineGame(playing, t, 'red', () => 0.5));
    act(() => result.current.commitDice('red', { white: [3, 4], bonus: null }));
    expect(t.append).toHaveBeenCalledWith(
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null });
  });

  it('roll() refuses when it is not your seat acting', () => {
    const { result } = renderHook(() =>
      useOnlineGame(playing, transport(), 'blue', () => 0.5));
    // red is nextHomeSeat; blue holds this device — the gate is the seat.
    expect(result.current.roll('red')).toBeNull();
    expect(result.current.roll('blue')).toBeNull();
  });

  it('undoLast emits undo', () => {
    const t = transport();
    const { result } = renderHook(() => useOnlineGame(playing, t, 'red', () => 0.5));
    act(() => result.current.undoLast());
    expect(t.undo).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Copy `useGame`'s guard bodies, replacing `setEvents` with
  `transport.append` and adding one gate everywhere: **`mySeat`**. The signature:

```ts
export function useOnlineGame(
  log: readonly GameEvent[], transport: GameTransport,
  mySeat: SeatId | null, rng: Rng = Math.random,
) {
  const state = replay([...log]);
  // Every guard from useGame, plus: the seat acting must be mySeat. This
  // machine speaks for one baron; the server would refuse anyway (notYourSeat)
  // — the local gate exists so the board never *offers* an action the server
  // must refuse.
  const roll = useCallback((seat: SeatId): RollOutcome | null => {
    if (seat !== mySeat) return null;
    /* then exactly useGame's checks, reading `state` */
  }, [state, rng, mySeat]);
  const commitRoll = useCallback((seat: SeatId, outcome: RollOutcome) => {
    /* useGame's switch, but each branch calls transport.append(event) */
  }, [transport]);
  // rollOrder: any seated sender may — gate on mySeat being seated, not on
  // being the actor. Compute `first` with rng over the seated seats exactly
  // as useGame does, then transport.append({type:'orderRolled', ...}).
  // rollDice / commitDice / rollBonus / commitBonus / commitMove / chooseRegion:
  // same translation. undoLast: () => transport.undo().
}
```

The roll→announce→commit gates survive untouched: `roll` returns the outcome and appends
nothing; only `commit*` reaches the wire. Between a commit and its `log` echo the local
state simply has not advanced — the announcement animation covers it (spec: no optimistic
apply).

- [ ] **Step 4: Run to pass; prove the mySeat gate can fail** by deleting it in `roll` and
  watching the refuses-other-seats test go red. Revert.
- [ ] **Step 5: Typecheck + suite; commit** — `feat(net): useGame's surface over a server log`

---

### Task 9: Extract `GameShell` from `App.tsx`

The board-driving glue (announce holds, screens record, row dispatch, map route) currently
lives inline in `App`. Online needs the identical glue over a different hook, and two copies
of 150 lines is two places for the gates to drift. Extract, without changing pass-and-play
behaviour.

**Files:**
- Create: `src/GameShell.tsx`
- Modify: `src/App.tsx`
- Test: existing `src/App.test.tsx` must pass **unchanged** — that is the definition of the
  extraction being behaviour-preserving. Add `src/GameShell.test.tsx` only if a seam needs
  pinning that App.test does not reach.

**Interfaces:**
- Consumes: the Task 8 surface.
- Produces:

```ts
export interface GameShellProps {
  game: {  // useGame and useOnlineGame both satisfy this
    state: GameState;
    roll(seat: SeatId): RollOutcome | null;
    commitRoll(seat: SeatId, outcome: RollOutcome): void;
    chooseRegion(seat: SeatId, region: RegionId): void;
    rollDice(seat: SeatId): TurnRoll | null;
    commitDice(seat: SeatId, roll: TurnRoll): void;
    rollBonus(seat: SeatId): number | null;
    commitBonus(seat: SeatId, face: number): void;
    commitMove(seat: SeatId, path: readonly NodeId[], arrived: boolean): void;
    rollOrder(): void;
    undoLast(): void;
  };
  /** 'all' is pass-and-play: one device, every baron. A SeatId is online:
   *  this device speaks for one colour and rows for others render but do
   *  not act. The hooks gate too; this stops the *offer*. */
  actAs: SeatId | 'all';
  screen: 'game' | 'map';
  onNavigate(to: 'game' | 'map' | 'back'): void;
  onEdit?: (seat: SeatId, name: string | null) => void; // pass-and-play rename; absent online
}
```

- [ ] **Step 1: Move the glue.** Everything from `App`'s `rolling`/`rollingDice`/
  `rollingBonus`/`turns` state through `onRowAct` and the `Board`/`MapView` render moves
  into `GameShell`. The screens record shrinks to `homes`/`regionBallot`/`play`/`map` —
  the setup screens (`home`, `passAndPlay`, `saved`, `confirm`) stay in `App`, which still
  owns `/` and `/pass-and-play`. In `onRowAct`, gate `act`, `order` and `undo` actions:
  `if (props.actAs !== 'all' && row.action.seat !== props.actAs) return;` (for `order` and
  `undo`, gate on `actAs !== 'all' &&` the respective legality living server-side — offer
  `order` to any seated actor, `undo` always sends and lets a refusal toast).
- [ ] **Step 2: Rewire `App`** to render `<GameShell game={useGame-derived} actAs="all" …/>`
  for `/pass-and-play/game` and `/pass-and-play/map`.
- [ ] **Step 3: Run the full app suite** — `npx vitest run --project app`. Every existing
  test passes unchanged. If one needs editing, the extraction changed behaviour: stop and
  find out why.
- [ ] **Step 4: Typecheck; commit** — `refactor(app): extract GameShell so online and pass-and-play share the glue`

---

### Task 10: Boards 1d/1e/1f, routes, and the online game

**Files:**
- Create: `src/board/screens/online.ts`, `src/OnlineApp.tsx`
- Modify: `src/App.tsx` (routes), `src/board/types.ts` (ScreenIds + actions),
  `src/board/screens/home.ts` (the ONLINE row)
- Test: `src/board/screens/online.test.ts`, plus route tests in `src/App.test.tsx`

**Interfaces:**
- Consumes: `lobbyView`, `LobbyView`, `LobbySeat`, `LobbyLimits` from
  `vendor/lobby/client/view`; `RoomState` from Task 7; the Task 8/9 surfaces;
  `SEAT_COLORS` from `src/game/tokens`.
- Produces: `onlineLobby(view: LobbyView, myConnection: 'connecting' | 'live' | 'dropped'): ScreenDef`;
  `joinRoom(code: string): ScreenDef`; terminal `ScreenDef`s `roomGone()`, `staleClient()`,
  `roomRefused(message: string | null)`.

**Before building: check the approved boards.** The exact copy for 1d/1e/1f lives in the
*Rail Baron Game Board Design* project (Multiplayer Screens, boards 1d–1f), not in this
repo. The row *structure* below follows `lobbyView`'s inventory and the seven-row invariant
and will not change; labels and status text must be checked against the approved boards
before this task is called done — ask the owner to open them if they are not available.

- [ ] **Step 1: Extend the row vocabulary.** In `src/board/types.ts`:
  - `ScreenId` gains `'onlineLobby' | 'joinRoom'` (1e needs no ScreenId: creating seats you
    immediately — the Lobby Flow correction — so NEW ROOM is an action, not a screen).
  - `RowAction` gains `{ kind: 'createRoom' } | { kind: 'joinRoom' } |
    { kind: 'share' } | { kind: 'begin' } | { kind: 'leave' } |
    { kind: 'editCode' }` — and `FieldId` gains `'roomCode'` (the join screen's code entry
    reuses the board's existing row-edit affordance).
- [ ] **Step 2: `src/board/screens/online.ts`.** Structure (labels pending the design
  check):
  - **1d `onlineLobby(view, connection)`** — rows 0–5: one per `view.seats` entry. An
    occupied seat: `label` the colour, `text` the name, `chip` the seat colour from
    `SEAT_COLORS`, `right` `HOST` for the host, `status` `AWAY` when `!connected`,
    `action` `{kind:'edit', field:` seat's field `}` when `canRename`, else null, tone
    `normal`. An empty seat: `text: 'OPEN'`, tone `dim`, action null. Row 6: the begin/share
    row — when `view.canBegin`, `label: 'DEPART'`, action `{kind:'begin'}`, tone normal;
    otherwise `status` explains (`beginBlocked` → copy), tone dim, and the same row carries
    the room code in `right` with action `{kind:'share'}`. `sub` carries
    `view.code` and the connection state. (Seven rows, six seats, one row left — the code
    shares the action row; if the design boards resolve this differently, follow them.)
  - **1f `joinRoom(code)`** — an editable code row (`{kind:'editCode'}`), a GO row
    (`{kind:'joinRoom'}`, dim until the code is 6 chars), a BACK affordance via the board's
    existing back. Optional name row: `{kind:'edit', field:'playerName'}` — the approved 1f
    has it; wire it to `join(name)` so a refused join can retry named (the acquire#14 fix
    shape).
  - **Terminals** — `roomGone()`, `staleClient()`, `roomRefused(message)`: full ScreenDefs,
    one explanatory row each plus a row navigating home / reloading
    (`window.location.reload()` for stale).
- [ ] **Step 3: Screen tests.** Pure data in, rows out — same style as
  `src/board/screens/play.test.ts`: an occupied+empty roster renders six seat rows with
  `OPEN` dims; `canBegin` flips row 6's action from null to `{kind:'begin'}`;
  `beginBlocked: 'notEnoughPlayers'` puts the reason in the status; a disconnected seat
  shows `AWAY`. Run red first (screens not written), then green.
- [ ] **Step 4: `src/OnlineApp.tsx`** — mounted for `/online` and `/room/:code`:

```tsx
// /online        → joinRoom screen + a createRoom action (1e is an action)
// /room/:code    → useRoom(code): lobby phase → onlineLobby screen;
//                  playing → GameShell with actAs = seat; terminals → their screens.
```

  It owns: calling `connection.createRoom()` (via a `create()` exposed from `useRoom` or a
  one-shot connection for `/online` — follow `useLobbyRoom`'s pattern: create fires,
  `joined` lands, navigate to `/room/:roomId`), `begin` on the begin row, `share` via
  `navigator.clipboard.writeText(location.href)` with a board-status confirmation, `leave`
  via `lobby.leaveSeat()` + navigate home. Homes/ballot/play/map screens flow through
  `GameShell` exactly as pass-and-play, with `actAs={seat}` and no `onEdit`.
- [ ] **Step 5: Routes.** `App.tsx`: `ROUTES` gains `'/online'`; `/room/:code` cannot be a
  const-list member — use `matchPath('/room/:code', pathname)` from `react-router-dom`
  alongside `isKnown`, rendering `OnlineApp` for both. `home.ts` gains an ONLINE row
  navigating to `'onlineLobby'`… no — navigating to the `/online` route (add a
  `{kind:'navigate', to}` handling in `App` that maps the new ScreenIds to paths). Keep the
  one-Board rule: `OnlineApp` hands `ScreenDef`s to the same single `Board` — the flap must
  play across home → online transitions, so `OnlineApp` must not mount its own Board when
  the route changes hands. **The simplest honest structure: `App` keeps the single `<Board>`
  and asks `OnlineApp`-as-a-hook (`useOnlineScreens`) for `{screen, onRowAct}` when the
  route is online.** Follow that unless it fights the code; if a second Board proves
  unavoidable, the home→online flap is lost and that is a finding to write down, not to
  silently accept.
- [ ] **Step 6: Route tests** in `App.test.tsx`: `/room/ABC234` with no server renders the
  connecting state (not a crash, not a redirect); `/online` renders the join screen; the
  home screen carries the ONLINE row.
- [ ] **Step 7: Full suite + typecheck; commit** —
  `feat(online): boards 1d/1e/1f and the online game over GameShell`

---

### Task 11: Deploy, docs, and the by-hand gate

**Files:**
- Modify: `README.md` (run instructions), `ROADMAP.md` (Phase 3 status), `CLAUDE.md`
  (server + net + online layout rows, commands), `.gitignore` (`server/games/`)
- No new code.

- [ ] **Step 1: Local two-browser smoke** — `npm run dev:all`, two browser profiles:
  create, share-join, begin, play through homes + first turns, one undo, one refresh
  mid-turn (must rejoin to the same seat and state), one server restart (must restore).
  Fix what breaks before deploying; write findings into
  `docs/superpowers/specs/2026-08-14-online-by-hand-notes.md` as they are found.
- [ ] **Step 2: Render service.** Create a new web service on the owner's Render workspace
  (name `railbaron-multiplayer`), plan **starter**, build `npm ci && npm run build:server`,
  start `npm run start:server`, env `PORT=3001`, `GAMES_DIR=/var/data/games`; attach a 1 GB
  disk at `/var/data`. **Render must clone submodules** — verified working for Acquire
  (public HTTPS submodule); confirm the first build log shows `vendor/lobby` present (the
  `build:server` guard fails loudly if not).
- [ ] **Step 3: Verify the deploy fired and is live** via the deploy list (not `/health`
  polling — it cannot tell "still building" from "never started"), then
  `curl /health` → `{"ok":true,"protocolVersion":1,"saveVersion":1}`.
- [ ] **Step 4: Client with `VITE_SERVER_URL`** pointed at the service; build and deploy the
  GH Pages client (this repo's existing deploy path); read the bundle hash back before
  believing it.
- [ ] **Step 5: Prod by-hand pass** — the Step 1 script, on the deployed pair, ideally two
  real machines. A deploy restart mid-game must come back restored (`✓ Restored N room(s)`
  in the boot log, both browsers resume).
- [ ] **Step 6: Docs.** ROADMAP Phase 3 marked built-with-notes; CLAUDE.md gains `session/`,
  `server/`, `src/net/` and online-screen rows in its layout table, the `dev:all` command,
  and the server-deploy facts (service id, disk, envs). Record what the by-hand passes
  found, including the ones that found nothing — "surfaced nothing" is a result.
- [ ] **Step 7: Commit** — `docs: online mode shipped; what the by-hand passes found`

---

## Self-review (run before offering execution)

- **Spec coverage:** rulings table → Tasks 1 (legality incl. orderRolled exception + undo
  actor rule), 3–4 (starter service + own repo), 8 (no optimistic apply, no reset), 10
  (full boards, 1e-as-action). Persistence-validates-log → Task 2. Golden keystone → Task 5.
  Recovery → Task 6. Health/version → Tasks 4, 11. Two-project split + node boundary →
  Task 3. By-hand gate → Task 11. Dev seeding route: deliberately absent (spec's
  not-included list).
- **Known open input:** exact 1d/1e/1f copy — flagged inside Task 10 as a check against the
  design project, with structure fixed and labels pending. This is an owner-supplied input,
  not a placeholder.
- **Type consistency:** `GameTransport` produced in Task 7 = consumed in Task 8's tests;
  `GameShellProps.game` = Task 8's return; `Rooms`/`GameRoom` names match across Tasks 4–6;
  rejection codes used in tests (`notNow`, `notYourSeat`, `notYourUndo`, `nothingToUndo`,
  `malformedEvent`) all exist in `GameRejectionCode`.
- **Fixture honesty:** city ids in Task 1/8 tests are to be verified against
  `engine/cities.ts` at execution time — stated in the task, deliberately, rather than
  trusted from memory here.

