# Phase 1b → Phase 2 carry-forward

**Date:** 2026-08-03
**Status:** Phase 1b complete; this is the punch list it hands forward
**Branch:** merged into `revamp/phase-1a-engine-hardening` (not pushed, not on `main`)
**Plan:** [2026-08-03-phase-1b-component-layer.md](../plans/2026-08-03-phase-1b-component-layer.md)
**Predecessor:** [2026-08-03-phase-1a-carry-forward.md](./2026-08-03-phase-1a-carry-forward.md)

Phase 1b rebuilt the component layer in React + Tailwind against static fixtures: 25 modules under
`src/game/` (44 files including tests), a `/catalog` route holding **39 states**, and **101 new
tests** (162 → **263**, across 13 → 32 files). `vitest`, `typecheck`, `vite build` and `check:bundle` are all green on the merged
result.

Nothing in `src/components/`, `src/pages/`, `src/Game.tsx`, `server/` or `prototype/` was touched.
One file outside `src/game/` changed: `src/styles/index.css` (see finding B2).

## Residual risk — read before building on this

**There is still no path from "new game" to "first turn".** Phase 1a flagged this as a dead-stage
problem; Phase 1b confirmed it against the running app. Driving `/pass-and-play` in a browser:
setup → *Start Game* → the turn-order tiles are dealt, the log prints "Current: Baby Cat" — and it
stops. No player holds a hand, no cell is clickable, clicking one does nothing. **No crash and no
console error; it simply sits.** The state is `stage: "draw"`, `Game.tsx:355` renders `DrawModal`
for it, and nothing advances to dealt hands. No intent in `engine/intents.ts` accepts `draw` or
`dealHands`.

This is the first thing Phase 2 hits and it is an *engine* gap wearing a UI costume — either an
intent has to accept the opening stages, or `createInitialGame` has to return an already-dealt
`play` state. Neither exists, and no test covers the opening sequence.

**Nobody has seen the board and the panel together.** Every component is pure and props-in, and the
catalog shows them *individually*. The composed game layout — board left, 320px panel right, both
sized so the 9×12 grid fits without scrolling — does not exist in any file. The catalog's panel
entry is a fixed-height box inside a card, which proves the zones stack correctly but proves nothing
about the two-column layout. Phase 2's first layout task is unvalidated territory.

**Panel-height stability is held by a measurement, not by a test.** The committed jsdom test asserts
the *structure* of the reservation (a `min-h-` class, identical between empty and filled). It passed
while the pile genuinely shifted 62px → 68px and the action slot 32px → 38px, because jsdom reports
zero for layout. Only measuring the real page caught it. The reservations are now `72px` and `40px`,
verified as all five staging zones rendering at exactly 217px at both 768px and 1440px — but if
Phase 2 changes stack sizing, card depth, or the button's padding, those numbers go stale **and
every existing test still passes**. Re-measure in a browser after any such change.

**The 72px pile reservation covers a depth-2 stack by arithmetic, not by observation.** The catalog's
staging states top out at depth 1 (counts 1–3). A 6+ stack adds another 3px of depth margin; 72px
clears it on paper. No rendered state exercises it.

**Four components are covered only by the catalog smoke test.** `HandZone`, `PlayersStrip`,
`LiqQueue` and `LogDetail` have no dedicated test file — they render inside `CatalogPage.test.tsx`'s
"renders the entire catalog without throwing" pass and nothing asserts their behaviour. The first
three are plan-specified; `LogDetail` is not (see below).

**`check:bundle` now guards something real.** Phase 1a noted the guard was forward-looking with no
consumer. The catalog is that consumer: the golden games and their replays land in a separate
lazily-loaded chunk (`CatalogPage-*.js`, ~55kB) and the main chunk contains neither the golden data
nor vitest — verified by grepping both chunks, not just by the script's exit code.

## Deviations from the plan, and why

| # | Plan said | Shipped | Reason |
|---|-----------|---------|--------|
| 1 | `<FinalScoring reason={string} …>` | `reason: EndReason \| null` | The same task also said "prop shapes matching the `finalScore(state)` report". The report shape won: the catalog feeds real engine output, and a string would make every caller invent the same sentence. |
| 2 | `<Tile coord state brand? onClick?>` | plus `fill?`, `selected?` | Board cells must fill their grid track while inline log tiles keep the prototype's 34px box. `selected` keeps the undo ring orthogonal to affiliation — the tile that founds a chain is both the HQ *and* the undoable tile, which the prototype composes and a single `placed` state cannot. |
| 3 | (not listed) | `src/game/panel/LogDetail.tsx` | `StepEntry.detail` is a `ReactNode`; in the real game that node is a row of engine log tokens. Without a renderer the catalog would have to hand-author step details — the exact thing Task 12 exists to prevent. |

## Plan defects caught during implementation

Two, both in the plan's own test code, both reported rather than worked around:

1. **Task 5's owner-badge test could not pass as written.** It rendered `owners={{ E5: 'A' }}` and
   asserted `screen.getByText('A')` — but the board renders row headers `A`–`I`, so the query matches
   two elements and `getByText` throws on the duplicate. Fixed by using a non-colliding initial and
   scoping the query to the cell, which is what the test was actually about.
2. **Task 13's "renders every section heading" test** had the same shape of bug once written: a
   section titled "Place a tile" is also the label of the `ActiveStep` inside it. Now queried by
   heading role.

Both are the failure mode Phase 1a's process lesson predicted — *the plan's author cannot see a query
collision that only exists once the markup does*.

## Carried findings

### A. Worth doing when the file is next open

- `Board.tsx` renders a hand tile as a `<button>` even when no `onCellClick` is supplied, so a
  read-only board still puts hand cells in the keyboard order. Harmless today (the catalog always
  passes a handler); wrong once a spectator view exists.
- `payoutLinesOf` in `catalog/sections.tsx` derives the bonus *type* by regex over the log entry's
  text (`/majority \+ minority/i`). It is correct against every current log string and it is the only
  way to read payout shape back out of a post-merge state — but it is stringly-typed, and a reworded
  log entry breaks it silently. A `type` field on the log token would end it.
- `LiqQueue` is the one merger component with no prototype ancestor; its `done`/`current`/`pending`
  marks (`✓`/`›`/`·`) were designed here and have had no design review.
- The catalog's `sections.tsx` builds all fixtures at module load. Fine at 39 states and one lazy
  chunk; if the catalog grows a lot, replays should move behind a per-section accessor.

### B. Global CSS the new layer has to defend against

`src/styles/index.css` predates `src/game/` and still carries element-level selectors:

1. **`button span { color: var(--tile-color); font-size: 2em; font-weight: bolder }`** repainted the
   label inside *every* button in the app — every ticker, tile label and stack count. It exists for
   `src/components/Board.tsx`'s cells, which always carry `tile-placed`/`tile-unclaimed`/
   `tile-in-hand`, so it is now scoped to those three classes. That board's appearance is unchanged.
2. **`button { border-radius: 5px; margin: 1px }` is still global.** Tailwind's `rounded-*` outranks
   the radius, but the margin lands on every button that does not set one. `Tile` carries an explicit
   `m-0` as the antidote because a 1px margin visibly shrinks a board cell inside its grid track.
   **Any new interactive atom in `src/game/` needs the same until `src/components/` is deleted.**

### C. Pre-existing app-level issues, deliberately untouched

- **`ReconnectionBanner` renders on every route**, `/catalog` included, where it sits over the page
  header and reports "Disconnected from server" because no game server is running. It lives in
  `src/components/`, which this plan was forbidden to touch.
- `src/Game.tsx:157` calls `require("../engine/gameLogic")` inside a browser bundle. It would throw
  if reached — but the draw-stage deadlock means it is never reached. Both die with `Game.tsx`.

## What Phase 2 inherits, concretely

**Ready to wire.** 21 pure components, no game state read or dispatched anywhere:
`Cash` · `Price` · `Brand` · `StockCard` · `StockStack` · `Tile` · `Board` · `Panel` · `StagingZone` ·
`HandZone` · `PlayersStrip` · `StepEntry` · `ActiveStep` · `StepStack` · `LogDetail` · `PayoutLines` ·
`LiqQueue` · `LiqActions` · `FoundGroups` · `FinalScoring` · `RevealOverlay`.

**The undo contract is already in place.** `StepStack`'s `onUndo` is called with the entry's
`stepId` and nothing else — the same `stepId` Phase 1a's `rewindTo(store, stepId)` takes. Nothing
between them has been connected or tested.

**Fixture provenance is visible and should stay that way.** Of 39 catalog states, **18 are replayed
from golden games** and **21 are authored** — 15 of those 21 are pure vocabulary (7 tile states, 8
stack shapes) with no position to derive. The remaining 6 are staging states (uncommitted UI state
the engine never sees), the empty payout list, and the both-exchanges-unavailable liquidation. Every
caption says which it is; a state that quietly loses its badge is a regression.

**Still on the deletion list** (unchanged from the plan): `BuyModal`, `MergerLiquidation`,
`SurvivorSelectionModal`, `FoundStartupModal`, `DrawModal`, `TilePlacementConfirmModal`,
`src/components/Board.tsx`, `Game.tsx`, and the legacy `handleLiquidationChoice` in `gameLogic.ts`.

**Deferred, each needing its own spec before or during Phase 2:** the declare-end affordance (needed
*before* Phase 2 per the plan), the route back to the lobby from final scoring, and `WaitingRoom.tsx`
(deferred to before Phase 5).

## Process lessons

**A structural test can pass while the thing it guards is broken.** The height-stability test checked
that a `min-h-` class existed and matched between states. Both were true; the zone still shifted,
because the reservation was smaller than its own content. The test could only ever have caught a
*missing* reservation, never an *insufficient* one — and its own task called it "the load-bearing
test of this task". Phase 1a learned that a guard's own coverage is the thing to check; this is the
same lesson from the other direction, and it took leaving jsdom to see it.

**The by-hand step was the only step that found anything.** Fourteen tasks of TDD produced 101
passing tests and zero surprises. The single "open it in a browser and report what you saw" step
produced two real defects — one of them in the constraint the plan named as its most important.
Budget for that step; it is not ceremony.

**Deriving from the engine kept working.** Every price, total, bonus and board position in the
catalog is replayed rather than written down, and the final-scoring columns reproduce G9's declared
totals ($27,800 / $21,600 / $4,300) without those figures appearing anywhere in `src/`. No
Phase 0-style wrong-number defect occurred in this phase.
