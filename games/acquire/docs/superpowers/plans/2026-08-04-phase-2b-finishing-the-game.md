# Phase 2b — Finishing the Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A game that starts can now finish — dead tiles traded, stuck players passed, the end declared, and the score shown.

**Architecture:** No new rules. Every intent this phase needs (`tradeInDeadTiles`, `endTurn` from `play`, `declareEnd`) already ships and is pinned by golden games; `FinalScoring`'s props are `finalScore(state)`'s report field-for-field. The work is three affordances inside `useTurnPanel`'s existing stage switch, one overlay in `GameScreen`, and two callbacks on the page.

**Tech Stack:** TypeScript, React 18, Tailwind 3, react-router 7, vitest 4 (node project for `engine/**`, jsdom project for `src/**`), @testing-library/react with `fireEvent`, Chrome DevTools Protocol over `ws` for layout verification.

**Spec:** [2026-08-04-phase-2b-finishing-the-game-design.md](../specs/2026-08-04-phase-2b-finishing-the-game-design.md)

## Global Constraints

- **Do not modify** `src/components/`, `src/Game.tsx`, `server/`, or `prototype/`. `src/pages/PassAndPlayPage.tsx` and `src/App.tsx` **may** be modified.
- **One engine change is expected and only one:** exporting the existing `hasLegalTile` predicate (Task 1). It adds no rules. Any *other* engine change is a finding — stop and report it rather than absorbing it.
- **Never import `engine/golden/runner`** from anything under `src/` — it pulls vitest into the bundle. `engine/golden/index.ts`, `replay.ts` and `fixtures.ts` are safe.
- **Zero `as any`.** Narrow with `isStartupId` from `engine/startups.ts`.
- **Never run bare `tsc`.** Use `npm run typecheck`.
- `@testing-library/user-event` is **not** a dependency. Use `fireEvent`.
- Driving a session directly in a jsdom test must happen inside `act()` — a bare `dispatch` leaves React showing the previous render. `drivenGolden.test.tsx` has the `apply()` helper for this.
- Tailwind JIT requires **literal class strings**. An interpolated class name emits no CSS and fails silently.
- Style brand colour through `src/game/tokens.ts`. Never hardcode a hex or per-brand class elsewhere.
- Every new interactive element in `src/game/` needs an explicit `m-0`; `src/styles/index.css` still sets a global `button { margin: 1px }`.
- **Panel-height rule (as revised):** a zone's reservation is a floor, not a fixed height. Zones must not change height without gaining a row, and must never clip their content. Mark a zone `data-may-grow="true"` if it may legitimately grow.
- Respect `prefers-reduced-motion` — enter animations skip, they do not shorten.
- Viewports **≥768px only**.
- **Gates — all five must pass before every commit that touches `src/`:**
  ```bash
  npx vitest run
  npm run typecheck && echo "TYPECHECK_OK"
  npx vite build
  npm run check:bundle
  npm run verify:layout
  ```
  Chain gates with `&&`, never `;` — a `;` runs the commit even when typecheck failed. This happened in 2a.

---

## File Structure

| File | Responsibility |
|---|---|
| `engine/intents.ts` | Exports the existing `hasLegalTile` (Task 1). No rules change. |
| `src/game/screen/useTurnPanel.tsx` | Gains: pass-when-stuck (T1), trade-in (T2), declare-end (T3). All inside the existing stage switch. |
| `src/game/FinalScoring.tsx` | Exports its existing `reasonText` so one sentence describes the end everywhere (T3). |
| `src/game/GameScreen.tsx` | Renders the end overlay; gains `onNewGame` / `onExit` props (T4). |
| `src/pages/PassAndPlayPage.tsx` | Supplies those two callbacks (T5). |
| `src/game/screen/drivenGolden.test.tsx` | Gains the G9 and G10 driven passes (T6). |
| `scripts/verify-layout.mjs` | Overlay coverage, if reachable — see T7's finding. |
| `docs/superpowers/specs/2026-08-04-phase-2b-carry-forward.md` *(new)* | Hand-off (T9). |

---

## Task 1: A player who cannot move can pass

**Files:**
- Modify: `engine/intents.ts` (one word: `function` → `export function`)
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/screen/useTurnPanel.test.tsx`

**Interfaces:**
- Consumes: `SessionView`, `ActiveStep`.
- Produces: `hasLegalTile(state: GameState, playerId: string): boolean` exported from `engine/intents.ts` (and so from `engine/index.ts`, which re-exports it).

**Background.** This is a live bug on `main`, not new work. `doEndTurn` already permits `endTurn` from `play` — it rejects *only* when a legal tile exists (`engine/intents.ts`, `doEndTurn`), which is the pass rule. But `useTurnPanel`'s `play` branch renders prose and no button, so a player holding six unplayable tiles has nothing to click.

**Why export the engine's predicate instead of recomputing it.** The obvious alternative is to ask in the hook: `player.hand.some((c) => previewPlacement(state, c, id).legal)`. That duplicates the engine's own gate in the UI, and if the two ever disagree the button appears and the intent rejects — or worse, the button hides and the player is wedged again. `hasLegalTile` already exists and is exactly the predicate `doEndTurn` gates on. Exporting it makes the button and the rule the same question.

- [x] **Step 1: Write the failing test**

Append to `src/game/screen/useTurnPanel.test.tsx`:

```tsx
describe('useTurnPanel — a player who cannot move', () => {
  /**
   * Two safe chains with a one-cell gap between them. The only tile in hand
   * joins them, which is permanently illegal, so this player cannot place —
   * and the rules let them pass.
   */
  function stuck() {
    return buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
    });
  }

  it('offers to end the turn when no placement is legal', () => {
    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: stuck() })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });

  it('says why the turn can be ended', () => {
    render(<Harness session={createGameSession({ state: stuck() })} dispatch={() => {}} />);
    expect(screen.getByText(/no tile you hold can be played/i)).toBeInTheDocument();
  });

  it('offers no such button while a placement is still legal', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx -t "cannot move"
```

Expected: FAIL — no button matching `/end turn/i` at the `play` stage.

If instead the *fixture* fails to build (`Messla`/`ZuckFace` at 11 tiles are safe; `C1` touches `B1` and `D1`), print `previewPlacement(state, 'C1', 'p1')` and confirm `legal: false` before changing the test — a fixture that is not actually stuck proves nothing.

- [x] **Step 3: Export the engine predicate**

In `engine/intents.ts`, change the declaration of `hasLegalTile` from:

```ts
function hasLegalTile(state: GameState, playerId: string): boolean {
```

to:

```ts
/**
 * Whether this player can legally place anything they hold.
 *
 * Exported because the UI must gate the pass affordance on exactly the
 * predicate `doEndTurn` gates on. Recomputing it in the screen would let the
 * two drift, and a disagreement shows up as a button that rejects when
 * pressed, or no button at all for a player who genuinely cannot move.
 */
export function hasLegalTile(state: GameState, playerId: string): boolean {
```

Nothing else changes: `engine/index.ts` already does `export * from './intents'`.

- [x] **Step 4: Offer the pass in the play branch**

In `src/game/screen/useTurnPanel.tsx`, add to the imports:

```tsx
import { hasLegalTile } from '../../../engine/intents';
```

Replace the whole `if (state.stage === 'play') { ... }` branch with:

```tsx
  if (state.stage === 'play') {
    const canPlace = actorId ? hasLegalTile(state, actorId) : false;

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Place a tile"
          body={
            <>
              <span className="text-[13px] text-gray-600">
                {canPlace
                  ? 'Choose one of your tiles on the board.'
                  : 'No tile you hold can be played. You may end your turn.'}
              </span>
              {problem}
            </>
          }
          button={
            canPlace || !actorId ? undefined : (
              <button
                type="button"
                onClick={() => dispatch({ type: 'endTurn', playerId: actorId })}
                className="m-0 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                End turn
              </button>
            )
          }
        />
      ),
    };
  }
```

- [x] **Step 5: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS, including the three new cases.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add engine/intents.ts src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx
git commit -m "fix(screen): a player who cannot place can end their turn"
```

---

## Task 2: Trading in dead tiles

**Files:**
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/screen/useTurnPanel.test.tsx`

**Interfaces:**
- Consumes: `getDeadTilesInHand(state, playerId): Coord[]` from `engine/placement.ts`; `hasLegalTile` (Task 1).
- Produces: nothing new.

**Background.** A dead tile is one whose placement would join two safe chains — permanently unplayable. `getDeadTilesInHand` is already wired to `Board`'s `blocked` prop, so they *render* as blocked; nothing has ever dispatched `tradeInDeadTiles`.

The intent is legal only in `play`, only for the current player, and it draws a replacement per tile straight from the bag. **Trading does not end the turn** — the player still has to place, and a fresh tile may well be playable. So the trade-in sits alongside the pass from Task 1, never instead of it: a stuck player might become unstuck by trading.

All dead tiles go at once. There is no reading of the rules where keeping a permanently unplayable tile helps, so a pick-which-ones UI would be ceremony. `tradeInDeadTiles` accepts a subset if that judgement ever changes.

- [x] **Step 1: Write the failing test**

Append to `src/game/screen/useTurnPanel.test.tsx`:

```tsx
describe('useTurnPanel — dead tiles', () => {
  /**
   * Two safe chains with a gap at C1. `C1` in hand is dead; `H8` is fine.
   * The player is therefore not stuck — which is the point: the trade-in has
   * to be on offer independently of the pass.
   */
  function holdingDeadTile() {
    return buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1', 'H8'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
      bag: ['I11', 'I12'],
    });
  }

  it('offers to trade every dead tile at once', () => {
    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: holdingDeadTile() })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /trade in 1 dead tile/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'tradeInDeadTiles',
      playerId: 'p1',
      coords: ['C1'],
    });
  });

  it('names the dead tiles so the player can see which they are', () => {
    render(<Harness session={createGameSession({ state: holdingDeadTile() })} dispatch={() => {}} />);
    expect(screen.getByText(/C1/)).toBeInTheDocument();
  });

  it('offers nothing when no tile in hand is dead', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /trade in/i })).toBeNull();
  });

  it('offers the trade alongside the pass, not instead of it', () => {
    // Every tile dead: the player is stuck *and* holds dead tiles, so both
    // affordances must be present — trading may hand them a playable tile.
    const state = buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
      bag: ['I11'],
    });
    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);

    expect(screen.getByRole('button', { name: /trade in 1 dead tile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end turn/i })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx -t "dead tiles"
```

Expected: FAIL — no button matching `/trade in/i`.

- [x] **Step 3: Implement**

In `src/game/screen/useTurnPanel.tsx`, add to the imports:

```tsx
import { getDeadTilesInHand } from '../../../engine/placement';
```

In the `play` branch from Task 1, compute the dead tiles and render both actions. Replace the branch body with:

```tsx
  if (state.stage === 'play') {
    const canPlace = actorId ? hasLegalTile(state, actorId) : false;
    const dead = actorId ? getDeadTilesInHand(state, actorId) : [];

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Place a tile"
          body={
            <>
              <span className="text-[13px] text-gray-600">
                {canPlace
                  ? 'Choose one of your tiles on the board.'
                  : 'No tile you hold can be played. You may end your turn.'}
              </span>
              {dead.length > 0 && (
                <span className="text-[13px] text-gray-600">
                  {`${dead.join(', ')} can never be played — ${dead.length === 1 ? 'it joins' : 'they join'} two safe chains.`}
                </span>
              )}
              {problem}
            </>
          }
          button={
            !actorId ? undefined : (
              <div className="flex w-full flex-col gap-2">
                {dead.length > 0 && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'tradeInDeadTiles', playerId: actorId, coords: dead })}
                    className="m-0 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {`Trade in ${dead.length} dead tile${dead.length === 1 ? '' : 's'}`}
                  </button>
                )}
                {!canPlace && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'endTurn', playerId: actorId })}
                    className="m-0 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    End turn
                  </button>
                )}
              </div>
            )
          }
        />
      ),
    };
  }
```

Note the `button` prop is now a `<div>` holding zero, one or two buttons. When both are absent it still renders an empty flex column — that is deliberate: `ActiveStep`'s slot keeps its height either way, and the panel does not move as the actions come and go.

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS — Task 1's three cases and these four.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx
git commit -m "feat(screen): trade in dead tiles from the placement step"
```

---

## Task 3: Declaring the end

**Files:**
- Modify: `src/game/FinalScoring.tsx` (export one existing function)
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/screen/useTurnPanel.test.tsx`
- Modify: `src/game/session/GameSession.test.ts`

**Interfaces:**
- Consumes: `getEndCondition(state): EndCondition` from `engine/endGame.ts`, where `EndCondition` is `{ met: boolean; reasons: EndReason[] }`.
- Produces: `reasonText(reason: EndReason | null): string` exported from `src/game/FinalScoring.tsx`.

**Background.** `declareEnd` is gated: from `buy` it needs only a met condition; from `play` it additionally needs *no* legal placement, so that nobody skips a placement they could make in order to freeze the board. The affordance mirrors that gate exactly.

**The condition is not permanent.** A chain reaching 41 tiles cannot be undone, but "every founded chain is safe" can be unmade by a merger. So the affordance is derived from `getEndCondition(state)` on every render — never latched when it first becomes true. G11 is the golden game where the end is met and declined, and play continues.

`FinalScoring` already contains the sentence that describes an end reason (`reasonText`). Export it rather than writing a second one, so the panel and the scoreboard cannot describe the same ending differently.

- [x] **Step 1: Write the failing test**

Append to `src/game/screen/useTurnPanel.test.tsx`:

```tsx
describe('useTurnPanel — declaring the end', () => {
  it('offers the end during buy when a chain has reached 41 tiles', () => {
    const g9 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G9')!;
    const states = replayGoldenGame(g9);
    const atBuy = states.find((s) => s.stage === 'buy');
    if (!atBuy) throw new Error('G9 no longer passes through buy');

    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: atBuy })} dispatch={dispatch} />);

    expect(screen.getByText(/reached 41 tiles/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /end the game/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'declareEnd', playerId: 'p1' });
  });

  it('offers the end when every founded chain is safe', () => {
    const g10 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G10')!;
    const state = replayGoldenGame(g10)[0];

    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);
    expect(screen.getByText(/every founded startup is safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end the game/i })).toBeInTheDocument();
  });

  it('offers nothing while no end condition holds', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });

    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /end the game/i })).toBeNull();
  });
});
```

`ALL_GOLDEN_GAMES` and `replayGoldenGame` are already imported at the top of this file.

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx -t "declaring the end"
```

Expected: FAIL — no button matching `/end the game/i`.

- [x] **Step 3: Export the reason sentence**

In `src/game/FinalScoring.tsx`, change:

```tsx
function reasonText(reason: FinalScoreReport['reason']): string {
```

to:

```tsx
/**
 * One sentence describing why a game ended.
 *
 * Exported so the panel's declare-end prompt and the final scoreboard cannot
 * describe the same ending in two different ways.
 */
export function reasonText(reason: FinalScoreReport['reason']): string {
```

- [x] **Step 4: Offer the declaration**

In `src/game/screen/useTurnPanel.tsx`, add to the imports:

```tsx
import { getEndCondition } from '../../../engine/endGame';
import { reasonText } from '../FinalScoring';
```

Directly above the `if (state.stage === 'draw')` branch, add a shared fragment both stages use:

```tsx
  // Derived every render, never latched: 'every founded chain is safe' stops
  // being true the moment a merger makes one unsafe again, and an affordance
  // remembered from an earlier render would offer an end the engine refuses.
  const endCondition = getEndCondition(state);
  const declareEnd = endCondition.met && actorId ? (
    <div className="mt-2 flex flex-col gap-1 rounded-md bg-amber-50 px-2 py-1.5">
      <span className="text-[13px] font-semibold text-amber-900">
        {`${reasonText(endCondition.reasons[0] ?? null)}. You may end the game now.`}
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: 'declareEnd', playerId: actorId })}
        className="m-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
      >
        End the game
      </button>
    </div>
  ) : null;
```

Then render `{declareEnd}` in exactly two places, matching the intent's own gate:

1. In the **`buy`** branch's `body`, immediately after the `<div className="flex flex-wrap gap-2">…</div>` of buy buttons and before `{problem}`.
2. In the **`play`** branch's `body`, immediately before `{problem}` — where it will only be reachable when the player also cannot place, because that is the engine's gate. Guard it so the two agree:

```tsx
              {!canPlace && declareEnd}
```

- [x] **Step 5: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS.

- [x] **Step 6: Test that undo can un-end a game**

Ending is a decision inside the declaring player's own segment, so undo reaches it. That is consistent with every other decision, and it is the one undo that resurrects a finished game — so it gets an explicit test rather than an assumption.

Append to `src/game/session/GameSession.test.ts`:

```ts
describe('ending the game', () => {
  function atDeclarableBuy() {
    const g9 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G9')!;
    const state = replayGoldenGame(g9).find((s) => s.stage === 'buy');
    if (!state) throw new Error('G9 no longer passes through buy');
    return state;
  }

  it('has no actor once the game is over', () => {
    const session = createGameSession({ state: atDeclarableBuy() });
    session.dispatch({ type: 'declareEnd', playerId: 'p1' });

    expect(session.getView().state.stage).toBe('end');
    expect(session.getView().actorId).toBeNull();
  });

  it('lets the declaring player take it back within their own segment', () => {
    const session = createGameSession({ state: atDeclarableBuy() });
    const stepId = session.getView().state.nextStepId;

    session.dispatch({ type: 'declareEnd', playerId: 'p1' });
    expect(session.getView().state.stage).toBe('end');

    session.undoTo(stepId);
    expect(session.getView().state.stage).toBe('buy');
    expect(session.getView().actorId).toBe('p1');
  });
});
```

Run it:

```bash
npx vitest run src/game/session/GameSession.test.ts -t "ending the game"
```

Expected: PASS. **If the second case fails**, the declaration closed a segment and pruned its own snapshot — report that rather than working around it, because it means `getCurrentActor` going `null` is being treated as an actor change and the undo range is being reset by the very step it should still cover.

- [x] **Step 7: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/FinalScoring.tsx src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx src/game/session/GameSession.test.ts
git commit -m "feat(screen): declare the end where the engine allows it"
```

---

## Task 4: The final scoring overlay

**Files:**
- Modify: `src/game/GameScreen.tsx`
- Modify: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `finalScore(state): FinalScoreReport` from `engine/endGame.ts`; `FinalScoring`, whose props are `FinalScoreReport` exactly (`export type FinalScoringProps = FinalScoreReport`).
- Produces:
  ```ts
  interface GameScreenProps {
    session: GameSession;
    onNewGame?: () => void;
    onExit?: () => void;
  }
  ```

**Background.** At `stage: 'end'` `getCurrentActor` returns `null`, so there is no viewer: the board shows no hand, the hand zone is blank and `useTurnPanel` falls through to `{ active: null }`. A finished game currently renders as an empty shell. The overlay is what the player should be looking at, so it covers the whole surface — the same absolutely-positioned mechanism as the reveal curtain, and for the same reason.

`FinalScoring` is deliberately terminal: it has no dismiss and no "New game", and its own doc comment says the route back belongs to Phase 2. So the actions live in the overlay wrapper here, not inside the component.

Both callbacks are optional. The driven tests render `GameScreen` with no page behind it, and an absent handler simply omits its button.

- [x] **Step 1: Write the failing test**

Append to `src/game/GameScreen.test.tsx`:

```tsx
describe('GameScreen at the end of a game', () => {
  function ended() {
    const g9 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G9')!;
    const state = replayGoldenGame(g9).at(-1)!;
    if (state.stage !== 'end') throw new Error('G9 no longer ends');
    return createGameSession({ state });
  }

  it('covers the whole surface with the scoreboard', () => {
    render(<GameScreen session={ended()} />);
    const overlay = screen.getByTestId('final-overlay');
    expect(overlay.className).toMatch(/inset-0/);
  });

  it('shows the totals the engine reports', () => {
    render(<GameScreen session={ended()} />);
    // G9's declared totals, derived — not written down anywhere in src/.
    expect(screen.getByText('$27,800')).toBeInTheDocument();
    expect(screen.getByText('$21,600')).toBeInTheDocument();
    expect(screen.getByText('$4,300')).toBeInTheDocument();
  });

  it('says why the game ended', () => {
    render(<GameScreen session={ended()} />);
    expect(screen.getByText(/reached 41 tiles/i)).toBeInTheDocument();
  });

  it('offers a new game and a way out when the page supplies them', () => {
    const onNewGame = vi.fn();
    const onExit = vi.fn();
    render(<GameScreen session={ended()} onNewGame={onNewGame} onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    expect(onNewGame).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it('omits the buttons the page did not supply', () => {
    render(<GameScreen session={ended()} />);
    expect(screen.queryByRole('button', { name: /new game/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /back to menu/i })).toBeNull();
  });

  it('shows no overlay while the game is still running', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    expect(screen.queryByTestId('final-overlay')).toBeNull();
  });
});
```

Add these imports to the top of `src/game/GameScreen.test.tsx`:

```tsx
import { vi } from 'vitest';
import { ALL_GOLDEN_GAMES } from '../../engine/golden';
import { replayGoldenGame } from '../../engine/golden/replay';
```

`vi` may already be imported; merge rather than duplicate the import.

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/GameScreen.test.tsx -t "end of a game"
```

Expected: FAIL — no element with test id `final-overlay`.

- [x] **Step 3: Implement**

In `src/game/GameScreen.tsx`, add to the imports:

```tsx
import { FinalScoring } from './FinalScoring';
import { finalScore } from '../../engine/endGame';
```

Extend the props interface:

```tsx
export interface GameScreenProps {
  session: GameSession;
  /** Start over from setup. Omitted when nothing is hosting the screen. */
  onNewGame?: () => void;
  /** Leave the game entirely. Omitted when nothing is hosting the screen. */
  onExit?: () => void;
}
```

and the signature:

```tsx
export function GameScreen({ session, onNewGame, onExit }: GameScreenProps) {
```

Then add this immediately after the existing curtain block, as the last child of the surface `div`:

```tsx
      {state.stage === 'end' && (
        <div
          data-testid="final-overlay"
          className="absolute inset-0 z-30 overflow-y-auto bg-white/95 p-6"
        >
          {/*
            The scoreboard is `finalScore(state)` spread straight in — its
            props *are* the engine's report, which is why there is no adapter
            here and no figure written down in `src/`. The actions live out
            here rather than inside it: `FinalScoring` is deliberately
            terminal and knows nothing about routes.
          */}
          <FinalScoring {...finalScore(state)} />

          {(onNewGame || onExit) && (
            <div className="mt-6 flex justify-center gap-3">
              {onNewGame && (
                <button
                  type="button"
                  onClick={onNewGame}
                  className="m-0 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                >
                  New game
                </button>
              )}
              {onExit && (
                <button
                  type="button"
                  onClick={onExit}
                  className="m-0 rounded-lg border border-gray-300 px-4 py-2 font-semibold hover:bg-gray-50"
                >
                  Back to menu
                </button>
              )}
            </div>
          )}
        </div>
      )}
```

`z-30` sits above the curtain's `z-20`: at `end` there is no actor, so no curtain should be up, but if both ever were the result should be the scoreboard rather than a handoff to nobody.

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/GameScreen.test.tsx
```

Expected: PASS — all six new cases plus the existing ones.

If the totals assertion fails, **do not adjust the expected figures.** They are G9's declared totals, already asserted against the engine by `golden.test.ts`. A mismatch means the overlay is rendering something other than `finalScore(state)`.

- [x] **Step 5: Check the file is still composition**

```bash
wc -l src/game/GameScreen.tsx
```

The phase-2a rule was that beats move into `src/game/screen/` if this file passes roughly 200 lines. Expect ~145. If it is over 200, extract the overlay into `src/game/screen/EndOverlay.tsx` taking `{ state, onNewGame, onExit }` and render that instead.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(screen): final scoring overlay on real finalScore output"
```

---

## Task 5: The page supplies the way out

**Files:**
- Modify: `src/pages/PassAndPlayPage.tsx`
- Modify: `src/pages/PassAndPlayPage.test.tsx`

**Interfaces:**
- Consumes: `GameScreenProps.onNewGame`, `GameScreenProps.onExit` (Task 4).
- Produces: nothing new.

**Background.** The page already holds `config` in `useState` and derives the session from it with `useMemo`. Clearing the config drops the session **and its snapshot store**, which is the intended full reset — replaying the same seed and names is what the Advanced seed field is for.

- [x] **Step 1: Note why this task has no new unit test**

There is no honest jsdom test for this seam, and writing a dishonest one is worse than writing none.

The page builds its own session from a freshly generated seed and exposes no way to inject one, so a test cannot get it to `stage: 'end'` without playing an entire game through the UI. Any test that stops short — asserting the game surface renders, or that the overlay is *absent* — passes just as happily with the props not wired at all. The two candidates that were considered and rejected:

- `expect(screen.queryByTestId('final-overlay')).toBeNull()` — true before this task and after it.
- Adding a test-only prop to inject a session — production surface that exists only to be tested.

What actually covers this task:

- **`npm run typecheck`** — `onNewGame` and `onExit` are typed on `GameScreenProps`, so a misspelled or omitted prop is a compile error, and a wrong signature will not build.
- **`GameScreen.test.tsx`** (Task 4) — proves the buttons appear when handlers are supplied, call them, and are omitted when they are not.
- **Task 8, by hand** — "New game" genuinely starting a new game is check 9 on the list.

The three existing tests in `PassAndPlayPage.test.tsx` must keep passing; do not modify them.

- [x] **Step 2: Implement**

In `src/pages/PassAndPlayPage.tsx`, replace the `if (session) return <GameScreen session={session} />;` line with:

```tsx
  if (session) {
    return (
      <GameScreen
        session={session}
        // Dropping the config drops the session and its snapshot store with
        // it — a genuine fresh game rather than a rewound one. Replaying a
        // seed is what the setup screen's Advanced field is for.
        onNewGame={() => setConfig(null)}
        onExit={() => navigate('/')}
      />
    );
  }
```

- [x] **Step 3: Run the tests**

```bash
npx vitest run src/pages/PassAndPlayPage.test.tsx
```

Expected: PASS.

- [x] **Step 4: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/pages/PassAndPlayPage.tsx src/pages/PassAndPlayPage.test.tsx
git commit -m "feat(app): a finished game can be restarted or left"
```

---

## Task 6: Drive G9 and G10 through the real screen

**Files:**
- Modify: `src/game/screen/drivenGolden.test.tsx`

**Interfaces:**
- Consumes: `GameScreen`, `createGameSession`, `ALL_GOLDEN_GAMES`, `replayGoldenGame`, `buildFixture`, and the file's existing `apply()` helper.
- Produces: nothing; this is the phase's acceptance test.

**Background.** This is what the phase is judged on. G9 (end by 41 tiles) and G10 (end because every founded chain is safe) both already declare their end in the engine, and G9 pins `finalScoreTotals` at the exact end state. Driving them through the screen tests the *wiring* and nothing else — the rules are already proven by `golden.test.ts`.

**Dispatch inside `act()`.** The file's `apply()` helper exists because a bare `dispatch` on an external store leaves React showing the previous render, and a test that then queries the DOM reads stale markup. This cost real time in 2a.

- [x] **Step 1: Write the test**

Append to `src/game/screen/drivenGolden.test.tsx`:

```tsx
describe('driven golden games — the end', () => {
  it('G9: a declared 41-tile end scores through the real screen', () => {
    const game = golden('G9');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }

    const expected = replayGoldenGame(game).at(-1)!;
    expect(session.getView().state.stage).toBe('end');
    expect(session.getView().state.stage).toBe(expected.stage);

    // The overlay is showing, and the figures on it are the engine's.
    expect(screen.getByTestId('final-overlay')).toBeInTheDocument();
    expect(screen.getByText('$27,800')).toBeInTheDocument();
    expect(screen.getByText('$21,600')).toBeInTheDocument();
    expect(screen.getByText('$4,300')).toBeInTheDocument();
  });

  it('G10: an all-safe end scores through the real screen', () => {
    const game = golden('G10');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }

    expect(session.getView().state.stage).toBe('end');
    expect(screen.getByTestId('final-overlay')).toBeInTheDocument();
    expect(screen.getByText(/every founded startup is safe/i)).toBeInTheDocument();
  });

  it('G11: an end that is declined leaves the game running', () => {
    const game = golden('G11');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }

    expect(session.getView().state.stage).not.toBe('end');
    expect(screen.queryByTestId('final-overlay')).toBeNull();
  });
});
```

- [x] **Step 2: Run it**

```bash
npx vitest run src/game/screen/drivenGolden.test.tsx
```

Expected: PASS.

The G9 figures are **not** to be edited if they fail — `golden.test.ts` already asserts them against the engine, so a mismatch here means the screen is showing something other than `finalScore(state)`. That is the exact defect class Phase 0 shipped by copying a number, and the reason this test exists.

- [x] **Step 3: Run the gates and commit**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
git add src/game/screen/drivenGolden.test.tsx
git commit -m "test(screen): drive G9, G10 and G11 to their ends through the real screen"
```

---

## Task 7: What `verify:layout` can and cannot check here

**Files:**
- Modify: `scripts/verify-layout.mjs`

**Interfaces:**
- Consumes: the running app at `/pass-and-play`.
- Produces: no new npm script.

**Background, and a correction to the spec.** The design says `verify:layout` gains the overlay's coverage check "as the curtain check already does for the reveal". **It cannot, and the plan should say so rather than pretend.** The gate reaches its states by *playing* the real app, and reaching `stage: 'end'` needs a chain of 41 tiles or every founded chain safe — an observed ~500-interaction walk, several minutes per viewport. The gate currently runs in about 40 seconds and runs before every commit; making it minutes to cover one overlay is a bad trade.

What is checked instead:

- **Structurally, in jsdom** (Task 4): the overlay exists at `end`, and carries `inset-0`.
- **Dimensionally, by inheritance:** the overlay uses the identical mechanism as the reveal curtain — `absolute inset-0` inside the same surface — and the curtain's real-page coverage is already measured by this gate at both viewports.
- **By eye** (Task 8): a human ends a game and looks at it.

This is a real gap, not a covered one, and it is recorded as such in the carry-forward.

- [x] **Step 1: Make the gate notice an end state if it ever reaches one**

Free insurance: if a future walk does reach `end`, measure the overlay rather than silently ignoring it. In `scripts/verify-layout.mjs`, inside the `MEASURE` block's returned object, add alongside `clipped`:

```js
    // If the walk ever does reach a finished game, hold the overlay to the
    // same coverage rule as the curtain. Normally absent — reaching an end
    // state by playing takes far longer than this gate should run.
    finalOverlay: (() => {
      const o = document.querySelector('[data-testid="final-overlay"]');
      if (!o || !surface) return null;
      const s = surface.getBoundingClientRect();
      const r = o.getBoundingClientRect();
      return { covers: Math.round(r.width) === Math.round(s.width) && Math.round(r.height) === Math.round(s.height) };
    })(),
```

- [x] **Step 2: Fail if it is present and does not cover**

In `main()`, after the `clipped` loop, add:

```js
    if (m.finalOverlay && !m.finalOverlay.covers) {
      failures.push(`${width}px: the final scoring overlay does not cover the surface`);
    }
```

- [x] **Step 3: Confirm the gate still passes and still takes about as long**

```bash
time npm run verify:layout
```

Expected: `verify:layout OK`, in roughly the time it took before. If it has grown by minutes, something in this task started playing to the end — revert it; that is the trade this task exists to refuse.

- [x] **Step 4: Commit**

```bash
git add scripts/verify-layout.mjs
git commit -m "test(layout): hold the end overlay to the curtain's coverage rule if reached"
```

---

## Task 8: Play it by hand

**Files:** none — this task produces a written report, not code.

**Background.** In 1b it produced two defects against 101 green tests. In 2a it produced three, including a players strip that silently hid half the table, against 341 green tests and four green gates. Budget for it.

- [x] **Step 1: Start the app**

```bash
npm run dev
```

Open `http://localhost:5173/pass-and-play`.

- [x] **Step 2: Reach an end and look at it**

The fastest reliable route to an end condition is a two-player game where you deliberately grow one chain: found early, then keep extending the same chain until it passes 41 tiles. Write down anything that looks wrong:

1. When you hold a dead tile, does the panel say *which* tile and why?
2. Does trading leave you able to place, in the same turn?
3. Engineer a stuck turn if you can (two safe chains with a single gap). Does the pass appear? Does the panel explain itself?
4. When the end becomes available, is the offer noticeable without being a nag?
5. Decline it and keep playing. Does the offer stay available, and stay correct?
6. Declare it. Does the scoreboard's winner match the cash you saw in the players strip?
7. Undo the declaration. Does the game come back intact?
8. Does the overlay scroll if a 7-chain × 6-player table does not fit at 768px?
9. "New game" — does it genuinely start a new game rather than the same one?

- [x] **Step 3: Check reduced motion and both widths**

DevTools → Rendering → *Emulate prefers-reduced-motion: reduce*. The overlay must appear instantly. Then check the overlay at 768 and 1440.

- [x] **Step 4: Write the findings down**

Create `docs/superpowers/specs/2026-08-04-phase-2b-by-hand-notes.md`, including "nothing wrong here" for the checks that passed, so the next phase knows what was actually looked at.

- [x] **Step 5: Fix anything that is a defect, not a preference**

Failing test first wherever a test can express it; a note in the findings file where one cannot.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-phase-2b-by-hand-notes.md
git commit -m "docs: Phase 2b by-hand play notes"
```

---

## Task 9: Carry-forward

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-phase-2b-carry-forward.md`
- Modify: `docs/superpowers/plans/2026-08-04-phase-2b-finishing-the-game.md` (this file — check every box)

- [x] **Step 1: Confirm the whole suite is green**

```bash
npx vitest run && npm run typecheck && npx vite build && npm run check:bundle && npm run verify:layout
```

Record the test and file counts from the vitest output.

- [x] **Step 2: Write the carry-forward**

Follow the shape of `2026-08-04-phase-2a-carry-forward.md`. Cover, with evidence rather than assertion:

- **What shipped** — module and test counts, before and after.
- **Whether the "no engine changes" prediction held.** One export was expected (`hasLegalTile`). If anything else changed in `engine/`, say what and why — the design called that a finding.
- **Residual risk** — at minimum: `verify:layout` does not cover the end overlay dimensionally (Task 7) and why; the `SocketProvider` console noise is still present; `Game.tsx` and the six modals are still live for `/room/:roomId`.
- **Deviations from this plan**, and why each was right.
- **Plan defects caught during implementation** — every phase so far has found some in the plan's own test code. Record them.
- **What comes next inherits:** the draw screen (specified in the 2a carry-forward, still unbuilt), and Phase 3's transport work.

- [x] **Step 3: Check every box in this plan**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('docs/superpowers/plans/2026-08-04-phase-2b-finishing-the-game.md')
p.write_text(p.read_text().replace('- [x]', '- [x]'))
print('all steps marked complete')
PY
```

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-phase-2b-carry-forward.md docs/superpowers/plans/2026-08-04-phase-2b-finishing-the-game.md
git commit -m "docs: Phase 2b carry-forward"
```

---

## Self-review notes

**Spec coverage.** Every section of the design maps to a task: the stuck player → 1; dead-tile trade-in → 2; declare-end (including the "condition can become unmet" risk and the undo-across-declaration risk) → 3; the end overlay and its two actions → 4, 5; driven G9/G10 → 6; the layout check → 7; by-hand → 8; carry-forward → 9.

**One correction to the spec.** The design promises `verify:layout` will cover the overlay "as the curtain check already does". It cannot: the gate reaches its states by playing, and reaching `end` takes minutes rather than the ~40s the gate currently costs. Task 7 states the gap plainly, adds the check for the case where an end state is reached anyway, and the carry-forward records it as uncovered. Claiming otherwise would be the kind of guard Phase 1a shipped that protected nothing.

**One expected engine change, named up front.** `hasLegalTile` becomes exported. It adds no rules — it is the predicate `doEndTurn` already gates on — and exporting it is what stops the UI from growing its own second opinion about whether a player can move. The Global Constraints say any *other* engine change is a finding.

**Fixture assumptions to verify at execution time, not assume.** Tasks 1 and 2 build "stuck" and "holds a dead tile" positions from two 11-tile chains with a single gap. Eleven tiles is safe (`≥11`), and a tile joining two safe chains is dead — but the exact coordinates must be confirmed to be adjacent to both chains when the test is first run. Task 1 Step 2 says to print `previewPlacement` rather than edit the test blindly if the fixture does not behave.

**Anti-regression checks worth noting.** Task 2's "offers the trade alongside the pass" exists because trading can unstick a player, and an implementation that showed one *instead of* the other would pass every other test in this plan. Task 4's "omits the buttons the page did not supply" guards the optional props the driven tests depend on. Task 6's G11 case guards the declined end — the affordance being derived rather than latched.
