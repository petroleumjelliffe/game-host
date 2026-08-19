# Phase 3a — Server authority

**Date:** 2026-08-05
**Status:** Approved design, pre-implementation
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](./2026-07-31-react-app-revamp-roadmap-design.md)
**Predecessor:** [2026-08-04-phase-2b-carry-forward.md](./2026-08-04-phase-2b-carry-forward.md)

## Purpose

The server stops being a mailbox for client-computed states and becomes the authority. It owns the
game, runs the engine, projects per recipient, and broadcasts only committed segments.

Phase 3 as the roadmap wrote it is larger than 2a and 2b combined, so it is split. **3a is the
server**, provable headlessly. **3b is the client** — a networked session behind the interface
`GameScreen` already consumes, `/room/:roomId` on the new component layer, and the deletion of
`Game.tsx` and its six modals.

**3a ships with no client.** Its entire deliverable is a server proven by tests. This is stated
first because it is the phase's defining constraint, and the source of its one real risk.

## What is broken today

Verified against the merged tree, not assumed.

| Finding | Evidence |
|---|---|
| **The client is the authority and the server is storage.** Two handlers accept a `newState: any` from the client and persist whatever arrives. Any connected socket can write any game state. | `server/index.ts:289` (`tilePlacement`), `server/index.ts:321` (`stateUpdate`) |
| **Identity is self-asserted.** Validation compares `action.playerId` to the current player, and `action.playerId` is whatever the client typed. Nothing binds a socket to a player. | `server/playerAuth.ts:26` |
| **There is no projection.** Every client receives the full `GameState` — `bag`, `seed`, and every other player's `hand`. Hidden hands are a client-side courtesy, and the seed alone reconstructs the entire bag order. | `server/index.ts:60`, `io.to(gameId).emit("gameState", gameState)` |
| **`playerAuth.ts` is a worse duplicate of `engine/actor.ts`.** `validatePlayerTurn` reads `players[turnIndex]`; `validateLiquidationAction` reads `shareholderQueue[currentShareholderIndex]`. That is `getCurrentActor`, written twice — and the `server/` copy does not know the `draw` or `end` stages. | `server/playerAuth.ts:20`, `:91` vs `engine/actor.ts` |
| **The XState layer models what the engine already owns.** 874 lines across four files whose states mirror `GameState.stage`. The roadmap's own diagnosis: "conflating the two is what made the current machine redundant." | `server/machines/gameRoomMachine.ts` (384), `playerMachine.ts` (136), `machines/types.ts` (66), `gameManagerXState.ts` (288) |
| **Server tests run in jsdom.** `vite.config.ts` puts `server/**/*.test.ts` in the `app` project. The config's own comment explains why that is wrong for `engine/` — "a stray `window.` is a production crash, but under a single jsdom suite `window` always exists and no test can ever catch it" — and then does it to the server. | `vite.config.ts`, `projects[1].include` |

## Findings that shrink the phase

Three things the roadmap expected 3a to build turn out to exist already. Each was checked in the
tree, not assumed, and each removes work rather than adding it.

**Turn-ownership and legality validation are already in the engine.** `doPlaceTile`,
`doBuyShares`, `doEndTurn` and `doDeclareEnd` all call `requireCurrentPlayer`, and
`doLiquidate` (`engine/intents.ts:165`) checks `shareholderQueue[currentShareholderIndex]` instead,
because the liquidator is not the turn player. All of it rejects with `notYourTurn`, and all of it
is pinned by golden games. The server gets validation by calling `applyIntent`; it does not
implement it.

**The component layer reads exactly one private field.** A grep across `src/game/` for `bag`,
`seed` and `hand` returns a single non-test hit: `GameScreen.tsx:71`, `hand={viewer?.hand ?? []}`.
So a projection that keeps `GameState`'s shape and blanks the private fields renders through the
existing components unchanged. Projection needs no new type, and 3b needs to touch no component to
consume one.

**Bag access is confined to three intent handlers.** `tradeInDeadTiles` (`intents.ts:324`),
`endTurn` (`:261`) and `startGame` (`:395`). The other six intents — `placeTile`,
`chooseFoundingBrand`, `chooseSurvivor`, `liquidate`, `buyShares`, `declareEnd` — are pure
functions of state a projected client already holds. This is what makes the optimistic client
possible, and it is the single claim this design most depends on. Test 5 proves it before anything
is built on it.

## Decisions

| Decision | Choice |
|---|---|
| Phase shape | **Split.** 3a is the server, headless. 3b is the client. |
| Who computes a move | **The client, optimistically; the server, authoritatively.** The client never blocks on a round trip. |
| Where uncommitted work lives | **Both sides.** The client holds a local draft so clicks paint immediately; the server holds the same draft and stays the authority. |
| What other players see | **Nothing, until the segment commits.** A property of what the server *sends*. |
| State machine | **Deleted.** The engine's `stage` and `getCurrentActor` are the model. |
| Identity | **Bound at join.** The wire carries no `playerId`; the server fills it in from the socket. |
| Old protocol | **Deleted outright.** No compatibility layer. `/room/:roomId` is dead until 3b. |
| Segment logic | **Promoted to a top-level `session/`,** imported by both sides. |
| Verification | **Real socket.io, in-process, inside `npx vitest run`.** |
| Persistence | **Kept,** committed state only. Strengthened later if unfinished games matter. |

## The room, and the life of an intent

A room is a plain object: a roster, a `GameSession`, a committed `GameState`, and a lifecycle
string. No state machine. The lifecycle has exactly two transitions — `lobby → playing` on
`beginGame`, and `playing → over` when a commit lands on `stage: 'end'`. The host is the roster's
first player, as it is today.

The session's current state is the **draft** — the open segment's work in progress. The committed
state is what the table has seen. When an intent arrives on a bound socket:

1. The server fills in `playerId` from the socket binding and hands the intent to
   `session.dispatch`.
2. **Rejected** → only the sender hears anything: a `RejectedMessage`, and a `StateMessage` with
   `reason: 'reset'` carrying its authoritative draft to snap back to.
3. **Accepted, segment still open** → **no message is sent at all** — not an ack, not a receipt.
   The client already painted this frame itself, and test 5 is what entitles it to. Silence is the
   common path.
4. **Accepted, and it drew tiles mid-segment** → only `tradeInDeadTiles` can do this. The sender
   receives a correction carrying the replacements.
5. **Accepted, segment closed** → the draft becomes committed, and every player receives their own
   projection of it.

Nobody but the actor receives anything during steps 2–4.

**Undo is guarded here, not in `GameSession`.** `GameSession.undoTo` performs no authorization —
correctly, because pass-and-play has one device and one brain. The room must therefore check both
that the sender is the current actor and that `stepId` appears in `view.undoableSteps` before
rewinding. An unguarded `undoTo` on the server would let any player rewind anyone's turn.

## Segments across a merger

A merger changes actor mid-turn and hands control back afterwards. This works without
merger-specific code, and the reason is worth stating because it is not obvious.

| Segment | Actor | Closes when |
|---|---|---|
| place tile → choose survivor | active player | the first liquidator must act |
| liquidation | each shareholder, in queue order | that liquidator confirms |
| buy → end turn | **the active player again** | the turn passes |

Every boundary is an actor change, which `getCurrentActor` already reports — including the hard
one, where it reads `shareholderQueue[currentShareholderIndex]` rather than `turnIndex`.
`syncSegment` acts on it today.

Two properties fall out for free. A placement **commits the moment someone else must act**, so a
merger cannot be undone after a liquidator has moved. And when the active player returns for the
buy segment, `segmentStart` has reset a second time, so their undo cannot reach back across the
liquidations either.

### A payout can precede its commit

An earlier draft of this design claimed that a merger moving another player's money always changes
the actor, and therefore always commits — so no one else's cash could sit unbroadcast in a private
draft. **That claim is false.** It was checked against all seventeen golden games before this
document was finalised, and every merger game violates it. Two independent reasons:

- `gameLogic.ts:711` builds the queue **"starting from current player"**. When the acting player
  also holds absorbed shares they are at the head of it, so the actor does not change and the
  segment stays open.
- The queue is built for `absorbedIds[0]` only. In a multi-chain merger (G7) a player is paid a
  bonus for the *second* absorbed chain while the current queue holds only the first chain's
  shareholders — so the recipient is not even in the queue yet.

Measured over the corpus: **5 steps move a non-actor's cash, and a payout precedes its commit by up
to 2 intents.**

**What is actually true**, and what the design relies on instead: every recipient holds absorbed
shares in some chain, so they are seated in that chain's queue before the merger completes. **The
commit that reveals the money is the same commit that asks them to act on it.** Nobody is ever
asked to decide on stale figures.

The cost is honest and is accepted rather than fixed: for up to two intents, a watching player's
board does not move and their cash is out of date, while someone else liquidates. The alternative —
making "another player's cash moved" a second commit trigger — would buy a live board at the price
of a second commit rule, and would forbid the acting player from undoing a merging placement, which
pass-and-play allows today. One rule is worth more than two intents of latency.

Two tests hold this in place: the guarantee (test 6) and the measured bound (test 8), the latter
pinned so that an engine change which widens the window is noticed rather than absorbed.

The two mergers that do *not* close a segment — nobody holds absorbed shares, or only the active
player does — pay nobody but the active player. Those stay in the draft and stay undoable, which is
the intended experimentation.

## Projection

One pure function, applied at the moment of sending:

```ts
export function project(state: GameState, forPlayerId: string): GameState;
```

It blanks `seed`, empties `bag`, empties every `hand` but the recipient's, and drops `socketId`.
Everything else passes through unchanged.

**Never cached, never computed early.** A projection computed correctly and then broadcast
unprojected is the single defect this phase most needs to catch, which is why test 2 reads the
payload a client actually *received* rather than the function's return value.

Two consequences, named here rather than discovered later:

- **`discarded` stays public.** Traded-in dead tiles are shown at a real table, and the deduction
  they permit is legitimate.
- **An empty `bag` means no client can show "tiles remaining."** Nothing does today. Adding a
  `bagCount` field later is a one-line change, so it is not added now.

## The wire protocol

Types live in `session/protocol.ts` — shared, because 3b's client speaks the other half.

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The wire has no `playerId` to lie in; the server fills it from the socket binding. */
export type WireIntent = DistributiveOmit<Intent, 'playerId'>;
```

Deriving `WireIntent` from `Intent` means a new engine intent updates the wire type automatically,
rather than silently failing to.

**Client → server:** `createRoom { name }`, `joinRoom { roomId, name, playerId?, token? }`,
`beginGame {}` (host only), `intent WireIntent`, `undo { stepId }`.

**Server → client:**

```ts
export interface StateMessage {
  state: GameState;                              // projected for this recipient
  reason: 'commit' | 'correction' | 'reset';
  segmentStart: number;
}
export interface RejectedMessage { code: IllegalIntentCode; message: string }
export interface JoinedMessage   { roomId: string; playerId: string; token: string }
```

`reason` exists so the tests can assert on it: test 4 is precisely "B never receives a
`correction`."

`beginGame` creates the initial `GameState` with a server-chosen seed and lands on `stage: 'draw'`.
The turn-order draw itself is then the ordinary `startGame` intent from seat one, exactly as in
pass-and-play. The lobby event is named `beginGame` rather than `startGame` to keep the two
distinct.

## Identity

The server maps socket → playerId when a player joins a room, and issues a token which the client
stores. Rejoining presents the token. Because the wire type carries no `playerId`, impersonation is
unrepresentable rather than rejected.

This is what makes projection a boundary rather than a decoration: if a client could claim to be
another player at join, the server would project that player's hand to the wrong socket, and the
hidden-hand guarantee would be gone. The interesting parts of reconnection remain Phase 4's.

## Structure

```
session/GameSession.ts        moved from src/game/session/ — imported by both sides
session/GameSession.test.ts   moved; runs in the node project
session/protocol.ts           new — wire types
server/room.ts                new — roster, session, committed state, commit detection
server/rooms.ts               new — the registry (absorbs roomManager)
server/projection.ts          new — project(state, forPlayerId)
server/index.ts               rewritten — transport wiring only
server/types.ts               trimmed — see below
server/persistence.ts         kept; saves committed state, never drafts
```

**Deleted:** `server/machines/gameRoomMachine.ts`, `server/machines/playerMachine.ts`,
`server/machines/types.ts`, `server/gameManagerXState.ts`, `server/playerAuth.ts`,
`server/roomManager.ts`, `server/test-client.js`, `server/test.html`, and
`server/engineSpike.test.ts` — whose own header says "delete this file when the real
server-authoritative loop lands." The `xstate` dependency leaves `package.json`, since those four
files are its only users.

`server/types.ts` loses most of itself. `WaitingRoom` and `RoomPlayer` become the room's roster;
`MultiplayerGameState` restates three fields that are already optional on `GameState` and goes; and
`GameAction`, whose `payload: any` is the untyped hole 3a exists to close, is replaced by
`WireIntent`.

`src/game/session/useGameSession.ts` stays where it is — it is the React binding and nothing else.

`SessionView` gains one field, **`segmentStart: number`**, so the room can observe a commit
boundary it currently computes privately. 3b wants it too.

## Persistence

Kept, and simpler under the new model: one committed `GameState` per room, saved on each commit.
**Drafts are never written.** That is the roadmap's Phase 4 rule — "uncommitted local staging is
discarded on reconnect" — restated as a storage fact rather than a behaviour to implement.

`SAVE_VERSION` is bumped, which discards existing saves. That is acceptable: nothing in progress
matters.

The limit, stated plainly: Render's filesystem is ephemeral, so this survives an idle spin-down but
**not a redeploy**. It is not durability. Strengthening it for unfinished games is deferred.

## Testing

`vite.config.ts`'s `engine` project widens to cover `server/**/*.test.ts` and `session/**/*.test.ts`
under `environment: 'node'`, for the reason the file already articulates about `engine/`. This is
not optional bookkeeping: after the move, `session/GameSession.test.ts` matches neither `engine/**`
nor `src/**`, so without the config change it would silently stop running.

Against a real socket.io server on port 0, with one bound client socket per player:

| # | Assertion |
|---|---|
| 1 | **G1–G17 replayed over sockets** reach their golden terminal states. |
| 2 | **What B's socket received** contains no `seed`, no `bag`, and no `hand` but B's. |
| 3 | **An intent from the wrong socket is rejected**, and impersonation is unrepresentable — the wire type has no `playerId`. |
| 4 | **While A is mid-segment, B receives nothing** — no message with `reason: 'correction'` ever reaches a non-actor. |
| 5 | **`applyIntent` on a projected state equals `applyIntent` on the full state** for the six non-drawing intents, and rejects with the same code where the golden game expects a rejection. |
| 6 | **No player is asked to act on stale money** — replaying the goldens through the room, whenever the actor becomes P, the last state broadcast to P carries P's current cash. |
| 7 | **Undo is refused** below `segmentStart` and from a non-actor. |
| 8 | **A payout precedes its commit by at most 2 intents**, pinned as a regression guard on the window described above. |

**Test 5 was run before this design was finalised** — a throwaway probe over all seventeen golden
games, using the `project` implementation above. Result: **42 predictable steps, 0 mismatches.** The
optimistic model holds. Task 1 rebuilds it as a real test rather than trusting this paragraph; the
number 42 is a useful floor for catching a harness that silently checks nothing.

**Every one of these must be observed failing before it is trusted.** Async socket tests fail
vacuously in a way synchronous ones do not — an assertion inside a listener that never fires is a
passing test. This project has shipped three gates that guarded nothing (`check:bundle` in 1a, and
`verify:layout` twice in 2a); the rule from those phases applies unchanged.

## Scope

**In:** the room, the wire protocol, projection, socket binding and rejoin tokens, persistence of
committed state, the deletions above, the test suite, the vitest project split.

**Out, and going to 3b:** every client — the networked session, `/room/:roomId` on `GameScreen`,
the lobby pages, and the deletion of `Game.tsx` and the six modals.

**Out, and going to Phase 4:** reconnection, presence, Render cold-start handling, durable
persistence.

**Untouched:** `engine/` (no engine change is expected; if one proves necessary, that is a finding
worth writing down, not a routine step), `src/components/`, `src/Game.tsx`, `prototype/`. `src/game/`
is touched only by the `session/` move and its import updates.

## Cutover

The old protocol is deleted outright. There is no compatibility layer, and `/room/:roomId`,
`CreateRoomPage` and `JoinRoomPage` all stop working until 3b — they speak the protocol 3a removes,
and `Game.tsx` is off-limits.

`.env.production` points the gh-pages build at `https://acquire-multiplayer.onrender.com`, so an
already-open tab against that instance breaks the moment 3a deploys. Accepted: nothing is being
played, and no game in progress matters. Whatever is live gets overwritten.

## Verification

Phase 3a is done when:

- The server runs `applyIntent` and no handler accepts a client-computed state.
- Every one of the eight assertions above passes, and each has been observed failing.
- `xstate` is absent from `package.json`, and the four files that used it are gone.
- `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle` and
  `npm run verify:layout` are green. Pass-and-play is unchanged and still passes its own gates.

## Risks

**3a has no by-hand pass, because there is nothing to open.** That step has found something in
every phase so far, including defects that four green gates and 363 tests missed. Seven socket
assertions do not replace it. The mitigations are real but partial: 3a's surface is genuinely
headless and mechanically checkable in a way a layout never was, and 3b's by-hand pass will
exercise all of it. But 3a ships with less assurance than 2a or 2b did, and that is the price of
the split.

**The optimistic client is specified here and exercised in 3b.** The protocol could be subtly wrong
in a way that only a real client reveals — a missing correction, a state the client cannot
reconstruct. Test 5 covers the reducer half of that claim; the transport half waits for 3b.

**Test 5 has already been run and passes** (42 predictable steps, 0 mismatches, all seventeen golden
games). This risk is discharged, and the fallback it guarded against — reverting to server
round-trips — is not needed.

**A stated invariant in this design was measured and found false**, and the section above records
the correction. That is worth noting as a process fact: the claim was plausible, derived from real
line numbers, and wrong, and only running it over the corpus exposed it. Any remaining reasoning in
this document that has *not* been executed should be read with that in mind.

**The `session/` move churns imports across `src/game/`.** Mechanical, and the typecheck catches
every miss, but it touches files this phase otherwise has no business in.
