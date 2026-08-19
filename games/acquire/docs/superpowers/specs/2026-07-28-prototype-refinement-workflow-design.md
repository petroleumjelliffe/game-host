# Prototype UI-iteration workflow — design

A **reusable process** for iterating on the prototype UI that makes writing the
React components easier. The prototype **code is throwaway** (we reimplement in
React by hand), but the process produces durable, port-ready component definitions.

## The idea

A **fixture-driven states catalog**: each step's component is shown in each of its
states, driven by hand-made prop fixtures (decoupled from playing the game), with
**live, tunable transitions** between states. Because each state = a component +
props, porting to React is mostly mechanical.

## Structure (component-library + app + storybook)

- **`prototype/components.css`** — styles extracted from `index.html`. Both the app
  and the catalog link it → no CSS drift.
- **`prototype/components.js`** — the presentational render functions, **pure /
  props-in** (no reads of the live `game`/`ui` beyond a guarded price fallback).
  The atoms (`brand`, `cash`, `price`, `stockCard`, `stockStack`, `tile`, `player`)
  plus prop-driven step views (`stepEntry`, `payoutLines`, `stagingView`,
  `liqActions`). **This file is what maps 1:1 to React components.**
- **`prototype/states.html`** — the catalog. Links both. Lays out each component in
  its states from fixtures, **grouped for comparison**, with a **transition player**
  that animates state A → B using the real CSS.
- **`prototype/index.html`** — the live game app. Links the shared CSS/JS instead of
  inlining them; keeps the engine + app-level render (`stagingHtml`,
  `activeStepHtml`) that *call* the shared views.

## The loop (this is the deliverable)

1. New / edge state → add a **fixture + label** in `states.html` (one entry).
2. Tune look → edit the component in `components.js` → cascades to catalog *and*
   live app.
3. Tune motion → edit the transition in the player + CSS; watch it live.
4. Review → eyeball `states.html`; point at a **state label**; "these two should
   share more" is a visible, adjacent pair.
5. Port → each `components.js` fn → a React component; fixtures → its prop examples;
   catalog groups → the states that component must support.

## Comparison-first catalog

- Every state has a **stable kebab-case label** (`payout-active`,
  `payout-completed`, `staging-empty`, `staging-leaving`, …) — the review
  vocabulary and the doc/port anchor.
- Related states render **adjacently as a labelled group**, each group with a
  one-line **intent note** setting the consistency bar. Primary pairs:
  - `*-active` vs `*-completed` for a step (read the same except interactivity?)
  - the staging variants together (height stability, Net treatment)
  - sell vs trade liquidation actions (same visual grammar?)

## Transitions

Live and tunable: a control plays A → B with the actual CSS transition/reveal, so
we tune motion + timing directly. This is where we work the **panel height
stability** principle — reveal, don't resize.

## First slice (start narrow)

Only the **merger-flow** states we've been iterating, to prove the loop:
- pick-victor, absorbed-completed step, payout (active / completed),
  liquidation actions + queue, staging (empty / shares / leaving+revert / net).

Extend to the rest of the panel (found, buy, place, players, hand) afterward,
reusing the same structure.

## Doc hygiene (follow-up, not this slice)

Once the catalog is authoritative for appearance: slim `DESIGN_PRINCIPLES.md` to a
decisions log, prune stale bits from `README.md`, and (optionally) let the catalog
labels stand in for a separate component map.

## Out of scope

- The React port itself.
- A live-reload server or screenshot diffing (you eyeball `states.html`).
- New game-rule behavior.
