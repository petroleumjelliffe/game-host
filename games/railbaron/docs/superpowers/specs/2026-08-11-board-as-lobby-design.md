# The board as the lobby — design

**Date:** 2026-08-11
**Status:** Design agreed; not yet built
**Covers:** Phase 2 of [ROADMAP.md](../../../ROADMAP.md), and the shape Phase 3 will consume
**Source design:** `Multiplayer Screens.dc.html` in the *Rail Baron Game Board Design*
project (Claude Design), boards `1a`–`1f`

## What and why

Rail Baron currently drops you straight into a live board with six colour-named seats.
There is no front door: no way to start a game, name the barons before play, or see what
you are resuming. Phase 2 owes one.

The obvious front door is a menu. This design does something better: **there is no menu,
because the departures board is already the menu.** Every screen is the same physical
object — seven rows, five columns — and choices occupy the destination column. Picking one
flaps that column over to the next screen's choices. Nothing new is introduced when the
game starts, because the same seven rows carry through from the mode select to the last
journey of the game.

**This is not a new idea in this codebase; it is an existing one, generalized.**
[`RegionBallot.tsx`](../../../src/game/RegionBallot.tsx) already says so in its own header
comment: *"The seven regions take over the destination column, one per row, so the board
keeps its shape instead of opening a dialog over it."* The ballot arrived at the pattern
independently. This work makes it the rule.

The seven-row budget is not arbitrary either. There are exactly seven regions, exactly six
barons plus a start row, and exactly two modes. The board fits the game.

## Scope

**Built here — the local half:**

| Board | Screen | Route |
|---|---|---|
| `1a` | Home — mode select | `/` |
| `1b` | Pass & Play — setup | `/pass-and-play` |
| `1c` | Pass & Play — saved game | `/pass-and-play` (when a save exists) |
| — | Discard confirmation | transient, no route |
| — | In play — departures | `/pass-and-play/game` |
| — | Region ballot | transient, no route |

**Designed but not built — the online half.** Boards `1d` (online lobby), `1e` (new room)
and `1f` (join room) are approved and stay in the design project until the lift described
in ROADMAP Phase 3. They are not implemented here and no server code is written.

**Explicitly out of scope:** the map view, cash and railroad ownership, a win condition,
any PWA work (see *Deferred and TBD*), and Acquire's `verify:layout` CDP gate.

## Decisions

| Decision | Why |
|---|---|
| The board is the only surface; every screen is a `ScreenDef` | The design's actual claim. One object that re-letters itself, not a set of pages that share styling. |
| Screens are **data**, not components | The flap transition is a function of `(fromTexts, toTexts)`. That is trivial when a screen is data and awkward when it is a component tree — under a component-per-screen model, something above both still has to hold the outgoing text, which is this model rebuilt with extra layers. |
| The in-play board and the region ballot are unified onto the same row model now | Otherwise two row components must be kept pixel-identical by hand, and the home→game transition cannot flap. Cost is rewriting working, tested components; the alternative is carrying the divergence forever. |
| An explicit begin gate, recorded as a `started` event | Seating, naming and beginning then all replay like everything else, and the generic lobby's `lifecycle(): 'lobby' \| 'playing' \| 'over'` maps onto derived phase at the lift instead of needing something invented. |
| Undo is a play-phase affordance only | Matches Acquire. Setup needs no undo because a taken row is tappable to rename — the design already provides the correction directly. |
| `Earned` is derived, never stored | `sum(stop.payout ?? 0)` at replay. No new events, no engine change, and no hardcoded figure — the failure mode Acquire shipped in its Phase 0. |
| `1c` carries a roster **summary** row, not one row per baron | Two action rows plus six barons is eight rows. The seven-row invariant is what makes the flap read as one physical object; it outranks per-seat detail on a screen you are about to leave. |
| `react-router-dom` v7, and a root-level `basePath.ts` | Mirrors Acquire exactly, so the eventual lobby backport lands on shared primitives and `/room/:code` deep links work without a rewrite. |
| Rail Baron keeps six barons | The seven-row squeeze is solved per-screen. Changing the game's own 2–6 player range to satisfy a layout constraint was considered and rejected. |

## The row and screen model

Two types carry the app.

```ts
/** Every screen the board can show. Only some have routes — see Routing. */
export type ScreenId =
  | 'home' | 'passAndPlay' | 'saved' | 'confirm' | 'play' | 'regionBallot';

/** What an editable row is editing. Seat names today; room code and join
 *  name join it at the lift. */
export type FieldId = `seat:${SeatId}`;

/** One of seven. Every screen is seven of these, always. */
export interface Row {
  label: string;              // col A — "Seat 1", "Mode 01", a baron's name in play
  status: string;             // col B — "Open" / "Ready" / a region in play
  text: string;               // col C — the 14-tile flap. The choice.
  amount: string;             // col D — "2-6", "42,000", a payout
  showDollar: boolean;
  right: string;              // col E — "One device", "Tap to edit", a train
  chip: string | null;        // seat colour, or null for a bare row
  tone: 'normal' | 'dim' | 'disabled';
  action: RowAction;
}

export type RowAction =
  | { kind: 'navigate'; to: ScreenId }
  | { kind: 'edit'; field: FieldId; placeholder: string }
  | { kind: 'act'; seat: SeatId }   // in play: roll for this baron
  | null;                            // blank rows, and read-only rows

export interface ScreenDef {
  title: string;                     // header, right of "RAIL BARON"
  sub: string;                       // "THIS DEVICE", "SAVED GAME"
  back: ScreenId | null;
  cols: [string, string, string, string, string];
  rows: Row[];                       // exactly 7, padded with blanks
}
```

Each screen is a pure function `(state) => ScreenDef`, one per file under
`src/board/screens/`. No React, no styling, testable without a DOM. `<Board>` renders any
`ScreenDef` and knows nothing about which screen it holds.

**Two departures from the source design, both deliberate:**

`RowAction` is a union rather than the canvas's independent `go` / `edit` / `disabled`
fields. In the canvas those can contradict each other — a row carrying both `go` and
`edit`, or `disabled` alongside a live `go`. As a union they cannot. It also gives blank
rows an honest representation instead of a `kind: 'blank'` special case threaded through
the renderer.

The `act` variant exists because **the canvas does not specify in-play interaction.** Its
`game` board is a static flip target with no handlers. In the real app, tapping a baron's
row is what rolls the dice — the app's entire purpose — so the row needs an action that is
neither navigation nor editing. Today's
[`useGame.activate`](../../../src/state/useGame.ts) becomes its handler.

**A side effect worth having:** naming a baron currently goes through `window.prompt`,
which carries the React 19 StrictMode double-fire hazard documented in a long comment
above it. The design's inline input on the destination column replaces the prompt, and the
hazard goes with it.

## The flap engine

Each tile holds `{ cur, prev, target }` as indices into a 42-character alphabet
(`" A–Z 0–9 , . - & '"`). Every tick, each unsettled tile advances `cur = (cur + 1) % 42`.
The cascade is not choreographed — it falls out of tiles having different distances to
travel. A tile three steps from its target settles on tick three; one thirty steps away on
tick thirty. Default step 52ms; worst case for a single tile is 41 ticks ≈ 2.1s.

**Only column C animates.** Columns B and E blank for three ticks and then reappear;
columns A and D swap instantly. That asymmetry is the effect. Build exactly this and look
at it before considering animating column D.

**Driven declaratively.** The canvas drives transitions imperatively — compute `from`, set
state, call `flap(from, to)` — which obliges every future call site to remember to capture
`from` first. Instead `useFlap(texts)` takes the current target texts and holds the
previous internally, spinning when they change. A screen then *is* its `ScreenDef` and the
animation is a consequence rather than a call site.

**Four requirements the canvas cannot account for:**

- **`prefers-reduced-motion` snaps instantly.** Two seconds of spinning glyphs is what
  that setting exists to suppress.
- **The visually-hidden text reads the target throughout.**
  [`SplitFlap`](../../../src/game/SplitFlap.tsx) already pairs `aria-hidden` tiles with a
  hidden text copy; during a flap that copy must show the destination, or a screen reader
  narrates two seconds of noise.
- **A transition starting mid-flight cancels the one in flight**, and timers clear on
  unmount.
- **A tap during a flap snaps it to settled, then acts.** Otherwise the board is inert for
  up to 2.1s, and making a menu unresponsive to protect an animation is the wrong trade.

**Note that today's `SplitFlap` is static** — it renders characters straight into spans.
The drum is new, and every screen depends on it. It is the first thing built and the
riskiest thing here.

## The screens

| Screen | Rows |
|---|---|
| `home` | `PASS AND PLAY`, `PLAY ONLINE`, + 5 blank |
| `passAndPlay` | 6 seat rows (`TAP TO JOIN` / the baron's name), `START GAME` as row 7 — dim until two seats are filled |
| `saved` | `CONTINUE GAME`, `NEW GAME`, one summary row, + 4 blank |
| `confirm` | `YES, DISCARD`, `KEEP PLAYING`, + 5 blank |
| `play` | one row per seated baron (up to 6), + blanks |
| `regionBallot` | the seven regions, one per row — the board exactly full |

**The `saved` summary row** carries the leading baron: their chip, their name in column C,
their earnings in column D, and `N BARONS · TURN n` in column E. The destination column is
14 characters, so it cannot list six names any more than seven rows could hold them; the
leader is the most informative single fact about a game you are returning to.

**`PLAY ONLINE` on `home`** routes to `/online`, which does not exist until the lift. Until
then it is rendered `disabled` with `SOON` in column E — not hidden. The mode select is
the design's statement that both modes exist; showing one and concealing the other
misstates it.

## Routing and the base path

`react-router-dom` v7 with `<BrowserRouter basename={...}>`, the basename derived from
`import.meta.env.BASE_URL` exactly as Acquire's `src/main.tsx` does. A new root-level
`basePath.ts` holds `/railbaron` as its single copy, imported by `vite.config.ts`.

Root-level rather than `src/` because `vite.config.ts` and build scripts run under Node,
outside the app graph — the same reasoning as Acquire's file, which records having lived
in three places before it was consolidated. Rail Baron has no deploy story yet, so the
value is unverified until a first deploy; the point of the file is to exist *before* the
path proliferates.

**Screens and routes are not the same set.** `confirm` and `regionBallot` are transient
states within a route, not routes of their own: a discard confirmation should not be
bookmarkable, and the back button out of one must be safe rather than destructive.
`/pass-and-play` renders `saved` when a save exists and `passAndPlay` when it does not.

## State, the begin gate, and persistence

One new event:

```ts
| { type: 'started' }
```

`phase` is derived, not stored: `events.some(e => e.type === 'started') ? 'playing' : 'setup'`.

**Undo gains two guards.** [`undo`](../../../src/state/game.ts) is currently a bare
`slice(0, -1)`. It must refuse when the log has no `started` event, and refuse when
rewinding would cross it. (`undoLast` is presently built but unwired — `useGame` returns
it and `App` never calls it.)

**The save record gains `savedAt`.** Board `1c` shows a relative age, which nothing in
`{ version, events }` can supply. The turn count is derivable from `arrived` events; the
age is not.

**That bump needs a migration, not a version bounce.** `loadLog` returns `[]` on version
mismatch, so going 1 → 2 would **silently discard any game in progress** — precisely the
game the screen exists to protect. Accept v1 records, treat `savedAt` as unknown, and
render `SAVED` in place of a relative time. Roughly three lines, and the habit matters more
than today's single affected save.

**Continue is not a second data shape.** There is one stored game per device, and `1c`
reads exactly the record that resuming reads: roster, earnings, turn count and age all come
from `replay(loadLog())`.

## Testing and verification

**Screen defs test as pure functions.** `passAndPlay(state).rows[6].action` is `null` with
one seat filled and a `navigate` with two. No DOM, no render, no mocking. This is the main
payoff of screens-as-data and it covers the begin gate, disabled states and row contents
cheaply.

**The drum tests under fake timers**, provided the advance step is a pure function over
tiles rather than logic buried in an interval callback.

**Two tests here are hollow by default and must be broken before they count.** The
reduced-motion test passes trivially if the animation never started for an unrelated
reason; the undo-floor test passes vacuously against a log with no `started` event to
cross. Break each, read the real failure, then keep it.

**jsdom can verify the seven-row count, not the seven-row claim.** "Every screen is the
same physical object" is a statement about height, and jsdom reports zero for all layout.
Assert structure and row count where that is honest; verify height stability in a real
browser during the by-hand pass and write the numbers down.

**Acquire's `verify:layout` CDP gate is deliberately not ported.** It spent five phases
being trusted for the wrong reasons, and its flakiness turned out to be its own rounding
arithmetic rather than any app defect. Build an equivalent later if the by-hand pass shows
something actually moving.

**A by-hand pass is part of the work.** Every one of Acquire's twenty-six Phase 5 findings
came from one and none from its suite. Notes commit alongside this spec.

## Deferred and TBD

**Deferred to the lift (ROADMAP Phase 3), not decided here:**

- **`1e` shows five seats, Rail Baron seats six.** The room code takes a row, leaving five
  before `START GAME`. The same squeeze `1c` solves with a summary row, unsolved for the
  room. Decide when the room is built.
- **Hosting** — a second Render service is a second paid instance; the alternative is both
  games' servers in one process.
- **Honor-reclaim policy** — whether same-name seat capture suits this game's trust model.
- **Game-flavoured rejection codes** — `notYourTurn` meaning "not the host" is wire legacy
  in the shared lobby.

**Two findings for Acquire, from reading its lobby against this design:**

- **`1f`'s optional name field would fix Acquire's `RoomRefused` dead end.** A player whose
  browser lost its identity mid-game needs a typed name to trigger the honor reclaim, and
  today the only screen offering one is unreachable for them. This board gives them the
  field, and Acquire's wire already accepts an absent name.
- **Rail Baron's fixed six-colour seat table sidesteps Acquire's duplicate-seat-id bug.**
  Seats here are `'red' | 'green' | …`, always present; Acquire mints `p${length + 1}` and
  splices on leave, so leave-then-join collides. A fixed seat table is worth considering at
  the lift.

**TBD — PWA.** Rail Baron has no PWA today: no `public/`, no manifest, no service worker,
no registration. Nothing in this design builds one. The three pieces that will interact
when one arrives are `basePath.ts` (Acquire's manifest generator imports its equivalent for
`start_url` and `scope`), the router (Acquire's worker does network-first navigation with a
cached-shell fallback), and the local save. All three land here in shapes a PWA expects, so
nothing is foreclosed — but none of it is designed, and the update path in particular is
unexamined.

## Appendix — what the source design specifies

For anyone reading without the canvas open. Column widths: 22px chip, 168 label, 170
status, 406 destination, 219 amount, 178 right. Board 1400×788 with a 14px bezel. Header
78px. Tokens match
[`src/game/tokens.ts`](../../../src/game/tokens.ts) with two drifts to reconcile at build
time: tile width 27/26 in the canvas versus 30 in tokens, and the `black` seat at `#3a3a3a`
versus `#1d1d1d`.

`support.js` in the design project is the generated `dc-runtime` — the canvas interpreter
for `<x-dc>`, `sc-for`, `sc-if` and `DCLogic`. None of it ports; Rail Baron is already
React and `DCLogic`'s state maps onto `useState` directly.
