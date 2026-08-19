# The panel against the prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between `prototype/index.html`'s panel and ours in one deliberate pass, and
write down every place we differ *on purpose* — so the remaining differences are decisions rather
than accidents.

**Why now.** Five of the twenty-six Phase 5 findings were the same shape: a behaviour the prototype
has, an atom that still supports it, and a prop the port dropped on the way across. The traded-shares
pile, the "new" badge, the removable staging stacks, the buy-row empty state, the sold-out card —
each found separately, by eye, one screen recording at a time. Reading the two side by side is
cheaper than finding the sixth the same way.

**Architecture:** No new components. Every item is copy, a prop, or a small body change in
`useTurnPanel`. Nothing touches `engine/`.

**Method note.** The prototype is a *reference, not a target*. Three of the differences below are
ours on purpose and the plan says so; porting them back would undo decided work. The point of the
pass is that every difference ends up in one of two lists.

## Global Constraints

- **`prototype/` is untouched.** It is read-only reference.
- **`engine/` is untouched.** Nothing here is a rules change.
- **No `as any`.** Narrow with the engine's type guards.
- **Derive from the engine, never hardcode.** Counts, prices and caps come from state or from
  `engine/startups`' constants (`MAX_BUYS_PER_TURN`, `TRADE_RATIO`), never from a literal.
- **Every new test is observed failing first**, with the break named in the task.
- **jsdom reports zero for every layout measurement** — anything about fit or height is
  `npm run verify:layout`'s business.
- **Commands:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`,
  `npm run verify:layout`.

---

## The comparison

Read from `prototype/index.html`'s `activeStepHtml`, `stagingHtml`, `handHtml` and `playersHtml`
against `src/game/screen/useTurnPanel.tsx` and the zone components.

| Step | Prototype | Ours | Verdict |
|---|---|---|---|
| Place a tile | label, hand tiles, hint *"Tap a highlighted tile — on the board or here."* | label, hand tiles, dead-tile sentence, trade-in and End turn buttons | **Task 1** — restore the hint |
| Found | *"Found a startup"*, price groups | *"Found a brand"*, price groups | **Task 2** — one word, one decision |
| Merger tie | *"{A} & {B} Merger"*, tied chains as **stock stacks showing your holding** | *"Which chain survives?"*, tied chains as bare brand chips | **Task 3** — the holdings are the decision |
| Liquidation | *"Liquidate ZuckFace — Sam"*, queue, actions, hint *"N ZF left to sort"* | *"Liquidate shares"*, queue, actions | **Task 4** — name the chain and the player |
| Buy | *"Buy shares (1/3)"* | *"Buy shares"* | **Task 5** — the cap is invisible |
| Staging (buy) | *"Staging — commits on end turn"* | *"Buying"* | **Task 6** — say when it commits |
| Staging (liq) | *"Staging — Sam's liquidation"* | *"Keeping 3"* | **Task 6** |
| Hand / players | turn-start wallet until the turn folds | live engine cash | **Task 7** — a question, not a fix |
| Merger payout | its own step with a Continue button | settled by the engine, filed in the log | **keep ours** |
| Turn complete | a *"Start new turn"* step | the curtain | **keep ours** |
| Buy empty state | *"No shares available to buy."* | *"Found a startup to buy shares."* | **keep ours** — says what to do rather than what is missing |

---

## Task 1: The placement hint comes back

**Finding:** the prototype tells you where the tiles can be tapped. We dropped that line in Phase 3b
because the panel showed no tiles at all — the board was the only place to tap, and a hint pointing
at "here" would have pointed at nothing. Phase 5's Task 11 put the hand in the panel, so the
sentence is true again and the ambiguity it resolves is real: the same tile is now in two places.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `play` branch); test alongside.

- [ ] **Step 1: Write the failing test.** In the play branch, with a viewer holding tiles, the panel
  carries the hint. It must *not* appear when the viewer has no playable tile — a hint about tapping
  is noise next to "no tile you hold can be played".
- [ ] **Step 2:** Render it, in the muted treatment the dead-tile sentence uses.
- [ ] **Step 3: Break it** by rendering it unconditionally; confirm the no-playable-tile case goes
  red. Restore.
- [ ] **Step 4:** Suite, typecheck, `npm run verify:layout` (a line added to the active zone is the
  zone that squeezes the step stack), commit.

## Task 2: "Found a startup", not "Found a brand"

**Finding:** the prototype says *startup*, we say *brand*, and the buy step's new empty state (Task
17) already says *startup*. Both words are in the app today.

**Files:** `src/game/screen/useTurnPanel.tsx` (`stageLabel`); tests matching the old text.

- [ ] **Step 1: Pick one and apply it everywhere.** Recommendation: **startup** — it is the
  prototype's word, it is what the empty state says, and it is what the engine's own type is called
  (`StartupId`, `AVAILABLE_STARTUPS`). "Brand" survives in `Brand`, the component, which is fine:
  that is a thing on screen, not a word in a sentence.
- [ ] **Step 2:** Grep the whole of `src/` for the loser and change every instance, tests included.
  A half-applied rename is worse than either word.
- [ ] **Step 3:** Suite, typecheck, commit.

## Task 3: The tied chains show what you hold in them

**Finding:** choosing a survivor is a decision about your own position, and the prototype renders
each tied chain as a **stock stack carrying your holding and its price**. Ours renders bare brand
chips, so the one number that decides the choice is not on screen.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `chooseSurvivor` branch); test alongside.

- [ ] **Step 1: Write the failing test.** With the viewer holding different counts in two tied
  chains, both counts render, and clicking one still dispatches `chooseSurvivor` for it.
- [ ] **Step 2:** Swap `Brand` for `StockStack` with `price` and the viewer's count — the same atom
  the staging pile and the hand zone use, so a share reads as a share everywhere.
- [ ] **Step 3:** Mind the nesting: `Brand` in `select` mode renders its own `<button>`, and so does
  a clickable `StockStack`. Nested buttons are invalid HTML and break `getByRole`. One control per
  chain.
- [ ] **Step 4: Break it** by rendering the actor's holdings instead of the viewer's; confirm a
  watcher's case goes red. Restore.
- [ ] **Step 5:** Suite, typecheck, `npm run verify:layout`, commit.

## Task 4: The liquidation step names the chain and the player

**Finding:** ours says *"Liquidate shares"*. The prototype says *"Liquidate ZuckFace — Sam"*, which
is the two facts that matter when a queue is working through several holders: which chain is being
sorted, and whose turn in the queue it is. Online this is worse than in pass-and-play — a watcher
sees a liquidation step with no indication that it is not theirs.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `mergerLiquidation` branch); tests alongside.

- [ ] **Step 1: Write the failing test.** The label names the absorbed chain and the acting
  shareholder, both derived from `mergerContext` and the roster rather than written down.
- [ ] **Step 2:** Implement. `stageLabel` takes only a stage, so this label is built in the branch
  where the context is in hand — do not widen `stageLabel` to reach for state.
- [ ] **Step 3: Consider the hint too** (*"N ZF left to sort — results stage below"*). The count is
  already on screen in the staging zone as `Keeping N`, so recommendation is **no** — but say so in
  the commit rather than leaving it unmentioned.
- [ ] **Step 4: Break it** by hardcoding the actor's own name; confirm the queue case goes red.
  Restore.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 5: The buy step shows the cap

**Finding:** three shares a turn is a rule you discover by hitting it — the cards simply stop
responding. The prototype puts the count in the label: *"Buy shares (1/3)"*.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `buy` branch); test alongside.

- [ ] **Step 1: Write the failing test.** The label reflects staged picks plus what the turn already
  committed (`state.currentBuyCount`), against `MAX_BUYS_PER_TURN` — a player who bought one card,
  then staged another, is at 2/3. Both halves matter: the branch already computes `remaining` from
  the same two numbers, and a test that only stages would pass while ignoring the committed half.
- [ ] **Step 2:** Implement from `MAX_BUYS_PER_TURN`, never a literal 3.
- [ ] **Step 3: Break it** by counting only staged picks; confirm the mid-turn case goes red.
  Restore.
- [ ] **Step 4:** Suite, typecheck, commit.

## Task 6: The staging zone says what staging *is*

**Finding:** the prototype labels the zone by its nature and its commit point — *"Staging — commits
on end turn"*, *"Staging — Sam's liquidation"*. Ours restates the step above it (*"Buying"*) or a
number already in the pile (*"Keeping 3"*). The one thing a new player needs from that zone — that
nothing here has happened yet — is the one thing it does not say.

**Files:** `src/game/screen/useTurnPanel.tsx` (all `StagingZone` labels); tests matching the text.

- [ ] **Step 1:** Label the buy zone with its commit point. The button beneath it already says
  `Confirm purchase` / `End turn`, so the label should carry the *pending* half rather than repeat
  the action.
- [ ] **Step 2:** Label the liquidation zone with whose sort it is. `Keeping N` moves into the pile's
  own stack, where the number already lives.
- [ ] **Step 3:** Check the width at 768px before settling on wording — this label sits in a 264px
  column beside the `NET` figure, which is why the current labels are short. If the prototype's
  phrasing does not fit, shorten it and say what you chose.
- [ ] **Step 4:** Suite, typecheck, `npm run verify:layout`, commit.

## Task 7: The turn-start wallet — a question, not a fix

**Finding, and it is the interesting one.** The prototype shows the turn player their **turn-start**
cash and portfolio until the turn folds (`handHtml`, `playersHtml`), and computes affordability
against that base: *"spend from the turn-start wallet (winnings are deferred)"*. We show live engine
values.

For most of a turn the two agree, because staging is local and does not move engine cash. They
diverge in exactly one place: **a merger payout that lands mid-turn**. Ours pays you and the panel
updates immediately; the prototype holds the figure until the turn ends.

- [ ] **Step 1: Do not implement either way yet.** Establish the facts first: confirm that our
  engine settles payouts immediately (`settleMergerPayout` in `doPlaceTile`), and that a mid-turn
  payout is therefore visible in the hand zone before the turn ends.
- [ ] **Step 2: Put the question to the owner** with both readings. Deferring reads as "your wallet
  is what you started the turn with, so what you can spend is stable" — a deliberate simplification.
  Live reads as "the game paid you, so you have it". There is a rules-adjacent consequence: whether a
  mid-turn payout can be spent *this* turn. Check what the engine actually allows before describing
  either option, because the UI must not offer a purchase the engine will refuse.
- [ ] **Step 3:** Whatever is chosen, write it down in the panel's own docstrings — this is the kind
  of decision that gets re-litigated by whoever next reads the prototype.

---

## Deliberate divergences — recorded, not fixed

Written down so the next comparison pass does not "find" them again:

- **The merger payout has no step of its own.** The prototype pauses on a payout screen with a
  `Continue` button; our engine settles the payout as part of the merge and files it in the log,
  where `PayoutLines` renders it. Phase 2's decision, and it is what makes a merger one commit
  rather than two.
- **No "turn complete" step.** The prototype ends a turn on a `Start new turn` button; we hand over
  with the curtain, which is a stronger signal on a shared device and meaningless online.
- **The buy step's empty state says what to do.** The prototype says *"No shares available to buy."*;
  ours says *"Found a startup to buy shares."* Ours is keyed on nothing being founded, which is a
  different condition since sold-out brands started staying in the row.
- **Net and Balance ride their zone headers.** The prototype gives each its own row; we inlined them
  (`0fb10b1`) to give the step stack ~40px back.
- **The staging pile has no "empty" placeholder.** Removed deliberately (`0c0abdf`).

## Status, 2026-08-06

Executed the same day it was written. **Tasks 2, 4 and 5 shipped** (`714e7b6`): startup not brand,
the liquidation step names its chain and shareholder, the buy step shows the cap. **Tasks 1, 3 and
6 were declined by the owner**, and the reasons are worth keeping — the placement hint is
unnecessary now the tiles are in the panel; holdings belong in the hand zone, which is why they were
taken out of the survivor picker in the first place; and the prototype's staging labels are verbose.
**Task 7 (the turn-start wallet) is still open** and is the same decision as whether the founder's
share belongs in the staging pile.

Two findings came out of the pass that were not in it: founding logged twice under one phase
(`714e7b6`), and the placement row went on asking a question it had already been answered
(`935fda6`, `f35e1c3`). Both were found by the owner reading the panel, not by the comparison.

The motion side of the prototype is a separate plan —
[2026-08-06-step-resolves-in-place.md](2026-08-06-step-resolves-in-place.md).

## Verification

- Every task's test observed failing first, with the break named.
- `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`,
  `npm run verify:layout` green.
- **The comparison table above is complete** — that is the deliverable as much as the code. A
  difference that is neither a task nor a recorded divergence is a difference nobody has decided.

## Risks

**Copy changes are the easiest thing to half-apply.** Task 2 renames a word that appears in labels,
tests and one empty state; a grep that misses a test leaves the app saying both. Both Task 2 and
Task 6 should end with a grep for the old string returning nothing.

**Task 3 touches a merger branch, which is where this project's bugs live.** The change is
presentational, but the branch is reached only through a tied merger. **G13 is the only golden game
that exercises the `chooseSurvivor` intent** (`engine/golden/mergers.ts`), and it says so in its own
docstring — a test that never reaches the branch would pass while proving nothing.

**Task 7 is not a UI question underneath.** Whether a mid-turn payout is spendable this turn is a
rules question the engine already answers one way; the UI must agree with it rather than choose.
