# Phase 1a — Engine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Phase 0 carry-forward items that Phase 1b depends on — a typecheck gate, a snapshot store for undo, a random-play invariant harness, and the golden-catalogue coverage gaps.

**Architecture:** Everything here is `engine/` and build tooling. No React, no `src/` component work. Three of the seven tasks add new engine modules (`history.ts`, `golden/replay.ts`, `golden/invariants.ts`); the rest tighten what exists. The snapshot store is deliberately *outside* `GameState` — see Task 3.

**Tech Stack:** TypeScript, vitest, vite. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-08-03-phase-1-component-layer-design.md](../specs/2026-08-03-phase-1-component-layer-design.md) — Plan 1a section.

## Global Constraints

- **Never run bare `tsc`.** It runs through `npm run typecheck` or not at all. This was a Phase 0 constraint and survives because ad-hoc `tsc` invocations pick up different configs and produce misleading results.
- **Gates are `npx vitest run`, `npm run typecheck`, and `npx vite build`.** All three must pass before any commit.
- **Zero `as any` in `engine/`.** Phase 0 removed them; they do not come back.
- **`applyIntent` stays thin.** It clones, validates, delegates to `gameLogic.ts`, returns. Rules logic never gets duplicated into `intents.ts`.
- **Import conventions:** intra-`engine/` imports are extensionless; `server/` → `engine/` uses `.js`; `src/` → `engine/` is extensionless. Do not "fix" these to match each other.
- **Do not touch `prototype/`.** It is a settled reference.
- **Do not push and do not open a PR.** That is the project owner's call.
- **Board is 9×12 = 108 tiles**, coords `A1`–`I12`. `SAFE_SIZE = 11`, `END_SIZE = 41`, 25 shares per startup, 6000 starting cash, `HAND_SIZE = 6`.

---

### Task 1: The typecheck gate

**Files:**
- Create: `tsconfig.json`
- Modify: `package.json` (scripts)
- Modify: whatever files `tsc` reports errors in

**Interfaces:**
- Consumes: nothing
- Produces: `npm run typecheck` — must exit 0. Every later task in this plan and all of Plan 1b runs it as a gate.

**Context you need:** This repo has never had a `tsconfig.json`. Type errors are currently invisible — `vite` strips types without checking them, and `vitest` does the same. Adding the gate will surface errors that have accumulated across the whole history of the project.

**This task is scoped as "make `npm run typecheck` exit 0", not "fix these five errors."** The carry-forward doc lists five known debts, but those are the ones reviewers happened to notice while reading Phase 0 diffs — not a survey. Expect more. If the total is large, it is legitimate to relax specific strictness flags rather than fix everything, **provided each relaxation is justified in a comment in `tsconfig.json` and reported in your task report.** What is not acceptable is `// @ts-ignore` scattered through source files, or `as any`.

- [ ] **Step 1: Create the tsconfig**

One config covers all three source roots. `moduleResolution: "bundler"` is what makes the mixed import conventions typecheck under a single config — it accepts both the extensionless imports `engine/` uses internally and the `.js`-suffixed imports `server/` uses, mapping `.js` → `.ts` for relative paths.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vitest/globals", "node"],

    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["engine", "src", "server", "vite.config.ts"]
}
```

`noEmit: true` matters: this config is a **checker only**. It does not change how vite bundles or how tsx runs the server, and it must never be used to produce output.

- [ ] **Step 2: Add the script**

In `package.json`, add to `scripts`:

```json
"typecheck": "tsc -p tsconfig.json"
```

- [ ] **Step 3: Run it and count the damage**

Run: `npm run typecheck 2>&1 | tail -40`
Run: `npm run typecheck 2>&1 | grep -c "error TS"`

Expected: a non-zero error count. Record the number — your task report must state the starting count, the ending count, and any strictness flag you relaxed with the reason.

- [ ] **Step 4: Fix the errors**

Work the list. The five already known, for orientation:

- `engine/gameTypes.ts:45` — a stale `// src/state/gameTypes.ts` path comment (delete it; it is a lie, not a type error, but it is in the same file you will be editing)
- `engine/gameLogic.ts:654` and `engine/endGame.ts:20` — unchecked `as StartupId` assertions
- `engine/gameLogic.test.ts:54` — a possibly-undefined access
- `engine/golden/mergers.ts:10` — `row()` returns `string[]` where `Coord[]` is meant. The fix pattern already exists in `engine/golden/endgame.ts:4-5`:

```ts
const row = (letter: Row, n: number): Coord[] =>
  Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as Coord);
```

For the unchecked assertions, prefer a narrowing guard over a cast. Where a cast is genuinely unavoidable (the template-literal `Coord` type makes some string-building unavoidably assertive), keep it and add a one-line comment saying why it is safe.

If you hit an error in `server/` XState code that would require restructuring a state machine to fix, that is a legitimate candidate for a scoped relaxation — `server/`'s machines are on Phase 2's deletion list. Say so in your report rather than rewriting them.

- [ ] **Step 5: Verify all three gates**

Run: `npm run typecheck` → Expected: exit 0, no output
Run: `npx vitest run` → Expected: 101 passed
Run: `npx vite build` → Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json package.json engine src server
git commit -m "chore: add a typecheck gate and clear the type debt behind it"
```

---

### Task 2: The discard pile

**Files:**
- Modify: `engine/gameTypes.ts` (add `discarded` to `GameState`)
- Modify: `engine/gameInit.ts:49-60` (initialise it)
- Modify: `engine/intents.ts:298-323` (`doTradeInDeadTiles` records the tile)
- Modify: `engine/golden/fixtures.ts` (initialise it in built fixtures)
- Test: `engine/intents.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `GameState.discarded: Coord[]` — Task 5's tile-conservation invariant reads it.

**Context you need:** A player may trade in permanently-unplayable ("dead") tiles for replacements. Today `doTradeInDeadTiles` removes the tile from the hand and draws a replacement, logging the coord — but the tile then exists nowhere in `GameState`. So `placed + Σ hands + bag` silently drifts below 108 with nothing to reconcile against, which makes tile conservation unassertable. That is why this task comes before the invariant harness.

- [ ] **Step 1: Write the failing test**

In `engine/intents.test.ts`, add:

```ts
describe('discard pile', () => {
  it('records a traded-in dead tile, keeping all 108 tiles accounted for', () => {
    // Two safe chains with a single gap between them: C6 can never be played.
    const state = buildFixture({
      players: [{ name: 'Alex', hand: ['C6', 'G6'] }, { name: 'Sam' }],
      chains: [
        { id: 'Messla', coords: row('B', 11) },
        { id: 'ZuckFace', coords: row('D', 11) },
      ],
      bag: ['I12'],
    });

    const next = applyIntent(state, { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C6'] });

    expect(next.discarded).toEqual(['C6']);

    const placed = Object.values(next.board).filter((c) => c.placed).length;
    const inHands = next.players.reduce((n, p) => n + p.hand.length, 0);
    expect(placed + inHands + next.bag.length + next.discarded.length).toBe(108);
  });

  it('starts empty on a new game', () => {
    expect(createInitialGame('seed-1', ['Alex', 'Sam']).discarded).toEqual([]);
  });
});
```

`row` is the typed helper; import it or redeclare it locally exactly as in `engine/golden/endgame.ts:4-5`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run engine/intents.test.ts -t "discard pile"`
Expected: FAIL — `discarded` is `undefined`.

- [ ] **Step 3: Add the field**

In `engine/gameTypes.ts`, on the `GameState` interface, beside `bag`:

```ts
  /** dead tiles traded in and permanently out of play; `placed + hands + bag + discarded` is always 108 */
  discarded: Coord[];
```

Make it **required**, not optional. An optional field would let a fixture omit it and silently break the conservation invariant Task 5 depends on — which is exactly the failure mode this task exists to close.

- [ ] **Step 4: Initialise it everywhere a `GameState` is built**

In `engine/gameInit.ts`, in the object returned by `createInitialGame`, beside `bag`:

```ts
    discarded: [],
```

In `engine/golden/fixtures.ts`, in the state `buildFixture` assembles, add the same. `tsc` will point you at any other construction site — this is the first task where the Task 1 gate does real work for you.

- [ ] **Step 5: Record the tile on trade-in**

In `engine/intents.ts`, inside `doTradeInDeadTiles`'s second loop, immediately after the hand filter at line 312:

```ts
    player.hand = player.hand.filter((x) => x !== c);
    state.discarded.push(c);
```

- [ ] **Step 6: Verify**

Run: `npx vitest run engine/intents.test.ts -t "discard pile"` → Expected: PASS
Run: `npx vitest run` → Expected: all pass (G8 exercises trade-in; confirm it still does)
Run: `npm run typecheck` → Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add engine
git commit -m "feat(engine): a discard pile, so tile conservation is checkable"
```

---

### Task 3: The snapshot store

**Files:**
- Create: `engine/history.ts`
- Create: `engine/history.test.ts`
- Modify: `engine/index.ts` (export the new module)

**Interfaces:**
- Consumes: `applyIntent(state, intent): GameState` from `engine/intents.ts`; `LogEntry.stepId: number` and `GameState.nextStepId: number` from `engine/gameTypes.ts`
- Produces:
  - `type SnapshotStore = Map<number, GameState>`
  - `createSnapshotStore(): SnapshotStore`
  - `applyIntentWithHistory(store: SnapshotStore, state: GameState, intent: Intent): GameState`
  - `rewindTo(store: SnapshotStore, stepId: number): GameState`

  Plan 1b's step-stack component consumes `LogEntry.stepId` as the undo affordance's identity. Phase 2 consumes all four.

**Context you need — read this before writing any code.**

The roadmap describes log entries carrying a "snapshot handle", and the Phase 0 carry-forward records the snapshot as an unbuilt gap. It is tempting to close it by adding a `snapshot?: GameState` field to `LogEntry`. **Do not.**

`applyIntent` deep-clones the entire state on every call (`engine/intents.ts:374`). Every `GameState` contains `log: LogEntry[]`. So if a `LogEntry` held a `GameState`, each `applyIntent` call would clone every previously-stored snapshot, and each of *those* carries its own log of snapshots. The cost is exponential in the number of steps, in both time and memory — and it would pass every test that plays fewer than about ten steps, which is every test in this repo.

`stepId` is already the handle. What is missing is the store it indexes into, and it lives **outside** `GameState`, owned by the caller. This also keeps snapshots out of anything Phase 3 broadcasts, which matters because a snapshot contains the bag and every player's hand.

- [ ] **Step 1: Write the failing tests**

Create `engine/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameState } from './gameTypes';
import { createSnapshotStore, applyIntentWithHistory, rewindTo } from './history';
import { applyIntent } from './intents';
import { buildFixture } from './golden/fixtures';

const twoPlayers = () =>
  buildFixture({
    players: [{ name: 'Alex', hand: ['A1', 'A2'] }, { name: 'Sam', hand: ['C5'] }],
    bag: ['I11', 'I12'],
  });

/**
 * The stepId an intent's snapshot is filed under is the id of the FIRST log
 * entry that intent appends — `applyIntentWithHistory` files under
 * `state.nextStepId` before applying. Some intents append more than one entry
 * (a merging placement logs both 'Merger' and 'Placed a tile'), so reading the
 * last entry's id would look up a snapshot that was never stored.
 * `buildFixture` starts with an empty log, so the first new entry is index 0.
 */
const firstNewStep = (before: GameState, after: GameState): number =>
  after.log[before.log.length]!.stepId;

describe('snapshot store', () => {
  it('rewinds to the exact state before a step ran', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });

    expect(JSON.stringify(rewindTo(store, firstNewStep(start, after)))).toBe(JSON.stringify(start));
  });

  it('is idempotent — rewinding twice to the same step gives the same state', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, after);

    expect(JSON.stringify(rewindTo(store, stepId))).toBe(JSON.stringify(rewindTo(store, stepId)));
  });

  it('drops forward entries, so a rewound store cannot resurrect the future', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    let s = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, s);
    s = applyIntentWithHistory(store, s, { type: 'endTurn', playerId: 'p1' });

    const sizeBefore = store.size;
    rewindTo(store, stepId);
    // The entry AT stepId survives — that is what keeps a repeated rewind working.
    expect(store.size).toBeLessThan(sizeBefore);
    expect([...store.keys()].every((k) => k <= stepId)).toBe(true);
    expect(store.has(stepId)).toBe(true);
  });

  it('rewind-then-replay reaches the same state as an uninterrupted run', () => {
    const intents = [
      { type: 'placeTile', playerId: 'p1', coord: 'A1' },
      { type: 'endTurn', playerId: 'p1' },
    ] as const;

    let straight = twoPlayers();
    for (const i of intents) straight = applyIntent(straight, i);

    const store = createSnapshotStore();
    const start = twoPlayers();
    let s = applyIntentWithHistory(store, start, intents[0]);
    const stepId = firstNewStep(start, s);
    s = applyIntentWithHistory(store, s, intents[1]);
    s = rewindTo(store, stepId);
    for (const i of intents) s = applyIntentWithHistory(store, s, i);

    expect(JSON.stringify(s)).toBe(JSON.stringify(straight));
  });

  it('never nests a store inside a snapshot — the recursion trap, pinned', () => {
    const store = createSnapshotStore();
    applyIntentWithHistory(store, twoPlayers(), { type: 'placeTile', playerId: 'p1', coord: 'A1' });

    for (const snapshot of store.values()) {
      for (const entry of snapshot.log) {
        expect(Object.keys(entry).sort()).toEqual(
          expect.arrayContaining(['detail', 'phase', 'stepId']),
        );
        expect(entry).not.toHaveProperty('snapshot');
      }
      expect(snapshot).not.toHaveProperty('history');
      expect(snapshot).not.toHaveProperty('snapshots');
    }
  });

  it('rejects a rewind to an unknown step rather than returning nonsense', () => {
    expect(() => rewindTo(createSnapshotStore(), 999)).toThrow(/999/);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run engine/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Write the module**

Create `engine/history.ts`:

```ts
import type { GameState } from './gameTypes';
import type { Intent } from './intents';
import { applyIntent } from './intents';

/**
 * stepId → the state as it was BEFORE that step ran.
 *
 * Deliberately not a field on `GameState`. `applyIntent` deep-clones the whole
 * state on every call, and every state carries its log; a snapshot stored inside
 * a log entry would therefore be re-cloned on every subsequent intent, along with
 * every snapshot nested inside it. The cost is exponential in step count and
 * invisible in any short test. Keeping the store outside also keeps snapshots —
 * which contain the bag and every hand — out of anything a server broadcasts.
 */
export type SnapshotStore = Map<number, GameState>;

export function createSnapshotStore(): SnapshotStore {
  return new Map();
}

/**
 * Snapshots `state` under the stepId the next log entry will carry, then applies
 * the intent. A rejected intent throws out of `applyIntent` before the snapshot
 * can mislead anyone: the entry is removed on the way out.
 */
export function applyIntentWithHistory(
  store: SnapshotStore,
  state: GameState,
  intent: Intent,
): GameState {
  const stepId = state.nextStepId;
  store.set(stepId, structuredClone(state));
  try {
    return applyIntent(state, intent);
  } catch (e) {
    store.delete(stepId);
    throw e;
  }
}

/**
 * The state before `stepId` ran. Every entry AFTER `stepId` is dropped; the
 * entry at `stepId` is kept, which is what makes a repeated rewind to the same
 * step return the same state instead of throwing. Rewinding leaves the game
 * about to run `stepId` again, and the next `applyIntentWithHistory` overwrites
 * that entry with an identical snapshot.
 */
export function rewindTo(store: SnapshotStore, stepId: number): GameState {
  const snapshot = store.get(stepId);
  if (!snapshot) throw new Error(`no snapshot for step ${stepId}`);
  for (const key of [...store.keys()]) {
    if (key > stepId) store.delete(key);
  }
  return structuredClone(snapshot);
}
```

Note the two `structuredClone` calls. Storing without cloning would alias the caller's state; returning without cloning would let a caller mutate the stored snapshot. Both are needed, and the idempotence test is what catches their absence.

- [ ] **Step 4: Export it**

In `engine/index.ts`, add after the `intents` line:

```ts
export * from './history';
```

- [ ] **Step 5: Verify**

Run: `npx vitest run engine/history.test.ts` → Expected: 6 passed
Run: `npx vitest run` → Expected: all pass
Run: `npm run typecheck` → Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): a snapshot store outside GameState, so undo has somewhere to rewind to"
```

---

### Task 4: A vitest-free replay path for the golden games

**Files:**
- Create: `engine/golden/replay.ts`
- Create: `engine/golden/replay.test.ts`
- Modify: `engine/golden/index.ts`

**Interfaces:**
- Consumes: `GoldenGame` from `engine/golden/types.ts`; `buildFixture` from `engine/golden/fixtures.ts`; `applyIntent` from `engine/intents.ts`
- Produces: `replayGoldenGame(game: GoldenGame): GameState[]` — Plan 1b's catalog route is its only consumer. Index 0 is the built fixture; index `i+1` is the state after `game.steps[i]`.

**Context you need:** Plan 1b builds a component catalog whose fixtures come from the golden games. It cannot import `engine/golden/index.ts` as that barrel stands: line 8 re-exports `./runner`, and `engine/golden/runner.ts:1` imports `expect` from `vitest`. Any app module touching the barrel drags the test framework into the browser bundle.

- [ ] **Step 1: Write the failing test**

Create `engine/golden/replay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_GOLDEN_GAMES } from './index';
import { runGoldenGame } from './runner';
import { replayGoldenGame } from './replay';

describe('replayGoldenGame', () => {
  it('imports nothing from vitest, directly or transitively', () => {
    const src = readFileSync(new URL('./replay.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]vitest['"]/);
    expect(src).not.toMatch(/from ['"]\.\/runner['"]/);
  });

  it.each(ALL_GOLDEN_GAMES.map((g) => [g.id, g] as const))(
    '%s — replay ends where the asserting runner ends',
    (_id, game) => {
      const states = replayGoldenGame(game);
      expect(JSON.stringify(states[states.length - 1])).toBe(JSON.stringify(runGoldenGame(game)));
    },
  );

  it.each(ALL_GOLDEN_GAMES.map((g) => [g.id, g] as const))(
    '%s — yields one state per step plus the fixture',
    (_id, game) => {
      expect(replayGoldenGame(game)).toHaveLength(game.steps.length + 1);
    },
  );
});
```

The length assertion is what keeps indices aligned with `game.steps` — a step carrying `expectError` must still yield an entry, or the catalog would silently mis-label which step it is showing.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run engine/golden/replay.test.ts`
Expected: FAIL — cannot resolve `./replay`.

- [ ] **Step 3: Write the module**

Create `engine/golden/replay.ts`:

```ts
import type { GameState } from '../gameTypes';
import type { GoldenGame } from './types';
import { applyIntent } from '../intents';
import { buildFixture } from './fixtures';

/**
 * Threads a golden game's intents through `applyIntent` and returns every
 * intermediate state: index 0 is the built fixture, index i+1 the state after
 * `game.steps[i]`.
 *
 * The asserting equivalent is `runGoldenGame` in ./runner, which imports vitest
 * and therefore cannot be reached from app code. This module must stay free of
 * test-framework imports — the component catalog bundles it into the browser.
 *
 * A step declaring `expectError` is expected to be rejected; its state entry is
 * the unchanged prior state, so indices stay aligned with `game.steps`. The
 * rejection is not asserted here; ./runner owns that.
 */
export function replayGoldenGame(game: GoldenGame): GameState[] {
  let state = buildFixture(game.setup);
  const states: GameState[] = [state];

  for (const step of game.steps) {
    if (step.expectError) {
      try {
        applyIntent(state, step.intent);
      } catch {
        // expected; the state is unchanged by contract
      }
    } else {
      state = applyIntent(state, step.intent);
    }
    states.push(state);
  }

  return states;
}
```

- [ ] **Step 4: Split the barrel**

In `engine/golden/index.ts`, replace the `export * from './runner';` line with:

```ts
export * from './replay';
// './runner' is deliberately NOT re-exported: it imports vitest, and this barrel
// is reachable from app code. Tests import it directly from './runner'.
```

Then fix the importers `tsc` and vitest point you at — `engine/golden/golden.test.ts` and `engine/golden/replay.test.ts` should import `runGoldenGame` from `./runner` directly.

- [ ] **Step 5: Guard it at the build**

Add to `package.json` scripts:

```json
"check:bundle": "vite build && ! grep -rl \"from'vitest'\\|from \\\"vitest\\\"\" dist/assets 2>/dev/null"
```

Run it once and confirm it passes. If `grep` finds nothing it exits 1, which `!` inverts to success — that is the intended behaviour, and it is worth confirming by hand rather than trusting.

- [ ] **Step 6: Verify**

Run: `npx vitest run engine/golden/` → Expected: all pass
Run: `npm run check:bundle` → Expected: exit 0
Run: `npm run typecheck` → Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add engine package.json
git commit -m "feat(engine): a vitest-free golden replay path for the component catalog"
```

---

### Task 5: The random-play invariant harness

**Files:**
- Create: `engine/golden/invariants.ts`
- Create: `engine/golden/invariants.test.ts`

**Interfaces:**
- Consumes: `GameState.discarded` from Task 2; `applyIntent`, `IllegalIntentError` from `engine/intents.ts`; `createInitialGame` from `engine/gameInit.ts`; `shuffleSeeded` from `engine/gameHelpers.ts`
- Produces: `checkInvariants(state: GameState): string[]` — returns violation messages, empty when clean. Used by this task's test and available to Phase 2.

**Context you need:** This is the carry-forward's closing lesson made executable. Every Phase 0 gate is example-based; 99 tests and 12 golden games all passed on a state machine that deadlocked in 8% of random games, and a throwaway random-play harness found it in seconds.

**Two warnings, both from the Phase 0 fix round.**

First: a probe that reports "no failures" may be proving nothing. The Phase 0 fix round's first attempt reported `stuck=0` against known-broken code, because its policy declared the game over long before tiles ran out — it never reached the states where the bug lived. Its author caught this and deleted it. Your harness must demonstrate it reaches deep states: assert that across the seeds, at least one game ends with an empty bag, and at least one reaches `stage: 'end'`.

Second: if this task finds no bugs at all, say so in your report as an open question rather than a success. The most likely explanation is coverage, not correctness.

- [ ] **Step 1: Write the invariants module**

Create `engine/golden/invariants.ts`:

```ts
import type { GameState } from '../gameTypes';

const TOTAL_TILES = 108;
const SHARES_PER_STARTUP = 25;

/**
 * Structural truths that must hold after every intent, in every game, forever.
 * Returns one message per violation; an empty array means the state is sound.
 *
 * These are deliberately not rules assertions — nothing here knows what a merger
 * is. They are conservation and sanity properties, the kind that example-based
 * tests systematically miss because each example only visits states its author
 * already imagined.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];

  const placed = Object.values(state.board).filter((c) => c.placed).length;
  const inHands = state.players.reduce((n, p) => n + p.hand.length, 0);
  const total = placed + inHands + state.bag.length + state.discarded.length;
  if (total !== TOTAL_TILES) {
    problems.push(
      `tile conservation: placed ${placed} + hands ${inHands} + bag ${state.bag.length} ` +
        `+ discarded ${state.discarded.length} = ${total}, expected ${TOTAL_TILES}`,
    );
  }

  for (const [id, startup] of Object.entries(state.startups)) {
    const held = state.players.reduce((n, p) => n + (p.portfolio[id] ?? 0), 0);
    if (held + startup.availableShares !== SHARES_PER_STARTUP) {
      problems.push(
        `share conservation ${id}: held ${held} + available ${startup.availableShares} ` +
          `= ${held + startup.availableShares}, expected ${SHARES_PER_STARTUP}`,
      );
    }
    if (startup.availableShares < 0) problems.push(`${id} has negative available shares`);
  }

  for (const p of state.players) {
    if (p.cash < 0) problems.push(`${p.name} has negative cash: ${p.cash}`);
    for (const [id, qty] of Object.entries(p.portfolio)) {
      if (qty < 0) problems.push(`${p.name} holds negative ${id}: ${qty}`);
    }
  }

  return problems;
}
```

- [ ] **Step 2: Write the driver and its test**

Create `engine/golden/invariants.test.ts`.

**Two traps verified before this plan was written — the driver below already avoids both, and you should understand why before changing it.**

*Trap one: do not start from `createInitialGame`.* It returns `stage: "draw"` (`engine/gameInit.ts:51`), and **no intent accepts `'draw'`** — every `requireStage` in `engine/intents.ts` names only `play`, `foundStartup`, `chooseSurvivor`, `mergerLiquidation` or `buy`. A harness seeded from `createInitialGame` has every intent rejected at step 0, spins its whole step budget, and reports zero violations having done nothing at all. Build the opening position with `buildFixture` at `stage: 'play'` instead, exactly as the golden games do. (That `createInitialGame` produces a state `applyIntent` cannot advance is a real engine finding; note it in your report, do not fix it here.)

*Trap two: `mergerLiquidation` needs the `liquidate` intent.* Omit that branch and every game that reaches a merger with shareholders stalls forever — silently, and again reporting no violations. The liquidating player is the head of `mergerContext.shareholderQueue`, **not** the turn player; that is the multi-actor path, and exercising it is most of this harness's value.

The driver picks one plausible intent for the current stage, applies it, and checks invariants after every single one. Illegal intents are expected and skipped — the point is to hammer the reducer, not to play well. Where the driver has **no** move for a stage it returns `null`, and the run records that stage as a stall. A stall at anything other than `'end'` is a reportable finding, not a quiet exit: that is the exact shape of the deadlock Phase 0 shipped.

```ts
import { describe, it, expect } from 'vitest';
import type { GameState } from '../gameTypes';
import type { Intent } from '../intents';
import { applyIntent, IllegalIntentError } from '../intents';
import { generateAllCoords, shuffleSeeded } from '../gameHelpers';
import { HAND_SIZE, TRADE_RATIO } from '../startups';
import { buildFixture } from './fixtures';
import { checkInvariants } from './invariants';

const MAX_STEPS = 400;
const SEEDS = Array.from({ length: 60 }, (_, i) => `prop-${i}`);
const NAMES = ['Alex', 'Sam', 'Jordan'];

/**
 * An opening position `applyIntent` can actually advance. `createInitialGame`
 * cannot be used: it yields `stage: 'draw'`, which no intent accepts.
 */
function newGame(seed: string): GameState {
  const all = shuffleSeeded(generateAllCoords(), seed);
  return buildFixture({
    players: NAMES.map((name, i) => ({ name, hand: all.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE) })),
    bag: all.slice(NAMES.length * HAND_SIZE),
    stage: 'play',
  });
}

/** A cheap deterministic picker: shuffles by seed+salt and takes the head. */
function pick<T>(items: T[], seed: string, salt: number): T | undefined {
  return shuffleSeeded(items, `${seed}:${salt}`)[0];
}

/**
 * One plausible intent for the current stage, or null when this driver has no
 * move to make. Null is a signal, not an exit: `playOne` records the stage, and
 * a stall anywhere but `end` is a finding.
 */
function nextIntent(state: GameState, seed: string, salt: number): Intent | null {
  const me = state.players[state.turnIndex];
  if (!me) return null;
  const founded = Object.values(state.startups).filter((s) => s.isFounded).map((s) => s.id);
  const unfounded = Object.values(state.startups).filter((s) => !s.isFounded).map((s) => s.id);

  switch (state.stage) {
    case 'play': {
      const coord = pick(me.hand, seed, salt);
      return coord ? { type: 'placeTile', playerId: me.id, coord } : { type: 'endTurn', playerId: me.id };
    }
    case 'foundStartup': {
      const startupId = pick(unfounded, seed, salt);
      return startupId ? { type: 'chooseFoundingBrand', playerId: me.id, startupId } : null;
    }
    case 'chooseSurvivor': {
      const startupId = pick(state.pendingTiedStartups ?? founded, seed, salt);
      return startupId ? { type: 'chooseSurvivor', playerId: me.id, startupId } : null;
    }
    case 'mergerLiquidation': {
      // Multi-actor: the actor is the head of the shareholder queue, not the
      // player whose turn it is.
      const ctx = state.mergerContext;
      if (!ctx) return null;
      const playerId = ctx.shareholderQueue[ctx.currentShareholderIndex];
      const startupId = ctx.absorbedIds[ctx.currentLiquidationIndex];
      if (!playerId || !startupId) return null;

      const held = state.players.find((p) => p.id === playerId)?.portfolio[startupId] ?? 0;
      // `trade` counts shares handed IN, so it must be a whole multiple of the
      // ratio or the reducer rejects with `oddTradeCount`.
      const trade = salt % 2 === 0 ? held - (held % TRADE_RATIO) : 0;
      return { type: 'liquidate', playerId, startupId, sell: held - trade, trade, keep: 0 };
    }
    case 'buy': {
      // three-way: buy something, declare the end, or just end the turn
      const choice = salt % 3;
      if (choice === 0) return { type: 'endTurn', playerId: me.id };
      if (choice === 1) return { type: 'declareEnd', playerId: me.id };
      const startupId = pick(founded, seed, salt);
      return startupId
        ? { type: 'buyShares', playerId: me.id, picks: [startupId] }
        : { type: 'endTurn', playerId: me.id };
    }
    default:
      return null;
  }
}

interface RunResult {
  seed: string;
  steps: number;
  reachedEnd: boolean;
  emptiedBag: boolean;
  stalledAt: string | null;
  violation: string | null;
  history: Intent[];
}

function playOne(seed: string): RunResult {
  let state = newGame(seed);
  const history: Intent[] = [];
  const base = { seed, reachedEnd: false, emptiedBag: false, stalledAt: null as string | null };
  let emptiedBag = false;
  let salt = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.stage === 'end') {
      return { ...base, steps: step, reachedEnd: true, emptiedBag, violation: null, history };
    }

    const intent = nextIntent(state, seed, salt++);
    if (!intent) {
      return { ...base, steps: step, emptiedBag, stalledAt: state.stage, violation: null, history };
    }

    try {
      state = applyIntent(state, intent);
      history.push(intent);
    } catch (e) {
      if (e instanceof IllegalIntentError) continue;
      return { ...base, steps: step, emptiedBag, violation: String(e), history };
    }

    if (state.bag.length === 0) emptiedBag = true;
    const problems = checkInvariants(state);
    if (problems.length) {
      return { ...base, steps: step, emptiedBag, violation: problems.join('; '), history };
    }
  }

  return { ...base, steps: MAX_STEPS, emptiedBag, reachedEnd: state.stage === 'end', violation: null, history };
}

describe('random-play invariants', () => {
  const runs = SEEDS.map(playOne);
  const report = (r: RunResult) =>
    `seed ${r.seed} @ step ${r.steps}: ${r.violation ?? r.stalledAt}\n  ${JSON.stringify(r.history)}`;

  it('holds every invariant across every seed', () => {
    expect(
      runs.filter((r) => r.violation).map(report),
      'a failing seed above is reproducible — paste its intent list into a golden game',
    ).toEqual([]);
  });

  // The Phase 0 deadlock in one assertion: a game that can go no further while
  // it is not over is a bug, whether the reducer refuses or the driver has no move.
  it('never stalls anywhere but end', () => {
    expect(runs.filter((r) => r.stalledAt).map(report)).toEqual([]);
  });

  // Guards against the probe that proves nothing: a policy that quits early
  // reports zero failures without ever visiting the states where bugs live.
  it('reaches deep states — at least one game empties the bag', () => {
    expect(runs.some((r) => r.emptiedBag)).toBe(true);
  });

  it('reaches terminal states — at least one game ends', () => {
    expect(runs.some((r) => r.reachedEnd)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run engine/golden/invariants.test.ts`

Three outcomes, all legitimate:

- **All three pass.** Note in your report that no bug was found, and that this is weak evidence rather than strong — say what fraction of runs reached `end` and emptied the bag.
- **An invariant fails.** You have found a real bug. Do not fix it inside this task — the harness is the deliverable. Report the seed, the intent history, and the violation, and let the controller decide whether it becomes its own task.
- **The stall test fails.** Also a finding, and the more likely of the two. Read the reported stage before concluding anything: a stall at `mergerPayout`, `liquidation` or `liquidationPrompt` means the engine reaches a stage no intent can advance — a genuine deadlock of the Phase 0 kind. A stall at a stage the driver simply has no branch for is a gap in *your* driver; add the branch. Say which of the two it was.
- **A coverage guard fails** (no game empties the bag or reaches `end`). Your policy is too shallow. Raise `MAX_STEPS`, or bias the `buy` stage away from `declareEnd`, until it reaches depth. A harness that never gets there is the failure mode this task exists to avoid.

- [ ] **Step 4: Verify the whole suite**

Run: `npx vitest run` → Expected: all pass
Run: `npm run typecheck` → Expected: exit 0

Check the wall-clock time. 60 seeds × up to 400 steps, each with a `structuredClone` of the full state, is not free. If the file takes more than about 15 seconds, cut `SEEDS` to 30 and say so — a slow suite gets skipped, which is worse than a smaller one.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "test(engine): random-play harness asserting conservation invariants"
```

---

### Task 6: Golden-catalogue assertions

**Files:**
- Modify: `engine/golden/types.ts` (add `finalScoreBonuses` to `StateAssertion`)
- Modify: `engine/golden/runner.ts` (assert it)
- Modify: `engine/golden/endgame.ts` (a new game; strengthen G10)
- Modify: `engine/golden/mergers.ts` (strengthen G5, G7)
- Modify: `engine/golden/turns.ts` (strengthen G4)

**Interfaces:**
- Consumes: `finalScore(state)` from `engine/endGame.ts`, already used by `runner.ts:70`
- Produces: `StateAssertion.finalScoreBonuses?: Record<string, { chainId: string; type: string; amount: number }[]>`

**Context you need:** The golden catalogue is the executable rules spec, so a gap in it is a gap in the spec. Carry-forward §E lists six; four are addressed here, two in Task 7.

The `StateAssertion` vocabulary is a **closed set** — every field is asserted by `assertState` in `runner.ts`. Phase 0 deleted a `bonuses` field from it because `pendingBonuses` is provably `undefined` at every `then` boundary reachable through `applyIntent`, making the field dead. Do not reintroduce that field. The new one asserts against the `finalScore(state)` **report**, which is a different thing and is live.

- [ ] **Step 1: Add the assertion vocabulary**

In `engine/golden/types.ts`, on `StateAssertion`, after `finalScoreTotals`:

```ts
  /** playerId → the bonus entries finalScore() reports for them, order-insensitive */
  finalScoreBonuses?: Record<string, { chainId: string; type: string; amount: number }[]>;
```

In `engine/golden/runner.ts`, in `assertState`, after the `finalScoreTotals` block:

```ts
  if (a.finalScoreBonuses !== undefined) {
    const report = finalScore(state);
    for (const [id, expected] of Object.entries(a.finalScoreBonuses)) {
      const actual = report.bonuses
        .filter((b) => b.playerId === id)
        .map((b) => ({ chainId: b.chainId, type: b.type, amount: b.amount }));
      const key = (x: { chainId: string; type: string }) => `${x.chainId}:${x.type}`;
      expect([...actual].sort((x, y) => key(x).localeCompare(key(y))), at(`final score bonuses ${id}`))
        .toEqual([...expected].sort((x, y) => key(x).localeCompare(key(y))));
    }
  }
```

- [ ] **Step 2: Pin the sole-holder bonus as ONE entry (G5)**

G5's title promises the sole-holder bonus "as one figure", but it asserts only the cash total — a two-entry implementation summing to the same number would satisfy it identically. In `engine/golden/mergers.ts`, add `finalScoreBonuses` to G5's assertion for the sole holder, with exactly one entry of type `'both'`.

Do **not** copy an amount from this plan. Derive it: `getSharePriceAtSize(tier, size)` from `engine/startups.ts`, then sole-holder = `price × 15` as a single `'both'` entry. Two Phase 0 task briefs shipped a wrong share price by quoting a number instead of deriving it — write the derivation in a comment above the assertion, as `engine/golden/endgame.ts:41-53` does.

- [ ] **Step 3: Pin `declareEnd` being refused (new golden game)**

Nothing currently pins the guard: G10 would pass unchanged if `declareEnd`'s end-condition check were deleted. Add a game to `engine/golden/endgame.ts` — call it **G15** — with a founded chain **below** `SAFE_SIZE` so the end condition is unmet, in `stage: 'buy'`, whose only step is:

```ts
    {
      name: 'no chain is safe and none has reached 41 — the end is not available',
      intent: { type: 'declareEnd', playerId: 'p1' },
      expectError: 'endNotAvailable',
    },
```

Add it to the `ENDGAME_GAMES` array. Confirm the guard is what makes it pass: comment out the `endNotAvailable` check in `doDeclareEnd`, watch G15 fail, restore it. Report that you did this.

- [ ] **Step 4: Extend G7 past the merge step**

G7 is the only multi-absorbed-chain game and it stops at the merge, so the *sequencing* of multiple absorbed chains — the order liquidation walks them — is never exercised. Add steps that carry it through liquidating each absorbed chain in turn, asserting `stage` and the acting player at each boundary. If the engine's ordering surprises you, assert what it actually does and flag the surprise in your report; do not "correct" the engine from this task.

- [ ] **Step 5: Bring G4 up to its siblings**

G4 asserts only `cash` where its five siblings assert `stage`, `shares` and `hand` too. Add those, derived from the fixture.

- [ ] **Step 6: Verify**

Run: `npx vitest run engine/golden/` → Expected: all pass, one more game than before
Run: `npx vitest run` → Expected: all pass
Run: `npm run typecheck` → Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add engine
git commit -m "test(engine): pin declareEnd's guard, sole-holder shape, and multi-merge sequencing"
```

---

### Task 7: Rejection-code and unit coverage

**Files:**
- Modify: `engine/golden/turns.ts` and/or `engine/golden/mergers.ts` (more `expectError` steps)
- Modify: `engine/intents.test.ts`, `engine/log.test.ts`

**Interfaces:**
- Consumes: `IllegalIntentCode` from `engine/intents.ts` — the 14 codes are listed at `engine/intents.ts:31-35`
- Produces: nothing consumed downstream

- [ ] **Step 1: Write a test that names the uncovered codes**

The catalogue currently exercises 3 of the 14 `IllegalIntentCode` values through `expectError`. Add to `engine/golden/golden.test.ts`:

```ts
it('exercises most rejection codes through the catalogue', () => {
  const covered = new Set(
    ALL_GOLDEN_GAMES.flatMap((g) => g.steps.map((s) => s.expectError).filter(Boolean)),
  );
  const uncovered = [
    'wrongStage', 'notYourTurn', 'tileNotInHand', 'illegalPlacement',
    'brandUnavailable', 'notATiedSurvivor', 'shareCountMismatch',
    'oddTradeCount', 'notEnoughShares', 'notEnoughCash',
    'tooManyPicks', 'notADeadTile', 'endNotAvailable', 'unknownIntent',
  ].filter((c) => !covered.has(c as never));

  expect(uncovered, `rejection codes with no golden coverage: ${uncovered.join(', ')}`).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to see the gap**

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: FAIL, listing the uncovered codes by name.

- [ ] **Step 3: Add an `expectError` step per uncovered code**

Work the list the failure prints. Each is one step added to whichever existing game already has the right board and hands set up — prefer extending a game over authoring a new one, since a rejected intent leaves state unchanged and so cannot disturb the steps around it.

`unknownIntent` needs a deliberately malformed intent; cast at the call site in the golden game with a comment explaining that the cast is the point of the test.

- [ ] **Step 4: Close the four unit gaps**

In `engine/intents.test.ts`:

- `buyShares` with a negative count in `picks` is rejected (`shareCountMismatch` or the code the reducer actually uses — check, do not assume)
- a successful basket spanning two different startups in one `buyShares`
- `liquidate` rejected mid-flight leaves state byte-identical: `expect(JSON.stringify(after)).toBe(before)`

In `engine/log.test.ts`:

- `renderLogText` on a `cash` token with amount `0` and with a negative amount, both with and without `delta`

- [ ] **Step 5: Verify**

Run: `npx vitest run` → Expected: all pass, including the coverage test from Step 1
Run: `npm run typecheck` → Expected: exit 0
Run: `npx vite build` → Expected: succeeds

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "test(engine): cover the rejection codes and the four unit gaps"
```

---

## Done when

- `npm run typecheck` exits 0, and it is wired as a gate alongside `vitest` and `vite build`.
- `GameState.discarded` exists and `placed + hands + bag + discarded == 108` holds across random play.
- `SnapshotStore` / `applyIntentWithHistory` / `rewindTo` exist outside `GameState`, with the recursion trap pinned by test.
- `replayGoldenGame` exists, is free of vitest imports, and agrees with `runGoldenGame` on every game.
- The random-play harness runs in CI, demonstrably reaches empty-bag and `end` states, and reports any violation with a reproducible seed.
- All six carry-forward §E coverage gaps are closed.

## What this plan does NOT do

- No React, no `src/` components, no `tailwind.config`. That is Plan 1b.
- No fixing `src/Game.tsx` or `src/components/MergerLiquidation.tsx` — both are on Phase 2's deletion list.
- No wiring `applyIntentWithHistory` into any UI. Phase 2.
- No `server/` changes beyond whatever Task 1's typecheck gate forces.
