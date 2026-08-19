# Phase 2a → Phase 2b carry-forward

**Date:** 2026-08-04
**Status:** Phase 2a complete; this is the punch list it hands forward
**Branch:** `revamp/phase-2a-pass-and-play` (18 commits, not pushed, not on `main`)
**Plan:** [2026-08-04-phase-2a-playable-pass-and-play.md](../plans/2026-08-04-phase-2a-playable-pass-and-play.md)
**Design:** [2026-08-04-phase-2a-playable-pass-and-play-design.md](./2026-08-04-phase-2a-playable-pass-and-play-design.md)
**Predecessor:** [2026-08-03-phase-1b-carry-forward.md](./2026-08-03-phase-1b-carry-forward.md)
**By-hand notes:** [2026-08-04-phase-2a-by-hand-notes.md](./2026-08-04-phase-2a-by-hand-notes.md)

**Acquire is playable.** A game runs from an empty roster through setup, the turn-order draw,
placement, founding, buying, mergers with several liquidators, and on into arbitrary later turns,
on one device, with no modal anywhere.

## What shipped

| | Before (1b) | After (2a) |
|---|---|---|
| Tests | 263 in 32 files | **347 in 44 files** |
| `src/game/` modules | 25 | **33** (28 test files) |
| New files | — | 23 |
| Gates | vitest, typecheck, vite build, check:bundle | the same **plus `npm run verify:layout`** |

**Engine (4 additive changes, no behaviour removed):** `getCurrentActor` in `engine/actor.ts`; the
`startGame` intent; `LogEntry.payload` with a `LogPayload` union whose first member is the merger
payout; and `finalizeMergerPayout` emitting **one** payout entry carrying every bonus instead of one
entry per payee.

**Session:** `src/game/session/` — `GameSession` (plain TypeScript, no React) owning the state, the
snapshot store and segment tracking, plus a `useSyncExternalStore` binding.

**Setup:** `src/game/setup/` — `SeatRow`, `PlayerRoster` (2–6 seats, transport-agnostic),
`LocalSetupScreen`.

**Screen:** `src/game/GameScreen.tsx` (102 lines, composition only) plus `src/game/screen/` —
`stepsOf`, `useTurnPanel`, and the driven-golden acceptance test.

## Verification against the design's own criteria

| Criterion | Result |
|---|---|
| A game reaches the fifth turn with no wedge, no modal | **Met.** The by-hand walk played ~40 turns. |
| …and no console error | **Not met**, for one pre-existing reason — see residual risk. |
| A three-way merger, >1 liquidator, each behind their own curtain | **Met.** By hand, a four-liquidator merger; in tests, G7 driven through the screen. |
| Undo returns board and panel within a segment, offers nothing outside | **Met.** |
| G2 and G7 driven through the real screen reach their golden terminal states | **Met** (`drivenGolden.test.tsx`). |
| `verify:layout` passes at 768 and 1440 | **Met**, and proven able to fail — three separate breaks. |
| vitest, typecheck, vite build, check:bundle green | **Met.** |

## Residual risk — read before building on this

**`src/` now has two live game screens.** `GameScreen` serves `/pass-and-play`; `Game.tsx` and the
six modals still serve `/room/:roomId`. Nothing was deleted, as the design corrected the roadmap to
require. Phase 3/5 removes them. Until then, a change to shared engine behaviour has two consumers,
and only one of them has tests worth the name.

**The socket connects on every route and logs errors.** `main.tsx` wraps the app in
`SocketProvider`, which dials the server on mount regardless of route, so `/pass-and-play` prints
`❌ Connection error: websocket error` repeatedly with no server running. The *visible* symptom —
the "Disconnected from server" banner sitting on top of the game — is fixed in `App.tsx`. The
console noise is not, because fixing it means changing when the transport connects, which is Phase
3's subject and unverifiable here without a running server. **This is the sole reason the "no
console error" criterion is unmet.**

**`verify:layout` measures a fixed set of properties and cannot see what it was not told to look
for.** It currently checks: curtain coverage, horizontal page scroll, board fit and collapse,
per-zone height stability across four stages, the `stepstack + active` sum, and horizontal clipping
of the strip and every `data-zone`. It reached those stages by *playing* — if the walk stops finding
a founding or a purchase, the pile reservation goes unmeasured, so the script throws rather than
passing quietly. It plays four seats; six is still unexercised.

**Buy and liquidation staging is local component state and vanishes on re-mount.** `useTurnPanel`
holds staged picks and sell/trade counts in `useState`, deliberately — the engine sees one intent on
confirm. A re-mount (a route change, a hot reload) silently discards a half-built basket. Harmless
locally; Phase 3 must decide whether a reconnect restores it or drops it.

**The opening board is a play-feel change nobody has lived with.** Starting tiles stay on the board,
faithfully to Acquire, so chains found sooner and more cheaply than they did. Correct, and now
covered by G17 and 60 seeded openings, but no one has played enough games to say whether it feels
right.

## Deviations from the plan, and why

| # | Plan said | Shipped | Reason |
|---|---|---|---|
| 1 | `verify:layout` compares **every** zone's height across stages | `stepstack` and `active` compared as a **sum** | They are designed to trade space: the step stack is `flex-1` and absorbs exactly what the active zone does not use. Their sum (511px) is the real invariant; per-zone equality reported two false failures on a correct panel. |
| 2 | `verify:layout` checks the curtain on the opening screen | Starts a game first, then reloads for the measuring walk | `/pass-and-play` opens on the *setup* screen, where no surface and no curtain exist. As written the check could only ever have reported "no curtain". |
| 3 | The script probes `http://127.0.0.1:5199/` | `http://localhost:5199/` | Vite binds `::1` only; the IPv4 probe never connected and the script always died with "vite did not come up". |
| 4 | `MEASURE` finds buttons by `innerText` | by accessible name (`aria-label ?? innerText`) | A buy button reads `MSLA $200` on screen and carries `Buy one Messla` as its label. Searching `innerText` silently never found it, so the staging stage never happened and the pile reservation went unmeasured — the exact hole the plan's own Step 4 warned about. |
| 5 | `MEASURE` places "the first hand tile" | tries every clickable cell until the log grows | The first clickable cell is often the already-placed tile or a blocked dead tile. Clicking those changes nothing and the walk stalled without saying so. |
| 6 | The walk measures one placement | plays on until a chain is founded **and** shares are staged | With a random seed the opening tile almost always lands isolated: nothing founded, nothing to buy, pile never filled. |
| 7 | The gate plays the default two seats | plays four | The players-strip clipping only appears above two seats. A heads-up gate would never have seen it. |
| 8 | `PlayersStrip` unchanged | relaid as a two-column grid | See defect 2 below. |

## Plan defects caught during implementation

The pattern from Phase 1a and 1b repeated: **the plan's author cannot see what only exists once the
markup and the page do.** Four this time, all in the plan's own test or script code.

1. **Task 6's segment tests contradicted Task 6's own implementation.** The implementation starts
   `awaitingReveal = true` (the design requires the game to open behind the curtain), while two of
   its tests asserted `false` without ever calling `reveal()`. Fixed by claiming the device first,
   which preserves what each test was actually about — that *ordinary dispatches within a segment*
   do not raise the curtain.
2. **Task 10 changed `StepStack`'s contract without updating its existing tests.** Gating undo on
   `entry.undoable` broke two Phase 1b tests whose fixtures predate the flag. Marked those fixtures
   `undoable: true` — they were written when every entry was implicitly undoable.
3. **Task 15's third test was seed-dependent.** `LocalSetupScreen` generates a random seed per
   mount, so whether seat one wins the turn-order draw — and therefore whether a curtain appears
   between the draw and the first turn — is a coin flip. It asserted the curtain unconditionally.
   Now it claims the handoff only if present; verified deterministic over six independent runs.
4. **Task 17's tests dispatched outside `act()`.** Driving the session directly leaves React showing
   the previous render, so the one test that queried the DOM read stale markup. Wrapped in `act`.

Also: Task 3's G17 needed `B4`, not `B3` — the plan caught this itself, in its own Step 3.

## Defects the by-hand pass found

Full detail in the by-hand notes; in brief, and all fixed:

1. The reconnection banner rendered over pass-and-play and the catalog.
2. **`PlayersStrip` silently clipped every seat past the second** — six seats wanted 1061px inside a
   319px panel. Four-player games lost two players and said nothing.
3. `startGame` marked the turn-order tile as `lastPlacedTile`, so a starting tile rendered with the
   undo ring and stayed clickable, then rejected the click it invited.
4. (From `verify:layout`, Task 16) `HandZone`'s holdings row had no reservation and grew 107px →
   114px on a player's first share.

**Three of these four are layout or affordance defects that no jsdom test could express**, which is
the third consecutive phase to land on that lesson.

## What 2b inherits

**Already in the engine, unused by the new UI:**

- `declareEnd` intent, with the gate that stops a player skipping a legal placement to freeze the
  board (`engine/intents.ts`).
- `getEndCondition` / `finalScore` (`engine/endGame.ts`), whose output G9 pins at
  $27,800 / $21,600 / $4,300.
- `tradeInDeadTiles`, and `getDeadTilesInHand` — already wired to `Board`'s `blocked` prop, so dead
  tiles *render* as blocked, but there is **no trade-in affordance** anywhere.

**Already built, unwired:** `FinalScoring` and `RevealOverlay`'s end-of-game use. `FinalScoring`
takes `reason: EndReason | null` and prop shapes matching `finalScore(state)`'s report (Phase 1b
deviation 1).

**Still unspecified:** the declare-end affordance's own design pass, and the route back to the lobby
from a finished game. Both were deferred by Phase 1b and are still deferred.

**A draw screen, deferred by decision (2026-08-04).** The turn-order draw is now a hard gate in
front of the game — no hand, no balance, no active seat, no curtain — but it resolves in a single
click and the result only appears as a log line. It deserves its own opening screen that *shows*
the draw: each player's drawn tile, side by side, and who won, before the first turn begins. Agreed
as worth doing and explicitly postponed; the gate that makes it possible is already in place, so
this is presentation only. Note the rule while building it: **highest letter, then highest number,
goes first** (I12 beats A1) — the reverse of tabletop Acquire, and a deliberate house rule.

**The seam is ready.** `GameSession` is the one place that owns state and turns rejection into
something readable; `getCurrentActor` lives in `engine/` precisely so Phase 3's server can answer
the same question. Substituting a networked `dispatch` should not require touching `GameScreen`.

## Carried findings

- **`LiqQueue` still has no design review** (Phase 1b finding A3). It now has a real four-liquidator
  state to review against — its `✓`/`›`/`·` marks read clearly, but nobody has designed them.
- **Seat names truncate hard at 768px**: a default "Player 1" renders as "P". The emoji avatar and
  the active outline still identify the seat, which is the identity the design chose. Design pass,
  not a correctness fix.
- **`DrawModal.tsx` still tells online players "Lowest letter, then lowest number goes first".** The
  rule changed to highest-first and both engine paths follow it, but that caption lives in
  `src/components/`, which is off-limits until Phase 3/5 deletes it. It is wrong on screen for
  `/room/:roomId` until then.
- **`Board.tsx` renders a hand tile as a `<button>` even with no `onCellClick`** (Phase 1b finding
  A1), so a read-only board still puts hand cells in the keyboard order. Still true; still harmless
  until a spectator view exists.
- **`src/Game.tsx:157` calls `require("../engine/gameLogic")` in a browser bundle.** Unreached, and
  dies with `Game.tsx`.
- The catalog's `sections.tsx` still builds every fixture at module load (Phase 1b finding A4).

## Process lessons

**The by-hand step earned its budget again, and by a wider margin.** 341 passing tests and four
green gates found none of the three defects that looking at the page found — and one of them,
`PlayersStrip` clipping half the table, would have shipped to every game with more than two players.
Three phases running, the single "open it and look" step is the highest-yield step in the plan.

**A gate you have not broken is not a gate.** Following the plan's Step 4 literally — break it,
watch it fail, revert — is what exposed that `verify:layout`'s walk never reached a staging state,
which meant the pile reservation it existed to protect was never being measured. The gate would have
passed forever while guarding nothing, exactly as Phase 1a's `check:bundle` did. The break also has
to be *observed*, not assumed: two of the plan's checks needed rewriting before they could fail for
the right reason.

**Measure, then reserve — never reserve by arithmetic.** The 64px holdings reservation came from
reading the real filled height off a real page. Phase 1b's 72px pile reservation was computed on
paper and was wrong by 6px for a whole phase.
