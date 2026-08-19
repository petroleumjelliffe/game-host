# Phase 1a → Phase 1b carry-forward

**Date:** 2026-08-03
**Status:** Phase 1a complete; this is the punch list it hands forward
**Branch:** `revamp/phase-1a-engine-hardening`
**Plan:** [2026-08-03-phase-1a-engine-hardening.md](../plans/2026-08-03-phase-1a-engine-hardening.md)

Phase 1a added a typecheck gate, a discard pile, a snapshot store for undo, a vitest-free golden
replay path, a random-play invariant harness, and closed the golden-catalogue coverage gaps. It
landed at **162 tests across 13 files**, with `vitest`, `typecheck`, `vite build` and `check:bundle`
all green.

This document exists because the SDD workspace holding the ledger is git-ignored scratch and gets
deleted. Nothing below blocks Plan 1b.

## What Phase 1a actually changed about the engine

One rules-behaviour change, and it was found by the new harness rather than by a human:
`completePlayerMergerLiquidation` removed absorbed shares from a liquidating player's portfolio
without crediting `startups[absorbedId].availableShares`. The pool was reconciled in bulk at
`engine/gameLogic.ts:739`, but only once the *last* shareholder finished, so `held + available === 25`
was violated at every intent boundary in between. Since `applyIntent` is server-authoritative and its
output is broadcast, every client watching a multi-liquidator merger saw a wrong share count.

Everything else on the branch is tests, types, and new modules.

## Residual risk — read before building on this

**The harness bypasses the real game's entry point.** `createInitialGame` returns `stage: 'draw'`, and
no intent accepts `'draw'` — every `requireStage` in `engine/intents.ts` names only `play`,
`foundStartup`, `chooseSurvivor`, `mergerLiquidation` or `buy`. So the state a real client starts from
cannot be advanced through `applyIntent` at all. The harness sidesteps this by building its opening
position with `buildFixture` at `stage: 'play'`. `src/Game.tsx` calls `createInitialGame`, which is
part of why the app does not run. **The opening sequence is untested by anything on this branch.**

**Dead stages persist.** `draw`, `dealHands`, `mergerPayout`, `liquidation` and `liquidationPrompt`
are all in the `Stage` union with no intent that accepts them, and the legacy liquidation path can
still set two of them. Nothing reaches them today, and the harness's stall detector will report them
if anything ever does.

**`structuredClone` vs `JSON.stringify`.** The snapshot store clones with `structuredClone`
(`engine/history.ts`), but its tests compare with `JSON.stringify` throughout. The two are not
equivalent for `undefined`, `Map` or `Date`. When Phase 3 wires the store to a server and snapshots
cross a serialization boundary, a divergence there would be invisible to the current tests. Nothing
exercises `discarded` through the server's JSON round trip either.

**No CI.** There is no `.github/` at all. `typecheck` and `check:bundle` are scripts a human has to
remember to run. The plan required the gate to exist, not to be enforced — but "we added a typecheck
gate" reads stronger than what shipped. A three-line workflow closes it.

**`check:bundle` guards nothing yet.** No file under `src/` or `server/` imports `engine/golden/*`, so
the guard is forward-looking. Its first real test is Plan 1b's catalog route. Re-verify it there
rather than assuming a green run today means anything.

**`tsconfig.server.json` is unenforced.** It extends the main config and sets `noEmit: false` with an
`outDir`. Nothing runs it (`build:server` is an `echo`). Benign, but it is a second config over
`server/` that no gate covers.

## Carried findings

### A. Worth doing when the file is next open

- `engine/golden/golden.test.ts` hand-maintains the 14 `IllegalIntentCode` strings with no
  compile-time tie to the union. The list is exactly correct today (verified), but a 15th code would
  need manual addition or the coverage test silently lies. Fix: a `satisfies Record<IllegalIntentCode, true>`
  keyed object instead of a string array.
- Four copies of the `row()` helper exist (`engine/golden/endgame.ts`, `engine/golden/mergers.ts`,
  and two in `engine/intents.test.ts`). Export one from `engine/golden/fixtures.ts`.
- `check:bundle` silently no-ops if `dist/assets` does not exist — `2>/dev/null` swallows grep's
  exit 2 the same as exit 1, and `!` inverts both to success. A `test -d dist/assets &&` prefix
  hardens it.
- `engine/intents.test.ts` cites a derivation comment in `buying()` that does not exist. The
  derivation itself is correct.
- Comment typo in `engine/golden/mergers.ts`: "Gobble and Gobble/ZuckFace are tied" should read
  "Gobble and ZuckFace".

### B. Test-teeth gaps the fix wave left open

Both are non-blocking and both were flagged by the re-review rather than discovered later:

- **The progress invariant is unexercised.** `createProgressGuard` shares the stall detector's exact
  trigger and threshold, and the stall check runs first, so the progress guard never independently
  fires in the committed suite. It remains a real backstop for a different bug class — a *successful*
  intent that fails to advance `nextStepId` — but that role has no test. A unit test calling
  `createProgressGuard()` directly would prove its teeth.
- **`discarded` coverage is not pinned.** `emptiedBag` and `reachedEnd` have dedicated committed
  assertions; the 28-of-60 non-empty-`discarded` figure came from a scratch script. An
  `it('at least one game exercises tradeInDeadTiles')` would give it parity.

### C. Error-vocabulary smell

`doBuyShares` checks `!startup || !startup.isFounded` before any count validation, so a **negative**
pick count throws `brandUnavailable` rather than `shareCountMismatch`. Misleading to a client. Pinned
as current behaviour in `engine/intents.test.ts`; changing it is a behaviour change and belongs in an
error-vocabulary pass.

### D. Structurally impossible, resolved elsewhere

Nothing distinguishes a sole holder's merger bonus being **one** combined entry from **two** entries
summing to the same total — *at the golden-catalogue level*. This cannot be fixed there:
`mergeStartups` sets `isFounded = false` (`engine/gameLogic.ts:725`) in the same intent that computes
the bonus, and `finalScore` only reports founded chains (`engine/endGame.ts:17-28`), so no golden
assertion can ever observe an absorbed chain's bonus shape.

It is closed at unit level instead — `engine/bonuses.test.ts` asserts `toHaveLength(1)` *and*
`type === 'both'` independently of the amount. The residual gap is "no golden coverage", not
"unpinned". Nothing further is owed; this is recorded so it is not rediscovered as a surprise.

### E. Legacy code with the same bug, deliberately not fixed

`handleLiquidationChoice` (`engine/gameLogic.ts`) carries the *same* share-conservation bug that was
fixed on the intent path, and parks the game in `stage: "liquidationPrompt"`, which no intent accepts.
It is reachable only from `engine/gameLogic.test.ts`. It now carries a `@deprecated` doc comment so a
future reader does not patch the wrong function. Phase 2 deletes it.

## Process lessons

**Three defects in the plan were caught by implementers and reviewers, not by its author.** All three
would have produced silently-passing work:

1. The Task 2 brief's conservation test used `bag: ['I12']`, and `buildFixture` does not auto-fill
   unlisted coords (`spec.bag ?? []`). The assertion would have summed to 25 and compared it to 108.
2. The Task 3 brief's `rewindTo` deleted keys `>= stepId`, which made its own idempotence test and its
   drop-forward test mutually unsatisfiable.
3. The Task 4 brief's `check:bundle` grep pattern was a false negative — Rollup inlines vitest's
   source, so `from'vitest'` never survives bundling even when vitest genuinely is bundled in.

**Instructing implementers to report rather than work around is what surfaced all three.** Each brief
said, in some form, "if a test looks wrong, that is a report, not an edit." Every one of those reports
was correct.

**A guard's own coverage is the thing to check.** Two of this plan's guards did not guard when first
written. The snapshot store's tests all passed with *both* `structuredClone` calls removed. The
invariant harness reported zero stalls while 8% of its games were provably wedged — the same failure
rate, and the same shape, as the Phase 0 deadlock the harness was built to catch. Neither was visible
from inside its own task; the first took a reviewer deleting code to see if anything failed, the
second took a whole-branch review.

**Depth numbers need re-deriving after any harness change.** The first reported figures (55/60
reaching `end`, 6/60 emptying the bag) were inflated twice over: `shuffleSeeded` hashes by summing
character codes, so 60 seeds were really 24 distinct games, and five of the six bag-emptying runs were
the wedged ones. The honest figures after the fix are 48/60 reaching `end`, 30/60 emptying the bag,
28/60 with a non-empty discard pile, 0 stalls.
