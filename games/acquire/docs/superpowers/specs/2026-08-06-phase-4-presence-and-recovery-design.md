# Phase 4 — presence and recovery

**Date:** 2026-08-06
**Status:** Approved design, pre-implementation
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](./2026-07-31-react-app-revamp-roadmap-design.md), Phase 4
**Predecessor:** [2026-08-05-phase-3b-carry-forward.md](./2026-08-05-phase-3b-carry-forward.md)

## Purpose

Make a game survive the three things that end one today: a page refresh, a dropped socket, and a
server restart. Presence stays orthogonal to game state — the game simply waits — but it stops
waiting *silently*, which is the part players actually complain about.

## What already exists, and what does not

Verified against the tree, not assumed.

| Working today | Evidence |
|---|---|
| A drop resets the join guard and re-sends the stored identity when the socket returns | `src/net/useRoom.ts:64-80`, `:141-163` |
| A rejoin must present a matching token, or it is refused | `server/rooms.ts:61-70` |
| A disconnect flips `connected` and re-broadcasts the roster | `server/index.ts:303-317` |
| A drop clears a stuck `pending` in the session | `src/net/NetworkSession.ts:208-212` |
| The lobby shows who is present | `src/game/online/RoomLobby.tsx:35` |

| Missing | Evidence |
|---|---|
| A restart loses every room — the save carries no roster and no tokens, and nothing reads it back | `server/persistence.ts:1-11`, `:26-30`; `loadAllGames` lost its only caller in 3a |
| In game, a dropped player is invisible — the roster's `connected` reaches no screen but the lobby | `grep connected src/` |
| A cold start looks identical to a two-second blip | `src/game/online/ConnectionStrip.tsx:20` |
| A room that is gone reads as `cannot join ABC123` | `server/index.ts:190-196` |
| No test drives a real remount, kills a live socket, or survives a restart | roadmap Phase 4; `clientOverWire.test.ts` opens real sockets and never drops one |

### The bug this phase must fix first

A socket that rejoins mid-turn is sent `reason: 'commit'` (`server/index.ts:209`), which
`sendState` resolves to `room.committed()` — the state at the *start* of the turn — while shipping
the open draft's `segmentStart` alongside it. The server's `GameSession` still holds the actor's
draft. So a player who refreshes after placing a tile gets the tile back in hand while the server
believes it was played, and their next intent lands on a state they cannot see.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Full recovery, including server restart. Durable rooms are in. |
| Where durable state lives | A file store now, behind an interface, swappable later. Render free's ephemeral filesystem is an accepted limit, not a thing to design around. |
| What a reconnecting actor gets | **Their draft back**, when the server still has it. After a restart there is no draft, so the same message resumes them at the last commit. |
| Presence in game | The seat dot the lobby already has, plus the actor's absence named where whose-turn-it-is now lives. |
| Cold start | The connection pill explains itself after a few seconds. No pre-warm fetch. |
| A room that is gone | Named as an ending, with a route back to the lobby. Distinguished on the wire from a refused seat. |
| Test harness | vitest, split by layer. No Playwright this phase. |
| Turn timeouts | Out, per the roadmap. The game waits indefinitely. |

## The server: durable rooms

### A store, not a save file

`server/persistence.ts` becomes `server/store.ts` behind a narrow interface:

```ts
interface RoomStore {
  save(record: SavedRoom): Promise<void>;
  loadAll(): Promise<SavedRoom[]>;
  remove(roomId: string): Promise<void>;
}
```

One implementation, `createFileStore(dir)`. The interface exists so that swapping in a backend that
survives Render is a config change rather than a redesign — **one implementation only**, with no
speculative second one written.

### What a record holds

```ts
interface SavedRoom {
  roomId: string;
  version: number;      // SAVE_VERSION 4
  savedAt: number;      // epoch ms, for eviction
  players: RoomPlayer[];  // id, name, token, isHost — the rejoin material
  state: GameState;     // committed only
}
```

Today's `{ roomId, version, state }` is unrestorable and the file's own header says so: no roster,
no tokens, so a restored game is one nobody could rejoin. `SAVE_VERSION` goes to 4. A version or
shape mismatch means the record is ignored and logged — never coerced into a shape the room cannot
drive.

### Restore at boot

`createRoomRegistry` gains `restore()`, called in `server/index.ts` before `listen`. Every restored
player comes back `connected: false`: presence is a fact about live sockets and is never persisted.

`createGameRoom` needs one fix alongside this. It derives `lifecycle` as `initial ? 'playing' :
'lobby'` (`server/room.ts:64`), so a finished game restores as still playing. It should read
`state.stage === 'end'` and come back `'over'`.

### Two things deliberately not restored

- **Lobby rooms.** `persist` already refuses to write them (`server/rooms.ts:93`). A room nobody has
  started is worth nothing.
- **Open drafts.** Only committed state is ever written, so a restart resumes everyone at the last
  segment boundary. This is the segment model's "uncommitted work was never real" stated as a
  storage fact rather than a behaviour to implement.

### Eviction

`restore()` skips and deletes any record whose `savedAt` is older than **7 days**, so the directory
does not grow without bound. Finished (`over`) rooms are restored rather than deleted: they are
small, and it keeps the door open for the library of finished games that
[the pass-and-play persistence decisions](./2026-08-06-pass-and-play-persistence-decisions.md)
record as wanted.

### Writes must be atomic and ordered

`deliver` calls `void rooms.persist(room)` fire-and-forget on every commit, and `writeFile` is not
atomic. Two rapid commits can interleave, and a crash mid-write leaves truncated JSON — which is
precisely the moment this phase cares about. The store writes to a temp file and renames, and
serialises writes per room through a promise chain.

## The wire and the client

### Resume is one new `StateReason`

`StateReason` gains `'resume'`, and the rejoin send at `server/index.ts:209` uses it instead of
`'commit'`. That is the whole fix for the draft bug. `sendState`'s existing rule —

```ts
const ownsDraft = reason !== 'commit' && playerId === room.actorId();
```

— then hands the reconnecting actor their open draft and everyone else the committed state, with no
new branch. `segmentStart` already comes from the draft, so state and segment finally agree.

`NetworkSession` rebuilds its inner session from whatever state arrives and clears the rejection on
any non-`reset` reason, so the stale `notConnected` that `connectionLost()` parked clears itself
when the resume lands.

After a restart the branch needs no special case either: the room is rebuilt from its committed
state, so its draft *is* that committed state until someone acts. The actor is handed a draft that
happens to equal the last commit, which is exactly "resume at the last segment boundary" without a
second rule to state or test.

### `previousSegmentStart` on the wire

`StateMessage` gains an optional `previousSegmentStart`, tracked in `room.commit()` as one number.
Without it, a refresh rebuilds `NetworkSession` from scratch with `previousSegmentStart` undefined,
and the step stack's read-only previous turn (Phase 5, `3e4c1f2`) is blank until the next commit.
Recovery that puts a player back where they were should include the turn they were reading.

### The client's reconnect is already written

`useRoom` resets its join guard on a drop and re-sends the stored identity when the socket returns;
`rooms.join` honours the token. After a server restart with rooms restored, that same path rebinds
the seat with **no new client code**. Phase 4's client work is therefore presence, copy, and tests.

### Presence in game

The roster already carries `connected` per player. `RoomPage` derives a
`presence: Record<string, boolean>` from it and passes it to `GameScreen`; omitted means everyone is
present, which leaves pass-and-play unchanged.

Two surfaces consume it:

- **`PlayersStrip`** gets the same dot the lobby has.
- **`TurnToast`** reads `Sam is up — disconnected` when the actor is absent.

The reason goes to `TurnToast` rather than the panel because Phase 5 deliberately removed the
panel's grey "Waiting for Alex" line and moved whose-turn-it-is to the toast
(`src/game/screen/useTurnPanel.tsx:141-157`). `TurnToast` is that line's successor, so putting the
absence there honours both decisions.

### Cold start

Render free sleeps after 15 minutes and takes ~30s to wake (`DEPLOYMENT.md:185`). Handling lives
entirely in `ConnectionStrip`: a timer started when status leaves `open`, flipping the copy after
~3s to **"Waking the server — this can take up to 30 seconds."**

`connection.ts` also pins its socket.io options explicitly rather than inheriting defaults. The
default 20s connect timeout is shorter than a 30s wake; what saves the connection is the retry, and
that should be stated in the file rather than assumed.

### The gone room

The server must tell two failures apart. `joinRoom` checks `rooms.get` first and rejects
`noSuchRoom`; a room that exists but refuses the seat or token rejects `seatRefused`. Both are new
`RejectionCode`s.

The two codes lead to different screens, because they have different remedies:

- **`noSuchRoom`** → a `gone` phase in `useRoom` (which already clears the dead identity,
  `src/net/useRoom.ts:112`), and `RoomPage` renders **"This room is no longer available"**, a line
  noting the game may have ended or the server restarted, and a button back to the lobby. Nothing
  the player can do reaches this room, so the screen is an ending.
- **`seatRefused`** → the existing `error` phase, unchanged. The room is still there; the stored
  identity was stale and has been cleared, so the remedy is to join it fresh. The copy should say
  that rather than repeating the gone-room ending.

A game lost to a restart reads as an ending rather than a fault, which is the only honest answer
while the file store is ephemeral on Render.

## Verification

### Zeroth: a pristine baseline — already clear

The 3b carry-forward handed Phase 4 an unresolved `ExperimentalWarning: localStorage is not
available…` on every `npx vitest run`, and this design was written expecting to clear it first.
**Checked before planning: it is already fixed.** `src/test/setup.ts` now installs the shim with an
unconditional `Object.defineProperty` — never reading the getter that fired the warning — and loads
for the jsdom project only. The fix landed after `cbe4a8d`, during Phase 5.

Measured on this tree, 2026-08-06: `npx vitest run` → **622 tests in 60 files, all passing, no
warning line**. `npx vitest run --project node engine/startups.test.ts`, the carry-forward's own
minimal reproduction, is also clean.

Phase 4 therefore starts from the pristine baseline the project's standard expects, and owes no
work here. The figure above is this phase's before-count.

### Test 1 — refresh mid-turn (jsdom)

Render `RoomPage`, reach an open segment, unmount, and remount **against a freshly built fake
connection** — not the same instance.

That last part is load-bearing. A real `F5` destroys the module-level socket `getConnection()`
holds, so a remount that reuses the same connection object models something a reload never does:
listeners already registered, status already `open`, no rejoin needed. (`closeConnection()` is not
the lever here — it acts on the module singleton, which `RoomPage`'s injected `connect` bypasses in
tests.) A fresh fake is the faithful stand-in, and `localStorage` surviving across the two mounts is
what makes it a rejoin rather than a first visit.

Assert the remount re-sends the stored identity, and that a `resume` carrying the draft restores
the open segment — the placed tile on the board, and the draft's `segmentStart`.

**Stated limit, in the test file:** a remount is not a reload. This is the one place harness A
approximates rather than reproduces, and the prod by-hand pass is what covers it.

### Test 2 — dropped and restored socket mid-turn (node)

Extends `server/clientOverWire.test.ts`'s pattern: two real `NetworkSession`s, the actor mid-segment,
`socket.disconnect()` then reconnect.

Assert: the roster went `connected: false` and back; the resume delivered the **draft**, not the
committed state; the next intent lands cleanly on the server's own state; and the other player
received nothing across the whole sequence.

That last assertion needs its own home. `resume` widens where drafts travel, so
`server/projectionOverWire.test.ts` gains a resume case as the privacy oracle — `clientOverWire` is
a consistency oracle (both sides move through the same `project`) and would not notice a leak.

### Test 3 — server restart with a game in progress (node)

Boot, play to a commit, close the http server, boot a fresh one against the same store directory —
a temp dir, not `server/games/`, which is gitignored but is still the real one. Let both clients
reconnect on their stored tokens; assert they land on their own seats with the last committed state.

**The paired negative:** with the store empty, the same reconnect produces `noSuchRoom` rather than
a silently-new seat.

### Each test ships with a named break

The 3b carry-forward's standing finding is that "the client received X / nobody heard Y" is exactly
the claim this codebase gets wrong on first attempt — four of its eight hollow gates are that shape.
Every test above ships with a break that must turn it red, and absence assertions follow the
eight-run rule established in 3a.

### Then the same three by hand, on prod

Said plainly up front so it does not read as a failure: **on Render free the restart pass is
expected to end at the gone-room screen.** The ephemeral filesystem is the accepted trade. What that
pass proves is the honest ending, not durability.

## Risks

- **The store interface inviting premature abstraction.** One implementation, no second backend
  written on spec.
- **Save files now contain rejoin tokens.** `server/games/` staying in `.gitignore` is a security
  property, not housekeeping. Tests write to a temp dir.
- **`restore()` runs before `listen`.** Bounded by the 7-day eviction; a large directory would
  otherwise delay the port opening.
- **`resume` widens draft delivery.** Covered by the `projectionOverWire` resume case above; without
  it, the privacy guarantee would rest on a consistency oracle that cannot see a leak.

## Out of scope

- **Turn timeouts** — the roadmap's own ruling. The game waits indefinitely.
- **The two-browser full game to final scoring**, still owed from 3b, including a merger's
  liquidation queue reaching a second player's screen.
- **Pass-and-play persistence** — its own decisions doc and its own design pass.
- **A Playwright harness** — deferred with the full-game pass it would also serve.
- **Spectator mode and the phone view** — roadmap, their own design pass.

## Done when

- A player who refreshes mid-turn resumes with their open segment intact.
- A player whose socket drops and returns mid-turn resumes with their open segment intact, and no
  other player saw any of it.
- A server restarted with a game in progress comes back with the roster, the tokens and the last
  committed state, and both clients rebind their own seats without re-entering anything.
- A room the server does not have says so, by name, with a way back to the lobby.
- A dropped player is visible on the seat and named in the toast when the game is waiting on them.
- A cold start says what it is doing.
- `npx vitest run` is still clean — it already is, at 622 tests in 60 files — and each of the three
  recovery tests has been shown to fail against a named break.
