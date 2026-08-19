# Animation 1 — the active step resolves into its log row

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a step *become* its completed form before it hands over — the hand collapsing into the
tile you played, the brands collapsing into the startup you founded, the payout counting itself up
before it tells you who won.

**The two animations, and where each stands** (owner, 2026-08-06):

| | | |
|---|---|---|
| **1. Active step → log view** | the step resolves in place, in front of you | **this plan** |
| **2. Slide the container up to reveal the next step** | the active zone's height, pushing the history | **done** — `panel/StepReveal.tsx`, and it is correct as built |

The prototype never settled animation 2 — `prototype/transitions.js`'s `stepAdvance` is its third
attempt and ours is a fourth, arrived at independently. **Do not port T2 back.** What the prototype
*did* settle is animation 1, and that is what this plan takes from it.

**Architecture:** No engine change. Each collapse is a WAAPI animation over the active zone's own
content, run while the panel holds that content one moment longer than it does today. What is
collapsed *into* is already known from the log — the placement entry names its tile and startup, the
founding entry carries the share — so nothing new has to be derived.

## Global Constraints

- **`engine/` is untouched.** Every fact these animations need is already in the log.
- **`prefers-reduced-motion` skips all of it** — the step resolves instantly and the panel advances.
  A hard project rule, not a softening.
- **jsdom sees no frames.** What jsdom can check is *sequencing* — which content is mounted, when —
  and that is the half that has been wrong before. Everything about how it looks is settled on a real
  page and by eye.
- **Every new test is observed failing first**, with the break named in the task.
- **Commands:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`,
  `npm run verify:layout`.

## The reference, and what it costs

From `prototype/motion.html` and `prototype/transitions.js`, which are the tuned values — read them
before choosing numbers:

| | Choreography | Values |
|---|---|---|
| **Place** | pulse the tapped tile → it recolours hand→filled and slides to the row's start → the other hand tiles converge *behind* it (scale 0.9, descending z, staggered) and fade → the result slides in from the right | blink 300, tuck 0.9, stagger 30, **320ms** |
| **Found** | pulse the clicked brand → the price labels fade → every other brand slides into the selected one's position and fades, staggered → the selected slides to the group's upper-left | blink 360, stagger 24, **300ms** |
| **Payout** | `calculating bonuses…` holds → majority line(s) fade up → pause → minority line(s) fade up | loader 620, gap 140, **300ms** |

**The cost, stated once so it is a decision rather than a surprise:** a step now takes ~300ms to
resolve *before* animation 2's ~480ms reveal begins — roughly 800ms from click to the next step's
controls. That is the deal the prototype made and it is defensible, because unlike the exit phase
removed from `StepReveal` this is *feedback for your own click* rather than dead time. But it should
be felt by hand before the numbers are fixed, and animation 2's duration may want to come down once
animation 1 is carrying the front of the sequence.

---

## Task 1: The panel holds a step long enough to resolve it

**Files:** `src/game/panel/StepReveal.tsx` (or a sibling), `src/game/GameScreen.tsx`,
`src/game/panel/stepMotion.ts`; tests alongside.

**The mechanism, and the trap.** Today the incoming step replaces the outgoing one the instant the
intent applies. Animation 1 needs the *outgoing* content to stay mounted while it collapses, which is
the machinery deliberately removed from `StepReveal` when it caused a delay in front of every
control. Reinstating it here is not a reversal: that hold was dead time, this one is the animation.
Keep them distinguishable in the code, or the next reader will "fix" it back.

- [ ] **Step 1: Write the failing test.** On a step change, the outgoing step's content is still
  rendered for the resolve duration and gone after it, and the incoming step is not mounted until
  then. Fake timers; this is sequencing, which jsdom can see.
- [ ] **Step 2:** Implement the hold. It must be **skipped entirely** when the step change is not one
  of the three with a resolve animation — an `endTurn` handing over to the next player has nothing
  to collapse, and holding it would put the delay back where it was removed from.
- [ ] **Step 3: Under `prefers-reduced-motion` there is no hold at all**, which is the same code path
  as a step with no animation.
- [ ] **Step 4: Break it** by advancing immediately; confirm the sequencing test goes red. Restore.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 2: The hand collapses into the tile you played

**Files:** `src/game/screen/useTurnPanel.tsx` (the `play` branch), a new
`src/game/panel/resolve/` module; tests alongside.

**What it collapses into is already known:** the placement is the newest `Placed a tile` entry, and
`boardMarks.lastPlacedTile` already reads it.

- [ ] **Step 1: Write the failing test.** After a placement, the resolving step renders the played
  tile and the other hand tiles are on their way out — assert on the marked elements, not on
  positions, since jsdom has none.
- [ ] **Step 2:** Implement per the prototype's `t1TileConverge`: the played tile slides to the row's
  start; the others translate to the same point, scale down and fade, staggered, behind it in
  descending z-order.
- [ ] **Step 3:** The tiles are the ones Phase 5's Task 11 put in the panel — the same elements, so
  there is nothing new to render, only to animate.
- [ ] **Step 4: Break it** by animating every tile identically; confirm the test that the played tile
  survives goes red. Restore.
- [ ] **Step 5:** By hand: place a tile that founds, one that grows, one that does nothing. Suite,
  typecheck, `npm run verify:layout`, commit.

## Task 3: The brands collapse into the startup you founded

**Files:** `src/game/FoundGroups.tsx`, `src/game/screen/useTurnPanel.tsx`; tests alongside.

- [ ] **Step 1: Write the failing test.** After choosing, the chosen brand is still rendered and the
  others are marked as leaving; the price-group labels are marked too, since they fade first.
- [ ] **Step 2:** Implement per `selectBrand`: pulse, fade the price labels, slide every other brand
  into the chosen one's position with a stagger, then move the chosen one to the group's upper-left.
- [ ] **Step 3:** Mind what the groups do to the geometry — brands sit in three price rows, so "the
  chosen one's position" is a measured rect, not a column offset.
- [ ] **Step 4: Break it** by collapsing into the first brand rather than the chosen one; confirm the
  test goes red. Restore.
- [ ] **Step 5:** By hand, then suite, typecheck, `verify:layout`, commit.

## Task 4: The payout counts itself up

**Files:** `src/game/merger/PayoutLines.tsx`, `src/game/screen/stepsOf.tsx`; tests alongside.

**This one has no active step to resolve, and that is the interesting part.** Our engine settles a
merger payout inside the merge — there is no payout stage, and the payout arrives as a log row
rendered by `PayoutLines` (Phase 2's decision, recorded in the prototype comparison). So the
suspense has to live in **the row's own arrival**: it mounts showing `calculating bonuses…`, holds,
then reveals majority and minority in turn.

- [ ] **Step 1: Write the failing test.** On mount the row shows the loader and no bonus lines; after
  the loader duration the majority lines are present; after the gap the minority lines are too. Fake
  timers.
- [ ] **Step 2:** Implement per `payoutReveal`. The numbers are already computed — this is a reveal,
  not a computation, and the code should not pretend otherwise anywhere a reader could be misled.
- [ ] **Step 3:** It must be **idempotent on re-render**: the panel re-renders for unrelated reasons,
  and a row that restarts its loader every time would never finish. The same trap as the exit that
  cancelled itself; there is a test for that shape in `StepReveal.test.tsx` to copy.
- [ ] **Step 4: Under reduced motion the row is simply complete** — no loader, no stagger.
- [ ] **Step 5: Break it** by rendering the lines immediately; confirm the loader test goes red.
  Restore.
- [ ] **Step 6:** By hand, in a merger that pays both players. Suite, typecheck, commit.

## Task 5: The whole sequence, by eye

- [ ] **Step 1:** Play a full turn and watch the join between animation 1 and animation 2 — the
  collapse finishing into the reveal starting. That join is the thing no test can see and the whole
  reason this is one plan and not three.
- [ ] **Step 2: Re-tune both durations together.** Animation 2 is 480ms because it was carrying the
  whole sequence alone; with a resolve in front of it, shorter may read better. Change the numbers in
  `stepMotion.ts` and re-run `verify:layout`, whose reveal probe asserts the *shape* of the motion
  rather than its duration and should stay green.
- [ ] **Step 3:** With reduced motion on, confirm a turn is instant end to end.
- [ ] **Step 4:** All gates, and update `CLAUDE.md`'s motion rule to name both animations.

## Verification

- Every new test observed failing first, with its break named.
- `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`,
  `npm run verify:layout` green.
- A turn played by hand at normal speed, and again with `prefers-reduced-motion`.

## Risks

**The hold is the mechanism that was just removed for causing a delay.** It is reinstated here for
the opposite reason — this is feedback, not dead time — but it must not creep onto step changes with
nothing to resolve. If pressing `End turn` ever waits, this plan caused it.

**Three collapses, one shape.** Place, found and payout are different choreographies over the same
idea; the temptation is to build one general "collapse" abstraction. The prototype wrote three
separate functions and they read clearly. Follow it, and let the third one tell you whether
something wants extracting.

**The join is the part that will be wrong.** Both animations are individually testable and the
handover between them is not; the prototype's own T2 kept the outgoing element alive *through* the
push-up, which our animation 2 deliberately does not. Expect the first attempt to look abrupt where
they meet, and expect to find that only by watching it.
