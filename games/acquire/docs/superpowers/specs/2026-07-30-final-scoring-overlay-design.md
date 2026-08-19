# Final-scoring overlay — design

**Date:** 2026-07-30
**Status:** Approved design, pre-implementation

## Purpose

When a chain reaches 41 tiles the game ends and the winner is determined. This adds the
**final-scoring overlay**: a column-per-player table that tabulates, for every chain still
standing on the board, each player's stock value and shareholder bonus, then their cash, then
their total.

This pass builds the overlay as a **states-catalog entry only** (`states.html`). It is not
wired into the live engine (`index.html`) and not added to `scenario-win-41.html`.

## Scope

### In scope

- A `finalScoring(props)` composite renderer in `components.js`.
- Its styles in `components.css`.
- One new full-page-width section in `states.html` presenting the overlay over a dimmed
  board + panel, with a hand-authored fixture.

### Out of scope

- No engine integration. `index.html` is not modified at all; the catalog nav link already
  exists.
- No scenario step. `scenario-win-41.html` keeps its current placeholder `standings()` list;
  replacing it is a later pass once the overlay proves out.
- **No animations.** No enter transition on the overlay or the scrim.
- No scoring *rules*. Majority/minority resolution (ties, sole holders) is authored fixture
  data, not computed by the renderer.

## The scoring model

For each chain, each player has exactly **two** values:

| Value | Meaning |
|---|---|
| **stock** | `qty × final share price` |
| **bonus** | the shareholder bonus, if any |

A bonus is one of:

- **majority** — rendered `M`
- **minority** — rendered `m`
- **both** — rendered `Mm`; a sole holder of a chain takes majority and minority together as a
  single figure

Rows cover **only chains standing on the board at game end**. Never-founded chains and chains
already absorbed by an earlier merger do not appear.

Below the chain rows:

- a **Cash** row — cash each player holds at the end
- a **Total** row — `sum(stock) + sum(bonus) + cash`

## Table structure

One column per player, **sorted by final total, highest first**, so the winner reads leftmost.
Each chain contributes three rows: a chain header (ticker · tiles · price), a `stock` row, and
a `bonus` row. Values therefore align horizontally across players and are directly comparable.

Rendered with the fixture below (note the columns are in total order, not seat order):

```
                      🐢 Sam      🦊 Alex    🦁 Jordan
 $G Gobble   41 tiles · $1,000
   stock             ×3 $3,000  ×6 $6,000   ×1 $1,000
   bonus              m +$5,000  M +$10,000      —
 $M Messla    8 tiles · $600
   stock             ×7 $4,200  ×4 $2,400   ×4 $2,400
   bonus              M +$6,000  m +$1,500   m +$1,500
 $Z ZuckFace  5 tiles · $400
   stock                    —          —    ×3 $1,200
   bonus                    —          —   Mm +$6,000
─────────────────────────────────────────────────────
 Cash               $12,000     $8,600      $3,100
═════════════════════════════════════════════════════
 Total              $30,200    $28,500     $15,200
```

### Cell rules

- A player holding nothing in a chain gets an **em-dash** in both its `stock` and `bonus`
  cells — never a blank. An empty cell must read as deliberate.
- A **tie needs no annotation**: two cells showing `m` with equal amounts *is* the split. No
  "(tied)" text.
- `M` and `m` differ only in case, so they carry a weight/size distinction in CSS (bold
  uppercase vs. lighter lowercase) plus a `title` attribute giving the full word — otherwise
  they blur at small sizes.
- Player column headers carry **no rank medals or badges**. `M`/`m` mean *shareholder bonus*;
  a second ranking glyph in the header would read as a contradictory meaning. Columns are
  already sorted by total and the banner names the winner, so rank needs no glyph.
- Money uses the existing `cash()` atom; bonuses use `cash(amount, {sign:'delta'})` so they
  render with a leading `+`.

## The overlay

A scrim covering the whole game area (`.main`), with the scoring card floating over it.

Above the table, a **winner banner**:

- headline — `🐢 Sam wins with $30,200`
- subhead — `Gobble reached 41 tiles — game over`

The overlay is **terminal**: no dismiss control, no close button, no "New game" button. The
game is over and there is nothing else to do from here.

The existing `.reveal-overlay` (pass-and-play) is the precedent for the scrim treatment —
`position:absolute; inset:0` over `.main` — but final scoring gets its own class rather than
reusing it, since it is opaque-carded rather than a centred prompt.

## API — `finalScoring(props)`

Lives in `components.js` alongside `payoutLines` and `stagingZone`; pure, props-in, no
dependency on the live `game` object.

```js
finalScoring({
  reason,     // "Gobble reached 41 tiles" — subhead text
  players,    // [{ id, name, emoji, cash }] in seat order; the renderer sorts
  chains,     // [{ id, size, price }] — chains on the board at game end, in display order
  holdings,   // { [playerId]: { [chainId]: qty } }
  bonuses,    // [{ chainId, playerId, type: 'majority'|'minority'|'both', amount }]
})
```

The renderer **computes**: stock value (`qty × price`), each column's total, and the sort order.
The renderer **does not compute**: which player earns which bonus, or how ties split — those
arrive as authored `bonuses` entries.

Rationale for the split: `qty × price` and summing a column are arithmetic a view can safely
own, and deriving them prevents a fixture's totals from drifting out of sync with its parts.
Bonus resolution is game rules and belongs in the engine when this is eventually wired up.

### Why `components.js` and not a local helper

`components.js` is the declared single source of truth for the presentational layer, and the
React port maps it 1:1. `scenario-win-41.html` already carries a private `standings()` renderer
— a second, divergent game-over screen is exactly the drift this avoids.

## Catalog presentation

A new **full-page-width section** in `states.html`, outside the 340px `figure.state` grid: a
real board and panel rendered behind, dimmed by the actual scrim, with the card floating over
it. This requires one new catalog section kind for full-bleed content (the existing
`figure.state` widths are 340px / 520px / auto and none of them fit).

The section is display-only, consistent with the rest of the catalog.

### Fixture

Three players — Alex 🦊, Sam 🐢, Jordan 🦁 — matching the app's standing fixture. Seat order is
Alex, Sam, Jordan; final totals put Sam first, so the rendered column order differs from seat
order and the sort is visibly exercised.

Cash at game end: Alex `$8,600`, Sam `$12,000`, Jordan `$3,100`.

Three chains, each covering one case:

| Chain | Size · price | Holdings (Alex / Sam / Jordan) | Case |
|---|---|---|---|
| Gobble | 41 · $1,000 | 6 / 3 / 1 | the trigger chain; plain majority + minority |
| Messla | 8 · $600 | 4 / 7 / 4 | **tied minority** — Alex and Jordan split `$3,000` evenly |
| ZuckFace | 5 · $400 | 0 / 0 / 3 | **sole holder** — Jordan takes `Mm`, combined |

Bonuses follow the standard rates — majority `10 × price`, minority `5 × price` — so:

| Chain | Majority | Minority |
|---|---|---|
| Gobble | Alex `+$10,000` | Sam `+$5,000` |
| Messla | Sam `+$6,000` | Alex `+$1,500`, Jordan `+$1,500` (tie splits `$3,000`) |
| ZuckFace | Jordan `+$6,000` combined (`$4,000` + `$2,000`) | — |

Resulting totals: Sam `$30,200`, Alex `$28,500`, Jordan `$15,200`.

Cases deliberately **not** covered this pass: tied majority, and a founded chain with no
shareholders.

Note on the sole-holder rule: `computeBonuses()` in `index.html` pays a sole holder the
majority bonus only — it never awards the unclaimed minority. The `Mm` combined bonus specified
here is the standard rule and the intended behaviour. Since bonuses are authored fixture data
in this pass, nothing conflicts, but the engine will need reconciling when final scoring is
wired up for real.

The board behind the scrim shows these three chains; exact tile shapes are cosmetic, built
by the same chain-fill helper style used elsewhere in the lab.

## Verification

Manual, since the prototype has no test suite:

- `states.html` loads with no console errors; the new section renders.
- Columns appear sorted by total, highest first, and the banner names that same player with
  that same figure.
- The tied-minority chain shows `m` and an equal amount in two cells.
- The sole-holder chain shows `Mm` in one cell and em-dashes elsewhere.
- Every zero cell is an em-dash, not blank.
- Each column's Total equals its stock + bonus + cash by hand.
- `M` and `m` are distinguishable at rendered size; both expose a `title`.
- The scrim covers the board and panel behind it, and nothing behind it is reachable.
- Nothing animates.
- Existing catalog sections render unchanged (regression check on the new section kind).

## Implementation sequencing

1. Add `finalScoring()` to `components.js` (structure + computation, unstyled).
2. Add its styles to `components.css`, including the scrim and the `M`/`m` treatment.
3. Add the full-bleed section kind to `states.html`'s catalog chrome.
4. Author the fixture and wire the section.
5. Verify against the checklist above.
