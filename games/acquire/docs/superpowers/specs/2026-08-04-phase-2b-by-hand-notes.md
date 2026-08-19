# Phase 2b — by-hand play notes

**Date:** 2026-08-04
**Task:** Plan Task 8
**Method:** a mix of two routes, because the pure "play a real game to the end" route proved too
slow to finish inside this session:

1. **Real play, driven through headless Chrome over CDP**, `--headless=new`, at 1440×900 and
   768×900, clicking through the actual `/pass-and-play` UI exactly as a player would (add players,
   start, draw, reveal, place tiles, found, buy, end turn). One 2-player run reached a genuine
   41-tile end on its own and was used for the reduced-motion and real-end-state checks. Two longer
   runs — a 2-player walk built to also force a dead tile and a stuck turn, and a 6-player walk
   meant to reach the end with many founded chains — were still short of an end state after several
   minutes and were abandoned rather than run indefinitely, per the coordinator's direction not to
   keep waiting on a stalled walk. Their partial screenshots (setup and first turn) are kept as
   evidence the opening screens are fine at both configurations; nothing about the end game is
   claimed from them.
2. **Direct fixture mounting**, for everything the abandoned walks would otherwise have had to
   reach by playing hundreds of turns. `GameScreen` takes a `session` prop and nothing about it
   requires the session to have been built by playing — `createGameSession({ state })` accepts any
   `GameState`, including one built by `buildFixture` (the same helper the golden games use) with
   `stage: 'end'`, or `stage: 'play'` with a hand-built dead-tile/stuck-turn board. A throwaway route
   (`src/pages/__DebugByHand.tsx`, wired into `src/App.tsx`) mounted `GameScreen` directly against
   these fixtures. Both were deleted before committing; `git status` after cleanup shows only the
   three real edits (`FinalScoring.tsx`, `FinalScoring.test.tsx`, `GameScreen.tsx`).

Every check below says which route produced it. Real-play evidence and fixture evidence are both
the real component tree rendered by a real browser — `document.elementFromPoint` and
`getBoundingClientRect` are exactly as meaningful either way, which is the property jsdom cannot
offer regardless of how the state was reached.

**This pass found one defect the previous review's fix did not catch — a second stacking/layout bug
in the same overlay — and it was fixed.**

## Defect found and fixed: the end-of-game buttons overlapped the scoreboard

**What it looked like.** `FinalScoring`'s root is `absolute inset-0 flex items-center justify-center`
— it centres its white card within whatever surface hosts it, and that positioning takes it out of
normal document flow. `GameScreen` used to render the "New game" / "Back to menu" row as a plain
*sibling* immediately after `<FinalScoring>`, with `mt-6` to put daylight between them. Because the
preceding sibling contributes no flow height (it is `position: absolute`), that `mt-6` was measured
from the *scrim's* top edge, not the card's bottom — so the button row always landed near the top of
the overlay, wherever the vertically-centred card's top happened to be.

At 1440px this was survivable by luck: the winner banner ("🦁 Curie wins with $26,600") had enough
horizontal room that the buttons, appearing to its right, mostly didn't touch the text. At 768px
there wasn't enough width to spread into, and the button row sat directly on top of the winner's
name and the start of their cash figure — the first thing a player looks at on the screen that
declares who won. This is a distinct bug from the "Critical" one review already caught in this
phase (`7692c84`, buttons unreachable to a real click because they painted *under* the scrim): that
fix corrected the stacking order (z-index) so the buttons became clickable, and in doing so made
them *visible* for the first time at their pre-existing, wrong position — which is likely why nobody
noticed the overlap until this pass looked at 768px specifically. Fixing the click-target bug
exposed the layout bug it had been hiding.

**Why it happened.** `absolute` positioning removing an element from flow, so a following sibling's
margin is measured from the wrong edge, is the same class of mistake as the z-index bug — both are
about a component's own internal positioning leaking into what a caller can safely place next to it.

**The fix.** `FinalScoring` gained an `actions?: ReactNode` prop, rendered *inside* the card's own
flow, directly below the table (`src/game/FinalScoring.tsx`). `GameScreen` now passes the button row
through `actions` instead of rendering it as a sibling (`src/game/GameScreen.tsx`), which also let
the now-unnecessary `relative z-[60]` hack from the earlier fix be deleted — the buttons are in the
card's own stacking context now, so there is nothing left to lift above.

**A second, smaller thing this surfaced.** Nesting the buttons inside the card means their height
now counts toward the card's own content height. For a small table (2 players, 1-2 chains) this
changes nothing — the card was already well under the viewport. For the six-player/seven-chain
fixture, the card's content (938px) exceeds its `max-h-full` allowance (852px at 900px viewport
height), and the card's own `overflow-auto` — which was already there, already correct, and already
exercised by ordinary large scoreboards — now also has to scroll past the buttons rather than just
the table. Confirmed working: `card.scrollHeight (938) > card.clientHeight (852)`, and scrolling the
card to its bottom brings "New game" / "Back to menu" fully into view and hit-testable. This is
exactly what check 8 below asked for, and it was verified, not assumed.

**Test.** `src/game/FinalScoring.test.tsx` gained a failing-first test —
`renders supplied actions inside its own card, not as a loose sibling of the scrim` — asserting the
actions render as a DOM descendant of the `.rounded-2xl` card rather than a sibling of it. Confirmed
failing before the fix (no `actions` prop existed), passing after. A structural assertion is what a
jsdom test *can* honestly say here; jsdom cannot see the pixel overlap itself, which is why this was
also checked by eye in a real browser at both widths (screenshots below).

**Screenshots** (`/private/tmp/claude-501/-Users-petroleumjelliffe-Developer-personal-acquire-startups-m1/456cc3f5-c04f-4f40-bd3b-e1c92f40198c/scratchpad/screens/`):
- `fast-01-end6-1440.png` — after the fix, 1440px, unscrolled: winner banner reads cleanly, nothing
  overlapping it.
- `fast-03-end6-768.png` — after the fix, 768px, unscrolled: same, at the width where the bug was
  worst.
- `fast-02-end6-1440-scrolled.png`, `fast-04-end6-768-scrolled.png` — the card scrolled to its
  bottom at both widths: Total row, then "New game" / "Back to menu" cleanly below it, with a
  visible scrollbar on the card.
- The pre-fix screenshot showing the actual overlap was captured and inspected during this pass but
  was overwritten by a later run before this doc was written (the driving script reused the same
  filename across runs). It is described above from direct observation rather than shown; the
  post-fix images above are the ones that matter for verifying the fix.

## The brief's checklist, answered

1. **When you hold a dead tile, does the panel say which tile and why?** Yes. Fixture: two safe
   11-tile chains (Messla on row B, ZuckFace on row D) with C1 as the only gap, C1 in hand. The panel
   reads *"C1 can never be played — it joins two safe chains."* and the board shows C1 with a 🚫
   overlay, distinct from ordinary hand tiles. Screenshot: `fast-06-dead-tile.png`.

2. **Does trading leave you able to place, in the same turn?** Yes. Same fixture, clicked "Trade in
   1 dead tile" via a real `elementFromPoint` + dispatched click (not a bare `.click()` call — see
   the hit-test note below). The dead tile left the hand, two fresh tiles (H8, an already-held
   playable tile, and I11, drawn from the bag) took its place, and the panel returned to "Choose one
   of your tiles on the board" with no forced "End turn" — the turn was not spent trading.
   Screenshot: `fast-07-dead-tile-after-trade.png`.

3. **Engineer a stuck turn if you can. Does the pass appear? Does the panel explain itself?** Yes,
   engineered via the same two-safe-chains fixture with a hand of exactly `['C1']` — the only tile
   held is the dead one, so nothing is legal. The panel reads *"No tile you hold can be played. You
   may end your turn."*, plus the same dead-tile sentence, and an "End turn" button appears next to
   "Trade in 1 dead tile". Bonus finding: because both founded chains happen to be safe in this same
   position, "You may end the game now" / "End the game" appears simultaneously — a real instance of
   the trade, pass and declare affordances all needing to coexist without crowding each other, and
   they do. Screenshot: `fast-08-stuck-turn.png`.

4. **When the end becomes available, is the offer noticeable without being a nag?** Yes. It renders
   as a distinct amber-tinted block (`bg-amber-50`) with bold amber text and its own amber button,
   inside the existing panel — not a dialog, not a toast, nothing modal. It reads the actual reason
   (`"CamCrooned reached 41 tiles"` / `"Every founded startup is safe"`) rather than a generic
   message. Seen in both the `stuck` fixture (buy-stage-independent, since it renders in `play` too
   when the player cannot place) and in the real 41-tile playthrough (`session3`). Not a nag: it is
   scoped to the panel's existing active-step area, does not steal focus, and coexists with whatever
   else that stage already shows.

5. **Decline it and keep playing. Does the offer stay available, and stay correct?** Not verified by
   watching a live decline-then-continue transition in a browser — the long walk built to reach this
   point by playing (rather than by fixture) stalled and was abandoned per the coordinator's
   direction, and building a *second* hand-crafted fixture pair (end-condition-met-but-not-declared,
   then the same condition one ply later) was judged lower value than the checks actually completed.
   What *is* verified: `useTurnPanel`'s `declareEnd` fragment is derived fresh on every render from
   `getEndCondition(state)` — never latched into local state — which is exactly the property that
   makes "stays available and correct" true by construction rather than by accident; and
   `useTurnPanel.test.tsx`'s existing "declaring the end" suite (already in the green 386, unchanged
   by this pass) explicitly covers both "offers the end... when every founded chain is safe" and
   "offers nothing while no end condition holds" as separate, independently-asserted cases. Recorded
   as **not verified by hand — reasoned from source and existing passing tests**, per the
   coordinator's instruction to write an honest gap rather than a guessed answer.

6. **Declare it. Does the scoreboard's winner match the cash you saw in the players strip?** Yes,
   checked precisely, not just eyeballed: for the six-player fixture, the DOM cash text in
   `[data-zone="roster"] [data-seat]` (the players strip, still present in the DOM at `stage: 'end'`,
   just visually behind the overlay) was compared per-player against `[data-fs-row="cash"]` in the
   scoreboard. Every one of the six matched exactly: Ada \$4,200, Blaise \$5,100, Curie \$3,800,
   Dijkstra \$6,000, Ellison \$2,900, Franklin \$7,200, both places. This is not a coincidence to keep
   re-checking every phase — `PlayersStrip` and `FinalScoring`'s cash row both read `player.cash`
   directly off the same `GameState`, with no adapter or duplicated figure in between, which is the
   structural reason Phase 0's copied-number bug cannot recur here.

7. **Undo the declaration. Does the game come back intact?** Checked by hand and the answer is more
   interesting than "yes" or "no": **there is no undo control offered for the declaration, and this
   is deliberate, not a gap.** Declaring the end hands the actor from the declaring player to nobody
   (`getCurrentActor` returns `null`), which `GameSession`'s segment model treats exactly like any
   other actor change — the segment closes and its snapshots are pruned, including the declaration's
   own. Confirmed live: after clicking "End the game" (via a real `elementFromPoint` + dispatched
   click), the step stack shows a "Game over" entry with no `↺ undo` next to it — none appears
   anywhere in the panel. This matches `GameSession.test.ts`'s own
   `describe('ending the game')` suite, whose second case is titled *"is final — no undo is offered
   once the game is over"* with a comment explaining it is "the segment model working, not a gap in
   it." The implementation plan's Task 3 draft had originally sketched a test expecting undo *to*
   work here; the person who implemented it discovered this consequence and changed the test (and,
   implicitly, the design) to assert the opposite, on purpose, with a reason given. Recorded here as
   a confirmed, intentional behaviour, not a defect — an initial reading of the plan's draft test
   could reasonably expect otherwise, so it is worth saying plainly which way it actually went.

8. **Does the overlay scroll if a 7-chain × 6-player table does not fit at 768px?** Yes, and this is
   what the button-overlap investigation above was verifying when it found the bug. The card
   (`.rounded-2xl`, inside the scrim) has `max-h-full overflow-auto`; for the seven-chain/six-player
   fixture at 768×900 its content (938px) exceeds the available height (852px), and it scrolls
   internally — confirmed by `card.scrollHeight > card.clientHeight` and by scrolling it to the
   bottom and finding "New game" / "Back to menu" fully visible and hit-testable there. The *outer*
   overlay itself does not need to scroll (`overlay.scrollHeight === overlay.clientHeight`); the
   scrolling happens one level in, on the card, which is the same place the reveal curtain has no
   need to scroll at all (it never holds more than a name and an emoji).

9. **"New game" — does it genuinely start a new game rather than the same one?** Verified two ways.
   Structurally: `PassAndPlayPage.tsx` (unchanged by this phase, already covered by its own tests)
   wires `onNewGame={() => setConfig(null)}`, which drops the `GameSession` and its snapshot store
   entirely — a real fresh session on the next `Start game`, not a rewind. By hand: clicked "New
   game" via a real `elementFromPoint` + dispatched click on the ended six-player fixture; the
   handler fired (confirmed via a window flag set only by the click handler, not by direct DOM
   inspection). `GameScreen.test.tsx`'s existing "offers a new game and a way out" test covers the
   same wiring in jsdom; this pass adds the real-click confirmation jsdom cannot give.

## Reduced motion and both widths (Step 3)

**Reduced motion — nothing wrong here.** The final overlay (`[data-testid="final-overlay"]`) and its
inner card carry no `.step-enter` / `.active-step-enter` class and no other animation — checked via
`getComputedStyle`, `animationName: "none"`, `animationDuration: "0s"`, identical whether
`prefers-reduced-motion` is `reduce` or unset. The overlay was never animated to begin with, so
"appears instantly under reduced motion" holds trivially and by construction, not by a media query
that could someday be forgotten. The panel's ordinary step-arrival animation (unrelated to this
overlay) was already covered in Phase 2a's pass and was not re-litigated here.
Screenshots: `session3-03-end-1440-normal-motion.png`, `session3-04-end-1440-reduced-motion.png`
(pixel-identical, from a real 41-tile end reached by actually playing), and
`fast-05-end6-1440-reduced-motion.png` for the six-player fixture.

**Both widths — nothing wrong here, beyond the bug already covered above.** 1440px and 768px both
show the board fitting, no document-level horizontal scroll
(`document.documentElement.scrollWidth === window.innerWidth` at both), and the overlay covering the
full surface (`overlay.width/height === surface.width/height`) at both. The two real-play end-state
screenshots (`session3-06-end-768-normal-motion.png`, and its 1440 counterpart above) confirm this
for a genuine engine-produced end, not just the fixture.

## Checks that passed, not covered above

- **Board and panel stay in sync during real play.** Watched through the setup screen, the
  turn-order draw and several real turns in the 2-player 41-tile playthrough (`session3`) and the
  partial 2-player and 6-player walks before they were abandoned — no frame where one had advanced
  and the other had not, consistent with every prior phase's finding here.
- **The curtain still behaves.** `awaitingReveal` starts `true` for any freshly-built session whose
  stage is not `'draw'` (`GameSession.ts`) — this is not a debug-harness quirk, it is the same
  mechanism that raises the curtain for the winner of a real turn-order draw before their first
  turn, and it correctly gated every fixture-mounted scene in this pass until "Reveal" was clicked,
  exactly as it would for a real handoff.
- **Six-player, 768px setup and first turn look right.** `session2-01-setup-drawn.png` and
  `session2-02-first-turn.png` — six seats add cleanly, the turn-order draw log names all six, and
  the roster strip (a Phase 2a concern, not this phase's) still rotates the active seat to the front
  and keeps it readable at 168-169px per seat, matching what `verify:layout`'s own six-seat walk
  reports on every run of the five gates for this phase.
- **`verify:layout` passes at both widths** with the fix in place — see the gate log; no zone clips,
  no panel-height jitter, the six-seat roster stays legible through a real walk to buy/staging.

## Carried findings — not fixed, deliberately

- **Check 5 (decline-then-still-offered) is not verified by hand**, as stated above. The reasoning
  for why it should hold (derived fresh every render, plus existing passing unit coverage of both
  directions) is solid, but nobody watched it happen turn-over-turn in a real browser this round.
  Worth doing properly — with a walk that reaches the condition by playing, not a fixture pair — the
  next time a phase has budget for a long live walk.
- **Reaching `stage: 'end'` by playing remains slow enough to abandon mid-session.** Two of three
  driven walks (a 2-player walk built to also force a dead tile via two parallel row-chains, and a
  natural 6-player walk) did not reach an end state in several minutes and were abandoned rather than
  run indefinitely. This matches Task 7's own finding in the implementation plan (`verify:layout`
  cannot afford to play to `end` either, for the same reason) — nothing new here, but two more data
  points that the fixture-mounting route used for most of this pass is the right tool for anything
  past the opening, not just an emergency fallback.
- **The players strip's cash stays visible in the DOM at `stage: 'end'`, behind the overlay.** Not a
  problem — the overlay's own cash row is what a player reads, and this pass used the still-present
  strip precisely to cross-check it (see check 6) — but worth naming so nobody is surprised to find
  it there while poking at the DOM.
