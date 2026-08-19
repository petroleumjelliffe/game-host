# Phase 2b → Phase 3 carry-forward

**Date:** 2026-08-04
**Status:** Phase 2b complete; this is the punch list it hands forward
**Branch:** `revamp/phase-2b-finishing-the-game` (14 commits, not pushed, not on `main`)
**Plan:** [2026-08-04-phase-2b-finishing-the-game.md](../plans/2026-08-04-phase-2b-finishing-the-game.md)
**Design:** [2026-08-04-phase-2b-finishing-the-game-design.md](./2026-08-04-phase-2b-finishing-the-game-design.md)
**Predecessor:** [2026-08-04-phase-2a-carry-forward.md](./2026-08-04-phase-2a-carry-forward.md)
**By-hand notes:** [2026-08-04-phase-2b-by-hand-notes.md](./2026-08-04-phase-2b-by-hand-notes.md)
**Execution ledger:** [progress.md](../../../.superpowers/sdd/2026-08-04-phase-2b-finishing-the-game/progress.md)

**A game that starts can now finish.** Dead tiles trade, a stuck player can pass, the end can be
declared the moment the engine allows it, and the scoreboard shows real totals. G9 (41-tile end)
and G10 (all-safe end) are driven through the real screen, not just the engine.

## What shipped

| | Before (2a) | After (2b) |
|---|---|---|
| Tests | 363 in 44 files | **387 in 44 files** |
| `src/game/` modules | 33 (28 test files) | **33 (28 test files) — unchanged** |
| New files | — | 0 |
| Gates | vitest, typecheck, vite build, check:bundle, verify:layout | same five |

Numbers are measured, not estimated: `npx vitest run` was run against this branch's HEAD
(`e0d3e3f`) and, in an isolated worktree, against the branch's actual merge-base
(`539408c`, computed with `git merge-base main HEAD` — not the `5150bec` the ledger names, which
is an ancestor of it; `main` picked up several Phase 2a follow-up commits before this branch
diverged). Both runs report 44 files; the branch added 24 tests and zero new files under
`src/game/` — every affordance this phase built landed inside files that already existed
(`useTurnPanel.tsx`, `GameScreen.tsx`, `FinalScoring.tsx`, `PassAndPlayPage.tsx`), which is exactly
what the design predicted: three affordances inside an existing stage switch, one overlay in an
existing screen, two callbacks on an existing page.

**No new files anywhere.** `git diff --stat main..HEAD` shows 15 files touched (including this
carry-forward doc, committed after the count above was first measured), all of them
either pre-existing implementation files or this phase's own docs — no new component, no new
test file, no new script.

## Whether the "no engine changes" prediction held

**It held, with the one exception the design itself predicted.** `git diff main..HEAD -- engine/`
is a single ten-line hunk in `engine/intents.ts`: `hasLegalTile` gains the `export` keyword and a
doc comment. No rule changed — it is the exact predicate `doEndTurn` already gated on, and
exporting it is what stops the UI from ever computing a second, potentially-drifting opinion about
whether a player can move. Nothing else under `engine/` changed: no other file in that directory
appears in the diff at all. This is the first phase in the roadmap where the design's own "no
engine changes expected" line was correct in full.

## The human adjudication on undo

**The plan and the design were both wrong about whether a declared end is undoable, and the
ruling is: it is not, on purpose.**

The design's risk section and the plan's Task 3 Step 6 both asserted that ending the game is
undoable within the declaring player's own segment, "consistent with every other decision." The
implementer wrote the test that assumption implied and watched it fail:
`session.undoTo(stepId)` threw `no snapshot for step 2`, because `declareEnd` moves the actor from
the declaring player to `null`, and `GameSession`'s `syncSegment()` treats any actor change —
including "the game is over, there is no actor" — as a segment boundary. It closes the segment and
prunes every snapshot below the new boundary, including the declaration's own. There is no special
case for "the new actor is null because the game ended" versus "the new actor is the next player."

This was escalated to the human partner rather than silently coded around. **Ruling: code governs.
Ending the game is a handoff like any other handoff, and treating it as one is the segment model
working as designed, not a bug in it.** The test was rewritten to assert finality instead — after
`declareEnd`, `undoableSteps` is empty — and `GameSession.ts` itself was not touched. Practically,
this was never reachable from the UI in the first place: an empty undo range renders no undo
control in `StepStack`, so only a direct `session.undoTo()` call (bypassing every button a player
could click) could ever have exercised the case the original test assumed. The by-hand pass
confirmed this live: after clicking "End the game," the step stack shows a "Game over" entry with
no `↺ undo` beside it, anywhere in the panel.

Anyone reading the design's risk section ("Undo across the declaration... is the one undo that
un-ends a game") or the plan's Task 3 Step 6 verbatim should read them as superseded by this
ruling, not as the shipped behaviour.

## Two bugs in the same overlay, one hiding the other

Task 4's review and Task 8's by-hand pass each found a defect in the same three-line button row,
and they are the same underlying mistake wearing two different symptoms.

**Bug one (review, fix round 1, commit `7692c84`): the buttons were unclickable.**
`FinalScoring` renders its own `absolute inset-0 z-50` backdrop as its first child. The "New
game" / "Back to menu" row was a plain, unpositioned sibling after it — and an unpositioned
element always paints *under* a later positioned, z-indexed sibling, regardless of DOM order.
`document.elementFromPoint` at each button's centre resolved to `FinalScoring`'s backdrop, not the
button. `fireEvent.click` in vitest dispatches straight at the DOM node and bypasses hit-testing
entirely, which is why 17 green jsdom tests said nothing was wrong. Fixed by giving the row its
own stacking context (`relative z-[60]`), proven with a real `elementFromPoint` + dispatched
`MouseEvent` in headless Chrome, not `fireEvent`.

**Bug two (by-hand, Task 8, commit `d92d331`): fixing bug one made bug two visible for the first
time, at a position that was wrong all along.** `FinalScoring`'s root being `absolute` means it
contributes no flow height. The button row's `mt-6` was therefore measured from the *scrim's* top
edge, not the card's bottom — so the row always rendered near the top of the overlay, wherever the
vertically-centred card's top happened to land. At 1440px there was enough horizontal room next to
the winner banner to mostly avoid overlap by luck; at 768px there wasn't, and the buttons sat
directly on top of the winner's name and cash figure — the first thing a player looks at on the
screen that declares who won. Nobody had seen this before Task 8, because bug one had kept the
row hidden under the backdrop the whole time bug two existed. Fixed by giving `FinalScoring` an
`actions?: ReactNode` slot rendered *inside* the card's own document flow, which also let the
`z-[60]` hack from bug one's fix be deleted — there is nothing left to lift above once the buttons
are inside the card's own stacking context.

**Both are the same class of mistake:** a component's internal positioning (`absolute inset-0`,
whether for the backdrop or the card) leaking into what a caller may safely place beside it. The
first fix corrected stacking order without touching flow; only having a human actually look at the
result exposed that flow was wrong too. Fixing bug one was necessary to see bug two.

**Fixing bug two required reversing a stated constraint.** Task 4's brief said "do not modify
`FinalScoring`," on the grounds that the component should own no routes or handlers. The by-hand
fix modified it anyway — disclosed in the findings doc and in the component's own doc comment —
but the property the constraint actually protected still holds: `actions` is an inert slot the
caller fills, `GameScreen` still owns `onNewGame`/`onExit`, and `FinalScoring` still contains no
navigation logic of its own.

**A regression seam was found and closed in the same pass.** `GameScreen.test.tsx`'s pre-existing
"offers a new game and a way out" test used an unscoped `screen.getByRole` query, so it would
pass identically whether the buttons went through the new `actions` slot or reverted to the
broken sibling layout — nothing pinned the fix at the seam where the bug actually lived. A scoped
test (`keeps the end-game actions inside the scoreboard card`) was added in the fix round.

## A controller process error, recorded honestly

Task 8's fix round required a fails-first proof for the new scoped regression test above. The
implementer subagent died to API errors twice at the commit step — after its work was already on
disk and verified — so the controller finished the bookkeeping, including producing that proof.

**The first attempt was wrong, and wrongly reported.** The controller tried to reproduce the
pre-fix state by renaming the `actions` prop so the slot went unfilled, and reported that the new
scoped test failed while the old unscoped test "continued to pass." Both halves of that claim were
false: renaming the prop doesn't reproduce the historical sibling layout at all — the buttons are
declared inside that JSX expression, so renaming the prop deletes them from the DOM rather than
moving them outside the card — and the run had actually produced **two** failures, not one; the
unscoped test failed too, exactly as it must when no button exists anywhere. The scoped
re-reviewer caught this from the code alone — an unscoped `getByRole` cannot pass while a button is
absent, so the two reported facts could not both be true — and demanded a real proof rather than
accepting the report.

**The corrected attempt was valid.** `GameScreen.tsx` was reverted to the genuine historical shape
— `<FinalScoring {...finalScore(state)} />` followed by the button row as a plain sibling `<div>`
— and re-run: exactly one failure (the new scoped test), 17 passing, including the old unscoped
one. That is precisely the blind spot the finding named, closed correctly. Restoring the fix
returns the suite to 18/18.

This is recorded per the ledger's own standard: a carry-forward that only records other people's
mistakes is not honest. The substitution — a controller finishing an implementer's bookkeeping
after a crash — is exactly the seam where the bad proof crept in, and is worth remembering next
time an implementer dies mid-task and someone else picks up the last step.

## Plan defects caught during implementation

Every phase so far has found defects in the plan's own test code, never in the rules being tested.
2b is the fourth consecutive phase where this held, and every instance this time was a query
collision or an over-driven fixture — invisible until real markup and a real golden game existed
to collide with.

1. **Task 4 — two query collisions in the same test file.** `screen.getByText('$27,800')` matched
   twice: `FinalScoring`'s winner banner restates the winner's total in its own sentence, and the
   scoreboard's total row shows the same figure for the same player. `screen.getByText(/reached 41
   tiles/i)` also matched twice: once in the new overlay, once in a pre-existing "Game over" log
   entry in the step stack. Both were resolved by scoping the query (`data-fs-row="total"`
   specifically; `within(final-overlay)`), not by touching production code or the expected
   figures — the brief was explicit that a totals mismatch must never be "fixed" by editing the
   numbers, since G9's totals are already pinned against the engine by `golden.test.ts`.
2. **Task 6 — the same collision recurred**, and the fix generalized it: scoping to
   `within(final-overlay)` alone would *not* have resolved the dollar-figure collision, since both
   colliding elements are inside the overlay. The working fix scoped to the total row specifically.
3. **Task 6 — G11's driven test drove the golden game past the behaviour it meant to assert.** The
   plan's template loop ran all of G11's steps and then asserted the game had **not** ended — but
   G11's own third step is Sam calling `declareEnd`, which legitimately ends the game; G11's point
   is that declining doesn't forfeit the option forever, not that the game never ends. Running all
   three steps therefore correctly reached `stage: 'end'`, and the assertion was unsatisfiable by
   the golden game's own design, not by any defect in the screen. Fixed by driving
   `game.steps.slice(0, -1)` — the decline and the one normal turn after it — leaving the
   assertion itself untouched.

None of these were engine or production-code defects; all three are in test code the plan wrote
before any markup existed to collide with, which is the same lesson Phase 2a's carry-forward
recorded about its own plan (Task 6's segment tests, Task 15's seed-dependent assertion).

## The uncovered gap, stated honestly

**`verify:layout` does not dimensionally cover the end overlay, and it is not pretending to.**
The design's original claim — that the gate would cover the overlay "as the curtain check already
does for the reveal" — turned out to be wrong, and Task 7 corrected it rather than shipping a
check that only looked like it worked. The gate reaches every state it measures by *playing* the
real app; reaching `stage: 'end'` needs a 41-tile chain or every founded chain safe, which by
hand took an observed ~500 interactions and multiple minutes per viewport in Task 8's own attempt
(two of three driven walks were abandoned mid-session for exactly this reason). The gate currently
runs in ~17-22 seconds and runs before every commit; growing that to minutes to cover one overlay
was rejected as a bad trade, deliberately, not by oversight.

What exists instead, and what does not:

- **Structural coverage, in jsdom** (Task 4): the overlay carries `data-testid="final-overlay"`
  and `inset-0` at `stage: 'end'`.
- **A dormant dimensional check** (Task 7): `verify:layout` now measures
  `[data-testid="final-overlay"]` against the surface, using the same rounded-equality rule as the
  curtain check, *if the overlay is ever present in the DOM during the gate's walk*. Confirmed
  `null` at both viewports on every run so far, because the walk never reaches `end`. This check
  has never fired in anger and is not proof of anything by itself — it is insurance for the day
  something does reach `end` during the gate, or a "skip to end" affordance is added.
- **Real-page coverage, by eye** (Task 8, by-hand notes): confirmed at 1440px and 768px, in both a
  hand-mounted fixture and one genuine 41-tile end reached by actually playing.

Do not read the dormant check as coverage. The gate's own log prints `finalOverlay: null` on every
normal run; the only thing standing between "the overlay covers the surface" and "nobody checked"
on any given commit is the by-hand pass and the structural jsdom assertion.

## Residual risk

- **`verify:layout` does not cover the end overlay dimensionally**, for the reason above. Recorded
  here and by Task 7 as an accepted, permanent-until-something-changes gap, not a TODO.
- **The `SocketProvider` console noise is still present**, unchanged since the 2a carry-forward
  recorded it: `main.tsx` wraps the app in `SocketProvider`, which dials the server on mount
  regardless of route, so `/pass-and-play` still prints `❌ Connection error: websocket error`
  repeatedly with no server running. Fixing it means changing when the transport connects, which
  is Phase 3's subject; 2b did not touch it.
- **`Game.tsx` and the six modals still serve `/room/:roomId`.** Nothing under
  `src/components/` or `src/Game.tsx` was touched this phase, per the Global Constraints. `src/`
  still has two live game screens, and only one of them (`GameScreen`) has real test coverage.
- **The buy/liquidation staging basket is still local component state**, and the end overlay adds
  a new instance of the same fact the design already named as deliberate: declaring the end (or
  clicking "New game") drops any half-built staging basket along with the session. Correct, and
  worth restating so it isn't mistaken for a new bug.
- **The players strip's cash stays present in the DOM at `stage: 'end'`, behind the overlay.** Not
  a defect — Task 8's by-hand check 6 used it deliberately to cross-check the scoreboard's totals
  — but worth naming so nobody is surprised to find it there while poking at the DOM under the
  overlay.

## Deviations from the plan, and why each was right

| # | Plan/design said | Shipped | Reason |
|---|---|---|---|
| 1 | `verify:layout` covers the overlay "as the curtain check already does" (design) | The gate cannot reach `end` by playing without costing minutes; a dormant structural check was added instead, and the gap is stated plainly (Task 7) | Reaching `end` by playing takes an observed several minutes per viewport, against a gate that currently costs ~17-22s and runs before every commit. Claiming coverage that isn't there would be the kind of guard Phase 1a shipped that protected nothing. |
| 2 | The declared end is undoable within the declaring player's segment (design risk section, plan Task 3 Step 6) | It is final; no undo is offered past a declaration | See "The human adjudication on undo" above. `declareEnd` moving the actor to `null` closes the segment like any other actor change, by the existing, deliberate segment model — code governs. |
| 3 | Task 4's brief: do not modify `FinalScoring.tsx` | `FinalScoring` gained an `actions?: ReactNode` slot (Task 8, by-hand fix) | The by-hand pass found that the button row's position was wrong regardless of the z-index fix, and the only correct fix was moving the buttons inside the card's own flow. Disclosed explicitly; the property the constraint protected (the component owns no routes/handlers) still holds. |
| 4 | Task 8's brief: reach an end by playing a real two-player game | A mix of real play (one genuine 41-tile end reached) and direct fixture mounting via a throwaway debug route, deleted before committing | Two of three real walks stalled for several minutes without reaching an end state and were abandoned per the coordinator's direction not to wait on a stalled walk indefinitely. Fixture mounting reaches the same real component tree, hit-tested the same way, for the states real play could not reach in budget. |
| 5 | "The final board position stays visible behind the overlay, dimmed" (design, Risks section) | The board is not, in fact, visible. `GameScreen.tsx`'s overlay wrapper is `bg-white/95`, and `FinalScoring` renders its own `bg-gray-900/60` scrim on top of that — the two together read as opaque, not dimmed. | The by-hand pass verified and approved the current look; this is not a bug to fix, it is the design doc stating an intention that shipped differently. Recorded here rather than silently left wrong, per the same "an honest carry-forward doesn't only record other people's mistakes" standard as the rest of this document. The visual is not being changed to match the sentence — the sentence was aspirational and the shipped look is the approved one. |

## What comes next inherits

- **The draw screen**, specified in the 2a carry-forward and still unbuilt. The turn-order draw
  still resolves in a single click with the result only visible as a log line; it deserves its own
  opening screen showing each player's drawn tile and who won. The house rule to preserve when
  building it: **highest tile wins** (highest letter, then highest number — I12 beats A1), the
  reverse of tabletop Acquire and a deliberate departure, already implemented in the engine
  (`main` commit `539408c`, this branch's merge-base) and unrelated to anything 2b touched.
- **Phase 3's transport work**, unchanged in scope: making `server/` authoritative, fixing when
  `SocketProvider` connects, and deciding whether a reconnect restores or drops an in-progress
  staging basket (a question the 2a carry-forward already posed and 2b's own end-overlay behaviour
  reinforces, since dropping the basket on "New game" is the same answer applied to a different
  trigger).
- **Deleting `Game.tsx` and the six modals** still serving `/room/:roomId`, deferred to Phase 3/5
  as before. `GameScreen` is now the more complete screen — it is the only one that can finish a
  game — which sharpens the case for deletion without changing when it happens.
- **`LiqQueue`'s design review**, still outstanding from Phase 1b and restated in the 2a
  carry-forward; untouched by 2b.
- **`DrawModal.tsx`'s wrong caption** ("Lowest letter, then lowest number goes first") in
  `src/components/`, still off-limits until Phase 3/5, still wrong on screen for `/room/:roomId`.

## Process lessons

**The by-hand step earned its budget a fourth time, and found the deeper of two overlapping
bugs.** 381 green tests and a clean review had already fixed the click-target bug in the same
button row; only a human looking at 768px specifically found that fixing it had merely made a
second, pre-existing bug visible. This is the fourth phase running (1b, 2a, and now 2b twice —
once per bug) where the single "open it and look" step found what automated gates and review did
not.

**A dormant check is not a covered gap, and saying so plainly is the honest move.** Task 7's
insurance check for the end overlay has never fired and, under current gate design, may never
fire. Recording it as "added" without recording it as "dormant" would have been the same mistake
Phase 1a's `check:bundle` made before Phase 2a's carry-forward called it out.

**A crash mid-task is not an excuse to skip the proof it required.** Task 8's fix round needed a
fails-first proof; the implementer died before producing one, the controller produced an invalid
one under time pressure, and a second reviewer — reasoning from the code alone, not from watching
the run — caught the contradiction and demanded it be redone properly. The mechanism worked. The
process gap it exposed — a controller absorbing bookkeeping after an implementer crash is exactly
where an unverified claim can slip through — is worth designing around before it recurs.
