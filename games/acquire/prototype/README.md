# Acquire — Flat HTML Turn-Flow Prototype

A single self-contained HTML file (`index.html`) for iterating on the
UI/layout and turn flow of the Acquire startup-themed board game, **decoupled
from the React app**. Inline CSS + JS, no build step, no dependencies, no server
required.

> Why flat HTML: layout/interaction ideas can be edited and viewed on refresh in
> seconds, instead of the minutes each change costs in the real React app
> (install → dev server → browser automation). Once a direction settles here, it
> gets ported back into the React `/prototype` route (branch
> `prototype/ui-layout-rethink`).

## Run it

```bash
# simplest: just open the file
open index.html

# or serve it (clean HTTP origin, refresh to pick up edits)
python3 -m http.server 8777
# → http://127.0.0.1:8777/   (index.html is the directory index)
```

Controls (top bar): **Layout** (side panel / bottom panel), **Pass-and-play
mode** (on/off), **Components** (open the component gallery), **Reset turn**.

---

## What it models

The prototype is a **live, mutable single-turn state machine** — not a set of
static screenshots. You place a tile and it transitions through the real phases
of a turn, computing everything (adjacency, mergers, bonuses, share prices,
conversions, cash) from a small game model.

### Board & pricing
- 9×12 grid, coordinates `A1`–`I12`.
- 7 startups, each on a tier (0–2). Share price is a lookup on **tier × size**:
  - size thresholds `[2,3,4,5,6,11,21,31,41]`
  - per-tier price rows (tier 0 cheapest → tier 2 dearest), e.g. tier 0 =
    `[200,300,400,500,600,700,800,900,1000]`.
- This mirrors the pricing logic in the real `gameLogic.ts` closely enough for
  the numbers on screen to be plausible.

### Starting position (designed to exercise every path)
- Two **equal** size-3 chains: **Messla** `E3–E5` and **ZuckFace** `E7–E9`,
  separated by a single empty **mergeable gap at `E6`**.
- A **lone unaffiliated tile at `G5`** (so a tile placed beside it founds a new
  chain).
- Players: **Alex** ($4,200), **Sam** ($5,800), **Jordan** ($3,100), each holding
  Messla/ZuckFace shares (so payouts, cap tables, and liquidation are meaningful).
- **Alex's hand is hand-picked** so each tile demonstrates a different outcome
  (see use cases below).

### Real logic implemented
- Adjacency-based placement resolution (expand / found / merge / isolated).
- Merger survivor selection incl. **ties**; majority/minority **bonus
  computation** from actual shareholdings; **2:1 trade** conversion; share-price
  recomputation as chains grow.

---

## Use cases (Alex's hand → outcome)

Placing a tile routes to the right phase, then always ends at **Buy**:

| Tile | Placement means | Flow |
|------|-----------------|------|
| `E2` | adjacent to Messla | **expand** → Buy |
| `E10`| adjacent to ZuckFace | **expand** → Buy |
| `G6` | adjacent to lone `G5` | **found** a brand → Buy |
| `E6` | bridges Messla + ZuckFace (equal size) | **merger** (pick victor + payout) → liquidation → Buy |
| `A12` / `I1` | touches nothing | **isolated** → Buy |

The **turn-step stack** in the sidebar records each completed step as you go.
Every step is headed by the **same phase label it had while active** (`PLACE A
TILE`, `FOUND A STARTUP`, `MERGER`, …) with its result below, so a finished phase
reads the same as a live one. There is **no separate "turn complete" summary** —
the buy is just the last step in the stack, followed by a **Start new turn**
button.

**Undo** — every completed step carries a small **↺ undo** that rewinds the game
to the static state captured just before that step (a `structuredClone`
snapshot). Because any step is reversible, the flow avoids "clunky confirms":
choices commit on click. You can undo the placed tile itself, any merger/found
step, or the buy — right up until you start a new turn.

---

## UI / layout ideas being explored

- **Fixed-viewport, no-scroll board** — the full 9×12 grid always fits; nothing
  scrolls the page.
- **Two layout variants, toggled live** against identical state: board + **side
  panel** (320px column) vs board + **bottom panel** — the core comparison this
  prototype exists to make.
- **Player indicators in the sidebar** — all players with cash; the active player
  is highlighted and shows their holding chips; opponents' holdings stay hidden.
- **Stacked turn phases** — completed steps accumulate as a breadcrumb above the
  current decision, so buying stock still shows the tile you placed and any
  merger result.
- **Tile hand as pills + board highlight** — hand tiles highlight their board
  cells; tap either the pill or the cell to select, then **Confirm placement**.
- **Last-placed tile initials** — each player's most recent placement is badged
  with their initial (`A` for Alex) in the cell corner.
- **Board legibility** — coordinates on every cell (no dash: `A1` not `A-1`),
  hidden-until-hover on founded-startup tiles so brand color/label reads cleanly.
- **Buy** — tap a share card to stage it in the cart; tap a staged card (with its
  `×`) to unstage; running total + cash-after.
- **Merger (before/after piles)** — the tied chains show as **stock stacks**;
  clicking one moves it into an empty **Victor** pile that displays its grown
  **new price**, then shows the majority/minority payout inline. No survivor
  brand-tile selectors, no future-price table, no confirm — the click commits
  (undo reverts). A non-tie merger skips straight to the victor view.
- **Liquidation (before/after piles)** — the **held** absorbed stock stack (tap
  to sell one), plus two buy-cart-style piles: **Sell → Cash** (removable `Cash`
  cards, where `Cash` is a brand showing the per-share amount) and **Trade 2:1 →
  survivor** (removable survivor cards). Removing a card returns the shares to the
  held stock; a **↺ reset** clears the sort.
- **Pass-and-play** — a reveal overlay hides the board and shows "Pass to
  <player>" until that player taps to reveal.

---

## Component system

The UI is built from a small set of **reusable render functions** (plain JS →
HTML strings) instead of ad-hoc markup per screen. Each is one canonical look
reused everywhere, with its variations driven by an options object — so the same
concept (a share, a tile, money) always renders the same way whether it's a
selector, a staged item, or a log entry.

Open the **Components** button in the top bar for a live gallery of every
component in every state (`galleryHtml()` in the source).

### Atoms

| Component | Signature | States |
|-----------|-----------|--------|
| **brand** | `brand(id, {mode, selected, disabled, size})` | a company's identity — a **filled** chip, deliberately distinct from a (share) stock card. `mode`: `static` · `select`; plus `selected`, `disabled`, `sm`. Used for log references and merger headers. `"Cash"` is registered as a brand too, so the liquidation sell card renders as a green stock card. |
| **cash** | `cash(amount, {sign})` | `neutral` · `delta` (`+`/`−`, green in / red out) · `zero`. **Money only.** |
| **price** | `price(value, {next})` | `flat` · `change` (`$300 ↑ $600` / `$600 ↓ $400` — up/down arrow **and** the new price tinted green-up / red-down; base stays neutral gray). A **stock's value**, deliberately *not* the green money treatment. |
| **stockCard** | `stockCard(id, {mode, selected, disabled, price, size})` | one **share** — an **outlined** box that **always shows its price** (falls back to the startup's current price if none passed). `mode`: `static` · `select` · `add` · `remove` (`×`); plus `selected`, `disabled`, `sm` size |
| **tile** | `tile(coord, {state})` | `static` · `selectable` · `selected` · `placed` (board cells are the board-size variant rendered in `renderBoard`) |

### Containers (compose the atoms)

| Component | Signature | Notes |
|-----------|-----------|-------|
| **stockStack** | `stockStack(id, count, {size, price, onclick, disabled})` | a `stockCard` with the share count **outside** the card (`× N`); supports a **0** state (dimmed). With `onclick` it becomes a **tappable** stack. Player holdings, merger chains/victor, and the liquidation held stack. |
| **pile** | `pile({title, priceTag, onAdd, addDisabled, items, empty})` | a titled drop zone holding cards (optional `+` add button); powers the buy cart, the merger before/after piles, and the liquidation sell/trade piles. Staged cards always carry a **remove `×`** (`stockCard(remove)`, or `stockStack({onRemove})` for the merger victor) so any mistake is correctable in place. |
| **player** | `player(p, {active})` | status dot · name · **cash** · held **stockStacks**; `active` adds the TURN tag + highlight |

### Composition (things nest)

```
found     → stockCard(select, price)
merger    → pile[Chains: stockStack(tap)] + pile[Victor: stockStack(newPrice)] + cash(delta)
liquidate → stockStack(held, tap) + pile[Sell: stockCard('Cash', remove)] + pile[Trade: stockCard(remove)]
buy       → stockCard(price)     pile → stockCard(remove)
player    → cash + stockStack → stockCard
board     → tile        log → tile + brand
```

`cash` appears both inside a `player` indicator and standalone in merger payouts;
a `stockStack` shows holdings in the player row, the merger chains/victor, and the
liquidation held stack. Two deliberate separations: money (`cash`) vs a stock's
`price`, and a company (`brand`, filled — log references, merger headers) vs a
share of it (`stockCard`, outlined — founded, bought, staged, sold, and the
`Cash` sell card).

---

## Known simplifications (open items)

- **End turn restarts the same Alex turn** (for repeatable demoing) rather than
  advancing to Sam/Jordan.
- **Liquidation runs only for the active player**; other shareholders of an
  absorbed chain don't yet get their own liquidation step.
- Single starting setup (2-way merge). The model handles ties generally; a
  scripted 3-way merge setup was explored earlier and can be re-added.
- All numbers are mock; this file is **throwaway/exploratory** and intentionally
  not wired to the real `gameLogic.ts`.

---

## Relationship to the real code

- This branch contains **only** the flat prototype and this brief — none of the
  React app.
- The real, typed React prototype (the `/prototype` route, mock `GameState`
  scenarios, side/bottom layout components, per-stage panels) lives on branch
  **`prototype/ui-layout-rethink`**.
- Live hosted copy of this flat prototype:
  <https://claude.ai/code/artifact/5b0d6c3b-1f7e-4834-bb20-f2842d948030>
