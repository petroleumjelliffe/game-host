# Phase 3b — the networked client

**Date:** 2026-08-05
**Status:** approved, not yet planned
**Branch:** `revamp/phase-3b-networked-client`, forked from `revamp/phase-3a-server-authority` @ `5d5be92`
**Worktree:** `.worktrees/phase-3b`
**Predecessor:** [2026-08-05-phase-3a-carry-forward.md](./2026-08-05-phase-3a-carry-forward.md)
**Server design:** [2026-08-05-phase-3a-server-authority-design.md](./2026-08-05-phase-3a-server-authority-design.md)
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](./2026-07-31-react-app-revamp-roadmap-design.md)

Phase 3a made the server the authority and shipped headless: no client speaks its protocol, and
no person has ever driven it. 3b builds that client. When it is done, two browsers play a game
against a real server through the Phase 1b component layer, the legacy modal UI is deleted, and
3a's guarantees have been exercised by hand for the first time.

The load-bearing observation is that `GameScreen` already takes a `GameSession` and calls
`dispatch`, `undoTo` and `reveal` through it. The networked client is therefore mostly a *second
implementation of that interface*, backed by a socket — not a second game screen.

## Decisions

| Question | Decision |
|---|---|
| Branch point | 3a's tip. Both branches stay unmerged until 3b's by-hand pass; they merge to `main` together. |
| Client model | Optimistic. Six of nine intents apply locally at once; the three that draw from the bag wait for the server. |
| Undo | A round trip. The server rewinds its own draft and answers with a `correction`. |
| Reconciliation | Server state is adopted wholesale. No merge, no diff, no replay. |
| Not-my-turn view | The full board with my own tiles, my cash and shares, live prices. The panel names who we are waiting on and offers nothing. |
| The curtain | Never shown online. `awaitingReveal` is pass-and-play's alone. |
| Turn-order draw | Stubbed at today's behaviour: the host presses the button once and the commit shows the whole table the result. The per-player draw is specified below as a follow-on. |
| Legacy UI | `src/Game.tsx`, all of `src/components/`, `src/context/`, and two `src/utils/` modules are deleted outright. |
| Reconnection | Out. A refresh rejoins with the stored token; anything beyond that is Phase 4. |

## Architecture

Three new units, one changed component, one deleted subtree.

```
src/net/
  transport.ts        RoomTransport — the four calls a session needs, and nothing else
  connection.ts       socket.io-client behind that interface; lobby calls; connection status
  identity.ts         per-room { playerId, token, name } in localStorage
  NetworkSession.ts   GameSession over the wire — the seam
  useRoom.ts          connect → join → lobby → playing, and the session it builds

src/game/online/
  RoomLobby.tsx       room code, roster, host-only start
  ConnectionStrip.tsx replaces ReconnectionBanner, scoped to the room screen
```

### `RoomTransport` — what a session may do

Deliberately narrower than a socket. A session can send two things and hear two things; it cannot
create rooms, join them, or read the roster.

```ts
export interface RoomTransport {
  sendIntent(wire: WireIntent): void;
  sendUndo(stepId: number): void;
  onState(handler: (msg: StateMessage) => void): () => void;
  onRejected(handler: (msg: RejectedMessage) => void): () => void;
  /** False while the socket is down; the screen goes inert rather than dropping intents. */
  isOpen(): boolean;
}
```

### `NetworkSession` — the seam

```ts
export function createNetworkSession(init: {
  transport: RoomTransport;
  playerId: string;
  initial: StateMessage;
}): GameSession;
```

It satisfies the existing `GameSession` interface exactly, so `GameScreen` cannot tell the two
apart. Internally it holds a real `GameSession` built from the last state the server sent, and
replaces it whenever a new one arrives. That reuse is the point: the optimistic path runs the same
`applyIntentWithHistory` the pass-and-play path does, so there is no second copy of the rules and
no second copy of the step stack.

Its rules, each of which a test pins:

1. **A predictable intent applies locally, then goes on the wire.** `placeTile`, `buyShares`,
   `chooseFoundingBrand`, `chooseSurvivor`, `liquidate`, `declareEnd`.
2. **A bag-drawing intent changes nothing locally.** `endTurn`, `tradeInDeadTiles`, `startGame` go
   on the wire and the client waits. A projected client holds no bag and structurally cannot
   predict the outcome.
3. **An intent the local state refuses never leaves the client.** The optimistic apply runs first;
   if it sets an error, the emit is skipped and the player sees the reason immediately. This is
   sound only because projection hides nothing those six intents depend on — own hand, board,
   portfolios, prices, cash and available shares are all visible — which is the equivalence 3a
   measured across 42 steps in 17 games. It is a filter, not a second rulebook: the server still
   decides, and a disagreement surfaces as a rejection.
4. **Server state is adopted wholesale.** `commit`, `correction` and `reset` each replace the inner
   session outright, along with the message's `segmentStart`.
5. **Undo emits and applies nothing.** The server owns the snapshot store that matters; its
   `correction` is what moves the client.
6. **`undoableSteps` is derived, not stored:** `segmentStart … state.nextStepId - 1` when the actor
   is me, and `[]` otherwise. The gate matters — an optimistic `liquidate` or a merger-triggering
   `placeTile` can hand the actor to someone else *without* a bag draw, and for the moment before
   the commit lands the client's `segmentStart` is a segment it no longer owns. Online you can only
   undo inside your own open segment, so "not the actor" means "nothing to undo".
7. **`awaitingReveal` is always false and `reveal()` is a no-op.** There is no device to pass.
8. **A rejection sets the error; the `reset` that follows must not clear it.** The server emits
   `rejected` and then a `reset` state, in that order, on the same connection. Adopting state
   normally clears the error — if it did so here, the rollback would arrive with no explanation.
   `commit` and `correction` clear it; the next accepted local dispatch clears it.

### `DRAWS` moves to `session/protocol.ts`

The three bag-drawing intent types currently exist as two hand-maintained copies that must agree
(`server/room.ts:54`, `server/projection.test.ts:64`), flagged in the 3a carry-forward. The client
needs the same set, which would make three. It becomes one exported constant in
`session/protocol.ts`, imported by all three. Adding a bag-drawing intent then cannot silently
break the correction path, narrow the equivalence proof, and mispredict on the client, each without
a test failure.

### `SessionView` gains one optional field

```ts
/** A bag-drawing intent is in flight. Pass-and-play never sets it. */
pending?: boolean;
```

Without it, a second tap on "End turn" sends a second `endTurn`, which the server rejects as
`notYourTurn`, and the player gets an error for pressing a button that was still on screen. While
`pending` is true the panel's action buttons are disabled.

### What changes in `GameScreen`

One new optional prop:

```ts
/** The player at this device. Absent in pass-and-play, where the viewer is whoever is acting. */
viewerId?: string;
```

- `viewer` becomes `viewerId ? players.find(viewerId) : actor` — with the existing draw-stage
  exception unchanged.
- The curtain renders only when `viewerId` is absent.
- `useTurnPanel(view, dispatch, canAct)` gains a third argument. When `canAct` is false the active
  zone keeps the stage's own label and reads `Waiting for {name}.` with no controls, and the
  staging zone is idle. `Board`'s `onCellClick` is omitted.

Pass-and-play passes no `viewerId` and no `canAct`, so its behaviour is unchanged by construction —
and its existing tests are the check on that.

Panel-height note: the active zone loses its buttons when it is not my turn. The zone reservation is
a floor, so this should move nothing, but it is a height change driven by a state transition and
therefore belongs in the by-hand pass and in `verify:layout`.

### Connection, identity and the room

`connection.ts` opens the socket **lazily, on online routes only**. Today's provider connects at
page load, which is why the catalog and pass-and-play once carried a "Disconnected from server"
banner across a game that has no server by design.

`identity.ts` stores `{ playerId, token, name }` under a per-room key, plus a remembered display
name. A refresh presents the stored `playerId` and `token` and gets the same seat back; without
them a fresh join takes a new seat, which the server allows only while the room is in `lobby`.

`useRoom.ts` owns the sequence: connect → `createRoom` or `joinRoom` → `joined` (identity stored) →
`roster` (lobby) → first `StateMessage` (build the `NetworkSession`, hand it to `GameScreen`). Its
status is one of `connecting | joining | lobby | playing | over | error`.

### Screens

| Route | What it does |
|---|---|
| `/online` | Create or join. Unchanged in shape, rewritten against the new protocol. |
| `/online/create` | Name → `createRoom` → navigate to `/room/<code>`. |
| `/online/join` | Code + name → `joinRoom` → navigate to `/room/<code>`. |
| `/room/:roomId` | `RoomLobby` until the server says `playing`, then `GameScreen` with `viewerId`. |

`RoomLobby` shows the room code large enough to read out loud, the roster with connected state, and
a **Start** button that only the host sees. `ConnectionStrip` reports a dropped socket inside the
room screen instead of as a fixed bar over every route.

## Data flow: one accepted intent

1. The actor clicks. `NetworkSession` applies it locally and the screen updates immediately.
2. The intent goes on the wire without a `playerId` — the server fills that in from the socket
   binding, so claiming to be someone else is unrepresentable.
3. The server runs `applyIntent` against its draft. Mid-segment it says nothing to anybody: no
   other client learns what is being tried.
4. When the segment closes, the server commits and projects the new state per player. Every client
   adopts. Non-actors see the whole move arrive at once — the board, the money and the log
   together, never a half-finished turn.
5. If a merger seats another player in the liquidation queue, that commit is also what hands them
   the actor role. They resume control with the same panel they already had, on figures that were
   published in the same message that asked them to act.

## Error handling

| Case | What the player sees |
|---|---|
| Local apply refuses | The engine's message in the panel, immediately. Nothing is sent. |
| Server rejects | The server's message in the panel; the state rolls back to what the server sent. |
| Socket drops | `ConnectionStrip` says so and the panel goes inert (`canAct` false). No intent is queued or dropped silently. |
| Room code not found, or the game already started and I hold no seat for it | A message on the join screen, not a hung request. |
| Server restarts mid-game | The room is gone. Known limit, stated below. |

## Tests

Every one is observed failing before it is trusted. Any assertion of the form "the other client did
not see X" is broken and re-run **at least eight times** with the failure count reported — the rule
3a adopted after a privacy check that fired 0 times in 8 runs while looking exactly like coverage.

1. **Optimistic apply.** A predictable intent moves the local state before any server message, and
   the transport received it.
2. **No optimism across the bag.** A bag-drawing intent leaves the local state untouched; the
   server's `correction` is what moves it. Break: apply it optimistically → mismatch.
3. **Local refusal is a filter.** An illegal intent sets the error and the transport receives
   nothing.
4. **A rejection survives its reset.** After `rejected` + `reset`, the state is the server's and the
   error message is still on screen.
5. **`undoableSteps`.** The full open-segment range when the actor is me; empty when it is not,
   including immediately after an optimistic intent that handed the actor away without a draw.
6. **`pending`.** True between a bag-drawing dispatch and the server's answer; the panel's buttons
   are disabled while it holds.
7. **Two clients, real socket.io, the golden corpus.** Two `NetworkSession`s over real sockets
   against the real server, replaying all seventeen golden games: each step dispatched on whichever
   client is the actor, and after every commit each client's state asserted equal to the server's
   projection for that player. Optimistic mismatches counted and pinned at **0**. This is the
   transport half of the optimistic-client claim, which the 3a design explicitly deferred to here,
   and it is the phase's centrepiece.
8. **jsdom screens.** `RoomLobby` renders the code, the roster, and a start button for the host
   only. `GameScreen` with a `viewerId` that is not the actor shows my own hand, no curtain, no
   controls, and the actor's name.
9. **By hand, in two browser windows, against a local server: a full game through to final
   scoring**, including a merger with a liquidation queue that reaches both players, an undo inside
   an open segment, and a refresh mid-game that rejoins the same seat. `npm run verify:layout` at
   768px and 1440px.

Test 9 is not a formality. It is the first time any part of Phase 3 will have been driven by a
person, and every phase of this project so far has found something there that the gates missed.

## Scope

**In:** `src/net/`, the two online components, the four routes, the `GameScreen`/`useTurnPanel`
change, the `SessionView.pending` field, the `DRAWS` consolidation, the deletions, the tests.

**Out — Phase 4:** reconnection beyond a refresh, presence, Render cold starts, rehydrating rooms
after a server restart, room eviction, rate limiting.

**Out — separate work:** the per-player turn-order draw (below), `LiqQueue`'s design review, seat
names truncating at 768px, and the rest of the carry-forward's standing list.

**Untouched:** `engine/` — no rules change is expected here, and one proving necessary is a finding
worth writing down rather than a routine step. `server/` changes only where `DRAWS` moves.

## Deletions

`src/Game.tsx`; all of `src/components/`; `src/context/SocketContext.tsx`;
`src/utils/gameSession.ts`; `src/utils/playerId.ts`. `src/utils/emojiNames.ts` survives — the join
screen uses it to prefill a name.

Nothing under `src/game/` imports any of it, so the cut is clean and `npm run typecheck` is the
gate. `App.tsx` loses `OnlineOnlyBanner` along with the banner it guarded; `main.tsx` loses the
socket provider it wrapped the whole app in.

## The follow-on: a per-player turn-order draw

Stubbed here, specified now so it is not lost a third time.

Today one intent (`startGame`) draws for the whole table at once: seat one presses a button, every
player's tile appears simultaneously, and the highest tile takes the first turn (I12 beats A1 — the
reverse of tabletop Acquire, deliberately). Online that works but reads as a jump cut.

What it should be: each player draws in turn, their tile appearing on the board as they do, until
everyone has drawn; then the winner takes the first turn. The players strip starts in lobby seating
order and reorders to play order once the draw resolves. That needs a per-player draw intent in
`engine/intents.ts` — a rules change, not a client one — which is why it is not in this phase.

## Cutover

The server must be redeployed from 3a before this client ships, or the deployed client will speak a
protocol the live server does not. `.env.production` already points the gh-pages build at
`https://acquire-multiplayer.onrender.com`. Nothing in progress matters; whatever is live gets
overwritten.

## Known limits, accepted

- **A server restart loses every room.** `saveGame` writes each committed state, but nothing reads
  it back — `loadAllGames` lost its only caller when `gameManagerXState.ts` was deleted. The
  registry is an in-memory `Map`. This will bite during the by-hand pass if the dev server is
  restarted mid-game; it is Phase 4's to fix.
- **`project()` shallow-copies.** `board`, `startups` and `mergerContext` share references across
  the projection boundary. Safe while `applyIntent` clones before mutating, which the client's
  optimistic path also relies on. Flagged in the 3a carry-forward and not fixed here.

## Risks

**The two-client test is the only end-to-end proof of optimism, so it must be observed failing.**
The break to run: apply the bag-drawing intents optimistically and confirm the mismatch count goes
above zero. A test that replays seventeen games and asserts nothing the client actually holds would
be this project's sixth hollow gate — and 3a's own Task 7 was very nearly exactly that.

**jsdom reports zero for all layout.** The not-my-turn panel is a height change driven by a state
transition, and a structural test can pass over a visibly broken page. Test 9 and `verify:layout`
are the answer; neither is optional.

**Deleting `src/components/` removes the last consumers of code nothing else uses.** Typecheck and
the full suite are the gate, and both run before the branch is finished.

## Verification

Phase 3b is done when:

- Two browsers play a full game to final scoring against a local server, by hand.
- All nine test groups above pass, and each has been observed failing.
- `src/Game.tsx`, `src/components/` and `src/context/` are gone, and nothing imports them.
- `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle` and
  `npm run verify:layout` are green. Pass-and-play is unchanged and still passes its own gates.
