# Phase 0 → Phase 1 carry-forward

**Date:** 2026-08-03
**Status:** Phase 0 complete; this is the punch list it hands forward
**Branch:** `revamp/phase-0-engine`

Phase 0 rebuilt the rules engine as `engine/`, with `applyIntent(state, intent)` as the single
intent surface and twelve — now fourteen — golden games as the executable rules spec. It landed
at **101 tests across 10 files**, 14/14 golden games, `vite build` clean.

Across fourteen tasks, 40 Minor findings were deferred rather than fixed. The final whole-branch
review triaged them: four were promoted to must-fix and are **done**; the rest are recorded here
so they are not lost. Three further Minors came out of the fix round's re-review.

This document exists because the SDD workspace that held the original ledger is scratch and gets
deleted. Nothing below is a blocker — it is the list of things a future phase should know it owns.

## Fixed before merge

| Finding | Where | Fix |
|---|---|---|
| `declareEnd` could deadlock a finished game | `engine/intents.ts` | Allowed from `'play'` when the player has no legal tile; pinned by G14 |
| Rule constants had 2–3 homes; divergence failed silently | `engine/startups.ts` | Centralised `MAX_BUYS_PER_TURN`, `HAND_SIZE`, `TRADE_RATIO`; `buyShares`' return no longer discarded |
| `window.prompt` in engine code, undetectable under jsdom | `engine/gameLogic.ts`, `vite.config.ts` | Dead stubs deleted; `engine/**` now runs under `environment: 'node'` |
| Tied-merge placement logged nothing; no merge logged its coord | `engine/gameLogic.ts` | Both branches now log; G2/G6 assertions updated |
| `chooseSurvivor` had zero golden coverage | `engine/golden/mergers.ts` | G13 added — a genuine tied merger |
| `StateAssertion.bonuses` was dead vocabulary | `engine/golden/` | Deleted, field and consumer |

## Carried forward

### A. Typecheck debt — recommend an early Phase 1 task

There is no `tsconfig.json` and no typecheck gate, so this debt is currently invisible. Five
findings are all the same finding — *"this breaks the moment `tsc` runs"*:

- `engine/gameTypes.ts:45` — stale `// src/state/gameTypes.ts` path comment
- `engine/gameLogic.ts:654` and `engine/endGame.ts:20` — unchecked `as StartupId` assertions
- `engine/gameLogic.test.ts:54` — possibly-undefined access
- `engine/golden/mergers.ts:10` — `row()` returns `string[]` where `Coord[]` is meant

Adding the gate and working this punch list is one coherent task. Doing it later means
discovering it mid-feature.

### B. Termination gaps

`getEndCondition` requires **every** founded chain to be safe, so a founded chain that can never
reach 11 tiles makes a game unfinishable: `declareEnd` returns `endNotAvailable` and `endTurn`
loops forever with no state change but `turnIndex`.

The engine behaviour in that state is demonstrated. Reachability through legal play is **not** —
it needs a sub-safe chain whose every free neighbour is also dead, which the geometry permits but
nobody has constructed end-to-end. Treat reachability as a suspicion.

This matters because Phase 1's step stack assumes games terminate.

### C. Logging and replay

- The log records a traded-in dead tile's coord, but `GameState` has no discard pile, so
  `placed + Σ hands + bag` drifts below 108 with nothing to reconcile against. A `discarded:
  Coord[]` field would make the invariant checkable by a replay validator.
- `engine/gameLogic.ts:140`'s log detail is imperative (*"choose a brand to found"*) where a
  permanent history should read declaratively.
- Two `'Founded a brand'` entries are emitted per founding, from `grantFoundingShare` and
  `foundStartup`. Not a duplicate record — distinct details under a colliding phase label.

### D. The spec's snapshot handle was not built

The roadmap describes log entries carrying a **snapshot handle**. They shipped as
`LogEntry.stepId: number` with no snapshot. Phase 0's own done-when did not require it, so this
is not a Phase 0 miss — but Phase 1's step stack defines undo as rewinding to a log entry, and
will discover it needs state snapshots the engine does not currently produce.

### E. Golden-catalogue coverage

The catalogue is an executable spec, so gaps in it are gaps in the spec:

- Nothing pins `declareEnd` being **refused** when the condition is unmet. G10 would still pass
  if the guard were removed entirely. Covered at unit level by `engine/intents.test.ts:530`.
- `expectError` covers 3 of the 14 `IllegalIntentCode` values.
- G7 stops at the merge step, so multi-absorbed-chain *sequencing* is never exercised despite
  G7 being the only multi-absorbed game.
- G5's title promises the sole-holder bonus "as one figure" but only asserts the cash total; a
  two-entry implementation would satisfy it identically.
- G4 asserts only `cash`, unlike its five siblings.
- No unit coverage for: negative-count validation, a successful basket spanning two startups,
  `renderLogText` on zero/negative cash, a liquidate-specific no-mutation assertion.

### F. Everything Phase 2 deletes

Do not spend effort fixing code with a scheduled demolition date — but know it is there:

- `handlePlayerLiquidationChoice` (`engine/gameLogic.ts:927-935`) keeps a **third** copy of the
  2-for-1 trade ratio. No caller anywhere, but exported through the barrel `server/` imports.
- `src/Game.tsx:158` calls `require()` in a Vite ESM app — throws on the most common gameplay
  path. `src/components/MergerLiquidation.tsx:17` destructures a `sharePrice` that `MergerContext`
  has not had since `bd73e8b`, rendering "@ $undefined". **The React app does not currently work**;
  the engine is what Phase 0 delivered.
- `MergerPayoutModal` renders a sole-holder bonus as bare "Both" rather than "Majority + minority".
- `src/components/PlayerSummary.tsx:35`'s `(player as any).isConnected` is redundant —
  `Player.isConnected?: boolean` exists.
- 17 `as any` casts in `server/`'s legacy XState machines.
- `handleTilePlacement` treats a would-be-8th-chain placement as isolated, while
  `previewPlacement` correctly calls it `noBrandAvailable`. Two placement authorities that
  disagree; the intent path is safe **only because** `doPlaceTile` pre-checks with the correct
  one. `src/Game.tsx` calls `handleTilePlacement` directly and has this bug live.
- `engine/testHelpers.ts:100` re-implements `getStartupSize`, which already exists at
  `engine/gameHelpers.ts:106` — same name, same semantics, different implementation.
- `engine/gameLogic.test.ts:222` passes a number where a `choice` string is expected, so the call
  matches no `switch` branch and the test regresses nothing.

### G. Tooling footguns

- `vite.config.ts` project globs replace vitest's default include, so a future test at the repo
  root or named `*.spec.ts` would be silently skipped with a green run. All 10 current files are
  covered.
- `server/engineSpike.test.ts` is throwaway — delete it when the real Phase 2 loop lands.
  Its round-trip assertion checks 7 of `GameState`'s ~20 top-level fields while its comment
  implies broader coverage.

## Two process lessons worth keeping

**Briefs should cite the function that computes a value, never the value.** Two task briefs
shipped wrong share prices seven tasks apart — both the same error, reading a price off prose
instead of deriving it from `getSharePriceAtSize`. Both were caught by implementers, but only
because they were told to re-derive.

**Every Phase 0 gate is example-based.** 99 tests and 12 golden games all passed on a state
machine that deadlocked in 8% of random games; a throwaway random-play harness asserting share
conservation and progress found it in seconds. For an engine whose whole purpose is to be the
authority for a multiplayer server, one property/invariant task is likely the highest-value
item available in Phase 1 or 2.
