# Phase 5 — Online UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the online UI — the roadmap's Phase 5 — which in practice means closing the twenty-six findings from the real two-player sessions on the merged Phase 3 client: thirteen from the first wave (Tasks 1–7), seven from the second (Tasks 8–14), and six from the third (Tasks 15–20), which came from a frame-by-frame reading of a screen recording rather than from playing.

**Why this is Phase 5 rather than a polish pass:** the roadmap's Phase 5 named three things. Two of them Phase 3b already delivered — hidden hands (projection enforces them, `viewerId` renders them) and the `ReconnectionBanner` rework (it became `ConnectionStrip`, scoped to the room screen). The third, *the step stack as the spectator view of committed segments*, is Task 7 below and is now done. What remains of Phase 5 is exactly what playing the thing in two browsers turned up, which is the more honest specification of "online UI" than the roadmap's three bullets were.

**Architecture:** No new layers. Every item is a change to an existing component, the shared `GameSession` interface, or (once) the engine's opening deal. The through-line is that Phase 3 replaced a shared device with two independent screens, and several things that were adequate when one person held the phone are not adequate when two people are watching different copies of the same board.

**Tech Stack:** TypeScript ESM, React 18, vitest 4 (`node` project for `engine|session|server`, `app`/jsdom for `src`), Tailwind classes inline, socket.io 4.

**Branch point:** `main` @ `3e4c1f2`. Phases 3a and 3b are merged; there is no worktree.
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](../specs/2026-07-31-react-app-revamp-roadmap-design.md) — this plan is that document's Phase 5.
**Predecessor:** [2026-08-05-phase-3b-carry-forward.md](../specs/2026-08-05-phase-3b-carry-forward.md), which is stale: it predates all thirteen findings and still describes UI decisions this plan reverses.

## Global Constraints

- **No `as any`.** Narrow with the engine's type guards (`isStartupId`, …).
- **`prototype/` is untouched.** `engine/` is untouched **except by Tasks 7 and 13** — Task 7 is the one rules change here, Task 13 is log copy. Both say so in their own text.
- **Test project placement:** tests under `src/` run in the `app` (jsdom) project; tests under `engine/`, `session/`, `server/` run in `node`. Run a single file with `npx vitest --root <repo> run --project app <path>`.
- **Import style follows the neighbouring file:** `src/` extensionless, `server/`/`session/` explicit `.js`.
- **Derive from the engine, never hardcode.**
- **jsdom reports zero for every layout measurement.** Nothing in jsdom may assert a height, a fit, or an overflow — those are settled by `npm run verify:layout` and by hand. Two items here (Tasks 1 and 2) are layout defects that jsdom structurally cannot catch; their tests pin structure only and say so.
- **Every new test is observed failing before it is trusted.** Each task below names the break to apply. A break that turns nothing red is a stop-and-report result, not something to work around. This project has shipped six hollow gates; two were found in the last week, one of them written by the author of this plan.
- **A jsdom-green change can still be wrong in a browser.** The tile-switching bug this plan opens with passed its test and was broken online, because the test drove the local session and the bug lived in the networked one. Where a behaviour differs between `GameSession` and `NetworkSession`, test both.
- **Commands:** `npx vitest run`, `npm run typecheck` (never bare `tsc`), `npx vite build`, `npm run check:bundle`, `npm run verify:layout`. Dev: `npm run dev:all` — and only ever one instance, or the second dies on `EADDRINUSE`.

---

## Already landed

Five of the thirteen are done and on `main`. Recorded here so this plan reads as the whole picture rather than the remainder.

| Finding | Commit | Note |
|---|---|---|
| Switching a placed tile did nothing online | `e1400fd` | Root cause was not the click handling. `undoTo` marks a `NetworkSession` pending and `dispatch` refuses while pending, so consecutive calls dropped the placement. `GameSession` gained `undoThen(stepId, intent)`; locally it is undo-then-dispatch, over a wire the replacement waits for the correction and is abandoned if the undo is refused. |
| Clicking a tile during buy raised an error | `e1400fd` | `onCellClick` is passed only when a placement can succeed; otherwise the tiles are inert, which the Phase 3b affordance work already made honest. |
| Turn toast showed a step that never changed | `9135482` | A watcher's state only advances on commit, so the stage label sat frozen while claiming to be live. Removed; the toast says who is up. |
| "No tile you hold can be played" | `9135482` | Removed. The board and the End turn button say it. The dead-tile explanation stays, because the board cannot show *why* a tile is unplayable. |
| Skip looked like a primary action | `9135482` | Hollow now. |
| Net and Balance each took a row of the panel | `0fb10b1` | Not a by-hand finding but the same session: both are standing figures, now inline in their zone headers, right-aligned, at header size with the tint kept. About 40px back to the step stack; staging 174px and hand 114px hold across every stage of the layout walk. |
| The step stack hid what the last player did | `3e4c1f2` | Ruled: the **entirety of the previous turn** — tile placed, founding, merger outcome, shares purchased — read-only above your own live steps. The boundary comes from the session, which closes segments, not from reading the log back into them: a merger files payout entries under players who are not the actor. `SessionView` gained `previousSegmentStart`. |

---

---

## Task 1: The panel must reach its own undo during a merger ✅ `3ad88e8`

**Finding:** in a merger the active zone grows — the liquidation queue plus its actions — and the step stack is pushed out of view with no way to scroll back to it. The undo you need is unreachable exactly when a merger makes you most likely to want it.

**Files:** `src/game/panel/Panel.tsx`; test `src/game/panel/Panel.test.tsx`; measured by `scripts/verify-layout.mjs`.

**Interfaces:** no prop changes expected. If one proves necessary, say so rather than widening the component quietly.

- [ ] **Step 1: Reproduce it in a browser first.** `npm run dev:all`, reach a merger with a liquidation queue, and confirm what actually happens: whether the panel scrolls at all, whether the step stack is clipped or merely off-screen, and which element owns the overflow. jsdom will not tell you any of this. Write down what you observed before changing anything.
- [ ] **Step 2:** Fix the overflow so the panel scrolls as one column and every zone is reachable at every stage. The zone order (`stepstack → active → staging → hand → players`) does not change, and a zone reservation is a floor, not a fixed height — a zone may grow to fit a genuinely new row.
- [ ] **Step 3:** A jsdom test pinning *structure* only: at a merger stage every one of the five `data-slot` zones is present and the scroll container is the one element that owns `overflow-y`. State in the test that it cannot prove reachability, because jsdom reports every height as zero.
- [ ] **Step 4:** Extend `scripts/verify-layout.mjs` to walk into a merger and assert the step stack is reachable — a real height, and inside the scrollable region. This is the only automated check that can actually fail on this defect. If the walk cannot reach a merger with the seeds it uses, say so and report it rather than asserting on a state it never visited.
- [ ] **Step 5: Break it** — restore the old overflow — and confirm the `verify:layout` check reports the step stack unreachable. Restore.
- [ ] **Step 6:** `npm run verify:layout`, `npx vitest run`, `npm run typecheck`, commit.

## Task 2: Liquidation options side by side ✅ `d2e5212`

**Finding:** the sell and trade controls stack vertically and should sit side by side.

**Files:** `src/game/merger/LiqActions.tsx`; test `src/game/merger/LiqActions.test.tsx`.

- [ ] **Step 1:** Lay the two actions out in a row that survives a 320px panel, checked in a browser at 768px and 1440px. Keep the disabled treatment `canSell`/`canTrade` already drive.
- [ ] **Step 2:** The existing tests assert on roles and names; keep them passing rather than rewriting them around the new layout. Add nothing that asserts a width in jsdom.
- [ ] **Step 3:** `npm run verify:layout` — the merger state is one it already walks — plus the suite and typecheck. Commit.

## Task 3: Traded shares appear in the staging pile ✅ `0862885`

**Finding:** trading absorbed shares two-for-one gives you survivor shares, and the staging pile never shows them. You are told what you are giving up and not what you are getting.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `mergerLiquidation` branch); test `src/game/screen/useTurnPanel.test.tsx`.

**Interfaces:** `StagingZone`'s `shares` slot already takes any node; `StockStack` renders a counted stack. No new props expected.

- [ ] **Step 1: Write the failing test.** Drive the liquidation branch to a state with shares traded, and assert the staging zone shows the survivor shares gained — `staged.trade / TRADE_RATIO` of them — alongside the absorbed shares being kept. Derive both counts from `TRADE_RATIO`, never a literal.
- [ ] **Step 2:** Render them. The pile already shows `StockStack id={absorbedId} count={keep}`; the survivor stack joins it.
- [ ] **Step 3: Break it** by rendering only the absorbed stack; confirm the new test goes red. Restore.
- [ ] **Step 4:** Suite, typecheck, `npm run verify:layout` (the pile reservation is exactly what this grows). Commit.

## Task 4: A newly founded brand's shares are badged "new" ✅ `2cbae32`

**Finding:** the prototype badged the brand founded this turn during the buy step, and the port lost it.

**Files:** `src/game/screen/boardMarks.ts` (or a sibling in `src/game/screen/`), `src/game/screen/useTurnPanel.tsx`; tests alongside.

**Interfaces:** `StockCard` already takes `badge?: string` — no atom change. Produce `foundedThisTurn(state, segmentStart): StartupId | null`.

- [ ] **Step 1: Write the failing test** for the derivation: replay to a state where a brand was founded inside the open segment and assert it is named; assert a brand founded in an *earlier* segment is not. Derive from the log the way `ownerBadges` does — a `Founded a brand` entry at or after `segmentStart` — rather than adding a field to the engine.
- [ ] **Step 2:** Implement, and pass `badge="new"` to that brand's `StockCard` in the buy step.
- [ ] **Step 3: Break it** by dropping the `segmentStart` bound so every founded brand counts; confirm the "earlier segment" case goes red. Restore.
- [ ] **Step 4:** Suite, typecheck, commit.

## Task 5: An "it's your turn" indicator ✅ `15f453a`

**Finding:** the toast tells you when someone else is up and says nothing when control arrives, which is the moment that actually needs announcing.

**Files:** `src/game/online/TurnToast.tsx`, `src/game/GameScreen.tsx`; tests in `src/game/online/TurnToast.test.tsx` and `src/game/GameScreen.test.tsx`.

**Interfaces:** `TurnToastProps` gains a discriminator — `mine?: boolean` or a `variant` — rather than a second component, so the two forms cannot drift apart in placement or z-index.

- [ ] **Step 1:** Decide the behaviour and write it down in the component's docstring before coding it: whether the your-turn form persists for the whole turn or announces and fades. A persistent banner over your own board competes with the panel that already says what to do; an announcement that fades is the reason this is a *toast*. Recommendation: it appears when the turn arrives and fades, while the someone-else form persists — because the second is a standing fact and the first is an event. Respect `prefers-reduced-motion`: no fade, just present then gone.
- [ ] **Step 2: Write the failing tests.** As the actor, the your-turn form appears; as a watcher, the other form appears; pass-and-play (`viewerId` absent) shows neither, because the curtain already announces the handoff at full-screen size.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Break it** by rendering the your-turn form unconditionally; confirm the pass-and-play case goes red. Restore.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 6: A tile landing on the board ✅ `14b386c`

**Finding:** tiles appear instantly, and on someone else's screen a whole turn arrives at once with nothing to draw the eye to what changed.

**Files:** `src/game/atoms/Tile.tsx` or `src/game/Board.tsx`, `src/game/tokens.ts` for the motion token; test alongside.

- [ ] **Step 1:** Use the existing motion tokens rather than a new duration. `prototype/transitions.js` is the reference the token set was ported from.
- [ ] **Step 2:** Animate the placed tile's arrival only — not every cell on every render, which is what a naive CSS transition on the grid produces when a commit replaces the whole board.
- [ ] **Step 3: Respect `prefers-reduced-motion`**, which this project treats as a hard rule: under it the tile appears with no animation at all.
- [ ] **Step 4:** Test the reduced-motion branch (jsdom can assert a class or attribute, not a frame) and state plainly in the test that the animation itself is settled by eye.
- [ ] **Step 5:** By-hand check that a commit carrying several changes does not animate the entire board. Suite, typecheck, commit.

## Task 7: Deal hands after the turn-order draw — **superseded 2026-08-06**

> **Do not execute this task.** It is absorbed by
> [2026-08-06-turn-order-draw-round.md](2026-08-06-turn-order-draw-round.md), which makes the draw a
> round of one-tile turns and therefore has to move the deal anyway — a player holding six tiles
> plus a draw tile has no way to tell which one is the highlighted one. Its Task 1 carries this
> task's test verbatim. The text below is kept because the draw-round plan's Task 1 refers to it.

**Finding:** `createInitialGame` fills every hand before setting `stage: "draw"` (`engine/gameInit.ts`), so a player holds six tiles before it is known who plays first. Hands should be dealt once the order is settled.

**Files:** `engine/gameInit.ts`, `engine/intents.ts` (`doStartGame`); tests in `engine/`, plus whatever in `src/` and `server/` assumes a dealt opening hand.

**This is the only task that touches `engine/`.** Treat a golden-game failure as a finding, not an obstacle: the golden corpus is the executable rules spec, and a change that moves it is a rules change that needs saying out loud.

- [ ] **Step 1: Measure the blast radius before changing anything.** Grep for construction of an opening state — `createInitialGame`, `buildFixture` with no explicit `hand` — and list what depends on hands existing at `stage: 'draw'`. `buildFixture` sets hands explicitly, so the golden games are expected to be unaffected; confirm that rather than assuming it.
- [ ] **Step 2: Write the failing test** in `engine/`: at `stage: 'draw'` every hand is empty; after `startGame`, every hand holds `HAND_SIZE` and the bag has shrunk by exactly `players.length * HAND_SIZE`.
- [ ] **Step 3:** Move the deal out of `createInitialGame` and into `doStartGame`, after the order is decided. The draw's own tiles are drawn from the bag first and returned to it (`engine/gameLogic.ts` does this in the legacy path) — preserve whatever the current `startGame` does with them.
- [ ] **Step 4:** Run the **whole** suite. Fix what genuinely depended on the old timing; report anything that looks like a rules change rather than absorbing it.
- [ ] **Step 5: Break it** by dealing at init again; confirm the empty-hands-at-draw test goes red. Restore.
- [ ] **Step 6:** By-hand check that the opening board shows no hand tiles before the draw, in both pass-and-play and online. Suite, typecheck, `npm run verify:layout`, commit.

---

## Second by-hand wave — Tasks 8–14

Seven findings from the owner's session on the polished panel, 2026-08-06. Two
are motion (Tasks 9 and 10) and are the reason Task 6 should be done *after*
them rather than before: they settle what "arriving" means on this surface, and
a tile landing on the board should share that vocabulary rather than invent a
second one. Two are copy, two are content the panel drops that it should keep,
and one is the history being noisier than it is useful.

## Task 8: The step stack stops showing the draw ✅ `e2d6b68`

**Finding:** every turn ends with a `Drew tiles` entry, which is the bag doing
its bookkeeping, not a move anyone made. It doubles the length of the history
and pushes the moves that matter out of view.

**Ruling: hide, do not delete.** The entry stays in `state.log` — the server
projects it (redacting the tiles for everyone but their owner), the golden
corpus asserts on it, and Phase 4's recovery work reads the log back. This is a
render-time filter and nothing else.

**Scope:** the `Drew tiles` phase only. `Drew for turn order` stays — it is the
result of the one draw players actually watch, and it is the only record of who
won the order. The `→ drew X` token inside a dead-tile trade-in stays too: it is
the outcome of an action the player took, in the entry for that action.

**Files:** `src/game/screen/stepsOf.tsx`; test `src/game/screen/stepsOf.test.tsx`.

- [ ] **Step 1: Write the failing test.** Replay a golden game past an
  `endTurn`, assert `state.log` still contains a `Drew tiles` entry, and assert
  `stepsOf(...)` returns no entry with that phase. Asserting both halves in one
  test is the point — the test is as much about the data surviving as about the
  UI hiding it.
- [ ] **Step 2:** Filter in `stepsOf` against a named module constant
  (`HIDDEN_PHASES`), with a comment saying it is a display filter over an intact
  log. Do not filter in `GameScreen`, or the catalog and the tests will disagree
  with the game.
- [ ] **Step 3:** Check the neighbours. `previousSegmentStart` slices the log by
  step id, not by rendered rows, so hiding a row must not change which segment is
  shown — confirm the previous turn still starts where it did. And confirm no
  hidden entry was carrying an undo: if any `Drew tiles` id appears in
  `undoableSteps`, stop and report it rather than hiding a control.
- [ ] **Step 4: Break it** by emptying `HIDDEN_PHASES`; confirm the new test goes
  red. Restore.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 9: A step arrives by rising out from behind the staging area — **reworked by Task 15**

> Shipped as `6f0ffcd` and `c49075d`, then found wrong by a frame-by-frame pass:
> it animates the contents while the container's height changes in one frame.
> **Task 15 replaces the mechanism** and deletes most of what these two tasks
> built. Kept here because the reasoning about bottom-aligned lists is what led
> to the wrong answer, and the next attempt should be able to read it.


**Finding:** the intended motion was never built. Today `.step-enter` fades the
new entry in and lifts its *text* 18px; the entries above it jump to their new
positions in a single frame. What it should be: the new step takes its full
height immediately — so everything above it starts moving — while the step
itself is hidden behind the staging zone and rises into place.

**The mechanism, since a naive CSS transition cannot do this:** the stack is
bottom-aligned, so adding an entry moves every older entry up by exactly the new
entry's height, instantly, before paint. Invert that: after layout, translate the
list down by the height that was just added, then animate the translate to zero.
The older entries slide up from where they were, the new one comes up out of the
zone below, and it is one motion because it is one transform.

**Files:** `src/game/panel/StepStack.tsx`, `src/game/panel/StepEntry.tsx`,
`src/styles/index.css`; test `src/game/panel/StepStack.test.tsx`.

- [ ] **Step 1: Establish the clip.** The rising entry must be invisible until it
  clears the staging zone's top edge. The stack's own box is the clip; the
  staging zone is opaque (`bg-[#fffdf5]`) and paints after it in document order.
  Confirm in a browser that a translated entry is hidden by the stack's overflow
  and not merely drawn over the zone — and that no scrollbar appears mid-animation.
- [ ] **Step 2: Implement the inversion.** In `StepStack`, on the entry list
  changing, measure the content height before and after in a layout effect,
  apply `transform: translateY(delta)` with no transition, then release it to the
  motion token on the next frame. Measure — never assume a fixed row height: a
  merger payout entry is several lines tall.
- [ ] **Step 3: Move the animation off the individual entry.** `.step-enter` on
  `StepEntry` is the thing being replaced; the transform belongs to the list, not
  each row, or the rows animate against each other. Leave `.active-step-enter`
  and `TurnToast` alone — they share the keyframe today, so decouple them
  deliberately rather than by accident, and say in the CSS which now uses what.
- [ ] **Step 4: `prefers-reduced-motion` skips it entirely** — no transform, no
  transition, the new step simply present. This is a hard project rule and the
  media query already exists in `src/styles/index.css`.
- [ ] **Step 5:** Test what jsdom can see: that the reduced-motion path applies
  no transform, and that the list — not the entry — carries the animated
  element. State plainly in the test that the motion itself is settled by eye,
  because jsdom reports every height as zero and this task is built on a
  measured height.
- [ ] **Step 6: By hand, in a browser.** Place a tile, found a brand, take a
  merger payout: each new step rises from behind the staging zone with the older
  steps sliding up ahead of it. Then again with reduced motion on.
- [ ] **Step 7:** `npm run verify:layout` — the stack's height reservation is
  what this animates inside of — suite, typecheck, commit.

## Task 10: Replacing a step reverses the motion first — **reworked by Task 15**

> Shipped as `5abbce3`. The sequencing ruling survives; the mechanism does not —
> the collapse becomes the same container's height, per Task 15 Step 3.


**Finding:** switching your placed tile swaps one step for another, and the new
one just appears. The old step should drop back down out of view — the entry
animation run backwards — and only then does the replacement rise.

**Files:** `src/game/panel/StepStack.tsx` (owns the list, so it owns the
exit), `src/styles/index.css`; test alongside Task 9's.

**Depends on Task 9**, which establishes the enter motion this reverses. Do not
start it first.

- [ ] **Step 1:** Hold a removed entry mounted for the exit's duration. When the
  incoming `entries` prop no longer contains a `stepId` that was there,
  keep rendering it while it animates down, then drop it and let the new entry
  run Task 9's enter. The two phases are sequential, not simultaneous.
- [ ] **Step 2: Handle more than one.** An undo inside a merger removes several
  entries at once, and a rewind to an earlier step removes everything after it.
  The exit must cover an N-entry removal without leaving a row stranded on
  screen — a stuck ghost row is worse than no animation.
- [ ] **Step 3:** Online, this sequence spans a round trip: `undoThen` sends the
  undo, waits for the server's correction, then plays the replacement. The exit
  should run on the correction, not on the click. Check by hand in two browsers,
  not only in pass-and-play — the tile-switch bug that opened this plan was
  exactly a behaviour that worked locally and not over the wire.
- [ ] **Step 4: `prefers-reduced-motion`:** no exit, the entry is simply gone.
- [ ] **Step 5: Break it** by dropping the removed entry immediately; confirm the
  test that pins the outgoing entry still being rendered goes red. Restore.
- [ ] **Step 6:** Suite, typecheck, by-hand check, commit.

## Task 11: "Place a tile" shows the hand it is asking you to play from ✅ `a6f22e0`

**Finding:** during the placement step your tiles are lit on the board and
nowhere in the panel. The step asks for a tile without showing you which ones
you hold.

**Whose hand:** the **viewer's**, not the actor's — `GameScreen` already
resolves `viewer` for `HandZone`, and a watcher's projected state has the
actor's hand blanked. Reading `state.players[actorId].hand` would render an
empty row for every watcher.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `stage === 'play'` branch),
`src/game/GameScreen.tsx` if the viewer's hand needs threading in; test
`src/game/screen/useTurnPanel.test.tsx`.

- [ ] **Step 1: Write the failing test.** In the play branch, the panel renders
  one `Tile` per coordinate in the viewer's hand; a dead tile among them carries
  the blocked state (`data-tile-state`, added in Phase 3b for exactly this kind
  of assertion); and a watcher whose own hand is populated still sees their own
  tiles while someone else is placing.
- [ ] **Step 2:** Render them static — `Tile` treats `onClick != null` as the
  whole of its affordance, so passing no handler is what makes them read as a
  display rather than a second set of controls. **Placement stays on the board.**
  Two live ways to play the same tile is a bigger change than this finding asks
  for; if it turns out to be wanted, that is its own task.
- [ ] **Step 3: Break it** by rendering the actor's hand instead of the viewer's;
  confirm the watcher case goes red. Restore.
- [ ] **Step 4:** `npm run verify:layout` — this adds a row to the active zone,
  which is the zone that squeezes the step stack — suite, typecheck, commit.

## Task 12: A sold-out brand stays in the buy row ✅ `a123b87`

**Finding:** `forSale` filters on `availableShares > 0`, so a brand vanishes from
the buy step the moment its last share is bought. Sold out is information — it
is how you know the brand is locked and what the other players have been doing —
and removing the card destroys it.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `stage === 'buy'` branch),
possibly `src/game/atoms/StockCard.tsx`; tests alongside.

- [ ] **Step 1: Write the failing test.** Drive a state where a founded brand has
  `availableShares === 0` and assert its card is still rendered, disabled, and
  marked sold out. Derive the condition from `availableShares`, never from a
  count of what has been bought.
- [ ] **Step 2:** Keep founded brands in the row regardless of availability;
  a sold-out one renders disabled with a `sold out` badge. `StockCard` already
  takes `badge` and `disabled` — prefer those to a new mode. If the badge cannot
  carry it legibly at `sm`, change the atom deliberately and say so.
- [ ] **Step 3:** Do not let it become clickable. The existing `disabled` guard
  drives on cash and buy count; sold out is a third reason and must be OR'd in,
  not folded into one of them.
- [ ] **Step 4: Break it** by restoring the `availableShares > 0` filter; confirm
  the new test goes red. Restore.
- [ ] **Step 5:** Suite, typecheck, `npm run verify:layout` (this row can now be
  wider), commit.

## Task 13: Placements stop calling themselves "(isolated)" ✅ `222146f`

**Finding:** a tile that neither grows a chain, founds one, nor merges logs as
`E6 (isolated)`. The word is jargon for "nothing happened", and the entry
already shows the coordinate and nothing else.

**Files:** `engine/gameLogic.ts` (the placement log, ~line 160); tests in
`engine/`, plus the golden corpus.

**This touches `engine/`,** so the Global Constraint above is now "untouched
except by Tasks 7 and 13". This one is **log copy, not rules**: no state, no
legality, no price moves. If removing it changes any golden game's outcome,
stop — that would mean something reads the log detail as data, which is a real
finding.

- [ ] **Step 1:** Grep the corpus and the app for the string. `engine/golden/`
  asserts `logPhases`, not detail tokens, so the expectation is that nothing
  breaks — confirm it rather than assuming it.
- [ ] **Step 2: Write the failing test** in `engine/`: after an isolated
  placement, the entry's detail is the tile and nothing more.
- [ ] **Step 3:** Drop the token.
- [ ] **Step 4:** Run the whole suite including `engine/golden/golden.test.ts`.
- [ ] **Step 5:** Suite, typecheck, commit.

## Task 14: "Initial share price", not "to start" ✅ `de52488`

**Finding:** the founding step groups the available brands by the price a share
opens at and labels that price `to start`, which reads as a fragment.

**Files:** `src/game/FoundGroups.tsx`; test `src/game/FoundGroups.test.tsx`.

- [ ] **Step 1:** Change the copy to `initial share price`. Check it at 768px in
  the panel — it is roughly twice as long as what it replaces, and the group
  header sits above a wrapping row of brands.
- [ ] **Step 2:** Update any test matching the old text; if none matches, that is
  itself worth a line in the report — copy nothing asserts is copy nothing
  protects.
- [ ] **Step 3:** Suite, typecheck, `npm run verify:layout`, commit.

---

## Third by-hand wave — Tasks 15–20

Six findings from the owner's frame-by-frame pass over a screen recording on
2026-08-06, after Tasks 9 and 10 shipped. **Task 15 is a rework, not a
tuning**: the motion those two tasks built is the wrong mechanism, and the fix
deletes most of it. The other five are small and independent of it.

Two of the six (16 and 17) are the same shape as Tasks 3 and 12 before them —
a behaviour the prototype has, the atom still supports, and the port dropped on
the way across. That is now four; it is worth a pass over
`prototype/index.html`'s panel against ours to find the rest in one go rather
than one screen recording at a time.

## Task 15: The container rises — not the contents ✅ `0d82784`

> **Done, with one deviation: there is no exit phase.** The plan's Step 3 had
> the zone collapse with the old step still rendered, then grow with the new
> one. Built that way it put a 240ms delay in front of every control the next
> step offers, and five existing tests failed on the lag immediately. The step
> that has just finished is not in that box any more — it is a row in the
> history being pushed — so there is nothing to animate away, which is also what
> the finding asked for ("the previous completed step should be pushed up, not
> have its own transition"). `STEP_EXIT_MS` survives as an unused-by-the-zone
> constant only if something later needs it; the reveal is one growth, and the
> gate measures it.


**Finding, in the owner's words:** *"the container is meant to animate up, not
the contents inside. the container is meant to push everything above it up. the
previous completed step should be pushed up, not have its own transition."*

**What is wrong now.** Tasks 9 and 10 animate two sets of *contents* — the step
list by one distance, the arriving step's content by another — while the thing
that actually moves the layout, **the active zone's height, changes in a single
frame**. Everything else is choreography over that jump. Observed frame by
frame: the history snaps to its new position, the just-completed row then peeks
out from behind staging under its own transform (it should never do that), and
the arriving step fills a container that was already the right size.

**What it should be.** One animated property on one element: the active zone's
height, from zero to its natural height, with its overflow clipped. Everything
else follows from layout — the step stack is the panel's flex spacer, so its
bottom edge *is* the active zone's top edge, and a zone growing underneath the
history pushes the history up in lockstep, by construction. Nothing to
synchronise, because there is only one motion.

**Files:** `src/game/panel/StepStack.tsx` (deletions), `src/game/panel/stepMotion.ts`
(rewrite), `src/game/panel/Panel.tsx`, `src/game/GameScreen.tsx`,
`src/styles/index.css`, `scripts/verify-layout.mjs`; tests alongside.

- [ ] **Step 1: Delete before building.** `riseFrom`, the `data-step-list`
  transform, the `lastHeight`/`prevTop` measurement, `.active-step-enter`'s
  `step-rise` keyframe and the `shown`/`exitingTo`/`exitTimer` machinery all go.
  Keep `prefersReducedMotion` and `leavingIds`. The step list must end up with
  **no transform of its own at all** — that is the finding, stated as a
  postcondition.
- [ ] **Step 2:** A `StepReveal` wrapper around the active slot in `Panel`,
  taking the step identity `GameScreen` already computes (`${stage}:${actorId}`)
  as a prop rather than a React key — it needs to *observe* the change, not be
  remounted by it. On a change: measure the natural height, set `height: 0` with
  no transition, flush, then transition to that height, then release back to
  `auto` so later content changes within one step are unconstrained. `height:
  auto` is not animatable, which is why this is measured in JS like everything
  else here.
- [ ] **Step 3: The exit is the same property.** Replacing a step (switching a
  placed tile) collapses the zone to zero with the *old* content still rendered,
  then grows with the new — sequential, as ruled. The stack does not participate;
  rows appear and disappear where they belong and are pushed by the zone.
- [ ] **Step 4: Slow it down.** The owner has asked twice; whatever number
  settles must be read off a real page, not chosen. Start from 480ms and let the
  by-hand pass move it. One duration now, not two.
- [ ] **Step 5: `prefers-reduced-motion` skips it** — the zone is simply its new
  height, no interpolation. Hard rule.
- [ ] **Step 6: Replace the layout gate's probes.** `stepRise` and `stepExit`
  measure transforms that will no longer exist; they must be rewritten, not
  deleted, or this ships unguarded. The property to measure is the one the
  finding names: **at every sample during the animation, the step list's bottom
  edge equals the active zone's top edge** — that is "pinned", stated as a
  measurement — and the zone's height is strictly between 0 and its final value
  mid-flight. Sample at three points.
- [ ] **Step 7: Break it** by setting the height with no transition; confirm the
  mid-flight sample reports the final height and the gate fails. Restore.
- [ ] **Step 8: By hand, frame by frame.** This is the third attempt at this
  motion and the first two passed their gates. Record it and step through, in
  pass-and-play and online. Suite, typecheck, `npm run verify:layout`, commit.

## Task 16: Staged shares can be taken back ✅ `0c0abdf`

**Finding:** clicking a share in the staging pile should decrement it and return
it to where it came from. Nothing in the pile is clickable, and there is no
affordance saying it could be.

**Files:** `src/game/screen/useTurnPanel.tsx` (both piles); tests alongside.

**The atom is already built.** `StockCard`'s `mode="remove"` renders the `×`
badge; `StockStack` lights it when `onRemove` is supplied; the catalog carries it
as `stack · sm · removable`. The panel passes no handler on either pile, so the
state is never entered — the same dropped-prop shape as Tasks 3 and 12.

- [ ] **Step 1: Write the failing test.** In the buy step, stage two shares of a
  brand, click the pile's remove control, and assert the staged count is one and
  the net cost has dropped by one share's price. Then assert the `×` affordance
  is present at all, which is the half that was missing.
- [ ] **Step 2:** Pass `onRemove` on the buy pile: drop one pick of that brand.
- [ ] **Step 3:** Pass `onRemove` on the liquidation pile. **Decision to make
  and write down:** the prototype resets the whole sort (`liqSell = liqTrade =
  0`); decrementing one unit (sell −1, trade −`TRADE_RATIO`) is more predictable
  and matches what the buy pile does. Recommendation: decrement. Say which in the
  commit either way.
- [ ] **Step 4: Break it** by dropping the handler again; confirm the test goes
  red. Restore.
- [ ] **Step 5:** Suite, typecheck, `npm run verify:layout` (the pile's
  reservation is what this changes the contents of), commit.

## Task 17: The buy step says what to do when there is nothing to buy ✅ `0c0abdf`

**Finding:** before anything is founded, the buy step is a heading over an empty
row.

**Files:** `src/game/screen/useTurnPanel.tsx` (the `buy` branch); test alongside.

- [ ] **Step 1: Write the failing test** from a state with no founded brand: the
  buy step renders `Found a startup to buy shares`.
- [ ] **Step 2:** Render it. **Key it off "nothing is founded", not "nothing is
  buyable"** — since Task 12, a founded brand with an empty pool renders a
  sold-out card, so those two conditions have come apart. A test for the
  all-sold-out case asserting the cards *are* shown pins that distinction.
- [ ] **Step 3: Break it** by keying off `forSale.length === 0`; confirm the
  sold-out case goes red. Restore.
- [ ] **Step 4:** Suite, typecheck, commit.

## Task 18: Whose step was it ✅ `83dc438`

**Finding:** the stack shows two turns and attributes neither. The viewer should
see "you", never their own name.

**Files:** `src/game/screen/stepsOf.tsx`, `src/game/panel/StepEntry.tsx`,
`src/game/GameScreen.tsx`; tests alongside.

**The data is already there and thrown away:** every `LogEntry` carries
`playerId`, and `stepsOf` drops it.

- [ ] **Step 1: Decide the form and write it down.** The phases are engine
  strings and not uniformly verb phrases — `Placed a tile` and `Bought shares`
  take a subject, `Merger payout` does not. Recommendation: an attribution on the
  phase line (emoji + name, or `You`), not a rewritten sentence, so every phase is
  handled by one rule. Do not touch the engine's strings.
- [ ] **Step 2: Write the failing tests.** An entry by another player carries
  their name; an entry by the viewer reads `You`; and — the case that matters
  online — a **merger payout entry filed under a player who is not the actor**
  carries that player's name, not the actor's. Drive it from a golden game with a
  payout rather than a hand-built log.
- [ ] **Step 3:** Thread the viewer into `stepsOf`. `GameScreen` already resolves
  it for the board and the panel; this is the same value one level further, not a
  third derivation.
- [ ] **Step 4: Break it** by naming the actor on every entry; confirm the payout
  case goes red. Restore.
- [ ] **Step 5:** Suite, typecheck, `npm run verify:layout` (an added name can
  wrap a step row), commit.

## Task 19: The holdings floor is short by a row's worth ✅ `89da136`

**Finding:** taking your first share — the founder's free one — shifts every
zone below the hand by 4px.

**Files:** `src/game/panel/HandZone.tsx`, `scripts/verify-layout.mjs`.

**The gate has been printing this without failing on it:** `holdings` measures
64px empty and 68px with one stack, and the zone is marked `data-may-grow="true"`,
which exempts it from the no-movement rule. Gaining a share is not gaining a
*row*, so the exemption is being spent on the wrong case.

- [ ] **Step 1: Measure, do not guess.** Read the populated single-row height off
  a real page at 768 and 1440 — the stack's depth margin and the `×N` label are
  what the 64px floor was measured without.
- [ ] **Step 2:** Raise the floor to cover one populated row.
- [ ] **Step 3: Make the gate bite.** A floor that is silently 4px short is what
  shipped; the check must fail on it. Either drop `data-may-grow` from this zone
  and let the exact-height rule apply until a genuine second row appears, or add
  a per-zone assertion that the empty and single-row heights match. Say which and
  why.
- [ ] **Step 4: Break it** by restoring the 64px floor; confirm `verify:layout`
  reports the shift. Restore.
- [ ] **Step 5:** `npm run verify:layout` at both widths, suite, typecheck, commit.

## Task 20: The staging pile stops saying "empty" ✅ `0c0abdf`

**Finding:** the word `empty` in an empty staging pile is a label for nothing.

**Files:** `src/game/panel/StagingZone.tsx`; test in `StagingZone.test.tsx`.

- [ ] **Step 1:** Remove the placeholder. The 72px reservation is on the pile
  container (`h-[72px] min-h-[72px]`), not on the text, so the zone does not move
  — and the existing height-stability test proves that rather than assuming it.
- [ ] **Step 2:** Update any test matching the word.
- [ ] **Step 3:** Suite, typecheck, `npm run verify:layout`, commit.

---

## Verification

**Status 2026-08-06: every task is built and committed.** What remains is the
last bullet, which is not a task and cannot be done by the person who wrote the
code.

- ✅ All twenty-six findings are closed. One deviation, recorded on Task 15: the
  reveal has no exit phase.
- ✅ Every new test was observed failing, with the break named in its task. Two
  premises of my own were corrected by the corpus along the way: a merger payout
  is filed under no player at all, and the buy step's empty state is about
  nothing being *founded* rather than nothing being *buyable*.
- ✅ `npx vitest run` (610), `npm run typecheck`, `npm run check:bundle` and
  `npm run verify:layout` are green.
- ⬜ **A full two-browser game has been played to final scoring**, including a merger whose liquidation queue reaches both players, an undo inside a merger (Task 1's finding), a tile switched mid-turn (online, the bug that opened this plan), and a mid-game refresh. This is the pass that found all thirteen of these; it is the only one that has ever found anything here.

## Risks

**Five of these are layout or motion defects, and jsdom cannot see any of them.** Tasks 1, 2, 6, 9 and 10 are exactly the class of change that passes a structural test over a visibly broken page. `verify:layout` and a browser are the gates that matter; a green `vitest` run means nothing for them. Tasks 9 and 10 are the worst of the set: a measured height drives the whole effect, and jsdom reports every height as zero, so a test can only prove the mechanism is wired — never that anything moves.

**The panel motion has now been wrong twice, and both attempts passed their gates.** Tasks 9 and 10 shipped green — suite, typecheck, and purpose-built browser probes — and were still the wrong mechanism, because the probes measured what the implementation did rather than what the motion is *for*. Task 15's gate is written the other way round: it measures the relationship the finding names (the history's bottom edge stays on the arriving step's top edge), which is true of the right implementation and false of both wrong ones. Expect the third attempt to need a frame-by-frame look regardless.

**Order the motion work 9 → 10 → 6.** Task 9 defines what arriving looks like on this surface, Task 10 reverses it, and Task 6 (a tile landing on the board) should borrow that vocabulary instead of inventing a second one. Doing 6 first means either redoing it or living with two motions that disagree.

**Task 7 moves the opening deal, and the opening is what every fixture is built on.** The golden corpus should be indifferent because `buildFixture` sets hands explicitly, but "should be" is the phrasing that preceded this project's last two surprises.

**Neither by-hand session finished a game.** Everything past the early middlegame — the second merger, the endgame trigger, final scoring online — remains unobserved by a person. More findings should be expected from the pass this plan ends with, and that is the pass working, not failing. The second wave is evidence for it: seven findings on a surface the first wave had already been over.
