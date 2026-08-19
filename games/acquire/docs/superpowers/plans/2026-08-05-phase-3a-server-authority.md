# Phase 3a — Server Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server the authority over online games — it runs `applyIntent`, projects state per recipient, and broadcasts only committed segments — with no client, proven entirely by tests.

**Architecture:** A room is a plain object holding a roster, a `GameSession` (promoted from `src/` to a shared top-level `session/`), and the last committed `GameState`. The session's current state is the open segment's *draft*; only its author ever sees it. When the actor changes, the draft commits and every player receives their own projection. The XState layer is deleted: the engine's `stage` and `getCurrentActor` are the model.

**Tech Stack:** TypeScript 5 (ESM, `moduleResolution: bundler`), Express 5, socket.io 4.8, vitest 4, tsx. No new runtime dependencies; `xstate` is removed.

**Design:** [../specs/2026-08-05-phase-3a-server-authority-design.md](../specs/2026-08-05-phase-3a-server-authority-design.md)

## Global Constraints

- **Never run bare `tsc`.** Use `npm run typecheck`.
- **Chain gates with `&&`, never `;`.** A previous phase committed after a failed typecheck because `;` let it through. Every commit step in this plan uses `&&`.
- **Do not modify `src/components/`, `src/Game.tsx`, or `prototype/`.** They are legacy and are deleted in 3b/5, not here.
- **No engine changes.** `engine/**` is read-only for this phase. If a change proves necessary, stop and report it as a finding — it means a rule was missed, not that the plan was short.
- **No `as any`.** One narrow `as Intent` is explicitly sanctioned in Task 4 and documented there; nothing else casts.
- **Never import `engine/golden/runner` from `src/`** — it pulls vitest into the bundle. `server/` and `session/` tests may import it freely; they are not bundled.
- **A gate you have not broken is not a gate.** Every test in this plan has an explicit step that breaks the code, observes the failure, and reverts. Async socket tests fail vacuously in a way synchronous ones do not — an assertion inside a listener that never fires is a passing test.
- **Derive from the engine, never hardcode.** Every figure comes from replayed state.
- Player ids are `p1..pn` by seat, assigned identically by `createInitialGame` and `buildFixture`.
- Server files import across directories with `.js` extensions (existing `server/` convention). `session/` and `engine/` use extensionless imports. `tsx` resolves both.

## File Structure

| File | Responsibility |
|---|---|
| `session/GameSession.ts` | Moved from `src/game/session/`. Committed state, draft, segment-scoped snapshots, actor tracking. Imported by both `src/` and `server/`. |
| `session/protocol.ts` | Wire types. `WireIntent` derived from `Intent`; message shapes; event-name constants. |
| `server/projection.ts` | `project(state, forPlayerId)` — the only place private fields are stripped. |
| `server/room.ts` | `GameRoom`: roster, session, committed state, commit detection, undo authorisation. Computes *what to deliver*; sends nothing. |
| `server/rooms.ts` | The registry: create, look up, persist. Absorbs `roomManager.ts`. |
| `server/index.ts` | Transport only: socket binding, event wiring, and the one place `project` is called. |
| `server/persistence.ts` | Saves committed state. Never drafts. |

**Deleted:** `server/machines/gameRoomMachine.ts`, `server/machines/playerMachine.ts`, `server/machines/types.ts`, `server/gameManagerXState.ts`, `server/playerAuth.ts`, `server/roomManager.ts`, `server/test-client.js`, `server/test.html`, `server/engineSpike.test.ts`.

---

### Task 1: Projection, and the claim the whole design rests on

The optimistic client is only sound if `applyIntent` behaves identically on a redacted state. This task builds `project` and proves that, before anything depends on it.

**Files:**
- Modify: `vite.config.ts` (the `projects` array)
- Create: `server/projection.ts`
- Test: `server/projection.test.ts`

**Interfaces:**
- Consumes: `engine/gameTypes` (`GameState`), `engine/golden/fixtures` (`buildFixture`), `engine/golden` (`ALL_GOLDEN_GAMES`), `engine/intents` (`applyIntent`, `IllegalIntentError`).
- Produces: `project(state: GameState, forPlayerId: string): GameState` from `server/projection.ts`. Tasks 6 and 8 call it.

- [ ] **Step 1: Move server and session tests into a node project**

`server/**/*.test.ts` currently runs under jsdom, which the config's own comment explains is wrong. Replace the whole `projects` array in `vite.config.ts`, and update the comment above it:

```ts
    // Two projects, one reason: `engine/`, `session/` and `server/` must not
    // depend on browser globals. They run under Node in production — the
    // server process — and are imported by `src/` as well, so a stray
    // `window.` is a production crash. Under a single jsdom suite `window`
    // always exists and no test can ever catch it. Running them under
    // `environment: 'node'` makes that boundary enforced instead of merely
    // documented. `src/` keeps the jsdom + jest-dom setup it had.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: [
            'engine/**/*.test.ts',
            'session/**/*.test.ts',
            'server/**/*.test.ts',
          ],
          environment: 'node',
          globals: true,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: './src/test/setup.ts',
        },
      },
    ],
```

`session/**` matches nothing yet — Task 2 creates it. Including it now means Task 2 cannot silently orphan the moved tests.

- [ ] **Step 2: Confirm the suite still passes under the new projects**

Run: `npx vitest run`
Expected: PASS. The existing `server/engineSpike.test.ts` now runs in node rather than jsdom; it uses no DOM, so it passes unchanged.

- [ ] **Step 3: Write the failing tests**

Create `server/projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { applyIntent, IllegalIntentError } from '../engine/intents.js';
import type { GameState } from '../engine/gameTypes.js';
import { project } from './projection.js';

function twoHands(): GameState {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1', 'B2'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('project', () => {
  it("blanks the seed, the bag, and every hand but the recipient's", () => {
    const projected = project(twoHands(), 'p1');

    expect(projected.seed).toBe('');
    expect(projected.bag).toEqual([]);
    expect(projected.players.find((p) => p.id === 'p1')!.hand).toEqual(['E6', 'H8']);
    expect(projected.players.find((p) => p.id === 'p2')!.hand).toEqual([]);
  });

  it('leaves the source state untouched', () => {
    const state = twoHands();
    project(state, 'p1');

    expect(state.seed).toBe('golden-fixture');
    expect(state.bag).toEqual(['I11', 'I12']);
    expect(state.players[1].hand).toEqual(['A1', 'B2']);
  });

  it('keeps what is public', () => {
    const state = twoHands();
    const projected = project(state, 'p1');

    expect(projected.board).toEqual(state.board);
    expect(projected.startups).toEqual(state.startups);
    expect(projected.discarded).toEqual(state.discarded);
    expect(projected.players.map((p) => p.cash)).toEqual([6000, 6000]);
    expect(projected.players.map((p) => p.name)).toEqual(['Alex', 'Sam']);
  });

  it('carries no socketId to anyone', () => {
    const state = twoHands();
    state.players[0].socketId = 'sock-1';
    state.players[1].socketId = 'sock-2';

    for (const p of project(state, 'p1').players) {
      expect(p.socketId).toBeUndefined();
    }
  });
});

/**
 * The three intents that draw from the bag. A projected client holds no bag,
 * so it cannot compute these — by design. Everything else it can.
 */
const DRAWS = new Set(['endTurn', 'tradeInDeadTiles', 'startGame']);

function outcome(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (e) {
    return e instanceof IllegalIntentError ? `rejected:${e.code}` : `threw:${String(e)}`;
  }
}

describe('a projected state reduces exactly like the full one', () => {
  it('the golden corpus holds enough predictable steps to be worth checking', () => {
    const predictable = ALL_GOLDEN_GAMES.flatMap((g) => g.steps).filter(
      (s) => !DRAWS.has(s.intent.type),
    );
    // Measured at 42 when this was written. A floor, not an equality: adding
    // golden games must not break it, but a harness that silently stops
    // finding steps must.
    expect(predictable.length).toBeGreaterThanOrEqual(40);
  });

  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, () => {
      let state = buildFixture(game.setup);

      for (const step of game.steps) {
        const pid = step.intent.playerId;
        const where = `${game.id} / ${step.name}`;

        if (DRAWS.has(step.intent.type)) {
          if (!step.expectError) state = applyIntent(state, step.intent);
          continue;
        }

        const projected = project(state, pid);

        if (step.expectError) {
          expect(outcome(() => applyIntent(projected, step.intent)), where).toBe(
            outcome(() => applyIntent(state, step.intent)),
          );
          continue;
        }

        const next = applyIntent(state, step.intent);
        expect(applyIntent(projected, step.intent), where).toEqual(project(next, pid));
        state = next;
      }
    });
  }
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run server/projection.test.ts`
Expected: FAIL — `Failed to resolve import "./projection.js"`.

- [ ] **Step 5: Write the implementation**

Create `server/projection.ts`:

```ts
import type { GameState } from '../engine/gameTypes.js';

/**
 * The game as one player is allowed to see it.
 *
 * Three fields go and one deliberately stays. `seed` goes because the bag is
 * shuffled once at init and never re-seeded, so the seed alone reconstructs
 * the entire draw order for the rest of the game. `bag` goes for the same
 * reason, more directly. Every other player's `hand` goes because it is the
 * one secret this game actually has. `socketId` goes because it is transport
 * bookkeeping no client has a use for.
 *
 * `discarded` stays: traded-in dead tiles are shown at a real table, and the
 * deduction they permit is legitimate.
 *
 * The shape is unchanged, which is why the component layer renders a
 * projection without modification — the only private field it reads is the
 * viewer's own hand (`src/game/GameScreen.tsx`).
 *
 * Call this at the moment of sending, never earlier and never cached. A
 * projection computed correctly and then broadcast unprojected is the defect
 * this phase most needs to catch, and only the send site can tell them apart.
 */
export function project(state: GameState, forPlayerId: string): GameState {
  return {
    ...state,
    seed: '',
    bag: [],
    players: state.players.map(({ socketId, ...player }) =>
      player.id === forPlayerId ? player : { ...player, hand: [] },
    ),
  };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run server/projection.test.ts`
Expected: PASS — 22 tests (4 redaction, 1 corpus floor, 17 golden games).

- [ ] **Step 7: Break each gate and observe it fail**

Two independent claims are under test here and each needs its own break. Do them one at a time, observing the failure, then reverting.

1. **Redaction.** In `project`, change `bag: [],` to `bag: state.bag,`. Run the file. Expected: the first `project` test fails on `projected.bag`. The equivalence suite still passes — which is correct and is exactly why redaction needs its own tests. Revert.
2. **Equivalence.** In `project`, add `turnIndex: 0,` after `bag: [],`. Run the file. Expected: multiple golden-game equivalence tests fail. Revert.

Confirm both reverts with `npx vitest run server/projection.test.ts` (PASS) before committing.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts server/projection.ts server/projection.test.ts && \
  npm run typecheck && npx vitest run && \
  git commit -m "feat(server): per-player projection, proven equivalent under the reducer"
```

---

### Task 2: Promote the session to a shared top-level module

The server needs the draft, the segment-scoped snapshot store, and the actor — which is `GameSession` exactly. It lives under `src/`, where the server cannot reach it.

**Files:**
- Move: `src/game/session/GameSession.ts` → `session/GameSession.ts`
- Move: `src/game/session/GameSession.test.ts` → `session/GameSession.test.ts`
- Modify: `session/GameSession.ts` (import depths, `segmentStart` on `SessionView`)
- Modify: `tsconfig.json` (`include`)
- Modify: eight importers, listed in Step 3

**Interfaces:**
- Produces: `session/GameSession.ts` exporting `createGameSession`, `GameSession`, `SessionView`, `SessionInit`, `SessionError`. `SessionView` gains `segmentStart: number`. Tasks 3–8 import from here.

- [ ] **Step 1: Move the files**

```bash
mkdir -p session && \
  git mv src/game/session/GameSession.ts session/GameSession.ts && \
  git mv src/game/session/GameSession.test.ts session/GameSession.test.ts
```

- [ ] **Step 2: Fix the moved files' own imports**

In `session/GameSession.ts`, rewrite each `'../../../engine/…'` to `'../engine/…'`. There are five: `gameTypes`, `intents`, `history`, `gameInit`, `actor`.

In `session/GameSession.test.ts`, rewrite the three `'../../../engine/…'` specifiers to `'../engine/…'`: `golden/fixtures`, `golden`, `golden/replay`. The `'./GameSession'` import is unchanged.

- [ ] **Step 3: Update the eight importers**

| File | Old specifier | New specifier |
|---|---|---|
| `src/game/GameScreen.tsx` | `'./session/GameSession'` | `'../../session/GameSession'` |
| `src/game/GameScreen.test.tsx` | `'./session/GameSession'` | `'../../session/GameSession'` |
| `src/game/screen/useTurnPanel.tsx` | `'../session/GameSession'` | `'../../../session/GameSession'` |
| `src/game/screen/useTurnPanel.test.tsx` | `'../session/GameSession'` | `'../../../session/GameSession'` |
| `src/game/screen/drivenGolden.test.tsx` | `'../session/GameSession'` | `'../../../session/GameSession'` |
| `src/game/session/useGameSession.ts` | `'./GameSession'` | `'../../../session/GameSession'` |
| `src/game/session/useGameSession.test.tsx` | `'./GameSession'` | `'../../../session/GameSession'` |
| `src/pages/PassAndPlayPage.tsx` | `'../game/session/GameSession'` | `'../../session/GameSession'` |

`src/game/session/useGameSession.ts` and its test stay where they are — they are the React binding and nothing else.

- [ ] **Step 4: Add `session` to the typecheck**

In `tsconfig.json`, change the `include` array to:

```json
  "include": ["engine", "session", "src", "server", "vite.config.ts"]
```

- [ ] **Step 5: Verify the move alone is clean**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, with `session/GameSession.test.ts` now reported under the `node` project rather than `app`. If it is reported under neither, Task 1 Step 1 was not applied — fix that before continuing.

- [ ] **Step 6: Write the failing test for `segmentStart`**

Append to `session/GameSession.test.ts`:

```ts
describe('segmentStart', () => {
  function stuckOpening() {
    // p1 holds nothing, so `endTurn` is legal from `play` and the turn passes
    // without needing a placement. An empty bag means no draw, which keeps the
    // step count predictable.
    return buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: [] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: [],
    });
  }

  it('opens at the first step id the session will file', () => {
    const session = createGameSession({ state: stuckOpening() });
    expect(session.getView().segmentStart).toBe(1);
  });

  it('advances when the actor changes, and empties the undo range with it', () => {
    const session = createGameSession({ state: stuckOpening() });
    const opened = session.getView().segmentStart;

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    const view = session.getView();

    expect(view.actorId).toBe('p2');
    expect(view.segmentStart).toBeGreaterThan(opened);
    expect(view.undoableSteps).toEqual([]);
  });

  it('holds still while the same actor keeps working', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        loners: ['E5'],
        bag: [],
      }),
    });
    const opened = session.getView().segmentStart;

    // Placing E6 beside the E5 loner founds a chain: same actor, stage moves
    // to `foundStartup`, segment stays open.
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const view = session.getView();

    expect(view.actorId).toBe('p1');
    expect(view.segmentStart).toBe(opened);
    expect(view.undoableSteps.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run session/GameSession.test.ts`
Expected: FAIL — `expected undefined to be 1`, because `SessionView` has no `segmentStart`.

- [ ] **Step 8: Implement `segmentStart`**

In `session/GameSession.ts`, add the field to `SessionView`:

```ts
  /**
   * The step id the open segment began at. Every snapshot below it belongs to
   * a committed segment and is nobody's to undo.
   *
   * Exposed because Phase 3's server has to see a commit boundary it would
   * otherwise re-derive — and a second derivation of the segment rule is the
   * duplication this module exists to prevent.
   */
  segmentStart: number;
```

and return it from `buildView()`:

```ts
  function buildView(): SessionView {
    return {
      state,
      actorId,
      awaitingReveal,
      undoableSteps: [...store.keys()].filter((k) => k >= segmentStart).sort((a, b) => a - b),
      segmentStart,
      error,
    };
  }
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm run typecheck && npx vitest run`
Expected: PASS across both projects.

- [ ] **Step 10: Break it and observe the failure**

In `buildView`, change `segmentStart,` to `segmentStart: 0,`. Run `npx vitest run session/GameSession.test.ts`. Expected: the "opens at the first step id" and "advances when the actor changes" tests both fail. Revert and re-run to confirm PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && npm run typecheck && npx vitest run && \
  git commit -m "refactor(session): promote GameSession to a shared top-level module"
```

---

### Task 3: The wire protocol

**Files:**
- Create: `session/protocol.ts`
- Test: `session/protocol.test.ts`

**Interfaces:**
- Consumes: `engine/intents` (`Intent`, `IllegalIntentCode`), `engine/gameTypes` (`GameState`).
- Produces: `WireIntent`, `RejectionCode`, `StateReason`, `StateMessage`, `RejectedMessage`, `JoinedMessage`, `RosterMessage`, `CreateRoomMessage`, `JoinRoomMessage`, `UndoMessage`, `CLIENT_EVENTS`, `SERVER_EVENTS`. Tasks 4, 6, 7 and 8 all import from here.

- [ ] **Step 1: Write the failing test**

Create `session/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ALL_GOLDEN_GAMES } from '../engine/golden';
import type { WireIntent } from './protocol';
import { CLIENT_EVENTS, SERVER_EVENTS } from './protocol';

/**
 * Compile-time exhaustiveness. If `Intent` gains a member this Record stops
 * being complete and `npm run typecheck` fails — which is where the real
 * guarantee lives, since `Intent` is a type and has no runtime form to
 * enumerate.
 */
const WIRE_INTENT_TYPES: Record<WireIntent['type'], true> = {
  placeTile: true,
  chooseFoundingBrand: true,
  chooseSurvivor: true,
  liquidate: true,
  buyShares: true,
  tradeInDeadTiles: true,
  declareEnd: true,
  endTurn: true,
  startGame: true,
};

describe('WireIntent', () => {
  it('covers every intent type the golden corpus exercises', () => {
    // A real cross-check rather than a restatement: the corpus is independent
    // evidence of which intents exist, so an entry deleted from the Record
    // above fails here even though the Record still typechecks.
    //
    // Only steps the corpus expects to *succeed* count as evidence.
    // `engine/golden/turns.ts:96` deliberately sends `{ type: 'bogus' }`, cast
    // through `unknown` because `Intent` is a closed union, to prove
    // `applyIntent`'s default branch rejects what it does not recognise. That
    // is a negative case and must not be read as a requirement on the wire.
    const exercised = [
      ...new Set(
        ALL_GOLDEN_GAMES.flatMap((g) => g.steps)
          .filter((s) => !s.expectError)
          .map((s) => s.intent.type),
      ),
    ].sort();

    expect(exercised.length).toBeGreaterThan(5);
    for (const type of exercised) {
      expect(Object.keys(WIRE_INTENT_TYPES), `${type} is exercised but not on the wire`)
        .toContain(type);
    }
  });

  it('still narrows on `type`, so Omit did not collapse the union', () => {
    // With a non-distributive `Omit<Intent, 'playerId'>` this block does not
    // compile: the union collapses to its common keys and `coord` is gone.
    const wire: WireIntent = { type: 'placeTile', coord: 'E5' };
    if (wire.type !== 'placeTile') throw new Error('narrowing failed');
    expect(wire.coord).toBe('E5');
  });

  it('carries no playerId to lie in', () => {
    const wire: WireIntent = { type: 'endTurn' };
    expect(Object.keys(wire)).toEqual(['type']);
  });
});

describe('event names', () => {
  it('are distinct across directions, so a handler cannot be wired backwards', () => {
    const client = Object.values(CLIENT_EVENTS);
    const server = Object.values(SERVER_EVENTS);
    expect(new Set([...client, ...server]).size).toBe(client.length + server.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run session/protocol.test.ts`
Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 3: Write the implementation**

Create `session/protocol.ts`:

```ts
import type { GameState } from '../engine/gameTypes';
import type { Intent, IllegalIntentCode } from '../engine/intents';

/**
 * `Omit` does not distribute over a union: `Omit<Intent, 'playerId'>` collapses
 * nine members into one object carrying only their common keys, and
 * `placeTile`'s `coord` disappears. This preserves the union, so a
 * `WireIntent` narrows on `type` exactly as an `Intent` does.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An intent as it travels: no `playerId`.
 *
 * The server fills that in from the socket binding, which makes claiming to be
 * another player unrepresentable rather than merely rejected — and that is what
 * makes projection a boundary rather than a decoration.
 *
 * Derived from `Intent` rather than restated, so a new engine intent cannot
 * silently fail to reach the wire.
 */
export type WireIntent = DistributiveOmit<Intent, 'playerId'>;

/**
 * Everything the engine can refuse, plus the one refusal the engine knows
 * nothing about. Undo is not an intent — it never reaches `applyIntent` — so
 * `IllegalIntentCode` has no word for "that step belongs to a segment you no
 * longer own". Adding one here keeps `engine/` untouched.
 */
export type RejectionCode = IllegalIntentCode | 'undoOutOfSegment';

/**
 * Why a state arrived. `commit` went to the whole table; `correction` and
 * `reset` went to one player. Tests assert on this: "a non-actor never
 * receives a correction" is the draft-privacy guarantee, stated directly.
 */
export type StateReason = 'commit' | 'correction' | 'reset';

export interface StateMessage {
  /** Projected for this recipient: no seed, no bag, no other player's hand. */
  state: GameState;
  reason: StateReason;
  segmentStart: number;
}

export interface RejectedMessage {
  code: RejectionCode;
  message: string;
}

export interface JoinedMessage {
  roomId: string;
  playerId: string;
  /** Presented on rejoin. Issued once, at first join, and never re-issued. */
  token: string;
}

export interface RosterMessage {
  roomId: string;
  lifecycle: 'lobby' | 'playing' | 'over';
  players: { id: string; name: string; isHost: boolean; connected: boolean }[];
}

export interface CreateRoomMessage { name: string }
export interface JoinRoomMessage { roomId: string; name: string; playerId?: string; token?: string }
export interface UndoMessage { stepId: number }

export const CLIENT_EVENTS = {
  createRoom: 'createRoom',
  joinRoom: 'joinRoom',
  beginGame: 'beginGame',
  intent: 'intent',
  undo: 'undo',
} as const;

export const SERVER_EVENTS = {
  state: 'state',
  rejected: 'rejected',
  roster: 'roster',
  joined: 'joined',
} as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npx vitest run session/protocol.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Break it and observe the failure**

Change `DistributiveOmit<Intent, 'playerId'>` to `Omit<Intent, 'playerId'>`. Run `npm run typecheck`. Expected: FAIL — `Object literal may only specify known properties, and 'coord' does not exist`, from the narrowing test. This is the break that matters: it proves the distributive type is doing work rather than decorating. Revert and re-run to confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add session/protocol.ts session/protocol.test.ts && \
  npm run typecheck && npx vitest run && \
  git commit -m "feat(session): wire protocol types, with playerId removed from the wire"
```

---

### Task 4: The room

The authority, with no transport in it. It decides what happened; Task 6 decides who hears about it.

**Files:**
- Create: `server/room.ts`
- Test: `server/room.test.ts`

**Interfaces:**
- Consumes: `session/GameSession` (`createGameSession`, `GameSession`, `SessionView`), `session/protocol` (`WireIntent`, `RejectionCode`), `engine/actor` (`getCurrentActor`), `engine/gameInit` (`createInitialGame`), `engine/gameTypes` (`GameState`), `engine/intents` (`Intent`).
- Produces: `createGameRoom(id, players, initial?): GameRoom`, and the types `GameRoom`, `RoomPlayer`, `Lifecycle`, `Delivery`. Tasks 5, 6, 7 and 8 use all of them.

- [ ] **Step 1: Write the failing tests**

Create `server/room.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { applyIntent } from '../engine/intents.js';
import { getCurrentActor } from '../engine/actor.js';
import { createGameRoom, type RoomPlayer } from './room.js';

function roster(...names: string[]): RoomPlayer[] {
  return names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    token: `token-${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

/** p1 can found a chain with E6; p2 waits. */
function openBoard() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('the room stays silent while a segment is open', () => {
  it('says nothing when the actor advances their own draft', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());

    const delivery = room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    expect(delivery).toEqual({ kind: 'none' });
    expect(room.actorId()).toBe('p1');
  });

  it('keeps the committed state behind the draft', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const before = room.committed();

    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    expect(room.committed()).toEqual(before);
    expect(room.draft()).not.toEqual(before);
    expect(room.draft().board['E6'].placed).toBe(true);
    expect(room.committed().board['E6']?.placed).toBeUndefined();
  });
});

describe('the room commits when the actor changes', () => {
  it('publishes the draft and reports a commit', () => {
    const room = createGameRoom(
      'r1',
      roster('Alex', 'Sam'),
      buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: [] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        loners: ['E5'],
        bag: [],
      }),
    );

    const delivery = room.dispatch('p1', { type: 'endTurn' });

    expect(delivery).toEqual({ kind: 'commit' });
    expect(room.actorId()).toBe('p2');
    expect(room.committed()).toEqual(room.draft());
  });
});

describe('the room refuses what the engine refuses', () => {
  it('rejects an intent from the player whose turn it is not', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());

    const delivery = room.dispatch('p2', { type: 'placeTile', coord: 'A1' });

    expect(delivery).toEqual({
      kind: 'rejected',
      to: 'p2',
      code: 'notYourTurn',
      message: expect.any(String),
    });
  });

  it('leaves the draft untouched after a rejection', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const before = room.draft();

    room.dispatch('p2', { type: 'placeTile', coord: 'A1' });

    expect(room.draft()).toEqual(before);
  });
});

describe('undo is authorised by the room, not the session', () => {
  it('lets the actor rewind inside its own open segment', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const opened = room.segmentStart();
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p1', opened);

    expect(delivery).toEqual({ kind: 'correction', to: 'p1' });
    expect(room.draft().board['E6']?.placed).toBeUndefined();
  });

  it('refuses an undo from someone who is not the actor', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const opened = room.segmentStart();
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p2', opened);

    expect(delivery).toMatchObject({ kind: 'rejected', to: 'p2', code: 'notYourTurn' });
    expect(room.draft().board['E6'].placed).toBe(true);
  });

  it('refuses a step below the open segment', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p1', 0);

    expect(delivery).toMatchObject({ kind: 'rejected', to: 'p1', code: 'undoOutOfSegment' });
  });
});

describe('beginning a game', () => {
  it('creates a state whose player ids match the roster seats', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam', 'Jordan'));
    expect(room.lifecycle()).toBe('lobby');

    const delivery = room.begin('seed-abc');

    expect(delivery).toEqual({ kind: 'commit' });
    expect(room.lifecycle()).toBe('playing');
    expect(room.committed().players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(room.committed().players.map((p) => p.name)).toEqual(['Alex', 'Sam', 'Jordan']);
    expect(room.committed().stage).toBe('draw');
  });
});

/**
 * Test 6 from the design. A payout can precede its commit — that was measured
 * and is accepted — but nobody may ever be *asked to act* on a state that does
 * not yet show them their own money.
 */
describe('no player is asked to act on stale money', () => {
  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, () => {
      let state = buildFixture(game.setup);
      // playerId → the cash in the last state that player was shown.
      const lastSeen = new Map<string, number>();
      for (const p of state.players) lastSeen.set(p.id, p.cash);

      let actor = getCurrentActor(state);

      for (const step of game.steps) {
        if (step.expectError) {
          try { applyIntent(state, step.intent); } catch { /* expected */ }
          continue;
        }
        state = applyIntent(state, step.intent);
        const next = getCurrentActor(state);

        if (next !== actor) {
          // A commit: everyone is shown the new state.
          for (const p of state.players) lastSeen.set(p.id, p.cash);
          actor = next;
        }

        if (actor !== null) {
          const acting = state.players.find((p) => p.id === actor)!;
          expect(lastSeen.get(actor), `${game.id} / ${step.name} — ${actor} acts on stale cash`)
            .toBe(acting.cash);
        }
      }
    });
  }
});

/**
 * Test 8 from the design: the measured bound on how long a payout may stay
 * unbroadcast. Pinned so that an engine change widening it is noticed.
 */
describe('a payout precedes its commit by a bounded number of intents', () => {
  it('never lags by more than two, across the whole corpus', () => {
    let worst = 0;

    for (const game of ALL_GOLDEN_GAMES) {
      let state = buildFixture(game.setup);
      const steps = game.steps;

      for (let i = 0; i < steps.length; i++) {
        if (steps[i].expectError) {
          try { applyIntent(state, steps[i].intent); } catch { /* expected */ }
          continue;
        }
        const before = state;
        state = applyIntent(state, steps[i].intent);

        const movedOthers = state.players.some((p) => {
          const was = before.players.find((q) => q.id === p.id)!;
          return p.id !== steps[i].intent.playerId && p.cash !== was.cash;
        });
        if (!movedOthers) continue;

        let probe = state;
        const actorAt = getCurrentActor(state);
        let lag = 0;
        for (let j = i + 1; j < steps.length && getCurrentActor(probe) === actorAt; j++) {
          if (steps[j].expectError) continue;
          probe = applyIntent(probe, steps[j].intent);
          lag++;
        }
        worst = Math.max(worst, lag);
      }
    }

    expect(worst).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/room.test.ts`
Expected: FAIL — cannot resolve `./room.js`.

- [ ] **Step 3: Write the implementation**

Create `server/room.ts`:

```ts
import type { GameState } from '../engine/gameTypes.js';
import type { Intent } from '../engine/intents.js';
import { getCurrentActor } from '../engine/actor.js';
import { createInitialGame } from '../engine/gameInit.js';
import { createGameSession, type GameSession } from '../session/GameSession.js';
import type { RejectionCode, WireIntent } from '../session/protocol.js';

export interface RoomPlayer {
  id: string;
  name: string;
  /** Issued at first join, presented on rejoin. Never leaves the server twice. */
  token: string;
  isHost: boolean;
  connected: boolean;
}

export type Lifecycle = 'lobby' | 'playing' | 'over';

/**
 * What the transport must do next. The room computes it and sends nothing:
 * every socket call, and every call to `project`, lives in `server/index.ts`.
 * Keeping them apart is what lets the whole authority be tested without a
 * network, and what stops a projection being computed anywhere but the send
 * site.
 */
export type Delivery =
  | { kind: 'none' }
  | { kind: 'commit' }
  | { kind: 'correction'; to: string }
  | { kind: 'rejected'; to: string; code: RejectionCode; message: string };

export interface GameRoom {
  readonly id: string;
  readonly players: RoomPlayer[];
  lifecycle(): Lifecycle;
  /** What the table has seen. */
  committed(): GameState;
  /** The open segment's work in progress. Only its actor may be shown this. */
  draft(): GameState;
  actorId(): string | null;
  segmentStart(): number;
  begin(seed: string): Delivery;
  dispatch(playerId: string, wire: WireIntent): Delivery;
  undo(playerId: string, stepId: number): Delivery;
}

/**
 * The three intents that draw from the bag, and therefore the only ones whose
 * result a projected client cannot compute for itself. `endTurn` and
 * `startGame` also change the actor, so they commit and the whole table is told
 * anyway; `tradeInDeadTiles` does not, which makes it the sole reason a
 * mid-segment correction exists at all.
 */
const DRAWS = new Set<WireIntent['type']>(['endTurn', 'tradeInDeadTiles', 'startGame']);

/**
 * Rebuilds a full `Intent` from what arrived on the wire plus the identity the
 * socket is bound to.
 *
 * The cast is deliberately confined to this one line. Spreading a discriminated
 * union produces a type TypeScript will not narrow back to that union, even
 * though every `WireIntent` plus a `playerId` is by construction an `Intent`.
 * `session/protocol.ts` derives one from the other, so they cannot drift.
 */
function withPlayer(wire: WireIntent, playerId: string): Intent {
  return { ...wire, playerId } as Intent;
}

export function createGameRoom(
  id: string,
  players: RoomPlayer[],
  initial?: GameState,
): GameRoom {
  let lifecycle: Lifecycle = initial ? 'playing' : 'lobby';
  let session: GameSession | null = initial ? createGameSession({ state: initial }) : null;
  let committed: GameState | null = session ? session.getView().state : null;

  function open(): GameSession {
    if (!session) throw new Error(`room ${id} has not begun`);
    return session;
  }

  /** Publishes the draft and records whether the game is over. */
  function commit(state: GameState): Delivery {
    committed = state;
    if (state.stage === 'end') lifecycle = 'over';
    return { kind: 'commit' };
  }

  return {
    id,
    players,

    lifecycle: () => lifecycle,
    committed: () => {
      if (!committed) throw new Error(`room ${id} has not begun`);
      return committed;
    },
    draft: () => open().getView().state,
    actorId: () => open().getView().actorId,
    segmentStart: () => open().getView().segmentStart,

    begin(seed) {
      if (lifecycle !== 'lobby') throw new Error(`room ${id} has already begun`);
      // `createInitialGame` assigns ids `p1..pn` by seat, which is how the
      // roster numbers them too — so the socket binding and the engine agree
      // about who is who without a mapping layer.
      const state = createInitialGame(seed, players.map((p) => p.name));
      session = createGameSession({ state });
      lifecycle = 'playing';
      return commit(session.getView().state);
    },

    dispatch(playerId, wire) {
      const s = open();
      const opened = s.getView().segmentStart;

      s.dispatch(withPlayer(wire, playerId));
      const view = s.getView();

      if (view.error) {
        return { kind: 'rejected', to: playerId, code: view.error.code, message: view.error.message };
      }

      if (view.segmentStart !== opened) return commit(view.state);

      // The draft advanced and stayed with its author. They computed the same
      // result locally, unless it drew from a bag they do not hold.
      return DRAWS.has(wire.type) ? { kind: 'correction', to: playerId } : { kind: 'none' };
    },

    undo(playerId, stepId) {
      const s = open();
      const view = s.getView();

      if (getCurrentActor(view.state) !== playerId) {
        return {
          kind: 'rejected',
          to: playerId,
          code: 'notYourTurn',
          message: 'only the player being waited on may undo',
        };
      }
      if (!view.undoableSteps.includes(stepId)) {
        return {
          kind: 'rejected',
          to: playerId,
          code: 'undoOutOfSegment',
          message: `step ${stepId} is not in the open segment`,
        };
      }

      s.undoTo(stepId);
      return { kind: 'correction', to: playerId };
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npx vitest run server/room.test.ts`
Expected: PASS — 27 tests (9 behavioural, 17 stale-money golden games, 1 lag bound).

- [ ] **Step 5: Break each gate and observe it fail**

Four independent claims, four breaks. One at a time; revert each before the next.

1. **Draft privacy.** In `dispatch`, change the final line to `return { kind: 'commit' };`. Expected: "says nothing when the actor advances their own draft" and "keeps the committed state behind the draft" fail.
2. **Undo authorisation.** In `undo`, delete the `getCurrentActor` guard. Expected: "refuses an undo from someone who is not the actor" fails.
3. **Segment scoping.** In `undo`, replace `!view.undoableSteps.includes(stepId)` with `false`. Expected: "refuses a step below the open segment" fails — with `no snapshot for step 0` thrown from `rewindTo`, which is the wrong failure mode and exactly why the guard exists.
4. **The lag bound.** Change `expect(worst).toBe(2)` to `expect(worst).toBe(0)`. Expected: FAIL, reporting 2. This proves the measurement runs rather than short-circuiting on an empty corpus.

Re-run to confirm PASS after each revert.

- [ ] **Step 6: Commit**

```bash
git add server/room.ts server/room.test.ts && \
  npm run typecheck && npx vitest run && \
  git commit -m "feat(server): the room — draft, commit boundary, and undo authorisation"
```

---

### Task 5: The registry and persistence

**Files:**
- Create: `server/rooms.ts`
- Modify: `server/persistence.ts` (rewrite around committed state)
- Test: `server/rooms.test.ts`

**Deliberately not here — corrected during execution.** `server/roomManager.ts` is not deleted,
`server/types.ts` is not trimmed, and **`server/persistence.ts` is not rewritten**. All three move
to Task 6.

The first two were deferred in pre-flight because the old `server/index.ts` imports `RoomManager`
and `GameAction` directly. The third was missed there and found by the Task 5 implementer: the
pre-flight check looked only at `index.ts`'s *direct* imports, but `server/gameManagerXState.ts` —
which `index.ts` instantiates — also imports `saveGame` and `loadAllGames`, and destructures the old
`loadAllGames()` `Map` as `[gameId, state]` tuples. The new `SavedGame[]` return type breaks it.

Consequently this task's `RoomRegistry` has **no `persist` method** and imports nothing from
`persistence.ts`. Its only caller would be `deliver` in `server/index.ts`, which Task 6 writes, so
adding it here would be untested dead code. Task 6 adds `persist` alongside the rewrite.

**Interfaces:**
- Consumes: `server/room` (`createGameRoom`, `GameRoom`, `RoomPlayer`), `server/persistence` (`saveGame`, `loadAllGames`, `initPersistence`).
- Produces: `createRoomRegistry(): RoomRegistry` with `create(hostName)`, `join(roomId, name, playerId?, token?)`, `get(roomId)`, `fromState(roomId, players, state)`, `all()`, `persist(room)`. Task 6 uses all of them; Tasks 7 and 8 use `fromState` to seat golden fixtures without a wire backdoor.

- [ ] **Step 1: Write the failing test**

Create `server/rooms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createRoomRegistry } from './rooms.js';

function fixture() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: [],
  });
}

describe('the registry', () => {
  it('creates a room with the host seated first', () => {
    const rooms = createRoomRegistry();
    const { room, player } = rooms.create('Alex');

    expect(player.id).toBe('p1');
    expect(player.isHost).toBe(true);
    expect(player.token).toEqual(expect.any(String));
    expect(rooms.get(room.id)).toBe(room);
  });

  it('seats joiners in order and issues each a distinct token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');

    const sam = rooms.join(room.id, 'Sam');
    const jordan = rooms.join(room.id, 'Jordan');

    expect(sam?.player.id).toBe('p2');
    expect(jordan?.player.id).toBe('p3');
    expect(sam!.player.token).not.toBe(jordan!.player.token);
    expect(sam!.player.isHost).toBe(false);
  });

  it('returns the existing seat when a known player rejoins with their token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');
    const first = rooms.join(room.id, 'Sam')!;

    const again = rooms.join(room.id, 'Sam', first.player.id, first.player.token);

    expect(again?.player.id).toBe('p2');
    expect(room.players).toHaveLength(2);
  });

  it('refuses a rejoin presenting the wrong token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');
    const first = rooms.join(room.id, 'Sam')!;

    expect(rooms.join(room.id, 'Sam', first.player.id, 'not-the-token')).toBeNull();
    expect(room.players).toHaveLength(2);
  });

  it('is null for a room that does not exist', () => {
    const rooms = createRoomRegistry();
    expect(rooms.get('nope')).toBeUndefined();
    expect(rooms.join('nope', 'Sam')).toBeNull();
  });

  it('seats a prepared state without going through the lobby', () => {
    const rooms = createRoomRegistry();
    const room = rooms.fromState('golden-1', ['Alex', 'Sam'], fixture());

    expect(room.lifecycle()).toBe('playing');
    expect(room.actorId()).toBe('p1');
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/rooms.test.ts`
Expected: FAIL — cannot resolve `./rooms.js`.

- [ ] **Step 3: Write the registry**

Create `server/rooms.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { GameState } from '../engine/gameTypes.js';
import { createGameRoom, type GameRoom, type RoomPlayer } from './room.js';
import { saveGame } from './persistence.js';

export interface Seat {
  room: GameRoom;
  player: RoomPlayer;
}

export interface RoomRegistry {
  create(hostName: string): Seat;
  join(roomId: string, name: string, playerId?: string, token?: string): Seat | null;
  get(roomId: string): GameRoom | undefined;
  /** Seats a prepared state directly. Tests use this; no socket event reaches it. */
  fromState(roomId: string, names: string[], state: GameState): GameRoom;
  all(): GameRoom[];
  persist(room: GameRoom): Promise<void>;
}

function seatPlayer(names: number, name: string): RoomPlayer {
  return {
    id: `p${names + 1}`,
    name,
    token: randomUUID(),
    isHost: names === 0,
    connected: true,
  };
}

/** Six characters, unambiguous: no O/0 or I/1 to read out loud incorrectly. */
function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function createRoomRegistry(): RoomRegistry {
  const rooms = new Map<string, GameRoom>();

  return {
    create(hostName) {
      const id = roomCode();
      const host = seatPlayer(0, hostName);
      const room = createGameRoom(id, [host]);
      rooms.set(id, room);
      return { room, player: host };
    },

    join(roomId, name, playerId, token) {
      const room = rooms.get(roomId);
      if (!room) return null;

      if (playerId) {
        const existing = room.players.find((p) => p.id === playerId);
        // A rejoin must prove itself. Without this, presenting someone else's
        // id would bind their seat to your socket and project their hand to
        // you — which is the whole guarantee projection exists to provide.
        if (!existing || existing.token !== token) return null;
        existing.connected = true;
        return { room, player: existing };
      }

      if (room.lifecycle() !== 'lobby') return null;
      const player = seatPlayer(room.players.length, name);
      room.players.push(player);
      return { room, player };
    },

    get: (roomId) => rooms.get(roomId),

    fromState(roomId, names, state) {
      const players = names.map((name, i) => seatPlayer(i, name));
      const room = createGameRoom(roomId, players, state);
      rooms.set(roomId, room);
      return room;
    },

    all: () => [...rooms.values()],

    async persist(room) {
      if (room.lifecycle() === 'lobby') return;
      await saveGame(room.id, room.committed());
    },
  };
}
```

- [ ] **Step 4: Rewrite persistence around committed state**

Replace `server/persistence.ts` entirely:

```ts
// server/persistence.ts
// Save and load committed game states.

import { writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { GameState } from '../engine/gameTypes.js';

const GAMES_DIR = join(process.cwd(), 'server', 'games');

/**
 * Bumped for Phase 3a: a save is now a bare committed `GameState` rather than
 * the `MultiplayerGameState` wrapper, and the wrapper's three extra fields were
 * already optional on `GameState`. A stale save refuses to load rather than
 * deserialising into a shape the room cannot drive.
 */
const SAVE_VERSION = 3;

interface SavedGame {
  roomId: string;
  version: number;
  state: GameState;
}

export async function initPersistence(): Promise<void> {
  if (!existsSync(GAMES_DIR)) {
    await mkdir(GAMES_DIR, { recursive: true });
    console.log('✓ Created games directory:', GAMES_DIR);
  }
}

/**
 * Only ever called with a room's committed state. Drafts are not written —
 * which is the segment model's "uncommitted work was never real" rule stated
 * as a storage fact rather than a behaviour to implement.
 */
export async function saveGame(roomId: string, state: GameState): Promise<void> {
  const saved: SavedGame = { roomId, version: SAVE_VERSION, state };
  try {
    await writeFile(join(GAMES_DIR, `${roomId}.json`), JSON.stringify(saved), 'utf-8');
  } catch (e) {
    console.error(`✗ Could not save room ${roomId}:`, e);
  }
}

export async function loadAllGames(): Promise<SavedGame[]> {
  if (!existsSync(GAMES_DIR)) return [];
  const files = (await readdir(GAMES_DIR)).filter((f) => f.endsWith('.json'));
  const games: SavedGame[] = [];

  for (const file of files) {
    try {
      const saved = JSON.parse(await readFile(join(GAMES_DIR, file), 'utf-8')) as SavedGame;
      if (saved.version !== SAVE_VERSION) {
        console.log(`ℹ Skipping ${file}: save version ${saved.version}, expected ${SAVE_VERSION}`);
        continue;
      }
      games.push(saved);
    } catch (e) {
      console.error(`✗ Could not load ${file}:`, e);
    }
  }

  return games;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, whole tree and whole suite — 6 new tests in `server/rooms.test.ts`. Nothing here breaks the old `server/index.ts`, which is why the two deletions were deferred to Task 6.

- [ ] **Step 6: Break it and observe the failure**

In `join`, change `if (!existing || existing.token !== token) return null;` to `if (!existing) return null;`. Run `npx vitest run server/rooms.test.ts`. Expected: "refuses a rejoin presenting the wrong token" fails. This is the guard that keeps projection meaningful — without it, presenting another player's id binds their seat to your socket. Revert and re-run to confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && npm run typecheck && npx vitest run && \
  git commit -m "feat(server): room registry and committed-state persistence"
```

---

### Task 6: The transport, and the deletions

The last place anything about sockets lives, and the only place `project` is called.

**Files:**
- Rewrite: `server/index.ts`
- Delete: `server/machines/gameRoomMachine.ts`, `server/machines/playerMachine.ts`, `server/machines/types.ts`, `server/gameManagerXState.ts`, `server/playerAuth.ts`, `server/roomManager.ts`, `server/test-client.js`, `server/test.html`, `server/engineSpike.test.ts`
- Modify: `server/types.ts` (trim), `package.json` (remove `xstate`)

**Interfaces:**
- Consumes: `server/rooms` (`createRoomRegistry`), `server/room` (`Delivery`, `GameRoom`), `server/projection` (`project`), `session/protocol` (all message types and both event maps).
- Produces: `createServer(): { app, httpServer, io, rooms }` — exported so Tasks 7 and 8 can boot it on port 0 rather than reaching for a running process.

- [ ] **Step 1: Delete what the engine already does**

```bash
git rm server/machines/gameRoomMachine.ts server/machines/playerMachine.ts \
       server/machines/types.ts server/gameManagerXState.ts \
       server/playerAuth.ts server/roomManager.ts server/test-client.js \
       server/test.html server/engineSpike.test.ts && \
  rmdir server/machines 2>/dev/null; npm uninstall xstate
```

`playerAuth.ts` goes because `applyIntent` already validates every actor, including the liquidation case its own copy got wrong. `engineSpike.test.ts` goes because its header says to: *"Delete this file when the real server-authoritative loop lands."* `roomManager.ts` is superseded by Task 5's registry; it survived until now only because the old `server/index.ts`, rewritten in the next step, still imported it.

The tree does not typecheck between this step and Step 3. That is expected and confined to this task.

- [ ] **Step 1a: Rewrite persistence, and add `persist` to the registry**

Moved here from Task 5 during execution — see that task's note. Two pieces:

First, replace `server/persistence.ts` with the version in Task 5's original text: it saves one
committed `GameState` per room under `SAVE_VERSION = 3`, exports `initPersistence`, `saveGame` and
`loadAllGames`, and never writes drafts. Deleting `gameManagerXState.ts` in the step above is what
makes this safe — it was the transitive consumer of the old `Map`-returning `loadAllGames`.

Second, add the method back to `server/rooms.ts`. On the `RoomRegistry` interface:

```ts
  persist(room: GameRoom): Promise<void>;
```

and in `createRoomRegistry`'s returned object, with `import { saveGame } from './persistence.js';`
at the top:

```ts
    async persist(room) {
      // `committed()` throws before a game begins, so the lifecycle check is
      // load-bearing rather than an optimisation. Drafts are never written:
      // uncommitted work was never real, which is the segment model stated as
      // a storage fact.
      if (room.lifecycle() === 'lobby') return;
      await saveGame(room.id, room.committed());
    },
```

- [ ] **Step 1b: Trim `server/types.ts`**

Replace it entirely. `MultiplayerGameState`, `GameAction` and `SavedGameState` all go — the first restated three fields already optional on `GameState`, the second carried the `payload: any` that `WireIntent` replaces, and the third now lives in `persistence.ts`:

```ts
// server/types.ts
// Types shared across the server's modules. The wire's types live in
// `session/protocol.ts`, because 3b's client speaks the other half of them.

export type { RoomPlayer, Lifecycle, Delivery, GameRoom } from './room.js';
export type { Seat, RoomRegistry } from './rooms.js';
```

- [ ] **Step 2: Write `server/index.ts`**

Replace the file entirely:

```ts
// server/index.ts
// Transport only. The room decides what happened; this file decides who hears
// about it, and is the single place `project` is ever called.

import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { project } from './projection.js';
import { createRoomRegistry, type RoomRegistry } from './rooms.js';
import type { Delivery, GameRoom } from './room.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CreateRoomMessage,
  type JoinRoomMessage,
  type JoinedMessage,
  type RosterMessage,
  type StateMessage,
  type StateReason,
  type UndoMessage,
  type WireIntent,
} from '../session/protocol.js';

/** Which room and seat a socket is bound to. The client never says. */
interface Binding {
  roomId: string;
  playerId: string;
}

export interface ServerHandle {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer;
  rooms: RoomRegistry;
}

export function createServer(): ServerHandle {
  const app = express();
  app.use(cors());
  app.get('/health', (_req, res) => { res.json({ ok: true }); });

  const httpServer = createHttpServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: '*' } });
  const rooms = createRoomRegistry();
  const bindings = new Map<string, Binding>();

  function socketsFor(roomId: string, playerId: string): Socket[] {
    return [...io.sockets.sockets.values()].filter((s) => {
      const b = bindings.get(s.id);
      return b?.roomId === roomId && b.playerId === playerId;
    });
  }

  /** The one send site. Everything a client ever sees is projected here. */
  function sendState(room: GameRoom, playerId: string, reason: StateReason): void {
    const source = reason === 'commit' ? room.committed() : room.draft();
    const message: StateMessage = {
      state: project(source, playerId),
      reason,
      segmentStart: room.segmentStart(),
    };
    for (const socket of socketsFor(room.id, playerId)) {
      socket.emit(SERVER_EVENTS.state, message);
    }
  }

  function roster(room: GameRoom): RosterMessage {
    return {
      roomId: room.id,
      lifecycle: room.lifecycle(),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
      })),
    };
  }

  /**
   * Turns the room's verdict into sends.
   *
   * A commit is the only thing the whole table hears. Corrections and
   * rejections go to one player, which is what keeps an open segment private:
   * there is no branch here that broadcasts a draft.
   */
  function deliver(room: GameRoom, delivery: Delivery): void {
    switch (delivery.kind) {
      case 'none':
        return;
      case 'commit':
        for (const p of room.players) sendState(room, p.id, 'commit');
        void rooms.persist(room);
        return;
      case 'correction':
        sendState(room, delivery.to, 'correction');
        return;
      case 'rejected':
        for (const socket of socketsFor(room.id, delivery.to)) {
          socket.emit(SERVER_EVENTS.rejected, { code: delivery.code, message: delivery.message });
        }
        sendState(room, delivery.to, 'reset');
        return;
    }
  }

  io.on('connection', (socket) => {
    socket.on(CLIENT_EVENTS.createRoom, (msg: CreateRoomMessage) => {
      const { room, player } = rooms.create(msg.name);
      bindings.set(socket.id, { roomId: room.id, playerId: player.id });
      void socket.join(room.id);

      const joined: JoinedMessage = { roomId: room.id, playerId: player.id, token: player.token };
      socket.emit(SERVER_EVENTS.joined, joined);
      io.to(room.id).emit(SERVER_EVENTS.roster, roster(room));
    });

    socket.on(CLIENT_EVENTS.joinRoom, (msg: JoinRoomMessage) => {
      const seat = rooms.join(msg.roomId, msg.name, msg.playerId, msg.token);
      if (!seat) {
        socket.emit(SERVER_EVENTS.rejected, {
          code: 'unknownIntent',
          message: `cannot join ${msg.roomId}`,
        });
        return;
      }

      bindings.set(socket.id, { roomId: seat.room.id, playerId: seat.player.id });
      void socket.join(seat.room.id);

      const joined: JoinedMessage = {
        roomId: seat.room.id,
        playerId: seat.player.id,
        token: seat.player.token,
      };
      socket.emit(SERVER_EVENTS.joined, joined);
      io.to(seat.room.id).emit(SERVER_EVENTS.roster, roster(seat.room));

      if (seat.room.lifecycle() !== 'lobby') sendState(seat.room, seat.player.id, 'commit');
    });

    socket.on(CLIENT_EVENTS.beginGame, () => {
      const bound = bindings.get(socket.id);
      const room = bound && rooms.get(bound.roomId);
      if (!bound || !room) return;

      const host = room.players.find((p) => p.isHost);
      if (host?.id !== bound.playerId) {
        socket.emit(SERVER_EVENTS.rejected, {
          code: 'notYourTurn',
          message: 'only the host may begin the game',
        });
        return;
      }

      const delivery = room.begin(randomSeed());
      io.to(room.id).emit(SERVER_EVENTS.roster, roster(room));
      deliver(room, delivery);
    });

    socket.on(CLIENT_EVENTS.intent, (wire: WireIntent) => {
      const bound = bindings.get(socket.id);
      const room = bound && rooms.get(bound.roomId);
      if (!bound || !room) return;
      // `bound.playerId` — never anything the client sent. The wire type has no
      // `playerId` field for it to have sent one in.
      deliver(room, room.dispatch(bound.playerId, wire));
    });

    socket.on(CLIENT_EVENTS.undo, (msg: UndoMessage) => {
      const bound = bindings.get(socket.id);
      const room = bound && rooms.get(bound.roomId);
      if (!bound || !room) return;
      deliver(room, room.undo(bound.playerId, msg.stepId));
    });

    socket.on('disconnect', () => {
      const bound = bindings.get(socket.id);
      bindings.delete(socket.id);
      if (!bound) return;

      const room = rooms.get(bound.roomId);
      if (!room) return;
      // Presence only, and deliberately thin: the game simply waits. Reconnect
      // handling is Phase 4's.
      if (socketsFor(room.id, bound.playerId).length === 0) {
        const player = room.players.find((p) => p.id === bound.playerId);
        if (player) player.connected = false;
        io.to(room.id).emit(SERVER_EVENTS.roster, roster(room));
      }
    });
  });

  return { app, httpServer, io, rooms };
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 12);
}

// Started only when run directly, so tests can boot their own on port 0.
if (process.argv[1]?.endsWith('index.ts')) {
  const { httpServer } = createServer();
  const port = Number(process.env.PORT ?? 3001);
  httpServer.listen(port, () => console.log(`✓ Server listening on ${port}`));
}
```

- [ ] **Step 3: Verify the tree typechecks and the suite is green**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. Every reference to the deleted modules is gone.

- [ ] **Step 4: Verify the server actually boots**

Run: `npm run dev:server`
Expected: `✓ Server listening on 3001` with no import errors. In a second terminal, `curl -s http://localhost:3001/health` returns `{"ok":true}`. Stop the server.

This step exists because a module graph can typecheck and still fail at runtime on an ESM specifier — and 3a has no by-hand pass to catch that later.

- [ ] **Step 5: Confirm xstate is gone**

Run: `! grep -q '"xstate"' package.json && ! grep -rl "xstate" server/ 2>/dev/null; echo $?`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add -A && npm run typecheck && npx vitest run && \
  git commit -m "feat(server): intents over the wire; delete the XState layer and playerAuth"
```

---

### Task 7: Golden games over real sockets

The acceptance test. Everything so far has been tested without a network; this proves the rules survive the wire.

**Files:**
- Create: `server/socketHarness.ts`
- Test: `server/goldenSocket.test.ts`

**Interfaces:**
- Consumes: `server/index` (`createServer`), `session/protocol` (event maps and message types), `engine/golden` (`ALL_GOLDEN_GAMES`), `engine/golden/fixtures` (`buildFixture`), `engine/golden/runner` (`assertState`).
- Produces: `startTestServer()`, `connectPlayer(port, roomId, name, playerId, token)`, `TestClient` — used by Task 8 as well.

- [ ] **Step 1: Write the harness**

Create `server/socketHarness.ts`. It is not a test file: it must not match `*.test.ts` or vitest will run it as an empty suite.

```ts
// server/socketHarness.ts
// Boots a real server on an ephemeral port and connects real socket.io
// clients to it. Nothing here is mocked: a fake transport cannot see a
// projection that is computed correctly and then broadcast unprojected,
// which is the defect this phase most needs to catch.

import { io as connect, type Socket } from 'socket.io-client';
import { createServer } from './index.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type JoinedMessage,
  type RejectedMessage,
  type StateMessage,
  type WireIntent,
} from '../session/protocol.js';

export interface TestServer {
  port: number;
  rooms: ReturnType<typeof createServer>['rooms'];
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const { httpServer, io, rooms } = createServer();

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind an ephemeral port');
  }

  return {
    port: address.port,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

export interface TestClient {
  socket: Socket;
  playerId: string;
  /** Every state message this client received, oldest first. */
  states: StateMessage[];
  /** Every rejection this client received, oldest first. */
  rejections: RejectedMessage[];
  /** The most recent state, or undefined if none has arrived. */
  latest(): StateMessage | undefined;
  send(wire: WireIntent): Promise<void>;
  undo(stepId: number): Promise<void>;
  close(): void;
}

/**
 * Joins an existing room as `playerId`.
 *
 * `token` comes from the registry rather than the wire, because these tests
 * seat golden fixtures through `rooms.fromState` — there is deliberately no
 * socket event that installs a prepared state.
 */
export async function connectPlayer(
  port: number,
  roomId: string,
  name: string,
  playerId: string,
  token: string,
): Promise<TestClient> {
  const socket = connect(`http://localhost:${port}`, { transports: ['websocket'] });
  const states: StateMessage[] = [];
  const rejections: RejectedMessage[] = [];

  socket.on(SERVER_EVENTS.state, (m: StateMessage) => states.push(m));
  socket.on(SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} never connected`)), 4000);
    socket.on('connect', () => { clearTimeout(timer); resolve(); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} never joined ${roomId}`)), 4000);
    socket.once(SERVER_EVENTS.joined, (_m: JoinedMessage) => { clearTimeout(timer); resolve(); });
    socket.emit(CLIENT_EVENTS.joinRoom, { roomId, name, playerId, token });
  });

  /**
   * Waits for the server to finish handling one message.
   *
   * The success path is deliberately silent, so there is nothing to await for
   * an accepted mid-segment intent. A round trip through an event the server
   * always answers orders our next assertion after the dispatch it follows.
   */
  const settle = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not settle')), 4000);
      socket.timeout(3000).emit('ping-settle', () => { clearTimeout(timer); resolve(); });
    });

  return {
    socket,
    playerId,
    states,
    rejections,
    latest: () => states[states.length - 1],
    async send(wire) {
      socket.emit(CLIENT_EVENTS.intent, wire);
      await settle();
    },
    async undo(stepId) {
      socket.emit(CLIENT_EVENTS.undo, { stepId });
      await settle();
    },
    close: () => { socket.disconnect(); },
  };
}
```

- [ ] **Step 2: Add the settle acknowledgement to the server**

`settle()` needs an event the server always answers. Add it inside `io.on('connection', …)` in `server/index.ts`, beside the other handlers:

```ts
    /**
     * Answers immediately, and does nothing else.
     *
     * socket.io delivers a connection's messages in order, so an acknowledged
     * round trip that arrives after an intent proves the intent was handled.
     * Tests need this because the accepted mid-segment path is deliberately
     * silent — there is no reply to await, and without an ordering point an
     * assertion runs before the server has processed anything and passes
     * vacuously.
     */
    socket.on('ping-settle', (ack: () => void) => { if (typeof ack === 'function') ack(); });
```

- [ ] **Step 3: Write the failing test**

Create `server/goldenSocket.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { assertState } from '../engine/golden/runner.js';
import { startTestServer, connectPlayer, type TestClient, type TestServer } from './socketHarness.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

describe('golden games survive the wire', () => {
  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, async () => {
      const fixture = buildFixture(game.setup);
      const names = fixture.players.map((p) => p.name);
      const room = server.rooms.fromState(`socket-${game.id}`, names, fixture);

      const clients: Record<string, TestClient> = {};
      for (const seat of room.players) {
        clients[seat.id] = await connectPlayer(
          server.port, room.id, seat.name, seat.id, seat.token,
        );
      }

      try {
        for (const step of game.steps) {
          const client = clients[step.intent.playerId];
          const { playerId, ...wire } = step.intent;
          const before = client.rejections.length;

          await client.send(wire);

          if (step.expectError) {
            expect(client.rejections.length, `${game.id} / ${step.name} — expected a rejection`)
              .toBe(before + 1);
            expect(client.rejections[before].code, `${game.id} / ${step.name}`)
              .toBe(step.expectError);
          } else {
            expect(client.rejections.length, `${game.id} / ${step.name} — unexpected rejection: ${JSON.stringify(client.rejections[before])}`)
              .toBe(before);
          }

          if (step.then) {
            assertState(room.draft(), step.then, `${game.id} / ${step.name} (over the wire)`);
          }
        }

        if (game.final) {
          assertState(room.draft(), game.final, `${game.id} final (over the wire)`);
        }
      } finally {
        for (const client of Object.values(clients)) client.close();
      }
    });
  }
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run server/goldenSocket.test.ts`
Expected: FAIL — cannot resolve `./socketHarness.js` until Step 1's file is saved; once it is, failures should be genuine assertion failures rather than timeouts. **A timeout here is a harness bug, not a server bug** — check that `ping-settle` was added in Step 2 before changing anything else.

- [ ] **Step 5: Make it pass**

Fix whatever the run reports. Expected causes, in order of likelihood: a missing `ping-settle` handler; `assertState` reading `room.committed()` when the segment is still open (it must read `room.draft()`, which is the authority's live state); a golden game whose fixture has more players than the roster seats.

Run: `npx vitest run server/goldenSocket.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 6: Prove the test can fail**

This is the step that matters most in this task, because an async socket test that never receives anything passes silently.

1. **Prove it observes rejections.** In `server/index.ts`'s `intent` handler, replace the body with `return;`. Run the file. Expected: **every** golden game fails — steps that should be accepted now produce no state change and `assertState` reports the wrong stage. If any game still passes, the harness is asserting nothing; fix it before continuing. Revert.
2. **Prove it observes state.** In `room.dispatch`, return `{ kind: 'none' }` unconditionally instead of committing. Run the file. Expected: multi-player games fail on `currentPlayer` in `assertState`. Revert.

Re-run to confirm PASS after each revert.

- [ ] **Step 7: Commit**

```bash
git add server/socketHarness.ts server/goldenSocket.test.ts server/index.ts && \
  npm run typecheck && npx vitest run && \
  git commit -m "test(server): replay all seventeen golden games over real sockets"
```

---

### Task 8: What the wire must never carry

**Files:**
- Test: `server/projectionOverWire.test.ts`

**Interfaces:**
- Consumes: `server/socketHarness` (`startTestServer`, `connectPlayer`), `engine/golden/fixtures` (`buildFixture`).

- [ ] **Step 1: Write the failing tests**

Create `server/projectionOverWire.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { startTestServer, connectPlayer, type TestServer } from './socketHarness.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

/** p1 can end their turn immediately (empty hand, no legal placement). */
function twoSeats(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: [] },
        { name: 'Sam', cash: 6000, hand: ['A1', 'B2'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    }),
  );
}

/** p1 holds a tile worth placing; p2 waits. */
function openSegment(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11'],
    }),
  );
}

describe('what a client receives', () => {
  it('carries no seed, no bag, and no hand but its own', async () => {
    const room = twoSeats('wire-projection');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);
    const p2 = await connectPlayer(server.port, room.id, sam.name, sam.id, sam.token);

    try {
      await p1.send({ type: 'endTurn' });

      const received = p2.latest();
      expect(received, 'p2 received no state at all').toBeDefined();
      expect(received!.state.seed).toBe('');
      expect(received!.state.bag).toEqual([]);
      expect(received!.state.players.find((p) => p.id === 'p2')!.hand).toEqual(['A1', 'B2']);
      expect(received!.state.players.find((p) => p.id === 'p1')!.hand).toEqual([]);

      // And the server still holds the truth it declined to send.
      expect(room.committed().bag.length).toBeGreaterThan(0);
      expect(room.committed().seed).not.toBe('');
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('an open segment is private', () => {
  it('sends the actor nothing and the table nothing while the draft advances', async () => {
    const room = openSegment('wire-draft');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);
    const p2 = await connectPlayer(server.port, room.id, sam.name, sam.id, sam.token);

    try {
      const p2Before = p2.states.length;

      await p1.send({ type: 'placeTile', coord: 'E6' });

      // The placement founds a chain: same actor, segment still open.
      expect(room.actorId()).toBe('p1');
      expect(room.draft().board['E6'].placed).toBe(true);
      expect(room.committed().board['E6']?.placed).toBeUndefined();

      expect(p2.states.length, 'p2 was shown an uncommitted draft').toBe(p2Before);
      expect(p2.states.some((m) => m.reason === 'correction')).toBe(false);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('identity is the socket, not the payload', () => {
  it('rejects an intent from the player who is not being waited on', async () => {
    const room = openSegment('wire-turn');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);
    const p2 = await connectPlayer(server.port, room.id, sam.name, sam.id, sam.token);

    try {
      await p2.send({ type: 'placeTile', coord: 'A1' });

      expect(p2.rejections).toHaveLength(1);
      expect(p2.rejections[0].code).toBe('notYourTurn');
      expect(room.draft().board['A1']?.placed).toBeUndefined();
    } finally {
      p1.close();
      p2.close();
    }
  });

  it('ignores a playerId smuggled into the payload', async () => {
    const room = openSegment('wire-spoof');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);
    const p2 = await connectPlayer(server.port, room.id, sam.name, sam.id, sam.token);

    try {
      // The wire type has no `playerId`, so this does not typecheck as a
      // `WireIntent` — which is the point. A hostile client is not bound by
      // our types, so the server must ignore the field rather than trust it.
      p2.socket.emit('intent', { type: 'placeTile', coord: 'E6', playerId: 'p1' });
      await p2.send({ type: 'endTurn' });

      expect(room.draft().board['E6']?.placed).toBeUndefined();
      expect(p2.rejections.map((r) => r.code)).toEqual(['notYourTurn', 'notYourTurn']);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('undo over the wire', () => {
  it('lets the actor rewind its own open segment', async () => {
    const room = openSegment('wire-undo');
    const [alex] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);

    try {
      const opened = room.segmentStart();
      await p1.send({ type: 'placeTile', coord: 'E6' });
      expect(room.draft().board['E6'].placed).toBe(true);

      await p1.undo(opened);

      expect(room.draft().board['E6']?.placed).toBeUndefined();
      expect(p1.latest()!.reason).toBe('correction');
    } finally {
      p1.close();
    }
  });

  it('refuses an undo from a player who is not the actor', async () => {
    const room = openSegment('wire-undo-foreign');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);
    const p2 = await connectPlayer(server.port, room.id, sam.name, sam.id, sam.token);

    try {
      const opened = room.segmentStart();
      await p1.send({ type: 'placeTile', coord: 'E6' });

      await p2.undo(opened);

      expect(p2.rejections.map((r) => r.code)).toContain('notYourTurn');
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
      p2.close();
    }
  });

  it('refuses a step below the open segment', async () => {
    const room = openSegment('wire-undo-old');
    const [alex] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex.name, alex.id, alex.token);

    try {
      await p1.send({ type: 'placeTile', coord: 'E6' });
      await p1.undo(0);

      expect(p1.rejections.map((r) => r.code)).toContain('undoOutOfSegment');
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `npx vitest run server/projectionOverWire.test.ts`
Expected on first run: whatever genuinely fails. Fix only real defects — do not weaken an assertion to make it pass. Then: PASS, 8 tests.

- [ ] **Step 3: Prove each guarantee can fail**

Four breaks, one at a time, reverting between.

1. **Projection.** In `server/index.ts`'s `sendState`, change `state: project(source, playerId)` to `state: source`. Expected: "carries no seed, no bag, and no hand but its own" fails on `seed`. **This is the single most important break in the plan** — it is the defect the whole phase is built to prevent, and a test suite that stays green here is worthless.
2. **Draft privacy.** In `deliver`, change the `correction` case to broadcast: `for (const p of room.players) sendState(room, p.id, 'correction');`. Expected: "sends the actor nothing and the table nothing while the draft advances" fails.
3. **Binding.** In the `intent` handler, change `room.dispatch(bound.playerId, wire)` to read a `playerId` off the payload: `room.dispatch((wire as { playerId?: string }).playerId ?? bound.playerId, wire)`. Expected: "ignores a playerId smuggled into the payload" fails, with `E6` placed by a socket bound to p2. Revert — and note that this break required *adding* a cast, which is itself the argument for the wire type having no such field.
4. **Undo scoping.** In `room.undo`, drop the `undoableSteps` guard. Expected: "refuses a step below the open segment" fails.

Re-run to confirm PASS after each revert.

- [ ] **Step 4: Commit**

```bash
git add server/projectionOverWire.test.ts && \
  npm run typecheck && npx vitest run && \
  git commit -m "test(server): projection, draft privacy, binding and undo, asserted on the wire"
```

---

### Task 9: Close the phase

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-react-app-revamp-roadmap-design.md` (Phase 3 is now 3a/3b)
- Create: `docs/superpowers/specs/2026-08-05-phase-3a-carry-forward.md`

- [ ] **Step 1: Run every gate**

```bash
npx vitest run && npm run typecheck && npx vite build && \
  npm run check:bundle && npm run verify:layout
```

Expected: all five green. `verify:layout` exercises pass-and-play, which this phase touched only through the `session/` move — if it fails, the move broke an import that jsdom did not catch, which is precisely why the gate exists.

- [ ] **Step 2: Confirm nothing server-side reached the browser bundle**

```bash
npx vite build && ! grep -rlE "socket\.io|express" dist/assets 2>/dev/null; echo $?
```

Expected: `0`. `session/` is imported by both sides, so a stray `server/` import inside it would ship socket.io to every visitor. Nothing checks this today.

- [ ] **Step 3: Record the phase's numbers**

```bash
npx vitest run 2>&1 | tail -20
git diff --stat main...HEAD | tail -5
```

Note the test and file counts; the carry-forward states measured figures, never estimates.

- [ ] **Step 4: Split Phase 3 in the roadmap**

In `docs/superpowers/specs/2026-07-31-react-app-revamp-roadmap-design.md`, retitle `### Phase 3 — Server authority` to `### Phase 3 — Server authority (split into 3a and 3b)` and add, immediately below the heading:

```markdown
> **Split during planning, 2026-08-05.** 3a is the server — intents over the
> wire, projection, validation, the XState layer deleted — proven headlessly.
> 3b is the client: the networked session, `/room/:roomId` on `GameScreen`, and
> the deletion of `Game.tsx` and its six modals. See
> [2026-08-05-phase-3a-server-authority-design.md](./2026-08-05-phase-3a-server-authority-design.md).
>
> Two claims in that section proved wrong when executed. The client cannot
> usefully predict *every* intent — three of nine draw from the bag — and the
> `gameRoomMachine` rewrite was dropped rather than done, because the engine's
> `stage` and `getCurrentActor` already are the model this section wanted.
```

- [ ] **Step 5: Write the carry-forward**

Create `docs/superpowers/specs/2026-08-05-phase-3a-carry-forward.md`, following the structure of `2026-08-04-phase-2b-carry-forward.md`: what shipped (with measured numbers), what is still broken, deviations from the plan and why each was right, what 3b inherits, carried findings, and process lessons.

It must state at minimum:

- **3a has no by-hand verification.** Say so plainly, and name it as the phase's largest gap.
- **The online path is entirely dead.** `/room/:roomId`, `CreateRoomPage` and `JoinRoomPage` speak a protocol that no longer exists. 3b is what makes online work again.
- **The measured facts this phase established:** projection equivalence holds across 42 predictable steps in 17 golden games; a payout precedes its commit by at most 2 intents; bonus recipients are *not* a subset of the shareholder queue, contrary to the design's first draft.
- **What 3b inherits:** `WireIntent` and the message shapes in `session/protocol.ts`; `GameSession` as the client's local draft; the fact that the six non-drawing intents may be applied optimistically and the three drawing ones may not; and that `awaitingReveal` is pass-and-play-only and has no meaning online.
- **Still carried from 2a/2b:** the draw screen, `LiqQueue` having no design review, seat names truncating at 768px, `Board.tsx` rendering hand tiles as buttons with no handler, and the catalog building every fixture at module load.

- [ ] **Step 6: Commit**

```bash
git add -A && npx vitest run && npm run typecheck && npx vite build && \
  npm run check:bundle && npm run verify:layout && \
  git commit -m "docs: Phase 3a carry-forward, and split Phase 3 in the roadmap"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the room and intent lifecycle (4), projection (1, 8), the merger/segment analysis (4, tests 6 and 8), the wire protocol (3), identity (5, 6, 8), structure and deletions (2, 5, 6), persistence (5), all eight test assertions (1, 4, 7, 8), scope and cutover (6, 9), risks (9's carry-forward). The design's "no client" constraint is honoured throughout — no task touches `src/` except Task 2's mechanical import updates.

**Assertions, mapped.** 1 → Task 7. 2 → Task 1 (pure) and Task 8 (on the wire). 3 → Task 8. 4 → Task 8. 5 → Task 1. 6 → Task 4. 7 → Tasks 4 and 8. 8 → Task 4.

**Type consistency.** `project(state, forPlayerId)` is used with that signature in Tasks 1, 6 and 8. `Delivery`'s four variants are constructed in Task 4 and exhaustively consumed by `deliver` in Task 6. `RoomPlayer` carries `token` from Task 4 onward and is built by `seatPlayer` in Task 5 and read by the harness in Task 7. `StateMessage.reason` is written in Task 6 and asserted in Task 8. `segmentStart` is added in Task 2 and read in Tasks 4, 6 and 8. `RejectionCode` is defined in Task 3 and is the type of `Delivery.code` in Task 4.

**Known soft spots**, flagged rather than hidden:

- **Task 7's `settle()` is the plan's most likely failure point.** The accepted mid-segment path is silent by design, so the tests need an ordering primitive that does not exist in the protocol. `ping-settle` is that primitive; if it misbehaves, Task 7 fails with timeouts rather than assertion failures, and Step 4 says so explicitly.
- **`assertState` reads `room.draft()`, not `committed()`.** The draft is the authority's live state; the committed one lags by design. A reviewer should check this is deliberate — it is.
- **One sanctioned cast**, `as Intent` in `withPlayer`. It is not `as any` and is confined to one documented line.
