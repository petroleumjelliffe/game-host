# Merger flow panel restructure — design

Prototype-only change to `prototype/index.html`. Restructures the side-panel
merger flow into four clear visual steps and relocates phase-advance buttons
into the staging zone. No game-logic/rules changes.

## Current state

The `merger` stage (in `activeStepHtml()`) renders survivor-selection (ties) and
the payout in one view: title + lone survivor brand chip + bonus lines +
inline **Continue**. Liquidation and buy each render their primary button inline
in the active step. The staging zone shows only the staged pile.

## Target flow

Four visual steps, persistent title **"Messla & ZuckFace Merger"** across the
two merger sub-steps:

1. **Merger — winner absorbs loser** (`stage==="merger"`, survivor known,
   `merger.showPayout` falsy)
   - Body: `[survivor] absorbs [absorbed…]` as colored brand chips. No bonus
     lines, no repeated single chip.
   - Tie case unchanged: tap a chain to set the survivor first.
   - Primary button ("Continue") **moves to the staging zone**; clicking it sets
     `merger.showPayout = true` and re-renders.

2. **Merger payout** (`stage==="merger"`, `merger.showPayout` truthy)
   - Same persistent title.
   - One line per paid player: **emoji + name · role + amount**, e.g.
     `🐢 Sam · Majority +$4,000`. No brand chip repeated.
   - **Continue button stays inline** (calls `beginAction(); finalizePayout()`),
     undo preserved via the step-stack `↺ undo`.

3. **Liquidate** (`stage==="mergerLiquidation"`)
   - Queue + sell/trade controls + reset link unchanged inline.
   - Primary **Next holder / Confirm** button **moves to the staging zone**.

4. **Buy** (`stage==="buy"`)
   - Buy grid unchanged inline.
   - Primary **Buy & end turn / Skip & end turn** button **moves to the staging
     zone**.

Founding, place-a-tile, and turn-complete steps keep their inline buttons
(scope: only merger / liquidate / buy move to staging).

## Staging zone as action host

`stagingHtml()` gains a footer that emits the current phase's primary button for
the merger-reveal / liquidation / buy phases. The button sits below the staged
pile inside `.staging-zone`. During the payout sub-step no staging button is
shown (its Continue is inline).

## Constant-height staging

`.staging-pile` gets a `min-height` matching a populated small-stack row so the
empty → first-item transition doesn't shift layout; the "empty" placeholder
stays vertically centered.

## State

Add a transient `merger.showPayout` boolean (default falsy when a survivor is
finalized). Reset naturally because `game.merger` is rebuilt per merger in
`startMerger()`. Undo behavior: undoing the "Merger payout" step returns to the
payout entry; undoing the "Merger" step returns to before survivor selection.

## Out of scope

- Merger rules, payout math, liquidation math.
- The `staging-sidebar.html` variation and any React app code.
