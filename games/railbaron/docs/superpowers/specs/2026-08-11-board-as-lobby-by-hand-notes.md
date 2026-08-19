# The board as the lobby — by-hand pass

**Date:** 2026-08-11
**Branch:** `feat/board-as-lobby`
**Built bundle**, not the dev server — `npm run build && npm run preview`, served at
`localhost:4173/railbaron/`, driven in real Chrome over CDP.
**Viewport:** 1440×687 unless stated. The window could not be made taller than 687px with
the available tooling, which matters for one finding below.

## What passed

| # | Check | Result |
|---|---|---|
| 1 | Home → `PASS AND PLAY` flaps | Tiles sampled mid-transition: `QATTABOEAQMBZ` → `RAUUBCPFBRNC0` → `SAVVCDQGCSND1` → `TAXXEFSIEUNF3` → `TAP TO JOIN` |
| 2 | `PLAY ONLINE` inert | Not a button in the accessibility tree — static text, so it is inert to a screen reader and not merely greyed |
| 3 | Six barons named, each its own colour | `#e02b1d #5fbb2e #2f7fe8 #f0b429 #1d1d1d #f2efe6` — all six distinct, matching `SEAT_COLORS` |
| 4 | Rename an occupied seat | Enter commits, Escape abandons (typed `ZZZ`, row still read `ADA`), blur commits |
| 5 | Clearing a name vacates the seat | Seat 6 returned to `OPEN / TAP TO JOIN` |
| 6 | Start gate | Shut at one baron (`NEED 2 SEATS`), open from two (`DEALS SEAT 1`) |
| 7 | Region ballot | Seven regions in seven rows, the rolled region dimmed and marked `ROLLED`; choosing sent ADA to Buffalo, Northeast, $20,500 |
| 8 | Reload mid-game | Resumed to the saved board: `JUST NOW`, `TURN 12`, `LEADING ADA $145,000`, `5 BARONS · TURN 12` |
| 9 | Discard both ways | `NEW GAME` → `KEEP PLAYING` left the save intact; `NEW GAME` → `YES, DISCARD` removed the key outright (`null`, not an empty log) |
| 10 | Tap during a flap | Tiles mid-spin read `CVGGBMP`; tapping another row still acted — event count 21 → 22 |

## Panel height — the numbers, not an impression

The board measured **687.0px on every screen**: home, pass-and-play setup, in play, region
ballot, saved game, discard confirmation. All seven rows measured **74.6px** on every one
of them.

That is the seven-row invariant doing exactly what it is for. It is worth having as
figures rather than as a claim, because jsdom reports zero for all layout and the suite
therefore cannot see it at all — the row *count* is testable, the row *height* is not.

## Findings

### 1. The board has a hard minimum width of 1335px — measured, previously unstated

At a 1024px viewport the page overflows horizontally: `scrollWidth` 1335 against
`clientWidth` 1024. At 1440px there is no overflow. The columns are fixed
(22 + 168 + 170 + 406 + 219 + 178, five 22px gaps, 14px row padding) and nothing shrinks,
by design — `flex: 0 0 Npx` throughout.

**This is consistent with the project's stated scope**, not a contradiction of it: the
React-port spec already rules "tablet, landscape, single layout", on the grounds that six
14-character split-flap rows cannot fit a phone without becoming a different design. The
source design is drawn at a fixed 1400×788 and never had to state a minimum.

**Not fixed, deliberately.** Making the board fluid below 1335px means either shrinking the
tile — which the column-budget test exists to prevent — or reflowing columns, which is the
"different design" the scope ruling already declined. Recorded so the bound is a known
number rather than a surprise.

### 2. `prefers-reduced-motion` is unverified in a real browser

The available browser tooling exposes `colorScheme` but not `prefers-reduced-motion`, and
the OS setting cannot be driven from here. Confirmed only that the media query resolves
(`matchMedia('(prefers-reduced-motion: reduce)').matches` returns a boolean, currently
`false`).

The code path itself is covered by `useFlap.test.tsx`, and that test is not hollow: with
the guard inverted it fails in **both** directions — `expected 'D' to be 'B'` when motion
should spin, and `expected 'A' to be 'D'` when it should snap.

**Still owed:** one pass with Reduce Motion switched on at the OS level, or Chrome launched
with `--force-prefers-reduced-motion`. Cheap, and the only stated design requirement not
observed on a real page.

### 3. The viewport could not be made taller than 687px

`resize_page` changes width but not height here, so every measurement above is at 687px.
The design's board is 788px tall, which would give ~92px rows rather than 74.6px. Nothing
suggests a problem — the rows are uniform and the height is stable at the height tested —
but the design's own proportions have not been observed.

This is what produced the chip finding during Task 5: at 74.6px rows, the design's flat
74px chip exactly filled its row and fused all six seat colours into one continuous stripe.
Now `height: 80%`, which holds the design's 74/92 ratio at any row height. Measured after
the fix: chip 59.7px in a 74.6px row, 7.5px gap, ratio 0.80.

## Found by the whole-branch review, after every task had passed its own

Both of these survived clean per-task reviews because neither belongs to a single task.

### 4. `/pass-and-play/game` with no game was a dead end — **fixed**

A stale bookmark or a typed URL rendered the play screen over an empty state: seven blank
rows, **zero buttons**, and a header reading `IN PLAY`. The only affordance was BACK.
Observed on the built bundle. Now redirects to `/pass-and-play`, with a test that was
confirmed to fail without the guard (`Unable to find an accessible element with the role
"button" and name /tap to join/i`).

### 5. `SplitFlap` had become dead code — **removed**

Task 10 deleted its last consumer. Nothing imported `SplitFlap` or `formatMoney`, but its
ten tests still passed, so the suite gave no signal. The plan said to keep it on the
grounds that it was "still tested and used" — true when the plan was written, false by the
time that task ran.

Worth deleting rather than leaving: it was a **second flap renderer**, which is exactly the
duplication the unification existed to remove, and it would have drifted from `BoardRow`
silently. `formatMoney`'s one piece of real knowledge — that a payout of `0` is a genuine
journey and only `null` means a home town — is preserved in `play.ts` and covered by
`play.test.ts`.

## Findings from earlier tasks, recorded here so they are in one place

- **The flap did not play on navigation at all** (Task 7). Each route rendered its own
  `Board`, so navigating unmounted one and mounted another and `useFlap` correctly declined
  to animate a first render. Every test passed throughout, because each Board was correct in
  isolation. There is now one Board above the routing. It also collapsed a second bug: a
  `useGame` per route, i.e. one copy of the event log each.
- **The naming input replaced the whole row** rather than the destination column (Task 7).
- **`isGameEvent` would have silently destroyed every save** containing a `started` or
  `renamed` event (Task 6) — `loadLog` applies it all-or-nothing. Observed before the fix:
  a four-event log came back empty.
