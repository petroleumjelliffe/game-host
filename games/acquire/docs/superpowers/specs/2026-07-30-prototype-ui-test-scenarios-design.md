# Prototype UI-test scenarios — design

**Date:** 2026-07-30
**Status:** Approved design, pre-implementation

## Purpose

Add standalone, deterministic "scenario" walkthroughs to the `prototype/` folder that
exercise specific game **UI states** without running the game-rules engine. Each scenario
is a hand-authored, click-through script over the shared component system
(`components.css` / `components.js`). These are UI tests, not logic tests: every step's
state is written out as data, and the driver only renders and advances.

Two scenarios in this pass:

1. **Dead tile → trade-in** — a permanently-unplayable tile in hand is traded for a single
   static replacement.
2. **Win condition** — a chain reaching 41 tiles ends the game (game-over panel).

(A 3-way-merger scenario was considered and dropped — it is really a test that the *logic*
can run two sequential mergers, which is out of scope for these data-driven UI scripts.)

## Architecture

### Non-goals / out of scope

- No tile bag, no random draws — the dead-tile replacement is one fixed, authored tile.
- No rules computation, tie-breaks, or branching. Scripts are linear.
- No changes to `index.html`'s game engine. The only edits to `index.html` are (a) adding a
  "Scenarios" nav link and (b) the presentational refactor in "Shared panel renderer" below.

### Files

- **`prototype/scenario.js`** (new) — a generic, rules-free step driver shared by every
  scenario file.
- **`prototype/scenario-dead-tile.html`** (new) — scenario 1.
- **`prototype/scenario-win-41.html`** (new) — scenario 2.
- **`prototype/components.js`** (edit) — hoist the panel-zone renderers out of `index.html`
  so scenarios and the app share one source of truth (see "Shared panel renderer").
- **`prototype/index.html`** (edit) — use the hoisted renderers; add the "Scenarios" nav link.

### The step model — cumulative patches

All game truth is authored data. A scenario defines:

- a **`base`** state object (the full starting snapshot), and
- a **`STEPS`** array where each entry is a *shallow patch* merged onto the accumulated
  state of the previous step.

The driver keeps a running state: `state[i] = merge(state[i-1], STEPS[i])`, with `state[-1] = base`.
This keeps each step readable as "only what changed" and prevents the steps from drifting
out of sync with each other.

A resolved step's shape (all fields optional in a patch except where noted):

```js
{
  board,               // board object → boardHtml(board, boardOpts)
  boardOpts,           // { hand, placed, blocked, hqTiles, owners, ... }
  log:     [{phase, detail}],   // → stepstack (rendered top-to-bottom)
  active:  "<html>|null",       // authored active-step region (activeStep(...)) or null
  staging: "<html>|null",       // authored stagingZone(...) or null (empty placeholder)
  hand:    { name, portfolio, cash },   // → hand zone
  players: [{ id, name, emoji, cash, active }],  // → players strip
  caption: "…",        // optional prose shown under the viewport
  hotspot: { sel, to } // CSS selector of the one clickable target + destination step index
}
```

`board`/`boardOpts`/`hand`/`players` typically live in `base` and rarely change; `log`,
`active`, `staging`, `caption`, and `hotspot` are what most steps patch.

Large boards (e.g. the 40-tile chain) are built by a small per-file helper from chain
definitions (like `FIX_BOARD` in `states.html`), never typed cell-by-cell.

### The driver — `scenario.js`

Rules-free. Responsibilities:

1. `runScenario({ base, steps, mountEl })` — resolve the cumulative states once, render step 0.
2. **Render** the current step as **board + panel** in the exact app order:
   `stepstack → active → staging → hand → players` (via the shared `panelHtml`, see below).
3. **Controls:** a step counter (`2 / 3`), a **Replay/Reset** to step 0, and forward via the
   step's hotspot. A **Back** control is optional/nice-to-have. Reuse the transition-player
   chrome and the `.enter` slide+fade already in `states.html`.
4. **Hotspot:** each step has exactly one hotspot (`{sel, to}`). The driver attaches a single
   click handler that, when the matching element is clicked, animates to step `to`. Linear —
   one target per step.
5. Respect `prefers-reduced-motion` (no enter animation), matching the existing lab.

### Shared panel renderer (optimization #2)

`components.js` already owns the atoms and `boardHtml`, `stagingZone`, `stepEntry`,
`activeStep`, `payoutLines`, `stacksFor`, `boughtStacks`. Missing (currently in `index.html`):
the hand zone, the players strip, the stepstack wrapper, and the panel-order composition.

Hoist **data-parameterized** versions into `components.js`:

- `handZone({ name, portfolio, cash })` — the "<name>'s hand" zone.
- `playersStrip(players)` — the players strip (each player carries its own `active` flag).
- `stepStack(steps)` — wraps `stepEntry(...)` items (undo omitted in scenarios).
- `panelHtml({ steps, active, staging, hand, players })` — composes the five zones in order.

Then `index.html`'s `renderPanel()` calls `panelHtml(...)` with app-derived data, and
`scenario.js` calls it with authored step data. Purely presentational; the engine is
untouched. This guarantees scenarios render the real panel and cannot drift.

## Scenario 1 — dead tile → trade-in (`scenario-dead-tile.html`)

**Board (base):** two safe chains — Messla `B1–B11` (11 tiles), ZuckFace `D1–D11` (11 tiles).
The gap row C bridges them: any `C{n}` tile is orthogonally adjacent to `B{n}` and `D{n}`,
so placing one would merge two safe chains → permanently dead.

**Hand (base):** `[C6 (dead), G6 (normal)]`. Balance and portfolio per the app's Alex fixture.

**Steps (2):**

- **Step 0 — play.** Board highlights the hand; `C6` rendered in the `blocked` tile state but
  **clickable**. Active region: "Place a tile" with a hint —
  "◻ C6 can never be played (it would merge two safe chains) — tap to trade it in."
  `hotspot = { sel: <C6 tile>, to: 1 }`.
- **Step 1 — traded in.** `C6` removed from the hand; the single static replacement `I12`
  added. Log gains one entry: `Traded a tile · ◻ C6 → drew ◻ I12`. Caption notes the turn
  continues (the player may still place `G6`). No further hotspot (end of script);
  Replay resets to step 0.

## Scenario 2 — win condition, chain hits 41 (`scenario-win-41.html`)

**Board (base):** one chain (`Gobble`) pre-grown to **40 tiles** via a helper that fills a
contiguous region (exact shape is cosmetic; count = 40). One empty cell adjacent to the chain
is the play target; the active player's hand contains that tile.

**Steps (2):**

- **Step 0 — play.** Hand highlights the adjacent tile. Active region hint:
  "Gobble is at 40 tiles — placing here makes 41 and ends the game."
  `hotspot = { sel: <target tile>, to: 1 }`.
- **Step 1 — game over.** The target tile is placed (board shows the chain at 41). Panel shows
  a **game-over region**: heading "Gobble reached 41 — game over" plus **final standings** —
  each player's name/emoji and final cash, built from the players-strip + cash atoms. Log gains
  `Placed ◻ … → Gobble reached 41 · game over`. No further hotspot; Replay resets.

The game-over region is a new small presentational block (heading + standings list) authored in
the scenario; if it proves reusable it can later move into `components.js`, but it is not shared
in this pass.

## Navigation

- Add a **"Scenarios"** link to the main `proto-nav` in `index.html`, `states.html`,
  `motion.html` (pointing at `scenario-dead-tile.html`).
- The two scenario files carry a shared sub-nav linking both scenarios and "Prototype" (back to
  `index.html`), matching the existing `.proto-nav` styling.

## Testing / verification

Manual, since the prototype has no test suite:

- Each scenario loads with no console errors and renders step 0.
- Clicking the highlighted hotspot advances exactly one step with the enter animation; the
  step counter updates; non-hotspot clicks do nothing.
- Replay returns to step 0.
- Dead-tile: `C6` shows the blocked look yet is clickable; after trade-in the hand shows the
  replacement and the log entry.
- Win-41: the board shows a 41-tile chain after placement and the game-over standings render.
- `index.html` still renders identically after the panel-renderer hoist (regression check on
  play / found / merger / payout / liquidate / buy / turn-complete panels).
- Panel zones do not resize between steps (the panel-height-stability invariant still holds).

## Implementation sequencing

1. Hoist panel renderers into `components.js`; rewire `index.html`'s `renderPanel`; verify the
   app is visually unchanged.
2. Build `scenario.js` (driver + cumulative-patch merge + controls + hotspots).
3. Build `scenario-dead-tile.html`.
4. Build `scenario-win-41.html`.
5. Wire nav links + shared sub-nav.
