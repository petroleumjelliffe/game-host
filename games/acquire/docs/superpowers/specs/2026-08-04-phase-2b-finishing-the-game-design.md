# Phase 2b — Finishing the game

**Date:** 2026-08-04
**Status:** Approved design, pre-implementation
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](./2026-07-31-react-app-revamp-roadmap-design.md)
**Predecessor:** [2026-08-04-phase-2a-carry-forward.md](./2026-08-04-phase-2a-carry-forward.md)

## Purpose

Phase 2a made a game playable and deliberately stopped short of ending one: a 2a game simply
continues. 2b closes it. A game that starts can now finish, be scored, and be played again.

One idea, four pieces: trade in dead tiles, let a player who cannot move pass, declare the end, and
show the score. G9 driven through the real screen is the acceptance test.

## What is broken today

Verified against the merged tree, not assumed.

| Finding | Evidence |
|---|---|
| **A player who cannot move is wedged — on screen only.** `endTurn` is already legal from `play` when no placement exists (`engine/intents.ts:270`), but the `play` branch of `useTurnPanel` renders prose and no button at all. The rules offer a way out; the UI does not. | `src/game/screen/useTurnPanel.tsx` `play` branch has no `button` prop |
| **Dead tiles are shown and then ignored.** `getDeadTilesInHand` is wired to `Board`'s `blocked` prop, so a dead tile renders as blocked and unclickable — and there it ends. `tradeInDeadTiles` has never been dispatched by any screen. | `src/game/GameScreen.tsx` `blocked=`; no caller of `tradeInDeadTiles` under `src/` |
| **`declareEnd` exists and no UI reaches it.** The intent, its gate, and `getEndCondition` all ship and are pinned by G9 and G10. Nothing in `src/game/` calls it. | `engine/intents.ts` `doDeclareEnd`; no caller under `src/` |
| **`FinalScoring` is built, tested, and unreachable in a real game.** It renders in the catalog from real engine output and nowhere else. | `src/game/catalog/sections.tsx:545` |
| **`stage: 'end'` renders an empty shell.** `getCurrentActor` returns `null`, so there is no viewer: the board shows no hand, the hand zone is blank, and `useTurnPanel` falls through to `{ active: null }`. A finished game currently looks like a bug. | `engine/actor.ts`; `useTurnPanel`'s trailing `return` |

## The size of this phase, and why

**No engine changes are expected.** That would be a first — every phase so far has needed some. The
reason is that Phase 1a and 1b did this work already:

- `declareEnd`, `getEndCondition`, `tradeInDeadTiles`, `getDeadTilesInHand` and `finalScore` all
  exist, are tested, and are pinned by golden games G9 and G10.
- **`FinalScoring`'s props are `finalScore(state)`'s report, field for field.** The catalog renders
  `<FinalScoring {...finalScore(G9_END)} />` today. Wiring the scoreboard into the game is a spread,
  not a build. This is the Phase 1b deviation that chose the report shape over a `reason: string`
  paying for itself.

If an engine change does turn out to be needed, that is a finding worth writing down rather than a
routine step — it means a rule was missed, not that the plan was short.

## The three interaction gaps

Every decision continues to live in the panel's active zone. No modals, no new panel zones, and the
fixed order `stepstack → active → staging → hand → players` is unchanged.

### 1. Trading dead tiles

Legal only in `play`, only for the current player (`requireStage(state, 'play')`). When the actor
holds dead tiles, the "Place a tile" step names them and offers **one action that trades all of
them**. A dead tile is permanently unplayable — it would join two safe chains — so there is no
reading of the rules under which keeping one helps. A pick-which-ones UI would be ceremony; the
intent already accepts a subset if that judgement ever changes.

The replacement draw is the engine's (`doTradeInDeadTiles` shifts from the bag per tile, and logs
`bag empty` when it cannot). A trade does not end the turn: the player still has to place.

### 2. The player who cannot move

When `play` offers no legal placement, the step says so and offers **End turn**. This is the pass
rule, and the engine already implements it — `doEndTurn` rejects from `play` only when a legal tile
*does* exist, precisely so that a stuck player may leave.

Order matters: trade first, then pass. Trading can hand you a playable tile, so the trade-in action
must be offered alongside the pass, not instead of it.

### 3. Declaring the end

When `getEndCondition(state).met`, the active zone states the reason in words — "Messla has reached
41 tiles", "every founded chain is safe" — and offers **End the game** beside the stage's normal
actions. It appears during `buy`, and during `play` only when no legal placement exists, matching
the intent's own gate. Declining is simply carrying on, which the engine allows on purpose: the gate
exists so that a player cannot skip a placement they could make in order to freeze the board.

No confirmation step. Ending is undoable within the declaring player's own segment, which is the
same protection every other decision gets, and a confirm dialog is the modal this layer removed.

## The end overlay

`FinalScoring` renders over the **whole surface**, board and panel together, by the same mechanism
as the reveal curtain — an absolutely positioned layer inside `GameScreen`.

It has to cover everything rather than sit in the panel, for a reason that is structural rather than
aesthetic: at `stage: 'end'` there is no actor, so the panel's zones have nothing to show and go
blank behind it. The overlay is what the player is looking at, so it should be what is on screen.

Two actions, and `GameScreen` owns neither. It stays a composition file, so both arrive as optional
props and the page decides what they mean:

```ts
interface GameScreenProps {
  session: GameSession;
  onNewGame?: () => void;   // PassAndPlayPage: setConfig(null)
  onExit?: () => void;      // PassAndPlayPage: navigate('/')
}
```

- **New game** — clears the page's config, which drops the session and its snapshot store and
  returns to `LocalSetupScreen`. Deliberately a full reset: replaying the same seed and names is
  what the Advanced seed field is for.
- **Back to menu** — navigates to `/`.

Optional, because the driven tests and any future embedding render `GameScreen` without a page
behind it; an absent handler simply omits its button.

The final board position stays visible behind the overlay, dimmed, because the scoreboard is a claim
about that board and being able to look at both is worth more than a clean backdrop.

## Testing

| Layer | Runner | What it covers |
|---|---|---|
| Session | vitest / node | The end segment: `getCurrentActor` is null, no undo is offered past the declaration, and the view is stable at `end`. |
| Components | vitest / jsdom | The three affordances, each in the state that produces it: dead tiles held, no legal placement, end condition met. Plus the overlay's actions. |
| Driven game | vitest / jsdom | **G9 through the real screen** to its declared totals — $27,800 / $21,600 / $4,300 — and G10 for the all-safe reason. |
| Layout | `npm run verify:layout` | The overlay covers the surface, as the curtain check already does for the reveal. |
| By hand | a human | Play a game to its end and report what you saw. |

**G9 is the acceptance test.** Its engine side is already pinned, including `finalScoreTotals` and
`finalScoreBonuses` at the exact end state, so driving it through the screen tests the wiring and
nothing else. If the screen shows a different number from the golden game, the screen is lying —
that is the whole point of deriving from the engine, and the defect Phase 0 shipped by copying a
figure.

The by-hand pass is not optional. Across 1b, 2a and the follow-ups it has found something every
single time, including defects that four green gates and 363 tests did not.

## Scope

**In:** the dead-tile trade-in action, the stuck-player pass, the declare-end affordance, the final
scoring overlay and its two actions, the driven G9 and G10 passes, and the layout check for the
overlay.

**Out, and going to its own pass:** the draw screen that shows each player's drawn tile and who won.
It is opening-side presentation with no engine work behind it, so it neither blocks nor is blocked
by anything here.

**Out, and going to Phase 3/5:** deleting `Game.tsx` and the six modals, the online lobby, anything
on the wire, and the `SocketProvider` console noise on offline routes (recorded in the 2a
carry-forward).

**Untouched:** `engine/` if the expectation above holds, `src/components/`, `server/`, `prototype/`.

## Verification

Phase 2b is done when:

- A game played to a 41-tile chain can be declared over, and the scoreboard's totals match
  `finalScore(state)`.
- A game where every founded chain is safe can also be declared over.
- A player holding dead tiles can trade them and continue the same turn.
- A player with no legal placement can end their turn without trading.
- "New game" returns to setup and starts a genuinely new game; "Back to menu" leaves.
- G9 and G10 driven through the real screen reach their golden terminal states.
- `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle` and
  `npm run verify:layout` are green.

## Risks

**The end condition can be met and then unmet.** A chain reaching 41 tiles is permanent, but "every
founded chain is safe" is not — a merger can unmake it. The affordance is therefore derived from
`getEndCondition(state)` on every render rather than latched when it first becomes true, and the
tests should include a state where it stops holding.

**Undo across the declaration.** Declaring ends the game inside the declaring player's segment, so
undo can reach back past it. That is consistent with every other decision, but it is the one undo
that un-ends a game, and it deserves an explicit test rather than an assumption.

**The overlay hides a panel that may be mid-thought.** Local staging state — a half-built share
basket — is component state and vanishes when the overlay's "New game" drops the session. That is
correct, and worth stating so nobody treats it as a bug later.
