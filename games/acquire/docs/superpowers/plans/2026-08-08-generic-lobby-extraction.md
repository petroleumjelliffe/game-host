# Generic Lobby Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the lobby — rooms, seats, join/rejoin tokens, presence, rename/leave, and their screens — into three game-agnostic directories (`lobby/`, `server/lobby/`, `src/lobby/`) behind a test-enforced import boundary, with zero wire or player-visible change.

**Architecture:** The wire protocol splits into a lobby half (`lobby/protocol.ts`) and a game half (`session/protocol.ts` keeps it). The server's seating/presence/binding machinery moves under `server/lobby/` and hands the game two injection points (`onBegin`, `onSeated`) plus a seat lookup; `server/index.ts` stays the composition root. The client's identity, connection, and phase machine move under `src/lobby/` as a headless layer; the game keeps thin wrappers with unchanged public interfaces so pages and tests barely move. The lobby UI components move to `src/lobby/ui/` with their one game import (`PLAYER_EMOJI`) inverted into a prop and their accent color routed through CSS custom properties.

**Tech Stack:** TypeScript, React 18, socket.io / socket.io-client, Express, Vite, vitest (two projects: `node` and `app`).

**Spec:** `docs/superpowers/specs/2026-08-08-generic-lobby-extraction-design.md`

## Spec alignment (2026-08-08)

The four items below began as deviations this plan's reconnaissance forced, plus a
review's findings; **the spec has since been amended to match them** (same date), and
gained three requirements this plan carries: a stub-consumer genericity test and
`lobby/README.md` (Task 8), and the token-lost reclaim leg of the by-hand pass
(Task 9). The list stays as the record of what changed and why.

1. **The components never imported `tokens.ts`.** The spec's theming section assumed they did. Their styling is Tailwind utilities; the only game import is `PLAYER_EMOJI` in `LobbyCard.tsx`. So theming here is: invert `PLAYER_EMOJI` into a prop, and route the **accent color family only** (the `blue-600`/`blue-700` buttons) through three CSS variables with fallbacks. Not the spec's "on the order of a dozen" — the other colors are neutral grays with no game identity, and inventing variables with no consumer is YAGNI.
2. **No `gameName` copy parameter.** Verified: no string in any moving component names the game (checked `RoomGone`, `StaleClient`, `RoomRefused`, `RoomLobby`, `LobbyCard`, `JoinRoomCard`, `ConnectionStrip`). The parameter is deferred until a string needs it.
3. **Lifecycle stays a room method the lobby reads, not a lobby-owned field.** The spec says the lobby "owns" `'lobby' | 'playing' | 'over'` and the game flips it through a lobby API call. In the code, `GameRoom` derives `over` from its own state (`stage === 'end'`, `server/room.ts:91`) — moving that into a lobby-owned field means a callback for something the room already knows. Instead the lobby's room contract (`LobbyRoomLike`) *requires* `lifecycle()`, the canonical `Lifecycle` type moves to `lobby/protocol.ts`, and the lobby reads it. Same genericity, no new API.
4. **The spec's `snapshotRoster`/`restoreSeats` helpers are not built.** They turn out to already exist as one-line maps inside `persist` and `restore` (`room.players.map((p) => ({ ...p }))` / `{ ...p, connected: false }`), which stay game-side, and `players` is on the lobby's room contract anyway. Adding named wrappers would be an interface with one caller each — the spec's own "no storage interface for a single implementer" rule, applied to its own suggestion.

## Global Constraints

- **Wire-neutral, byte for byte.** No message shape changes, no event-name changes, no rejection-code or message-string changes, **no `PROTOCOL_VERSION` bump** (stays `3`). `server/goldenSocket.test.ts`, `server/clientOverWire.test.ts`, `server/versioning.test.ts` green with **zero assertion edits** is the gate.
- **Tests move with their files; assertions do not change.** Import-path edits in test files are expected; assertion edits are a red flag — stop and re-check the refactor instead.
- **No `as any`.** Narrow with type guards.
- **Boundary rule (allowlist):** every relative import under `lobby/`, `server/lobby/`, or `src/lobby/` must resolve back inside those three directories; bare module imports are fine. This is stricter than "don't import engine/session/src-game" on purpose — it also forbids `server/room.ts` and `src/net/`, which a blocklist would miss. (The reverse direction — game importing lobby — is the point.)
- **Server-side files use `.js` extensions on relative imports** (ESM); `src/` files use extensionless imports. Follow the file you're editing.
- **`localStorage` keys must not change:** the game's identity store keeps the exact keys `acquire.room.<roomId>` and `acquire.name`, so no player loses a seat to this refactor.
- Never run bare `tsc` — `npm run typecheck`.
- Commit at the end of every task. Work happens on the current worktree branch.
- Baseline before Task 1: `npx vitest run` → 73 files, 814 tests, all passing.

---

### Task 1: Split the protocol — `lobby/protocol.ts`

**Files:**
- Create: `lobby/protocol.ts`
- Modify: `session/protocol.ts` (remove what moved; import lobby codes for `RejectionCode`)
- Modify: `vite.config.ts:122-126` (add `lobby/**/*.test.ts` to the `node` project's `include`)
- Modify (imports only): `server/index.ts`, `server/rooms.ts`, `src/net/connection.ts`, `src/net/transport.ts`, `src/net/useRoom.ts`, `src/net/NetworkSession.ts`, `src/game/online/RoomLobby.tsx`, `src/pages/JoinRoomPage.tsx`, plus any test file the compiler flags

**Interfaces:**
- Produces: `lobby/protocol.ts` exporting `Lifecycle`, `LobbyRejectionCode`, `RejectedMessage`, `JoinedMessage`, `RosterMessage`, `CreateRoomMessage`, `JoinRoomMessage`, `RenamePlayerMessage`, `LOBBY_CLIENT_EVENTS`, `LOBBY_SERVER_EVENTS` — every later task imports these from here.
- Produces: a slimmed `session/protocol.ts` keeping `WireIntent`, `isWireIntent`, `DRAWS`, `toWire`, `RejectionCode`, `StateReason`, `StateMessage`, `UndoMessage`, `PROTOCOL_VERSION`, `GAME_CLIENT_EVENTS`, `GAME_SERVER_EVENTS`.

- [ ] **Step 1: Create `lobby/protocol.ts`**

Move these from `session/protocol.ts`, verbatim including their doc comments, changing only what is shown:

```ts
// lobby/protocol.ts
// The lobby half of the wire: room management, seats, presence.
// Game-agnostic and self-contained — imports nothing from this repo.

export type Lifecycle = 'lobby' | 'playing' | 'over';

/**
 * The refusals the lobby itself issues and branches on. Everything else on the
 * `rejected` channel (engine refusals, `undoOutOfSegment`) passes through this
 * layer opaquely for the game to interpret — which is how `useRoom` always
 * behaved; this type names it.
 */
export type LobbyRejectionCode = 'noSuchRoom' | 'seatRefused' | 'versionMismatch' | 'notConnected';

/**
 * Typed generically — `code: string`, not a union — because the lobby only
 * branches on `LobbyRejectionCode` and forwards the rest.
 */
export interface RejectedMessage { code: string; message: string }

export interface JoinedMessage {
  roomId: string;
  playerId: string;
  /** Presented on rejoin. Issued once, at first join, and never re-issued. */
  token: string;
}

export interface RosterMessage {
  roomId: string;
  lifecycle: Lifecycle;
  players: { id: string; name: string; isHost: boolean; connected: boolean }[];
}

export interface CreateRoomMessage { name?: string; protocolVersion: number }
export interface JoinRoomMessage {
  roomId: string;
  name?: string;
  playerId?: string;
  token?: string;
  protocolVersion: number;
}
export interface RenamePlayerMessage { name: string }

export const LOBBY_CLIENT_EVENTS = {
  createRoom: 'createRoom',
  joinRoom: 'joinRoom',
  beginGame: 'beginGame',
  renamePlayer: 'renamePlayer',
  leaveSeat: 'leaveSeat',
} as const;

export const LOBBY_SERVER_EVENTS = {
  joined: 'joined',
  roster: 'roster',
  rejected: 'rejected',
} as const;
```

Carry over the existing doc comments for `CreateRoomMessage`/`JoinRoomMessage` (the "name is optional / you name me" comment, `session/protocol.ts:227-236`) and for `renamePlayer`/`leaveSeat` (currently on the `CLIENT_EVENTS` members). The `versionMismatch` explanation currently inline in `RejectionCode` moves onto `LobbyRejectionCode`.

- [ ] **Step 2: Slim `session/protocol.ts`**

Remove everything that moved. What remains: `DistributiveOmit`, `WireIntent`, `isWireIntent`, `DRAWS`, `toWire`, `StateReason`, `StateMessage`, `UndoMessage`, `PROTOCOL_VERSION` (keep its full comment — it now explicitly covers **both** halves of the wire; add one line saying so), and:

```ts
import type { LobbyRejectionCode } from '../lobby/protocol';

export type RejectionCode =
  | IllegalIntentCode
  | 'undoOutOfSegment'
  | LobbyRejectionCode;

export const GAME_CLIENT_EVENTS = {
  intent: 'intent',
  undo: 'undo',
} as const;

export const GAME_SERVER_EVENTS = {
  state: 'state',
} as const;
```

`CLIENT_EVENTS` and `SERVER_EVENTS` are deleted (not re-exported): the compiler finds every importer.

- [ ] **Step 3: Add `lobby/**` to the node vitest project**

In `vite.config.ts`, the `node` project's `include` gains `'lobby/**/*.test.ts'` (there is no test there yet — Task 8 adds one; adding the glob now keeps this task the only config edit).

- [ ] **Step 4: Fix every importer, guided by the compiler**

Run `npm run typecheck` and fix each error using this mapping — event constants split by which half owns the event:

| Old (from `session/protocol`) | New home |
|---|---|
| `CreateRoomMessage`, `JoinRoomMessage`, `RenamePlayerMessage`, `JoinedMessage`, `RosterMessage`, `RejectedMessage` | `lobby/protocol` |
| `CLIENT_EVENTS.createRoom/.joinRoom/.beginGame/.renamePlayer/.leaveSeat` | `LOBBY_CLIENT_EVENTS.*` from `lobby/protocol` |
| `CLIENT_EVENTS.intent/.undo` | `GAME_CLIENT_EVENTS.*` from `session/protocol` |
| `SERVER_EVENTS.joined/.roster/.rejected` | `LOBBY_SERVER_EVENTS.*` from `lobby/protocol` |
| `SERVER_EVENTS.state` | `GAME_SERVER_EVENTS.state` from `session/protocol` |
| `WireIntent`, `isWireIntent`, `StateMessage`, `StateReason`, `UndoMessage`, `RejectionCode`, `DRAWS`, `toWire`, `PROTOCOL_VERSION` | unchanged, `session/protocol` |

Server-side imports of `lobby/protocol` use `../lobby/protocol.js`. Note `server/index.ts` emits on the `rejected` channel from both halves; it imports `LOBBY_SERVER_EVENTS` for `joined`/`roster`/`rejected` and `GAME_SERVER_EVENTS` for `state`. `server/room.ts:16` currently defines `Lifecycle` — replace with `export type { Lifecycle } from '../lobby/protocol.js';` so existing importers keep working.

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: clean, 814 tests, no assertion edits anywhere.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(lobby): the wire splits into a lobby half and a game half"
```

---

### Task 2: Generic seating registry — `server/lobby/rooms.ts`

**Files:**
- Create: `server/lobby/rooms.ts`
- Modify: `server/rooms.ts` (compose the lobby registry; keep `RoomRegistry`'s interface identical)
- Modify: `server/room.ts` (its `RoomPlayer` becomes the lobby's `SeatHolder`)

**Interfaces:**
- Consumes: `Lifecycle` from `lobby/protocol` (Task 1).
- Produces: `SeatHolder`, `LobbyRoomLike`, `Seated<R>`, `LobbyRegistry<R>`, `seatPlayer`, `createLobbyRegistry` — Task 3's handlers take a `Pick<LobbyRegistry<R>, 'create' | 'join' | 'get'>`.
- **`RoomRegistry` (game-side) keeps its exact current interface** so `server/index.ts`, `devSeed.ts` and every server test compile untouched by this task.

- [ ] **Step 1: Create `server/lobby/rooms.ts`**

```ts
// server/lobby/rooms.ts
// Seating, tokens, join/rejoin. Generic over the room: the game's payload is
// whatever `makeRoom` builds, and this file never looks inside it.

import { randomUUID } from 'node:crypto';
import type { Lifecycle } from '../../lobby/protocol.js';

export interface SeatHolder {
  id: string;
  name: string;
  token: string;
  isHost: boolean;
  connected: boolean;
}

/** What the lobby needs a room to be. The game's room is a superset. */
export interface LobbyRoomLike {
  id: string;
  players: SeatHolder[];
  lifecycle(): Lifecycle;
}

export interface Seated<R extends LobbyRoomLike> { room: R; player: SeatHolder }

export interface LobbyRegistry<R extends LobbyRoomLike> {
  create(hostName?: string): Seated<R>;
  join(roomId: string, name?: string, playerId?: string, token?: string): Seated<R> | null;
  get(roomId: string): R | undefined;
  all(): R[];
  /**
   * Seats a prepared room directly, replacing whatever holds its id.
   * For restore-at-boot and test seeding; the caller owns the "nothing is
   * live here" guarantee (see `RoomRegistry.restore`'s boot-only guard).
   */
  adopt(room: R): void;
}

export function createLobbyRegistry<R extends LobbyRoomLike>(
  makeRoom: (id: string, players: SeatHolder[]) => R,
): LobbyRegistry<R> {
  const rooms = new Map<string, R>();

  return {
    create(hostName) {
      let id = roomCode();
      while (rooms.has(id)) id = roomCode();
      const host = seatPlayer(0, hostName);
      const room = makeRoom(id, [host]);
      rooms.set(id, room);
      return { room, player: host };
    },
    join(roomId, name, playerId, token) { /* moved verbatim */ },
    get: (roomId) => rooms.get(roomId),
    all: () => [...rooms.values()],
    adopt(room) { rooms.set(room.id, room); },
  };
}
```

`seatPlayer` (with its full doc comment), `roomCode`, and the bodies of `create`/`join` move **verbatim** from `server/rooms.ts:59-131` — including the collision-retry comment, the token-proof rejoin, and the honor-system name reclaim with its owner-ruling comment. The only edits: `createGameRoom(id, [host])` becomes `makeRoom(id, [host])`, and the return type names change as above. `seatPlayer` is exported (the game's `fromState` needs it).

- [ ] **Step 2: Rebuild `server/rooms.ts` as a composition**

`RoomRegistry`'s interface does not change. Internals:

```ts
import { createLobbyRegistry, seatPlayer, type SeatHolder } from './lobby/rooms.js';

export interface Seat { room: GameRoom; player: RoomPlayer }

export function createRoomRegistry(store: RoomStore = createNullStore()): RoomRegistry {
  const lobby = createLobbyRegistry<GameRoom>((id, players) => createGameRoom(id, players));
  let restored = false;

  return {
    create: (hostName) => lobby.create(hostName),
    join: (roomId, name, playerId, token) => lobby.join(roomId, name, playerId, token),
    get: (roomId) => lobby.get(roomId),
    all: () => lobby.all(),
    fromState(roomId, names, state) {
      const players = names.map((name, i) => seatPlayer(i, name));
      const room = createGameRoom(roomId, players, state);
      lobby.adopt(room);
      return room;
    },
    async persist(room) { /* unchanged, verbatim from today */ },
    async restore(now = Date.now()) {
      /* unchanged except: `rooms.set(record.roomId, createGameRoom(...))`
         becomes `lobby.adopt(createGameRoom(...))`. The boot-only `restored`
         throw stays here — adopt is mechanism, this is policy. */
    },
  };
}
```

`MAX_AGE_MS` and every comment on `persist`/`restore` stay. Delete the now-unused local `seatPlayer`/`roomCode` and the `randomUUID` import.

- [ ] **Step 3: `server/room.ts`'s player type is the lobby's**

Replace the `RoomPlayer` interface (`server/room.ts:7`) with:

```ts
import type { SeatHolder } from './lobby/rooms.js';
export type RoomPlayer = SeatHolder;
```

(Same shape field-for-field; the compiler proves it — any mismatch is a real finding, stop and report it.)

- [ ] **Step 4: Typecheck and the server suite, then the full suite**

Run: `npm run typecheck && npx vitest run --project node && npx vitest run`
Expected: clean; `server/rooms.test.ts`, `recovery.test.ts`, `lobbySeat.test.ts`, `goldenSocket.test.ts` all green, unedited.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(lobby): seating and tokens become a generic registry the game composes"
```

---

### Task 3: Lobby socket handlers — `server/lobby/handlers.ts`

**Files:**
- Create: `server/lobby/handlers.ts`
- Modify: `server/index.ts` (becomes composition root: keeps `/health`, `sendState`, `deliver`, `intent`/`undo` handlers, `ping-settle`, boot block; loses `bindings`, `socketsFor`, `roster`, and the five lobby handlers)

**Interfaces:**
- Consumes: `LobbyRegistry`, `LobbyRoomLike`, `Seated` (Task 2); `lobby/protocol` messages and event names (Task 1).
- Produces:

```ts
export interface SeatBinding { roomId: string; playerId: string }
export interface LobbyHooks<R extends LobbyRoomLike> {
  protocolVersion: number;
  /**
   * The host pressed begin; the lobby has already verified host and
   * lifecycle. The game starts itself and owns the send order — call
   * `wiring.broadcastRoster` yourself when the moment is right.
   */
  onBegin(room: R): void;
  /** A socket was seated (first join or rejoin), `joined` + roster already sent. */
  onSeated(room: R, playerId: string): void;
}
export interface LobbyWiring<R extends LobbyRoomLike> {
  seatOf(socketId: string): SeatBinding | undefined;
  socketsFor(roomId: string, playerId: string): Socket[];
  broadcastRoster(room: R): void;
  /** Register the lobby's handlers on one connection. Call from io.on('connection'). */
  attach(socket: Socket): void;
}
export function createLobbyHandlers<R extends LobbyRoomLike>(
  io: SocketServer,
  registry: Pick<LobbyRegistry<R>, 'create' | 'join' | 'get'>,
  hooks: LobbyHooks<R>,
): LobbyWiring<R>
```

- [ ] **Step 1: Create `server/lobby/handlers.ts`**

Move from `server/index.ts`, verbatim with comments, parameterizing as noted:

- the `bindings` map and `socketsFor` (`index.ts:69,76-81`)
- `roster()` (`index.ts:111-122`) — becomes `broadcastRoster(room)` doing `io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, ...)`
- `speaksOurProtocol` (`index.ts:175-183`) — reads `hooks.protocolVersion` instead of the imported constant
- the `createRoom`, `joinRoom`, `renamePlayer`, `leaveSeat`, `beginGame` handlers (`index.ts:185-391`) and the `disconnect` presence handler (`index.ts:450-464`), registered inside `attach(socket)`

**Every rejection code and message string stays byte-identical** — including `beginGame`'s `notYourTurn`/`'only the host may begin the game'` and the `unknownIntent` shape refusals: they are wire contract, typed here as plain strings on `RejectedMessage`. Two seams change inside the moved code:

1. `joinRoom`, after `joined` + roster are emitted: the tail `if (seat.room.lifecycle() !== 'lobby') sendState(..., 'resume')` becomes `hooks.onSeated(seat.room, seat.player.id)` — called unconditionally; the lifecycle check moves into the game's hook.
2. `beginGame`, after the host and lifecycle checks pass: the tail (`room.begin(randomSeed())`, roster emit, `deliver`) becomes exactly `hooks.onBegin(room);` — the game does all three, preserving today's begin → roster → deliver order.

- [ ] **Step 2: Recompose `server/index.ts`**

```ts
const rooms = createRoomRegistry(options.store ?? createNullStore());
const lobby = createLobbyHandlers<GameRoom>(io, rooms, {
  protocolVersion: PROTOCOL_VERSION,
  onBegin(room) {
    const delivery = room.begin(randomSeed());
    lobby.broadcastRoster(room);
    deliver(room, delivery);
  },
  onSeated(room, playerId) {
    // `resume`, not `commit`: this socket may belong to the player the game
    // is waiting on, mid-segment, with work the server still holds.
    if (room.lifecycle() !== 'lobby') sendState(room, playerId, 'resume');
  },
});

io.on('connection', (socket) => {
  socket.on('ping-settle', /* unchanged */);
  lobby.attach(socket);
  socket.on(GAME_CLIENT_EVENTS.intent, (wire: WireIntent) => {
    const bound = lobby.seatOf(socket.id);
    /* body unchanged, using `bound` */
  });
  socket.on(GAME_CLIENT_EVENTS.undo, /* same pattern */);
});
```

(`lobby` referenced inside the hooks is fine — the hooks run long after the `const` initializes.) `sendState` and `deliver` stay in `index.ts` unchanged except `socketsFor` → `lobby.socketsFor`. One subtlety: `deliver`'s `rejected` branch and `sendState` emit to sockets found via `lobby.socketsFor` — the game emits `GAME_SERVER_EVENTS.state` and the shared `rejected` channel (`LOBBY_SERVER_EVENTS.rejected`) itself; the lobby does not send game state, ever.

- [ ] **Step 3: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: green with zero assertion edits — `goldenSocket`, `clientOverWire`, `oneSeatPerSocket`, `lobbySeat`, `projectionOverWire`, `recovery`, `versioning`, `devSeed` are all driving this exact seam over real sockets.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(lobby): the server's lobby handlers move behind onBegin/onSeated"
```

---

### Task 4: Namespaced identity — `src/lobby/identity.ts`

**Files:**
- Create: `src/lobby/identity.ts`, `src/lobby/identity.test.ts`
- Modify: `src/net/identity.ts` (becomes the game's instantiation, exact same exports)
- Move: `src/net/identity.test.ts` stays put, unedited — it now exercises the game's instantiation, which is exactly what it claims to test

**Interfaces:**
- Produces: `createIdentityStore(appId: string): IdentityStore` where `IdentityStore` has today's five functions: `loadIdentity`, `saveIdentity`, `clearIdentity`, `rememberedName`, `rememberName`; plus `RoomIdentity` (moves as-is).

- [ ] **Step 1: Write the failing test**

```ts
// src/lobby/identity.test.ts
import { createIdentityStore } from './identity';

describe('identity namespace', () => {
  beforeEach(() => { localStorage.clear(); });

  it('two apps on one origin do not collide on the same room code', () => {
    const acquire = createIdentityStore('acquire');
    const other = createIdentityStore('gamebee');
    acquire.saveIdentity('ABC123', { playerId: 'p1', token: 't-acquire', name: 'Ada' });
    other.saveIdentity('ABC123', { playerId: 'p2', token: 't-other', name: 'Bee' });

    expect(acquire.loadIdentity('ABC123')?.token).toBe('t-acquire');
    expect(other.loadIdentity('ABC123')?.token).toBe('t-other');
  });

  it('keeps the exact legacy keys for appId acquire', () => {
    const store = createIdentityStore('acquire');
    store.saveIdentity('ABC123', { playerId: 'p1', token: 't', name: 'Ada' });
    store.rememberName('Ada');
    // Pinned as raw strings: a changed key silently logs every player out.
    expect(localStorage.getItem('acquire.room.ABC123')).not.toBeNull();
    expect(localStorage.getItem('acquire.name')).toBe('Ada');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lobby/identity.test.ts`
Expected: FAIL — module `./identity` does not exist.

- [ ] **Step 3: Implement**

`src/lobby/identity.ts` is today's `src/net/identity.ts` wrapped in a factory: the whole file body (guarded `read`/`write`, `RoomIdentity`, `HAS_A_NAME_IN_IT` with its migration comment) moves verbatim inside `createIdentityStore(appId)`, with:

```ts
const roomKey = (roomId: string) => `${appId}.room.${roomId}`;
const NAME_KEY = `${appId}.name`;
```

`src/net/identity.ts` becomes:

```ts
import { createIdentityStore } from '../lobby/identity';
export type { RoomIdentity } from '../lobby/identity';

/** This game's identity store. The appId is the localStorage namespace —
 * changing it logs every player out of every room. */
const store = createIdentityStore('acquire');
export const { loadIdentity, saveIdentity, clearIdentity, rememberedName, rememberName } = store;
```

- [ ] **Step 4: Run the new test and the app project**

Run: `npx vitest run src/lobby/identity.test.ts src/net/identity.test.ts && npx vitest run --project app`
Expected: PASS, including the untouched `src/net/identity.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(lobby): identity keys carry an app namespace; acquire keeps its exact keys"
```

---

### Task 5: The lobby connection — `src/lobby/connection.ts`

**Files:**
- Create: `src/lobby/connection.ts`
- Modify: `src/net/connection.ts` (keeps `Connection`, `getConnection`, `closeConnection`, `SERVER_URL`; composes the lobby connection + game transport)
- Modify: `src/net/useRoom.ts`, `src/pages/JoinRoomPage.tsx`, `src/pages/OnlineLobbyPage.tsx` (their `joinRoom`/`createRoom` calls stop passing `protocolVersion` — the connection injects it)

**Interfaces:**
- Produces:

```ts
export type ConnectionStatus = 'connecting' | 'open' | 'closed';
export interface LobbyConnectionOptions { serverUrl: string; protocolVersion: number }
export interface LobbyConnection {
  /** The raw socket, exposed so a game can hang its own transport off it. */
  socket: Socket;
  status(): ConnectionStatus;
  subscribe(listener: () => void): () => void;
  createRoom(name?: string): void;
  joinRoom(msg: Omit<JoinRoomMessage, 'protocolVersion'>): void;
  beginGame(): void;
  renamePlayer(name: string): void;
  leaveSeat(): void;
  onJoined(handler: (msg: JoinedMessage) => void): () => void;
  onRoster(handler: (msg: RosterMessage) => void): () => void;
  onRejected(handler: (msg: RejectedMessage) => void): () => void;
  close(): void;
}
export function createLobbyConnection(opts: LobbyConnectionOptions): LobbyConnection
```

- Consumes (game side): `Connection` becomes `LobbyConnection & { transport: RoomTransport }` — every current caller keeps compiling because every current member survives with the same signature except `joinRoom`, whose message loses one required field (a widening, so call sites that still pass it must be cleaned up, not left).

- [ ] **Step 1: Create `src/lobby/connection.ts`**

The `io(...)` call with its reconnection options and their full deploy-survival comment (`src/net/connection.ts:70-91`), the status listener set, and every send/subscribe method move verbatim, with three parameterizations: `SERVER_URL` → `opts.serverUrl`; `PROTOCOL_VERSION` → `opts.protocolVersion` (injected into `createRoom` and `joinRoom` payloads); `CLIENT_EVENTS`/`SERVER_EVENTS` → `LOBBY_CLIENT_EVENTS`/`LOBBY_SERVER_EVENTS`. `joinRoom` becomes:

```ts
joinRoom(msg) {
  const wire: JoinRoomMessage = { ...msg, protocolVersion: opts.protocolVersion };
  socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, wire);
},
```

`socket` is exposed on the returned object. `onRejected` is new here (same pattern as `onJoined`, on `LOBBY_SERVER_EVENTS.rejected`).

- [ ] **Step 2: Recompose `src/net/connection.ts`**

`SERVER_URL` (with its phone-on-the-LAN comment and the module-scope-`window` warning) stays in this file. Then:

```ts
export interface Connection extends LobbyConnection { transport: RoomTransport }

function createConnection(): Connection {
  const lobby = createLobbyConnection({ serverUrl: SERVER_URL, protocolVersion: PROTOCOL_VERSION });
  return { ...lobby, transport: createSocketTransport(lobby.socket) };
}
```

`getConnection`/`closeConnection` singletons unchanged. Re-export `ConnectionStatus` from the lobby module (`export type { ConnectionStatus } from '../lobby/connection';`) so `ConnectionStrip` and friends keep their import path until Task 7 moves them.

- [ ] **Step 3: Drop `protocolVersion` at the call sites**

`useRoom.ts:213-233` (both `joinRoom` payloads), `useRoom.ts:240-244` (`join` callback), and any `joinRoom`/`createRoom` in `JoinRoomPage.tsx`/`OnlineLobbyPage.tsx` — remove the `protocolVersion: PROTOCOL_VERSION` field and, where it becomes unused, the import.

- [ ] **Step 4: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: green. `server/clientOverWire.test.ts` proves the join wire still carries the version — that is the assertion that would catch a broken injection.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(lobby): the connection's lobby half is generic; the game hangs its transport off it"
```

---

### Task 6: `useLobbyRoom` + the game's thin `useRoom`

**Files:**
- Create: `src/lobby/useLobbyRoom.ts`
- Rewrite: `src/net/useRoom.ts` (same exported `Room`/`RoomPhase` interface, now a wrapper)
- Modify: `src/pages/RoomPage.test.tsx` — **only if** its fake-connection type needs the Task 5 `onRejected` member added; assertions untouched
- Test: the phase-ranking test goes in `src/net/useRoom.test.ts` (new file)

**Interfaces:**
- Produces:

```ts
export type LobbyPhase = 'connecting' | 'joining' | 'lobby' | 'error' | 'gone' | 'stale';
export interface LobbyRoomState {
  phase: LobbyPhase;
  status: ConnectionStatus;
  roster: RosterMessage | null;
  playerId: string | null;
  message: string | null;
  gone: boolean;
  stale: boolean;
  join(name?: string): void;
  begin(): void;
  rename(name: string): void;
  leaveSeat(): void;
}
export function useLobbyRoom(
  roomId: string,
  connection: LobbyConnection,
  identity: IdentityStore,
): LobbyRoomState
```

- `src/net/useRoom.ts` keeps exporting `Room` and `RoomPhase` with today's exact shape (`useRoom.ts:7-38`), so `RoomPage.tsx` does not change.

- [ ] **Step 1: Write the failing phase-ranking test**

The ghost of the Phase 4 bug, pinned: a room that dies mid-game must never leave a live-looking board on screen, even for a render.

```ts
// src/net/useRoom.test.ts
import { renderHook, act } from '@testing-library/react';
import { useRoom } from './useRoom';
// Build the same fake Connection RoomPage.test.tsx uses (copy its factory or
// extract it to a shared test helper if one does not exist): controllable
// status, capture-and-fire handlers for onJoined/onRoster/onState/onRejected.

describe('phase ranking over a live session', () => {
  it('noSuchRoom outranks playing in the very same render', () => {
    const fake = fakeConnection();
    const { result } = renderHook(() => useRoom('ABC123', () => fake.connection));
    act(() => { fake.open(); fake.joined({ roomId: 'ABC123', playerId: 'p1', token: 't' }); });
    act(() => { fake.state(minimalStateMessage()); });
    expect(result.current.phase).toBe('playing');

    act(() => { fake.rejected({ code: 'noSuchRoom', message: 'Room ABC123 is no longer available' }); });
    expect(result.current.phase).toBe('gone');
    expect(result.current.session).toBeNull();
  });

  it('versionMismatch outranks playing the same way', () => {
    /* same shape, code: 'versionMismatch', expect phase 'stale' */
  });
});
```

(`minimalStateMessage()`: replay a golden game's opening via `replayGoldenGame` — never the vitest runner import — or reuse whatever `RoomPage.test.tsx` already feeds its fake; match existing test practice in that file.)

- [ ] **Step 2: Run it — it must fail for the right reason**

Run: `npx vitest run src/net/useRoom.test.ts`
Expected: FAIL. Today `gone` sits *below* `playing` in the ternary (`useRoom.ts:283-300`) and only wins because the rejection handler tears the session down first — the test as written may actually pass against today's code via that teardown. **If it passes, break the ranking deliberately** (reorder `gone` below `session !== null` *and* comment out the teardown) to watch both assertions fail, per the hollow-gate rule — then proceed; the point of the test is to hold the ranking once the teardown moves into an effect, where it is no longer same-tick.

- [ ] **Step 3: Create `src/lobby/useLobbyRoom.ts`**

Today's `useRoom.ts` body moves, minus everything session-shaped:

- State: `status`, `roster`, `playerId`, `message`, `gone`, `stale`; refs `identityRef` (via the injected `identity` store), `seatedRef`, `wasOpenRef`, `sent` — comments travel.
- The status/roster/joined/rejected effect moves, with the session lines deleted: no `sessionRef.current?.connectionLost()` (the wrapper handles that), no `dispose()`/`setSession(null)` in the `noSuchRoom`/`versionMismatch` branches — they just `setGone(true)`/`setStale(true)` plus the identity clearing exactly as today. The `if (sessionRef.current === null) setMessage(...)` guard becomes an unconditional `setMessage(msg.message)` for non-terminal rejections — the wrapper's phase ranking keeps `playing` above `error`, so a mid-game refusal still never replaces the board (it surfaces through the session's own channel, as today).
- The join-once effect and the `join`/`begin`/`rename`/`leaveSeat` callbacks move as-is (already protocol-version-free after Task 5).
- The phase ternary loses its `session` line:

```ts
const phase: LobbyPhase =
  stale ? 'stale'
    : gone ? 'gone'
      : roster !== null ? 'lobby'
        : message !== null ? 'error'
          : status !== 'open' ? 'connecting'
            : 'joining';
```

(Exactly today's ordering with `playing` removed: `stale → gone → lobby → error → connecting/joining`, keeping the "a roster outranks a refusal" comment.)

- [ ] **Step 4: Rewrite `src/net/useRoom.ts` as the wrapper**

```ts
export function useRoom(roomId: string, connect: () => Connection = getConnection): Room {
  const connection = useMemo(() => connect(), [connect]);
  const lobby = useLobbyRoom(roomId, connection, acquireIdentity);

  const [session, setSession] = useState<NetworkSession | null>(null);
  const sessionRef = useRef<NetworkSession | null>(null);
  const playerIdRef = useRef<string | null>(loadIdentity(roomId)?.playerId ?? null);

  useEffect(() => connection.onJoined((m) => { playerIdRef.current = m.playerId; }), [connection]);

  // The first state message is what turns a lobby into a game. (Moved from
  // the old useRoom; body unchanged, reading playerIdRef.)
  useEffect(() => { /* onState → createNetworkSession, as today (useRoom.ts:188-204) */ }, [connection]);

  // Terminal states tear the game down — in an effect, one render after the
  // phase has already moved off 'playing'. The ranking below is what covers
  // that render; the test in useRoom.test.ts pins both halves.
  useEffect(() => {
    if (!lobby.gone && !lobby.stale) return;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
  }, [lobby.gone, lobby.stale]);

  // The transport cannot hear its own socket die; tell the session directly.
  // (Moved from the old status subscription; the lobby keeps its own copy for
  // the rejoin resend.)
  useEffect(() => {
    let wasOpen = connection.status() === 'open';
    return connection.subscribe(() => {
      const open = connection.status() === 'open';
      if (wasOpen && !open) sessionRef.current?.connectionLost();
      wasOpen = open;
    });
  }, [connection]);

  const phase: RoomPhase =
    lobby.stale ? 'stale'
      : lobby.gone ? 'gone'
        : session !== null ? 'playing'
          : lobby.phase;

  return { phase, status: lobby.status, roster: lobby.roster, playerId: lobby.playerId,
           session, message: lobby.message, join: lobby.join, begin: lobby.begin,
           rename: lobby.rename, leaveSeat: lobby.leaveSeat };
}
```

Where `acquireIdentity` is the game's `IdentityStore` — export the `store` instance from `src/net/identity.ts` (Task 4) as `export const acquireIdentity = store;` alongside the destructured functions. **Note the ranking change is deliberate and spec'd:** `gone` now sits *above* `playing` (it was below, saved by same-tick teardown); the old ternary's long comment explaining why below-was-fine (`useRoom.ts:270-282`) does not move — the new order plus the effect replaces its reasoning.

- [ ] **Step 5: Run the new test, then everything**

Run: `npx vitest run src/net/useRoom.test.ts && npm run typecheck && npx vitest run`
Expected: the phase test passes; `RoomPage.test.tsx` (13 phases of behavior through the real `useRoom`) passes unedited except, at most, the fake gaining `onRejected`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(lobby): useLobbyRoom is headless; the game's useRoom ranks gone and stale above playing"
```

---

### Task 7: The UI kit moves — `src/lobby/ui/`

**Files:**
- Move (git mv): `src/game/online/{LobbyCard,RoomLobby,JoinRoomCard,RoomGone,RoomRefused,StaleClient,ConnectionStrip}.tsx` → `src/lobby/ui/`, with their tests (`ConnectionStrip.test.tsx`, `StaleClient.test.tsx`)
- Stays: `src/game/online/TurnToast.tsx` (turns, not rooms)
- Create: `src/game/online/seatEmoji.ts`
- Modify: `src/pages/RoomPage.tsx`, `src/pages/JoinRoomPage.tsx` (import paths; `RoomPage` passes `seatEmoji`)

**Interfaces:**
- Produces: `src/lobby/ui/*` importing only from `src/lobby/*`, `lobby/protocol`, and React.
- `RoomLobby` gains one required prop: `seatEmoji(seat: number): string | null`.
- Theming contract: `--lobby-accent` (default `#2563eb`), `--lobby-accent-strong` (default `#1d4ed8`), `--lobby-on-accent` (default `#ffffff`) — read via Tailwind arbitrary values, so an un-themed consumer renders exactly today's blue.

- [ ] **Step 1: Move the seven components and two tests**

`git mv` each; fix their relative imports (`RosterMessage` from `../../../lobby/protocol`, `ConnectionStatus` from `../connection` — i.e. `src/lobby/connection`).

- [ ] **Step 2: Invert `PLAYER_EMOJI`**

Delete `seatEmoji` and the `PLAYER_EMOJI` import from `LobbyCard.tsx` (`LobbyCard.tsx:15-28`). Create:

```ts
// src/game/online/seatEmoji.ts
import { PLAYER_EMOJI } from '../../../engine/startups';

/**
 * The face the game is about to give a seat. Derived, never invented: the
 * engine assigns `PLAYER_EMOJI` by seat index at game start, so the lobby can
 * show it early. Null past the end of the table — and null when there is no
 * seat yet, which is every row on the Join card.
 */
export function seatEmoji(seat: number | null): string | null {
  return seat === null ? null : PLAYER_EMOJI[seat] ?? null;
}
```

`RoomLobby` takes `seatEmoji` as a prop (type above) and uses it where it called the import; `RoomPage.tsx` passes the game's. `JoinRoomCard` already renders `SeatRow` with explicit `emoji` values — follow the compiler.

- [ ] **Step 3: Route the accent through CSS variables**

In the moved components only, replace every occurrence:

| Today | Becomes |
|---|---|
| `bg-blue-600` | `bg-[var(--lobby-accent,#2563eb)]` |
| `hover:bg-blue-700` | `hover:bg-[var(--lobby-accent-strong,#1d4ed8)]` |
| `text-white` on those same buttons | `text-[var(--lobby-on-accent,#ffffff)]` |

Neutral grays stay literal Tailwind. Add a short comment block at the top of `LobbyCard.tsx` naming the three variables as the theming surface.

- [ ] **Step 4: Verify in a real browser** (working rule: jsdom reports zero for layout and, here, cannot prove Tailwind emitted the arbitrary-value classes)

Run: `npm run dev:all`, open `/online`, create a room, join it from a second tab. The buttons must be visibly the same blue as before; check one button in devtools shows `background-color` resolving through `var(--lobby-accent, ...)`. Then set `--lobby-accent: rebeccapurple` on `:root` in devtools and watch every primary button change — that is the theme surface working.

- [ ] **Step 5: Full suite + build gates**

Run: `npm run typecheck && npx vitest run && npx vite build && npm run check:bundle`
Expected: all green; `check:bundle` still finds no golden data in the main chunk.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(lobby): the lobby UI moves to src/lobby/ui, themeable, emoji injected"
```

---

### Task 8: The boundary proven, the stub consumer, and the README

**Files:**
- Create: `lobby/importBoundary.test.ts` (node project — Task 1 already added the glob)
- Create: `server/lobby/genericConsumer.test.ts`
- Create: `lobby/README.md`

**Interfaces:**
- Consumes: the final layout of Tasks 1–7. This task is last on purpose: the boundary test can only pass once everything above is done.

- [ ] **Step 1: Write the test**

```ts
// lobby/importBoundary.test.ts
// The extraction's contract: these directories are game-agnostic, so the lift
// to a second game is a `git mv`. The rule is an allowlist, not a blocklist:
// every relative import must resolve back inside the lobby directories. A
// blocklist of engine/session/src-game would leave server/room.ts and
// src/net/ importable — a GameRoom import in handlers.ts would pass the gate
// while breaking exactly what the gate guards.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

// import.meta.url, not __dirname: the node vitest project runs ESM.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const LOBBY_ROOTS = ['lobby', 'server/lobby', 'src/lobby'].map((p) => resolve(REPO, p));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('every relative import under the lobby resolves back inside the lobby', () => {
  const files = LOBBY_ROOTS.flatMap((root) => sourceFiles(root));
  expect(files.length).toBeGreaterThan(10); // the absence-assertion guard: an empty walk passes vacuously

  const offences: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue; // bare imports (react, socket.io) are fine
      const target = resolve(dirname(file), spec);
      if (!LOBBY_ROOTS.some((root) => target.startsWith(root + sep)))
        offences.push(`${file} imports ${spec}`);
    }
  }
  expect(offences).toEqual([]);
});
```

- [ ] **Step 2: Run it — green**

Run: `npx vitest run lobby/importBoundary.test.ts`
Expected: PASS (and the file-count guard proves the walk found the tree).

- [ ] **Step 3: Prove it can fail — the hollow-gate rule, by running the break**

Add `import type { WireIntent } from '../session/protocol';` to the top of `lobby/protocol.ts`. Run the test again.
Expected: FAIL, naming `lobby/protocol.ts imports ../session/protocol`. Then break it where the *old blocklist design would have stayed green*: add `import type { GameRoom } from '../room.js';` to `server/lobby/handlers.ts`, run, watch it fail naming that file — that failure is the allowlist earning its keep. **Read both failure outputs — do not proceed on green memory.** Revert both edits, run once more, green.

- [ ] **Step 4: Write the stub-consumer test** (expected green — it proves a property, not a defect)

The boundary test proves *decoupled*; this proves *generic* — the registry driven by a room that is not `GameRoom`, so an accidentally Acquire-shaped abstraction goes red here instead of during the lift.

```ts
// server/lobby/genericConsumer.test.ts
// A room that is not GameRoom. If the lobby's generics ever grow a requirement
// only GameRoom satisfies, this file is what goes red — before the lift does.
import { createLobbyRegistry, seatPlayer, type LobbyRoomLike, type SeatHolder } from './rooms.js';
import type { LobbyHooks } from './handlers.js';
import type { Lifecycle } from '../../lobby/protocol.js';

interface StubRoom extends LobbyRoomLike { begun: boolean }

function makeStub(id: string, players: SeatHolder[]): StubRoom {
  const lifecycle: Lifecycle = 'lobby';
  return { id, players, lifecycle: () => lifecycle, begun: false };
}

// Compile-time proof the hook types instantiate over a non-GameRoom room.
const _hooks: LobbyHooks<StubRoom> = {
  protocolVersion: 1,
  onBegin: (room) => { room.begun = true; },
  onSeated: () => {},
};
void _hooks;

describe('the registry over a room that is not GameRoom', () => {
  it('creates, seats the host, and names an unnamed second seat by number', () => {
    const registry = createLobbyRegistry<StubRoom>(makeStub);
    const { room, player: host } = registry.create('Ada');
    expect(host.isHost).toBe(true);
    expect(host.name).toBe('Ada');

    const seated = registry.join(room.id);
    expect(seated?.player.name).toBe('Player 2');
    expect(registry.get(room.id)?.players).toHaveLength(2);
  });

  it('a rejoin must present the seat\'s own token', () => {
    const registry = createLobbyRegistry<StubRoom>(makeStub);
    const { room, player } = registry.create('Ada');
    expect(registry.join(room.id, undefined, player.id, 'wrong-token')).toBeNull();
    expect(registry.join(room.id, undefined, player.id, player.token)?.player.id).toBe(player.id);
  });

  it('adopt replaces whatever holds the id', () => {
    const registry = createLobbyRegistry<StubRoom>(makeStub);
    const replacement = makeStub('ABC123', [seatPlayer(0, 'Bee')]);
    registry.adopt(replacement);
    expect(registry.get('ABC123')).toBe(replacement);
  });
});
```

Run: `npx vitest run server/lobby/genericConsumer.test.ts` — expected to pass immediately **only if** Tasks 2–3 kept the generics honest; a compile error here is a real finding (the abstraction leaked `GameRoom`), fix the leak, not the test.

- [ ] **Step 5: Write `lobby/README.md`** — the page game #2's author reads at the lift

```markdown
# The lobby

Rooms, seats, join/rejoin tokens, presence, rename/leave — game-agnostic, shared
by every game in this family. Three pieces: `lobby/` (wire types, node-safe),
`server/lobby/` (seating registry + socket handlers), `src/lobby/` (headless
React client + default UI under `ui/`).

**The lobby is turn-agnostic.** It knows seats, presence, lifecycle, and "the
host pressed begin" — never turns, actors, or timing. Turn-based, real-time,
simultaneous: all equally at home; whatever happens after `onBegin` is yours.

## What your game provides

- **A room**: anything with `id`, `players: SeatHolder[]`, and `lifecycle()`
  returning `'lobby' | 'playing' | 'over'`. Pass a `makeRoom(id, players)`
  factory to `createLobbyRegistry`.
- **Two hooks** for `createLobbyHandlers`: `onBegin(room)` — host pressed start,
  lobby has validated host + lifecycle; begin your game, call
  `wiring.broadcastRoster(room)`, send your own state. `onSeated(room, playerId)`
  — a socket was seated (join or rejoin); send them your game's state if one is
  running.
- **Your protocol version** (`protocolVersion` on the hooks and on
  `createLobbyConnection`) — the lobby has no version of its own; your game's
  number covers both halves of the wire.
- **An `appId`** for `createIdentityStore` — the `localStorage` namespace. Games
  share the origin; a duplicated appId lets one game's seat tokens shadow
  another's.
- **A seat-emoji function** for `RoomLobby` (`seatEmoji(seat) => string | null`),
  and optionally a theme: `--lobby-accent`, `--lobby-accent-strong`,
  `--lobby-on-accent` (defaults render the reference blue).

## What the lobby decides for you (re-ask at the lift if it doesn't fit)

- **The honor reclaim**: mid-game, a join with a disconnected seat's exact name
  takes that seat (token rotated). Right for a trusted table; a trust model
  where name + room code must not capture a seat needs a flag that does not
  exist yet.
- Some rejection codes carry game-flavored names (`notYourTurn` for "not the
  host") — wire legacy; renaming costs a protocol bump.
- Reconnect/backoff socket options are fixed (infinite retries, 500ms–5s).
```

- [ ] **Step 6: Full suite, then commit**

Run: `npm run typecheck && npx vitest run`

```bash
git add -A && git commit -m "test(lobby): boundary proven by breaking it; a stub consumer proves the generics; README for game #2"
```

---

### Task 9: Whole-branch review, gates, and the by-hand pass

Per the working rules: both of Phase 4's worst bugs spanned two tasks each and survived per-task review. This task reviews the branch as one change and then plays it.

- [ ] **Step 1: Full gates**

Run: `npm run typecheck && npx vitest run && npx vite build && npm run check:bundle && npm run verify:layout`
Expected: all green (verify:layout drives pass-and-play, untouched here — a red run is a real finding, not noise; its arithmetic was fixed 2026-08-08).

- [ ] **Step 2: Review the whole diff**

Run: `git diff main...HEAD` and read it end to end, hunting specifically for seams that span tasks: the `rejected` channel emitted from two modules with one event name; the begin order (begin → roster → deliver) preserved through the `onBegin` inversion; `message` now set unconditionally in `useLobbyRoom` while the wrapper ranks `playing` above `error`; the `sent`-reset rejoin living in the lobby while `connectionLost` lives in the wrapper — both firing off one status change. Use the requesting-code-review skill.

- [ ] **Step 3: The by-hand pass, two browsers**

`npm run dev:all` (confirm which tree serves — check the vite port banner; another checkout may hold 5173). Then, in two real browser profiles:

1. Create a room; the card shows the code; second browser joins by code.
2. Rename your own row in each browser — the other side sees it live.
3. Leave from the second browser — the seat vacates; rejoin.
4. Begin. Draw turn-order tiles in both browsers through the curtain hand-off.
5. Refresh the actor mid-draft — it comes back to the open draft (the `resume` path through `onSeated`).
6. Kill the server process; both browsers show the connection pill; restart it (`npm run dev:server`); both rejoin their seats and the game continues.
7. Navigate to a made-up room code — `RoomGone` by name, and Back works.
8. **The token-lost reclaim** (the least-tested path crossing the boundary): mid-game, in the second browser's devtools, delete **both** its `acquire.room.<code>` and `acquire.name` localStorage keys, then refresh. (Deleting only the room key lets the auto-join silently reclaim via the remembered name — worth seeing once, but it skips the screen this leg exists for.) The nameless join is refused → `RoomRefused`; retype a *wrong* name and watch it get refused again; retype the seat's *exact* name — it takes the old seat back, token rotated, and play continues.

   > **By-hand finding (2026-08-09):** the reclaim mechanism itself verified end-to-end — wrong
   > name refused, exact name reclaims the seat with a rotated token. But `RoomRefused` deliberately
   > has no name field (its own doc comment says so: "nothing asks who you are on the way into a
   > room any more, so there is no answer to correct and resubmit"), so its "Try again" loops
   > namelessly and can never retype anything. The working reclaim path is the join page, not this
   > screen. The leg as written described a screen that never existed; the dead-end is pre-existing
   > product behavior, filed separately, not a branch regression.

Any deviation from today's behavior is a finding: record it in the plan doc's margin, fix, re-run the relevant leg.

- [ ] **Step 4: Final commit and hand back**

```bash
git add -A && git commit -m "docs(lobby): by-hand pass notes for the extraction branch"
```

Then use the finishing-a-development-branch skill: the branch merges to `main` only after the owner has seen the deviations list at the top of this plan.
