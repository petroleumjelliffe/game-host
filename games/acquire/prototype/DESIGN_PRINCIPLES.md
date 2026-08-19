# Design principles — Acquire flat-HTML prototype

Working notes for `index.html` (single self-contained file: inline CSS + JS, no
build). This captures the conventions we've settled on so future changes stay
consistent, plus the plan for the next round of component refinement.

---

## Interaction principles

These are the load-bearing decisions. When adding a phase or control, follow them.

- **Undo over confirm.** Every committed step snapshots the game
  (`structuredClone`) *before* it runs, and renders a small **↺ undo** that
  rewinds to that static state. Because any step is reversible, we don't gate
  choices behind "confirm" buttons — **choices commit on click/tap**. Reserve
  buttons for genuine forward progressions (Continue, Buy & end turn), never for
  re-affirming a selection you already made.
- **Tap to commit, tap to switch.** Placing a tile, founding, picking a merger
  victor, buying — all happen on a single tap. To change a decision, tap a
  different option (it reverts + re-applies) or use the step's undo.
- **Components carry meaning; minimize prose.** No explanatory "here's what
  happened / here's what to do" copy. The board highlight, the stacks, the piles
  and labels should be self-evident. Any short instruction goes *below* the
  controls so revealing/updating content doesn't shove the controls around
  (minimize relayout after actions).
- **Consolidate multi-actor phases.** When several players act in one phase
  (liquidation), show a **queue** for progress and record **one consolidated log
  step** with **one undo** for the whole phase — not a step per actor.
- **Show the same thing to all players.** Pass-and-play / online are not
  differentiated yet; nothing is hidden per-player (the initial hand reveal
  overlay aside).
- **Placement lives on the board.** The hand stays highlighted on the grid
  through the whole turn; the placed tile is ringed; tapping another cell
  switches the move. No hand UI in the sidebar.

## Component system

Small set of render functions (HTML strings). The **Components** button in the
top bar opens a live gallery (`galleryHtml()`), which also renders each turn
phase as a standalone unit (`phaseShowcase()`).

**Two deliberate semantic separations:**
- **Money (`cash`) vs a stock's value (`price`).** Cash is green/red money;
  price is a neutral tag whose *change* shows an up/down arrow + tinted new value.
- **Company (`brand`, filled) vs a share of it (`stockCard`, outlined).** `brand`
  is used for log references and merger context; `stockCard`/`stockStack` for
  shares. `"Cash"` is registered as a brand so the liquidation sell card is a
  green stock card.

**The stack is the primary interactive share entity.**
`stockStack(id, count, { price, onClick, onRemove, disabled, size })` — a nested
`stockCard` + a count. **`onClick`** (the body) usually **increments**;
**`onRemove`** renders a **`×`** that **decrements**, shown only when count > 0.
Stock cards are used almost entirely *inside* stacks. Special case: during
liquidation, clicking the **held** (liquidated) stock **decrements** it (sells).

| Function | Role |
|---|---|
| `brand(id, {mode,selected,disabled,size})` | company identity, filled chip |
| `cash(amount, {sign})` | money — green/red, `delta` for `+`/`−` |
| `price(value, {next})` | stock value — neutral, `next` shows ↑/↓ + tint |
| `stockCard(id, {mode,price,size,...})` | one share, outlined, always priced; mostly nested |
| `stockStack(id, count, {...})` | **primary** share entity (see above) |
| `tile(coord, {state})` | inline tile / board cell variants |
| `player(p, {active})` | dot · name · cash · held stacks |

## State & architecture

- Single mutable `game` state machine; `ui` holds transient view state. `render()`
  rebuilds board + panel from `game` every change.
- **Undo**: `history` = array of snapshots. `beginAction()` snapshots before an
  action and sets `curHist`; `addStep()` tags the new step with `curHist`;
  `undoTo(i)` restores `history[i]` and truncates. One `beginAction()` per
  undoable step (liquidation takes one for the whole phase).
- Stages: `play → foundStartup | merger | buy → turnComplete`, with
  `merger` covering victor-pick + payout, and `mergerLiquidation` a queued
  sub-phase.

## Visual conventions

- Brand colors from `.brand-{id}`; **filled = company**, **outlined = share**.
- Cash green (`#15803d`) / red (`#b91c1c`); price neutral gray with tinted deltas.
- Tiles blue outlined; placed = dark; founded = brand color; last-placed tile
  badged with the player's initial.
- Uppercase tracked labels for phase/section headers.

---

## Planned refinements (next round)

### 1. Portrait, card-like stacks with depth
Make `stockCard` a **portrait** card (taller than wide): vertical layout with the
ticker on top and price on the bottom, more like a stock certificate / playing
card. In a `stockStack`, show **physical depth** when count > 1 — layered card
edges behind the front card (offset down-right via `::before`/`::after`, capped at
~2 extra layers), reinforcing the `×N` count.
- Restyle `.stock` to `flex-direction: column`, fixed width (~52px), min-height,
  ticker (bold) / price (small) stacked.
- Depth layers driven by count (0/1/2 extra layers), same border color behind.
- Watch layout density: portrait cards are taller — the buy row, found groups,
  liquidation lanes, and player holdings need a compact (`sm`) portrait variant.

### 2. Brands as `$` tickers
Give each brand a stock-ticker abbreviation starting with `$` and render it on the
cards instead of the full name.
- Add `ticker` to the `STARTUPS` config. **Decided:** `$G` Gobble, `$S` Scrapple,
  `$PP` PaperfulPost, `$C` CamCrooned, `$M` Messla, `$Z` ZuckFace,
  `$W` WrecksonMobil (Cash → `$$`).
- `stockCard`/`stockStack` render the ticker; keep the full name available on
  hover (`title`) and spell it out where you're *learning* a company (the
  founding screen).

### 3. Founding screen grouped by starting price
Group the foundable brands by their founding price (a function of tier at the
starting size) under price headers, instead of one flat row.
- Compute `sharePrice(tier, foundSize)` per available brand; bucket by price;
  render ascending groups, each headed by the price (reuse the `price`/`cash`
  atom styling). At the 2-tile start that's `$200 / $300 / $400`.

### 4. Player emoji icons
Give each player an emoji avatar.
- Add `emoji` to the players config. **Decided (animals):** Alex 🦊, Sam 🐢,
  Jordan 🦁.
- Render it in the `player` indicator (leading the name, in place of or beside
  the status dot), in the liquidation **queue** chips, and optionally beside
  player names in payout lines / log details.

**Order of work:** tickers (2) first — smallest and it feeds the card layout —
then the portrait/depth card (1), then found grouping (3) and player emojis (4).
