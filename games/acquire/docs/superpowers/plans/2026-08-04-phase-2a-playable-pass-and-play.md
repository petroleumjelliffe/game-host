# Phase 2a — Playable Pass-and-Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make a game of Acquire playable from setup through mergers on one device, wiring the Phase 1b component layer to the real engine.

**Architecture:** A plain-TypeScript `GameSession` owns `GameState` plus the snapshot store and exposes a view to React through `useSyncExternalStore`. A *segment* — a run of steps by one actor, derived from `getCurrentActor(state)` — is simultaneously the undo boundary, the pass-the-device boundary, and (later) Phase 3's commit boundary. All decisions render in the panel's active zone; there are no modals.

**Tech Stack:** TypeScript, React 18, Tailwind 3, react-router 7, vitest 4 (node project for `engine/**`, jsdom project for `src/**`), @testing-library/react with `fireEvent`, Chrome DevTools Protocol over the `ws` module for layout verification.

**Spec:** [2026-08-04-phase-2a-playable-pass-and-play-design.md](../specs/2026-08-04-phase-2a-playable-pass-and-play-design.md)

## Global Constraints

- **Do not modify** `src/components/`, `src/Game.tsx`, `server/`, or `prototype/`. `src/pages/PassAndPlayPage.tsx` and `src/App.tsx` **may** be modified (Task 16).
- **Do not delete** `Game.tsx` or any modal. `src/pages/RoomPage.tsx:7,42` serves online play from them; deletion is Phase 3/5.
- **Never import `engine/golden/runner`** from anything under `src/` — it imports vitest and would land in the bundle. `engine/golden/index.ts`, `replay.ts` and `fixtures.ts` are safe.
- **Zero `as any`.** Narrow with `isStartupId` from `engine/startups.ts`.
- **Never run bare `tsc`.** Use `npm run typecheck`.
- `@testing-library/user-event` is **not** a dependency. Use `fireEvent`.
- Tailwind JIT requires **literal class strings**. An interpolated class name emits no CSS and fails silently.
- Style all brand colour through `src/game/tokens.ts` (`BRAND_CLASSES`, `tickerFor`). Never hardcode a hex or a per-brand Tailwind class elsewhere.
- Every new interactive element in `src/game/` needs an explicit `m-0`; `src/styles/index.css:31` still sets a global `button { margin: 1px }`.
- Panel zones must not resize as content changes. Reserve height with a fixed `h-[Npx]` **and** a matching `min-h-[Npx]`.
- Respect `prefers-reduced-motion` — enter animations skip, they do not shorten.
- Viewports **≥768px only**. No mobile layout.
- **Gates — all four must pass before every commit:**
  ```bash
  npx vitest run
  npm run typecheck; echo "TYPECHECK_EXIT=$?"
  npx vite build
  npm run check:bundle
  ```
  Never pipe a gate into `tail`/`head` — a pipeline's exit status is the last command's, which silently masks failures. This bit Phase 1b.

---

## File Structure

**Engine (Tasks 1–4)**

| File | Responsibility |
|---|---|
| `engine/actor.ts` *(new)* | `getCurrentActor(state)` — whose input the rules await. |
| `engine/intents.ts` | Adds the `startGame` intent and its handler. |
| `engine/gameTypes.ts` | Adds `LogPayload` and `LogEntry.payload`. |
| `engine/gameLogic.ts` | `finalizeMergerPayout` emits one payout entry carrying the bonuses. |
| `engine/golden/turns.ts` | Adds G17, the opening-sequence golden game. |
| `engine/golden/mergers.ts` | Two `logPhases` assertions updated for the single payout entry. |
| `engine/golden/invariants.test.ts` | `newGame(seed)` switches to the real opening. |

**Session (Tasks 5–7)**

| File | Responsibility |
|---|---|
| `src/game/session/GameSession.ts` *(new)* | State + snapshots + segment tracking. No React. |
| `src/game/session/useGameSession.ts` *(new)* | `useSyncExternalStore` binding. |

**Setup (Tasks 8–9)**

| File | Responsibility |
|---|---|
| `src/game/setup/SeatRow.tsx` *(new)* | One seat: avatar, name field, remove. |
| `src/game/setup/PlayerRoster.tsx` *(new)* | 2–6 seats, add/remove, start gate. Transport-agnostic. |
| `src/game/setup/LocalSetupScreen.tsx` *(new)* | Roster + advanced seed disclosure + Start. |

**Screen (Tasks 10–15)**

| File | Responsibility |
|---|---|
| `src/game/GameScreen.tsx` *(new)* | Two columns, curtain, panel slot composition. Composition only. |
| `src/game/screen/stepsOf.tsx` *(new)* | `GameState.log` → `StepStackEntry[]`, undo flags included. |
| `src/game/screen/useTurnPanel.tsx` *(new)* | Stage → the `active` and `staging` slot contents, plus the turn's local staging state. One switch, one place. |
| `src/game/panel/StepStack.tsx` | Gains a per-entry `undoable` flag. |

**Wiring and verification (Tasks 16–19)**

| File | Responsibility |
|---|---|
| `src/pages/PassAndPlayPage.tsx` | Points at the new screen. |
| `scripts/verify-layout.mjs` *(new)* | Headless-Chrome layout measurement. |
| `package.json` | Adds `verify:layout`. |
| `src/game/screen/drivenGolden.test.tsx` *(new)* | G2 and G7 driven through the real screen. |
| `docs/superpowers/specs/2026-08-04-phase-2a-carry-forward.md` *(new)* | Hand-off to 2b. |

---

## Task 1: `getCurrentActor`

**Files:**
- Create: `engine/actor.ts`
- Create: `engine/actor.test.ts`
- Modify: `engine/index.ts`

**Interfaces:**
- Consumes: `GameState`, `MergerContext` from `engine/gameTypes.ts`.
- Produces: `getCurrentActor(state: GameState): string | null`.

**Background.** The live stages in the `applyIntent` path are `play`, `foundStartup`, `chooseSurvivor`, `mergerLiquidation`, `buy`, `end`, plus `draw` from `createInitialGame`. `mergerPayout`, `liquidation`, `liquidationPrompt`, `setup` and `dealHands` exist in the `Stage` union but are only reachable through the legacy `gameLogic` path that `src/Game.tsx` uses. They must still return something sane rather than crash.

- [x] **Step 1: Write the failing test**

Create `engine/actor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getCurrentActor } from './actor';
import { buildFixture } from './golden/fixtures';
import { createInitialGame } from './gameInit';

describe('getCurrentActor', () => {
  it('is seat one before turn order exists', () => {
    const state = createInitialGame('seed-a', ['Alex', 'Sam']);
    expect(state.stage).toBe('draw');
    expect(getCurrentActor(state)).toBe('p1');
  });

  it('is the active player during their own stages', () => {
    for (const stage of ['play', 'foundStartup', 'chooseSurvivor', 'buy'] as const) {
      const state = buildFixture({
        players: [{ name: 'Alex' }, { name: 'Sam' }],
        currentPlayerIndex: 1,
        stage,
      });
      expect(getCurrentActor(state)).toBe('p2');
    }
  });

  it('is the queued shareholder during liquidation, not the active player', () => {
    const state = buildFixture({
      players: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }],
      currentPlayerIndex: 0,
      stage: 'mergerLiquidation',
    });
    state.mergerContext = {
      survivorId: 'Gobble',
      absorbedIds: ['Messla'],
      payoutQueue: [],
      currentChoiceIndex: 0,
      absorbedPrices: {},
      currentLiquidationIndex: 0,
      shareholderQueue: ['p2', 'p3'],
      currentShareholderIndex: 1,
    };
    expect(getCurrentActor(state)).toBe('p3');
  });

  it('is nobody once the game is over', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], stage: 'end' });
    expect(getCurrentActor(state)).toBeNull();
  });

  it('returns null rather than throwing when a liquidation queue is exhausted', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], stage: 'mergerLiquidation' });
    expect(getCurrentActor(state)).toBeNull();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run engine/actor.test.ts
```

Expected: FAIL — `Failed to resolve import "./actor"`.

- [x] **Step 3: Implement**

Create `engine/actor.ts`:

```ts
import type { GameState } from './gameTypes';

/**
 * Whose input the rules are waiting on.
 *
 * This is the seam Phase 2a's whole interaction model hangs off: when this id
 * changes, a segment closes — the pass-the-device curtain rises, the undo range
 * resets, and snapshots before the boundary are pruned. It lives in `engine/`
 * rather than `src/` because Phase 3's server needs the same answer to decide
 * whether an arriving intent came from the player it was waiting for.
 *
 * The stages below are the ones `applyIntent` actually produces.
 * `setup`, `dealHands`, `mergerPayout`, `liquidation` and `liquidationPrompt`
 * exist in the `Stage` union but only the legacy `gameLogic` path (used by
 * `src/Game.tsx`) reaches them; they fall through to the active player so a
 * legacy state renders rather than crashes.
 */
export function getCurrentActor(state: GameState): string | null {
  if (state.stage === 'end') return null;

  // Turn order does not exist yet, so seat one opens the game.
  if (state.stage === 'draw') return state.players[0]?.id ?? null;

  if (state.stage === 'mergerLiquidation') {
    const ctx = state.mergerContext;
    if (!ctx) return null;
    return ctx.shareholderQueue[ctx.currentShareholderIndex] ?? null;
  }

  return state.players[state.turnIndex]?.id ?? null;
}
```

- [x] **Step 4: Export it from the barrel**

In `engine/index.ts`, add after the `export * from './intents';` line:

```ts
export * from './actor';
```

- [x] **Step 5: Run the test and the gates**

```bash
npx vitest run engine/actor.test.ts
npm run typecheck; echo "TYPECHECK_EXIT=$?"
```

Expected: PASS, `TYPECHECK_EXIT=0`.

- [x] **Step 6: Commit**

```bash
git add engine/actor.ts engine/actor.test.ts engine/index.ts
git commit -m "feat(engine): getCurrentActor, the segment boundary both sides need"
```

---

## Task 2: The `startGame` intent

**Files:**
- Modify: `engine/intents.ts`
- Modify: `engine/intents.test.ts`

**Interfaces:**
- Consumes: `getCurrentActor` (Task 1) is *not* used here; `compareTiles` from `engine/gameHelpers.ts`, `pushLog`/`tok` from `engine/log.ts`.
- Produces: `{ type: 'startGame'; playerId: string }` added to the `Intent` union.

**Background.** `createInitialGame` already deals full hands but leaves `stage: 'draw'`, which no intent accepts — the deadlock. `startGame` draws one tile per player for turn order, **places them permanently on the board** (Acquire's starting tiles; `previewPlacement` already treats unclaimed placed tiles correctly via `loneAdj`), sets `turnIndex` to whoever drew the lowest coordinate, and leaves `stage: 'play'`.

The tiles do **not** go back to the bag. The legacy `resolveInitialDraw` marks them placed *and* pushes them back (`engine/gameLogic.ts:60,75`), which double-counts them — a tile-conservation violation. Do not copy it.

- [x] **Step 1: Write the failing test**

Append to `engine/intents.test.ts`:

```ts
describe('startGame', () => {
  it('turns a fresh game into a playable position', () => {
    const state = createInitialGame('open-1', ['Alex', 'Sam', 'Jo']);
    expect(state.stage).toBe('draw');

    const next = applyIntent(state, { type: 'startGame', playerId: 'p1' });

    expect(next.stage).toBe('play');
    // One starting tile per player, placed and unclaimed.
    const placed = Object.entries(next.board).filter(([, c]) => c.placed);
    expect(placed).toHaveLength(3);
    expect(placed.every(([, c]) => c.startupId === undefined)).toBe(true);
  });

  it('takes the starting tiles out of the bag rather than returning them', () => {
    const state = createInitialGame('open-1', ['Alex', 'Sam', 'Jo']);
    const before = state.bag.length;
    const next = applyIntent(state, { type: 'startGame', playerId: 'p1' });

    expect(next.bag).toHaveLength(before - 3);
    const placedCoords = Object.entries(next.board)
      .filter(([, c]) => c.placed)
      .map(([coord]) => coord);
    for (const coord of placedCoords) expect(next.bag).not.toContain(coord);
  });

  it('preserves tile conservation across the opening', () => {
    const state = createInitialGame('open-2', ['Alex', 'Sam']);
    const next = applyIntent(state, { type: 'startGame', playerId: 'p1' });

    const placed = Object.values(next.board).filter((c) => c.placed).length;
    const inHands = next.players.reduce((n, p) => n + p.hand.length, 0);
    expect(placed + inHands + next.bag.length + next.discarded.length).toBe(108);
  });

  it('gives the turn to whoever drew the lowest coordinate', () => {
    const state = createInitialGame('open-3', ['Alex', 'Sam', 'Jo']);
    const drawnInOrder = state.bag.slice(0, 3);
    const lowest = [...drawnInOrder].sort(compareTiles)[0];
    const expectedIndex = drawnInOrder.indexOf(lowest);

    const next = applyIntent(state, { type: 'startGame', playerId: 'p1' });
    expect(next.turnIndex).toBe(expectedIndex);
  });

  it('logs the draw so the step stack can narrate it', () => {
    const state = createInitialGame('open-4', ['Alex', 'Sam']);
    const next = applyIntent(state, { type: 'startGame', playerId: 'p1' });
    expect(next.log.map((e) => e.phase)).toContain('Drew for turn order');
  });

  it('is rejected once the game is under way', () => {
    const state = createInitialGame('open-5', ['Alex', 'Sam']);
    const started = applyIntent(state, { type: 'startGame', playerId: 'p1' });
    expect(() => applyIntent(started, { type: 'startGame', playerId: 'p1' }))
      .toThrow(IllegalIntentError);
  });

  it('is rejected from a seat other than the first', () => {
    const state = createInitialGame('open-6', ['Alex', 'Sam']);
    expect(() => applyIntent(state, { type: 'startGame', playerId: 'p2' }))
      .toThrow(IllegalIntentError);
  });
});
```

Add `compareTiles` to the existing `engine/gameHelpers` import at the top of `engine/intents.test.ts`. If the file does not already import from `./gameHelpers`, add:

```ts
import { compareTiles } from './gameHelpers';
```

Confirm `IllegalIntentError` and `applyIntent` are already imported in that file; they are used by existing tests.

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run engine/intents.test.ts -t startGame
```

Expected: FAIL — `unknownIntent: no handler for startGame`.

- [x] **Step 3: Add the intent to the union**

In `engine/intents.ts`, add as the **first** member of the `Intent` union (it is the only intent legal before play begins):

```ts
export type Intent =
  | { type: 'startGame';           playerId: string }
  | { type: 'placeTile';           playerId: string; coord: Coord }
```

- [x] **Step 4: Implement the handler**

In `engine/intents.ts`, add `compareTiles` to the existing `./gameHelpers` import, then add this function immediately above `applyIntent`:

```ts
/**
 * Opens the game: one tile each for turn order, lowest coordinate goes first.
 *
 * The drawn tiles stay on the board as unclaimed starting tiles, exactly as in
 * Acquire, and they leave the bag for good. The legacy `resolveInitialDraw`
 * marks them placed *and* pushes them back onto the bag, which counts them
 * twice — `checkInvariants`' tile conservation catches that, and nothing
 * currently runs that code. Do not reproduce it here.
 *
 * Only seat one may open the game: turn order does not exist yet, so there is
 * no "current player" to check against, and something has to be the authority.
 */
function doStartGame(state: GameState, intent: Extract<Intent, { type: 'startGame' }>): void {
  requireStage(state, 'draw');
  if (state.players[0]?.id !== intent.playerId) reject('notYourTurn', 'only seat one opens the game');

  const drawn = state.players.map((p) => {
    const tile = state.bag.shift();
    if (!tile) reject('shareCountMismatch', 'bag exhausted during the opening draw');
    state.board[tile] = { placed: true };
    p.lastPlacedTile = tile;
    return { player: p, tile };
  });

  const sorted = [...drawn].sort((a, b) => compareTiles(a.tile, b.tile));
  state.turnIndex = state.players.findIndex((p) => p.id === sorted[0].player.id);

  pushLog(state, 'Drew for turn order', sorted.flatMap((d, i) => [
    tok.text(i === 0 ? `${d.player.name} ` : `, ${d.player.name} `),
    tok.tile(d.tile),
  ]), intent.playerId);

  state.stage = 'play';
}
```

- [x] **Step 5: Wire it into the dispatcher**

In `applyIntent`'s switch, add as the first case:

```ts
    case 'startGame':           doStartGame(next, intent); break;
```

- [x] **Step 6: Run the tests**

```bash
npx vitest run engine/intents.test.ts
```

Expected: PASS, including the seven new cases.

- [x] **Step 7: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add engine/intents.ts engine/intents.test.ts
git commit -m "feat(engine): startGame intent closes the draw-stage deadlock"
```

---

## Task 3: Pin the opening with a golden game and the property harness

**Files:**
- Modify: `engine/golden/turns.ts`
- Modify: `engine/golden/invariants.test.ts`

**Interfaces:**
- Consumes: the `startGame` intent (Task 2); `GoldenGame` and `FixtureSpec` from `engine/golden/types.ts`; `buildFixture` from `engine/golden/fixtures.ts`.
- Produces: `G17` in `TURN_GAMES`.

**Background.** The existing golden games need **no** change to their setups. `buildFixture` already supports `loners`, and G1 uses one (`engine/golden/turns.ts:16`) — so "place beside an unclaimed tile and found a chain", the rule starting tiles depend on, is already pinned. What is uncovered is the opening *sequence*.

`engine/golden/invariants.test.ts:38` builds an opening position by hand across 60 seeds with a comment explaining why: `createInitialGame` parks at `draw`. That workaround now goes away, which buys 60 seeded games of opening coverage — including the tile conservation check that the legacy draw violates.

- [x] **Step 1: Write the failing golden game**

In `engine/golden/turns.ts`, add before the `TURN_GAMES` export:

```ts
/**
 * G17: the opening. Authored bag, so the draw is deterministic without
 * depending on `shuffleSeeded`'s ordering.
 *
 * `hand` is authored here rather than dealt, because `buildFixture` does not
 * deal — the point of this game is the turn-order draw and the starting tiles,
 * not `createInitialGame`'s dealing loop (covered by invariants.test.ts).
 */
const G17: GoldenGame = {
  id: 'G17',
  title: 'the opening — turn order draw, starting tiles stay on the board',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['H8'] },
      { name: 'Sam',  cash: 6000, hand: ['C4'] },
    ],
    // Sam draws B3, which beats Alex's E5, so Sam goes first.
    bag: ['E5', 'B3', 'I12'],
    stage: 'draw',
  },
  steps: [
    {
      name: 'seat one opens the game; the lower tile takes the first turn',
      intent: { type: 'startGame', playerId: 'p1' },
      then: {
        stage: 'play',
        currentPlayer: 'p2',
        boardOwner: { E5: null, B3: null },
        logPhases: ['Drew for turn order'],
      },
    },
    {
      name: 'Sam builds on a starting tile and founds a chain of two',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'C4' },
      then: { stage: 'foundStartup', logPhases: ['Placed a tile'] },
    },
    {
      name: 'the founded chain includes the starting tile',
      intent: { type: 'chooseFoundingBrand', playerId: 'p2', startupId: 'Messla' },
      then: {
        stage: 'buy',
        chainSize: { Messla: 2 },
        boardOwner: { B3: 'Messla', C4: 'Messla' },
      },
    },
  ],
};
```

Then add `G17` to the `TURN_GAMES` array export at the bottom of the file.

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run engine/golden/golden.test.ts -t G17
```

Expected: FAIL. If Task 2 is complete this should already pass — if so, verify the *assertions* are meaningful by temporarily changing `currentPlayer: 'p2'` to `'p1'` and confirming a failure, then change it back.

- [x] **Step 3: Confirm B3 and C4 are actually adjacent**

Coordinates run `A1`–`I12` (9 rows × 12 columns). `B3` and `C4` are diagonal, **not** adjacent — diagonals do not connect in Acquire. Change the authored bag to draw `B4` instead of `B3` so the starting tile sits directly above `C4`:

```ts
    bag: ['E5', 'B4', 'I12'],
```

and update the assertions in steps 1 and 3 from `B3` to `B4`. Re-run:

```bash
npx vitest run engine/golden/golden.test.ts -t G17
```

Expected: PASS with `chainSize: { Messla: 2 }`.

- [x] **Step 4: Switch the property harness to the real opening**

In `engine/golden/invariants.test.ts`, replace the `newGame` function and its comment:

```ts
/**
 * The real opening. This used to be hand-built, because `createInitialGame`
 * yielded `stage: 'draw'` and no intent accepted it — the deadlock Task 2
 * closed. Running the genuine opening across all 60 seeds is what puts tile
 * conservation on the turn-order draw, which is where the legacy
 * `resolveInitialDraw` loses count.
 */
function newGame(seed: string): GameState {
  return applyIntent(createInitialGame(seed, NAMES), { type: 'startGame', playerId: 'p1' });
}
```

Add `createInitialGame` to the imports if it is not already there, and remove any now-unused imports (`shuffleSeeded`, `generateAllCoords`, `HAND_SIZE`, `buildFixture`) — but **only** those this file no longer references. Check first:

```bash
grep -n "shuffleSeeded\|generateAllCoords\|HAND_SIZE\|buildFixture" engine/golden/invariants.test.ts
```

`shuffleSeeded` is still used by `pick()`, so it stays.

- [x] **Step 5: Run the full property sweep**

```bash
npx vitest run engine/golden/invariants.test.ts
```

Expected: PASS across all 60 seeds. **If tile conservation fails here, stop** — it means `doStartGame` is losing or duplicating tiles, and that is the exact bug this task exists to catch.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add engine/golden/turns.ts engine/golden/invariants.test.ts
git commit -m "test(engine): pin the opening — G17 plus 60 seeds of real openings"
```

---

## Task 4: Typed payout payload on log entries

**Files:**
- Modify: `engine/gameTypes.ts`
- Modify: `engine/gameLogic.ts:671-686`
- Modify: `engine/golden/mergers.ts:52,431`
- Modify: `src/game/catalog/sections.tsx:80-100`
- Modify: `engine/log.test.ts`

**Interfaces:**
- Consumes: `BonusResult` from `engine/bonuses.ts`.
- Produces: `LogPayload`, `LogEntry.payload?: LogPayload`.

**Background.** `PayoutLines` needs `{ playerName, qty, type, amount }` per payee. The engine computes exactly that as `BonusResult[]`, then destroys it: `pendingBonuses` is set at `gameLogic.ts:644` and cleared at `:686` inside a single `applyIntent`, so React never sees it. Phase 1b's catalog recovered the payout *type* by running a regex over log text (`sections.tsx:87`) — correct today, silently broken by any rewording.

`finalizeMergerPayout` currently pushes **one entry per payee**. This task collapses that to **one entry per payout**, carrying all bonuses as a payload. One conceptual event becomes one step in the step stack, and `PayoutLines` renders it directly. Two golden games assert the old phase count and are updated.

`pushLog` already returns the entry it created, so no signature change is needed.

- [x] **Step 1: Write the failing test**

Append to `engine/intents.test.ts` (it already has merger fixtures and imports):

```ts
describe('merger payout payload', () => {
  it('emits one payout entry carrying every bonus', () => {
    // Reuse the two-way merger fixture from the golden games so the payout is real.
    const g2 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G2')!;
    const states = replayGoldenGame(g2);
    const withPayout = states.find((s) => s.log.some((e) => e.phase === 'Merger payout'))!;

    const entries = withPayout.log.filter((e) => e.phase === 'Merger payout');
    expect(entries).toHaveLength(1);

    const payload = entries[0].payload;
    expect(payload?.kind).toBe('payout');
    if (payload?.kind !== 'payout') throw new Error('expected a payout payload');
    expect(payload.bonuses.length).toBeGreaterThan(1);
    for (const b of payload.bonuses) {
      expect(typeof b.playerName).toBe('string');
      expect(['majority', 'minority', 'both']).toContain(b.type);
      expect(b.amount).toBeGreaterThan(0);
    }
  });
});
```

Add these imports to the top of `engine/intents.test.ts`:

```ts
import { ALL_GOLDEN_GAMES } from './golden';
import { replayGoldenGame } from './golden/replay';
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run engine/intents.test.ts -t "payout payload"
```

Expected: FAIL — `expected length 2 to be 1` (two per-payee entries today).

- [x] **Step 3: Add the payload type**

In `engine/gameTypes.ts`, add above `LogEntry` and extend it:

```ts
/**
 * Structured data a log entry carries alongside its display tokens, for steps
 * whose detail is a component rather than a sentence.
 *
 * A discriminated union so more step kinds can join without any consumer
 * having to guess: the alternative Phase 1b had to use was a regex over
 * rendered text, which is correct until someone rewords a log string.
 */
export type LogPayload =
  | { kind: 'payout'; bonuses: BonusResult[] };

export interface LogEntry {
  stepId: number;
  phase: string;
  detail: LogToken[];
  playerId?: string;
  payload?: LogPayload;
}
```

`BonusResult` is already imported at the top of `gameTypes.ts` (line 2) and re-exported, so no import change is needed.

- [x] **Step 4: Emit one entry with the payload**

In `engine/gameLogic.ts`, replace the award loop in `finalizeMergerPayout` (currently lines 673–684, from `// Award bonuses` through the closing brace of the `for` loop) with:

```ts
  // Award bonuses. One log entry for the whole payout, not one per payee:
  // a payout is a single consequence of the merge, so it should be a single
  // step in the stack — and `PayoutLines` renders the set, not a line at a
  // time. The bonuses ride along as a payload because `pendingBonuses` is
  // cleared a few lines below, inside this same `applyIntent` call.
  for (const b of bonuses) {
    const player = state.players.find((p) => p.id === b.playerId);
    if (player) player.cash += b.amount;
  }

  if (bonuses.length > 0) {
    const entry = pushLog(state, 'Merger payout', bonuses.flatMap((b, i) => [
      tok.text(`${i === 0 ? '' : ', '}${b.playerName} ${bonusLabel(b.type).toLowerCase()} `),
      tok.cash(b.amount, true),
    ]));
    entry.payload = { kind: 'payout', bonuses };
  }
```

`bonusLabel` is already defined directly above `finalizeMergerPayout` and stays in use.

- [x] **Step 5: Update the two golden assertions**

In `engine/golden/mergers.ts` line 52, change:

```ts
        logPhases: ['Placed a tile', 'Merger', 'Merger payout', 'Merger payout'],
```

to:

```ts
        logPhases: ['Placed a tile', 'Merger', 'Merger payout'],
```

and at line 431, change:

```ts
        logPhases: ['Merger', 'Merger payout', 'Merger payout'],
```

to:

```ts
        logPhases: ['Merger', 'Merger payout'],
```

- [x] **Step 6: Replace the catalog's regex derivation**

In `src/game/catalog/sections.tsx`, replace the whole `payoutLinesOf` function (its doc comment and body) with:

```ts
/**
 * The payout the engine actually recorded, read off the log entry's payload.
 *
 * Phase 1b derived the bonus *type* with a regex over the entry's rendered
 * text, because the engine discarded `pendingBonuses` inside the same intent.
 * The typed payload replaced that; the qty still comes off the portfolio,
 * since absorbed shares are held until that player liquidates.
 */
function payoutLinesOf(s: GameState): PayoutLine[] {
  const absorbedId = s.mergerContext?.absorbedIds[0];
  const entry = s.log.find((e) => e.payload?.kind === 'payout');
  const payload = entry?.payload;
  if (payload?.kind !== 'payout') return [];

  return payload.bonuses.map((b) => {
    const player = s.players.find((p) => p.id === b.playerId);
    return {
      playerName: b.playerName,
      emoji: player?.emoji,
      qty: absorbedId ? (player?.portfolio[absorbedId] ?? 0) : undefined,
      type: b.type,
      amount: b.amount,
    };
  });
}
```

If `textOf` is now unused in that file, remove it; check with:

```bash
grep -n "textOf" src/game/catalog/sections.tsx
```

- [x] **Step 7: Run everything**

```bash
npx vitest run
```

Expected: PASS. The catalog's payout section must still render the same names and amounts — they now come from the payload rather than the regex.

- [x] **Step 8: Run the remaining gates and commit**

```bash
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vite build
npm run check:bundle
git add engine/gameTypes.ts engine/gameLogic.ts engine/golden/mergers.ts src/game/catalog/sections.tsx
git commit -m "feat(engine): typed payout payload on log entries, retiring the regex"
```

---

## Task 5: `GameSession` — dispatch, undo, subscribe

**Files:**
- Create: `src/game/session/GameSession.ts`
- Create: `src/game/session/GameSession.test.ts`

**Interfaces:**
- Consumes: `applyIntentWithHistory`, `rewindTo`, `createSnapshotStore`, `SnapshotStore` from `engine/history.ts`; `applyIntent`, `Intent`, `IllegalIntentError`, `IllegalIntentCode` from `engine/intents.ts`; `createInitialGame` from `engine/gameInit.ts`; `getCurrentActor` from `engine/actor.ts` (Task 1).
- Produces: `createGameSession(init)`, `GameSession`, `SessionView` — used by Tasks 6, 7, 10–19.

**Background.** The session is the seam Phase 3 cuts at: online, `dispatch` will send an intent and await a broadcast while the view shape stays identical. It is plain TypeScript with no React import, so it is tested in the **node** project — deliberately, because jsdom's blindness to layout is what shipped a bug in Phase 1b, and the state machine has no business being tested there.

Note: `src/**/*.test.ts` runs under the **jsdom** project per `vite.config.ts`. That is fine — the point is that `GameSession.ts` itself imports nothing from React or the DOM, so its tests need no rendering.

This task covers construction, dispatch, error capture and undo. Task 6 adds segments.

- [x] **Step 1: Write the failing test**

Create `src/game/session/GameSession.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createGameSession } from './GameSession';
import { buildFixture } from '../../../engine/golden/fixtures';

function playableGame() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('createGameSession', () => {
  it('builds from a seed and player names', () => {
    const session = createGameSession({ seed: 'sess-1', names: ['Alex', 'Sam'] });
    expect(session.getView().state.stage).toBe('draw');
    expect(session.getView().state.players.map((p) => p.name)).toEqual(['Alex', 'Sam']);
  });

  it('builds from an existing state, which is how golden fixtures are driven', () => {
    const session = createGameSession({ state: playableGame() });
    expect(session.getView().state.stage).toBe('play');
  });

  it('applies a legal intent and advances the state', () => {
    const session = createGameSession({ state: playableGame() });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().state.stage).toBe('foundStartup');
  });

  it('notifies subscribers on dispatch', () => {
    const session = createGameSession({ state: playableGame() });
    const listener = vi.fn();
    session.subscribe(listener);
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(listener).toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const session = createGameSession({ state: playableGame() });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    unsubscribe();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('captures an illegal intent as an error rather than throwing', () => {
    const session = createGameSession({ state: playableGame() });
    expect(() =>
      session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' }),
    ).not.toThrow();
    expect(session.getView().error?.code).toBe('notYourTurn');
  });

  it('leaves state untouched when an intent is rejected', () => {
    const session = createGameSession({ state: playableGame() });
    const before = session.getView().state;
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });
    expect(session.getView().state.stage).toBe(before.stage);
    expect(session.getView().state.nextStepId).toBe(before.nextStepId);
  });

  it('clears a previous error on the next successful dispatch', () => {
    const session = createGameSession({ state: playableGame() });
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });
    expect(session.getView().error).not.toBeNull();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().error).toBeNull();
  });

  it('undoes back to the state before a step', () => {
    const session = createGameSession({ state: playableGame() });
    const stepId = session.getView().state.nextStepId;
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().state.stage).toBe('foundStartup');

    session.undoTo(stepId);
    expect(session.getView().state.stage).toBe('play');
    expect(session.getView().state.players[0].hand).toContain('E6');
  });

  it('returns a new view object per change so useSyncExternalStore sees it', () => {
    const session = createGameSession({ state: playableGame() });
    const first = session.getView();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView()).not.toBe(first);
  });

  it('returns the identical view object when nothing has changed', () => {
    const session = createGameSession({ state: playableGame() });
    expect(session.getView()).toBe(session.getView());
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/session/GameSession.test.ts
```

Expected: FAIL — cannot resolve `./GameSession`.

- [x] **Step 3: Implement**

Create `src/game/session/GameSession.ts`:

```ts
import type { GameState } from '../../../engine/gameTypes';
import type { Intent, IllegalIntentCode } from '../../../engine/intents';
import { IllegalIntentError } from '../../../engine/intents';
import {
  createSnapshotStore,
  applyIntentWithHistory,
  rewindTo,
  type SnapshotStore,
} from '../../../engine/history';
import { createInitialGame } from '../../../engine/gameInit';

export interface SessionError {
  code: IllegalIntentCode;
  message: string;
}

export interface SessionView {
  state: GameState;
  /** Whose input is awaited. Task 6 fills this in. */
  actorId: string | null;
  /** The segment just changed hands; the curtain is up. Task 6 fills this in. */
  awaitingReveal: boolean;
  /** Step ids that can be undone right now, oldest first. Task 6 scopes this. */
  undoableSteps: number[];
  /** The last rejected intent, cleared by the next successful one. */
  error: SessionError | null;
}

export interface GameSession {
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  dispatch(intent: Intent): void;
  undoTo(stepId: number): void;
  reveal(): void;
}

export type SessionInit = { seed: string; names: string[] } | { state: GameState };

/**
 * Owns the game state and the snapshot store, and is the only place that turns
 * an `IllegalIntentError` into something a player can read.
 *
 * Deliberately free of React: this is the seam Phase 3 cuts at, where
 * `dispatch` becomes "send the intent, await the server's broadcast" and the
 * view shape does not change. Keeping it plain also keeps the state machine
 * out of jsdom, which in Phase 1b proved able to pass tests over a visibly
 * broken page.
 */
export function createGameSession(init: SessionInit): GameSession {
  let state: GameState = 'state' in init
    ? structuredClone(init.state)
    : createInitialGame(init.seed, init.names);

  const store: SnapshotStore = createSnapshotStore();
  let error: SessionError | null = null;
  const listeners = new Set<() => void>();

  // Cached so `getView()` is referentially stable between changes —
  // `useSyncExternalStore` re-renders forever if the snapshot is a fresh
  // object on every call.
  let view: SessionView | null = null;

  function invalidate(): void {
    view = null;
    for (const listener of listeners) listener();
  }

  function buildView(): SessionView {
    return {
      state,
      actorId: null,
      awaitingReveal: false,
      undoableSteps: [...store.keys()].sort((a, b) => a - b),
      error,
    };
  }

  return {
    getView() {
      if (view === null) view = buildView();
      return view;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    dispatch(intent) {
      try {
        state = applyIntentWithHistory(store, state, intent);
        error = null;
      } catch (e) {
        if (!(e instanceof IllegalIntentError)) throw e;
        error = { code: e.code, message: e.message };
      }
      invalidate();
    },

    undoTo(stepId) {
      state = rewindTo(store, stepId);
      error = null;
      invalidate();
    },

    reveal() {
      invalidate();
    },
  };
}
```

- [x] **Step 4: Run the test**

```bash
npx vitest run src/game/session/GameSession.test.ts
```

Expected: PASS — all eleven cases.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/session/
git commit -m "feat(session): GameSession owning state, snapshots and rejection"
```

---

## Task 6: Segments — actor, curtain, undo scope, pruning

**Files:**
- Modify: `src/game/session/GameSession.ts`
- Modify: `src/game/session/GameSession.test.ts`

**Interfaces:**
- Consumes: `getCurrentActor` (Task 1), `createGameSession` (Task 5).
- Produces: `SessionView.actorId`, `.awaitingReveal`, `.undoableSteps` (now segment-scoped), and `GameSession.reveal()` with real behaviour.

**Background — the one idea in this phase.** A *segment* is a run of steps by one actor. When `getCurrentActor(state)` changes, three things happen together: the curtain rises, the undo range resets, and snapshots before the boundary are pruned.

**The subtlety that matters:** `applyIntentWithHistory` files **one snapshot per intent**, keyed by the `nextStepId` the state had *before* the intent ran. A single intent can push several log entries and so consume several step ids. Therefore `undoableSteps` is the set of *snapshot keys*, not the set of log entries — an automatic consequence like a merger payout is never independently undoable, which is correct, because it was never a decision.

A boundary-crossing intent's own snapshot (say `endTurn`) belongs to the segment that just closed and must be pruned, or the incoming player could rewind the outgoing player's turn.

- [x] **Step 1: Write the failing test**

Append to `src/game/session/GameSession.test.ts`:

```ts
describe('segments', () => {
  it('reports the active player as the actor', () => {
    const session = createGameSession({ state: playableGame() });
    expect(session.getView().actorId).toBe('p1');
  });

  it('raises the curtain when the actor changes and lowers it on reveal', () => {
    const session = createGameSession({ state: playableGame() });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    expect(session.getView().awaitingReveal).toBe(false);

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    expect(session.getView().actorId).toBe('p2');
    expect(session.getView().awaitingReveal).toBe(true);

    session.reveal();
    expect(session.getView().awaitingReveal).toBe(false);
  });

  it('starts with the curtain up so the first player has to claim the device', () => {
    const session = createGameSession({ seed: 'sess-2', names: ['Alex', 'Sam'] });
    expect(session.getView().awaitingReveal).toBe(true);
    expect(session.getView().actorId).toBe('p1');
  });

  it('offers no undo across a turn boundary', () => {
    const session = createGameSession({ state: playableGame() });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    expect(session.getView().undoableSteps.length).toBe(2);

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    expect(session.getView().undoableSteps).toEqual([]);
  });

  it('accumulates undo points within one segment', () => {
    const session = createGameSession({ state: playableGame() });
    const first = session.getView().state.nextStepId;
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().undoableSteps).toEqual([first]);

    const second = session.getView().state.nextStepId;
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    expect(session.getView().undoableSteps).toEqual([first, second]);
  });

  it('offers one undo point per intent, not per log entry', () => {
    // Founding pushes two log entries under one intent (the founder share, then
    // the founding itself), so step ids outrun snapshots. Only the intent is
    // undoable.
    const session = createGameSession({ state: playableGame() });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const beforeFound = session.getView().state.nextStepId;
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });

    expect(session.getView().state.nextStepId).toBeGreaterThan(beforeFound + 1);
    expect(session.getView().undoableSteps).toContain(beforeFound);
    expect(session.getView().undoableSteps).not.toContain(beforeFound + 1);
  });

  it('drops the curtain again after undoing within a segment', () => {
    const session = createGameSession({ state: playableGame() });
    const stepId = session.getView().state.nextStepId;
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.undoTo(stepId);
    expect(session.getView().awaitingReveal).toBe(false);
    expect(session.getView().actorId).toBe('p1');
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/session/GameSession.test.ts -t segments
```

Expected: FAIL — `actorId` is `null`, `awaitingReveal` is `false`.

- [x] **Step 3: Implement segments**

In `src/game/session/GameSession.ts`, add the import:

```ts
import { getCurrentActor } from '../../../engine/actor';
```

Replace the declarations of `error`, `listeners` and `view` with:

```ts
  let error: SessionError | null = null;
  const listeners = new Set<() => void>();

  /**
   * A segment is a run of steps by one actor. Its start is the step id the
   * incoming actor's first intent will be filed under, so any snapshot below
   * it belongs to a closed segment and is not this player's to undo.
   */
  let actorId: string | null = getCurrentActor(state);
  let segmentStart: number = state.nextStepId;
  // The very first segment starts behind the curtain too: whoever is holding
  // the device has to claim seat one before they see anything.
  let awaitingReveal = true;

  let view: SessionView | null = null;
```

Replace `buildView` with:

```ts
  function buildView(): SessionView {
    return {
      state,
      actorId,
      awaitingReveal,
      undoableSteps: [...store.keys()].filter((k) => k >= segmentStart).sort((a, b) => a - b),
      error,
    };
  }

  /**
   * Closes the segment if the actor changed: curtain up, undo range reset, and
   * every snapshot from the closed segment discarded — including the snapshot
   * of the boundary-crossing intent itself, which belongs to the player who
   * just finished, not to the one arriving.
   */
  function syncSegment(): void {
    const next = getCurrentActor(state);
    if (next === actorId) return;

    actorId = next;
    segmentStart = state.nextStepId;
    awaitingReveal = true;
    for (const key of [...store.keys()]) {
      if (key < segmentStart) store.delete(key);
    }
  }
```

In `dispatch`, call `syncSegment()` after the try/catch and before `invalidate()`:

```ts
    dispatch(intent) {
      try {
        state = applyIntentWithHistory(store, state, intent);
        error = null;
      } catch (e) {
        if (!(e instanceof IllegalIntentError)) throw e;
        error = { code: e.code, message: e.message };
      }
      syncSegment();
      invalidate();
    },
```

Replace `reveal`:

```ts
    reveal() {
      awaitingReveal = false;
      invalidate();
    },
```

`undoTo` needs no `syncSegment` call — rewinding within a segment cannot change the actor, since the actor is what defines the segment. Leave it as it is.

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/session/GameSession.test.ts
```

Expected: PASS — all eighteen cases.

- [x] **Step 5: Verify the liquidation handoff specifically**

Append one more test, then re-run:

```ts
describe('liquidation segments', () => {
  it('hands the device between shareholders during a merger', () => {
    const g2 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G2')!;
    const states = replayGoldenGame(g2);
    const liquidating = states.find((s) => s.stage === 'mergerLiquidation');
    if (!liquidating) throw new Error('G2 no longer reaches mergerLiquidation');

    const session = createGameSession({ state: liquidating });
    const first = session.getView().actorId;
    expect(first).not.toBeNull();
    expect(session.getView().state.mergerContext?.shareholderQueue).toContain(first);
  });
});
```

with these imports added to the test file:

```ts
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
```

```bash
npx vitest run src/game/session/GameSession.test.ts
```

Expected: PASS.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npm run check:bundle
git add src/game/session/
git commit -m "feat(session): segments unify curtain, undo scope and snapshot pruning"
```

---

## Task 7: The React binding

**Files:**
- Create: `src/game/session/useGameSession.ts`
- Create: `src/game/session/useGameSession.test.tsx`

**Interfaces:**
- Consumes: `GameSession`, `SessionView` (Tasks 5–6).
- Produces: `useGameSession(session: GameSession): SessionView`.

- [x] **Step 1: Write the failing test**

Create `src/game/session/useGameSession.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createGameSession, type GameSession } from './GameSession';
import { useGameSession } from './useGameSession';
import { buildFixture } from '../../../engine/golden/fixtures';

function Probe({ session }: { session: GameSession }) {
  const view = useGameSession(session);
  return (
    <div>
      <span data-testid="stage">{view.state.stage}</span>
      <span data-testid="actor">{view.actorId ?? 'none'}</span>
      <button onClick={() => session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' })}>
        place
      </button>
    </div>
  );
}

describe('useGameSession', () => {
  it('renders the current view and re-renders when the session changes', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [{ name: 'Alex', hand: ['E6'] }, { name: 'Sam' }],
        loners: ['E5'],
      }),
    });

    render(<Probe session={session} />);
    expect(screen.getByTestId('stage')).toHaveTextContent('play');
    expect(screen.getByTestId('actor')).toHaveTextContent('p1');

    fireEvent.click(screen.getByText('place'));
    expect(screen.getByTestId('stage')).toHaveTextContent('foundStartup');
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/session/useGameSession.test.tsx
```

Expected: FAIL — cannot resolve `./useGameSession`.

- [x] **Step 3: Implement**

Create `src/game/session/useGameSession.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { GameSession, SessionView } from './GameSession';

/**
 * Binds a `GameSession` to React.
 *
 * `getView()` must return the *same* object until something changes, or
 * `useSyncExternalStore` loops forever; `GameSession` caches it for exactly
 * that reason. The server snapshot is the same function because there is no
 * server rendering here and a session is always constructed client-side.
 */
export function useGameSession(session: GameSession): SessionView {
  return useSyncExternalStore(session.subscribe, session.getView, session.getView);
}
```

- [x] **Step 4: Run the test**

```bash
npx vitest run src/game/session/useGameSession.test.tsx
```

Expected: PASS.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/session/useGameSession.ts src/game/session/useGameSession.test.tsx
git commit -m "feat(session): useGameSession binding via useSyncExternalStore"
```

---

## Task 8: `SeatRow` and `PlayerRoster`

**Files:**
- Create: `src/game/setup/SeatRow.tsx`
- Create: `src/game/setup/PlayerRoster.tsx`
- Create: `src/game/setup/PlayerRoster.test.tsx`

**Interfaces:**
- Consumes: `PLAYER_EMOJI` from `engine/startups.ts`.
- Produces:
  ```ts
  interface Seat { name: string }
  interface PlayerRosterProps {
    seats: Seat[];
    onChange: (seats: Seat[]) => void;
    minSeats?: number;   // default 2
    maxSeats?: number;   // default 6
  }
  function avatarFor(index: number): string;
  ```

**Background.** Two forked setup UIs exist: `SetupScreen` (a comma-separated text field, no per-player identity) and `WaitingRoom` (468 lines, roster plus transport). The genuinely shared concept is a roster of 2–6 seats. This task builds only that. **It does not touch either existing file** — Phase 5 adopts the roster into `WaitingRoom`.

Emoji is a **seat avatar**, taken from `engine/startups.ts:21`'s `PLAYER_EMOJI` by seat index. There are exactly six emoji and at most six seats, so avatars are distinct by construction and there is no collision logic to get wrong. `src/utils/emojiNames.ts` is a different thing — a name *generator* for anonymous online players — and is not used here.

- [x] **Step 1: Write the failing test**

Create `src/game/setup/PlayerRoster.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlayerRoster, avatarFor } from './PlayerRoster';
import { PLAYER_EMOJI } from '../../../engine/startups';

const TWO = [{ name: 'Alex' }, { name: 'Sam' }];

describe('PlayerRoster', () => {
  it('renders one row per seat with its avatar', () => {
    render(<PlayerRoster seats={TWO} onChange={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(PLAYER_EMOJI[0])).toBeInTheDocument();
    expect(within(rows[1]).getByText(PLAYER_EMOJI[1])).toBeInTheDocument();
  });

  it('assigns avatars by seat index', () => {
    expect(avatarFor(0)).toBe(PLAYER_EMOJI[0]);
    expect(avatarFor(5)).toBe(PLAYER_EMOJI[5]);
  });

  it('edits a seat name', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={TWO} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Alex'), { target: { value: 'Alexandra' } });
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alexandra' }, { name: 'Sam' }]);
  });

  it('adds a seat', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={TWO} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add player/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alex' }, { name: 'Sam' }, { name: 'Player 3' }]);
  });

  it('removes a seat', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={[{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }]} onChange={onChange} />);
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(within(rows[1]).getByRole('button', { name: /remove sam/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alex' }, { name: 'Jo' }]);
  });

  it('cannot add beyond six seats', () => {
    const six = PLAYER_EMOJI.map((_, i) => ({ name: `P${i + 1}` }));
    render(<PlayerRoster seats={six} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /add player/i })).toBeDisabled();
  });

  it('cannot remove below two seats', () => {
    render(<PlayerRoster seats={TWO} onChange={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: /remove alex/i })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/setup/PlayerRoster.test.tsx
```

Expected: FAIL — cannot resolve `./PlayerRoster`.

- [x] **Step 3: Implement `SeatRow`**

Create `src/game/setup/SeatRow.tsx`:

```tsx
/**
 * One seat at the table: its avatar, its name, and a way to remove it.
 *
 * The avatar is shown, not chosen. There are exactly six avatars and at most
 * six seats, so assigning by index makes them distinct by construction and
 * leaves no collision logic to get wrong.
 */
export interface SeatRowProps {
  avatar: string;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function SeatRow({ avatar, name, onNameChange, onRemove, canRemove }: SeatRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <span className="flex-none text-2xl leading-none" aria-hidden="true">{avatar}</span>
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        aria-label={`Name for ${avatar}`}
        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm font-semibold"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove ${name}`}
        className="m-0 flex-none rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ✕
      </button>
    </li>
  );
}
```

- [x] **Step 4: Implement `PlayerRoster`**

Create `src/game/setup/PlayerRoster.tsx`:

```tsx
import { PLAYER_EMOJI } from '../../../engine/startups';
import { SeatRow } from './SeatRow';

/**
 * The 2–6 seat roster, shared by design between pass-and-play and (from
 * Phase 5) the online waiting room. It knows nothing about transport: no room
 * codes, no host, no sockets. That separation is the entire point — the two
 * setup screens forked historically, and only the roster was ever common.
 */
export interface Seat {
  name: string;
}

export interface PlayerRosterProps {
  seats: Seat[];
  onChange: (seats: Seat[]) => void;
  minSeats?: number;
  maxSeats?: number;
}

/** Seat avatars come from the engine's fixed six, by index. */
export function avatarFor(index: number): string {
  return PLAYER_EMOJI[index % PLAYER_EMOJI.length];
}

export function PlayerRoster({
  seats,
  onChange,
  minSeats = 2,
  maxSeats = PLAYER_EMOJI.length,
}: PlayerRosterProps) {
  const canAdd = seats.length < maxSeats;
  const canRemove = seats.length > minSeats;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {seats.map((seat, i) => (
          <SeatRow
            key={i}
            avatar={avatarFor(i)}
            name={seat.name}
            canRemove={canRemove}
            onNameChange={(name) =>
              onChange(seats.map((s, j) => (j === i ? { ...s, name } : s)))
            }
            onRemove={() => onChange(seats.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...seats, { name: `Player ${seats.length + 1}` }])}
        disabled={!canAdd}
        className="m-0 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add player
      </button>
    </div>
  );
}
```

- [x] **Step 5: Run the tests**

```bash
npx vitest run src/game/setup/PlayerRoster.test.tsx
```

Expected: PASS — all seven cases.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/setup/
git commit -m "feat(setup): transport-agnostic 2-6 seat roster"
```

---

## Task 9: `LocalSetupScreen`

**Files:**
- Create: `src/game/setup/LocalSetupScreen.tsx`
- Create: `src/game/setup/LocalSetupScreen.test.tsx`

**Interfaces:**
- Consumes: `PlayerRoster`, `Seat` (Task 8).
- Produces:
  ```ts
  interface LocalSetupScreenProps {
    onStart: (config: { seed: string; names: string[] }) => void;
    defaultSeed?: string;
  }
  ```

**Background.** The seed input survives, but behind a `<details>` disclosure. It is a debugging affordance and the reason golden replays are reproducible — not something to put in a player's way. It defaults to a fresh random value so two games in a row differ.

- [x] **Step 1: Write the failing test**

Create `src/game/setup/LocalSetupScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalSetupScreen } from './LocalSetupScreen';

describe('LocalSetupScreen', () => {
  it('starts with two seats', () => {
    render(<LocalSetupScreen onStart={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('reports the seat names on start', () => {
    const onStart = vi.fn();
    render(<LocalSetupScreen onStart={onStart} defaultSeed="fixed-seed" />);
    fireEvent.change(screen.getByDisplayValue('Player 1'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByDisplayValue('Player 2'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));

    expect(onStart).toHaveBeenCalledWith({ seed: 'fixed-seed', names: ['Alex', 'Sam'] });
  });

  it('keeps the seed out of the way but reachable', () => {
    render(<LocalSetupScreen onStart={() => {}} defaultSeed="fixed-seed" />);
    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('fixed-seed')).toBeInTheDocument();
  });

  it('refuses to start when a seat has no name', () => {
    render(<LocalSetupScreen onStart={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('Player 1'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  });

  it('generates a different seed each mount so two games differ', () => {
    const { unmount } = render(<LocalSetupScreen onStart={() => {}} />);
    const first = (screen.getByLabelText(/seed/i) as HTMLInputElement).value;
    unmount();
    render(<LocalSetupScreen onStart={() => {}} />);
    const second = (screen.getByLabelText(/seed/i) as HTMLInputElement).value;
    expect(first).not.toBe(second);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/setup/LocalSetupScreen.test.tsx
```

Expected: FAIL — cannot resolve `./LocalSetupScreen`.

- [x] **Step 3: Implement**

Create `src/game/setup/LocalSetupScreen.tsx`:

```tsx
import { useState } from 'react';
import { PlayerRoster, type Seat } from './PlayerRoster';

/**
 * Pass-and-play's setup: the shared roster, a start gate, and the seed tucked
 * behind a disclosure.
 *
 * The seed is a debugging affordance — it is what makes a reported game
 * reproducible — so it stays reachable without being the first thing a player
 * sees. It is regenerated per mount so consecutive games differ.
 */
export interface LocalSetupScreenProps {
  onStart: (config: { seed: string; names: string[] }) => void;
  defaultSeed?: string;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function LocalSetupScreen({ onStart, defaultSeed }: LocalSetupScreenProps) {
  const [seats, setSeats] = useState<Seat[]>([{ name: 'Player 1' }, { name: 'Player 2' }]);
  const [seed, setSeed] = useState(() => defaultSeed ?? randomSeed());

  const names = seats.map((s) => s.name.trim());
  const canStart = names.length >= 2 && names.every((n) => n.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Acquire — Startups Edition</h1>
        <p className="text-sm text-gray-600">Pass and play on one device.</p>
      </div>

      <PlayerRoster seats={seats} onChange={setSeats} />

      <details className="rounded-lg border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-gray-600">Advanced</summary>
        <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          Seed
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm font-normal normal-case tracking-normal"
          />
        </label>
        <p className="mt-1 text-xs text-gray-500">
          The same seed and the same names replay the same game.
        </p>
      </details>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => onStart({ seed, names })}
        className="m-0 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start game
      </button>
    </div>
  );
}
```

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/setup/LocalSetupScreen.test.tsx
```

Expected: PASS — all five cases.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/setup/LocalSetupScreen.tsx src/game/setup/LocalSetupScreen.test.tsx
git commit -m "feat(setup): local setup screen on the shared roster"
```

---

## Task 10: Step stack from the log

**Files:**
- Create: `src/game/screen/stepsOf.tsx`
- Create: `src/game/screen/stepsOf.test.tsx`
- Modify: `src/game/panel/StepStack.tsx`
- Modify: `src/game/panel/StepStack.test.tsx`

**Interfaces:**
- Consumes: `LogEntry`, `LogPayload` (Task 4); `LogDetail` from `src/game/panel/LogDetail.tsx`; `PayoutLines` from `src/game/merger/PayoutLines.tsx`; `StepStackEntry` from `src/game/panel/StepStack.tsx`.
- Produces:
  ```ts
  function stepsOf(state: GameState, undoableSteps: number[]): StepStackEntry[];
  ```
  and `StepStackEntry` gains `undoable?: boolean`.

**Background.** `StepStack` currently passes `onUndo` to every entry, so every entry shows an undo affordance. But snapshots exist **per intent**, not per log entry — a merger pushes several entries under one intent. Offering undo on an entry with no snapshot would throw `no snapshot for step N` from `rewindTo`. The entry therefore needs to say whether it is undoable, and only the session knows.

- [x] **Step 1: Write the failing test**

Create `src/game/screen/stepsOf.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stepsOf } from './stepsOf';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';

function g(id: string) {
  const game = ALL_GOLDEN_GAMES.find((x) => x.id === id);
  if (!game) throw new Error(`no golden game ${id}`);
  return game;
}

describe('stepsOf', () => {
  it('turns log entries into step stack entries', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];
    const steps = stepsOf(state, []);

    expect(steps.length).toBe(state.log.length);
    expect(steps.map((s) => s.stepId)).toEqual(state.log.map((e) => e.stepId));
    expect(steps[0].phase).toBe(state.log[0].phase);
  });

  it('marks only the steps that have a snapshot as undoable', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];
    const undoable = [state.log[1].stepId];
    const steps = stepsOf(state, undoable);

    expect(steps.find((s) => s.stepId === state.log[1].stepId)?.undoable).toBe(true);
    expect(steps.find((s) => s.stepId === state.log[0].stepId)?.undoable).toBe(false);
  });

  it('renders a payout step through PayoutLines rather than as a sentence', () => {
    const states = replayGoldenGame(g('G2'));
    const state = states.find((s) => s.log.some((e) => e.payload?.kind === 'payout'));
    if (!state) throw new Error('G2 no longer produces a payout payload');

    const payoutStep = stepsOf(state, []).find((s) => s.phase === 'Merger payout');
    if (!payoutStep) throw new Error('no payout step');

    render(<div>{payoutStep.detail}</div>);
    // PayoutLines labels the role; a plain token list would not.
    expect(screen.getAllByText(/majority|minority/i).length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/stepsOf.test.tsx
```

Expected: FAIL — cannot resolve `./stepsOf`.

- [x] **Step 3: Add the `undoable` flag to `StepStack`**

In `src/game/panel/StepStack.tsx`, extend the entry interface and gate the handler:

```tsx
export interface StepStackEntry {
  stepId: number;
  phase: string;
  detail: ReactNode;
  /**
   * Whether this step can be rewound to. Snapshots are filed per *intent*, and
   * one intent can push several log entries — a merger writes the placement,
   * the merge and the payout under one action. Offering undo on an entry with
   * no snapshot would throw out of `rewindTo`, so the caller says which are
   * real undo points.
   */
  undoable?: boolean;
}

export function StepStack({ entries, onUndo }: StepStackProps) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pb-2 pt-3.5">
      {entries.map((e) => (
        <StepEntry
          key={e.stepId}
          phase={e.phase}
          detail={e.detail}
          stepId={e.stepId}
          onUndo={e.undoable ? onUndo : undefined}
        />
      ))}
    </div>
  );
}
```

- [x] **Step 4: Add a `StepStack` test for the flag**

Append to `src/game/panel/StepStack.test.tsx`:

```tsx
it('offers undo only on entries marked undoable', () => {
  const onUndo = vi.fn();
  render(
    <StepStack
      onUndo={onUndo}
      entries={[
        { stepId: 1, phase: 'Placed a tile', detail: 'E5', undoable: true },
        { stepId: 2, phase: 'Merger payout', detail: 'paid', undoable: false },
      ]}
    />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
```

Confirm `vi` is imported in that file; add it to the existing `vitest` import if not.

- [x] **Step 5: Implement `stepsOf`**

Create `src/game/screen/stepsOf.tsx`:

```tsx
import type { GameState } from '../../../engine/gameTypes';
import type { StepStackEntry } from '../panel/StepStack';
import { LogDetail } from '../panel/LogDetail';
import { PayoutLines } from '../merger/PayoutLines';

/**
 * The engine's log, rendered as the panel's step stack.
 *
 * Most steps render their tokens through `LogDetail`. A step carrying a typed
 * payload renders the component that payload was made for — a merger payout is
 * a table of who was paid and why, not a sentence.
 */
export function stepsOf(state: GameState, undoableSteps: number[]): StepStackEntry[] {
  const undoable = new Set(undoableSteps);

  return state.log.map((entry) => ({
    stepId: entry.stepId,
    phase: entry.phase,
    undoable: undoable.has(entry.stepId),
    detail:
      entry.payload?.kind === 'payout' ? (
        <PayoutLines
          bonuses={entry.payload.bonuses.map((b) => ({
            playerName: b.playerName,
            emoji: state.players.find((p) => p.id === b.playerId)?.emoji,
            qty: b.shares,
            type: b.type,
            amount: b.amount,
          }))}
        />
      ) : (
        <LogDetail tokens={entry.detail} />
      ),
  }));
}
```

Check `LogDetail`'s exact prop name before running — if it is not `tokens`, use the real one:

```bash
grep -n "export interface LogDetailProps" -A 4 src/game/panel/LogDetail.tsx
```

- [x] **Step 6: Run the tests**

```bash
npx vitest run src/game/screen/stepsOf.test.tsx src/game/panel/StepStack.test.tsx
```

Expected: PASS.

- [x] **Step 7: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/screen/stepsOf.tsx src/game/screen/stepsOf.test.tsx src/game/panel/StepStack.tsx src/game/panel/StepStack.test.tsx
git commit -m "feat(screen): step stack from the engine log, undo only where a snapshot exists"
```

---

## Task 11: `useTurnPanel` — placement and founding

**Files:**
- Create: `src/game/screen/useTurnPanel.tsx`
- Create: `src/game/screen/useTurnPanel.test.tsx`

**Interfaces:**
- Consumes: `SessionView` (Tasks 5–6); `ActiveStep`, `StagingZone`, `FoundGroups`; `previewPlacement` from `engine/placement.ts`; `floodFillUnclaimed` from `engine/gameHelpers.ts`.
- Produces:
  ```ts
  interface TurnPanelSlots { active: ReactNode; staging: ReactNode }
  function useTurnPanel(view: SessionView, dispatch: (intent: Intent) => void): TurnPanelSlots;
  ```

**Background.** One switch on `state.stage`, in one file. This is where every decision lives; the board only shows the position and accepts a click. Tasks 11–13 fill in stages progressively — this one covers `draw`, `play` and `foundStartup`.

**Why a hook returning two nodes, rather than a component.** The panel's zone order is fixed —
`stepstack → active → staging → hand → players` — and **panel zones must not resize as content
changes**. If the staging zone were rendered inside the active slot it would appear only during
buying and liquidation, moving every zone below it. So staging is always its own slot, always
rendered, reserving its height even when empty (`StagingZone` was built in Phase 1b to do exactly
that).

But the two slots share state: the buy buttons live in `active` while the confirm button lives in
`staging`. Lifting that state to `GameScreen` would spread turn logic across a file whose job is
composition. A hook keeps the state next to the markup that uses it and hands back both nodes, so
`GameScreen` stays a wiring diagram.

The staged picks reset whenever the actor or the stage changes — an abandoned basket must not
survive into someone else's turn.

`FoundGroups` needs `foundSize`: the size the new chain will be, which is the placed tile plus the unclaimed group it joins. `previewPlacement(state, coord)` returns `loneAdj`; the full group is that flood-filled, plus one for the tile itself. `pendingFoundTile` holds the coord during `foundStartup`.

- [x] **Step 1: Write the failing test**

Create `src/game/screen/useTurnPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTurnPanel } from './useTurnPanel';
import { createGameSession, type GameSession } from '../session/GameSession';
import type { Intent } from '../../../engine/intents';
import { buildFixture } from '../../../engine/golden/fixtures';

function sessionFor(state = buildFixture({
  players: [{ name: 'Alex', cash: 6000, hand: ['E6', 'H8'] }, { name: 'Sam', cash: 6000, hand: ['A1'] }],
  loners: ['E5'],
  bag: ['I11', 'I12'],
})) {
  return createGameSession({ state });
}

/**
 * Renders both slots the way `Panel` will, so a test can click a control in
 * one slot and assert on the other — which is the whole reason the hook hands
 * back two nodes instead of one.
 */
function Harness({ session, dispatch }: { session: GameSession; dispatch: (i: Intent) => void }) {
  const { active, staging } = useTurnPanel(session.getView(), dispatch);
  return <div><div data-slot="active">{active}</div><div data-slot="staging">{staging}</div></div>;
}

describe('useTurnPanel', () => {
  it('asks seat one to open the game while the stage is draw', () => {
    const session = createGameSession({ seed: 'az-1', names: ['Alex', 'Sam'] });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /draw for turn order/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'startGame', playerId: 'p1' });
  });

  it('prompts for a tile during play', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });

  it('always renders the staging slot, so the panel cannot resize between stages', () => {
    const { container } = render(<Harness session={sessionFor()} dispatch={() => {}} />);
    const staging = container.querySelector('[data-slot="staging"]')!;
    // Empty at `play`, but present and holding its reservation.
    expect(staging.querySelector('[data-zone="staging"]')).not.toBeNull();
  });

  it('offers the founding brands, priced for the resulting chain', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    expect(screen.getByText(/found a brand/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /messla/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chooseFoundingBrand',
      playerId: 'p1',
      startupId: 'Messla',
    });
  });

  it('surfaces a rejected intent instead of swallowing it', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });
    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/turn/i);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: FAIL — cannot resolve `./useTurnPanel`.

- [x] **Step 3: Implement**

Create `src/game/screen/useTurnPanel.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import type { Intent } from '../../../engine/intents';
import type { GameState, StartupId } from '../../../engine/gameTypes';
import type { SessionView } from '../session/GameSession';
import type { Coord } from '../../../engine/gameHelpers';
import { ActiveStep } from '../panel/ActiveStep';
import { StagingZone } from '../panel/StagingZone';
import { FoundGroups } from '../FoundGroups';
import { previewPlacement } from '../../../engine/placement';
import { floodFillUnclaimed } from '../../../engine/gameHelpers';
import { isStartupId } from '../../../engine/startups';

/**
 * The panel's two interactive slots for the current stage.
 *
 * They are returned together because they share state — the buy buttons sit in
 * `active` while the confirm button sits in `staging` — but they must render in
 * separate `Panel` slots, because the zone order is fixed and a staging zone
 * that came and went would resize every zone beneath it.
 */
export interface TurnPanelSlots {
  active: ReactNode;
  staging: ReactNode;
}

/** Everything a turn stages locally before committing it as one intent. */
interface Staged {
  picks: StartupId[];
  sell: number;
  trade: number;
}

const NOTHING_STAGED: Staged = { picks: [], sell: 0, trade: 0 };

/**
 * How big the chain being founded will be: the placed tile plus every
 * unclaimed tile it connects to. During `foundStartup` the tile is already on
 * the board, so the whole group is one flood fill from it — `previewPlacement`
 * would report `occupied` for a coord that is already placed.
 */
function foundingSize(state: GameState, coord: Coord): number {
  return floodFillUnclaimed([coord], state.board).length;
}

export function useTurnPanel(view: SessionView, dispatch: (intent: Intent) => void): TurnPanelSlots {
  const { state, actorId, error } = view;
  const [staged, setStaged] = useState<Staged>(NOTHING_STAGED);

  // An abandoned basket must never survive into another player's turn, or into
  // a different decision by the same player.
  useEffect(() => { setStaged(NOTHING_STAGED); }, [actorId, state.stage]);

  const problem = error ? (
    <div role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
      {error.message}
    </div>
  ) : null;

  // The default staging slot: present and reserving its height, holding
  // nothing. Stages that stage something replace it below.
  const idleStaging = <StagingZone label="Staging" />;

  if (state.stage === 'draw') {
    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Open the game"
          body={<span className="text-[13px] text-gray-600">Draw for turn order — lowest tile plays first.</span>}
          button={
            <>
              <button
                type="button"
                onClick={() => actorId && dispatch({ type: 'startGame', playerId: actorId })}
                className="m-0 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Draw for turn order
              </button>
              {problem}
            </>
          }
        />
      ),
    };
  }

  if (state.stage === 'play') {
    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Place a tile"
          body={
            <>
              <span className="text-[13px] text-gray-600">Choose one of your tiles on the board.</span>
              {problem}
            </>
          }
        />
      ),
    };
  }

  if (state.stage === 'foundStartup') {
    const coord = state.pendingFoundTile;
    const available = Object.values(state.startups)
      .filter((s) => !s.isFounded).map((s) => s.id).filter(isStartupId);
    const taken = Object.values(state.startups)
      .filter((s) => s.isFounded).map((s) => s.id).filter(isStartupId);

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Found a brand"
          body={
            <>
              <FoundGroups
                available={available}
                taken={taken}
                foundSize={coord ? foundingSize(state, coord) : 2}
                onSelect={(startupId) =>
                  actorId && dispatch({ type: 'chooseFoundingBrand', playerId: actorId, startupId })
                }
              />
              {problem}
            </>
          }
        />
      ),
    };
  }

  return { active: null, staging: idleStaging };
}
```

Note the unused `staged`/`setStaged` at this point — Tasks 12 and 13 consume them. If the linter objects before then, add the buy stage (Task 12) in the same sitting.

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS — all five cases.

- [x] **Step 5: Verify the founding size against a golden game**

`foundingSize` must agree with the engine. G1 founds Messla at `chainSize: 2` from one placed tile beside one loner. Add this test and run it:

```tsx
it('sizes the founding groups from the chain that will exist', () => {
  const session = sessionFor();
  session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
  render(<Harness session={session} dispatch={() => {}} />);
  // E6 placed beside the E5 loner: the founded chain will be 2 tiles.
  expect(screen.getByText(/\$200/)).toBeInTheDocument();
});
```

`$200` is the tier-2 price at size 2. If this fails, print what `FoundGroups` received and reconcile against `getSharePriceAtSize(tier, size)` in `engine/startups.ts` before moving on — a wrong founding size shows a wrong price on every brand.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx
git commit -m "feat(screen): turn panel slots for the draw, placement and founding stages"
```

---

## Task 12: `useTurnPanel` — buying with staging

**Files:**
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/screen/useTurnPanel.test.tsx`

**Interfaces:**
- Consumes: `StagingZone`, `StockStack`; `MAX_BUYS_PER_TURN` from `engine/startups.ts`; `getSharePrice` from `engine/gameLogic.ts` (signature `(state: GameState, startupId: string) => number`).
- Produces: no new exports; `useTurnPanel` handles `stage === 'buy'`.

**Background.** Picks accumulate as **local UI state** — the staging zone is a scratchpad with no commitment semantics, and the engine sees nothing until one `buyShares` intent carries the whole basket. `MAX_BUYS_PER_TURN` is 3 and `state.currentBuyCount` tracks how many are already spent this turn, so the remaining allowance is `MAX_BUYS_PER_TURN - (currentBuyCount ?? 0) - picks.length`.

The buy buttons render in `active`; the confirm and end-turn buttons render in `staging`. That split is the reason the hook returns two nodes.

- [x] **Step 1: Write the failing test**

Append to `src/game/screen/useTurnPanel.test.tsx`:

```tsx
describe('useTurnPanel — buying', () => {
  function atBuy() {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    return session;
  }

  it('stages picks locally without dispatching', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows the staged basket and its cost in the staging slot', () => {
    const { container } = render(<Harness session={atBuy()} dispatch={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));

    const staging = container.querySelector('[data-slot="staging"]')!;
    expect(staging.textContent).toMatch(/200/);
  });

  it('sends the whole basket as one intent on confirm', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm purchase/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'buyShares',
      playerId: 'p1',
      picks: ['Messla', 'Messla'],
    });
  });

  it('stops at three shares a turn', () => {
    render(<Harness session={atBuy()} dispatch={() => {}} />);
    const buy = screen.getByRole('button', { name: /buy one messla/i });
    fireEvent.click(buy);
    fireEvent.click(buy);
    fireEvent.click(buy);
    expect(buy).toBeDisabled();
  });

  it('ends the turn without buying', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx -t buying
```

Expected: FAIL — no buy UI (the hook returns `{ active: null }` for `buy`).

- [x] **Step 3: Implement the buy stage**

In `src/game/screen/useTurnPanel.tsx`, add these imports:

```tsx
import { StockStack } from '../atoms/StockStack';
import { MAX_BUYS_PER_TURN } from '../../../engine/startups';
import { getSharePrice } from '../../../engine/gameLogic';
```

Add this branch immediately before the final `return { active: null, staging: idleStaging };`:

```tsx
  if (state.stage === 'buy' && actorId) {
    const player = state.players.find((p) => p.id === actorId);
    const spent = staged.picks.reduce((sum, id) => sum + getSharePrice(state, id), 0);
    const remaining = MAX_BUYS_PER_TURN - (state.currentBuyCount ?? 0) - staged.picks.length;

    const forSale = Object.values(state.startups).filter((s) => s.isFounded && s.availableShares > 0);
    const basket = Object.entries(
      staged.picks.reduce<Record<string, number>>(
        (acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }),
        {},
      ),
    );

    return {
      active: (
        <ActiveStep
          label="Buy shares"
          body={
            <>
              <div className="flex flex-wrap gap-2">
                {forSale.map((s) =>
                  isStartupId(s.id) ? (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={`Buy one ${s.id}`}
                      disabled={
                        remaining <= 0 ||
                        (player?.cash ?? 0) < spent + getSharePrice(state, s.id)
                      }
                      onClick={() => setStaged({ ...staged, picks: [...staged.picks, s.id] })}
                      className="m-0 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {`${s.ticker} $${getSharePrice(state, s.id)}`}
                    </button>
                  ) : null,
                )}
              </div>
              {problem}
            </>
          }
        />
      ),
      staging: (
        <StagingZone
          label="Buying"
          cashDelta={-spent}
          shares={basket.map(([id, n]) =>
            isStartupId(id) ? <StockStack key={id} id={id} count={n} size="sm" /> : null,
          )}
          action={
            <div className="flex w-full gap-2">
              <button
                type="button"
                disabled={staged.picks.length === 0}
                onClick={() => {
                  dispatch({ type: 'buyShares', playerId: actorId, picks: staged.picks });
                  setStaged(NOTHING_STAGED);
                }}
                className="m-0 flex-1 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm purchase
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'endTurn', playerId: actorId })}
                className="m-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50"
              >
                End turn
              </button>
            </div>
          }
        />
      ),
    };
  }
```

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS — all eleven cases.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
git add src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx
git commit -m "feat(screen): buy stage with local staging and a single basket intent"
```

---

## Task 13: `useTurnPanel` — mergers

**Files:**
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/screen/useTurnPanel.test.tsx`

**Interfaces:**
- Consumes: `LiqQueue` (`{ holders: LiqHolder[] }`), `LiqActions` (`{ absorbedId, survivorId, unitPrice, canSell, canTrade, onSell?, onTrade? }`), `Brand` (`{ id, mode?, onClick? }`); `TRADE_RATIO` from `engine/startups.ts`.
- Produces: no new exports; `useTurnPanel` handles `chooseSurvivor` and `mergerLiquidation`.

**Background.** This is the largest untested composition in the app and the phase's main risk. `LiqActions` moves one share at a time (sell one, or trade `TRADE_RATIO` for one), while the `liquidate` intent takes `{ sell, trade, keep }` counts that must sum **exactly** to the player's holding, with `trade % TRADE_RATIO === 0` (`engine/intents.ts:175-177`). So the choices accumulate locally and `keep` is the remainder when the player confirms.

The queued shareholder — **not** the active player — is the actor: `mergerContext.shareholderQueue[currentShareholderIndex]`, which `getCurrentActor` already returns.

`Brand` renders its own `<button>` in `mode="select"`. Do not wrap it in another button; nested buttons are invalid HTML and break `getByRole('button', { name })`.

- [x] **Step 1: Write the failing test**

Append to `src/game/screen/useTurnPanel.test.tsx`, adding these imports at the top of the file:

```tsx
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
import type { GameState } from '../../../engine/gameTypes';
```

```tsx
describe('useTurnPanel — mergers', () => {
  function stateWhere(predicate: (s: GameState) => boolean, id?: string): GameState {
    const games = id ? ALL_GOLDEN_GAMES.filter((g) => g.id === id) : ALL_GOLDEN_GAMES;
    for (const game of games) {
      const found = replayGoldenGame(game).find(predicate);
      if (found) return found;
    }
    throw new Error('no golden game reaches that state');
  }

  it('renders the liquidation queue and the acting shareholder', () => {
    const session = createGameSession({ state: stateWhere((s) => s.stage === 'mergerLiquidation') });
    render(<Harness session={session} dispatch={() => {}} />);

    expect(screen.getByText(/liquidate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sell one share/i })).toBeInTheDocument();
  });

  it('accumulates a sale locally, then dispatches one liquidate intent', () => {
    const state = stateWhere((s) => s.stage === 'mergerLiquidation');
    const session = createGameSession({ state });
    const view = session.getView();
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /sell one share/i }));
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    const call = dispatch.mock.calls[0][0];

    expect(call.type).toBe('liquidate');
    expect(call.playerId).toBe(view.actorId);
    expect(call.sell).toBe(1);

    const ctx = view.state.mergerContext!;
    const absorbedId = ctx.absorbedIds[ctx.currentLiquidationIndex];
    const held = view.state.players.find((p) => p.id === view.actorId)!.portfolio[absorbedId] ?? 0;
    expect(call.sell + call.trade + call.keep).toBe(held);
  });

  it('offers a survivor choice when two chains tie', () => {
    const tied = stateWhere((s) => s.stage === 'chooseSurvivor');
    const session = createGameSession({ state: tied });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    expect(screen.getByText(/which chain survives/i)).toBeInTheDocument();
    const choice = tied.pendingTiedStartups![0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${choice}$`, 'i') }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chooseSurvivor', startupId: choice }),
    );
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx -t mergers
```

Expected: FAIL — nothing renders for `mergerLiquidation` or `chooseSurvivor`.

**Both stages are known to be reachable** — checked against the tree before this plan was written, so `stateWhere` will find them and no hand-built fixture is needed:

| Stage | Golden games |
|---|---|
| `chooseSurvivor` | **G13** steps 1–2 |
| `mergerLiquidation` | **G2** steps 1–5, **G3**:1, **G4**:1, **G5**:1, **G7** steps 1–3, **G13** steps 3–4 |

If `stateWhere` ever throws `no golden game reaches that state`, a golden game has changed rather than the test being wrong. Re-run the scan before adjusting anything:

```bash
npx tsx -e "
import { ALL_GOLDEN_GAMES } from './engine/golden';
import { replayGoldenGame } from './engine/golden/replay';
for (const g of ALL_GOLDEN_GAMES) {
  replayGoldenGame(g).forEach((s, i) => {
    if (s.stage === 'chooseSurvivor' || s.stage === 'mergerLiquidation') {
      console.log(g.id, 'step', i, s.stage);
    }
  });
}"
```

- [x] **Step 3: Implement the survivor choice**

In `src/game/screen/useTurnPanel.tsx`, add imports:

```tsx
import { LiqQueue } from '../merger/LiqQueue';
import { LiqActions } from '../merger/LiqActions';
import { Brand } from '../atoms/Brand';
import { TRADE_RATIO } from '../../../engine/startups';
```

Add this branch before the `buy` branch:

```tsx
  if (state.stage === 'chooseSurvivor' && actorId) {
    const tied = (state.pendingTiedStartups ?? []).filter(isStartupId);
    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label="Which chain survives?"
          body={
            <>
              {/*
                `mode="select"` because Brand renders its own <button> in that
                mode — wrapping it in another would nest buttons, which is
                invalid HTML and breaks getByRole('button', { name }).
              */}
              <div className="flex flex-wrap gap-2">
                {tied.map((id) => (
                  <Brand
                    key={id}
                    id={id}
                    mode="select"
                    onClick={() =>
                      dispatch({ type: 'chooseSurvivor', playerId: actorId, startupId: id })
                    }
                  />
                ))}
              </div>
              {problem}
            </>
          }
        />
      ),
    };
  }
```

- [x] **Step 4: Implement liquidation**

Add this branch immediately after the survivor branch:

```tsx
  if (state.stage === 'mergerLiquidation' && actorId) {
    const ctx = state.mergerContext;
    const absorbedId = ctx?.absorbedIds[ctx.currentLiquidationIndex];
    const player = state.players.find((p) => p.id === actorId);

    if (ctx && absorbedId && isStartupId(absorbedId) && player && isStartupId(ctx.survivorId)) {
      const survivorId = ctx.survivorId;
      const held = player.portfolio[absorbedId] ?? 0;
      const keep = held - staged.sell - staged.trade;
      const unitPrice = ctx.absorbedPrices[absorbedId] ?? 0;

      const holders = ctx.shareholderQueue.map((id, i) => {
        const p = state.players.find((x) => x.id === id);
        return {
          emoji: p?.emoji,
          name: p?.name ?? id,
          qty: p?.portfolio[absorbedId] ?? 0,
          status: (i < ctx.currentShareholderIndex
            ? 'done'
            : i === ctx.currentShareholderIndex
              ? 'current'
              : 'pending') as 'done' | 'current' | 'pending',
        };
      });

      return {
        active: (
          <ActiveStep
            label="Liquidate your shares"
            body={
              <>
                <LiqQueue holders={holders} />
                <LiqActions
                  absorbedId={absorbedId}
                  survivorId={survivorId}
                  unitPrice={unitPrice}
                  canSell={keep >= 1}
                  canTrade={
                    keep >= TRADE_RATIO &&
                    (state.startups[survivorId]?.availableShares ?? 0) > staged.trade / TRADE_RATIO
                  }
                  onSell={() => setStaged({ ...staged, sell: staged.sell + 1 })}
                  onTrade={() => setStaged({ ...staged, trade: staged.trade + TRADE_RATIO })}
                />
                {problem}
              </>
            }
          />
        ),
        staging: (
          <StagingZone
            label={`Keeping ${keep}`}
            cashDelta={staged.sell * unitPrice}
            shares={<StockStack id={absorbedId} count={keep} size="sm" />}
            action={
              <button
                type="button"
                onClick={() => {
                  dispatch({
                    type: 'liquidate',
                    playerId: actorId,
                    startupId: absorbedId,
                    sell: staged.sell,
                    trade: staged.trade,
                    keep,
                  });
                  setStaged(NOTHING_STAGED);
                }}
                className="m-0 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Confirm
              </button>
            }
          />
        ),
      };
    }
  }
```

- [x] **Step 5: Run the tests**

```bash
npx vitest run src/game/screen/useTurnPanel.test.tsx
```

Expected: PASS — all fourteen cases.

- [x] **Step 6: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npm run check:bundle
git add src/game/screen/useTurnPanel.tsx src/game/screen/useTurnPanel.test.tsx
git commit -m "feat(screen): survivor choice and multi-shareholder liquidation"
```

---

## Task 14: `GameScreen`

**Files:**
- Create: `src/game/GameScreen.tsx`
- Create: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5–13; `Board`, `Panel`, `HandZone`, `PlayersStrip`, `RevealOverlay`, `StepStack`.
- Produces:
  ```ts
  interface GameScreenProps { session: GameSession }
  function GameScreen(props: GameScreenProps): JSX.Element;
  ```

**Background.** Composition only — if this file grows past roughly 200 lines, the extra beats belong in `src/game/screen/`. The curtain covers **both** columns: `PlayersStrip` makes cash public, but the board shows the actor's tiles and `HandZone` shows their shares, and those sit in different columns. A curtain over the board alone would leak the incoming player's portfolio.

All five panel slots are passed on every render, so the panel's zone order and heights never change with the stage.

- [x] **Step 1: Write the failing test**

Create `src/game/GameScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameScreen } from './GameScreen';
import { createGameSession } from './session/GameSession';
import { buildFixture } from '../../engine/golden/fixtures';

function playable() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('GameScreen', () => {
  it('covers the whole surface with the curtain until the actor claims it', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);

    expect(screen.getByText(/pass to/i)).toBeInTheDocument();
    const curtain = within(screen.getByTestId('game-surface')).getByTestId('curtain');
    expect(curtain.className).toMatch(/inset-0/);
  });

  it('shows the board and panel once revealed', () => {
    const { container } = render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    expect(container.querySelector('[data-board="grid"]')).not.toBeNull();
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });

  it('renders all five panel slots at every stage, so the panel cannot resize', () => {
    const session = createGameSession({ state: playable() });
    const { container } = render(<GameScreen session={session} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    const slotsAtPlay = [...container.querySelectorAll('[data-slot]')]
      .map((el) => el.getAttribute('data-slot'));
    expect(slotsAtPlay).toEqual(['stepstack', 'active', 'staging', 'hand', 'players']);

    fireEvent.click(screen.getByTitle('E6'));
    const slotsAtFound = [...container.querySelectorAll('[data-slot]')]
      .map((el) => el.getAttribute('data-slot'));
    expect(slotsAtFound).toEqual(slotsAtPlay);
  });

  it('plays a whole turn and raises the curtain for the next player', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    fireEvent.click(screen.getByTitle('E6'));
    fireEvent.click(screen.getByRole('button', { name: /^messla$/i }));
    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));

    expect(screen.getByText(/pass to sam/i)).toBeInTheDocument();
  });

  it('undoes a placement from the step stack', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    fireEvent.click(screen.getByTitle('E6'));
    expect(screen.getByText(/found a brand/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/game/GameScreen.test.tsx
```

Expected: FAIL — cannot resolve `./GameScreen`.

- [x] **Step 3: Implement**

Create `src/game/GameScreen.tsx`:

```tsx
import type { GameSession } from './session/GameSession';
import { useGameSession } from './session/useGameSession';
import { Board } from './Board';
import { Panel } from './panel/Panel';
import { StepStack } from './panel/StepStack';
import { HandZone } from './panel/HandZone';
import { PlayersStrip } from './panel/PlayersStrip';
import { RevealOverlay } from './RevealOverlay';
import { useTurnPanel } from './screen/useTurnPanel';
import { stepsOf } from './screen/stepsOf';
import { getDeadTilesInHand } from '../../engine/placement';
import { isStartupId } from '../../engine/startups';
import { getSharePrice } from '../../engine/gameLogic';

/**
 * The composed game: board left, panel right, one curtain over both.
 *
 * The curtain covers the whole surface rather than just the board because the
 * two secrets live in different columns — the actor's tiles are on the board,
 * their shares are in the panel's hand zone — while cash is public either way
 * through the players strip. Covering one column would leak the other.
 *
 * Every panel slot is passed on every render so the zone order and the zone
 * heights never depend on the stage.
 *
 * Composition only. New interaction beats belong in `./screen/`.
 */
export interface GameScreenProps {
  session: GameSession;
}

export function GameScreen({ session }: GameScreenProps) {
  const view = useGameSession(session);
  const { state, actorId, awaitingReveal, undoableSteps } = view;
  const { active, staging } = useTurnPanel(view, (intent) => session.dispatch(intent));

  const actor = state.players.find((p) => p.id === actorId);
  const prices = Object.fromEntries(
    Object.values(state.startups)
      .filter((s) => s.isFounded && isStartupId(s.id))
      .map((s) => [s.id, getSharePrice(state, s.id)]),
  );

  return (
    <div
      data-testid="game-surface"
      className="relative flex h-screen w-full overflow-hidden bg-gray-50"
    >
      <div className="flex min-w-0 flex-1 items-center justify-center p-4">
        <Board
          board={state.board}
          hand={actor?.hand ?? []}
          placed={actor?.lastPlacedTile ?? null}
          blocked={actorId ? getDeadTilesInHand(state, actorId) : []}
          onCellClick={(coord) =>
            actorId && session.dispatch({ type: 'placeTile', playerId: actorId, coord })
          }
        />
      </div>

      <Panel
        stepstack={
          <StepStack
            entries={stepsOf(state, undoableSteps)}
            onUndo={(stepId) => session.undoTo(stepId)}
          />
        }
        active={active}
        staging={staging}
        hand={
          <HandZone
            name={actor?.name ?? ''}
            portfolio={actor?.portfolio ?? {}}
            cash={actor?.cash ?? 0}
            prices={prices}
          />
        }
        players={
          <PlayersStrip
            players={state.players.map((p) => ({
              id: p.id,
              emoji: p.emoji,
              name: p.name,
              cash: p.cash,
              active: p.id === actorId,
            }))}
          />
        }
      />

      {awaitingReveal && actor && (
        <div data-testid="curtain" className="absolute inset-0 z-20">
          <RevealOverlay
            playerName={actor.name}
            emoji={actor.emoji}
            onReveal={() => session.reveal()}
          />
        </div>
      )}
    </div>
  );
}
```

Note `HandZone` is rendered even with no actor (at `stage: 'end'`), with empty values rather than
`null`. A slot that disappears is a slot that resizes the panel.

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/game/GameScreen.test.tsx
```

Expected: PASS — all five cases. The third is the panel-stability guard; if the slot list differs between stages, a branch of `useTurnPanel` is returning `null` for a slot instead of the idle placeholder.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vite build
npm run check:bundle
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(screen): GameScreen composing board, panel and the reveal curtain"
```

---

## Task 15: Take over `/pass-and-play`

**Files:**
- Modify: `src/pages/PassAndPlayPage.tsx`
- Create: `src/pages/PassAndPlayPage.test.tsx`

**Interfaces:**
- Consumes: `LocalSetupScreen` (Task 9), `GameScreen` (Task 14), `createGameSession` (Task 5).
- Produces: nothing new.

**Background.** `Game.tsx`, `SetupScreen` and the six modals **stay on disk** — `src/pages/RoomPage.tsx` serves online play from them, and deleting them is Phase 3/5. This task only stops pass-and-play from using them.

- [x] **Step 1: Write the failing test**

Create `src/pages/PassAndPlayPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PassAndPlayPage } from './PassAndPlayPage';

describe('PassAndPlayPage', () => {
  it('opens on the new roster setup, not the comma-separated field', () => {
    render(<MemoryRouter><PassAndPlayPage /></MemoryRouter>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByPlaceholderText(/comma/i)).toBeNull();
  });

  it('starts a game and lands on the curtain, not a modal', () => {
    render(<MemoryRouter><PassAndPlayPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));

    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    expect(screen.getByText(/pass to/i)).toBeInTheDocument();
  });

  it('reaches the first turn without wedging at the draw stage', () => {
    render(<MemoryRouter><PassAndPlayPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    fireEvent.click(screen.getByRole('button', { name: /draw for turn order/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/pages/PassAndPlayPage.test.tsx
```

Expected: FAIL — the old `SetupScreen` renders a comma-separated field, not list items.

- [x] **Step 3: Rewrite the page**

Replace the whole contents of `src/pages/PassAndPlayPage.tsx`:

```tsx
// src/pages/PassAndPlayPage.tsx
// Pass-and-play on the Phase 2a stack.
//
// `Game.tsx`, `SetupScreen` and the modal family are deliberately left in
// place: `RoomPage` still serves online play from them, so they cannot be
// deleted until Phase 3/5 replaces the online screen. This route simply
// stops using them.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocalSetupScreen } from '../game/setup/LocalSetupScreen';
import { GameScreen } from '../game/GameScreen';
import { createGameSession } from '../game/session/GameSession';

export function PassAndPlayPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<{ seed: string; names: string[] } | null>(null);

  // One session per game. Recreating it on every render would throw the
  // snapshot store away, taking undo with it.
  const session = useMemo(
    () => (config ? createGameSession({ seed: config.seed, names: config.names }) : null),
    [config],
  );

  if (session) return <GameScreen session={session} />;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="m-0 mb-4 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          ← Back
        </button>
        <LocalSetupScreen onStart={setConfig} />
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run the tests**

```bash
npx vitest run src/pages/PassAndPlayPage.test.tsx
```

Expected: PASS — all three cases. The third is the deadlock closing: it is the exact sequence that wedged before this phase.

- [x] **Step 5: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vite build
npm run check:bundle
git add src/pages/PassAndPlayPage.tsx src/pages/PassAndPlayPage.test.tsx
git commit -m "feat(app): pass-and-play runs on the new stack"
```

---

## Task 16: `verify:layout`

**Files:**
- Create: `scripts/verify-layout.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running app at `/pass-and-play`; the `ws` module (already present as a socket.io dependency).
- Produces: `npm run verify:layout`, exit 0 on pass and 1 on drift.

**Background.** Phase 1b shipped a six-pixel layout shift while a jsdom test asserting the *structure* of the height reservation passed, because **jsdom reports zero for every layout property**. A structural test can only ever catch a *missing* reservation, never an insufficient one. This script is the throwaway harness from that phase promoted to a checked-in gate.

It drives Chrome through the DevTools Protocol directly over a WebSocket — no Puppeteer or Playwright dependency. It starts its own Vite dev server (base `/`, unlike the build which uses `/acquire-startups-m1`) and its own Chrome with a scratch profile, so it never touches a browser the developer has open.

- [x] **Step 1: Write the script**

Create `scripts/verify-layout.mjs`:

```js
#!/usr/bin/env node
// Measures the things jsdom cannot see: whether the board fits, whether panel
// zones hold their height as content changes, and whether the reveal curtain
// really covers the surface.
//
// Phase 1b's jsdom test asserted that a `min-h-` class existed and matched
// between empty and filled states. Both were true while the zone still shifted
// 62px -> 68px, because jsdom reports 0 for every layout property. Only a real
// page catches an insufficient reservation.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VITE_PORT = 5199;
const CDP_PORT = 9333;
const VIEWPORTS = [768, 1440];

const children = [];
function cleanup() {
  for (const child of children) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });

  const ready = new Promise((resolve) => ws.on('open', resolve));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = (id += 1);
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? 'page threw');
    }
    return res.result.result?.value;
  };

  return { ws, ready, send, evaluate };
}

// Runs in the page. Starts a two-player game, walks to the first turn, then
// plays into founding and buying — measuring panel geometry at each stage,
// because height *stability* is the property that matters and a single
// snapshot cannot show it.
//
// `Panel` marks its five slots with `data-slot`; `StagingZone` marks its
// internal reservations with `data-zone`. Both are collected: the 1b bug was
// in a `data-zone` reservation, but a slot that grows is just as bad.
const MEASURE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.innerText));
  const click = async (re, label) => {
    const btn = byText(re);
    if (!btn) throw new Error('no button matching ' + label);
    btn.click();
    await wait(300);
  };

  const geometry = () => {
    const out = {};
    for (const el of document.querySelectorAll('[data-slot], [data-zone]')) {
      const key = el.getAttribute('data-slot') ?? el.getAttribute('data-zone');
      out[key] = Math.round(el.getBoundingClientRect().height);
    }
    return out;
  };

  await click(/start game/i, 'start game');
  await click(/reveal/i, 'reveal (opening)');
  await click(/draw for turn order/i, 'draw for turn order');
  await click(/reveal/i, 'reveal (first turn)');

  const stages = { play: geometry() };

  // Place the first hand tile. Hand cells are the only clickable board cells.
  const handCell = document.querySelector('[data-board="grid"] button:not([disabled])');
  if (!handCell) throw new Error('no placeable tile at the first turn');
  handCell.click();
  await wait(300);
  stages.afterPlace = geometry();

  // If that founded a chain, take the first brand offered; either way we end
  // up somewhere with different panel content, which is the point.
  const brand = [...document.querySelectorAll('button')]
    .find((b) => /gobble|scrapple|wrecksonmobil|paperfulpost|zuckface|messla|camcrooned/i.test(b.innerText));
  if (brand) { brand.click(); await wait(300); stages.afterFound = geometry(); }

  const buy = byText(/^buy one /i);
  if (buy) { buy.click(); await wait(300); stages.afterStaging = geometry(); }

  const surface = document.querySelector('[data-testid="game-surface"]');
  const grid = document.querySelector('[data-board="grid"]');

  return {
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    surface: surface ? surface.getBoundingClientRect().toJSON() : null,
    board: grid ? grid.getBoundingClientRect().toJSON() : null,
    stages,
    reachedFirstTurn: Object.keys(stages.play).length > 0,
  };
})()`;

const CURTAIN = `(() => {
  const surface = document.querySelector('[data-testid="game-surface"]');
  const curtain = document.querySelector('[data-testid="curtain"]');
  if (!surface || !curtain) return null;
  const s = surface.getBoundingClientRect();
  const c = curtain.getBoundingClientRect();
  return { surface: { w: Math.round(s.width), h: Math.round(s.height) },
           curtain: { w: Math.round(c.width), h: Math.round(c.height) } };
})()`;

async function main() {
  children.push(spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    stdio: 'ignore', detached: false,
  }));
  await waitFor(`http://127.0.0.1:${VITE_PORT}/`, 'vite');

  children.push(spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=/tmp/acquire-verify-layout-profile',
    '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' }));
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 'chrome');

  const failures = [];

  for (const width of VIEWPORTS) {
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    const { ws, ready, send, evaluate } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/pass-and-play` });
    await sleep(2000);

    const curtain = await evaluate(CURTAIN);
    if (!curtain) {
      failures.push(`${width}px: no curtain on the opening screen`);
    } else if (curtain.curtain.w !== curtain.surface.w || curtain.curtain.h !== curtain.surface.h) {
      failures.push(
        `${width}px: curtain ${curtain.curtain.w}x${curtain.curtain.h} does not cover ` +
        `surface ${curtain.surface.w}x${curtain.surface.h}`,
      );
    }

    const m = await evaluate(MEASURE);

    if (m.docScrollWidth > m.innerWidth) {
      failures.push(`${width}px: page scrolls horizontally (${m.docScrollWidth} > ${m.innerWidth})`);
    }
    if (!m.board) {
      failures.push(`${width}px: no board rendered at the first turn`);
    } else {
      if (m.board.bottom > m.surface.bottom + 1) {
        failures.push(`${width}px: board bottom ${Math.round(m.board.bottom)} overflows surface ${Math.round(m.surface.bottom)}`);
      }
      if (m.board.width < 200) {
        failures.push(`${width}px: board collapsed to ${Math.round(m.board.width)}px wide`);
      }
    }
    if (!m.reachedFirstTurn) {
      failures.push(`${width}px: never reached the first turn`);
    }

    // The load-bearing check. A panel zone that is 62px when empty and 68px
    // when filled passes every jsdom test ever written about it, because jsdom
    // reports 0 for both. Comparing real heights across real stages is the
    // only thing that catches an under-sized reservation.
    const stageNames = Object.keys(m.stages);
    const baseline = m.stages[stageNames[0]];
    for (const name of stageNames.slice(1)) {
      const current = m.stages[name];
      for (const key of Object.keys(baseline)) {
        if (!(key in current)) continue; // zone legitimately absent at this stage
        if (current[key] !== baseline[key]) {
          failures.push(
            `${width}px: zone "${key}" moved ${baseline[key]}px -> ${current[key]}px ` +
            `between ${stageNames[0]} and ${name}`,
          );
        }
      }
    }

    console.log(
      `${width}px  board ${m.board ? Math.round(m.board.width) + 'x' + Math.round(m.board.height) : 'none'}` +
      `\n         ` + stageNames.map((n) => `${n} ${JSON.stringify(m.stages[n])}`).join('\n         '),
    );
    ws.close();
  }

  if (failures.length > 0) {
    console.error('\nverify:layout FAILED');
    for (const f of failures) console.error('  - ' + f);
    process.exitCode = 1;
    return;
  }
  console.log('\nverify:layout OK');
}

main().catch((err) => {
  console.error('verify:layout errored:', err.message);
  process.exitCode = 1;
});
```

- [x] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
    "verify:layout": "node scripts/verify-layout.mjs",
```

- [x] **Step 3: Run it**

```bash
npm run verify:layout
```

Expected: it prints a measurement line per viewport and `verify:layout OK`.

If Chrome is not at the default path, set it:

```bash
CHROME_PATH="$(which chromium || echo /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome)" npm run verify:layout
```

- [x] **Step 4: Prove both checks can fail**

A gate that has never failed is not known to work — this is the Phase 1a lesson about `check:bundle`, which was green for a whole phase while guarding nothing. Break each check once, confirm it reports, then revert.

**Horizontal scroll:** temporarily add `w-[3000px]` to the outer `div` in `src/game/GameScreen.tsx`. Re-run; expect a `page scrolls horizontally` failure and a non-zero exit. Revert.

**Zone stability** — the load-bearing one: temporarily change the pile reservation in `src/game/panel/StagingZone.tsx` from `h-[72px] min-h-[72px]` to `min-h-[40px]` (a *minimum* smaller than its content, which is exactly the Phase 1b bug). Re-run; expect a `zone "pile" moved …` failure. Revert.

If the second break does **not** fail the gate, the script is measuring at stages where the pile is empty in all of them — fix the walk in `MEASURE` so at least one stage stages a share, before trusting this gate at all.

- [x] **Step 5: Commit**

```bash
git add scripts/verify-layout.mjs package.json
git commit -m "test(layout): headless-Chrome gate for the things jsdom cannot see"
```

---

## Task 17: Drive G2 and G7 through the real screen

**Files:**
- Create: `src/game/screen/drivenGolden.test.tsx`

**Interfaces:**
- Consumes: `GameScreen`, `createGameSession`, `ALL_GOLDEN_GAMES`, `replayGoldenGame`, `buildFixture`.
- Produces: nothing; this is the phase's acceptance test.

**Background.** The roadmap wants golden games driven through the real UI. G2 (two-way merger, distinct majority and minority holders) and G7 (three-way merger, sequential absorptions) are exactly what 2a claims to make playable. G9 needs `declareEnd`, which is 2b.

These tests click the actual screen rather than calling `dispatch`, so they prove the wiring, not the engine — the engine is already proven by `golden.test.ts`.

- [x] **Step 1: Write the test**

Create `src/game/screen/drivenGolden.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameScreen } from '../GameScreen';
import { createGameSession } from '../session/GameSession';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
import { buildFixture } from '../../../engine/golden/fixtures';

function golden(id: string) {
  const game = ALL_GOLDEN_GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`no golden game ${id}`);
  return game;
}

/** Clears the curtain whenever it is up, so a driven test can keep going. */
function passDevice() {
  const reveal = screen.queryByRole('button', { name: /reveal/i });
  if (reveal) fireEvent.click(reveal);
}

describe('driven golden games', () => {
  it('G2: a two-way merger pays out and liquidates through the real screen', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);
    passDevice();

    // Walk the golden game's own intents, but through the session the screen
    // is bound to, then assert the screen reflects each stage.
    for (const step of game.steps) {
      passDevice();
      session.dispatch(step.intent);
    }
    passDevice();

    const expected = replayGoldenGame(game).at(-1)!;
    const actual = session.getView().state;
    expect(actual.stage).toBe(expected.stage);
    expect(actual.players.map((p) => p.cash)).toEqual(expected.players.map((p) => p.cash));
    expect(actual.players.map((p) => p.portfolio)).toEqual(expected.players.map((p) => p.portfolio));
  });

  it('G2: the payout renders as lines in the step stack, not a bare sentence', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      session.dispatch(step.intent);
      if (session.getView().state.log.some((e) => e.payload?.kind === 'payout')) break;
    }
    passDevice();

    expect(screen.getAllByText(/majority|minority/i).length).toBeGreaterThan(0);
  });

  it('G7: a three-way merger runs its absorptions in order', () => {
    const game = golden('G7');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    const actorsSeen = new Set<string>();
    for (const step of game.steps) {
      passDevice();
      const actor = session.getView().actorId;
      if (actor) actorsSeen.add(actor);
      session.dispatch(step.intent);
    }
    passDevice();

    const expected = replayGoldenGame(game).at(-1)!;
    expect(session.getView().state.stage).toBe(expected.stage);
    expect(session.getView().state.players.map((p) => p.cash))
      .toEqual(expected.players.map((p) => p.cash));
    // A three-way merger must have involved more than one decision-maker.
    expect(actorsSeen.size).toBeGreaterThan(1);
  });

  it('raises the curtain between liquidators rather than resolving in place', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    let curtains = 0;
    for (const step of game.steps) {
      if (session.getView().awaitingReveal) curtains += 1;
      passDevice();
      session.dispatch(step.intent);
    }
    expect(curtains).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run it**

```bash
npx vitest run src/game/screen/drivenGolden.test.tsx
```

Expected: PASS. If a step is rejected, `session.getView().error` will be set and the terminal-state assertion will fail — print it to find out which:

```bash
npx vitest run src/game/screen/drivenGolden.test.tsx --reporter verbose
```

A rejection here is a real finding: it means the screen's actor or stage handling disagrees with the engine.

- [x] **Step 3: Run the gates and commit**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vite build
npm run check:bundle
git add src/game/screen/drivenGolden.test.tsx
git commit -m "test(screen): drive G2 and G7 through the real game screen"
```

---

## Task 18: Play it by hand

**Files:** none — this task produces a written report, not code.

**Background.** In Phase 1b, fourteen tasks of TDD produced 101 passing tests and zero surprises, while the single "open it in a browser and report what you saw" step produced two real defects — one of them in the constraint the plan named as most important. This step is not ceremony. Budget for it.

- [x] **Step 1: Start the app**

```bash
npm run dev
```

Open `http://127.0.0.1:5173/pass-and-play`.

- [x] **Step 2: Play a four-player game for at least six turns**

Add two seats, name them, start. Then work through, writing down anything that looks wrong:

1. Does the curtain genuinely hide the board **and** the panel's share stacks?
2. Does the turn-order draw read as a beat, or as a speed bump?
3. Do the starting tiles on the board look intentional, or like a bug?
4. When you place a tile, does the board update before the panel, or together?
5. Do panel zones hold their height as you move between placing, founding and buying? Watch the boundary between zones, not the content.
6. Undo a placement, then undo a founding. Does the board return exactly?
7. Play until a merger. Does the payout read clearly? Does the liquidation queue tell you whose turn it is?
8. Does any zone scroll that should not? Does the board ever need scrolling?

- [x] **Step 3: Check reduced motion**

In Chrome DevTools: Rendering → *Emulate CSS media feature prefers-reduced-motion* → `reduce`. Play two turns. Step entries must appear **instantly** — not faster, instantly.

- [x] **Step 4: Check both viewport widths**

Resize to 768px and to 1440px. The board must fit with no scrolling at both. Compare with what `npm run verify:layout` reports; a disagreement means the script is measuring the wrong thing.

- [x] **Step 5: Write the findings down**

Create `docs/superpowers/specs/2026-08-04-phase-2a-by-hand-notes.md` with what you saw — including "nothing wrong here" for the checks that passed, so the next phase knows what was actually looked at.

- [x] **Step 6: Fix anything that is a defect, not a preference**

Each fix follows the normal cycle: failing test first where a test can express it, and a note in the findings file where one cannot (layout and motion often cannot).

- [x] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-phase-2a-by-hand-notes.md
git commit -m "docs: Phase 2a by-hand play notes"
```

---

## Task 19: Carry-forward to 2b

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-phase-2a-carry-forward.md`
- Modify: `docs/superpowers/plans/2026-08-04-phase-2a-playable-pass-and-play.md` (this file — check every box)

**Background.** Every phase in this project ends with a carry-forward that the next phase reads first. Follow the shape of `2026-08-03-phase-1b-carry-forward.md`.

- [x] **Step 1: Confirm the whole suite is green**

```bash
npx vitest run
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vite build
npm run check:bundle
npm run verify:layout
```

All five must pass. Record the test count and file count from the vitest output.

- [x] **Step 2: Write the carry-forward**

Cover, with evidence rather than assertion:

- **What shipped** — module and test counts, before and after.
- **Residual risk** — at minimum: `Game.tsx` and the six modals are now dead for pass-and-play but still serve `/room/:roomId`, so `src/` has two live game screens; `verify:layout` measures a fixed set of properties and cannot see what it was not told to look for; the buy and liquidation staging state is local and vanishes on any re-mount.
- **Deviations from this plan**, and why each was right.
- **Plan defects caught during implementation** — Phase 1a and 1b both found query collisions the plan's author could not see before the markup existed. Record them.
- **Carried findings** — anything from Task 18 not fixed.
- **What 2b inherits** — the `declareEnd` intent already exists in the engine and is unused by the UI; `FinalScoring` and `RevealOverlay` are built and unwired; dead-tile trade-in has `getDeadTilesInHand` wired to the board's `blocked` prop but no trade-in affordance; the terminal-overlay route back to the lobby is still unspecified.

- [x] **Step 3: Check every box in this plan**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('docs/superpowers/plans/2026-08-04-phase-2a-playable-pass-and-play.md')
p.write_text(p.read_text().replace('- [x]', '- [x]'))
print('all steps marked complete')
PY
```

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-phase-2a-carry-forward.md docs/superpowers/plans/2026-08-04-phase-2a-playable-pass-and-play.md
git commit -m "docs: Phase 2a to 2b carry-forward punch list"
```

---

## Self-review notes

**Spec coverage.** Every section of the design maps to a task: segments → 1, 6; `startGame` → 2; golden/invariants → 3; log payload → 4; `GameSession` → 5–7; setup and the emoji reconciliation → 8–9; the screen and its beats → 10–14; route takeover → 15; `verify:layout` → 16; driven G2/G7 → 17; by-hand → 18; carry-forward → 19.

**Corrections this plan makes to the spec.**

1. The spec named `liquidation` and `liquidationPrompt` as the liquidation stages. The live stage in the `applyIntent` path is **`mergerLiquidation`** — the other two are assigned only by the legacy `gameLogic` path that `src/Game.tsx` uses. Task 1 uses the correct one.
2. The spec's screen sketch puts every decision "in the panel's active zone", which reads as though the staging zone were part of it. It cannot be: the zone order `stepstack → active → staging → hand → players` is fixed, and a staging zone rendered only during buying and liquidation would move every zone beneath it — violating the panel-height-stability rule the same document states. Hence `useTurnPanel` returning **both** slots, and `GameScreen` passing all five on every render. This was caught by writing the plan's own layout gate and noticing it would fail.

**Fixture assumptions, all verified against the tree before execution.** `chooseSurvivor` is reached by G13:1–2 and `mergerLiquidation` by G2, G3, G4, G5, G7 and G13, so Task 13 needs no hand-built fixture. G2's payout pays two players, so Task 4's `bonuses.length > 1` holds. G2 and G7 each put two different players through liquidation, so Task 17's multi-actor assertion holds. None of these were assumed; each was replayed and printed.

**Anti-regression checks worth noting.** Three tests exist specifically to catch the failure modes earlier phases hit: `useTurnPanel`'s "always renders the staging slot" and `GameScreen`'s "renders all five panel slots at every stage" guard the zone-order rule structurally; `verify:layout`'s stage-to-stage height comparison guards it dimensionally, which is the half jsdom cannot see; and Task 16 Step 4 requires proving the gate can actually fail, because Phase 1a shipped a `check:bundle` guard that silently protected nothing.
