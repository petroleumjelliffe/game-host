# Phase 0 — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the rules engine out of `src/` into a standalone `engine/` package, give it a single `applyIntent(state, intent)` reducer, fix the two known bonus bugs, add dead tiles, end-game detection and final scoring, and pin all of it with a data-driven golden-game suite (G1–G12).

**Architecture:** `engine/` becomes a UI-free, server-free TypeScript module owning types, helpers, init, rules and intents. `applyIntent` is a *thin* reducer: it `structuredClone`s the state, validates the intent against the current `stage`, delegates to the existing (mutating) rules functions, and returns the new state. The existing modal-era functions and their 8 tests stay in place as a regression net for the whole of Phase 0 — Phase 2 deletes them. Golden games are **data**: a setup fixture plus an ordered list of intents plus assertions, run by one shared runner, so the same files later feed the Phase 1 catalog and Phase 3 protocol debugging.

**Tech Stack:** TypeScript, vitest 4 (the *only* verification gate — see Global Constraints), tsx for the server, Vite 4 for the client.

## Global Constraints

- **There is no `tsconfig.json` in this repo, therefore no typecheck gate.** `tsconfig.server.json` extends a nonexistent `./tsconfig.json`. Do not add one in Phase 0, and do not write a plan step that runs `tsc`. Verification is `npx vitest run` and nothing else.
- **Baseline that must never go red:** `npx vitest run` currently reports **8 passed** (`src/state/gameLogic.test.ts`). Every task ends with the full suite green.
- **`gameLogic.ts` mutates state in place.** The roadmap spec's claim that it is "already pure and immutable" is inaccurate. Do not rewrite it to be pure in Phase 0. Purity is achieved at the `applyIntent` boundary by cloning first.
- **Imports inside `engine/` are extensionless** (`from './gameHelpers'`). Imports *into* `engine/` from `server/` use the `.js` extension (`from '../engine/gameLogic.js'`) because the server is NodeNext. This split is what the codebase does today and it works under both tsx and Vite.
- **Share price thresholds:** `[2, 3, 4, 5, 6, 11, 21, 31, 41]`. **Safe chain:** size ≥ 11. **Game-end size:** 41. **Starting cash:** 6000. **Shares per startup:** 25. **Hand size:** 6. **Board:** 9 rows `A`–`I` × 12 columns, coords `A1`–`I12`.
- **Bonus rates:** majority = `price × 10`, minority = `price × 5`.
- **Tied bonuses round UP to the nearest $100** — `Math.ceil(total / n / 100) * 100`. This matches `prototype/index.html:237` and was explicitly chosen by the user. It **changes** today's tied-majority payout: two holders of a $300 chain now get **$2,300 each**, not $2,250. G4 locks the new number.
- **Sole holder takes majority + minority combined** (`price × 15`) as a single `both` bonus. This is the standard rule and is what `docs/superpowers/specs/2026-07-30-final-scoring-overlay-design.md` specifies.
- **`finalScore` does not bank bonuses into cash.** It returns a report; it does not mutate cash.
- **Startup roster is fixed** at 7: `Gobble` (tier 2), `Scrapple` (2), `PaperfulPost` (0), `CamCrooned` (1), `Messla` (0), `ZuckFace` (1), `WrecksonMobil` (1). Tickers come from `prototype/components.js` and are authoritative: `$G`, `$S`, `$PP`, `$C`, `$M`, `$Z`, `$W`.
- **Commit after every task.** Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).

---

## File Structure

**Moved verbatim in Task 1 (no behaviour change):**

| From | To | Responsibility |
|---|---|---|
| `src/state/gameTypes.ts` | `engine/gameTypes.ts` | All engine types |
| `src/state/gameInit.ts` | `engine/gameInit.ts` | `createInitialGame`, `createEmptyBoard` |
| `src/state/gameLogic.ts` | `engine/gameLogic.ts` | Rules (mutating internals + legacy modal-era API) |
| `src/state/gameLogic.test.ts` | `engine/gameLogic.test.ts` | The 8-test regression net |
| `src/utils/gameHelpers.ts` | `engine/gameHelpers.ts` | Coords, adjacency, flood fill, seeded shuffle |
| `src/test/testHelpers.ts` | `engine/testHelpers.ts` | Test fixture builders |

**Created later in the plan:**

| File | Responsibility |
|---|---|
| `engine/startups.ts` | Startup roster + tickers + price table + `SAFE_SIZE` / `END_SIZE` |
| `engine/log.ts` | `LogToken` builders, `pushLog`, `renderLogText` |
| `engine/placement.ts` | `previewPlacement`, `isDeadTile`, `getDeadTilesInHand` |
| `engine/bonuses.ts` | `computeChainBonuses`, `roundBonus` |
| `engine/endGame.ts` | `getEndCondition`, `finalScore` |
| `engine/intents.ts` | `Intent`, `IllegalIntentError`, `applyIntent` |
| `engine/index.ts` | Barrel — the only import surface `src/` and `server/` should use |
| `engine/golden/types.ts` | Golden-game data types |
| `engine/golden/fixtures.ts` | `buildFixture` — authored board/hand/holdings → `GameState` |
| `engine/golden/runner.ts` | `runGoldenGame`, assertion evaluation |
| `engine/golden/turns.ts` | G1, G12 |
| `engine/golden/mergers.ts` | G2–G7 |
| `engine/golden/endgame.ts` | G8–G11 |
| `engine/golden/index.ts` | `ALL_GOLDEN_GAMES` |
| `engine/golden/golden.test.ts` | Drives every golden game through the runner |

**Deleted:**

- `server/gameManager.ts` — dead (Task 1)
- `majorityHolderBonus` array in `sharePrices` — dead (Task 1)
- `(state as any)` casts around `pendingBonuses` (Task 5)

---

### Task 1: Move the engine out of `src/`

Mechanical move only. No behaviour changes, no renames, no signature changes. If the tests do not pass unchanged afterwards, something got rewritten that shouldn't have.

**Files:**
- Create (by `git mv`): `engine/gameTypes.ts`, `engine/gameInit.ts`, `engine/gameLogic.ts`, `engine/gameLogic.test.ts`, `engine/gameHelpers.ts`, `engine/testHelpers.ts`
- Create: `engine/index.ts`
- Delete: `server/gameManager.ts`
- Modify: `engine/gameLogic.ts` (delete `majorityHolderBonus`)
- Modify (import paths only): `server/gameManagerXState.ts:7`, `server/machines/gameRoomMachine.ts:7`, `server/machines/types.ts:5`, `server/types.ts:4`, `src/Game.tsx`, `src/pages/RoomPage.tsx`, and `src/components/{Board,BuyModal,DrawModal,FoundStartupModal,GameLog,MergerLiquidation,MergerPayoutModal,PlayerHand,PlayerStatusPanel,PlayerSummary,SurvivorSelectionModal,TilePlacementConfirmModal}.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `engine/index.ts` re-exporting everything below; every later task imports from `engine/*`.

- [ ] **Step 1: Confirm the baseline is green before touching anything**

Run: `npx vitest run`
Expected: `Test Files 1 passed`, `Tests 8 passed`. If not 8, stop and report — the plan assumes this baseline.

- [ ] **Step 2: Move the files with `git mv` so history is preserved**

```bash
mkdir -p engine
git mv src/state/gameTypes.ts       engine/gameTypes.ts
git mv src/state/gameInit.ts        engine/gameInit.ts
git mv src/state/gameLogic.ts       engine/gameLogic.ts
git mv src/state/gameLogic.test.ts  engine/gameLogic.test.ts
git mv src/utils/gameHelpers.ts     engine/gameHelpers.ts
git mv src/test/testHelpers.ts      engine/testHelpers.ts
git rm server/gameManager.ts
rmdir src/state 2>/dev/null || true
```

- [ ] **Step 3: Fix the intra-`engine/` imports**

Inside `engine/`, every cross-file import is now a sibling. Rewrite them extensionless:

```ts
// engine/gameLogic.ts — top of file
import type { GameState, Player, Startup, Coord, StartupId, TileCell } from './gameTypes';
import {
  coord, parseCoord, getAdjacentCoords, floodFillUnclaimed,
  getTilesForStartup, getStartupSize, compareTiles, shuffleSeeded,
  generateAllCoords, ROWS, COLS,
} from './gameHelpers';
```

```ts
// engine/gameInit.ts
import type { GameState, Player, Startup, Coord } from './gameTypes';
import { generateAllCoords, shuffleSeeded } from './gameHelpers';
```

```ts
// engine/gameHelpers.ts
import type { GameState, Coord, Row } from './gameTypes';
```

```ts
// engine/testHelpers.ts
import type { GameState, Player, Startup, Coord } from './gameTypes';
import { coord } from './gameHelpers';
```

```ts
// engine/gameLogic.test.ts
import { describe, it, expect } from 'vitest';
import { /* …unchanged list… */ } from './gameLogic';
import { createTestGameState, createTestPlayer, createTestStartup, setupGameWithStartups, giveShares } from './testHelpers';
```

Keep every symbol the files already imported — only the *paths* change.

- [ ] **Step 4: Delete the dead `majorityHolderBonus`**

In `engine/gameLogic.ts`, the `sharePrices` table carries a `majorityHolderBonus` array that nothing reads (`price * 10` is computed inline at the payout site). Delete the array and any type annotation that mentions it. Do not touch the price numbers.

- [ ] **Step 5: Run the moved tests**

Run: `npx vitest run engine/gameLogic.test.ts`
Expected: PASS, 8 tests. Any failure here means the move was not mechanical — revert and redo the move rather than "fixing" the test.

- [ ] **Step 6: Create the barrel**

```ts
// engine/index.ts
export * from './gameTypes';
export * from './gameHelpers';
export * from './gameInit';
export * from './gameLogic';
```

(Later tasks add `startups`, `log`, `placement`, `bonuses`, `endGame`, `intents` to this list as they are created.)

- [ ] **Step 7: Repoint every importer**

Server files use NodeNext, so they need the `.js` extension:

```ts
// server/types.ts, server/machines/types.ts, server/machines/gameRoomMachine.ts, server/gameManagerXState.ts
import type { GameState } from '../engine/gameTypes.js';   // adjust ../ depth per file
import { createInitialGame } from '../engine/gameInit.js';
import { placeTile, buyShares, endTurn } from '../engine/gameLogic.js';
```

Client files use Vite, extensionless:

```ts
// src/Game.tsx, src/pages/RoomPage.tsx, src/components/*.tsx
import type { GameState } from '../engine/gameTypes';        // adjust ../ depth per file
import { createInitialGame } from '../engine/gameInit';
import { placeTile /* … */ } from '../engine/gameLogic';
```

Find every one with:

```bash
grep -rn "state/game\|utils/gameHelpers\|test/testHelpers" src server --include='*.ts' --include='*.tsx'
```

Repeat the grep after editing — it must return nothing.

- [ ] **Step 8: Verify the whole suite and both builds still resolve**

```bash
npx vitest run
npx vite build
```
Expected: 8 tests pass; the Vite build completes. (A Vite build failure here is a missed import path.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: extract rules engine to engine/, delete dead gameManager and majorityHolderBonus"
```

---

### Task 2: Structured log entries

`state.log` becomes `LogEntry[]`. Each entry carries a `stepId` (the undo/step-stack handle the roadmap calls "a snapshot handle"), a `phase` label matching the prototype's step vocabulary, and `detail` as an array of tokens the view renders with the `components.js` atoms instead of parsing strings.

**Files:**
- Create: `engine/log.ts`, `engine/log.test.ts`
- Modify: `engine/gameTypes.ts`, `engine/gameInit.ts`, `engine/gameLogic.ts` (~20 `state.log.push` sites), `engine/index.ts`, `src/components/GameLog.tsx`

**Interfaces:**
- Consumes: `GameState` from Task 1.
- Produces:
  ```ts
  type LogToken =
    | { kind: 'text';  text: string }
    | { kind: 'tile';  coord: Coord }
    | { kind: 'brand'; startupId: StartupId }
    | { kind: 'cash';  amount: number; delta?: boolean }
    | { kind: 'stack'; startupId: StartupId; count: number };
  interface LogEntry { stepId: number; phase: string; detail: LogToken[]; playerId?: string }
  const tok: { text; tile; brand; cash; stack };            // token builders
  function pushLog(state: GameState, phase: string, detail: LogToken[], playerId?: string): LogEntry;
  function renderLogText(entry: LogEntry): string;
  // GameState gains: log: LogEntry[]; nextStepId: number;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// engine/log.test.ts
import { describe, it, expect } from 'vitest';
import { tok, pushLog, renderLogText } from './log';
import { createTestGameState } from './testHelpers';

describe('log', () => {
  it('assigns incrementing stepIds', () => {
    const state = createTestGameState();
    const a = pushLog(state, 'Placed a tile', [tok.tile('A1')], 'p1');
    const b = pushLog(state, 'Bought shares', [tok.stack('Gobble', 2)], 'p1');
    expect(a.stepId).toBe(1);
    expect(b.stepId).toBe(2);
    expect(state.nextStepId).toBe(3);
    expect(state.log).toHaveLength(2);
  });

  it('records phase, detail tokens and player', () => {
    const state = createTestGameState();
    pushLog(state, 'Founded a brand', [tok.brand('Messla'), tok.text(' at '), tok.tile('C6')], 'p2');
    expect(state.log[0]).toEqual({
      stepId: 1,
      phase: 'Founded a brand',
      playerId: 'p2',
      detail: [
        { kind: 'brand', startupId: 'Messla' },
        { kind: 'text', text: ' at ' },
        { kind: 'tile', coord: 'C6' },
      ],
    });
  });

  it('renders a plain-text fallback for every token kind', () => {
    const state = createTestGameState();
    const e = pushLog(state, 'Merger payout', [
      tok.text('Alex takes '), tok.cash(3000, true),
      tok.text(' for '), tok.stack('Gobble', 6),
      tok.text(' in '), tok.brand('Gobble'), tok.text(' at '), tok.tile('D5'),
    ]);
    expect(renderLogText(e)).toBe('Alex takes +$3,000 for 6× Gobble in Gobble at D5');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/log.test.ts`
Expected: FAIL — `Failed to resolve import './log'`.

- [ ] **Step 3: Write `engine/log.ts`**

```ts
// engine/log.ts
import type { Coord, GameState, LogEntry, LogToken, StartupId } from './gameTypes';

export const tok = {
  text:  (text: string): LogToken => ({ kind: 'text', text }),
  tile:  (coord: Coord): LogToken => ({ kind: 'tile', coord }),
  brand: (startupId: StartupId): LogToken => ({ kind: 'brand', startupId }),
  cash:  (amount: number, delta = false): LogToken => ({ kind: 'cash', amount, delta }),
  stack: (startupId: StartupId, count: number): LogToken => ({ kind: 'stack', startupId, count }),
};

export function pushLog(
  state: GameState,
  phase: string,
  detail: LogToken[],
  playerId?: string,
): LogEntry {
  const entry: LogEntry = { stepId: state.nextStepId, phase, detail };
  if (playerId !== undefined) entry.playerId = playerId;
  state.nextStepId += 1;
  state.log.push(entry);
  return entry;
}

function money(amount: number, delta?: boolean): string {
  const sign = delta ? (amount < 0 ? '-' : '+') : (amount < 0 ? '-' : '');
  return `${sign}$${Math.abs(amount).toLocaleString('en-US')}`;
}

export function renderLogText(entry: LogEntry): string {
  return entry.detail.map((t) => {
    switch (t.kind) {
      case 'text':  return t.text;
      case 'tile':  return t.coord;
      case 'brand': return t.startupId;
      case 'cash':  return money(t.amount, t.delta);
      case 'stack': return `${t.count}× ${t.startupId}`;
    }
  }).join('');
}
```

- [ ] **Step 4: Add the types**

```ts
// engine/gameTypes.ts — append
export type LogToken =
  | { kind: 'text';  text: string }
  | { kind: 'tile';  coord: Coord }
  | { kind: 'brand'; startupId: StartupId }
  | { kind: 'cash';  amount: number; delta?: boolean }
  | { kind: 'stack'; startupId: StartupId; count: number };

export interface LogEntry {
  stepId: number;
  phase: string;
  detail: LogToken[];
  playerId?: string;
}
```

In the `GameState` interface, change `log: string[]` to `log: LogEntry[]` and add `nextStepId: number;`.

- [ ] **Step 5: Seed the counter at init**

In `engine/gameInit.ts`, `createInitialGame` currently returns `log: []`. Add `nextStepId: 1,` next to it. In `engine/testHelpers.ts`, `createTestGameState` must also default `log: []` and `nextStepId: 1`.

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run engine/log.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Convert every `state.log.push` site**

There are ~20 in `engine/gameLogic.ts`. Find them:

```bash
grep -n "log.push" engine/gameLogic.ts
```

Convert each to `pushLog` with the phase drawn from the prototype's step vocabulary — the exact set is: `Placed a tile`, `Traded a tile`, `Founded a brand`, `Merger`, `Merger payout`, `Liquidated shares`, `Bought shares`, `Drew tiles`, `Ended turn`, `Game over`. Two worked examples:

```ts
// before
state.log.push(`${player.name} placed ${tileCoord}`);
// after
pushLog(state, 'Placed a tile', [tok.tile(tileCoord)], player.id);
```

```ts
// before
state.log.push(`${player.name} received $${bonus.amount} ${bonus.type} bonus for ${bonus.startupId}`);
// after
pushLog(state, 'Merger payout', [
  tok.text(`${bonusLabel(bonus.type)} · `),
  tok.brand(bonus.startupId),
  tok.text(' '),
  tok.cash(bonus.amount, true),
], bonus.playerId);
```

Add the helper beside the payout code:

```ts
function bonusLabel(type: 'majority' | 'minority' | 'both'): string {
  return type === 'both' ? 'Majority + minority' : type === 'majority' ? 'Majority' : 'Minority';
}
```

Do not drop information: if the old string named a player, pass `playerId`; if it named a tile, chain, count or amount, use the matching token rather than baking it into `tok.text`.

- [ ] **Step 8: Update the only UI consumer**

`src/components/GameLog.tsx` renders `state.log` as raw strings. Replace the map body:

```tsx
import { renderLogText } from '../../engine/log';
// …
{state.log.slice().reverse().map((entry) => (
  <li key={entry.stepId} className="...">
    <span className="log-phase">{entry.phase}</span>
    <span className="log-detail">{renderLogText(entry)}</span>
  </li>
))}
```

Keep the existing `className` values on the `<li>` exactly as they are — this is a data change, not a restyle. Token-by-token rendering with the `components.js` atoms is Phase 1's job; `renderLogText` is the bridge until then.

- [ ] **Step 9: Export from the barrel and run everything**

Add `export * from './log';` to `engine/index.ts`.

Run: `npx vitest run && npx vite build`
Expected: 11 tests pass (8 + 3); build completes.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(engine): structured log entries with step ids"
```

---

### Task 3: Startup roster — tickers, prices, emoji

Pulls the startup config out of `gameLogic.ts` into its own module, adds the `ticker` the panel renders, adds `emoji` to `Player`, and exposes next-price computation (the `$300 ↑ $600` the prototype's `price()` atom needs).

**Files:**
- Create: `engine/startups.ts`, `engine/startups.test.ts`
- Modify: `engine/gameTypes.ts`, `engine/gameInit.ts`, `engine/gameLogic.ts`, `engine/index.ts`

**Interfaces:**
- Consumes: `GameState`, `Startup`, `StartupId` from Task 1.
- Produces:
  ```ts
  const SAFE_SIZE = 11;
  const END_SIZE = 41;
  const SIZE_THRESHOLDS: readonly number[];          // [2,3,4,5,6,11,21,31,41]
  const PLAYER_EMOJI: readonly string[];             // ['🦊','🐢','🦁','🐙','🦉','🐝']
  interface StartupConfig { id: StartupId; tier: 0 | 1 | 2; ticker: string }
  const AVAILABLE_STARTUPS: readonly StartupConfig[];
  function getSharePriceAtSize(tier: 0 | 1 | 2, size: number): number;
  function getSharePrice(state: GameState, startupId: StartupId): number;      // re-exported from gameLogic
  function getNextSharePrice(state: GameState, startupId: StartupId): number | null;
  // Startup gains: ticker: string.  Player gains: emoji: string.
  ```

- [ ] **Step 1: Write the failing test**

```ts
// engine/startups.test.ts
import { describe, it, expect } from 'vitest';
import { AVAILABLE_STARTUPS, getSharePriceAtSize, getNextSharePrice, SAFE_SIZE, END_SIZE } from './startups';
import { setupGameWithStartups } from './testHelpers';

describe('startups', () => {
  it('carries the seven brands with their tickers', () => {
    expect(AVAILABLE_STARTUPS.map((s) => [s.id, s.tier, s.ticker])).toEqual([
      ['Gobble', 2, '$G'],
      ['Scrapple', 2, '$S'],
      ['PaperfulPost', 0, '$PP'],
      ['CamCrooned', 1, '$C'],
      ['Messla', 0, '$M'],
      ['ZuckFace', 1, '$Z'],
      ['WrecksonMobil', 1, '$W'],
    ]);
  });

  it('prices by size threshold and tier', () => {
    expect(getSharePriceAtSize(0, 0)).toBe(0);
    expect(getSharePriceAtSize(0, 2)).toBe(200);
    expect(getSharePriceAtSize(0, 6)).toBe(600);
    expect(getSharePriceAtSize(1, 2)).toBe(300);
    expect(getSharePriceAtSize(2, 2)).toBe(400);
    expect(getSharePriceAtSize(0, 41)).toBe(1000);
    expect(getSharePriceAtSize(0, 60)).toBe(1000);
  });

  it('gives the price one tile from now, and null once the top band is reached', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 5, tier: 0 }]);
    expect(getNextSharePrice(state, 'Messla')).toBe(600);   // 5 → 6 crosses a threshold
    const big = setupGameWithStartups([{ id: 'Messla', tiles: 41, tier: 0 }]);
    expect(getNextSharePrice(big, 'Messla')).toBeNull();
  });

  it('exports the shared size constants', () => {
    expect(SAFE_SIZE).toBe(11);
    expect(END_SIZE).toBe(41);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/startups.test.ts`
Expected: FAIL — `Failed to resolve import './startups'`.

- [ ] **Step 3: Write `engine/startups.ts`**

Move the price table and roster out of `gameLogic.ts` verbatim (minus the already-deleted `majorityHolderBonus`), then add tickers:

```ts
// engine/startups.ts
import type { GameState, StartupId } from './gameTypes';
import { getStartupSize } from './gameHelpers';

export const SAFE_SIZE = 11;
export const END_SIZE = 41;
export const SIZE_THRESHOLDS: readonly number[] = [2, 3, 4, 5, 6, 11, 21, 31, 41];
export const PLAYER_EMOJI: readonly string[] = ['🦊', '🐢', '🦁', '🐙', '🦉', '🐝'];

export interface StartupConfig { id: StartupId; tier: 0 | 1 | 2; ticker: string }

export const AVAILABLE_STARTUPS: readonly StartupConfig[] = [
  { id: 'Gobble',        tier: 2, ticker: '$G'  },
  { id: 'Scrapple',      tier: 2, ticker: '$S'  },
  { id: 'PaperfulPost',  tier: 0, ticker: '$PP' },
  { id: 'CamCrooned',    tier: 1, ticker: '$C'  },
  { id: 'Messla',        tier: 0, ticker: '$M'  },
  { id: 'ZuckFace',      tier: 1, ticker: '$Z'  },
  { id: 'WrecksonMobil', tier: 1, ticker: '$W'  },
];

/** Base prices at each entry in SIZE_THRESHOLDS, for tier 0. Tier n adds n × 100. */
const TIER0_PRICES: readonly number[] = [200, 300, 400, 500, 600, 700, 800, 900, 1000];

export function getSharePriceAtSize(tier: 0 | 1 | 2, size: number): number {
  if (size < SIZE_THRESHOLDS[0]) return 0;
  let band = 0;
  for (let i = 0; i < SIZE_THRESHOLDS.length; i++) {
    if (size >= SIZE_THRESHOLDS[i]) band = i;
  }
  return TIER0_PRICES[band] + tier * 100;
}

export function getNextSharePrice(state: GameState, startupId: StartupId): number | null {
  const startup = state.startups.find((s) => s.id === startupId);
  if (!startup) return null;
  const size = getStartupSize(state, startupId);
  const now = getSharePriceAtSize(startup.tier, size);
  const then = getSharePriceAtSize(startup.tier, size + 1);
  return then > now ? then : null;
}
```

Verify `TIER0_PRICES` against the numbers already in `gameLogic.ts`'s `sharePrices` before deleting them. If they disagree, **the existing table wins** — Phase 0 does not change prices. Adjust `TIER0_PRICES` to match and fix the test's expected numbers.

- [ ] **Step 4: Reimplement `getSharePrice` over the new helper**

In `engine/gameLogic.ts`, keep the exported signature `getSharePrice(state, startupId)` — eight existing tests call it — but make it delegate, and delete the old inline table:

```ts
import { getSharePriceAtSize, AVAILABLE_STARTUPS } from './startups';

export function getSharePrice(state: GameState, startupId: StartupId): number {
  const startup = state.startups.find((s) => s.id === startupId);
  if (!startup) return 0;
  return getSharePriceAtSize(startup.tier, getStartupSize(state, startupId));
}
```

Replace the local `AVAILABLE_STARTUPS` definition in `gameLogic.ts` with a re-export: `export { AVAILABLE_STARTUPS } from './startups';`

- [ ] **Step 5: Add `ticker` and `emoji` to the types**

```ts
// engine/gameTypes.ts
export interface Startup {
  // …existing fields…
  ticker: string;
}
export interface Player {
  // …existing fields…
  emoji: string;
}
```

- [ ] **Step 6: Populate them at init**

```ts
// engine/gameInit.ts
import { AVAILABLE_STARTUPS, PLAYER_EMOJI } from './startups';

const players: Player[] = names.map((name, i) => ({
  id: `p${i + 1}`,
  name,
  emoji: PLAYER_EMOJI[i % PLAYER_EMOJI.length],
  cash: 6000,
  hand: [],
  shares: {},
}));

const startups: Startup[] = AVAILABLE_STARTUPS.map((cfg) => ({
  id: cfg.id,
  tier: cfg.tier,
  ticker: cfg.ticker,
  isFounded: false,
  totalShares: 25,
  availableShares: 25,
}));
```

Keep whatever other fields the existing code sets — this shows the two new lines in context, it is not a replacement of the whole object literal.

In `engine/testHelpers.ts`, `createTestPlayer` gains `emoji: '🦊'` and `createTestStartup` gains `ticker: '$X'` as defaults. While in there, delete the stray `connectionState` field — it is not on `Player`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run`
Expected: 15 passed (8 + 3 + 4).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(engine): startup roster module with tickers, player emoji, next-price"
```

---

### Task 4: Placement preview and dead tiles

One function answers everything the UI asks about a tile before it is played: is it legal, what will it do, which chains does it touch, and what happens to their prices. Dead tiles fall out of it — a tile is dead exactly when its only outcome would be merging two safe chains, which can never become legal again.

**Files:**
- Create: `engine/placement.ts`, `engine/placement.test.ts`
- Modify: `engine/gameLogic.ts` (the safe-chain block at ~line 149 delegates to `previewPlacement`), `engine/index.ts`

**Interfaces:**
- Consumes: `SAFE_SIZE`, `getSharePriceAtSize` from Task 3; `getAdjacentCoords`, `floodFillUnclaimed`, `getStartupSize` from Task 1.
- Produces:
  ```ts
  type PlacementKind  = 'isolated' | 'found' | 'grow' | 'merge';
  type PlacementBlock = 'notInHand' | 'occupied' | 'mergesSafeChains' | 'noBrandAvailable';
  interface ChainPriceChange { size: number; price: number; nextSize: number; nextPrice: number }
  interface PlacementPreview {
    coord: Coord; legal: boolean; block?: PlacementBlock; kind: PlacementKind;
    touchingIds: StartupId[]; loneAdj: Coord[];
    survivorId?: StartupId; tiedSurvivorIds?: StartupId[]; absorbedIds: StartupId[];
    prices: Record<string, ChainPriceChange>;
  }
  function previewPlacement(state: GameState, coord: Coord, playerId?: string): PlacementPreview;
  function isDeadTile(state: GameState, coord: Coord): boolean;
  function getDeadTilesInHand(state: GameState, playerId: string): Coord[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// engine/placement.test.ts
import { describe, it, expect } from 'vitest';
import { previewPlacement, isDeadTile, getDeadTilesInHand } from './placement';
import { setupGameWithStartups, createTestGameState } from './testHelpers';

describe('previewPlacement', () => {
  it('reports an isolated tile with no neighbours', () => {
    const state = createTestGameState();
    const p = previewPlacement(state, 'E5');
    expect(p.legal).toBe(true);
    expect(p.kind).toBe('isolated');
    expect(p.touchingIds).toEqual([]);
    expect(p.loneAdj).toEqual([]);
  });

  it('reports a founding placement next to an unclaimed tile', () => {
    const state = createTestGameState();
    state.board['E5'] = { coord: 'E5', isPlaced: true, startupId: null };
    const p = previewPlacement(state, 'E6');
    expect(p.kind).toBe('found');
    expect(p.loneAdj).toEqual(['E5']);
  });

  it('reports growth and the resulting price move', () => {
    // Messla (tier 0) spans B1..B5 → size 5, price 500; +1 tile → 6, price 600
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 5, tier: 0 }]);
    const p = previewPlacement(state, 'B6');
    expect(p.kind).toBe('grow');
    expect(p.touchingIds).toEqual(['Messla']);
    expect(p.prices['Messla']).toEqual({ size: 5, price: 500, nextSize: 6, nextPrice: 600 });
  });

  it('names the survivor and the absorbed chain on a merge', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 6, tier: 0 },   // B1..B6
      { id: 'ZuckFace', tiles: 3, tier: 1 },   // D1..D3
    ]);
    state.board['C1'] = { coord: 'C1', isPlaced: false, startupId: null };
    const p = previewPlacement(state, 'C1');
    expect(p.kind).toBe('merge');
    expect(p.survivorId).toBe('Messla');
    expect(p.absorbedIds).toEqual(['ZuckFace']);
    expect(p.tiedSurvivorIds).toBeUndefined();
    expect(p.prices['Messla'].nextSize).toBe(10);   // 6 + 3 + the placed tile
    expect(p.prices['ZuckFace'].nextSize).toBe(0);
  });

  it('flags a tie for survivor rather than picking one', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 4, tier: 0 },
      { id: 'ZuckFace', tiles: 4, tier: 1 },
    ]);
    const p = previewPlacement(state, 'C1');
    expect(p.kind).toBe('merge');
    expect(p.survivorId).toBeUndefined();
    expect(p.tiedSurvivorIds).toEqual(['Messla', 'ZuckFace']);
  });

  it('blocks a tile that would merge two safe chains, and calls it dead', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 11, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    const p = previewPlacement(state, 'C1');
    expect(p.legal).toBe(false);
    expect(p.block).toBe('mergesSafeChains');
    expect(isDeadTile(state, 'C1')).toBe(true);
  });

  it('blocks a founding placement when all seven brands are on the board — but not as dead', () => {
    const state = setupGameWithStartups([
      { id: 'Gobble', tiles: 2, tier: 2 }, { id: 'Scrapple', tiles: 2, tier: 2 },
      { id: 'PaperfulPost', tiles: 2, tier: 0 }, { id: 'CamCrooned', tiles: 2, tier: 1 },
      { id: 'Messla', tiles: 2, tier: 0 }, { id: 'ZuckFace', tiles: 2, tier: 1 },
      { id: 'WrecksonMobil', tiles: 2, tier: 1 },
    ]);
    state.board['I11'] = { coord: 'I11', isPlaced: true, startupId: null };
    const p = previewPlacement(state, 'I12');
    expect(p.legal).toBe(false);
    expect(p.block).toBe('noBrandAvailable');
    expect(isDeadTile(state, 'I12')).toBe(false);   // recoverable — a merger can free a brand
  });

  it('rejects an occupied square and a tile not in hand', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 5, tier: 0 }]);
    expect(previewPlacement(state, 'B1').block).toBe('occupied');
    state.players[0].hand = ['E5'];
    expect(previewPlacement(state, 'E6', state.players[0].id).block).toBe('notInHand');
  });

  it('lists only the dead tiles in a hand', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 11, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    state.players[0].hand = ['C1', 'G6'];
    expect(getDeadTilesInHand(state, state.players[0].id)).toEqual(['C1']);
  });
});
```

`setupGameWithStartups` lays chains out row by row (`Messla` on row B, `ZuckFace` on row D, …), so `C1` sits between them. Confirm that against `engine/testHelpers.ts` before writing the implementation, and adjust the coords in the test if the helper lays chains out differently — the *shape* of each assertion is what matters, not the specific letters.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/placement.test.ts`
Expected: FAIL — `Failed to resolve import './placement'`.

- [ ] **Step 3: Write `engine/placement.ts`**

```ts
// engine/placement.ts
import type { Coord, GameState, StartupId } from './gameTypes';
import { getAdjacentCoords, floodFillUnclaimed, getStartupSize } from './gameHelpers';
import { SAFE_SIZE, getSharePriceAtSize } from './startups';

export type PlacementKind  = 'isolated' | 'found' | 'grow' | 'merge';
export type PlacementBlock = 'notInHand' | 'occupied' | 'mergesSafeChains' | 'noBrandAvailable';

export interface ChainPriceChange { size: number; price: number; nextSize: number; nextPrice: number }

export interface PlacementPreview {
  coord: Coord;
  legal: boolean;
  block?: PlacementBlock;
  kind: PlacementKind;
  touchingIds: StartupId[];
  loneAdj: Coord[];
  survivorId?: StartupId;
  tiedSurvivorIds?: StartupId[];
  absorbedIds: StartupId[];
  prices: Record<string, ChainPriceChange>;
}

function tierOf(state: GameState, id: StartupId): 0 | 1 | 2 {
  return (state.startups.find((s) => s.id === id)?.tier ?? 0) as 0 | 1 | 2;
}

function change(state: GameState, id: StartupId, nextSize: number): ChainPriceChange {
  const tier = tierOf(state, id);
  const size = getStartupSize(state, id);
  return {
    size,
    price: getSharePriceAtSize(tier, size),
    nextSize,
    nextPrice: getSharePriceAtSize(tier, nextSize),
  };
}

export function previewPlacement(state: GameState, coord: Coord, playerId?: string): PlacementPreview {
  const adj = getAdjacentCoords(coord);
  const touchingIds = [...new Set(
    adj.map((c) => state.board[c]?.startupId).filter((id): id is StartupId => !!id),
  )];
  const loneAdj = adj.filter((c) => state.board[c]?.isPlaced && !state.board[c]?.startupId);

  const preview: PlacementPreview = {
    coord,
    legal: true,
    kind: 'isolated',
    touchingIds,
    loneAdj,
    absorbedIds: [],
    prices: {},
  };

  if (state.board[coord]?.isPlaced) {
    return { ...preview, legal: false, block: 'occupied' };
  }
  if (playerId !== undefined) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.hand.includes(coord)) {
      return { ...preview, legal: false, block: 'notInHand' };
    }
  }

  if (touchingIds.length === 0) {
    preview.kind = loneAdj.length > 0 ? 'found' : 'isolated';
    if (preview.kind === 'found' && state.startups.every((s) => s.isFounded)) {
      preview.legal = false;
      preview.block = 'noBrandAvailable';
    }
    return preview;
  }

  const sized = touchingIds
    .map((id) => ({ id, size: getStartupSize(state, id) }))
    .sort((a, b) => b.size - a.size);

  if (sized.length === 1) {
    preview.kind = 'grow';
    // the placed tile, plus any unclaimed tiles it drags in
    const absorbedLoners = floodFillUnclaimed(state, coord).length;
    preview.prices[sized[0].id] = change(state, sized[0].id, sized[0].size + absorbedLoners);
    return preview;
  }

  preview.kind = 'merge';

  if (sized.filter((s) => s.size >= SAFE_SIZE).length > 1) {
    preview.legal = false;
    preview.block = 'mergesSafeChains';
    return preview;
  }

  const top = sized[0].size;
  const tied = sized.filter((s) => s.size === top);
  const absorbedLoners = floodFillUnclaimed(state, coord).length;
  const total = sized.reduce((n, s) => n + s.size, 0) + absorbedLoners;

  if (tied.length > 1) {
    preview.tiedSurvivorIds = tied.map((s) => s.id);
    for (const s of sized) preview.prices[s.id] = change(state, s.id, total);
  } else {
    preview.survivorId = sized[0].id;
    preview.absorbedIds = sized.slice(1).map((s) => s.id);
    preview.prices[sized[0].id] = change(state, sized[0].id, total);
    for (const s of sized.slice(1)) preview.prices[s.id] = change(state, s.id, 0);
  }
  return preview;
}

export function isDeadTile(state: GameState, coord: Coord): boolean {
  return previewPlacement(state, coord).block === 'mergesSafeChains';
}

export function getDeadTilesInHand(state: GameState, playerId: string): Coord[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  return player.hand.filter((c) => isDeadTile(state, c));
}
```

`floodFillUnclaimed(state, coord)` returns the unclaimed placed tiles reachable from `coord`; check whether it includes `coord` itself and adjust the `+ 1` accounting so the merge test's `nextSize` of 10 comes out right. Fix the *implementation* to match the arithmetic in the test, not the other way round.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run engine/placement.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Delegate the existing safe-chain block**

`engine/gameLogic.ts` around line 149 has its own inline version:

```ts
const safeChains = touching.filter((id) => getStartupSize(state, id) >= 11);
if (safeChains.length > 1) { /* log */ return state; }
```

Replace it with the shared check so there is one definition of the rule:

```ts
import { previewPlacement } from './placement';
// …
const preview = previewPlacement(state, tileCoord, player.id);
if (!preview.legal) {
  pushLog(state, 'Placed a tile', [
    tok.tile(tileCoord),
    tok.text(preview.block === 'mergesSafeChains'
      ? ' can never be played — it would merge two safe chains'
      : ' cannot be played right now'),
  ], player.id);
  return state;
}
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: 23 passed (15 + 8). If a merger test in `gameLogic.test.ts` broke, `previewPlacement` disagrees with the inline logic it replaced — reconcile in favour of the existing tests.

- [ ] **Step 7: Export and commit**

Add `export * from './placement';` to `engine/index.ts`.

```bash
git add -A
git commit -m "feat(engine): placement preview, next prices and dead-tile detection"
```

---

### Task 5: Typed bonuses — tied-minority split and sole-holder combined

The two known bugs. **Write both failing tests first and watch them fail** — the roadmap requires demonstrating that the old behaviour was wrong before fixing it. Also replaces `(state as any).pendingBonuses` with a typed field.

Current wrong behaviour, for reference:
- **Tied minority** (`gameLogic.ts` ~line 726): the `else` branch pays *each* minority holder the full `price × 5`. Two tied holders of a $600 chain both get $3,000 instead of splitting it.
- **Sole holder** (~line 700): `minorityHolders = holdings.filter(h => h.shares === minorityShares && h.shares < majorityShares)` is empty when one player holds everything, so the minority bonus is never awarded at all.

**Files:**
- Create: `engine/bonuses.ts`, `engine/bonuses.test.ts`
- Modify: `engine/gameTypes.ts`, `engine/gameLogic.ts` (`prepareMergerPayout`, `finalizeMergerPayout`), `engine/index.ts`

**Interfaces:**
- Consumes: `getSharePrice` from Task 3.
- Produces:
  ```ts
  interface BonusResult {
    playerId: string; playerName: string; startupId: StartupId;
    shares: number; amount: number; type: 'majority' | 'minority' | 'both';
  }
  interface BonusHolding { playerId: string; playerName: string; shares: number }
  function roundBonus(amount: number): number;                     // ceil to nearest 100
  function computeChainBonuses(startupId: StartupId, price: number, holdings: BonusHolding[]): BonusResult[];
  // GameState: pendingBonuses?: BonusResult[]   (replaces the `as any` cast)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// engine/bonuses.test.ts
import { describe, it, expect } from 'vitest';
import { computeChainBonuses, roundBonus } from './bonuses';

const h = (playerId: string, shares: number) => ({ playerId, playerName: playerId.toUpperCase(), shares });

describe('computeChainBonuses', () => {
  it('pays a clear majority and a clear minority', () => {
    const out = computeChainBonuses('Gobble', 1000, [h('p1', 6), h('p2', 3), h('p3', 1)]);
    expect(out).toEqual([
      { playerId: 'p1', playerName: 'P1', startupId: 'Gobble', shares: 6, amount: 10000, type: 'majority' },
      { playerId: 'p2', playerName: 'P2', startupId: 'Gobble', shares: 3, amount: 5000,  type: 'minority' },
    ]);
  });

  // BUG #1 — currently each tied holder gets the FULL minority bonus
  it('splits a tied minority bonus between the tied holders', () => {
    const out = computeChainBonuses('Messla', 600, [h('p2', 7), h('p1', 4), h('p3', 4)]);
    expect(out).toEqual([
      { playerId: 'p2', playerName: 'P2', startupId: 'Messla', shares: 7, amount: 6000, type: 'majority' },
      { playerId: 'p1', playerName: 'P1', startupId: 'Messla', shares: 4, amount: 1500, type: 'minority' },
      { playerId: 'p3', playerName: 'P3', startupId: 'Messla', shares: 4, amount: 1500, type: 'minority' },
    ]);
  });

  // BUG #2 — currently a sole holder gets the majority bonus only
  it('pays a sole holder majority and minority combined', () => {
    const out = computeChainBonuses('ZuckFace', 400, [h('p3', 3)]);
    expect(out).toEqual([
      { playerId: 'p3', playerName: 'P3', startupId: 'ZuckFace', shares: 3, amount: 6000, type: 'both' },
    ]);
  });

  it('splits a tied majority across majority + minority, rounded up to $100', () => {
    // (300×10 + 300×5) / 2 = 2250 → 2300 each
    const out = computeChainBonuses('CamCrooned', 300, [h('p1', 5), h('p2', 5)]);
    expect(out.map((b) => [b.playerId, b.amount, b.type])).toEqual([
      ['p1', 2300, 'majority'],
      ['p2', 2300, 'majority'],
    ]);
  });

  it('pays nobody for a chain with no shareholders', () => {
    expect(computeChainBonuses('Scrapple', 500, [])).toEqual([]);
    expect(computeChainBonuses('Scrapple', 500, [h('p1', 0)])).toEqual([]);
  });

  it('rounds up to the nearest hundred', () => {
    expect(roundBonus(2250)).toBe(2300);
    expect(roundBonus(1500)).toBe(1500);
    expect(roundBonus(1)).toBe(100);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run engine/bonuses.test.ts`
Expected: FAIL — `Failed to resolve import './bonuses'`. Note in the commit message later that the tied-minority and sole-holder cases are the two bugs the roadmap names; they must be seen red before Step 5 turns them green.

- [ ] **Step 3: Write `engine/bonuses.ts`**

```ts
// engine/bonuses.ts
import type { StartupId } from './gameTypes';

export interface BonusHolding { playerId: string; playerName: string; shares: number }

export interface BonusResult {
  playerId: string;
  playerName: string;
  startupId: StartupId;
  shares: number;
  amount: number;
  type: 'majority' | 'minority' | 'both';
}

export function roundBonus(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}

export function computeChainBonuses(
  startupId: StartupId,
  price: number,
  holdings: BonusHolding[],
): BonusResult[] {
  const holders = holdings.filter((h) => h.shares > 0).sort((a, b) => b.shares - a.shares);
  if (holders.length === 0) return [];

  const majorityPot = price * 10;
  const minorityPot = price * 5;
  const make = (h: BonusHolding, amount: number, type: BonusResult['type']): BonusResult => ({
    playerId: h.playerId, playerName: h.playerName, startupId, shares: h.shares, amount, type,
  });

  // Sole holder takes both bonuses as one figure.
  if (holders.length === 1) {
    return [make(holders[0], majorityPot + minorityPot, 'both')];
  }

  const topShares = holders[0].shares;
  const topHolders = holders.filter((h) => h.shares === topShares);

  // Tied majority: the two pots are combined and split, and no minority is paid.
  if (topHolders.length > 1) {
    const each = roundBonus((majorityPot + minorityPot) / topHolders.length);
    return topHolders.map((h) => make(h, each, 'majority'));
  }

  const runnerUpShares = holders[1].shares;
  const runnersUp = holders.filter((h) => h.shares === runnerUpShares);
  const eachMinority = runnersUp.length > 1
    ? roundBonus(minorityPot / runnersUp.length)
    : minorityPot;

  return [
    make(holders[0], majorityPot, 'majority'),
    ...runnersUp.map((h) => make(h, eachMinority, 'minority')),
  ];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run engine/bonuses.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Type `pendingBonuses` and route the payout through the new function**

```ts
// engine/gameTypes.ts
import type { BonusResult } from './bonuses';
export type { BonusResult };
// in GameState:
  pendingBonuses?: BonusResult[];
```

In `engine/gameLogic.ts`, `prepareMergerPayout` currently builds bonuses inline (the two buggy branches) and stashes them with `(state as any).pendingBonuses = allBonuses;` at ~line 744, read back at ~line 768. Replace the whole computation:

```ts
import { computeChainBonuses } from './bonuses';

const allBonuses: BonusResult[] = [];
for (const absorbedId of absorbedIds) {
  const price = getSharePrice(state, absorbedId);
  const holdings = state.players.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    shares: p.shares[absorbedId] ?? 0,
  }));
  allBonuses.push(...computeChainBonuses(absorbedId, price, holdings));
}
state.pendingBonuses = allBonuses;
```

Delete both `as any` casts. At the read site use `state.pendingBonuses ?? []`.

- [ ] **Step 6: Run the full suite and reconcile the existing merger tests**

Run: `npx vitest run`
Expected: some of the 8 original merger tests now **fail** — they encode the old sole-holder and tied-split behaviour. That is the point.

For each failure, decide which side is right:
- Asserting a sole holder gets majority only → **update the test** to expect `type: 'both'` and `price × 15`. Add `// Phase 0: sole holder now takes the combined bonus` beside it.
- Asserting a tied split of `Math.floor(...)` → **update the test** to the `roundBonus` figure.
- Anything else failing → the refactor broke something; fix `gameLogic.ts`, not the test.

Do not delete any of the 8 tests.

- [ ] **Step 7: Run everything green**

Run: `npx vitest run`
Expected: 29 passed (23 + 6), zero failures.

- [ ] **Step 8: Export and commit**

Add `export * from './bonuses';` to `engine/index.ts`.

```bash
git add -A
git commit -m "fix(engine): split tied minority bonuses and pay sole holders the combined bonus

Both cases were demonstrably wrong before this change: a tied minority paid
each holder the full bonus, and a sole holder was never paid a minority at
all. Adds typed state.pendingBonuses, removing the last `as any` around it.
Tied splits now round up to the nearest \$100."
```

---

### Task 6: End condition and final scoring

`getEndCondition` is a pure query — it never ends the game on its own, because the roadmap requires that the end be *declared* (G11 pins a met-but-declined condition). `finalScore` returns exactly the props shape `finalScoring()` in `prototype/components.js` consumes.

**Files:**
- Create: `engine/endGame.ts`, `engine/endGame.test.ts`
- Modify: `engine/gameTypes.ts`, `engine/index.ts`

**Interfaces:**
- Consumes: `SAFE_SIZE`, `END_SIZE`, `getSharePrice` (Task 3); `computeChainBonuses`, `BonusResult` (Task 5).
- Produces:
  ```ts
  type EndReason =
    | { kind: 'size41'; startupId: StartupId; size: number }
    | { kind: 'allSafe'; startupIds: StartupId[] };
  interface EndCondition { met: boolean; reasons: EndReason[] }
  function getEndCondition(state: GameState): EndCondition;

  interface FinalScoreReport {
    reason: EndReason | null;
    players: { id: string; name: string; emoji: string; cash: number }[];
    chains:  { id: StartupId; size: number; price: number }[];
    holdings: Record<string, Record<string, number>>;
    bonuses: { chainId: StartupId; playerId: string; type: 'majority' | 'minority' | 'both'; amount: number }[];
  }
  function finalScore(state: GameState): FinalScoreReport;
  ```

`reason` is **structured, not a sentence**. The roadmap defers the all-safe wording to its own spec, so the view formats it; the engine only says which condition fired.

- [ ] **Step 1: Write the failing test**

```ts
// engine/endGame.test.ts
import { describe, it, expect } from 'vitest';
import { getEndCondition, finalScore } from './endGame';
import { setupGameWithStartups, giveShares } from './testHelpers';

describe('getEndCondition', () => {
  it('is not met mid-game', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 8, tier: 0 }]);
    expect(getEndCondition(state)).toEqual({ met: false, reasons: [] });
  });

  it('is met when a chain reaches 41', () => {
    const state = setupGameWithStartups([{ id: 'Gobble', tiles: 41, tier: 2 }]);
    expect(getEndCondition(state)).toEqual({
      met: true,
      reasons: [{ kind: 'size41', startupId: 'Gobble', size: 41 }],
    });
  });

  it('is met when every founded chain is safe', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 12, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    expect(getEndCondition(state)).toEqual({
      met: true,
      reasons: [{ kind: 'allSafe', startupIds: ['Messla', 'ZuckFace'] }],
    });
  });

  it('is not met when one founded chain is still unsafe', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 12, tier: 0 },
      { id: 'ZuckFace', tiles: 10, tier: 1 },
    ]);
    expect(getEndCondition(state).met).toBe(false);
  });

  it('is not met when nothing has been founded', () => {
    const state = setupGameWithStartups([]);
    expect(getEndCondition(state).met).toBe(false);
  });
});

describe('finalScore', () => {
  // Mirrors the fixture in docs/superpowers/specs/2026-07-30-final-scoring-overlay-design.md
  function scoredGame() {
    const state = setupGameWithStartups([
      { id: 'Gobble',   tiles: 41, tier: 2 },
      { id: 'Messla',   tiles: 8,  tier: 0 },
      { id: 'ZuckFace', tiles: 5,  tier: 1 },
    ]);
    const [alex, sam, jordan] = state.players;
    alex.cash = 8600; sam.cash = 12000; jordan.cash = 3100;
    giveShares(state, alex.id,   'Gobble', 6);
    giveShares(state, sam.id,    'Gobble', 3);
    giveShares(state, jordan.id, 'Gobble', 1);
    giveShares(state, alex.id,   'Messla', 4);
    giveShares(state, sam.id,    'Messla', 7);
    giveShares(state, jordan.id, 'Messla', 4);
    giveShares(state, jordan.id, 'ZuckFace', 3);
    return state;
  }

  it('reports only the chains standing on the board', () => {
    const report = finalScore(scoredGame());
    expect(report.chains.map((c) => c.id)).toEqual(['Gobble', 'Messla', 'ZuckFace']);
  });

  it('carries every player with cash and emoji', () => {
    const report = finalScore(scoredGame());
    expect(report.players.map((p) => p.cash)).toEqual([8600, 12000, 3100]);
    expect(report.players.every((p) => typeof p.emoji === 'string' && p.emoji.length > 0)).toBe(true);
  });

  it('resolves bonuses per chain, including the tie and the sole holder', () => {
    const state = scoredGame();
    const [alex, sam, jordan] = state.players;
    const report = finalScore(state);
    const at = (chainId: string, playerId: string) =>
      report.bonuses.find((b) => b.chainId === chainId && b.playerId === playerId);

    expect(at('Gobble', alex.id)).toMatchObject({ type: 'majority', amount: 10000 });
    expect(at('Gobble', sam.id)).toMatchObject({ type: 'minority', amount: 5000 });
    expect(at('Gobble', jordan.id)).toBeUndefined();

    expect(at('Messla', sam.id)).toMatchObject({ type: 'majority', amount: 6000 });
    expect(at('Messla', alex.id)).toMatchObject({ type: 'minority', amount: 1500 });
    expect(at('Messla', jordan.id)).toMatchObject({ type: 'minority', amount: 1500 });

    expect(at('ZuckFace', jordan.id)).toMatchObject({ type: 'both', amount: 6000 });
  });

  it('does not bank bonuses into cash', () => {
    const state = scoredGame();
    finalScore(state);
    expect(state.players.map((p) => p.cash)).toEqual([8600, 12000, 3100]);
  });

  it('reports the end reason when one is met', () => {
    const report = finalScore(scoredGame());
    expect(report.reason).toEqual({ kind: 'size41', startupId: 'Gobble', size: 41 });
  });
});
```

The spec's fixture uses prices $1,000 / $600 / $400 for Gobble 41·tier2, Messla 8·tier0, ZuckFace 5·tier1. Check those against `getSharePriceAtSize`; if the tiers in `AVAILABLE_STARTUPS` produce different numbers, keep the engine's tiers and adjust the *bonus amounts* in this test to `price × 10` / `× 5` / `× 15` accordingly.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/endGame.test.ts`
Expected: FAIL — `Failed to resolve import './endGame'`.

- [ ] **Step 3: Write `engine/endGame.ts`**

```ts
// engine/endGame.ts
import type { GameState, StartupId } from './gameTypes';
import { getStartupSize } from './gameHelpers';
import { SAFE_SIZE, END_SIZE } from './startups';
import { getSharePrice } from './gameLogic';
import { computeChainBonuses } from './bonuses';

export type EndReason =
  | { kind: 'size41';  startupId: StartupId; size: number }
  | { kind: 'allSafe'; startupIds: StartupId[] };

export interface EndCondition { met: boolean; reasons: EndReason[] }

function foundedChains(state: GameState): { id: StartupId; size: number }[] {
  return state.startups
    .filter((s) => s.isFounded)
    .map((s) => ({ id: s.id, size: getStartupSize(state, s.id) }))
    .filter((c) => c.size > 0);
}

export function getEndCondition(state: GameState): EndCondition {
  const chains = foundedChains(state);
  if (chains.length === 0) return { met: false, reasons: [] };

  const reasons: EndReason[] = [];
  for (const c of chains) {
    if (c.size >= END_SIZE) reasons.push({ kind: 'size41', startupId: c.id, size: c.size });
  }
  if (chains.every((c) => c.size >= SAFE_SIZE)) {
    reasons.push({ kind: 'allSafe', startupIds: chains.map((c) => c.id) });
  }
  return { met: reasons.length > 0, reasons };
}

export interface FinalScoreReport {
  reason: EndReason | null;
  players: { id: string; name: string; emoji: string; cash: number }[];
  chains: { id: StartupId; size: number; price: number }[];
  holdings: Record<string, Record<string, number>>;
  bonuses: { chainId: StartupId; playerId: string; type: 'majority' | 'minority' | 'both'; amount: number }[];
}

export function finalScore(state: GameState): FinalScoreReport {
  const chains = foundedChains(state).map((c) => ({
    id: c.id,
    size: c.size,
    price: getSharePrice(state, c.id),
  }));

  const holdings: FinalScoreReport['holdings'] = {};
  for (const p of state.players) {
    holdings[p.id] = {};
    for (const c of chains) {
      const qty = p.shares[c.id] ?? 0;
      if (qty > 0) holdings[p.id][c.id] = qty;
    }
  }

  const bonuses: FinalScoreReport['bonuses'] = [];
  for (const c of chains) {
    const perChain = computeChainBonuses(
      c.id,
      c.price,
      state.players.map((p) => ({ playerId: p.id, playerName: p.name, shares: p.shares[c.id] ?? 0 })),
    );
    for (const b of perChain) {
      bonuses.push({ chainId: c.id, playerId: b.playerId, type: b.type, amount: b.amount });
    }
  }

  return {
    reason: getEndCondition(state).reasons[0] ?? null,
    players: state.players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, cash: p.cash })),
    chains,
    holdings,
    bonuses,
  };
}
```

`finalScore` deliberately does **not** touch `state` — sorting into total order and rendering `—` for empty cells belong to the view (`finalScoring()` in `components.js` already does both).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run engine/endGame.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: 39 passed (29 + 10).

- [ ] **Step 6: Export and commit**

Add `export * from './endGame';` to `engine/index.ts`.

```bash
git add -A
git commit -m "feat(engine): end-condition query and final scoring report"
```

---

### Task 7: `applyIntent` — the reducer, and the placement segment

The single entry point everything downstream will use. It clones, validates against `stage`, delegates to the existing mutating functions, and returns. This task builds the shell plus the three placement-segment intents (`placeTile`, `chooseFoundingBrand`, `chooseSurvivor`).

**Stage machine that `applyIntent` implements** (the legacy modal functions keep their own paths untouched):

| From stage | Intent | To stage |
|---|---|---|
| `play` | `placeTile` (isolated / grow) | `buy` |
| `play` | `placeTile` (founds a chain) | `foundStartup` |
| `play` | `placeTile` (merge, clear survivor) | `mergerLiquidation` if any absorbed shares are held, else `buy` |
| `play` | `placeTile` (merge, tied survivor) | `chooseSurvivor` |
| `play` | `tradeInDeadTiles` | `play` (Task 9) |
| `play` | `endTurn` — only with no legal tile | `play`, next player (Task 9) |
| `foundStartup` | `chooseFoundingBrand` | `buy` |
| `chooseSurvivor` | `chooseSurvivor` | `mergerLiquidation` or `buy` |
| `mergerLiquidation` | `liquidate` | `mergerLiquidation` (next in queue) or `buy` (Task 8) |
| `buy` | `buyShares` | `buy` (Task 9) |
| `buy` | `declareEnd` — only when the end condition is met | `end` (Task 9) |
| `buy` | `endTurn` | `play`, next player (Task 9) |

**Merger payout is not a stage in the intent machine.** Bonuses are awarded as part of the merge transition and recorded as a `Merger payout` log entry; there is no intent to acknowledge them. The roadmap's segment table treats "pick survivor" as the commit that opens liquidation, and a payout the player cannot decline is not a decision point. The legacy `mergerPayout` stage still exists for the old modal path.

**Files:**
- Create: `engine/intents.ts`, `engine/intents.test.ts`
- Modify: `engine/index.ts`

**Interfaces:**
- Consumes: `previewPlacement` (Task 4), `computeChainBonuses` (Task 5), `getEndCondition` (Task 6), `pushLog`/`tok` (Task 2), and the existing `gameLogic.ts` internals.
- Produces:
  ```ts
  type Intent =
    | { type: 'placeTile';           playerId: string; coord: Coord }
    | { type: 'chooseFoundingBrand'; playerId: string; startupId: StartupId }
    | { type: 'chooseSurvivor';      playerId: string; startupId: StartupId }
    | { type: 'liquidate';           playerId: string; startupId: StartupId; sell: number; trade: number; keep: number }
    | { type: 'buyShares';           playerId: string; picks: StartupId[] }
    | { type: 'tradeInDeadTiles';    playerId: string; coords: Coord[] }
    | { type: 'declareEnd';          playerId: string }
    | { type: 'endTurn';             playerId: string };

  type IllegalIntentCode =
    | 'wrongStage' | 'notYourTurn' | 'tileNotInHand' | 'illegalPlacement'
    | 'brandUnavailable' | 'notATiedSurvivor' | 'shareCountMismatch'
    | 'oddTradeCount' | 'notEnoughShares' | 'notEnoughCash'
    | 'tooManyPicks' | 'notADeadTile' | 'endNotAvailable' | 'unknownIntent';

  class IllegalIntentError extends Error { readonly code: IllegalIntentCode }
  function applyIntent(state: GameState, intent: Intent): GameState;
  ```

Note the intent union is copied **verbatim** from the roadmap spec. Do not rename fields.

- [ ] **Step 1: Write the failing test**

```ts
// engine/intents.test.ts
import { describe, it, expect } from 'vitest';
import { applyIntent, IllegalIntentError } from './intents';
import { setupGameWithStartups, createTestGameState } from './testHelpers';

function playing(state = createTestGameState()) {
  state.stage = 'play';
  state.currentPlayerIndex = 0;
  return state;
}

describe('applyIntent', () => {
  it('does not mutate the state it is given', () => {
    const state = playing();
    state.players[0].hand = ['E5'];
    const before = JSON.stringify(state);
    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'E5' });
    expect(JSON.stringify(state)).toBe(before);
    expect(next).not.toBe(state);
    expect(next.board['E5'].isPlaced).toBe(true);
  });

  it('rejects an intent from a player whose turn it is not', () => {
    const state = playing();
    state.players[1].hand = ['E5'];
    expect(() => applyIntent(state, { type: 'placeTile', playerId: state.players[1].id, coord: 'E5' }))
      .toThrow(IllegalIntentError);
    try {
      applyIntent(state, { type: 'placeTile', playerId: state.players[1].id, coord: 'E5' });
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('notYourTurn');
    }
  });

  it('rejects an intent in the wrong stage', () => {
    const state = playing();
    state.stage = 'buy';
    state.players[0].hand = ['E5'];
    try {
      applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'E5' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('wrongStage');
    }
  });

  it('rejects a tile that is not in hand', () => {
    const state = playing();
    state.players[0].hand = ['E5'];
    try {
      applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'H8' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('tileNotInHand');
    }
  });

  it('sends an isolated placement straight to buy and logs it', () => {
    const state = playing();
    state.players[0].hand = ['E5', 'A1'];
    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'E5' });
    expect(next.stage).toBe('buy');
    expect(next.players[0].hand).toEqual(['A1']);
    expect(next.log.at(-1)).toMatchObject({ phase: 'Placed a tile', playerId: state.players[0].id });
  });

  it('opens the founding choice, then founds the brand and grants the free share', () => {
    const state = playing();
    state.board['E5'] = { coord: 'E5', isPlaced: true, startupId: null };
    state.players[0].hand = ['E6'];
    const placed = applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'E6' });
    expect(placed.stage).toBe('foundStartup');

    const founded = applyIntent(placed, {
      type: 'chooseFoundingBrand', playerId: state.players[0].id, startupId: 'Messla',
    });
    expect(founded.stage).toBe('buy');
    expect(founded.startups.find((s) => s.id === 'Messla')!.isFounded).toBe(true);
    expect(founded.players[0].shares['Messla']).toBe(1);
    expect(founded.startups.find((s) => s.id === 'Messla')!.availableShares).toBe(24);
    expect(founded.board['E5'].startupId).toBe('Messla');
    expect(founded.board['E6'].startupId).toBe('Messla');
  });

  it('rejects founding with a brand already on the board', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    state.stage = 'foundStartup';
    state.currentPlayerIndex = 0;
    state.pendingFoundTile = 'H8';
    try {
      applyIntent(state, { type: 'chooseFoundingBrand', playerId: state.players[0].id, startupId: 'Messla' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('brandUnavailable');
    }
  });

  it('pays merger bonuses on the merge transition without a payout stage', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 6, tier: 0 },
      { id: 'ZuckFace', tiles: 3, tier: 1 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    const [alex] = state.players;
    alex.hand = ['C1'];
    alex.cash = 0;
    alex.shares['ZuckFace'] = 3;   // sole holder of the absorbed chain

    const next = applyIntent(state, { type: 'placeTile', playerId: alex.id, coord: 'C1' });
    expect(next.stage).toBe('mergerLiquidation');
    // ZuckFace at 3 tiles, tier 1 → price 400; sole holder → 400 × 15
    expect(next.players[0].cash).toBe(6000);
    expect(next.log.some((e) => e.phase === 'Merger payout')).toBe(true);
  });

  it('goes straight to buy after a merge nobody held shares in', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 6, tier: 0 },
      { id: 'ZuckFace', tiles: 3, tier: 1 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    state.players[0].hand = ['C1'];
    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'C1' });
    expect(next.stage).toBe('buy');
    expect(next.startups.find((s) => s.id === 'ZuckFace')!.isFounded).toBe(false);
  });

  it('asks for a survivor when the merge is tied, and rejects a non-tied pick', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 4, tier: 0 },
      { id: 'ZuckFace', tiles: 4, tier: 1 },
      { id: 'Gobble',   tiles: 2, tier: 2 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    state.players[0].hand = ['C1'];

    const placed = applyIntent(state, { type: 'placeTile', playerId: state.players[0].id, coord: 'C1' });
    expect(placed.stage).toBe('chooseSurvivor');

    try {
      applyIntent(placed, { type: 'chooseSurvivor', playerId: state.players[0].id, startupId: 'Gobble' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('notATiedSurvivor');
    }

    const merged = applyIntent(placed, {
      type: 'chooseSurvivor', playerId: state.players[0].id, startupId: 'Messla',
    });
    expect(merged.startups.find((s) => s.id === 'ZuckFace')!.isFounded).toBe(false);
    expect(merged.board['D1'].startupId).toBe('Messla');
  });

  it('rejects an unknown intent type', () => {
    const state = playing();
    try {
      applyIntent(state, { type: 'nope' } as never);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('unknownIntent');
    }
  });
});
```

Before implementing, run the fixture helper and print a board to confirm where `setupGameWithStartups` puts each chain — the `C1` / `D1` coords above assume row-per-chain layout. Adjust coords to fit the helper; keep every assertion.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/intents.test.ts`
Expected: FAIL — `Failed to resolve import './intents'`.

- [ ] **Step 3: Write the reducer shell**

```ts
// engine/intents.ts
import type { Coord, GameState, StartupId } from './gameTypes';
import { previewPlacement } from './placement';
import { computeChainBonuses } from './bonuses';
import { getSharePrice } from './gameLogic';
import { pushLog, tok } from './log';

export type Intent =
  | { type: 'placeTile';           playerId: string; coord: Coord }
  | { type: 'chooseFoundingBrand'; playerId: string; startupId: StartupId }
  | { type: 'chooseSurvivor';      playerId: string; startupId: StartupId }
  | { type: 'liquidate';           playerId: string; startupId: StartupId; sell: number; trade: number; keep: number }
  | { type: 'buyShares';           playerId: string; picks: StartupId[] }
  | { type: 'tradeInDeadTiles';    playerId: string; coords: Coord[] }
  | { type: 'declareEnd';          playerId: string }
  | { type: 'endTurn';             playerId: string };

export type IllegalIntentCode =
  | 'wrongStage' | 'notYourTurn' | 'tileNotInHand' | 'illegalPlacement'
  | 'brandUnavailable' | 'notATiedSurvivor' | 'shareCountMismatch'
  | 'oddTradeCount' | 'notEnoughShares' | 'notEnoughCash'
  | 'tooManyPicks' | 'notADeadTile' | 'endNotAvailable' | 'unknownIntent';

export class IllegalIntentError extends Error {
  readonly code: IllegalIntentCode;
  constructor(code: IllegalIntentCode, message?: string) {
    super(message ?? code);
    this.name = 'IllegalIntentError';
    this.code = code;
  }
}

function reject(code: IllegalIntentCode, message?: string): never {
  throw new IllegalIntentError(code, message);
}

function requireStage(state: GameState, ...stages: GameState['stage'][]): void {
  if (!stages.includes(state.stage)) {
    reject('wrongStage', `expected ${stages.join(' | ')}, got ${state.stage}`);
  }
}

function requireCurrentPlayer(state: GameState, playerId: string) {
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.id !== playerId) reject('notYourTurn');
  return player;
}

export function applyIntent(state: GameState, intent: Intent): GameState {
  const next = structuredClone(state);
  switch (intent.type) {
    case 'placeTile':           doPlaceTile(next, intent); break;
    case 'chooseFoundingBrand': doChooseFoundingBrand(next, intent); break;
    case 'chooseSurvivor':      doChooseSurvivor(next, intent); break;
    default:                    reject('unknownIntent', `no handler for ${(intent as Intent).type}`);
  }
  return next;
}
```

Tasks 8 and 9 add the remaining `case` arms in the same switch.

- [ ] **Step 4: Implement `placeTile`**

```ts
// engine/intents.ts (continued)
import { getStartupSize } from './gameHelpers';

/** Award merger bonuses for the absorbed chains and log them. Mutates. */
function payMergerBonuses(state: GameState, absorbedIds: StartupId[]): void {
  const all = [];
  for (const absorbedId of absorbedIds) {
    const price = getSharePrice(state, absorbedId);
    all.push(...computeChainBonuses(
      absorbedId,
      price,
      state.players.map((p) => ({ playerId: p.id, playerName: p.name, shares: p.shares[absorbedId] ?? 0 })),
    ));
  }
  state.pendingBonuses = all;
  for (const b of all) {
    const player = state.players.find((p) => p.id === b.playerId)!;
    player.cash += b.amount;
    const label = b.type === 'both' ? 'Majority + minority' : b.type === 'majority' ? 'Majority' : 'Minority';
    pushLog(state, 'Merger payout', [
      tok.text(`${label} · `), tok.brand(b.startupId), tok.text(' '), tok.cash(b.amount, true),
    ], b.playerId);
  }
}

/** Anyone still holding shares in an absorbed chain must liquidate. */
function openLiquidations(state: GameState, survivorId: StartupId, absorbedIds: StartupId[]): boolean {
  const queue: { playerId: string; startupId: StartupId }[] = [];
  // seat order starting from the current player
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[(state.currentPlayerIndex + i) % state.players.length];
    for (const absorbedId of absorbedIds) {
      if ((p.shares[absorbedId] ?? 0) > 0) queue.push({ playerId: p.id, startupId: absorbedId });
    }
  }
  if (queue.length === 0) return false;
  state.mergerContext = { survivorId, absorbedIds, queue, index: 0 };
  state.stage = 'mergerLiquidation';
  return true;
}

function doPlaceTile(state: GameState, intent: Extract<Intent, { type: 'placeTile' }>): void {
  requireStage(state, 'play');
  const player = requireCurrentPlayer(state, intent.playerId);
  if (!player.hand.includes(intent.coord)) reject('tileNotInHand');

  const preview = previewPlacement(state, intent.coord, player.id);
  if (!preview.legal) reject('illegalPlacement', preview.block);

  player.hand = player.hand.filter((c) => c !== intent.coord);
  state.board[intent.coord] = { coord: intent.coord, isPlaced: true, startupId: null };
  pushLog(state, 'Placed a tile', [tok.tile(intent.coord)], player.id);

  if (preview.kind === 'isolated') {
    state.stage = 'buy';
    return;
  }

  if (preview.kind === 'found') {
    state.pendingFoundTile = intent.coord;
    state.stage = 'foundStartup';
    return;
  }

  if (preview.kind === 'grow') {
    absorbInto(state, preview.touchingIds[0], intent.coord);
    state.stage = 'buy';
    return;
  }

  // merge
  if (preview.tiedSurvivorIds) {
    state.pendingMergeTile = intent.coord;
    state.pendingTiedSurvivors = preview.tiedSurvivorIds;
    state.stage = 'chooseSurvivor';
    return;
  }
  commitMerge(state, preview.survivorId!, preview.absorbedIds, intent.coord);
}
```

`absorbInto(state, startupId, coord)` and `commitMerge(state, survivorId, absorbedIds, coord)` are the two shared mutators. `gameLogic.ts` already contains equivalent inline code inside `placeTile`; **extract it into these two exported functions in `gameLogic.ts` and call them from both places** rather than duplicating. Their contracts:

```ts
// engine/gameLogic.ts — extracted, exported
/** Paint the placed tile and every unclaimed tile connected to it into startupId. */
export function absorbInto(state: GameState, startupId: StartupId, coord: Coord): void;

/** Repaint absorbed tiles to the survivor, pay bonuses, mark absorbed chains unfounded,
 *  return their shares to the pool, and open liquidations if anyone still holds any. */
export function commitMerge(
  state: GameState, survivorId: StartupId, absorbedIds: StartupId[], coord: Coord,
): void;
```

```ts
// engine/gameLogic.ts
export function commitMerge(state, survivorId, absorbedIds, coord) {
  pushLog(state, 'Merger', [
    tok.brand(survivorId), tok.text(' absorbs '),
    ...absorbedIds.flatMap((id, i) => (i ? [tok.text(', '), tok.brand(id)] : [tok.brand(id)])),
  ]);
  payMergerBonuses(state, absorbedIds);
  const opened = openLiquidations(state, survivorId, absorbedIds);
  for (const coordKey of Object.keys(state.board) as Coord[]) {
    const cell = state.board[coordKey];
    if (cell.startupId && absorbedIds.includes(cell.startupId)) cell.startupId = survivorId;
  }
  absorbInto(state, survivorId, coord);
  for (const id of absorbedIds) {
    const s = state.startups.find((x) => x.id === id)!;
    s.isFounded = false;
    s.availableShares = s.totalShares;
  }
  if (!opened) state.stage = 'buy';
}
```

Bonuses are computed **before** the board is repainted, so the absorbed chain's price still reflects its own size. Keep that ordering. `payMergerBonuses` and `openLiquidations` live in `intents.ts`; import them into `gameLogic.ts`, or move all three into `intents.ts` and have `gameLogic.ts` import `commitMerge` — either is fine as long as there is exactly one copy. Watch for an import cycle: if one appears, put `absorbInto` / `commitMerge` in a new `engine/merge.ts` that both import.

- [ ] **Step 5: Implement `chooseFoundingBrand` and `chooseSurvivor`**

```ts
// engine/intents.ts (continued)
function doChooseFoundingBrand(state: GameState, intent: Extract<Intent, { type: 'chooseFoundingBrand' }>): void {
  requireStage(state, 'foundStartup');
  const player = requireCurrentPlayer(state, intent.playerId);

  const startup = state.startups.find((s) => s.id === intent.startupId);
  if (!startup || startup.isFounded) reject('brandUnavailable');

  const coord = state.pendingFoundTile;
  if (!coord) reject('illegalPlacement', 'no pending founding tile');

  startup.isFounded = true;
  absorbInto(state, startup.id, coord);

  // founder's free share, if any remain
  if (startup.availableShares > 0) {
    startup.availableShares -= 1;
    player.shares[startup.id] = (player.shares[startup.id] ?? 0) + 1;
  }

  pushLog(state, 'Founded a brand', [
    tok.brand(startup.id), tok.text(' at '), tok.tile(coord),
    tok.text(' · founder share '), tok.stack(startup.id, 1),
  ], player.id);

  state.pendingFoundTile = undefined;
  state.stage = 'buy';
}

function doChooseSurvivor(state: GameState, intent: Extract<Intent, { type: 'chooseSurvivor' }>): void {
  requireStage(state, 'chooseSurvivor');
  requireCurrentPlayer(state, intent.playerId);

  const tied = state.pendingTiedSurvivors ?? [];
  if (!tied.includes(intent.startupId)) reject('notATiedSurvivor');

  const coord = state.pendingMergeTile!;
  const absorbedIds = tied.filter((id) => id !== intent.startupId);
  // any non-tied smaller chains the tile also touches are absorbed too
  const preview = previewPlacement({ ...state, board: { ...state.board, [coord]: { coord, isPlaced: false, startupId: null } } } as GameState, coord);
  for (const id of preview.touchingIds) {
    if (id !== intent.startupId && !absorbedIds.includes(id)) absorbedIds.push(id);
  }

  state.pendingTiedSurvivors = undefined;
  state.pendingMergeTile = undefined;
  commitMerge(state, intent.startupId, absorbedIds, coord);
}
```

- [ ] **Step 6: Add the new pending fields to `GameState`**

```ts
// engine/gameTypes.ts — in GameState
  pendingFoundTile?: Coord;
  pendingMergeTile?: Coord;
  pendingTiedSurvivors?: StartupId[];
```

If any of these already exist under a different name in `gameTypes.ts`, **reuse the existing field** and change the code above to match. Do not add a parallel second field for the same concept.

`mergerContext` gains the liquidation queue:

```ts
export interface MergerContext {
  survivorId: StartupId;
  absorbedIds: StartupId[];
  queue: { playerId: string; startupId: StartupId }[];
  index: number;
}
```

The legacy modal path also uses `mergerContext`; if its shape differs, widen this interface with optional fields rather than replacing the ones the old code reads — the 8 existing tests must keep passing.

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run engine/intents.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: 50 passed (39 + 11).

- [ ] **Step 9: Export and commit**

Add `export * from './intents';` to `engine/index.ts`.

```bash
git add -A
git commit -m "feat(engine): applyIntent reducer with the placement segment"
```

---

### Task 8: `liquidate`

The absorbed-chain holders resolve their shares one at a time, in seat order starting from the merging player. `sell + trade + keep` must equal what they hold, `trade` must be even (2-for-1), and the survivor must have enough shares in its pool to honour the trade.

**Files:**
- Modify: `engine/intents.ts`, `engine/intents.test.ts`

**Interfaces:**
- Consumes: `MergerContext` and `commitMerge` from Task 7.
- Produces: the `liquidate` arm of `applyIntent`; no new exported symbols.

- [ ] **Step 1: Write the failing test (append to `engine/intents.test.ts`)**

```ts
describe('applyIntent — liquidate', () => {
  function merged() {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 6, tier: 0 },
      { id: 'ZuckFace', tiles: 3, tier: 1 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    const [alex, sam] = state.players;
    alex.hand = ['C1'];
    alex.cash = 0; sam.cash = 0;
    alex.shares['ZuckFace'] = 4;
    sam.shares['ZuckFace'] = 2;
    return { state: applyIntent(state, { type: 'placeTile', playerId: alex.id, coord: 'C1' }), alex, sam };
  }

  it('queues every holder of the absorbed chain in seat order', () => {
    const { state, alex, sam } = merged();
    expect(state.stage).toBe('mergerLiquidation');
    expect(state.mergerContext!.queue.map((q) => q.playerId)).toEqual([alex.id, sam.id]);
    expect(state.mergerContext!.index).toBe(0);
  });

  it('sells at the absorbed price, trades two-for-one and keeps the rest', () => {
    const { state, alex } = merged();
    const cashBefore = state.players[0].cash;
    // ZuckFace 3 tiles tier 1 → $400
    const next = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 2, keep: 1,
    });
    expect(next.players[0].cash).toBe(cashBefore + 400);
    expect(next.players[0].shares['ZuckFace']).toBe(1);
    expect(next.players[0].shares['Messla']).toBe(1);          // 2 traded → 1 survivor share
    expect(next.mergerContext!.index).toBe(1);
    expect(next.stage).toBe('mergerLiquidation');
  });

  it('returns to buy once the queue is exhausted', () => {
    const { state, alex, sam } = merged();
    const a = applyIntent(state, { type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 4, trade: 0, keep: 0 });
    const b = applyIntent(a,     { type: 'liquidate', playerId: sam.id,  startupId: 'ZuckFace', sell: 0, trade: 2, keep: 0 });
    expect(b.stage).toBe('buy');
  });

  it('rejects counts that do not add up to the holding', () => {
    const { state, alex } = merged();
    try {
      applyIntent(state, { type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 1, keep: 1 });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('shareCountMismatch'); }
  });

  it('rejects an odd trade count', () => {
    const { state, alex } = merged();
    try {
      applyIntent(state, { type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 0, trade: 3, keep: 1 });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('oddTradeCount'); }
  });

  it('rejects a trade the survivor pool cannot cover', () => {
    const { state, alex } = merged();
    state.startups.find((s) => s.id === 'Messla')!.availableShares = 1;
    try {
      applyIntent(state, { type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 0, trade: 4, keep: 0 });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('notEnoughShares'); }
  });

  it('rejects a liquidation from a player who is not at the head of the queue', () => {
    const { state, sam } = merged();
    try {
      applyIntent(state, { type: 'liquidate', playerId: sam.id, startupId: 'ZuckFace', sell: 2, trade: 0, keep: 0 });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('notYourTurn'); }
  });

  it('logs what was done with the shares', () => {
    const { state, alex } = merged();
    const next = applyIntent(state, { type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 2, trade: 2, keep: 0 });
    expect(next.log.at(-1)).toMatchObject({ phase: 'Liquidated shares', playerId: alex.id });
  });
});
```

Note the liquidation price is the **absorbed** chain's price captured at merge time. Because `commitMerge` repaints the board before liquidation runs, `getSharePrice(state, absorbedId)` would return 0 by then — so the price must be stashed. Add `prices: Record<string, number>` to `MergerContext` and fill it in `payMergerBonuses`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/intents.test.ts`
Expected: FAIL — `no handler for liquidate` (the `unknownIntent` rejection) on every new test.

- [ ] **Step 3: Stash the absorbed prices at merge time**

```ts
// engine/gameTypes.ts — MergerContext
  prices: Record<string, number>;   // absorbed startupId → price at the moment of merging
```

```ts
// in payMergerBonuses, before repainting
const prices: Record<string, number> = {};
for (const absorbedId of absorbedIds) prices[absorbedId] = getSharePrice(state, absorbedId);
// …pass `prices` through to openLiquidations and store on state.mergerContext
```

- [ ] **Step 4: Implement the handler**

```ts
// engine/intents.ts
function doLiquidate(state: GameState, intent: Extract<Intent, { type: 'liquidate' }>): void {
  requireStage(state, 'mergerLiquidation');
  const ctx = state.mergerContext;
  if (!ctx) reject('wrongStage', 'no merger in progress');

  const head = ctx.queue[ctx.index];
  if (!head || head.playerId !== intent.playerId) reject('notYourTurn');
  if (head.startupId !== intent.startupId) reject('wrongStage', 'wrong chain for this queue entry');

  const player = state.players.find((p) => p.id === intent.playerId)!;
  const held = player.shares[intent.startupId] ?? 0;
  const { sell, trade, keep } = intent;

  if (sell < 0 || trade < 0 || keep < 0) reject('shareCountMismatch');
  if (sell + trade + keep !== held) reject('shareCountMismatch', `holds ${held}`);
  if (trade % 2 !== 0) reject('oddTradeCount');

  const survivor = state.startups.find((s) => s.id === ctx.survivorId)!;
  const gained = trade / 2;
  if (gained > survivor.availableShares) reject('notEnoughShares');

  const price = ctx.prices[intent.startupId] ?? 0;
  const absorbed = state.startups.find((s) => s.id === intent.startupId)!;

  player.cash += sell * price;
  absorbed.availableShares += sell + trade;
  survivor.availableShares -= gained;
  player.shares[ctx.survivorId] = (player.shares[ctx.survivorId] ?? 0) + gained;
  player.shares[intent.startupId] = keep;
  if (keep === 0) delete player.shares[intent.startupId];

  const detail = [];
  if (sell)  detail.push(tok.text('sold '),   tok.stack(intent.startupId, sell),  tok.text(' '), tok.cash(sell * price, true));
  if (trade) detail.push(tok.text(' traded '), tok.stack(intent.startupId, trade), tok.text(' → '), tok.stack(ctx.survivorId, gained));
  if (keep)  detail.push(tok.text(' kept '),   tok.stack(intent.startupId, keep));
  pushLog(state, 'Liquidated shares', detail.length ? detail : [tok.text('nothing to resolve')], player.id);

  ctx.index += 1;
  if (ctx.index >= ctx.queue.length) {
    state.mergerContext = undefined;
    state.stage = 'buy';
  }
}
```

Note `absorbed.availableShares` is topped back up here and also reset to `totalShares` in `commitMerge`. Pick one: `commitMerge` should **not** reset `availableShares` when liquidations are opened, because held shares are still outstanding. Change `commitMerge` to only reset the pool for absorbed chains that nobody holds.

Wire it into the switch:

```ts
    case 'liquidate': doLiquidate(next, intent); break;
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run engine/intents.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 6: Run the full suite and commit**

Run: `npx vitest run`
Expected: 58 passed.

```bash
git add -A
git commit -m "feat(engine): liquidate intent with sell/trade/keep validation"
```

---

### Task 9: `buyShares`, `endTurn`, `tradeInDeadTiles`, `declareEnd`

Completes the intent surface.

- **`buyShares`** — up to 3 per turn in total, cumulative across calls, only from founded chains with stock left, and only if the player can pay for all picks at once.
- **`endTurn`** — draws back up to 6 and advances the turn. Legal from `buy` always, and from `play` only when the player has no legal tile at all (G12).
- **`tradeInDeadTiles`** — swaps dead tiles for fresh ones and **the turn continues** (`prototype/scenario-dead-tile.html` is the reference).
- **`declareEnd`** — only when `getEndCondition(state).met`; moves to `end`. A player may decline (G11) simply by calling `endTurn` instead.

**Files:**
- Modify: `engine/intents.ts`, `engine/intents.test.ts`

**Interfaces:**
- Consumes: `getEndCondition` (Task 6), `isDeadTile` / `getDeadTilesInHand` / `previewPlacement` (Task 4).
- Produces: the remaining four arms of `applyIntent`; no new exported symbols.

- [ ] **Step 1: Write the failing test (append to `engine/intents.test.ts`)**

```ts
describe('applyIntent — buy, end turn, trade-in, declare end', () => {
  function buying() {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 3, tier: 0 },   // $300
      { id: 'ZuckFace', tiles: 2, tier: 1 },   // $300
    ]);
    state.stage = 'buy';
    state.currentPlayerIndex = 0;
    state.currentBuyCount = 0;
    state.players[0].cash = 1000;
    state.players[0].hand = ['H8'];
    return state;
  }

  it('buys shares, charging cash and drawing down the pool', () => {
    const state = buying();
    const next = applyIntent(state, { type: 'buyShares', playerId: state.players[0].id, picks: ['Messla', 'Messla'] });
    expect(next.players[0].cash).toBe(1000 - 600);
    expect(next.players[0].shares['Messla']).toBe(2);
    expect(next.startups.find((s) => s.id === 'Messla')!.availableShares).toBe(23);
    expect(next.currentBuyCount).toBe(2);
    expect(next.stage).toBe('buy');
    expect(next.log.at(-1)).toMatchObject({ phase: 'Bought shares' });
  });

  it('caps the turn at three shares across calls', () => {
    const state = buying();
    const one = applyIntent(state, { type: 'buyShares', playerId: state.players[0].id, picks: ['Messla', 'Messla'] });
    try {
      applyIntent(one, { type: 'buyShares', playerId: state.players[0].id, picks: ['Messla', 'Messla'] });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('tooManyPicks'); }
  });

  it('rejects a basket the player cannot afford, buying nothing', () => {
    const state = buying();
    state.players[0].cash = 500;
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0].id, picks: ['Messla', 'ZuckFace'] });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('notEnoughCash'); }
  });

  it('rejects buying an unfounded brand or one with an empty pool', () => {
    const state = buying();
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0].id, picks: ['Gobble'] });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('brandUnavailable'); }

    state.startups.find((s) => s.id === 'Messla')!.availableShares = 0;
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0].id, picks: ['Messla'] });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('notEnoughShares'); }
  });

  it('ends the turn: refills the hand, resets the buy count, advances the player', () => {
    const state = buying();
    state.bag = ['A9', 'A10', 'A11', 'A12', 'B9', 'B10'];
    state.players[0].hand = ['H8'];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0].id });
    expect(next.players[0].hand).toHaveLength(6);
    expect(next.currentBuyCount).toBe(0);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.stage).toBe('play');
    expect(next.log.some((e) => e.phase === 'Drew tiles')).toBe(true);
  });

  it('does not refill past what the bag holds', () => {
    const state = buying();
    state.bag = ['A9'];
    state.players[0].hand = ['H8'];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0].id });
    expect(next.players[0].hand).toHaveLength(2);
    expect(next.bag).toEqual([]);
  });

  it('allows ending the turn from play only when no tile is playable', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 11, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    state.players[0].hand = ['C1'];          // the only tile, and it is dead
    state.bag = [];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0].id });
    expect(next.currentPlayerIndex).toBe(1);

    const playable = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    playable.stage = 'play';
    playable.currentPlayerIndex = 0;
    playable.players[0].hand = ['H8'];
    try {
      applyIntent(playable, { type: 'endTurn', playerId: playable.players[0].id });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('wrongStage'); }
  });

  it('trades in dead tiles and leaves the turn running', () => {
    const state = setupGameWithStartups([
      { id: 'Messla',   tiles: 11, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    state.players[0].hand = ['C1', 'G6'];
    state.bag = ['I12'];
    const next = applyIntent(state, { type: 'tradeInDeadTiles', playerId: state.players[0].id, coords: ['C1'] });
    expect(next.stage).toBe('play');
    expect(next.players[0].hand).toEqual(['G6', 'I12']);
    expect(next.bag).toEqual([]);
    expect(next.log.at(-1)).toMatchObject({ phase: 'Traded a tile' });
  });

  it('refuses to trade in a tile that is merely awkward', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    state.stage = 'play';
    state.currentPlayerIndex = 0;
    state.players[0].hand = ['H8'];
    try {
      applyIntent(state, { type: 'tradeInDeadTiles', playerId: state.players[0].id, coords: ['H8'] });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('notADeadTile'); }
  });

  it('declares the end only when the condition is met', () => {
    const notYet = buying();
    try {
      applyIntent(notYet, { type: 'declareEnd', playerId: notYet.players[0].id });
      throw new Error('should have thrown');
    } catch (e) { expect((e as IllegalIntentError).code).toBe('endNotAvailable'); }

    const over = setupGameWithStartups([{ id: 'Gobble', tiles: 41, tier: 2 }]);
    over.stage = 'buy';
    over.currentPlayerIndex = 0;
    const ended = applyIntent(over, { type: 'declareEnd', playerId: over.players[0].id });
    expect(ended.stage).toBe('end');
    expect(ended.log.at(-1)).toMatchObject({ phase: 'Game over' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/intents.test.ts`
Expected: FAIL — `no handler for buyShares` etc.

- [ ] **Step 3: Implement the four handlers**

```ts
// engine/intents.ts
import { getEndCondition } from './endGame';
import { isDeadTile } from './placement';

const MAX_BUYS_PER_TURN = 3;
const HAND_SIZE = 6;

function doBuyShares(state: GameState, intent: Extract<Intent, { type: 'buyShares' }>): void {
  requireStage(state, 'buy');
  const player = requireCurrentPlayer(state, intent.playerId);
  const already = state.currentBuyCount ?? 0;
  if (already + intent.picks.length > MAX_BUYS_PER_TURN) reject('tooManyPicks');

  // price and stock the whole basket before charging anything
  const wanted: Record<string, number> = {};
  let total = 0;
  for (const id of intent.picks) {
    const s = state.startups.find((x) => x.id === id);
    if (!s || !s.isFounded) reject('brandUnavailable');
    wanted[id] = (wanted[id] ?? 0) + 1;
    if (wanted[id] > s.availableShares) reject('notEnoughShares');
    total += getSharePrice(state, id);
  }
  if (total > player.cash) reject('notEnoughCash');

  player.cash -= total;
  for (const id of intent.picks) {
    state.startups.find((x) => x.id === id)!.availableShares -= 1;
    player.shares[id] = (player.shares[id] ?? 0) + 1;
  }
  state.currentBuyCount = already + intent.picks.length;

  const detail = Object.entries(wanted).flatMap(([id, n], i) =>
    i ? [tok.text(', '), tok.stack(id as StartupId, n)] : [tok.stack(id as StartupId, n)]);
  pushLog(state, 'Bought shares', [...detail, tok.text(' '), tok.cash(-total, true)], player.id);
}

function hasLegalTile(state: GameState, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  return !!player && player.hand.some((c) => previewPlacement(state, c, playerId).legal);
}

function drawUpTo(state: GameState, playerId: string, size = HAND_SIZE): Coord[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const drawn: Coord[] = [];
  while (player.hand.length < size && state.bag.length > 0) {
    const tile = state.bag.shift()!;
    player.hand.push(tile);
    drawn.push(tile);
  }
  return drawn;
}

function doEndTurn(state: GameState, intent: Extract<Intent, { type: 'endTurn' }>): void {
  if (state.stage === 'play') {
    if (hasLegalTile(state, intent.playerId)) reject('wrongStage', 'you must place a tile');
  } else {
    requireStage(state, 'buy');
  }
  const player = requireCurrentPlayer(state, intent.playerId);

  const drawn = drawUpTo(state, player.id);
  if (drawn.length > 0) {
    pushLog(state, 'Drew tiles', [tok.text(`${drawn.length} tile${drawn.length === 1 ? '' : 's'}`)], player.id);
  }
  pushLog(state, 'Ended turn', [tok.text('')], player.id);

  state.currentBuyCount = 0;
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.stage = 'play';
}

function doTradeInDeadTiles(state: GameState, intent: Extract<Intent, { type: 'tradeInDeadTiles' }>): void {
  requireStage(state, 'play');
  const player = requireCurrentPlayer(state, intent.playerId);

  for (const c of intent.coords) {
    if (!player.hand.includes(c)) reject('tileNotInHand');
    if (!isDeadTile(state, c)) reject('notADeadTile', c);
  }

  for (const c of intent.coords) {
    player.hand = player.hand.filter((x) => x !== c);
    const replacement = state.bag.shift();
    const detail = [tok.tile(c)];
    if (replacement) {
      player.hand.push(replacement);
      detail.push(tok.text(' → drew '), tok.tile(replacement));
    } else {
      detail.push(tok.text(' → bag empty'));
    }
    pushLog(state, 'Traded a tile', detail, player.id);
  }
  // stage stays 'play' — the turn continues
}

function doDeclareEnd(state: GameState, intent: Extract<Intent, { type: 'declareEnd' }>): void {
  requireStage(state, 'buy');
  requireCurrentPlayer(state, intent.playerId);
  const condition = getEndCondition(state);
  if (!condition.met) reject('endNotAvailable');

  const reason = condition.reasons[0];
  pushLog(state, 'Game over', reason.kind === 'size41'
    ? [tok.brand(reason.startupId), tok.text(` reached ${reason.size} tiles`)]
    : [tok.text('every brand on the board is safe')], intent.playerId);
  state.stage = 'end';
}
```

Wire all four into the switch:

```ts
    case 'buyShares':        doBuyShares(next, intent); break;
    case 'endTurn':          doEndTurn(next, intent); break;
    case 'tradeInDeadTiles': doTradeInDeadTiles(next, intent); break;
    case 'declareEnd':       doDeclareEnd(next, intent); break;
```

If `GameState` has no `currentBuyCount`, add `currentBuyCount: number;` to `gameTypes.ts` and initialise it to `0` in `createInitialGame` and `createTestGameState`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run engine/intents.test.ts`
Expected: PASS, 29 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run`
Expected: 68 passed.

```bash
git add -A
git commit -m "feat(engine): buy, end-turn, dead-tile trade-in and declare-end intents"
```

---

### Task 10: The golden-game runner

Golden games are **plain data** — an authored fixture, an ordered list of intents, and per-step assertions. One runner executes them all. Keeping them declarative is what lets Phase 1 reuse the same files as catalog fixtures and Phase 3 replay them against the protocol.

Fixtures are **authored, not played**: `prototype/scenario-win-41.html` proves the point — you cannot reach a 40-tile board by playing turns in a test.

**Files:**
- Create: `engine/golden/types.ts`, `engine/golden/fixtures.ts`, `engine/golden/runner.ts`, `engine/golden/index.ts`, `engine/golden/golden.test.ts`, `engine/golden/fixtures.test.ts`

**Interfaces:**
- Consumes: `applyIntent`, `IllegalIntentError`, `IllegalIntentCode` (Tasks 7–9); `finalScore` (Task 6).
- Produces:
  ```ts
  interface FixtureSpec {
    players: { name: string; cash?: number; hand?: Coord[]; shares?: Record<string, number> }[];
    chains?: { id: StartupId; coords: Coord[] }[];
    loners?: Coord[];
    bag?: Coord[];
    stage?: Stage;
    currentPlayerIndex?: number;
  }
  interface StateAssertion {
    stage?: Stage;
    currentPlayer?: string;
    cash?: Record<string, number>;
    shares?: Record<string, Record<string, number>>;
    chainSize?: Record<string, number>;
    founded?: Record<string, boolean>;
    availableShares?: Record<string, number>;
    hand?: Record<string, Coord[]>;
    boardOwner?: Record<string, StartupId | null>;
    logPhases?: string[];
    bonuses?: { playerId: string; startupId: StartupId; type: string; amount: number }[];
    finalScoreTotals?: Record<string, number>;
  }
  interface GoldenStep { name: string; intent: Intent; expectError?: IllegalIntentCode; then?: StateAssertion }
  interface GoldenGame { id: string; title: string; setup: FixtureSpec; steps: GoldenStep[]; final?: StateAssertion }
  function buildFixture(spec: FixtureSpec): GameState;
  function runGoldenGame(game: GoldenGame): GameState;
  function assertState(state: GameState, a: StateAssertion, where: string, addedLogFrom?: number): void;
  const ALL_GOLDEN_GAMES: GoldenGame[];
  ```

Player ids are always `p1`, `p2`, … in the order given, so golden games can name them as literals.

- [ ] **Step 1: Write the failing fixture test**

```ts
// engine/golden/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { buildFixture } from './fixtures';
import { getStartupSize } from '../gameHelpers';

describe('buildFixture', () => {
  it('paints authored chains onto the board and marks them founded', () => {
    const state = buildFixture({
      players: [{ name: 'Alex' }, { name: 'Sam' }],
      chains: [{ id: 'Messla', coords: ['B1', 'B2', 'B3'] }],
    });
    expect(getStartupSize(state, 'Messla')).toBe(3);
    expect(state.board['B2']).toEqual({ coord: 'B2', isPlaced: true, startupId: 'Messla' });
    expect(state.startups.find((s) => s.id === 'Messla')!.isFounded).toBe(true);
  });

  it('places loners as owned by nobody', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], loners: ['E5'] });
    expect(state.board['E5']).toEqual({ coord: 'E5', isPlaced: true, startupId: null });
  });

  it('gives players ids p1..pN, plus authored cash, hand and shares', () => {
    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 4200, hand: ['C6'], shares: { Messla: 4 } },
        { name: 'Sam' },
      ],
      chains: [{ id: 'Messla', coords: ['B1', 'B2'] }],
    });
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.players[0]).toMatchObject({ cash: 4200, hand: ['C6'], shares: { Messla: 4 } });
    expect(state.players[1].cash).toBe(6000);
    expect(state.players[1].emoji.length).toBeGreaterThan(0);
  });

  it('draws authored shares out of the pool so totals stay consistent', () => {
    const state = buildFixture({
      players: [{ name: 'Alex', shares: { Messla: 4 } }, { name: 'Sam', shares: { Messla: 2 } }],
      chains: [{ id: 'Messla', coords: ['B1', 'B2'] }],
    });
    expect(state.startups.find((s) => s.id === 'Messla')!.availableShares).toBe(25 - 6);
  });

  it('defaults to stage play, player 1, and an empty bag unless authored', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }] });
    expect(state.stage).toBe('play');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.bag).toEqual([]);
    expect(state.log).toEqual([]);
    expect(state.nextStepId).toBe(1);
  });

  it('rejects a chain painted over an already-occupied square', () => {
    expect(() => buildFixture({
      players: [{ name: 'Alex' }],
      chains: [{ id: 'Messla', coords: ['B1'] }, { id: 'ZuckFace', coords: ['B1'] }],
    })).toThrow(/B1/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run engine/golden/fixtures.test.ts`
Expected: FAIL — `Failed to resolve import './fixtures'`.

- [ ] **Step 3: Write `engine/golden/types.ts`**

```ts
// engine/golden/types.ts
import type { Coord, GameState, Stage, StartupId } from '../gameTypes';
import type { Intent, IllegalIntentCode } from '../intents';

export interface FixtureSpec {
  players: { name: string; cash?: number; hand?: Coord[]; shares?: Record<string, number> }[];
  chains?: { id: StartupId; coords: Coord[] }[];
  loners?: Coord[];
  bag?: Coord[];
  stage?: Stage;
  currentPlayerIndex?: number;
}

export interface StateAssertion {
  stage?: Stage;
  currentPlayer?: string;
  cash?: Record<string, number>;
  shares?: Record<string, Record<string, number>>;
  chainSize?: Record<string, number>;
  founded?: Record<string, boolean>;
  availableShares?: Record<string, number>;
  hand?: Record<string, Coord[]>;
  boardOwner?: Record<string, StartupId | null>;
  /** phases of the log entries this step appended, in order */
  logPhases?: string[];
  bonuses?: { playerId: string; startupId: StartupId; type: string; amount: number }[];
  /** playerId → stock + bonus + cash, from finalScore() */
  finalScoreTotals?: Record<string, number>;
}

export interface GoldenStep {
  name: string;
  intent: Intent;
  /** when set, the step must be REJECTED with this code and the state must not change */
  expectError?: IllegalIntentCode;
  then?: StateAssertion;
}

export interface GoldenGame {
  id: string;
  title: string;
  setup: FixtureSpec;
  steps: GoldenStep[];
  final?: StateAssertion;
}

export type { GameState };
```

- [ ] **Step 4: Write `engine/golden/fixtures.ts`**

```ts
// engine/golden/fixtures.ts
import type { Coord, GameState, Player, Startup } from '../gameTypes';
import type { FixtureSpec } from './types';
import { createEmptyBoard } from '../gameInit';
import { AVAILABLE_STARTUPS, PLAYER_EMOJI } from '../startups';

export function buildFixture(spec: FixtureSpec): GameState {
  const board = createEmptyBoard();

  const startups: Startup[] = AVAILABLE_STARTUPS.map((cfg) => ({
    id: cfg.id,
    tier: cfg.tier,
    ticker: cfg.ticker,
    isFounded: false,
    totalShares: 25,
    availableShares: 25,
  }));

  const claim = (coord: Coord, startupId: string | null) => {
    if (board[coord]?.isPlaced) throw new Error(`fixture places two tiles on ${coord}`);
    board[coord] = { coord, isPlaced: true, startupId } as GameState['board'][Coord];
  };

  for (const chain of spec.chains ?? []) {
    if (chain.coords.length === 0) continue;
    for (const c of chain.coords) claim(c, chain.id);
    startups.find((s) => s.id === chain.id)!.isFounded = true;
  }
  for (const c of spec.loners ?? []) claim(c, null);

  const players: Player[] = spec.players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    emoji: PLAYER_EMOJI[i % PLAYER_EMOJI.length],
    cash: p.cash ?? 6000,
    hand: [...(p.hand ?? [])],
    shares: { ...(p.shares ?? {}) },
  }));

  for (const p of players) {
    for (const [id, qty] of Object.entries(p.shares)) {
      const s = startups.find((x) => x.id === id);
      if (!s) throw new Error(`fixture gives shares in unknown startup ${id}`);
      s.availableShares -= qty;
      if (s.availableShares < 0) throw new Error(`fixture over-allocates ${id}`);
    }
  }

  return {
    board,
    players,
    startups,
    bag: [...(spec.bag ?? [])],
    seed: 0,
    stage: spec.stage ?? 'play',
    currentPlayerIndex: spec.currentPlayerIndex ?? 0,
    currentBuyCount: 0,
    log: [],
    nextStepId: 1,
  } as GameState;
}
```

Fill in any other required `GameState` field with the same default `createInitialGame` uses — the `as GameState` cast is there to keep this readable, not to hide a missing field. If a field is required and missing, add it explicitly.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run engine/golden/fixtures.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write `engine/golden/runner.ts`**

```ts
// engine/golden/runner.ts
import { expect } from 'vitest';
import type { Coord, GameState, StartupId } from '../gameTypes';
import type { GoldenGame, StateAssertion } from './types';
import { applyIntent, IllegalIntentError } from '../intents';
import { getStartupSize } from '../gameHelpers';
import { finalScore } from '../endGame';
import { buildFixture } from './fixtures';

function player(state: GameState, id: string) {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`golden game refers to unknown player ${id}`);
  return p;
}

export function assertState(state: GameState, a: StateAssertion, where: string, addedLogFrom = 0): void {
  const at = (what: string) => `${where} — ${what}`;

  if (a.stage !== undefined) expect(state.stage, at('stage')).toBe(a.stage);
  if (a.currentPlayer !== undefined) {
    expect(state.players[state.currentPlayerIndex].id, at('currentPlayer')).toBe(a.currentPlayer);
  }
  for (const [id, cash] of Object.entries(a.cash ?? {})) {
    expect(player(state, id).cash, at(`cash ${id}`)).toBe(cash);
  }
  for (const [id, holdings] of Object.entries(a.shares ?? {})) {
    for (const [startupId, qty] of Object.entries(holdings)) {
      expect(player(state, id).shares[startupId] ?? 0, at(`shares ${id}/${startupId}`)).toBe(qty);
    }
  }
  for (const [startupId, size] of Object.entries(a.chainSize ?? {})) {
    expect(getStartupSize(state, startupId as StartupId), at(`size ${startupId}`)).toBe(size);
  }
  for (const [startupId, isFounded] of Object.entries(a.founded ?? {})) {
    expect(state.startups.find((s) => s.id === startupId)!.isFounded, at(`founded ${startupId}`)).toBe(isFounded);
  }
  for (const [startupId, qty] of Object.entries(a.availableShares ?? {})) {
    expect(state.startups.find((s) => s.id === startupId)!.availableShares, at(`pool ${startupId}`)).toBe(qty);
  }
  for (const [id, hand] of Object.entries(a.hand ?? {})) {
    expect([...player(state, id).hand].sort(), at(`hand ${id}`)).toEqual([...hand].sort());
  }
  for (const [coord, owner] of Object.entries(a.boardOwner ?? {})) {
    expect(state.board[coord as Coord]?.startupId ?? null, at(`board ${coord}`)).toBe(owner);
  }
  if (a.logPhases !== undefined) {
    expect(state.log.slice(addedLogFrom).map((e) => e.phase), at('log phases')).toEqual(a.logPhases);
  }
  if (a.bonuses !== undefined) {
    const got = (state.pendingBonuses ?? []).map((b) => ({
      playerId: b.playerId, startupId: b.startupId, type: b.type, amount: b.amount,
    }));
    expect(got, at('bonuses')).toEqual(a.bonuses);
  }
  if (a.finalScoreTotals !== undefined) {
    const report = finalScore(state);
    for (const [id, total] of Object.entries(a.finalScoreTotals)) {
      const stock = Object.entries(report.holdings[id] ?? {})
        .reduce((n, [chainId, qty]) => n + qty * (report.chains.find((c) => c.id === chainId)?.price ?? 0), 0);
      const bonus = report.bonuses.filter((b) => b.playerId === id).reduce((n, b) => n + b.amount, 0);
      const cash = report.players.find((p) => p.id === id)!.cash;
      expect(stock + bonus + cash, at(`final total ${id}`)).toBe(total);
    }
  }
}

export function runGoldenGame(game: GoldenGame): GameState {
  let state = buildFixture(game.setup);

  game.steps.forEach((step, i) => {
    const where = `${game.id} step ${i + 1} (${step.name})`;
    const logMark = state.log.length;

    if (step.expectError) {
      const before = JSON.stringify(state);
      let caught: unknown;
      try { applyIntent(state, step.intent); } catch (e) { caught = e; }
      expect(caught, `${where} — expected rejection ${step.expectError}`).toBeInstanceOf(IllegalIntentError);
      expect((caught as IllegalIntentError).code, `${where} — rejection code`).toBe(step.expectError);
      expect(JSON.stringify(state), `${where} — state must be unchanged`).toBe(before);
    } else {
      state = applyIntent(state, step.intent);
    }

    if (step.then) assertState(state, step.then, where, logMark);
  });

  if (game.final) assertState(state, game.final, `${game.id} final`);
  return state;
}
```

- [ ] **Step 7: Write the barrel and the driving test**

```ts
// engine/golden/index.ts
import type { GoldenGame } from './types';
import { TURN_GAMES } from './turns';
import { MERGER_GAMES } from './mergers';
import { ENDGAME_GAMES } from './endgame';

export * from './types';
export * from './fixtures';
export * from './runner';

export const ALL_GOLDEN_GAMES: GoldenGame[] = [...TURN_GAMES, ...MERGER_GAMES, ...ENDGAME_GAMES];
```

```ts
// engine/golden/golden.test.ts
import { describe, it } from 'vitest';
import { ALL_GOLDEN_GAMES } from './index';
import { runGoldenGame } from './runner';

describe('golden games', () => {
  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, () => { runGoldenGame(game); });
  }
});
```

Create the three catalogue files as empty exports for now, so the barrel resolves:

```ts
// engine/golden/turns.ts
import type { GoldenGame } from './types';
export const TURN_GAMES: GoldenGame[] = [];
```

Same for `mergers.ts` (`MERGER_GAMES`) and `endgame.ts` (`ENDGAME_GAMES`).

- [ ] **Step 8: Run everything**

Run: `npx vitest run`
Expected: 74 passed (68 + 6). `golden.test.ts` reports zero tests — the catalogue is empty until Task 11.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(engine): data-driven golden-game fixtures and runner"
```

---

### Task 11: G1 and G12 — the turn cycle and its dead ends

**G1** is the baseline turn: place, buy, end turn, and the next player is up. **G12** is the degenerate turn: nothing playable, nothing to draw.

**Files:**
- Modify: `engine/golden/turns.ts`

**Interfaces:**
- Consumes: `GoldenGame`, `buildFixture`, `runGoldenGame` from Task 10.
- Produces: `TURN_GAMES: GoldenGame[]` containing G1 and G12.

- [ ] **Step 1: Write G1**

```ts
// engine/golden/turns.ts
import type { GoldenGame } from './types';

const G1: GoldenGame = {
  id: 'G1',
  title: 'baseline turn cycle — place, found, buy, end turn',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam',  cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  },
  steps: [
    {
      name: 'Alex places E6 beside the lone tile, which opens the founding choice',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'E6' },
      then: {
        stage: 'foundStartup',
        hand: { p1: ['H8'] },
        boardOwner: { E6: null },
        logPhases: ['Placed a tile'],
      },
    },
    {
      name: 'Alex founds Messla and takes the founder share',
      intent: { type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' },
      then: {
        stage: 'buy',
        founded: { Messla: true },
        chainSize: { Messla: 2 },
        boardOwner: { E5: 'Messla', E6: 'Messla' },
        shares: { p1: { Messla: 1 } },
        availableShares: { Messla: 24 },
        logPhases: ['Founded a brand'],
      },
    },
    {
      name: 'Alex buys two more Messla at $200 each',
      intent: { type: 'buyShares', playerId: 'p1', picks: ['Messla', 'Messla'] },
      then: {
        stage: 'buy',
        cash: { p1: 6000 - 400 },
        shares: { p1: { Messla: 3 } },
        availableShares: { Messla: 22 },
        logPhases: ['Bought shares'],
      },
    },
    {
      name: 'a fourth share this turn is refused',
      intent: { type: 'buyShares', playerId: 'p1', picks: ['Messla', 'Messla'] },
      expectError: 'tooManyPicks',
    },
    {
      name: 'Sam cannot act while it is Alex’s turn',
      intent: { type: 'endTurn', playerId: 'p2' },
      expectError: 'notYourTurn',
    },
    {
      name: 'Alex ends the turn, refills to two tiles, and Sam is up',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: {
        stage: 'play',
        currentPlayer: 'p2',
        hand: { p1: ['H8', 'I11', 'I12'] },
        logPhases: ['Drew tiles', 'Ended turn'],
      },
    },
    {
      name: 'Sam places an isolated tile and goes straight to buying',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'A1' },
      then: { stage: 'buy', boardOwner: { A1: null }, logPhases: ['Placed a tile'] },
    },
  ],
  final: { stage: 'buy', currentPlayer: 'p2' },
};
```

The hand refills to 3, not 6, because the authored bag holds only two tiles — that is deliberate, and it keeps the fixture readable.

- [ ] **Step 2: Write G12**

```ts
const G12: GoldenGame = {
  id: 'G12',
  title: 'bag exhaustion and no legal tile — the turn passes',
  setup: {
    players: [
      { name: 'Alex', cash: 6000, hand: ['C1'] },
      { name: 'Sam',  cash: 6000, hand: ['H8'] },
    ],
    chains: [
      { id: 'Messla',   coords: ['B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11'] },
      { id: 'ZuckFace', coords: ['D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11'] },
    ],
    bag: [],
  },
  steps: [
    {
      name: 'C1 would merge two safe chains, so it cannot be placed',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      expectError: 'illegalPlacement',
    },
    {
      name: 'the bag is empty, so trading it in leaves the hand a tile short',
      intent: { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C1'] },
      then: { stage: 'play', hand: { p1: [] }, logPhases: ['Traded a tile'] },
    },
    {
      name: 'with nothing playable the turn simply passes',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: { stage: 'play', currentPlayer: 'p2', hand: { p1: [] } },
    },
  ],
  final: { currentPlayer: 'p2', chainSize: { Messla: 11, ZuckFace: 11 } },
};

export const TURN_GAMES: GoldenGame[] = [G1, G12];
```

`C1` is adjacent to `B1` and `D1`, which belong to the two size-11 chains — confirm against `getAdjacentCoords` and adjust if the board's row/column adjacency differs.

- [ ] **Step 3: Run them**

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: PASS, 2 tests (`G1: …`, `G12: …`).

If a step fails, read the failure message — the runner labels every assertion with the game id, step number and step name, so the failing assertion identifies itself. Fix the **engine** if the golden game states the correct rule; fix the **golden game** only if it encoded the rule wrongly.

- [ ] **Step 4: Run the full suite and commit**

Run: `npx vitest run`
Expected: 76 passed.

```bash
git add -A
git commit -m "test(engine): golden games G1 (turn cycle) and G12 (no legal tile)"
```

---

### Task 12: G2–G7 — the merger catalogue

Six mergers, one rule each. **G3 and G5 are the two bug fixes from Task 5** and must be written so that they would have failed against the pre-fix engine.

**Files:**
- Modify: `engine/golden/mergers.ts`

**Interfaces:**
- Consumes: `GoldenGame` from Task 10.
- Produces: `MERGER_GAMES: GoldenGame[]` containing G2–G7.

Shared layout for all six: `Messla` on row B, `ZuckFace` on row D, `Gobble` on row F, and the merging tile on row C or E between them. Verify adjacency once and reuse.

- [ ] **Step 1: Write G2 (two-way merger) and G3 (tied minority)**

```ts
// engine/golden/mergers.ts
import type { GoldenGame } from './types';

const row = (letter: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as const);

const G2: GoldenGame = {
  id: 'G2',
  title: 'two-way merger — bigger chain survives, holders liquidate',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 4 } },
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 2 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 6) },
      { id: 'ZuckFace', coords: row('D', 3) },   // tier 1, size 3 → $400
    ],
  },
  steps: [
    {
      name: 'Alex merges ZuckFace into Messla',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'mergerLiquidation',
        founded: { ZuckFace: false, Messla: true },
        chainSize: { Messla: 10, ZuckFace: 0 },
        // Alex majority 4 → $4,000; Sam minority 2 → $2,000
        cash: { p1: 4000, p2: 2000 },
        bonuses: [
          { playerId: 'p1', startupId: 'ZuckFace', type: 'majority', amount: 4000 },
          { playerId: 'p2', startupId: 'ZuckFace', type: 'minority', amount: 2000 },
        ],
        logPhases: ['Placed a tile', 'Merger', 'Merger payout', 'Merger payout'],
      },
    },
    {
      name: 'Alex sells two and trades two',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 2, trade: 2, keep: 0 },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 4000 + 800 },
        shares: { p1: { ZuckFace: 0, Messla: 1 } },
        logPhases: ['Liquidated shares'],
      },
    },
    {
      name: 'Sam sells out, which closes the merger',
      intent: { type: 'liquidate', playerId: 'p2', startupId: 'ZuckFace', sell: 2, trade: 0, keep: 0 },
      then: { stage: 'buy', cash: { p2: 2000 + 800 }, shares: { p2: { ZuckFace: 0 } } },
    },
  ],
  final: { chainSize: { Messla: 10 }, boardOwner: { D1: 'Messla', C1: 'Messla' } },
};

// The tied-minority bug: before Task 5, Sam and Jordan EACH received the full $3,000.
const G3: GoldenGame = {
  id: 'G3',
  title: 'tied minority — the minority bonus is split, not paid twice',
  setup: {
    players: [
      { name: 'Alex',   cash: 0, hand: ['C1'], shares: { ZuckFace: 7 } },
      { name: 'Sam',    cash: 0, shares: { ZuckFace: 4 } },
      { name: 'Jordan', cash: 0, shares: { ZuckFace: 4 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 5) },   // tier 1, size 5 → $600
    ],
  },
  steps: [
    {
      name: 'the merger pays $6,000 majority and splits $3,000 between the tied pair',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 6000, p2: 1500, p3: 1500 },
        bonuses: [
          { playerId: 'p1', startupId: 'ZuckFace', type: 'majority', amount: 6000 },
          { playerId: 'p2', startupId: 'ZuckFace', type: 'minority', amount: 1500 },
          { playerId: 'p3', startupId: 'ZuckFace', type: 'minority', amount: 1500 },
        ],
      },
    },
  ],
};
```

Check `getSharePriceAtSize(1, 3)` and `getSharePriceAtSize(1, 5)` against Task 3's table and correct the `$400` / `$600` figures (and every amount derived from them) if the tiers give different numbers. The *ratios* — majority `×10`, minority `×5`, split evenly — are what G2 and G3 exist to pin.

- [ ] **Step 2: Write G4 (tied majority) and G5 (sole holder)**

```ts
const G4: GoldenGame = {
  id: 'G4',
  title: 'tied majority — both pots combined, split, rounded up to $100',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 5 } },
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 5 } },
      { name: 'Jordan', cash: 0, shares: { ZuckFace: 1 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 2) },   // tier 1, size 2 → $300
    ],
  },
  steps: [
    {
      name: '($3,000 + $1,500) / 2 = $2,250, rounded up to $2,300 each; Jordan gets nothing',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        cash: { p1: 2300, p2: 2300, p3: 0 },
        bonuses: [
          { playerId: 'p1', startupId: 'ZuckFace', type: 'majority', amount: 2300 },
          { playerId: 'p2', startupId: 'ZuckFace', type: 'majority', amount: 2300 },
        ],
      },
    },
  ],
};

// The sole-holder bug: before Task 5, Alex received the majority bonus only.
const G5: GoldenGame = {
  id: 'G5',
  title: 'sole holder — majority and minority paid together as one figure',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 3 } },
      { name: 'Sam',  cash: 0 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 2) },   // tier 1, size 2 → $300
    ],
  },
  steps: [
    {
      name: 'Alex takes $3,000 + $1,500 = $4,500 as a single combined bonus',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        cash: { p1: 4500, p2: 0 },
        bonuses: [{ playerId: 'p1', startupId: 'ZuckFace', type: 'both', amount: 4500 }],
      },
    },
  ],
};
```

- [ ] **Step 3: Write G6 (no shareholders) and G7 (three-way merger)**

```ts
const G6: GoldenGame = {
  id: 'G6',
  title: 'absorbed chain with no shareholders — no payout, no liquidation',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'] },
      { name: 'Sam',  cash: 0 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 6) },
      { id: 'ZuckFace', coords: row('D', 3) },
    ],
  },
  steps: [
    {
      name: 'the merger completes straight into the buying stage',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'buy',
        cash: { p1: 0, p2: 0 },
        bonuses: [],
        founded: { ZuckFace: false },
        availableShares: { ZuckFace: 25 },
        logPhases: ['Placed a tile', 'Merger'],
      },
    },
  ],
};

const G7: GoldenGame = {
  id: 'G7',
  title: 'three-way merger — one survivor, two absorbed, both paid out',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 3, Gobble: 2 } },
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 1 } },
    ],
    // C1 touches B1 (Messla), D1 (ZuckFace); C2 is not involved.
    // Gobble is reached by making the placed tile adjacent to it as well — see note.
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: ['C2', 'C3'] },
      { id: 'Gobble',   coords: ['D1', 'D2'] },
    ],
  },
  steps: [
    {
      name: 'Messla survives; ZuckFace and Gobble are both absorbed and both pay out',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        founded: { Messla: true, ZuckFace: false, Gobble: false },
        chainSize: { Messla: 8 + 1 + 2 + 2 },
        stage: 'mergerLiquidation',
      },
    },
  ],
};

export const MERGER_GAMES: GoldenGame[] = [G2, G3, G4, G5, G6, G7];
```

For G7 the placed tile must touch **three** chains at once. `C1` is adjacent to `B1`, `D1` and `C2`, so laying `Messla` on row B, `ZuckFace` at `C2`–`C3` and `Gobble` at `D1`–`D2` gives a genuine three-way. Confirm the adjacency, then fill in G7's `bonuses` and `cash` assertions from the two absorbed chains' prices — do not leave them out; the point of G7 is that *both* absorbed chains pay.

- [ ] **Step 4: Run them**

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: PASS, 8 tests (G1, G12, G2–G7).

- [ ] **Step 5: Confirm G3 and G5 would have caught the bugs**

Temporarily revert `computeChainBonuses` to the old behaviour — pay each tied minority holder the full `minorityPot`, and return only the majority entry for a sole holder — then run:

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: **G3 and G5 FAIL**, everything else passes. Restore the correct implementation and confirm green again. This is the roadmap's "demonstrably failed before their fixes" requirement; note the observed failure in the commit message.

- [ ] **Step 6: Run the full suite and commit**

Run: `npx vitest run`
Expected: 82 passed.

```bash
git add -A
git commit -m "test(engine): golden games G2-G7 covering the merger catalogue

G3 and G5 were verified to fail against the pre-fix bonus logic."
```

---

### Task 13: G8–G11 — safety, dead tiles and the declared ending

**Files:**
- Modify: `engine/golden/endgame.ts`

**Interfaces:**
- Consumes: `GoldenGame` from Task 10.
- Produces: `ENDGAME_GAMES: GoldenGame[]` containing G8–G11.

- [ ] **Step 1: Write G8 (safe chains and dead tiles) and G9 (end by 41)**

```ts
// engine/golden/endgame.ts
import type { GoldenGame } from './types';

const row = (letter: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as const);

const G8: GoldenGame = {
  id: 'G8',
  title: 'safe chains cannot merge, and the tile between them is dead',
  setup: {
    players: [
      { name: 'Alex', cash: 4200, hand: ['C6', 'G6'], shares: { Messla: 4, ZuckFace: 2 } },
      { name: 'Sam',  cash: 5800 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 11) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    bag: ['I12'],
  },
  steps: [
    {
      name: 'C6 sits between two safe chains and is refused',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C6' },
      expectError: 'illegalPlacement',
    },
    {
      name: 'trading it in draws a replacement and the turn continues',
      intent: { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C6'] },
      then: { stage: 'play', hand: { p1: ['G6', 'I12'] }, logPhases: ['Traded a tile'] },
    },
    {
      name: 'the turn really does continue — G6 is still placeable',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'G6' },
      then: { stage: 'buy', boardOwner: { G6: null } },
    },
  ],
  final: { chainSize: { Messla: 11, ZuckFace: 11 } },
};

const G9: GoldenGame = {
  id: 'G9',
  title: 'end by 41 tiles, declared',
  setup: {
    players: [
      { name: 'Alex',   cash: 8600, hand: ['D5'], shares: { Gobble: 6 } },
      { name: 'Sam',    cash: 12000, shares: { Gobble: 3 } },
      { name: 'Jordan', cash: 3100,  shares: { Gobble: 1 } },
    ],
    // rows A, B, C full (12 each) + D1..D4 = 40; D5 makes 41
    chains: [{ id: 'Gobble', coords: [...row('A', 12), ...row('B', 12), ...row('C', 12), ...row('D', 4)] }],
  },
  steps: [
    {
      name: 'Alex places the 41st tile',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'D5' },
      then: { stage: 'buy', chainSize: { Gobble: 41 } },
    },
    {
      name: 'Alex declares the end',
      intent: { type: 'declareEnd', playerId: 'p1' },
      then: { stage: 'end', logPhases: ['Game over'] },
    },
  ],
  // Gobble at 41, tier 2 → $1,000. Alex 6 → majority $10,000; Sam 3 → minority $5,000.
  final: {
    stage: 'end',
    finalScoreTotals: {
      p1: 8600 + 6000 + 10000,   // cash + stock + majority
      p2: 12000 + 3000 + 5000,
      p3: 3100 + 1000,
    },
  },
};
```

- [ ] **Step 2: Write G10 (all chains safe) and G11 (met but declined)**

```ts
const G10: GoldenGame = {
  id: 'G10',
  title: 'end because every founded chain is safe, declared',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000, shares: { ZuckFace: 4 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 12) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    stage: 'buy',
  },
  steps: [
    {
      name: 'the end is available with both chains safe',
      intent: { type: 'declareEnd', playerId: 'p1' },
      then: { stage: 'end', logPhases: ['Game over'] },
    },
  ],
};

const G11: GoldenGame = {
  id: 'G11',
  title: 'end condition met but declined — play continues',
  setup: {
    players: [
      { name: 'Alex', cash: 1000, hand: ['H8'], shares: { Messla: 5 } },
      { name: 'Sam',  cash: 2000, hand: ['H10'] },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 12) },
      { id: 'ZuckFace', coords: row('D', 11) },
    ],
    stage: 'buy',
    bag: ['I12'],
  },
  steps: [
    {
      name: 'Alex declines and simply ends the turn instead',
      intent: { type: 'endTurn', playerId: 'p1' },
      then: { stage: 'play', currentPlayer: 'p2' },
    },
    {
      name: 'Sam takes a normal turn — the game is still running',
      intent: { type: 'placeTile', playerId: 'p2', coord: 'H10' },
      then: { stage: 'buy', currentPlayer: 'p2', boardOwner: { H10: null } },
    },
    {
      name: 'Sam can still declare the end later',
      intent: { type: 'declareEnd', playerId: 'p2' },
      then: { stage: 'end' },
    },
  ],
};

export const ENDGAME_GAMES: GoldenGame[] = [G8, G9, G10, G11];
```

G11 is the reason `declareEnd` exists as its own intent rather than the engine ending the game on its own: the condition being met never forces the end.

- [ ] **Step 3: Run them**

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: PASS, 12 tests — G1–G12, the full catalogue.

- [ ] **Step 4: Run the full suite and commit**

Run: `npx vitest run`
Expected: 86 passed.

```bash
git add -A
git commit -m "test(engine): golden games G8-G11 covering dead tiles and declared endings"
```

---

### Task 14: Server spike, `as any` sweep, and Phase 0 sign-off

The roadmap names one risk explicitly: *"a throwaway server-side spike calling `applyIntent` during Phase 0, to pin the signature before Phase 2 depends on it."* The spike is a **test**, not a route — it proves the engine imports and runs cleanly from the server's module resolution without adding surface area anyone has to maintain.

**Files:**
- Create: `server/engineSpike.test.ts`
- Modify: `engine/index.ts` (final barrel), `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new — this task closes Phase 0.

- [ ] **Step 1: Write the spike**

```ts
// server/engineSpike.test.ts
//
// Phase 0 spike: proves the engine is usable from the server's module graph
// with the signature Phase 2 will depend on. Delete this file when the real
// server-authoritative loop lands in Phase 2.
import { describe, it, expect } from 'vitest';
import { createInitialGame } from '../engine/gameInit.js';
import { applyIntent, IllegalIntentError } from '../engine/intents.js';
import type { Intent } from '../engine/intents.js';
import type { GameState } from '../engine/gameTypes.js';

/** The shape Phase 2's room actor will wrap: one state in, one state out. */
function reduce(state: GameState, intent: Intent): GameState {
  return applyIntent(state, intent);
}

describe('server spike: applyIntent over the wire shape', () => {
  it('runs a turn from a freshly initialised game', () => {
    let state = createInitialGame(1234, ['Alex', 'Sam']);
    state = { ...state, stage: 'play' };

    const me = state.players[state.currentPlayerIndex];
    const coord = me.hand[0];
    state = reduce(state, { type: 'placeTile', playerId: me.id, coord });

    expect(state.board[coord].isPlaced).toBe(true);
    expect(['buy', 'foundStartup', 'chooseSurvivor', 'mergerLiquidation']).toContain(state.stage);
  });

  it('survives a JSON round trip, which is how it will reach a client', () => {
    let state = createInitialGame(1234, ['Alex', 'Sam']);
    state = { ...state, stage: 'play' };
    const wire = JSON.parse(JSON.stringify(state)) as GameState;
    const me = wire.players[wire.currentPlayerIndex];
    const after = reduce(wire, { type: 'placeTile', playerId: me.id, coord: me.hand[0] });
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });

  it('rejects an illegal intent with a code the server can map to an error frame', () => {
    const state = { ...createInitialGame(1234, ['Alex', 'Sam']), stage: 'play' as const };
    const other = state.players[1];
    try {
      reduce(state, { type: 'placeTile', playerId: other.id, coord: other.hand[0] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalIntentError);
      expect((e as IllegalIntentError).code).toBe('notYourTurn');
    }
  });
});
```

If `createInitialGame` returns `stage: 'draw'` and the draw stage is a legacy modal step, the `stage: 'play'` override above is the right shim for the spike — do not add a `draw` intent in Phase 0.

- [ ] **Step 2: Run the spike**

Run: `npx vitest run server/engineSpike.test.ts`
Expected: PASS, 3 tests. A module-resolution failure here means the `.js`-extension rule from Global Constraints was applied inconsistently — fix the imports, not the test.

- [ ] **Step 3: Sweep the remaining `as any`**

```bash
grep -rn "as any" engine server/engineSpike.test.ts
```

Expected: no hits. Any that remain are either a real missing type (add it to `gameTypes.ts`) or a legacy modal path that Phase 2 deletes — if the latter, leave it and note it in the commit body.

Also confirm the deletions the roadmap requires actually happened:

```bash
test ! -f server/gameManager.ts && echo "gameManager deleted"
grep -rn "majorityHolderBonus" engine src server || echo "majorityHolderBonus gone"
```

- [ ] **Step 4: Confirm the barrel is complete**

```ts
// engine/index.ts — final
export * from './gameTypes';
export * from './gameHelpers';
export * from './gameInit';
export * from './startups';
export * from './log';
export * from './placement';
export * from './bonuses';
export * from './endGame';
export * from './gameLogic';
export * from './intents';
```

`./golden` is deliberately **not** exported — golden games are test data, not part of the engine's public surface.

- [ ] **Step 5: Update `CLAUDE.md`**

The "Reference (not the current focus)" section still points at `src/state/gameLogic.ts`. Replace that bullet:

```markdown
- Rules engine: `engine/` — types, helpers, init, rules, and the `applyIntent(state, intent)`
  reducer. Golden games (`engine/golden/`) are the executable rules spec: G1–G12, run by
  `engine/golden/golden.test.ts`.
- Client app: `src/` (React + Vite + react-router). Server: `server/` (Express + Socket.io + XState).
```

- [ ] **Step 6: Final verification against the roadmap's done-when**

Run: `npx vitest run`
Expected: 89 passed (86 + 3), zero failures.

Then check each clause of the roadmap's "Done when" by hand:

- [ ] G1–G12 all pass — `npx vitest run engine/golden/golden.test.ts` reports 12 tests.
- [ ] Tied-minority (G3) and sole-holder (G5) were observed failing before their fixes — recorded in Task 12 Step 5 and in the Task 5 commit body.
- [ ] The four render fields exist: `Startup.ticker`, `Player.emoji`, `getNextSharePrice`, and structured `LogEntry`.
- [ ] At least one golden game asserts on structured log entries — G1, G2, G6, G8, G9 and G10 all use `logPhases`.
- [ ] `applyIntent` covers all eight intent types from the spec's union, with no field renamed.
- [ ] `server/gameManager.ts`, `majorityHolderBonus`, and the `pendingBonuses` `as any` casts are gone.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A
git commit -m "chore(engine): server spike pinning applyIntent, any-cast sweep, Phase 0 sign-off"
git push -u origin revamp/phase-0-engine
```

---

## Deviations from the roadmap spec, and why

Recorded here so Phase 1 does not rediscover them as surprises.

1. **`gameLogic.ts` is not pure.** The spec says the engine is "already pure and immutable". It is not — it mutates `state` in place throughout. Rewriting it was out of scope for Phase 0 and would have destroyed the regression value of the 8 existing tests. Purity is provided at the boundary: `applyIntent` clones first, so *its* contract is pure even though its internals are not. Phase 2 can make the internals pure incrementally, one function at a time, with the golden games as the safety net.

2. **No RNG cursor was added to `GameState`.** The spec lists "RNG in state" as a precondition for per-player projection. The bag is already pre-shuffled at init from `seed`, and every draw is `bag.shift()` — so the state already contains all the randomness deterministically, and no cursor is needed. Phase 3's projection strips `bag` and `seed`; that works unchanged.

3. **`getEndCondition` and `finalScore` return a structured `EndReason`, not a sentence.** The roadmap defers the all-safe wording to its own spec, so the engine cannot own the copy. The view formats `{ kind: 'size41', startupId, size }` into "Gobble reached 41 tiles".

4. **Tied bonus splits round *up* to the nearest $100.** This is a behaviour change, chosen by the user, matching `prototype/index.html:237`. Two holders of a $300 chain now split $4,500 as $2,300 each rather than $2,250. G4 locks it.

5. **There is no `mergerPayout` stage in the intent machine.** Bonuses are paid as part of the merge transition; the payout is a log entry, not a decision point. The legacy stage still exists for the modal path until Phase 2 removes it.

6. **The legacy modal-era API stays.** `handleLiquidationChoice`, `completeLiquidation`, `finalizeAllLiquidations`, `prepareMergerPayout` and their stages are untouched, alongside the new intent path. They are the regression net for the whole of Phase 0 and Phase 2 deletes them with the modals. This means two liquidation code paths coexist temporarily — deliberately, and only until Phase 2.

7. **Verification is vitest only.** There is no `tsconfig.json` and therefore no typecheck gate. Adding one would have meant fixing whatever type errors it surfaced across `src/` and `server/`, which is unrelated work. Phase 1 or 2 should add it as its own task.
