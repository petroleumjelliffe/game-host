# The turn-order draw becomes a round of turns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the opening draw from one host button into a round of one-tile turns — the same
place-then-commit rhythm as every other turn — in pass-and-play and online alike.

**The shape, from the owner (2026-08-06):**

> it begins with player 1 from the lobby queue. there's 1 highlighted tile. they click to play it as
> normal, then the "end turn" button to complete their turn. button passes to next player, they place
> their tile. and so forth, until everyone has played one. then there's an update to who goes first,
> and the current player indicator updates as normal.

**Architecture:** No new intents and **no protocol change**. The round is built from the wire
vocabulary that already exists: `startGame` deals one tile to each player and opens the round,
`placeTile` puts your tile on the board, `endTurn` commits your draw turn and hands to the next
seat. The last `endTurn` of the round resolves who goes first, deals the opening hands, and moves
the game to `play`. Every existing mechanism then applies for free — the segment boundary raises the
pass-and-play curtain, the server commits and broadcasts, `NetworkSession` applies the placement
optimistically and waits on the commit, and the turn toast announces the next player.

**Why this supersedes Phase 5's Task 7.** That task moved the opening deal to after the draw. This
one has to do that anyway — a player holding six tiles plus a draw tile has no way to tell which one
is "the highlighted tile" — so Task 7 is absorbed here and struck from that plan.

**Tech Stack:** TypeScript ESM, React 18, vitest 4 (`node` for `engine|session|server`, `app`/jsdom
for `src`), socket.io 4.

## Global Constraints

- **This is a rules change.** `engine/` is in scope, deliberately and throughout. The golden corpus
  is the executable spec: a golden game that moves is a finding to report, not an obstacle to route
  around.
- **No `as any`.** Narrow with the engine's type guards (`isStartupId`, …).
- **Derive from the engine, never hardcode.**
- **jsdom reports zero for every layout measurement.** Nothing in jsdom may assert a height, a fit
  or an overflow.
- **Every new test is observed failing before it is trusted**, with the break named in the task. A
  break that turns nothing red is a stop-and-report result. This project has shipped six hollow
  gates.
- **Test both sessions.** A behaviour that works in `GameSession` and not in `NetworkSession` is
  this project's signature bug — it has shipped twice. Where a task touches turn flow, it is tested
  in pass-and-play *and* over the wire.
- **Commands:** `npx vitest run`, `npm run typecheck` (never bare `tsc`), `npx vite build`,
  `npm run check:bundle`, `npm run verify:layout`. Dev: `npm run dev:all`, one instance only.

---

## The state today

- `createInitialGame` (`engine/gameInit.ts`) deals `HAND_SIZE` tiles to everyone and opens at
  `stage: 'draw'`.
- `doStartGame` (`engine/intents.ts`) is the whole draw in one intent by seat one: shift one tile
  per player from the bag, mark each placed, sort by `compareTiles` descending — highest letter then
  highest number takes the first turn — set `turnIndex`, log one `Drew for turn order` entry, and go
  to `play`.
- `getCurrentActor` returns `players[0]` for the whole of `stage: 'draw'`, because turn order does
  not exist yet.
- `GameSession` deliberately opens the draw **without** the curtain ("a gate in front of the game
  rather than anyone's turn"), and `syncSegment` carries a `leftDraw` special case so that leaving
  the draw closes a segment even when seat one wins their own draw.
- The drawn tiles stay on the board as unclaimed starting tiles and leave the bag for good. Keep
  that. The legacy `resolveInitialDraw` places them *and* pushes them back to the bag, double
  counting; do not reproduce it.

## The shape after

| | |
|---|---|
| `startGame` | Seat one opens. One tile from the bag into **each player's hand** — not onto the board. `turnIndex = 0`. Stage stays `draw`. |
| `placeTile` (draw) | The actor's one tile goes on the board as an unclaimed cell. **No chain logic** — two adjacent draw tiles must not found anything. Logs `Placed a tile`, the same phase an ordinary placement logs, so the step stack entry is identical. |
| `endTurn` (draw) | Commits the draw turn. Not the last seat: advance `turnIndex`, stage stays `draw`. Last seat: resolve the order, deal the opening hands, `stage = 'play'`, `turnIndex` = the winner. |
| Curtain | Rises between draw turns, like any other handoff. |
| Hands | Empty until the round resolves. |

---

## Task 1: `startGame` deals one tile each and opens the round

**Files:** `engine/intents.ts` (`doStartGame`), `engine/gameInit.ts`; tests in
`engine/intents.test.ts`, `engine/gameInit.test.ts` if one exists.

**Interfaces produced:** after `startGame`, `state.stage === 'draw'`, every `player.hand` has
**exactly one** tile, `state.turnIndex === 0`, and the board is empty.

- [ ] **Step 1: Write the failing tests.** After `startGame` from a fresh `createInitialGame`: stage
  is still `draw`; every hand holds exactly one tile; no cell on the board is `placed`; the bag has
  shrunk by exactly `players.length`. And separately, at `stage: 'draw'` *before* `startGame`, every
  hand is empty — the Phase 5 Task 7 assertion, which lands here.
- [ ] **Step 2:** Stop dealing in `createInitialGame`. Deal one tile per player in `doStartGame`,
  and delete the order-resolving half of it (that moves to Task 3).
- [ ] **Step 3: Measure the blast radius rather than guessing it.** Grep for openings built by
  `createInitialGame` and for anything assuming a dealt hand at `draw`. `buildFixture` sets hands
  explicitly, so the golden corpus is expected to be indifferent — confirm that, do not assume it.
- [ ] **Step 4: Break it** by dealing `HAND_SIZE` again in `createInitialGame`; confirm the
  empty-hands test goes red. Restore.
- [ ] **Step 5:** Whole suite, typecheck, commit.

## Task 2: Placing your draw tile

**Files:** `engine/intents.ts` (`doPlaceTile`, `getCurrentActor` via `engine/actor.ts`); tests in
`engine/intents.test.ts`, `engine/actor.test.ts`.

**Interfaces produced:** `getCurrentActor(state)` during `draw` is `players[turnIndex]`, so the seat
whose draw turn it is — the value every other layer already reads.

- [ ] **Step 1: Write the failing tests.**
  - The actor during `draw` follows `turnIndex`, not always seat one.
  - `placeTile` at `draw` marks the cell placed, removes the tile from that player's hand, leaves
    `stage` at `draw`, and logs a **`Placed a tile`** entry carrying that player's id and tile —
    the same phase and the same shape as an ordinary placement, so the step stack shows the same
    entry with the same undo. (Owner's ruling: the draw turn reuses the placement step exactly.)
    The round's *resolution* logs the one `Drew for turn order` entry, in Task 3, naming the order.
  - **Two adjacent draw tiles found nothing**: place `E5` for seat one and `E6` for seat two, then
    assert no startup `isFounded` and the stage never became `foundStartup`. This is the test that
    justifies the whole branch, and it is the one a naive implementation fails.
  - A player cannot place a tile that is not theirs, and cannot place twice in one draw turn.
- [ ] **Step 2:** Branch in `doPlaceTile` before `handleTilePlacement`. The draw branch marks the
  cell and logs; it must not touch chains, `pendingFoundTile`, `lastPlacedTile` or the buy stage.
- [ ] **Step 3: Break it** by routing the draw placement through `handleTilePlacement`; confirm the
  adjacent-tiles test goes red. Restore.
- [ ] **Step 4:** Whole suite, typecheck, commit.

## Task 3: Ending a draw turn, and the round resolving

**Files:** `engine/intents.ts` (`doEndTurn`); tests in `engine/intents.test.ts`.

**Interfaces produced:** the transition every UI layer keys off — after the last draw turn,
`stage === 'play'`, `turnIndex` is the winner's seat, and every hand holds `HAND_SIZE`.

- [ ] **Step 1: Write the failing tests.**
  - `endTurn` at `draw` **before** placing is rejected: there is exactly one thing to do on a draw
    turn and skipping it would leave a player out of the order.
  - After a non-final draw turn: `turnIndex` advanced by one, stage still `draw`, hands still empty.
  - After the final one: `stage === 'play'`; every hand holds `HAND_SIZE`; the bag shrank by exactly
    `players.length * HAND_SIZE`; `turnIndex` names the player whose tile sorts highest by
    `compareTiles` — asserted by computing the winner from the placed tiles, never by writing down a
    seat number.
  - Three players, so "advance" and "wrap" are different assertions.
- [ ] **Step 2:** Implement the two branches. `endBuyPhase` is the wrong exit here — it resets buy
  state and lands on `play`; the draw's non-final exit stays at `draw`.
- [ ] **Step 3:** Keep the existing rule and its comment: highest letter then highest number goes
  first, which is deliberately the reverse of tabletop Acquire. Do not quietly re-derive it. Log
  the resolution as the round's one `Drew for turn order` entry, naming the finishing order — the
  per-player entries are placements (Task 2), so this is the only record of who won.
- [ ] **Step 4: Break it** by resolving the order after every draw turn rather than the last;
  confirm the mid-round test goes red. Restore.
- [ ] **Step 5:** Whole suite — this is the task most likely to move something — typecheck, commit.

## Task 4: A golden game for the round

**Files:** `engine/golden/` (a new `G17`), `engine/golden/turns.ts` or wherever the corpus indexes
games.

**Why:** the corpus is the rules spec, and the opening is now made of rules. Without this, the
round's behaviour is pinned only by unit tests that live next to the code they test.

- [ ] **Step 1:** Author a fixture at `stage: 'draw'` with an explicit `bag`, so the tiles each
  player draws are deterministic and readable in the file.
- [ ] **Step 2:** Steps: `startGame`, then per player `placeTile` + `endTurn`, then one ordinary
  turn to prove the game continues normally from the winner's seat.
- [ ] **Step 3:** Assert what the corpus asserts elsewhere — `logPhases`, stage, and final holdings
  — plus the seat that goes first.
- [ ] **Step 4:** `npx vitest run engine/golden` and the whole suite. Commit.

## Task 5: The curtain comes up between draw turns

**Files:** `session/GameSession.ts`; tests in `session/GameSession.test.ts`.

**Finding to fix:** the session opens the draw with no curtain, on the reasoning that the draw is a
gate rather than anyone's turn. That reasoning expires here: each draw turn belongs to a player and
their tile is in their hand, so on a shared device the next player would see it.

- [ ] **Step 1: Write the failing test.** From an opening: after `startGame`, `awaitingReveal` is
  true for seat one; after seat one's `endTurn`, it is true again for seat two; and it is true once
  more for the winner when the round resolves.
- [ ] **Step 2:** Remove the draw exception. Re-examine `leftDraw` in `syncSegment`: it exists so
  that leaving the draw closes a segment even when the actor id does not change (seat one winning
  their own draw). That case still exists — the last draw turn can be won by the player who just
  took it — so keep it and re-comment it for the new flow rather than deleting it on sight.
- [ ] **Step 3: Break it** by restoring `awaitingReveal = state.stage !== 'draw'`; confirm the
  seat-two case goes red. Restore.
- [ ] **Step 4:** Suite, typecheck, commit.

## Task 6: The draw turn on screen

**Files:** `src/game/screen/useTurnPanel.tsx` (a `draw` branch), `src/game/GameScreen.tsx`,
`src/game/panel/HandZone.tsx`, `src/game/screen/boardMarks.ts`, `src/game/catalog/sections.tsx`;
tests alongside each.

**The screen, per the owner:** one highlighted tile, clicked on the board like any other placement,
then **End turn** to complete the turn. The button is the same one the buy step uses — same slot,
same treatment — because it is the same act: commit and hand over. It sits there disabled until the
tile is down, so the draw turn is the placement step plus one waiting button and nothing else new.

**Depends on Phase 5's Task 11** (the placement step shows the viewer's hand), which is what puts
the one drawn tile in the panel. If Task 11 has not landed, do it first rather than building a
second hand display here.

- [ ] **Step 1: Write the failing tests.**
  - During `draw`, the actor's single tile is clickable on the board and the panel shows it; every
    other cell is inert.
  - A watcher — someone else's draw turn — sees no clickable cell and none of the actor's tile.
  - The **End turn** button is present from the start of the draw turn and **disabled until the
    tile is placed** (owner's ruling) — the zone does not gain a control mid-turn, which is the
    panel-stability rule, and the player can see what finishing looks like before they act. Once
    placed it enables and dispatches `endTurn`.
  - After a draw tile is placed, it carries its owner's badge, so the board fills in seat order and
    you can see whose is whose. (`boardMarks.test.ts` currently asserts `ownerBadges` is empty
    during the draw — that expectation is now wrong and changes with the feature; say so in the
    commit rather than editing it quietly.)
- [ ] **Step 2:** Implement the `draw` branch in `useTurnPanel`, replacing the single "Draw for turn
  order" button. `GameScreen`'s `canPlaceNow` and `onCellClick` need to admit the draw stage.
- [ ] **Step 3:** `HandZone`'s "Not dealt yet" is right up to `startGame` and wrong after it —
  during the round you hold exactly one tile. Show it.
- [ ] **Step 4:** Add a catalog card for the round: your draw turn, and someone else's. The catalog
  is the acceptance surface and this is a whole new step.
- [ ] **Step 5: Break it** by leaving the board inert during `draw`; confirm the clickable-tile test
  goes red. Restore.
- [ ] **Step 6:** Suite, typecheck, `npm run verify:layout`, commit.

## Task 7: The round over the wire

**Files:** `server/` (whatever `startGame` handling assumes a one-shot draw), `src/net/`; tests in
`server/clientOverWire.test.ts` and `src/net/NetworkSession.test.ts`.

**What should already be true, and must be proven rather than assumed:** `placeTile` is not a
bag-drawing intent, so it applies optimistically; `endTurn` and `startGame` are in `DRAWS`, so they
wait for the server's correction — which is exactly right, since the last `endTurn` deals from the
bag.

- [ ] **Step 1: Write the failing test** in `server/clientOverWire.test.ts`: two `NetworkSession`s
  over real sockets play a whole draw round — host starts, each client places and ends in turn — and
  both end up agreeing on who goes first and holding `HAND_SIZE` tiles each.
- [ ] **Step 2:** Projection. During the round, a player sees their own draw tile and not anyone
  else's; every tile already **placed** is public. Assert both halves, because the first is a
  privacy rule and the second is the whole point of the round being watchable.
- [ ] **Step 3:** An out-of-turn draw placement is rejected by the server, like any other
  out-of-turn intent.
- [ ] **Step 4: Break it** by projecting full hands during `draw`; confirm the privacy half goes
  red. Restore.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 8: The walk, and a game played by hand

**Files:** `scripts/verify-layout.mjs`; no source changes expected.

- [ ] **Step 1:** The walk clicks a single "Draw for turn order" button today. It now has to place
  and end a turn per player. A walk that stalls here reports green while measuring nothing — this
  gate has gone hollow exactly this way once before.
- [ ] **Step 2:** `npm run verify:layout` at 768 and 1440, and read the numbers rather than the
  verdict: the panel's zones during the draw are a state it has never measured.
- [ ] **Step 3: By hand, pass-and-play:** three players, curtain between each draw turn, board
  filling in seat order with owner badges, then the winner's turn beginning normally.
- [ ] **Step 4: By hand, two browsers:** the same round, watching one client's board fill in as the
  other places. Then finish a game.
- [ ] **Step 5:** Suite, typecheck, build, `check:bundle`, commit.

---

## Verification

- The whole suite, typecheck, `npx vite build`, `check:bundle` and `verify:layout` green.
- Every new test observed failing first, with its break named.
- A pass-and-play game and a two-browser game each opened by a full draw round, by hand.
- Phase 5's Task 7 marked superseded in
  [2026-08-06-phase-5-online-ui.md](2026-08-06-phase-5-online-ui.md).

## Risks

**This is the first rules change since the corpus was written.** Sixteen golden games plus the
invariant checks are the net, and they are only a net if a failure is read rather than fixed past.
Tile conservation is the invariant most likely to bite: tiles now leave the bag in two places.

**The opening is what every fixture is built on.** `buildFixture` sets hands explicitly, so the
corpus should be indifferent — "should be" is the phrasing that preceded this project's last two
surprises.

**Three separate layers currently special-case `stage: 'draw'`** — `getCurrentActor`, `GameSession`'s
curtain suppression, and `useTurnPanel`'s single button. A change that fixes two of them and leaves
the third is a state where the actor, the curtain and the panel disagree about whose turn it is.

**The draw round is the first thing anyone sees.** If it is wrong, it is wrong before the player has
any context for what the game is doing — which makes Task 8's by-hand pass the load-bearing gate
here, not the suite.
