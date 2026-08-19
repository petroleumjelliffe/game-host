# Online mode — design

**Date:** 2026-08-14
**Status:** approved by the owner (this conversation); implementation not started
**Why:** playtesting on multiple machines. Pass-and-play needs everyone around one
tablet; the owner wants two real machines on the internet driving one game.

## What already exists, and why this design is small

Three earlier decisions did most of this work in advance:

- **The game is an event log.** `src/state/events.ts` records what happened — dice
  faces included — and `replay()` in `src/state/game.ts` is a pure fold over it.
  The comment on `GameEvent` has said since it was written that replay-not-reroll
  "is what a server-authoritative version would need". This design is that
  sentence, cashed in.
- **The lobby is a submodule with an unused server half.** `vendor/lobby/server/`
  carries rooms, seating, tokens, join/rejoin/reclaim, presence and roster
  broadcast, generic over the game via `LobbyRoomLike`. Rail Baron consumes only
  `protocol/` and `client/` today; its tsconfig excludes `server/` because there
  was no server to put it in.
- **Boards 1d/1e/1f are designed and approved** (online lobby, new room, join
  room — the *Rail Baron Game Board Design* project). `lobbyView` was built to
  feed exactly them: a seat becomes a row, empty seats included, the share link a
  row, Begin a row that is dim until `canBegin`, each terminal state a
  `ScreenDef`.

## Rulings

| Question | Ruling |
|---|---|
| Reach | **Internet, deployed.** LAN dev comes free (the dev server already binds the LAN hostname). |
| Hosting | **Rail Baron's own Render service, plan `starter`, with a disk.** Mirrors Acquire exactly — durable rooms, no spin-down, each repo deploys itself. Sharing Acquire's process was rejected: it crosses the repo boundary the lobby lift just built. |
| Authority | **The server is authoritative over the log, not the dice.** The acting client rolls locally, exactly as today; the server validates and serializes appends. A client could fabricate a roll — accepted; the trust boundary is honesty about dice among friends, never game integrity. |
| UI scope | **Full boards 1d/1e/1f**, not a bare-bones join. No throwaway UI. |
| First-player roll | **Any seated player** may tap it. It is a shared ceremony, not an action by someone; the server accepts the first `orderRolled` and rejects a second. |
| Undo online | **Only the seat whose action would be popped** may undo. The server knows whose that is — it is the last event's seat. Anyone-can-undo was rejected: a bystander could yank the actor's turn mid-announcement. |

### Rejected approaches

- **Intent wire, Acquire-style** (server runs a reducer, projects per player).
  Acquire needs it because it has hidden information and server-rolled outcomes.
  Rail Baron has neither — every fact is public — so this would build a reducer
  that does not exist today to solve problems the game does not have.
- **Dumb relay** (serialize and persist appends, never validate). ~50 fewer
  lines, but a buggy client writes a log that validation later rejects
  wholesale — the silent-empty-board failure `isGameEvent` exists to prevent.
  Validation costs one `replay()` per append.

## Architecture

The log is the wire. One sentence per direction:

- A client commits an action by sending the resulting `GameEvent`; the server
  validates it, appends it, persists, and broadcasts the full log.
- Every client's state is `replay(log)` of the last broadcast, exactly as
  pass-and-play's is `replay` of localStorage.

### 1. Server process — `server/` (new, in this repo)

Express + Socket.io, on Acquire's skeleton but much smaller. `createLobbyRegistry`
from `vendor/lobby/server/` with the `SeatSpace` `{ ids: SEATS }` — the lobby's
seat ids **are** the game's colours, so there is no mapping layer anywhere. The
room payload is one field beyond what the lobby holds: `log: GameEvent[]`.

Consequences for the build:

- `package.json` gains `socket.io`, `express`, `cors` and a `dev:server` /
  `dev:all` pair on Acquire's pattern.
- tsconfig and the vitest node project gain `vendor/lobby/server/**`. **Each
  consumer includes only what it uses** (the lobby README's rule) — this is the
  moment Rail Baron starts using the server half.
- A `build:server` guard that fails loudly when the submodule is empty, copied
  from Acquire — `tsx` compiles nothing at build time, so without it a bare
  clone gives a green build and a boot crash.

### 2. Protocol — game messages beside the lobby's

Lobby messages come from `vendor/lobby/protocol` unchanged. The game adds three,
in a new `session/protocol.ts` (node-safe, imported by both sides, mirroring
Acquire's layout):

- `append { event: GameEvent }` — client → server. Accepted only if **all** hold:
  1. `isGameEvent(event)` — the same structural gate `loadLog` uses;
  2. the sending socket's seat equals `event.seat` — no acting for another
     colour (`orderRolled` is the one exception: any seated socket may send it,
     per the ruling, and its `seat`/`first` fields are still validated);
  3. replaying `log + [event]` is legal for whose turn it is — the same guards
     `useGame` applies (`nextHomeSeat` during homes, `state.turn` in play, one
     `started`, one `orderRolled`, `bonusOwed` for `bonusRolled`). These guards
     move from being closure checks inside `useGame` into functions the server
     can call; `useGame` keeps calling them too.
  A rejected append gets a refusal message naming which of the three failed;
  the client's recovery is the next `log` broadcast (it is always right).
- `undo {}` — client → server. Server runs the existing `undo(log)` truncation
  iff the requesting seat is the last event's seat. No new undo logic.
- `log { events: GameEvent[] }` — server → every seat after any change, and to a
  joiner/rejoiner on arrival. **Full log every time.** A late-game log is tens
  of KB at playtest scale; incremental sync is machinery for a problem this
  game does not have yet. The full broadcast is also self-healing: a client
  that missed anything is fixed by the next one.

`RB_PROTOCOL_VERSION = 1` rides the wire from the first deploy, and `/health`
reports it — Acquire's version-skew lesson, adopted before it can hurt. Skew
gets its own refusal code and a stale-client screen.

### 3. Begin, homes, first player

Pressing Begin fires the lobby's `onBegin`, and **the server seeds the log
itself** from the roster: one `joined` per seated colour (names from the lobby —
nobody re-enters anything), then `started`. From there the homes phase runs as
built: each player rolls their own home **on their own machine**, gated by
`nextHomeSeat` — the same each-actor-draws-their-own ceremony Acquire's
turn-order draw landed on. The first-player roll is one tap by anyone seated,
producing one `orderRolled`.

### 4. Client — `src/net/` (new, in this repo)

`useOnlineGame(connection)` returns **the same surface as `useGame`** — `state`,
`roll`, `commitRoll`, `chooseRegion`, `rollDice`, `commitDice`, `rollBonus`,
`commitBonus`, `commitMove`, `rollOrder`, `undoLast` — so the board and map
components never know which mode they are in. Inside:

- `events` is the last `log` broadcast; `state = replay(events)`.
- Every `commit*` emits `append` instead of `setEvents`. **No optimistic
  apply**: the roll→announce→commit gates already put all the theatre
  client-side, so the round-trip lands during the announcement animation.
- The roll/commit split survives intact and matters *more* online: the outcome
  is announced on the actor's machine before any event exists, so the other
  machines learn it only when the log does — the gate becomes a privacy
  boundary for free.
- `undoLast` emits `undo`. There is no online `reset` — leave the room and make
  a new one (two clicks; YAGNI).
- `rename`: the lobby already owns naming; in-game rename is out of scope
  online (the `renamed` event stays valid for replay of pass-and-play logs).

Identity and connection come from `vendor/lobby/client`:
`createIdentityStore('railbaron')`, `createLobbyConnection`, `useLobbyRoom`, with
a `useRoom`-style phase machine (`connecting → joining → lobby → playing`, plus
`error`, `gone`, `stale`) on Acquire's `src/net/` pattern.

### 5. Lobby boards 1d/1e/1f

Rendered from `lobbyView` in the split-flap `Row`/`ScreenDef` model:

- **1d online lobby**: a row per seat — all six colours, empty ones included
  (which is exactly why `lobbyView` sends empty seats) — plus the share-link
  row and the room code.
- **1e new room**: creates and seats immediately (no name form — the Lobby Flow
  correction, already the shared server's behaviour: an unnamed seat gets
  `defaultName`).
- **1f join room**: code entry; carries the optional name field from the
  approved design, which is also the fix shape for the shared repo's
  `RoomRefused` dead end (acquire#14) — building it here builds the evidence
  for fixing it upstream.
- Each terminal state — room gone, stale client, refused — is its own
  `ScreenDef`, not a toast.

### 6. Persistence

A file store on Acquire's `store.ts` pattern, simplified: the record is
`{ id, players (with tokens), log }` plus `RB_SAVE_VERSION = 1`. Written on
**every append** — each event is a commit; Rail Baron has no draft/segment
concept to wait for — and restored at boot **before `listen`**, every seat
forced disconnected, exactly as Acquire's `rooms.restore()` does. Same known
trade-offs, accepted: `save()` is best-effort and silent; version covers the
record shape, not deep `GameEvent` validity — though here `isGameEvent` over the
loaded log is cheap and runs at restore, so a stale-shape log **skips the room
with a logged reason** rather than booting a room that replays to an empty
board.

### 7. Deploy

- New Render web service, plan **starter**, with a 1 GB disk at `/var/data`;
  `GAMES_DIR=/var/data/games`, `PORT`. Auto-deploy on commit, and **verify the
  first deploy fired** via the deploy list, not by polling `/health` (the
  Acquire lesson: `/health` cannot tell "still building" from "never started").
- `/health` reports `{ ok, protocolVersion, saveVersion }` from day one.
- Client stays on GH Pages; `VITE_SERVER_URL` points at the service, defaulting
  to `http://<hostname>:3001` in dev so a LAN machine works.

### 8. Testing

Rail Baron adopts Acquire's **two-project vitest split** — `node` for `engine/`,
`session/`, `server/` and `vendor/lobby/{protocol,server}`; `app` for `src/`
under jsdom — plus the `nodeEnvironment` boundary test, because the server code
runs in a real node process in production and a stray `window.` there is a boot
crash jsdom would never catch. No root-level `setupFiles` (vitest 4 merges them
into both projects, disarming the boundary).

The keystone: **golden-over-sockets**. Every `engine/golden/` game's events are
driven through `append` on a real socket, and the broadcast log must replay to
the same final state — the executable rules spec doubling as the protocol test,
exactly as `server/goldenSocket.test.ts` does in Acquire.

Also pinned, each proven able to fail before trusted:

- out-of-turn `append` rejected; wrong-seat `append` rejected; second
  `orderRolled` rejected; `bonusRolled` when none owed rejected;
- `undo` from a non-actor seat rejected; a granted undo truncates the whole
  turn (four events when a bonus leg followed);
- kill the server, reboot against the same store, both clients resume the same
  mid-turn state (Acquire's `recovery.test.ts` pattern);
- version skew refused with its own code.

And the gate no suite replaces: **a by-hand pass in two real browsers on two
machines**, through a full game, before online mode is called done. Every phase
of Acquire found its real bugs there and only there.

## Deliberately not included

- **Optimistic apply** — the announce animation absorbs the round-trip; add
  only if a real pass shows visible lag.
- **Incremental log sync** — full-log broadcast until a measured log is big
  enough to matter.
- **Server-rolled dice / anti-cheat** — the trust model is friends playtesting.
- **Online reset / rematch** — leave and recreate.
- **Spectators** — same open question as Acquire's; its own design pass.
- **In-game rename online** — the lobby owns names now.
- **A dev seeding route** (`POST /dev/rooms`, Acquire's) — wanted eventually,
  but it belongs with the scenarios work
  ([2026-08-13-scenarios-design.md](./2026-08-13-scenarios-design.md), still on
  its docs branch): a seeded online room is a scenario log adopted into a room,
  and building the seeder before scenarios exist would invent its own fixture
  format. When both exist, the seeder is small.

## Sequencing note

The scenarios spec predates the merge of turns-and-movement and of the
`engine/golden/` layer; it must be re-read against what landed before its plan
is written. Online mode does not depend on it and can go first — which also
gives scenarios' seeding route a second consumer when it arrives.
