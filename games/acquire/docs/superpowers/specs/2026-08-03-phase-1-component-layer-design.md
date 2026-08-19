# Phase 1 — the component layer

**Date:** 2026-08-03
**Status:** design, approved in outline; the component half (Plan 1b) has not been reviewed section-by-section
**Follows:** [Phase 0 → Phase 1 carry-forward](2026-08-03-phase-0-carry-forward.md)
**Roadmap:** [React app revamp roadmap](2026-07-31-react-app-revamp-roadmap-design.md) § "Phase 1 — Port the component layer"

Phase 0 rebuilt the rules as `engine/`, with `applyIntent(state, intent)` as the single intent
surface and fourteen golden games as the executable rules spec. Phase 1 builds the component layer
that renders it, against static fixtures only — no game wiring, which is Phase 2.

Phase 1 also absorbs the four Phase 0 follow-ups that Phase 1 either depends on or is the natural
home for.

## What changed from the roadmap

The roadmap describes Phase 1 as a **port**: prototype → React, with "parity with `states.html`,
nothing more" as the acceptance criterion and the explicit mitigation for what it calls "the
largest, vaguest phase."

That is not what we are doing. The decision here is to **rebuild the visuals in Tailwind**, treating
the prototype as a reference sketch rather than the target. The reasoning: the prototype was a lab
for settling design *decisions*, and it settled them well, but the CSS that expresses them was
written for a fixed desktop viewport with no build step. Some of it is actively wrong for a real app
— `states.html` has to undo the prototype's own fixed-viewport `body` rules to make the catalog
scroll ([states.html:8-9](../../../prototype/states.html#L8-L9)).

Removing "parity with `states.html`" removes the roadmap's bound on this phase. Two things replace
it:

1. **The settled decisions are locked inputs, not open questions** (see below). The rebuild is about
   layout, responsiveness and Tailwind idiom — not about re-deciding what a share card is.
2. **The catalog route remains the acceptance surface**, driven by golden fixtures rather than
   hand-authored props.

## Locked decisions

These are inputs to Plan 1b. An implementer may not re-open them; a reviewer should flag any
component that contradicts them.

- **The 7-startup palette** — approved 2026-07-24, built in the prototype, recorded in
  `.brand-*` at [components.css:96-104](../../../prototype/components.css#L96-L104).
- **Tickers** — `$G $S $PP $C $M $Z $W`, and `$$` for cash. These ship in the engine already at
  [startups.ts:26-32](../../../engine/startups.ts#L26-L32).
- **The tile-state vocabulary** — one vocabulary shared by board cells and inline tiles: `empty`,
  `filled`, `hand`, `placed`, `blocked`, `chain`, `founded`. Background = affiliation, border weight
  = attention, ring = placed this turn.
- **Chain rendering** — members stay dark and wear an *overlapping* brand ring (neighbouring rings
  merge into a group outline); the HQ is the single tinted cell showing the ticker. Deliberately not
  a computed polygon silhouette.
- **Reserved colour bands** — blue is hand + selection, true green is cash. No brand hue may
  collide with either.
- **Portrait stock cards with depth** — a share is a portrait certificate; a stack shows layered
  card edges behind the front card, capped at 2 extra layers, scaling with `|count|`.
- **Player emoji** — a fixed avatar beside a name (🦊 Alex), not a generated name. `Player.emoji`
  exists at [gameTypes.ts:64](../../../engine/gameTypes.ts#L64).
- **The two semantic separations** — money (`cash`) vs a stock's value (`price`); company (`brand`,
  filled) vs a share of it (`stockCard`, outlined).
- **The five panel zones in fixed order** — `stepstack → active → staging → hand → players`.
- **Panel-height stability** — panel zones must not resize as content changes. Reveal via
  transition, never layout jump.
- **`prefers-reduced-motion`** — enter animations are skipped, matching the existing lab.

## Structure: one spec, two plans

| | Plan 1a — engine hardening | Plan 1b — component layer |
|---|---|---|
| Touches | `engine/`, `vite.config.ts`, `tsconfig.json`, `package.json` | `src/`, `tailwind.config.js` |
| Gates | `vitest`, `typecheck`, `vite build` | same, plus the catalog renders |
| Size | ~6 tasks | ~14 tasks |

No file is touched by both. 1a runs first: its typecheck gate should exist before the first `.tsx`
is written, and its snapshot work determines the step-stack component's props.

---

# Plan 1a — engine hardening

## 1a.1 The typecheck gate

There is no `tsconfig.json` and no typecheck gate, so type debt is currently invisible. Phase 1
writes a large volume of new TSX against engine types; this is where the gate pays for itself.

- Add `tsconfig.json` covering `engine/`, `src/`, and `server/`, honouring the existing import
  conventions: intra-`engine/` extensionless, `server/` → `engine/` with `.js` (NodeNext),
  `src/` → `engine/` extensionless.
- Add `npm run typecheck`.
- Fix the five known debts from carry-forward §A.

**Scope this task as "make `typecheck` pass," not "fix these five."** The five are what reviewers
happened to notice while reading Phase 0 diffs, not a survey. A codebase that has never run `tsc`
will surface more. The task's done-when is a clean run; the implementer chooses strictness to make
that achievable in one sitting — `strict: true` if the count is small, a documented and justified
relaxation if it is not. A relaxation must be recorded in the plan's ledger, not merely in
`tsconfig.json`.

**Constraint that survives from Phase 0:** never run bare `tsc` as an ad-hoc command. It runs
through the gate script or not at all.

## 1a.2 The snapshot store — outside `GameState`

The roadmap describes log entries carrying a **snapshot handle**. They shipped as
`LogEntry.stepId: number` with no snapshot, and carry-forward §D records that as an open gap.

**`stepId` is the handle. It was not the gap.** What is missing is the thing it indexes into, and
that must live outside `GameState`.

A snapshot field on `LogEntry` would be a serious bug. `applyIntent` deep-clones the whole state at
[intents.ts:374](../../../engine/intents.ts#L374). If a log entry held a `GameState`, and every
`GameState` holds a log, then each `applyIntent` call would clone every prior snapshot, each
carrying its own log of snapshots — exponential in time and memory, and invisible in any test with
three steps.

Build instead:

```ts
type SnapshotStore = Map<number, GameState>;

// snapshots `state` under its current nextStepId, then delegates to applyIntent
function applyIntentWithHistory(store: SnapshotStore, state: GameState, intent: Intent): GameState;

// returns the state as it was before `stepId` ran, and drops all forward entries
function rewindTo(store: SnapshotStore, stepId: number): GameState;
```

The store is owned by the caller — Phase 2's UI, Phase 3's server. This matches what the prototype
already does: `history` as a separate array, with steps tagged by index
([DESIGN_PRINCIPLES.md:72-75](../../../prototype/DESIGN_PRINCIPLES.md#L72-L75)). It also keeps
snapshots out of anything Phase 3 broadcasts, which matters because a snapshot contains the bag and
every player's hand.

**Tests:** rewind restores an earlier state exactly; rewinding twice to the same step is
idempotent; forward entries are dropped; a rewind-then-replay reaches the same state as the
uninterrupted run. Plus a guard test asserting no `GameState` reachable from a store entry contains
a nested store — the recursion trap, pinned.

## 1a.3 The property/invariant harness, and the discard pile

Carry-forward's closing lesson: every Phase 0 gate is example-based, and 99 tests plus 12 golden
games all passed on a state machine that deadlocked in 8% of random games. A throwaway random-play
harness asserting share conservation and progress found it in seconds.

Build a seeded random-play driver that asserts after **every** intent:

- **Tile conservation** — `placed + Σ hands + bag + discarded = 108`
- **Share conservation** — per startup, `Σ held + availableShares = 25`
- **Cash** — no player's cash is ever negative
- **Progress** — no state repeats with an unchanged `nextStepId`

Fixed seeds so failures reproduce; on failure the harness prints the intent sequence that produced
it, so it can be pasted into a golden game.

**Tile conservation is unassertable today**, which is why carry-forward §C belongs to this task
rather than its own. The log records a traded-in dead tile's coord, but `GameState` has no discard
pile, so `placed + Σ hands + bag` silently drifts below 108 with nothing to reconcile against. Add
`discarded: Coord[]` and the invariant becomes checkable.

**This task is expected to find bugs.** If it finds none, that is itself a finding worth
investigating — the most likely explanation is that the random policy never reaches the interesting
states, which is exactly how the Phase 0 fix round's first probe fooled itself into reporting
`stuck=0` against known-broken code.

## 1a.4 Golden coverage gaps

Carry-forward §E, all six:

- Nothing pins `declareEnd` being **refused** when the condition is unmet — G10 would still pass if
  the guard were removed entirely. Covered at unit level by
  [intents.test.ts:530](../../../engine/intents.test.ts#L530), but the catalogue is the spec.
- `expectError` covers 3 of the 14 `IllegalIntentCode` values.
- G7 stops at the merge step, so multi-absorbed-chain *sequencing* is never exercised despite G7
  being the only multi-absorbed game.
- G5's title promises the sole-holder bonus "as one figure" but asserts only the cash total; a
  two-entry implementation would satisfy it identically.
- G4 asserts only `cash`, unlike its five siblings.
- No unit coverage for negative-count validation, a successful basket spanning two startups,
  `renderLogText` on zero/negative cash, or a liquidate-specific no-mutation assertion.

## 1a.5 The vitest-free golden barrel

**Plan 1b cannot import `engine/golden/index.ts`.** That barrel re-exports `./runner`
([golden/index.ts:8](../../../engine/golden/index.ts#L8)), and `runner.ts` imports `expect` from
`vitest` ([runner.ts:1](../../../engine/golden/runner.ts#L1)). Any app code touching the barrel
pulls the test framework into the browser bundle.

Split it:

- `engine/golden/replay.ts` — no vitest import. Exports
  `replayGoldenGame(game: GoldenGame): GameState[]`, returning the state after each step with the
  built fixture at index 0. Steps carrying `expectError` yield the unchanged state, so indices stay
  aligned with `game.steps`.
- `engine/golden/index.ts` keeps `runner` for tests.
- App code imports games, fixtures and `replay` — never `runner`.

**Test:** for every golden game, `replayGoldenGame(g)` produces a final state deep-equal to
`runGoldenGame(g)`'s. The two paths must not drift.

Add a build-level guard: `vite build` must fail if `vitest` reaches the client bundle.

---

# Plan 1b — the component layer

## Where it lives

New components land in `src/game/`, consumed only by the catalog route. The existing components are
left untouched — they are on Phase 2's deletion list, and the app is already broken in ways Phase 2
deletes rather than fixes ([Game.tsx:158](../../../src/Game.tsx#L158) calls `require()` in an ESM
bundle; [MergerLiquidation.tsx:17](../../../src/components/MergerLiquidation.tsx#L17) destructures a
`sharePrice` that `MergerContext` has not carried since `bd73e8b`).

Consequence to accept knowingly: for the length of this phase the repo carries two component sets,
and `npm run dev` still lands on a broken game screen. The catalog route is where the new work is
visible.

## The palette is already Tailwind

Every colour the prototype settled on is a Tailwind default. The palette was built by holding
saturation and lightness fixed and varying only hue — which is exactly what Tailwind's scale does.

| Startup | Ticker | Hue | stroke / tint / text |
|---|---|---|---|
| Gobble | `$G` | red | `red-500` / `red-100` / `red-700` |
| Scrapple | `$S` | orange | `orange-500` / `orange-100` / `orange-700` |
| WrecksonMobil | `$W` | amber | `amber-500` / `amber-100` / `amber-700` |
| PaperfulPost | `$PP` | lime | `lime-500` / `lime-100` / `lime-700` |
| ZuckFace | `$Z` | teal | `teal-500` / `teal-100` / `teal-700` |
| Messla | `$M` | purple | `purple-500` / `purple-100` / `purple-700` |
| CamCrooned | `$C` | pink | `pink-500` / `pink-100` / `pink-700` |
| _Cash_ | `$$` | green | `green-500` / `green-100` / `green-700` |

The tile tokens are Tailwind defaults too: empty is `gray-100`/`gray-300`/`gray-500`, filled is
`gray-700`/`gray-50`, hand is `blue-100`/`blue-500`/`blue-700`, the selection ring is `blue-600`.

So `tailwind.config` needs **no custom colour scale** — only a semantic mapping from startup id to
hue.

**The footgun:** Tailwind's JIT scans source for literal class strings. `` `bg-${hue}-100` `` produces
nothing. The mapping must be a static lookup of complete literal class strings:

```ts
export const BRAND_CLASSES: Record<StartupId | 'Cash', { stroke: string; tint: string; text: string }> = {
  Gobble: { stroke: 'ring-red-500', tint: 'bg-red-100', text: 'text-red-700' },
  // …one literal entry per brand
};
```

One task owns this file, and a test asserts every `StartupId` in `AVAILABLE_STARTUPS` has an entry —
otherwise a future eighth startup renders unstyled with no error.

## Component inventory

Rebuilt from [components.js](../../../prototype/components.js). Each is props-in and pure; none
reads game state.

**Atoms** — `Cash`, `Price` (with the `next` variant showing ↑/↓ and the tinted new value), `Brand`,
`StockCard`, `Tile`.

**Containers** — `StockStack` (the primary interactive share entity: a `StockCard` plus a count
outside it, with `onClick` incrementing and `onRemove` decrementing), `Pile`, `PlayerRow`.

**Composites** — `StepEntry`, `ActiveStep`, `StepStack`, `PayoutLines`, `LiqQueue`, `LiqActions`,
`StagingZone`, `HandZone`, `PlayersStrip`, `FoundGroups`, `Board`, `Panel`, `FinalScoring`.

**Overlays** — `RevealOverlay` (pass-and-play, built in the prototype at
[index.html:606-613](../../../prototype/index.html#L606-L613), absent from `PassAndPlayPage.tsx`).

## Responsive: desktop and tablet

Target **≥768px**. Phone is explicitly out of scope — it forces the panel below the board and a much
smaller grid, which is a different design problem, better faced when online play (Phase 5) makes
solo-device use the common case.

The prototype's one hard layout law holds across the range: **the full 9×12 grid always fits and
nothing scrolls** ([README.md:93](../../../prototype/README.md#L93)). Tablet is the natural
pass-and-play device — a shared screen passed around a table — so it is a first-class target, not a
degraded desktop.

Board text scales with tile size via container-query units, as the prototype does
([components.css:68](../../../prototype/components.css#L68)); this is what makes one board component
work across the range without breakpoint-specific font sizes.

## Board parity

`Board.tsx` diverges from the prototype in ways easy to miss. All of these close here:

- Coordinates render as `{r}-{c}`; they must be `A1`.
- The last-placed tile is badged with the player's **full name**; it should be their initial.
- No chain outlines.
- No blocked/dead-tile treatment.
- No hover-reveal of coordinates on founded tiles.

## The catalog route

The React equivalent of `states.html`, and the acceptance surface for this phase.

- Route `/catalog`, lazily imported so the golden games and fixtures stay out of the main bundle.
- Sections in turn-step sequence, each showing all of that step's states — the organisation
  `states.html` already uses, which is good and should survive.
- Each state names the golden game and step index it came from.

**Fixtures come from the golden games** via `replayGoldenGame`, not hand-authored props. This is not
a formality. `states.html`'s `FS_SCORE` prices Gobble at `$1000` for a 41-tile chain
([states.html:116](../../../prototype/states.html#L116)); the correct figure from
`getSharePriceAtSize` is `$1200`. That is the same error that reached two separate Phase 0 task
briefs. Deriving fixtures from the engine makes the class of error impossible.

**Known limit, to be handled rather than discovered:** the golden games were authored as *rules*
tests, not visual ones. G8 exists to prove a tile between two safe chains is dead — it was never
meant to look like anything. Some catalog states have no golden game behind them at all: empty
staging, the atom vocabulary, a zero-count stack.

So the catalog is golden-derived **where a golden game covers the state**, and hand-authored
view-only fixtures elsewhere — with the two visibly distinguished in the catalog, so nobody mistakes
an authored fixture for engine-verified truth. If a state that *should* have engine backing has
none, that is a finding for Plan 1a's coverage task, not a reason to hand-author it.

## Testing

`@testing-library/react` and `jest-dom` are already installed.

Per component, tests for the states its props allow — a stack at count 0, 1, 2 and 6 (the depth
thresholds); a tile in each of its seven states; staging empty vs filled vs with an action; a price
with and without `next`. Behaviour is thin in this phase because nothing is wired, so these are
prop-shape and rendering assertions, deliberately.

Two tests earn their place beyond that:

- **Panel-height stability.** The five zones must not change height as content changes. This is a
  stated principle that no human eye reliably checks, and it is the one Phase 1 regression that
  would be genuinely annoying to find in Phase 2.
- **`prefers-reduced-motion`.** Enter animations are skipped when it is set.

The catalog remains the *visual* judgment surface. It is not an assertion surface, and it gets no
snapshot tests — snapshots churn constantly during a from-scratch rebuild, and churning snapshots
get blind-approved.

---

## Out of scope

- **Game wiring.** No component reads or dispatches. Phase 2.
- **Phone viewports.**
- **Deleting the old components.** Phase 2's list, deleted there.
- **Fixing the two broken files** in `src/`. Both are on that list.
- **The lobby and waiting-room pages.** `WaitingRoom.tsx` is 468 lines and untouched by the
  prototype and by every phase before 5; the roadmap defers it to its own spec.
- **The declare-end affordance and the all-safe reason string.** Deferred to its own spec by the
  roadmap, needed before Phase 2 — not before Phase 1.
- **Everything else in carry-forward §F**, which Phase 2 deletes.

## Corrections to the roadmap

Recorded so these read as findings rather than omissions.

- The roadmap lists the **founding screen grouped by starting price** as "carried over undone
  (refinement #3, still a flat row)." It is built, in both
  [index.html:504-506](../../../prototype/index.html#L504-L506) and
  [states.html:142-156](../../../prototype/states.html#L142-L156). It is a port, not design work.
- The roadmap treats the four "engine carries what the UI needs" gaps as Phase 0 deliverables.
  Three shipped — `ticker`, `Player.emoji`, structured `LogEntry`. The fourth, the snapshot handle,
  is §1a.2 above, and the roadmap's framing of it as a field on the log entry is the thing that
  needs correcting.
- The **pass-and-play reveal overlay** is correctly described: built in the prototype, absent from
  `PassAndPlayPage.tsx`.

## Risks

**Phase 1 sprawl, without the roadmap's mitigation.** "Parity with `states.html`" is gone, replaced
by locked decisions plus the catalog. Locked decisions are a weaker bound than a pixel target — they
constrain *what* a component means but not how long it takes to make it look right. The
counter-pressure is the plan itself: if a task cannot state its done-when without the words "looks
good," it is mis-scoped and should be split.

**The typecheck gate is an unknown quantity.** §1a.1 could be one task or three. It is first in the
plan so the answer arrives before anything depends on it.

**Two component sets coexisting.** Bounded by Phase 2, but during Phase 1 there is no working game
screen. Anyone expecting `npm run dev` to show a playable game will be surprised.

**Tailwind class-name dynamism.** The `BRAND_CLASSES` static lookup is the mitigation, but the
failure mode is silent — an unstyled element, not an error. The completeness test is the guard.
