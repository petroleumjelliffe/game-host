# Phase 3b — Networked Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two browsers play a full game of Acquire against the Phase 3a server through the Phase 1b component layer, and the legacy modal UI is deleted.

**Architecture:** `GameScreen` already takes a `GameSession` and speaks to it through `dispatch`/`undoTo`/`reveal`. The networked client is therefore a *second implementation of that interface* — `NetworkSession` — which applies the six predictable intents locally at once, waits for the server on the three that draw from the bag, and adopts server state wholesale. Around it sit a socket transport, a per-room identity store, a room hook, and four screens.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), React 18, react-router-dom, socket.io-client 4, vitest 4 (two projects: `node` for `engine|session|server`, `app`/jsdom for `src`), Tailwind classes inline.

**Spec:** [../specs/2026-08-05-phase-3b-networked-client-design.md](../specs/2026-08-05-phase-3b-networked-client-design.md)
**Predecessor:** [../specs/2026-08-05-phase-3a-carry-forward.md](../specs/2026-08-05-phase-3a-carry-forward.md)

## Global Constraints

- **Worktree:** all work happens in `~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b`, branch `revamp/phase-3b-networked-client`. **Every git command carries an explicit `-C <path>`.** Phase 3a rewrote a commit on the wrong branch because the shell's working directory silently reset between calls; it reset again while this plan was being written.
- **No `as any`.** Narrow with the engine's type guards (`isStartupId`, …). The one sanctioned cast in this phase is `toWire` in `session/protocol.ts` (Task 1), mirroring `server/room.ts`'s existing `withPlayer`.
- **`engine/` is untouched.** No rules change is expected. One proving necessary is a finding to write down, not a routine step. `prototype/` is untouched.
- **Never import `engine/golden/runner` from `src/`** — it pulls vitest into the bundle. `src/` tests use `replayGoldenGame` from `engine/golden/replay`. A test under `server/` may import the runner; `server/goldenSocket.test.ts` already does.
- **Test project placement:** a test file under `session/` or `server/` runs in the `node` project (no DOM globals); a test under `src/` runs in the `app` project (jsdom + `src/test/setup.ts`). Put each new test where its subject lives.
- **Import style follows the neighbouring file:** `server/` and `session/` write explicit `.js` extensions; `src/` writes extensionless. Copy the file next door rather than guessing.
- **Derive from the engine, never hardcode.** Every price, total and board position comes from replayed state.
- **Every new test is observed failing before it is trusted.** Each task below names the break to apply and what you should see.
- **Absence assertions run at least eight times.** Any assertion of the form "the other client never received X" must be broken, re-run **≥ 8 times**, and the failure count reported in the task's report. A break that fails 2 of 10 runs is a coin toss, not a check. This is the rule Phase 3a adopted after a privacy check that fired 0 times in 8 runs while looking exactly like coverage.
- **Commands:** `npx vitest run` (full suite), `npm run typecheck` (**never** bare `tsc`), `npx vite build`, `npm run check:bundle`, `npm run verify:layout`. Two-process dev: `npm run dev:all`.
- **jsdom reports zero for all layout.** A structural test can pass over a visibly broken page. Anything about size, fit or overflow is settled in a real browser.

---

## File Structure

| File | Responsibility |
|---|---|
| `session/protocol.ts` *(modify)* | Gains `DRAWS` (the one definition) and `toWire`. |
| `session/GameSession.ts` *(modify)* | `SessionView.pending`; `SessionError.code` widened to `RejectionCode`. |
| `src/net/transport.ts` *(new)* | `RoomTransport` — the four calls a session may make — and the socket.io adapter. |
| `src/net/NetworkSession.ts` *(new)* | `GameSession` over the wire. The seam. |
| `src/net/identity.ts` *(new)* | Per-room `{playerId, token, name}` in localStorage, plus a remembered display name. |
| `src/net/connection.ts` *(new)* | The single lazy socket: lobby calls, status, and the transport. |
| `src/net/useRoom.ts` *(new)* | connect → join → lobby → playing, and the session it builds. |
| `src/game/online/RoomLobby.tsx` *(new)* | Room code, roster, host-only start. |
| `src/game/online/ConnectionStrip.tsx` *(new)* | Connection state, scoped to the room screen. |
| `src/game/online/JoinForm.tsx` *(new)* | Name (+ optional code) entry, shared by the join page and the room page. |
| `src/game/GameScreen.tsx` *(modify)* | `viewerId` prop; curtain and viewer selection follow from it. |
| `src/game/screen/useTurnPanel.tsx` *(modify)* | `canAct` argument; `stageLabel` as the one source of stage copy. |
| `src/pages/RoomPage.tsx` *(rewrite)* | Lobby until the server says playing, then `GameScreen`. |
| `src/pages/CreateRoomPage.tsx`, `JoinRoomPage.tsx`, `OnlineLobbyPage.tsx` *(rewrite)* | Entry flow against the new protocol. |
| `src/App.tsx`, `src/main.tsx` *(modify)* | Routes keep their paths; the app-wide socket provider and banner go. |
| `server/clientOverWire.test.ts` *(new)* | Two `NetworkSession`s over real socket.io, the golden corpus. The centrepiece. |
| **Deleted** | `src/Game.tsx`, all of `src/components/`, `src/context/`, `src/utils/gameSession.ts`, `src/utils/playerId.ts`, `src/App.test.tsx`. |

---

## Task 1: One definition of the bag-drawing intents

The three intent types that draw from the bag exist as two hand-maintained copies that must agree. The client needs the same set, which would make three. The Phase 3a carry-forward named this as the place it would break silently: a new bag-drawing intent added to one copy stops producing its `correction`, narrows the equivalence proof, and mispredicts on the client — with no test failing to say so.

**Files:**
- Modify: `session/protocol.ts`
- Modify: `server/room.ts:46-54` (the local `DRAWS` and its comment), `server/room.ts:129` (the use site)
- Modify: `server/projection.test.ts:64` (the second local `DRAWS`)
- Test: `session/protocol.test.ts` (append)

**Interfaces:**
- Consumes: `WireIntent`, `Intent` — both already in scope in `session/protocol.ts`.
- Produces: `export const DRAWS: Set<WireIntent['type']>` and `export function toWire(intent: Intent): WireIntent`, both from `session/protocol.ts`. Tasks 3 and 7 import both.

- [ ] **Step 1: Write the failing test**

Append to `session/protocol.test.ts` (add `DRAWS` and `toWire` to the existing import from `./protocol.js`):

```ts
describe('DRAWS is the one definition of which intents draw from the bag', () => {
  it('names exactly the three whose result a projected client cannot compute', () => {
    expect([...DRAWS].sort()).toEqual(['endTurn', 'startGame', 'tradeInDeadTiles']);
  });

  it('holds only real intent types', () => {
    // `Set<WireIntent['type']>` is checked at compile time; this is the
    // runtime half — a typo in a string literal is otherwise invisible.
    const types = new Set(ALL_GOLDEN_GAMES.flatMap((g) => g.steps.map((s) => s.intent.type)));
    for (const draw of DRAWS) expect(types.has(draw)).toBe(true);
  });
});

describe('toWire strips identity without collapsing the union', () => {
  it('drops playerId and keeps the variant fields', () => {
    expect(toWire({ type: 'placeTile', playerId: 'p1', coord: 'E6' }))
      .toEqual({ type: 'placeTile', coord: 'E6' });
    expect(toWire({ type: 'buyShares', playerId: 'p2', picks: ['messla'] }))
      .toEqual({ type: 'buyShares', picks: ['messla'] });
  });

  it('produces something the server will accept as a wire intent', () => {
    expect(isWireIntent(toWire({ type: 'placeTile', playerId: 'p1', coord: 'E6' }))).toBe(true);
  });
});
```

`ALL_GOLDEN_GAMES` comes from `../engine/golden/index.js`. Check whether `session/protocol.test.ts` already imports it and `isWireIntent`; add only what is missing.

Note on the second test: it asserts the three strings name intents the corpus actually plays, which is what catches `'endTurm'`. It deliberately does not assert the reverse (that no other type draws) — the corpus cannot know that, and the compile-time type is what constrains membership.

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project node session/protocol.test.ts
```

Expected: failure at import — `DRAWS` and `toWire` are not exported.

- [ ] **Step 3: Add both to `session/protocol.ts`**

Place after the `isWireIntent` definition:

```ts
/**
 * The intent types that draw from the bag, and therefore the only ones whose
 * result a projected client cannot compute for itself.
 *
 * One definition, three consumers: `server/room.ts` decides which accepted
 * mid-segment intents still owe their author a `correction`;
 * `server/projection.test.ts` decides which steps the projection-equivalence
 * proof must skip; and `src/net/NetworkSession.ts` decides which intents it
 * may apply optimistically. Phase 3a shipped the first two as independent
 * copies and its carry-forward flagged the third as the moment that breaks:
 * a new bag-drawing intent added to only one of them would stop producing
 * its correction, silently narrow the equivalence proof to cover less than
 * it claims, and mispredict on the client — with no test failing either way.
 */
export const DRAWS = new Set<WireIntent['type']>(['endTurn', 'tradeInDeadTiles', 'startGame']);

/**
 * Strips identity for the wire — the exact inverse of `server/room.ts`'s
 * `withPlayer`.
 *
 * Same cast, same reason: spreading a discriminated union produces a type
 * TypeScript will not narrow back to that union, even though every `Intent`
 * minus its `playerId` is by construction a `WireIntent`. Confined to this
 * one line so no caller ever needs one.
 */
export function toWire(intent: Intent): WireIntent {
  const { playerId: _identity, ...wire } = intent;
  return wire as WireIntent;
}
```

- [ ] **Step 4: Point both servers copies at it**

In `server/room.ts`, delete the local `const DRAWS = …` and the doc comment above it, add `DRAWS` to the existing import from `../session/protocol.js`, and leave the use site (`return DRAWS.has(wire.type) ? …`) with a one-line comment:

```ts
      // The draft advanced and stayed with its author. They computed the same
      // result locally, unless it drew from a bag they do not hold — see
      // `DRAWS` in `session/protocol.ts`.
      return DRAWS.has(wire.type) ? { kind: 'correction', to: playerId } : { kind: 'none' };
```

In `server/projection.test.ts`, delete the local `const DRAWS = …` at line 64 and import it from `../session/protocol.js` instead.

- [ ] **Step 5: Run the node suite**

```
npx vitest run --project node
```

Expected: PASS, with the same test count as before plus the four new cases. `server/projection.test.ts`'s equivalence proof must still report its ≥ 40 predictable steps — if that floor now fails, the import is wrong, not the floor.

- [ ] **Step 6: Typecheck and commit**

```
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add session/protocol.ts session/protocol.test.ts server/room.ts server/projection.test.ts
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "refactor(session): one definition of the bag-drawing intents, plus toWire"
```

---

## Task 2: The screen learns who is looking at it

`GameScreen` currently equates "the viewer" with "the actor", which is right when one device is passed around and wrong the moment each player has their own. This task makes the viewer explicit and makes the panel inert when it is not your turn. It touches no networking and can be reviewed on its own.

**Files:**
- Modify: `session/GameSession.ts` (`SessionError`, `SessionView`)
- Modify: `src/game/screen/useTurnPanel.tsx`
- Modify: `src/game/GameScreen.tsx`
- Test: `src/game/GameScreen.test.tsx` (append a describe block)

**Interfaces:**
- Consumes: `RejectionCode` from `session/protocol.ts` (already exported).
- Produces: `GameScreenProps.viewerId?: string`; `useTurnPanel(view, dispatch, canAct?)`; `SessionView.pending?: boolean`. Task 5 passes `viewerId`; Task 3 sets `pending`.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/GameScreen.test.tsx`. Add `import type { GameSession, SessionView } from '../../session/GameSession';` to the existing imports.

```ts
/**
 * A session whose view is fixed. Used only to put the screen into states a
 * local `GameSession` cannot produce — `pending` is set by the networked
 * session, which does not exist in this test's world.
 */
function frozen(view: SessionView): GameSession {
  return {
    getView: () => view,
    subscribe: () => () => {},
    dispatch: () => {},
    undoTo: () => {},
    reveal: () => {},
  };
}

describe('GameScreen with a viewer who is not the actor', () => {
  // `playable()` seats Alex (p1, holding E6 and H8) and Sam (p2, holding A1),
  // with the turn on Alex. Sam is therefore the viewer who must wait.
  function watching() {
    return <GameScreen session={createGameSession({ state: playable() })} viewerId="p2" />;
  }

  it('raises no curtain — there is no device to pass', () => {
    render(watching());
    expect(screen.queryByText(/pass to/i)).toBeNull();
    expect(screen.queryByTestId('curtain')).toBeNull();
  });

  it('shows me my own hand while someone else acts', () => {
    render(watching());
    expect(screen.getByTitle('A1')).toBeInTheDocument();
    expect(screen.queryByTitle('E6')).toBeNull();
    expect(screen.queryByTitle('H8')).toBeNull();
  });

  it('names who we are waiting for and offers nothing', () => {
    render(watching());
    expect(screen.getByText(/waiting for alex/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });

  it('ignores a click on my own tile when it is not my turn', () => {
    render(watching());
    fireEvent.click(screen.getByTitle('A1'));
    // Still waiting, and A1 is still mine to play later.
    expect(screen.getByText(/waiting for alex/i)).toBeInTheDocument();
    expect(screen.getByTitle('A1')).toBeInTheDocument();
  });

  it('keeps all five panel slots, so waiting does not resize the panel', () => {
    const { container } = render(watching());
    const slots = [...container.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual(['stepstack', 'active', 'staging', 'hand', 'players']);
  });

  it('goes inert while a bag-drawing intent is in flight', () => {
    const session = createGameSession({ state: playable() });
    session.reveal();
    const view = { ...session.getView(), pending: true };
    render(<GameScreen session={frozen(view)} viewerId="p1" />);

    // p1 *is* the actor, but the answer has to come from the server.
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```
npx vitest run --project app src/game/GameScreen.test.tsx
```

Expected: the first five fail (`viewerId` is not a prop, so the curtain still renders and Alex's tiles are on the board); the sixth fails to typecheck on `pending`.

- [ ] **Step 3: Widen `SessionError` and add `pending`**

In `session/GameSession.ts`:

```ts
import type { RejectionCode } from './protocol';

export interface SessionError {
  /**
   * Every refusal a session can surface. Wider than `IllegalIntentCode`
   * because undo is not an intent: the server can refuse one with
   * `undoOutOfSegment`, which the engine has no word for.
   */
  code: RejectionCode;
  message: string;
}
```

`session/protocol.ts` imports nothing from `GameSession.ts`, so this adds no cycle.

Add to `SessionView`, after `segmentStart`:

```ts
  /**
   * A bag-drawing intent is in flight and only the server can answer it.
   * Pass-and-play never sets this: it holds the bag.
   */
  pending?: boolean;
```

- [ ] **Step 4: Give `useTurnPanel` a `canAct` argument and one source of stage copy**

At the top of `src/game/screen/useTurnPanel.tsx`, above `useTurnPanel`:

```ts
/**
 * The label for the step a stage is asking for.
 *
 * One map rather than one string per branch, because the waiting panel shows
 * the same label the actor sees — a second copy would drift the moment a
 * label is reworded.
 */
function stageLabel(stage: GameState['stage']): string {
  switch (stage) {
    case 'draw': return 'Open the game';
    case 'foundStartup': return 'Found a brand';
    case 'chooseSurvivor': return 'Which chain survives?';
    case 'mergerLiquidation': return 'Liquidate shares';
    case 'buy': return 'Buy shares';
    default: return 'Place a tile';
  }
}
```

Change the signature and insert the waiting branch **after** the existing `useState`/`useEffect` calls and the `problem`/`idleStaging` bindings, and **before** the `state.stage === 'draw'` branch — hooks must run unconditionally on every render:

```ts
export function useTurnPanel(
  view: SessionView,
  dispatch: (intent: Intent) => void,
  canAct: boolean = true,
): TurnPanelSlots {
  const { state, actorId, error, pending } = view;
  …
  if (!canAct) {
    const waitingFor = state.players.find((p) => p.id === actorId)?.name;
    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label={stageLabel(state.stage)}
          body={
            <span className="text-[13px] text-gray-600">
              {pending ? 'Sending…' : `Waiting for ${waitingFor ?? 'the next player'}.`}
            </span>
          }
        />
      ),
    };
  }
```

Then replace the four hardcoded labels with `stageLabel(state.stage)`:
`label="Open the game"`, `label="Place a tile"`, `label="Found a brand"`, `label="Which chain survives?"`, `label="Buy shares"`, and `label="Liquidate your shares"` → `label={stageLabel(state.stage)}`. The liquidation label changes wording from "Liquidate your shares" to "Liquidate shares"; grep `src/` for the old string and update any test that asserts it (at the time of writing there is exactly one occurrence, in the component itself).

- [ ] **Step 5: Teach `GameScreen` who is looking**

In `src/game/GameScreen.tsx`, add to `GameScreenProps`:

```ts
  /**
   * The player at this device. Absent in pass-and-play, where one device is
   * shared and the viewer is therefore whoever is acting; present online,
   * where the viewer never changes and the curtain has nothing to protect.
   */
  viewerId?: string;
```

Replace the top of the component body:

```ts
export function GameScreen({ session, viewerId, onNewGame, onExit }: GameScreenProps) {
  const view = useGameSession(session);
  const { state, actorId, awaitingReveal, undoableSteps, pending } = view;

  // Inert while someone else is acting, and while an answer only the server
  // can give is in flight — otherwise the buy panel stays live after "End
  // turn" and the next click is a rejection waiting to happen.
  const canAct = (viewerId === undefined || viewerId === actorId) && !pending;
  const { active, staging } = useTurnPanel(view, (intent) => session.dispatch(intent), canAct);

  const actor = state.players.find((p) => p.id === actorId);

  /**
   * Whose private state the screen shows — their tiles on the board, their
   * shares in the hand zone.
   *
   * Online that is always me: my own device, my own hand, at every stage
   * including the turn-order draw. Pass-and-play keeps its own rule, which is
   * the actor at every stage but the draw: seat one presses that button for
   * the table rather than taking a turn, and showing their hand put six of
   * their tiles on a shared board before play began.
   */
  const viewer = viewerId === undefined
    ? (state.stage === 'draw' ? undefined : actor)
    : state.players.find((p) => p.id === viewerId);

  /** Nobody is "up" until the draw has decided who is. */
  const turnKnown = state.stage !== 'draw';
```

Change the board's click handler and the curtain and the players strip:

```tsx
          onCellClick={
            canAct && actorId
              ? (coord) => session.dispatch({ type: 'placeTile', playerId: actorId, coord })
              : undefined
          }
```

```tsx
              active: turnKnown && p.id === actorId,
```

```tsx
      {viewerId === undefined && awaitingReveal && actor && (
```

`turnKnown` replaces the old `viewer !== undefined` test in the players strip. In pass-and-play the two are identical — `viewer` was undefined exactly at the draw — but online `viewer` is always defined, and without the change every seat would light up as active during the draw.

- [ ] **Step 6: Run the app suite**

```
npx vitest run --project app
```

Expected: PASS, including every pre-existing `GameScreen`, `PassAndPlayPage` and `useTurnPanel` test. Those are the check that pass-and-play is unchanged; if any of them fails, the default-argument path is wrong, not the test.

- [ ] **Step 7: Break it once, to prove the tests bite**

Change `canAct` to a literal `true` and re-run. Expected: "names who we are waiting for", "ignores a click", and "goes inert" fail. Restore.

- [ ] **Step 8: Typecheck and commit**

```
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add session/GameSession.ts src/game/GameScreen.tsx src/game/GameScreen.test.tsx src/game/screen/useTurnPanel.tsx
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "feat(game): the screen learns who is looking at it"
```

---

## Task 3: `NetworkSession` — the seam

The whole phase turns on this file. It implements the existing `GameSession` interface over a socket, so `GameScreen` cannot tell the two apart.

**Files:**
- Create: `src/net/transport.ts`
- Create: `src/net/NetworkSession.ts`
- Test: `src/net/NetworkSession.test.ts`

**Interfaces:**
- Consumes: `DRAWS`, `toWire`, `StateMessage`, `RejectedMessage`, `WireIntent` from `session/protocol`; `createGameSession`, `GameSession`, `SessionView`, `SessionError` from `session/GameSession`.
- Produces:
  - `interface RoomTransport { sendIntent(w: WireIntent): void; sendUndo(stepId: number): void; onState(h: (m: StateMessage) => void): () => void; onRejected(h: (m: RejectedMessage) => void): () => void; isOpen(): boolean }`
  - `function createSocketTransport(socket: Socket): RoomTransport`
  - `interface NetworkSession extends GameSession { dispose(): void }`
  - `function createNetworkSession(init: { transport: RoomTransport; playerId: string; initial: StateMessage }): NetworkSession`

  Task 4 builds a `RoomTransport` from the real socket; Task 5 constructs the session; Task 7 drives it over real sockets.

- [ ] **Step 1: Write `src/net/transport.ts`**

No test of its own: an interface has no behaviour, and the socket adapter is exercised over a real socket by Task 7. Say so in the file rather than writing a test that asserts a stub was called.

```ts
import type { Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type RejectedMessage,
  type StateMessage,
  type UndoMessage,
  type WireIntent,
} from '../../session/protocol';

/**
 * Everything a session may do to the network, and nothing else.
 *
 * Deliberately narrower than a socket: a session cannot create a room, join
 * one, read the roster, or reconnect. Those belong to `connection.ts`, which
 * is what keeps "the game" and "the lobby" from growing into each other.
 */
export interface RoomTransport {
  sendIntent(wire: WireIntent): void;
  sendUndo(stepId: number): void;
  /** Returns an unsubscribe. */
  onState(handler: (msg: StateMessage) => void): () => void;
  /** Returns an unsubscribe. */
  onRejected(handler: (msg: RejectedMessage) => void): () => void;
  /** False while the socket is down, so intents are refused rather than dropped. */
  isOpen(): boolean;
}

/**
 * The real one. Untested in isolation on purpose — a stub socket asserting
 * "emit was called" proves only that this file calls the function it plainly
 * calls. `server/clientOverWire.test.ts` drives this adapter over a real
 * socket.io connection against the real server, which is where a wrong event
 * name or payload shape actually shows up.
 */
export function createSocketTransport(socket: Socket): RoomTransport {
  return {
    sendIntent: (wire) => { socket.emit(CLIENT_EVENTS.intent, wire); },
    sendUndo: (stepId) => {
      const msg: UndoMessage = { stepId };
      socket.emit(CLIENT_EVENTS.undo, msg);
    },
    onState(handler) {
      socket.on(SERVER_EVENTS.state, handler);
      return () => { socket.off(SERVER_EVENTS.state, handler); };
    },
    onRejected(handler) {
      socket.on(SERVER_EVENTS.rejected, handler);
      return () => { socket.off(SERVER_EVENTS.rejected, handler); };
    },
    isOpen: () => socket.connected,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/net/NetworkSession.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createNetworkSession } from './NetworkSession';
import type { RoomTransport } from './transport';
import { buildFixture } from '../../engine/golden/fixtures';
import type { GameState } from '../../engine/gameTypes';
import type { RejectedMessage, StateMessage } from '../../session/protocol';

/** p1 holds E6 next to a loner, so founding is one click away. p2 waits. */
function board(): GameState {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

function harness(state = board()) {
  const sent: unknown[] = [];
  const undos: number[] = [];
  let onState: ((m: StateMessage) => void) | null = null;
  let onRejected: ((m: RejectedMessage) => void) | null = null;
  let open = true;

  const transport: RoomTransport = {
    sendIntent: (w) => { sent.push(w); },
    sendUndo: (id) => { undos.push(id); },
    onState: (h) => { onState = h; return () => { onState = null; }; },
    onRejected: (h) => { onRejected = h; return () => { onRejected = null; }; },
    isOpen: () => open,
  };

  return {
    sent,
    undos,
    setOpen: (v: boolean) => { open = v; },
    serverSays: (m: StateMessage) => onState?.(m),
    serverRefuses: (m: RejectedMessage) => onRejected?.(m),
    session: (playerId = 'p1') => createNetworkSession({
      transport,
      playerId,
      initial: { state, reason: 'commit', segmentStart: state.nextStepId },
    }),
  };
}

describe('a predictable intent moves the screen before the server answers', () => {
  it('applies locally and sends', () => {
    const h = harness();
    const session = h.session();

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(session.getView().state.board['E6'].placed).toBe(true);
    expect(h.sent).toEqual([{ type: 'placeTile', coord: 'E6' }]);
    expect(session.getView().error).toBeNull();
  });
});

describe('a bag-drawing intent waits for the server', () => {
  it('changes nothing locally, and marks itself pending', () => {
    const h = harness();
    const session = h.session();
    const before = session.getView().state;

    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    expect(session.getView().state).toBe(before);
    expect(session.getView().pending).toBe(true);
    expect(h.sent).toEqual([{ type: 'endTurn' }]);
  });

  it('moves only when the server says so, and stops being pending', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    const next = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5', 'H8'],
      bag: ['I11'],
    });
    h.serverSays({ state: next, reason: 'commit', segmentStart: next.nextStepId });

    expect(session.getView().state.board['H8'].placed).toBe(true);
    expect(session.getView().pending).toBe(false);
  });

  it('refuses a second intent while one is in flight', () => {
    const h = harness();
    const session = h.session();

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(h.sent).toEqual([{ type: 'endTurn' }]);
    expect(session.getView().state.board['E6'].placed).toBe(false);
  });
});

describe('an intent the local state refuses never reaches the wire', () => {
  it('reports the engine reason and sends nothing', () => {
    const h = harness();
    const session = h.session('p2');

    // p2 holds A1, but it is not p2's turn.
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });

    expect(h.sent).toEqual([]);
    expect(session.getView().error?.code).toBe('notYourTurn');
    expect(session.getView().state.board['A1'].placed).toBe(false);
  });

  it('refuses to send at all while the socket is down', () => {
    const h = harness();
    const session = h.session();
    h.setOpen(false);

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(h.sent).toEqual([]);
    expect(session.getView().error?.message).toMatch(/connect/i);
    expect(session.getView().state.board['E6'].placed).toBe(false);
  });
});

describe('a rejection survives the reset that follows it', () => {
  it('keeps the message while adopting the server state', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    h.serverRefuses({ code: 'wrongStage', message: 'not now' });
    h.serverSays({ state: board(), reason: 'reset', segmentStart: board().nextStepId });

    expect(session.getView().state.board['E6'].placed).toBe(false);
    expect(session.getView().error).toEqual({ code: 'wrongStage', message: 'not now' });
  });

  it('clears the message on the next commit', () => {
    const h = harness();
    const session = h.session();
    h.serverRefuses({ code: 'wrongStage', message: 'not now' });

    h.serverSays({ state: board(), reason: 'commit', segmentStart: board().nextStepId });

    expect(session.getView().error).toBeNull();
  });
});

describe('undo is the servers to grant', () => {
  it('sends the step and changes nothing locally', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    session.undoTo(session.getView().undoableSteps[0]);

    expect(h.undos).toHaveLength(1);
    expect(session.getView().state.board['E6'].placed).toBe(true);
  });
});

describe('undoableSteps covers my own open segment and nobody elses', () => {
  it('offers every step the open segment has taken', () => {
    const state = board();
    const h = harness(state);
    const session = h.session();

    expect(session.getView().undoableSteps).toEqual([]);
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().undoableSteps).toEqual([state.nextStepId]);
  });

  it('offers nothing to a player who is not the actor', () => {
    const h = harness();
    const session = h.session('p2');
    expect(session.getView().undoableSteps).toEqual([]);
  });

  it('offers nothing once an optimistic intent has handed the actor away', () => {
    // Founding a chain does not draw from the bag, so it is applied locally —
    // and in this fixture it leaves the actor unchanged. Placing the tile that
    // completes the turn is the general case: the moment `actorId` is no
    // longer me, the segment I could undo inside is not mine, even though the
    // server has not told me so yet.
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'messla' });

    const view = session.getView();
    if (view.actorId !== 'p1') expect(view.undoableSteps).toEqual([]);
    else expect(view.undoableSteps.length).toBeGreaterThan(0);
  });
});

describe('the curtain has no meaning online', () => {
  it('never asks anyone to reveal', () => {
    const h = harness();
    const session = h.session();
    expect(session.getView().awaitingReveal).toBe(false);
    session.reveal();
    expect(session.getView().awaitingReveal).toBe(false);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```
npx vitest run --project app src/net/NetworkSession.test.ts
```

Expected: failure at import — `./NetworkSession` does not exist.

- [ ] **Step 4: Write `src/net/NetworkSession.ts`**

```ts
import {
  createGameSession,
  type GameSession,
  type SessionError,
  type SessionView,
} from '../../session/GameSession';
import type { Intent } from '../../engine/intents';
import { DRAWS, toWire, type StateMessage } from '../../session/protocol';
import type { RoomTransport } from './transport';

export interface NetworkSession extends GameSession {
  /** Detaches the transport handlers. Call when the room screen unmounts. */
  dispose(): void;
}

export interface NetworkSessionInit {
  transport: RoomTransport;
  /** The seat this device holds. Comes from the socket binding, never a form. */
  playerId: string;
  /** The first state the server sent. A room is never entered blind. */
  initial: StateMessage;
}

function range(from: number, toExclusive: number): number[] {
  const out: number[] = [];
  for (let i = from; i < toExclusive; i++) out.push(i);
  return out;
}

/**
 * A `GameSession` whose authority is elsewhere.
 *
 * It holds a real `GameSession` built from the last state the server sent and
 * replaces it whenever a new one arrives. That reuse is the point: the
 * optimistic path runs the same `applyIntentWithHistory` pass-and-play runs,
 * so there is no second copy of the rules and no second step stack to drift.
 */
export function createNetworkSession(
  { transport, playerId, initial }: NetworkSessionInit,
): NetworkSession {
  let inner = createGameSession({ state: initial.state });
  let segmentStart = initial.segmentStart;
  let rejection: SessionError | null = null;
  let pending = false;
  let view: SessionView | null = null;
  const listeners = new Set<() => void>();

  function invalidate(): void {
    view = null;
    for (const listener of listeners) listener();
  }

  const offState = transport.onState((msg) => {
    inner = createGameSession({ state: msg.state });
    segmentStart = msg.segmentStart;
    pending = false;
    // A `reset` is the rollback half of a rejection the player has just been
    // shown. Clearing the error here would take the explanation away with the
    // state it explains — they arrive as two messages, in that order, and are
    // one event.
    if (msg.reason !== 'reset') rejection = null;
    invalidate();
  });

  const offRejected = transport.onRejected((msg) => {
    rejection = { code: msg.code, message: msg.message };
    pending = false;
    invalidate();
  });

  function buildView(): SessionView {
    const base = inner.getView();
    return {
      ...base,
      // No device is passed, so there is no curtain and nothing to reveal.
      awaitingReveal: false,
      segmentStart,
      pending,
      // Derived, not stored. Gated on being the actor because an optimistic
      // `liquidate` or a merger-triggering `placeTile` can hand the actor to
      // someone else with no bag draw involved — and for the moment before
      // the commit lands, `segmentStart` names a segment this player no
      // longer owns.
      undoableSteps: base.actorId === playerId
        ? range(segmentStart, base.state.nextStepId)
        : [],
      error: rejection ?? base.error,
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

    dispatch(intent: Intent) {
      // One answer is already outstanding; a second intent would race it and
      // come back as a rejection for pressing a button that was still there.
      if (pending) return;

      if (!transport.isOpen()) {
        rejection = { code: 'unknownIntent', message: 'Not connected. Reconnecting…' };
        invalidate();
        return;
      }

      const wire = toWire(intent);

      if (DRAWS.has(wire.type)) {
        // No bag here to draw from, so there is nothing to predict.
        rejection = null;
        pending = true;
        transport.sendIntent(wire);
        invalidate();
        return;
      }

      rejection = null;
      inner.dispatch(intent);
      // A local refusal is the engine's, on the same visible state the server
      // will judge — so it is an answer, not a guess, and the wire never sees
      // it. If the server disagrees anyway, that disagreement arrives as a
      // rejection and is worth knowing about.
      if (inner.getView().error === null) transport.sendIntent(wire);
      invalidate();
    },

    undoTo(stepId: number) {
      if (pending || !transport.isOpen()) return;
      rejection = null;
      pending = true;
      transport.sendUndo(stepId);
      invalidate();
    },

    reveal() {
      // Nothing to reveal: this device shows one player's own state, always.
    },

    dispose() {
      offState();
      offRejected();
      listeners.clear();
    },
  };
}
```

- [ ] **Step 5: Run them and watch them pass**

```
npx vitest run --project app src/net/NetworkSession.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Break it three ways, once each**

Each break must turn a specific test red. Restore after each.

1. Delete the `DRAWS.has(wire.type)` branch so every intent applies optimistically. Expected red: "changes nothing locally, and marks itself pending".
2. Change `if (msg.reason !== 'reset') rejection = null;` to `rejection = null;`. Expected red: "keeps the message while adopting the server state".
3. Drop the `base.actorId === playerId` gate in `undoableSteps`. Expected red: "offers nothing to a player who is not the actor".

Report which test failed for each break.

- [ ] **Step 7: Typecheck and commit**

```
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add src/net
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "feat(net): NetworkSession — a GameSession whose authority is elsewhere"
```

---

## Task 4: The connection and the identity that survives a refresh

**Files:**
- Create: `src/net/identity.ts`
- Create: `src/net/connection.ts`
- Test: `src/net/identity.test.ts`

**Interfaces:**
- Consumes: `RoomTransport`, `createSocketTransport` (Task 3).
- Produces:
  - `interface RoomIdentity { playerId: string; token: string; name: string }`
  - `loadIdentity(roomId): RoomIdentity | null`, `saveIdentity(roomId, id): void`, `rememberedName(): string | null`, `rememberName(name): void`
  - `type ConnectionStatus = 'connecting' | 'open' | 'closed'`
  - `interface Connection { transport; status(); subscribe(l): () => void; createRoom(name); joinRoom(msg); beginGame(); onJoined(h): () => void; onRoster(h): () => void; close() }`
  - `getConnection(): Connection`, `closeConnection(): void`

  Tasks 5 and 6 consume all of it.

- [ ] **Step 1: Write the failing identity test**

Create `src/net/identity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadIdentity, saveIdentity, rememberName, rememberedName } from './identity';

beforeEach(() => { localStorage.clear(); });

describe('a seat survives a refresh', () => {
  it('round-trips what a rejoin has to present', () => {
    saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });
  });

  it('keeps rooms apart', () => {
    saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(loadIdentity('XYZ789')).toBeNull();
  });

  it('survives a corrupted entry rather than throwing at startup', () => {
    localStorage.setItem('acquire.room.ABC123', 'not json');
    expect(loadIdentity('ABC123')).toBeNull();
  });

  it('ignores an entry missing the fields a rejoin needs', () => {
    localStorage.setItem('acquire.room.ABC123', JSON.stringify({ playerId: 'p2' }));
    expect(loadIdentity('ABC123')).toBeNull();
  });

  it('remembers a display name across rooms', () => {
    rememberName('Sam');
    expect(rememberedName()).toBe('Sam');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project app src/net/identity.test.ts
```

Expected: failure at import.

- [ ] **Step 3: Write `src/net/identity.ts`**

```ts
/**
 * Who this browser is, per room.
 *
 * The token is what makes a refresh a rejoin instead of a new seat: the server
 * issues it once at first join and checks it against the seat's own copy, so
 * presenting someone else's `playerId` without their token gets nothing.
 */
export interface RoomIdentity {
  playerId: string;
  token: string;
  name: string;
}

const roomKey = (roomId: string) => `acquire.room.${roomId}`;
const NAME_KEY = 'acquire.name';

/**
 * Every read is guarded twice: `localStorage` itself throws in Safari's
 * private mode, and its contents are user-editable text that has outlived
 * whatever wrote it. A room screen that throws on mount cannot even offer to
 * start over.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser that will not store this still plays fine; it just cannot
    // rejoin after a refresh.
  }
}

export function loadIdentity(roomId: string): RoomIdentity | null {
  const raw = read(roomKey(roomId));
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { playerId, token, name } = parsed as Record<string, unknown>;
    if (typeof playerId !== 'string' || typeof token !== 'string' || typeof name !== 'string') {
      return null;
    }
    return { playerId, token, name };
  } catch {
    return null;
  }
}

export function saveIdentity(roomId: string, identity: RoomIdentity): void {
  write(roomKey(roomId), JSON.stringify(identity));
}

export function clearIdentity(roomId: string): void {
  try {
    localStorage.removeItem(roomKey(roomId));
  } catch {
    // See `write`.
  }
}

export function rememberedName(): string | null {
  const name = read(NAME_KEY);
  return name === null || name.trim() === '' ? null : name;
}

export function rememberName(name: string): void {
  write(NAME_KEY, name);
}
```

- [ ] **Step 4: Run it and watch it pass**

```
npx vitest run --project app src/net/identity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write `src/net/connection.ts`**

No unit test: everything here is socket.io wiring, and a test with a stubbed `io()` would assert that this file calls the functions it plainly calls. Task 7 drives the transport half over a real server, and Task 9's by-hand pass drives the lobby half. Write that boundary into the file so the next reader does not mistake silence for an oversight.

```ts
import { io, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CreateRoomMessage,
  type JoinRoomMessage,
  type JoinedMessage,
  type RosterMessage,
} from '../../session/protocol';
import { createSocketTransport, type RoomTransport } from './transport';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * The lobby half of the wire, plus the transport the game half uses.
 *
 * Untested in isolation, deliberately: `server/clientOverWire.test.ts` proves
 * the transport against the real server, and the create/join/start path is
 * covered by the by-hand pass. A test that stubs `io()` and asserts `emit`
 * was called would restate this file rather than check it.
 */
export interface Connection {
  transport: RoomTransport;
  status(): ConnectionStatus;
  /** Fires on every status change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  createRoom(name: string): void;
  joinRoom(msg: JoinRoomMessage): void;
  beginGame(): void;
  onJoined(handler: (msg: JoinedMessage) => void): () => void;
  onRoster(handler: (msg: RosterMessage) => void): () => void;
  close(): void;
}

function createConnection(): Connection {
  const socket: Socket = io(SERVER_URL, { transports: ['websocket'] });
  const listeners = new Set<() => void>();
  let status: ConnectionStatus = 'connecting';

  function set(next: ConnectionStatus): void {
    status = next;
    for (const listener of listeners) listener();
  }

  socket.on('connect', () => { set('open'); });
  socket.on('disconnect', () => { set('closed'); });
  socket.io.on('reconnect_attempt', () => { set('connecting'); });

  return {
    transport: createSocketTransport(socket),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    createRoom(name) {
      const msg: CreateRoomMessage = { name };
      socket.emit(CLIENT_EVENTS.createRoom, msg);
    },
    joinRoom(msg) { socket.emit(CLIENT_EVENTS.joinRoom, msg); },
    beginGame() { socket.emit(CLIENT_EVENTS.beginGame); },
    onJoined(handler) {
      socket.on(SERVER_EVENTS.joined, handler);
      return () => { socket.off(SERVER_EVENTS.joined, handler); };
    },
    onRoster(handler) {
      socket.on(SERVER_EVENTS.roster, handler);
      return () => { socket.off(SERVER_EVENTS.roster, handler); };
    },
    close() {
      socket.disconnect();
      listeners.clear();
    },
  };
}

let current: Connection | null = null;

/**
 * One socket for the whole app, opened on first use.
 *
 * Lazy because pass-and-play and the catalog have no server by design — the
 * previous provider connected at page load and reported "Disconnected from
 * server" across a game that never needed one. Shared because the create
 * screen and the room screen are two views of one connection: opening a
 * second would drop the seat the first just bound.
 */
export function getConnection(): Connection {
  if (current === null) current = createConnection();
  return current;
}

export function closeConnection(): void {
  current?.close();
  current = null;
}
```

- [ ] **Step 6: Typecheck and commit**

```
npm run typecheck
npx vitest run --project app src/net
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add src/net
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "feat(net): one lazy connection, and an identity that survives a refresh"
```

---

## Task 5: The room screen

**Files:**
- Create: `src/net/useRoom.ts`
- Create: `src/game/online/RoomLobby.tsx`
- Create: `src/game/online/ConnectionStrip.tsx`
- Rewrite: `src/pages/RoomPage.tsx`
- Test: `src/pages/RoomPage.test.tsx`

**Interfaces:**
- Consumes: `Connection`, `ConnectionStatus`, `getConnection` (Task 4); `loadIdentity`, `saveIdentity`, `rememberName`, `rememberedName` (Task 4); `createNetworkSession`, `NetworkSession` (Task 3); `GameScreen` with `viewerId` (Task 2).
- Produces: `useRoom(roomId: string, connect?: () => Connection): Room`, where

```ts
export type RoomPhase = 'connecting' | 'joining' | 'needName' | 'lobby' | 'playing' | 'error';

export interface Room {
  phase: RoomPhase;
  status: ConnectionStatus;
  roster: RosterMessage | null;
  playerId: string | null;
  session: NetworkSession | null;
  message: string | null;
  join(name: string): void;
  begin(): void;
}
```

  Task 6 reuses nothing from here except `getConnection`; the `connect` parameter exists so tests can inject a fake.

- [ ] **Step 1: Write `src/game/online/ConnectionStrip.tsx`**

```tsx
import type { ConnectionStatus } from '../../net/connection';

/**
 * Connection state, and only inside the room.
 *
 * Its predecessor was fixed across every route, which put a bar over the top
 * of pass-and-play and the catalog — neither of which has a server to be
 * disconnected from. A centred pill rather than a full-width bar, because the
 * board underneath it is the thing the player is trying to read.
 */
export function ConnectionStrip({ status }: { status: ConnectionStatus }) {
  if (status === 'open') return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
    >
      {status === 'connecting' ? 'Connecting…' : 'Disconnected — reconnecting…'}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/game/online/RoomLobby.tsx`**

```tsx
import type { RosterMessage } from '../../../session/protocol';

export interface RoomLobbyProps {
  roomId: string;
  players: RosterMessage['players'];
  /** Only the host may start, which is the server's rule too. */
  isHost: boolean;
  /** A refusal that arrived while sitting here — shown, not navigated away from. */
  note?: string | null;
  onStart: () => void;
  onExit: () => void;
}

export function RoomLobby({ roomId, players, isHost, note, onStart, onExit }: RoomLobbyProps) {
  const enough = players.length >= 2;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-center text-2xl font-bold">Room</h1>
        <p className="mb-6 text-center text-sm text-gray-600">Share this code to let people in</p>

        <div
          data-testid="room-code"
          className="mb-6 rounded-lg bg-gray-100 py-4 text-center text-3xl font-bold tracking-[0.3em]"
        >
          {roomId}
        </div>

        <ul className="mb-6 flex flex-col gap-2">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${p.connected ? 'bg-green-500' : 'bg-gray-300'}`}
              />
              <span className="font-semibold">{p.name}</span>
              {p.isHost && <span className="text-xs uppercase tracking-wide text-gray-500">host</span>}
            </li>
          ))}
        </ul>

        {note && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {note}
          </div>
        )}

        {isHost ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!enough}
            className="m-0 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {enough ? 'Start game' : 'Waiting for one more player'}
          </button>
        ) : (
          <p className="text-center text-sm text-gray-600">Waiting for the host to start.</p>
        )}

        <button
          type="button"
          onClick={onExit}
          className="m-0 mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/net/useRoom.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RosterMessage } from '../../session/protocol';
import { getConnection, type Connection, type ConnectionStatus } from './connection';
import { createNetworkSession, type NetworkSession } from './NetworkSession';
import { loadIdentity, rememberName, rememberedName, saveIdentity } from './identity';

export type RoomPhase = 'connecting' | 'joining' | 'needName' | 'lobby' | 'playing' | 'error';

export interface Room {
  phase: RoomPhase;
  status: ConnectionStatus;
  roster: RosterMessage | null;
  playerId: string | null;
  session: NetworkSession | null;
  message: string | null;
  /** Join with a name, for someone arriving on a shared link. */
  join(name: string): void;
  begin(): void;
}

/**
 * connect → join → lobby → playing.
 *
 * `connect` is injectable so screen tests can drive a fake connection; every
 * caller in the app uses the real one.
 */
export function useRoom(roomId: string, connect: () => Connection = getConnection): Room {
  const connection = useMemo(() => connect(), [connect]);

  const [status, setStatus] = useState<ConnectionStatus>(() => connection.status());
  const [roster, setRoster] = useState<RosterMessage | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [session, setSession] = useState<NetworkSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const sessionRef = useRef<NetworkSession | null>(null);
  const identityRef = useRef(loadIdentity(roomId));

  // Status, roster, identity, and the lobby's own rejections.
  useEffect(() => {
    setStatus(connection.status());
    const offStatus = connection.subscribe(() => setStatus(connection.status()));

    const offJoined = connection.onJoined((msg) => {
      const identity = {
        playerId: msg.playerId,
        token: msg.token,
        name: identityRef.current?.name ?? rememberedName() ?? '',
      };
      identityRef.current = identity;
      saveIdentity(msg.roomId, identity);
      setPlayerId(msg.playerId);
      setMessage(null);
    });

    const offRoster = connection.onRoster((msg) => setRoster(msg));

    const offRejected = connection.transport.onRejected((msg) => {
      // Once a game is running, a rejection belongs to the session, which
      // shows it in the panel. Surfacing it here as well would replace the
      // board with an error screen over a refused click.
      if (sessionRef.current === null) setMessage(msg.message);
    });

    return () => { offStatus(); offJoined(); offRoster(); offRejected(); };
  }, [connection]);

  // The first state message is what turns a lobby into a game.
  useEffect(() => {
    const off = connection.transport.onState((msg) => {
      if (sessionRef.current !== null) return;
      const id = identityRef.current?.playerId;
      if (id === undefined) return;

      const built = createNetworkSession({ transport: connection.transport, playerId: id, initial: msg });
      sessionRef.current = built;
      setSession(built);
    });

    return () => {
      off();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [connection]);

  // Join once, as soon as the socket is open and we know what to say.
  const sent = useRef(false);
  useEffect(() => {
    if (status !== 'open' || sent.current || roomId === '') return;

    const stored = identityRef.current;
    if (stored !== null) {
      sent.current = true;
      setJoining(true);
      connection.joinRoom({
        roomId,
        name: stored.name,
        playerId: stored.playerId,
        token: stored.token,
      });
      return;
    }

    const remembered = rememberedName();
    if (remembered === null) return; // phase: needName

    sent.current = true;
    setJoining(true);
    connection.joinRoom({ roomId, name: remembered });
  }, [connection, roomId, status]);

  const join = useCallback((name: string) => {
    rememberName(name);
    sent.current = true;
    setJoining(true);
    setMessage(null);
    connection.joinRoom({ roomId, name });
  }, [connection, roomId]);

  const begin = useCallback(() => { connection.beginGame(); }, [connection]);

  // Order matters. A roster means we are seated, and a refusal that arrives
  // afterwards ("only the host may begin") is a note to show *in* the lobby —
  // ranking `message` above `roster` would throw a seated player back to a
  // join form over a button they were not allowed to press.
  const phase: RoomPhase =
    session !== null ? 'playing'
      : roster !== null ? 'lobby'
        : message !== null ? 'error'
          : status !== 'open' ? 'connecting'
            : joining ? 'joining'
              : 'needName';

  return { phase, status, roster, playerId, session, message, join, begin };
}
```

- [ ] **Step 4: Write the failing screen test**

Create `src/pages/RoomPage.test.tsx`. It drives a fake `Connection`, which is what makes the room screen testable without a server; the real connection is proven in Task 7 and by hand.

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RoomPage } from './RoomPage';
import type { Connection } from '../net/connection';
import type { JoinedMessage, RosterMessage, StateMessage } from '../../session/protocol';
import { buildFixture } from '../../engine/golden/fixtures';

function fakeConnection() {
  let joined: ((m: JoinedMessage) => void) | null = null;
  let roster: ((m: RosterMessage) => void) | null = null;
  let state: ((m: StateMessage) => void) | null = null;
  const joins: unknown[] = [];
  const begins: number[] = [];

  const connection: Connection = {
    transport: {
      sendIntent: () => {},
      sendUndo: () => {},
      onState: (h) => { state = h; return () => { state = null; }; },
      onRejected: () => () => {},
      isOpen: () => true,
    },
    status: () => 'open',
    subscribe: () => () => {},
    createRoom: () => {},
    joinRoom: (m) => { joins.push(m); },
    beginGame: () => { begins.push(1); },
    onJoined: (h) => { joined = h; return () => { joined = null; }; },
    onRoster: (h) => { roster = h; return () => { roster = null; }; },
    close: () => {},
  };

  return {
    connection,
    joins,
    begins,
    sendJoined: (m: JoinedMessage) => act(() => { joined?.(m); }),
    sendRoster: (m: RosterMessage) => act(() => { roster?.(m); }),
    sendState: (m: StateMessage) => act(() => { state?.(m); }),
  };
}

function renderRoom(connection: Connection) {
  return render(
    <MemoryRouter initialEntries={['/room/ABC123']}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomPage connect={() => connection} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); });

describe('arriving at a room without a seat', () => {
  it('asks for a name rather than joining as nobody', () => {
    const f = fakeConnection();
    renderRoom(f.connection);

    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(f.joins).toEqual([]);
  });

  it('joins with the name given', () => {
    const f = fakeConnection();
    renderRoom(f.connection);

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam' }]);
  });
});

describe('a refresh rejoins the same seat', () => {
  it('presents the stored token instead of taking a new seat', () => {
    localStorage.setItem(
      'acquire.room.ABC123',
      JSON.stringify({ playerId: 'p2', token: 'tok', name: 'Sam' }),
    );
    const f = fakeConnection();
    renderRoom(f.connection);

    expect(f.joins).toEqual([{ roomId: 'ABC123', name: 'Sam', playerId: 'p2', token: 'tok' }]);
  });
});

describe('the lobby', () => {
  function seated(isHost: boolean) {
    const f = fakeConnection();
    renderRoom(f.connection);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    f.sendJoined({ roomId: 'ABC123', playerId: isHost ? 'p1' : 'p2', token: 'tok' });
    f.sendRoster({
      roomId: 'ABC123',
      lifecycle: 'lobby',
      players: [
        { id: 'p1', name: 'Alex', isHost: true, connected: true },
        { id: 'p2', name: 'Sam', isHost: false, connected: true },
      ],
    });
    return f;
  }

  it('shows the code to read out and everyone in it', () => {
    seated(true);
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABC123');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('lets the host start', () => {
    const f = seated(true);
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));
    expect(f.begins).toHaveLength(1);
  });

  it('offers nobody else a start button', () => {
    seated(false);
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull();
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
  });
});

describe('the first state message starts the game', () => {
  it('swaps the lobby for the board, seen from my own seat', () => {
    const f = fakeConnection();
    renderRoom(f.connection);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    f.sendJoined({ roomId: 'ABC123', playerId: 'p2', token: 'tok' });

    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
    f.sendState({ state, reason: 'commit', segmentStart: state.nextStepId });

    expect(screen.getByTestId('game-surface')).toBeInTheDocument();
    // p2's own tile, and no curtain over it.
    expect(screen.getByTitle('A1')).toBeInTheDocument();
    expect(screen.queryByText(/pass to/i)).toBeNull();
    expect(screen.getByText(/waiting for alex/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```
npx vitest run --project app src/pages/RoomPage.test.tsx
```

Expected: failure — `RoomPage` takes no `connect` prop and still renders the legacy `WaitingRoom`.

- [ ] **Step 6: Write `src/game/online/JoinForm.tsx`**

```tsx
import { useState } from 'react';
import { getRandomEmojiName } from '../../utils/emojiNames';

export interface JoinFormProps {
  /** Fixed when the room is already known (a shared link); editable otherwise. */
  roomId?: string;
  title: string;
  submitLabel: string;
  error?: string | null;
  onSubmit(name: string, roomId: string): void;
}

export function JoinForm({ roomId, title, submitLabel, error, onSubmit }: JoinFormProps) {
  const [name, setName] = useState(getRandomEmojiName);
  const [code, setCode] = useState(roomId ?? '');

  const ready = name.trim() !== '' && code.trim() !== '';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <form
        className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit(name.trim(), code.trim().toUpperCase());
        }}
      >
        <h1 className="mb-6 text-center text-2xl font-bold">{title}</h1>

        {roomId === undefined && (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Room code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 uppercase tracking-[0.2em]"
            />
          </label>
        )}

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          />
        </label>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!ready}
          className="m-0 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
```

`<label>` wrapping the input is what makes `getByLabelText(/your name/i)` work without an `id`.

- [ ] **Step 7: Rewrite `src/pages/RoomPage.tsx`**

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import { GameScreen } from '../game/GameScreen';
import { RoomLobby } from '../game/online/RoomLobby';
import { ConnectionStrip } from '../game/online/ConnectionStrip';
import { JoinForm } from '../game/online/JoinForm';
import { useRoom } from '../net/useRoom';
import { getConnection, type Connection } from '../net/connection';

export interface RoomPageProps {
  /** Injectable so screen tests can drive a fake. The app never passes it. */
  connect?: () => Connection;
}

export function RoomPage({ connect = getConnection }: RoomPageProps) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useRoom(roomId ?? '', connect);

  if (room.phase === 'playing' && room.session && room.playerId) {
    return (
      <>
        <ConnectionStrip status={room.status} />
        {/*
          No `onNewGame`: this room belongs to everyone in it, and starting
          over is not one player's to do. Leaving is.
        */}
        <GameScreen
          session={room.session}
          viewerId={room.playerId}
          onExit={() => navigate('/')}
        />
      </>
    );
  }

  if (room.phase === 'needName' || room.phase === 'error') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <JoinForm
          roomId={roomId}
          title={`Join ${roomId ?? ''}`}
          submitLabel="Join room"
          error={room.message}
          onSubmit={(name) => room.join(name)}
        />
      </>
    );
  }

  if (room.phase === 'lobby' && room.roster) {
    const me = room.roster.players.find((p) => p.id === room.playerId);
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomLobby
          roomId={room.roster.roomId}
          players={room.roster.players}
          isHost={me?.isHost === true}
          note={room.message}
          onStart={room.begin}
          onExit={() => navigate('/')}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <ConnectionStrip status={room.status} />
      <p className="text-gray-600">{room.phase === 'joining' ? 'Joining…' : 'Connecting…'}</p>
    </div>
  );
}
```

- [ ] **Step 8: Run it and watch it pass**

```
npx vitest run --project app src/pages/RoomPage.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 9: Break it once**

In `useRoom`, drop the stored-identity branch so a refresh always joins by name. Re-run: "presents the stored token instead of taking a new seat" must fail. Restore.

- [ ] **Step 10: Typecheck and commit**

```
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add src/net/useRoom.ts src/game/online src/pages/RoomPage.tsx src/pages/RoomPage.test.tsx
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "feat(online): the room screen — lobby, then the board from my own seat"
```

---

## Task 6: The way in

**Files:**
- Rewrite: `src/pages/OnlineLobbyPage.tsx`, `src/pages/CreateRoomPage.tsx`, `src/pages/JoinRoomPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/pages/CreateRoomPage.test.tsx`

**Interfaces:**
- Consumes: `getConnection`, `Connection` (Task 4); `saveIdentity`, `rememberName` (Task 4); `JoinForm` (Task 5).
- Produces: nothing later tasks import. Routes keep their existing paths: `/online`, `/online/create`, `/online/join`, `/room/:roomId`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/CreateRoomPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CreateRoomPage } from './CreateRoomPage';
import type { Connection } from '../net/connection';
import type { JoinedMessage } from '../../session/protocol';

function fakeConnection() {
  let joined: ((m: JoinedMessage) => void) | null = null;
  const created: string[] = [];

  const connection: Connection = {
    transport: {
      sendIntent: () => {}, sendUndo: () => {},
      onState: () => () => {}, onRejected: () => () => {}, isOpen: () => true,
    },
    status: () => 'open',
    subscribe: () => () => {},
    createRoom: (name) => { created.push(name); },
    joinRoom: () => {},
    beginGame: () => {},
    onJoined: (h) => { joined = h; return () => { joined = null; }; },
    onRoster: () => () => {},
    close: () => {},
  };

  return { connection, created, sendJoined: (m: JoinedMessage) => act(() => { joined?.(m); }) };
}

beforeEach(() => { localStorage.clear(); });

describe('creating a room', () => {
  it('asks the server for one, then lands in it', () => {
    const f = fakeConnection();
    render(
      <MemoryRouter initialEntries={['/online/create']}>
        <Routes>
          <Route path="/online/create" element={<CreateRoomPage connect={() => f.connection} />} />
          <Route path="/room/:roomId" element={<div>room page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(f.created).toEqual(['Alex']);

    f.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 'tok' });

    expect(screen.getByText('room page')).toBeInTheDocument();
    // The seat is stored before the navigation, or the room screen it lands on
    // would join again as a stranger.
    expect(JSON.parse(localStorage.getItem('acquire.room.ABC123')!)).toEqual({
      playerId: 'p1', token: 'tok', name: 'Alex',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project app src/pages/CreateRoomPage.test.tsx
```

Expected: failure — the page still emits the old `createRoom` shape with a callback and takes no `connect` prop.

- [ ] **Step 3: Rewrite `src/pages/CreateRoomPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRandomEmojiName } from '../utils/emojiNames';
import { getConnection, type Connection } from '../net/connection';
import { rememberName, saveIdentity } from '../net/identity';

export interface CreateRoomPageProps {
  /** Injectable for tests. The app never passes it. */
  connect?: () => Connection;
}

export function CreateRoomPage({ connect = getConnection }: CreateRoomPageProps) {
  const navigate = useNavigate();
  const connection = connect();
  const [name, setName] = useState(getRandomEmojiName);
  const [waiting, setWaiting] = useState(false);

  // The name at the moment the request was sent, not at the moment the answer
  // arrives — the field is still editable in between.
  const sentName = useRef('');

  useEffect(() => connection.onJoined((msg) => {
    saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: sentName.current });
    navigate(`/room/${msg.roomId}`);
  }), [connection, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <form
        className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (trimmed === '') return;
          sentName.current = trimmed;
          rememberName(trimmed);
          setWaiting(true);
          connection.createRoom(trimmed);
        }}
      >
        <h1 className="mb-6 text-center text-2xl font-bold">Create a room</h1>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={waiting || name.trim() === ''}
          className="m-0 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {waiting ? 'Creating…' : 'Create room'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/online')}
          className="m-0 mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
        >
          Back
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/pages/JoinRoomPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JoinForm } from '../game/online/JoinForm';
import { getConnection, type Connection } from '../net/connection';
import { rememberName, saveIdentity } from '../net/identity';

export interface JoinRoomPageProps {
  connect?: () => Connection;
}

export function JoinRoomPage({ connect = getConnection }: JoinRoomPageProps) {
  const navigate = useNavigate();
  const connection = connect();
  const [error, setError] = useState<string | null>(null);
  const sentName = useRef('');

  useEffect(() => {
    const offJoined = connection.onJoined((msg) => {
      saveIdentity(msg.roomId, { playerId: msg.playerId, token: msg.token, name: sentName.current });
      navigate(`/room/${msg.roomId}`);
    });
    const offRejected = connection.transport.onRejected((msg) => setError(msg.message));
    return () => { offJoined(); offRejected(); };
  }, [connection, navigate]);

  return (
    <JoinForm
      title="Join a room"
      submitLabel="Join room"
      error={error}
      onSubmit={(name, roomId) => {
        sentName.current = name;
        rememberName(name);
        setError(null);
        connection.joinRoom({ roomId, name });
      }}
    />
  );
}
```

- [ ] **Step 5: Rewrite `src/pages/OnlineLobbyPage.tsx`**

Two buttons and no socket — the page exists to choose between creating and joining, and opening a connection to render it is what made the old lobby wait on a server before offering a choice.

```tsx
import { useNavigate } from 'react-router-dom';

export function OnlineLobbyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-center text-2xl font-bold">Play online</h1>
        <p className="mb-6 text-center text-sm text-gray-600">Everyone plays from their own device</p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => navigate('/online/create')}
            className="m-0 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
          >
            Create a room
          </button>
          <button
            type="button"
            onClick={() => navigate('/online/join')}
            className="m-0 w-full rounded-lg border border-gray-300 px-4 py-3 font-semibold hover:bg-gray-50"
          >
            Join with a code
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="m-0 w-full rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the app suite**

```
npx vitest run --project app
```

Expected: PASS except `src/App.test.tsx`, which still exercises `OnlineOnlyBanner`. Leave that failure standing if it appears — Task 8 deletes both. If it passes here (the banner is still wired), that is fine too.

- [ ] **Step 7: Typecheck and commit**

```
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add src/pages src/game/online
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "feat(online): create and join against the new protocol"
```

---

## Task 7: Two clients, real sockets, the golden corpus

The centrepiece. Phase 3a proved the reducer half of the optimistic-client claim (42 predictable steps, 0 mismatches) and explicitly deferred the transport half to here.

**Files:**
- Create: `server/clientOverWire.test.ts`

**Interfaces:**
- Consumes: `startTestServer`, `connectPlayer`, `settleSocket`, `TestClient`, `TestServer` from `server/socketHarness.js`; `createNetworkSession` from `../src/net/NetworkSession.js`; `createSocketTransport` from `../src/net/transport.js`; `project` from `./projection.js`; `DRAWS`, `toWire` from `../session/protocol.js`; `ALL_GOLDEN_GAMES`, `buildFixture`.
- Produces: nothing. This is a gate.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { DRAWS, toWire } from '../session/protocol.js';
import { project } from './projection.js';
import {
  startTestServer,
  connectPlayer,
  settleSocket,
  type TestClient,
  type TestServer,
} from './socketHarness.js';
import { createNetworkSession, type NetworkSession } from '../src/net/NetworkSession.js';
import { createSocketTransport } from '../src/net/transport.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

/**
 * The transport half of the optimistic-client claim.
 *
 * `server/goldenSocket.test.ts` proves the inbound leg — every assertion in it
 * reads `room.draft()`, the authority's own in-process state, and eight of the
 * seventeen games kept passing when the outbound delivery was suppressed
 * entirely. This file asserts only on what a *client* holds: the state a
 * `NetworkSession` arrived at, by predicting six of nine intents locally and
 * being corrected on the rest. If projection, the commit boundary, or the
 * optimistic reducer disagree with the server, it is this file that notices.
 */
describe('two networked clients reach the same state the server holds', () => {
  // Summed across every game and floored after the loop. A comparison count
  // that silently drops to zero — a harness that stops finding predictable
  // steps, say — would otherwise leave every per-step assertion vacuous while
  // the suite stayed green.
  let predictions = 0;

  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, async () => {
      const fixture = buildFixture(game.setup);
      const names = fixture.players.map((p) => p.name);
      const room = server.rooms.fromState(`client-${game.id}`, names, fixture);

      const clients: Record<string, TestClient> = {};
      const sessions: Record<string, NetworkSession> = {};

      for (const seat of room.players) {
        clients[seat.id] = await connectPlayer(server.port, room.id, seat.name, seat.id, seat.token);
      }
      // The server sends a state on join for a room already in play. Settling
      // each connection is what makes "it has arrived" true rather than
      // likely: socket.io delivers one connection's messages in order, so an
      // acknowledged round trip lands behind everything sent before it.
      for (const seat of room.players) {
        await settleSocket(clients[seat.id].socket);
        const initial = clients[seat.id].latest();
        expect(initial, `${game.id} — ${seat.id} never received an opening state`).toBeDefined();
        sessions[seat.id] = createNetworkSession({
          transport: createSocketTransport(clients[seat.id].socket),
          playerId: seat.id,
          initial: initial!,
        });
      }

      try {
        for (const step of game.steps) {
          const actor = step.intent.playerId;
          const session = sessions[actor];
          const where = `${game.id} / ${step.name}`;
          const wire = toWire(step.intent);
          const predictable = !DRAWS.has(wire.type) && !step.expectError;

          session.dispatch(step.intent);

          // Captured before the server can answer: this is the client's own
          // prediction, not the server's reply relabelled.
          const predicted = predictable ? session.getView().state : null;

          for (const seat of room.players) await settleSocket(clients[seat.id].socket);

          if (step.expectError) {
            // The client refuses most illegal intents itself, on the same
            // visible state the server would judge, so many never reach the
            // wire at all. Either way the player is told the same thing, and
            // the code is the engine's.
            expect(session.getView().error?.code, `${where} — expected a refusal`)
              .toBe(step.expectError);
            continue;
          }

          expect(session.getView().error, `${where} — unexpected refusal`).toBeNull();

          if (predicted !== null) {
            expect(predicted, `${where} — the client predicted a different state`)
              .toEqual(project(room.draft(), actor));
            predictions++;
          }

          // Everyone who has been told something holds exactly what the
          // server would project for them. A client mid-way through its own
          // segment is ahead of the committed state, which is the one case
          // this cannot claim — so it is asserted for every other seat.
          for (const seat of room.players) {
            if (seat.id === room.actorId()) continue;
            expect(sessions[seat.id].getView().state, `${where} — ${seat.id} is out of step`)
              .toEqual(project(room.committed(), seat.id));
          }
        }
      } finally {
        for (const seat of room.players) {
          sessions[seat.id].dispose();
          clients[seat.id].close();
        }
      }
    });
  }

  it('made enough predictions across the corpus to trust the count', () => {
    // Phase 3a measured 42 predictable steps across the same seventeen games.
    // Floored well below that so a new golden game cannot break this, while a
    // harness that stops predicting fails loudly.
    expect(predictions).toBeGreaterThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run it**

```
npx vitest run --project node server/clientOverWire.test.ts
```

Expected: PASS for all seventeen games plus the floor. **If a game fails, do not weaken the assertion** — it has found a real disagreement between the client and the server, which is exactly what this file exists to find. Report it as a finding with the game id, the step name, and the diff.

The floor test depends on `describe`-scope mutation and vitest's default in-file sequential ordering, the same as `server/room.test.ts`'s segment-close floor. Note it; do not run this project with `--sequence.shuffle`.

- [ ] **Step 3: Break it twice, and report which test failed each time**

1. In `src/net/NetworkSession.ts`, delete the `DRAWS.has(wire.type)` branch so bag-drawing intents are applied optimistically too. Expected: several games fail on "the client predicted a different state" — the client cannot know which tile it drew. Restore.
2. In `server/index.ts`'s `sendState`, send `source` unprojected (`state: source` instead of `state: project(source, playerId)`). Expected: games fail on "is out of step" once any player holds a tile another does not. Restore.

Report the failing game ids for each break. A break that fails zero games means this file is not reading what it claims to read.

- [ ] **Step 4: Run the whole suite and commit**

```
npx vitest run
npm run typecheck
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add server/clientOverWire.test.ts
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "test(server): two networked clients replay the golden corpus over real sockets"
```

---

## Task 8: Delete the legacy UI

Everything here is reachable in git history; nothing is being preserved by leaving it in the tree. It has been dead since Phase 3a deleted the protocol it speaks.

**Files:**
- Delete: `src/Game.tsx`, `src/components/` (all 18 files), `src/context/SocketContext.tsx`, `src/utils/gameSession.ts`, `src/utils/playerId.ts`, `src/App.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `src/utils/emojiNames.ts` stays — `JoinForm` and `CreateRoomPage` use `getRandomEmojiName`.

- [ ] **Step 1: Confirm nothing outside the doomed set imports it**

```
grep -rn --include='*.ts' --include='*.tsx' -e "components/" -e "context/SocketContext" -e "utils/playerId" -e "utils/gameSession" -e "from './Game'" -e 'from "./Game"' ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b/src
```

Expected matches only inside `src/Game.tsx`, `src/components/*`, `src/context/SocketContext.tsx`, `src/App.tsx` (the banner import) and `src/main.tsx` (the provider import). Anything else is a live consumer — stop and report it rather than deleting.

- [ ] **Step 2: Delete**

```
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b rm -r src/components src/context src/Game.tsx src/utils/gameSession.ts src/utils/playerId.ts src/App.test.tsx
```

`src/App.test.tsx` goes with its subject: it tested `OnlineOnlyBanner`, and the guarantee it encoded — no connection UI on routes with no server — is now structural, since `ConnectionStrip` renders only inside the room screen.

- [ ] **Step 3: Strip `src/App.tsx` down to routes**

Remove the `ReconnectionBanner` import, the `OFFLINE_ROUTES` constant, the `OnlineOnlyBanner` export and its use, and the now-unused `useLocation` import. The `Routes` block is unchanged: same four paths, same elements, and the lazy `CatalogPage` stays exactly as it is (`npm run check:bundle` depends on it).

- [ ] **Step 4: Strip the provider out of `src/main.tsx`**

```tsx
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/index.css";

// Use base path for GitHub Pages in production
const basename = import.meta.env.PROD ? '/acquire-startups-m1' : '/';

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>
);
```

The socket now opens on first use inside the online routes, which is the whole point of `getConnection` being lazy.

- [ ] **Step 5: Run every gate**

```
npx vitest run
npm run typecheck
npx vite build
npm run check:bundle
```

Expected: all green. `npm run check:bundle` greps `dist/assets` for the literal `vitest` only — a nonzero exit here means golden data or vitest reached the main chunk, not that socket.io did. (The bundle legitimately contains `socket.io-client`; the Phase 3a carry-forward records a naive grep that false-positives on it.)

- [ ] **Step 6: Commit**

```
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add -A
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "chore: delete the legacy modal UI and its socket provider"
```

---

## Task 9: The by-hand pass, and the record

**Files:**
- Create: `docs/superpowers/specs/2026-08-05-phase-3b-carry-forward.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the handoff to Phase 4.

- [ ] **Step 1: Run every gate on the final tree**

```
npx vitest run
npm run typecheck
npx vite build
npm run check:bundle
npm run verify:layout
```

Record the test count and file count. Expected: all five green.

- [ ] **Step 2: Play a real game in two browser windows**

```
npm run dev:all
```

Open two windows (not two tabs of the same profile — `localStorage` is shared per origin, and both seats would read the same identity; use one normal window and one private window). Then:

1. Window A: `/online` → Create a room → note the code.
2. Window B: `/online` → Join with a code → the same code.
3. Window A: Start game. Both windows should reach the turn-order draw with the panel showing "Open the game", and only seat one should have the button.
4. Play a full game to final scoring. On the way, deliberately reach:
   - a **merger with a liquidation queue that seats both players** — the non-active player must gain control at the commit that pays them, with the figures already on screen;
   - an **undo inside an open segment** — the step stack's undo must roll the server back, and the other window must never have seen the undone step at all;
   - a **refresh mid-game in window B** — it must rejoin the same seat, with the same hand, not take a new one;
   - a **bag-drawing intent** (end turn) — the button must go inert until the server answers, not double-fire.
5. Confirm the non-actor window never shows another player's tiles, and never shows a curtain.

Record what you find, including anything cosmetic. This is the first time any part of Phase 3 has been driven by a person; every previous phase found something here that the gates missed.

- [ ] **Step 3: Write the carry-forward**

`docs/superpowers/specs/2026-08-05-phase-3b-carry-forward.md`, following the shape of its predecessor: what shipped (with measured before/after numbers), what the coverage boundaries are, the mistakes made along the way including the author's own, what Phase 4 inherits, deviations from this plan and why each was right, and the standing list carried from earlier phases (the per-player turn-order draw, `LiqQueue`'s design review, seat names truncating at 768px, `Board.tsx` rendering read-only cells as buttons, the catalog building every fixture at module load).

Add whatever the by-hand pass turned up, and state plainly whether the phase's central claim — two people can play a game of Acquire against this server — is now true.

- [ ] **Step 4: Update `CLAUDE.md`**

Rewrite the current-focus paragraph and three layout rows:

- **Current focus:** Phases 0 through 3b done; online multiplayer plays end to end on the new component layer. Phase 4 is presence and recovery.
- **`src/components/`, `src/Game.tsx` row:** delete it. The files are gone.
- **`src/net/` row (new):** the client's half of the wire — `NetworkSession` (a `GameSession` whose authority is the server), the socket transport, the lazy connection, per-room identity.
- **`server/` row:** drop "headless: no client speaks its protocol yet".

- [ ] **Step 5: Commit**

```
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b add -A
git -C ~/Developer/personal/acquire-startups-m1/.worktrees/phase-3b commit -m "docs: Phase 3b carry-forward"
```

- [ ] **Step 6: Finish the branch**

**REQUIRED SUB-SKILL:** superpowers:finishing-a-development-branch. Base branch is `main`; note that `revamp/phase-3a-server-authority` is also unmerged and this branch contains it, so merging 3b brings both.

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the seam and its eight rules → Task 3; `DRAWS` consolidation → Task 1; `SessionView.pending` and the `GameScreen`/`useTurnPanel` change → Task 2; connection, identity and `useRoom` → Tasks 4 and 5; the four screens → Tasks 5 and 6; the two-client golden replay → Task 7; deletions → Task 8; the by-hand pass, the carry-forward and the gates → Task 9. The design's nine test groups appear as: 1–2 in Task 3, 3–4 in Task 3, 5 in Task 3, 6 in Tasks 2 and 3, 7 in Task 7, 8 in Tasks 5 and 6, 9 in Task 9.

**Deliberate scope notes.** The design's "stubbed draw" needs no code — today's `startGame` already does it, and Task 9's by-hand pass step 3 checks it reads sensibly online. The per-player draw is recorded in the design and carried forward, not built.

**Type consistency.** `RoomTransport` (Task 3) is consumed unchanged by Tasks 4, 5 and 7. `NetworkSession extends GameSession` with `dispose()` (Task 3) is what Task 5 stores and disposes. `Connection` (Task 4) is what Tasks 5 and 6 inject fakes for; its shape is fixed at Task 4 and every fake in Tasks 5 and 6 implements all ten members. `SessionView.pending` (Task 2) is read by `GameScreen` and `useTurnPanel` in the same task and written by `NetworkSession` in Task 3. `viewerId` (Task 2) is passed only by `RoomPage` (Task 5).

---

# Addendum: the by-hand pass findings (Tasks 10–16)

Added 2026-08-05, after the first by-hand pass with two real clients. Seven
findings, all confirmed against the code before being written down. Two were
created by this phase; five predate it and are equally wrong in pass-and-play
today. The repository owner ruled that all seven land on this branch rather
than a follow-on phase.

**Why these tasks carry prose rather than full code blocks:** each is one or
two files against atoms that already exist (`StockCard`, `Tile`, `Board`'s
`owners`/`hqTiles` props). The implementer reads the neighbouring component,
which is a better specification than a transcription of it would be. Exact
interfaces, exact test names and the break to run are still given in full.

**The root cause behind three of them:** the pass-the-device curtain was
carrying the "whose turn is it" signal, and online there is no curtain.
Nothing replaced it.

## Task 10: One join, one seat

**Finding:** submitting the room screen's join form twice creates two seats.
Reproduced by hand: two browsers produced a three-player roster.
`RoomPage`'s `JoinForm` is the one path that never got the guard Task 6 added
to `JoinRoomPage` — `useRoom.join()` sets its own latch, but nothing disables
the button, and the server seats a fresh player because no token is presented.

**Files:** modify `src/net/useRoom.ts`, `src/pages/RoomPage.tsx`; test
`src/pages/RoomPage.test.tsx`.

- [ ] Expose the in-flight state `useRoom` already tracks (`joining`) on its
      returned `Room`, and have `RoomPage` pass it to `JoinForm`'s existing
      `busy` prop. Clear it when a rejection arrives, exactly as
      `JoinRoomPage` does — a mistyped code must stay correctable.
- [ ] Test: two submits before any reply send exactly one `joinRoom`.
- [ ] Test: a rejection re-enables the form.
- [ ] Break each (remove the guard; leave `busy` set on rejection), confirm
      each turns its own test red, restore, report both.

## Task 11: An inert tile must look inert

**Finding:** `src/game/atoms/Tile.tsx`'s `interactive` is
`state === 'hand' || state === 'blocked' || onClick != null`, so a hand tile
renders as an enabled `<button>` — hover, focus ring, tab order — even with no
handler. Online the non-actor stares at six of their own live-looking tiles for
someone else's whole turn and clicking does nothing. This is the standing
`Board.tsx` finding from the 1b carry-forward, made user-visible by 3b.

**Files:** modify `src/game/atoms/Tile.tsx`, `src/game/Board.tsx`; tests
`src/game/atoms/Tile.test.tsx`, `src/game/Board.test.tsx`,
`src/game/GameScreen.test.tsx`.

- [ ] A tile renders as a `<button>` only when it has an `onClick`. `blocked`
      keeps its disabled-button treatment (a disabled button is already out of
      tab order and its cursor already says so).
- [ ] The *look* of a hand tile does not change — it stays blue and bold,
      because it is still yours. Only the affordance goes: no pointer cursor,
      no hover shift, no focus ring, not focusable.
- [ ] `Board` must still let a caller tell a hand cell from an empty one
      without a handler. Add a stable hook for that — a `data-tile-state`
      attribute on `Tile` carrying its state is the least invasive.
- [ ] **`GameScreen.test.tsx`'s "shows me my own hand while someone else acts"
      currently discriminates on `tagName === 'BUTTON'`, which this task
      deliberately breaks.** Re-point it at `data-tile-state`, keeping both
      halves of the assertion: my `A1` is a hand tile, the actor's `E6` is not.
- [ ] Break: make `interactive` unconditional again; confirm the new
      affordance test goes red. Restore, report.

## Task 12: The step stack is this turn, not the whole game

**Finding:** `src/game/screen/stepsOf.tsx:16` maps `state.log` entire, so the
panel accumulates every step of the game. It was only ever meant to carry the
open segment, as the undo surface.

**Files:** modify `src/game/screen/stepsOf.tsx` and its caller in
`src/game/GameScreen.tsx`; test `src/game/screen/stepsOf.test.tsx`.

- [ ] `stepsOf` takes the segment start and drops every entry below it.
      `SessionView.segmentStart` already carries it; pass it through.
- [ ] Test, driven from a replayed golden game: a step from an earlier segment
      is absent, every step of the open one is present.
- [ ] Break: drop the filter; confirm the earlier-segment step reappears and
      the test goes red. Restore, report.

## Task 13: The board says who played what, and where each chain began

**Finding:** `Board` has `owners` (a per-coord badge, top-right) and `hqTiles`
(the one labelled cell per chain) and `GameScreen` passes neither.

**Files:** modify `src/game/GameScreen.tsx`, `src/game/Board.tsx` if the badge
needs to carry an emoji rather than an initial; test
`src/game/GameScreen.test.tsx`.

- [ ] **Founding tile per chain:** pass `hqTiles` from
      `state.startups[*].foundingTile` (`engine/gameTypes.ts:94`), skipping
      nulls. Nearly free.
- [ ] **Owner badge:** each player's most recently placed tile carries their
      emoji. `Player.lastPlacedTile` is *not* the right source — it is
      documented as "the tile placed this turn, still undoable" and is cleared
      the moment it stops being undoable (`engine/gameLogic.ts:291`). Derive it
      instead from `state.log`: the latest entry per `playerId` whose phase is
      a placement and whose `detail` carries a tile token. Check `LogToken`'s
      shape before writing the extractor. **`engine/` stays untouched.**
- [ ] Undo must take the badge with it. Because the log rewinds with the state,
      deriving from it gives that for free — assert it rather than assuming it.
- [ ] Test: after two players have each placed, each badge shows that player's
      emoji at that player's coord; a founded chain's founding tile is labelled.
- [ ] Break: pass `owners={{}}`; confirm the badge test goes red. Restore,
      report.

## Task 14: Shares for sale are cards

**Finding:** the buy step renders bare `<button>{ticker} ${price}</button>`.
`src/game/atoms/StockCard.tsx` exists and takes exactly the props needed:
`id`, `price`, `mode="add"`, `disabled`, `onClick`, `size`.

**Files:** modify `src/game/screen/useTurnPanel.tsx`; test
`src/game/screen/useTurnPanel.test.tsx`.

- [ ] Replace the buttons with `StockCard`s in `mode="add"`, price from
      `getSharePrice` as now, `disabled` on the same condition as now (no buys
      left, or not affordable with what is already staged).
- [ ] Keep the accessible name a buyer can find: the existing tests query
      `aria-label="Buy one <id>"`. If `StockCard` names itself differently,
      update the tests to the name it actually renders rather than bending the
      atom.
- [ ] Panel-height stability: the buy row is taller as cards than as buttons.
      Confirm the active zone's reservation still holds and note what you
      measured — and remember jsdom reports zero for every layout, so this one
      is settled by the by-hand pass, not by a test.

## Task 15: Change your mind about a tile without undoing

**Finding:** after placing, clicking a different hand tile is refused
(`wrongStage`). It should replace the placement, so long as the open segment
holds nothing but that placement — once a share is staged or a survivor chosen,
the placement is settled and undo is the way back.

**Files:** modify `src/game/GameScreen.tsx` (the `onCellClick` handler) and
`src/game/screen/` as needed; test `src/game/GameScreen.test.tsx`.

- [ ] When the actor clicks a hand tile and the open segment's only step is
      their placement, undo to the segment start and place the new tile.
- [ ] The gate is the *step count in the open segment*, not the stage —
      `undoableSteps` carries it. One step means only the placement has
      happened; more means something followed it.
- [ ] Online this is two round trips (undo is the server's to grant, then the
      placement). Sequence it so a rejected undo does not leave a placement
      half-applied.
- [ ] Test, pass-and-play: place `E6`, click `H8`, and the board shows `H8`
      placed and `E6` back in hand, with no error.
- [ ] Test: with a share staged, clicking another tile does *not* switch.
- [ ] Break: remove the segment-length gate so it always switches; confirm the
      second test goes red. Restore, report.

## Task 16: Whose turn it is, said plainly

**Finding, and this phase's own doing:** when it is not your turn the panel's
active zone is replaced by "Waiting for Alex." in 13px grey. The owner's
verdict: the panel should keep showing the player their own step, and the
waiting state belongs in an obvious toast.

**Files:** create `src/game/online/TurnToast.tsx`; modify
`src/game/screen/useTurnPanel.tsx`, `src/game/GameScreen.tsx`; tests
`src/game/online/TurnToast.test.tsx`, `src/game/GameScreen.test.tsx`.

- [ ] The toast names the actor with their emoji and what they are doing —
      "🦊 Alex is placing a tile" — using the same `stageLabel` source the
      panel uses, so the two cannot drift.
- [ ] It is obvious: a real overlay, not a caption. It must not cover the board
      or the panel's controls.
- [ ] It appears only when `viewerId` is set and is not the actor. Pass-and-play
      never shows it — the curtain already says whose turn it is.
- [ ] **The panel stops taking over.** `useTurnPanel`'s `!canAct` branch keeps
      rendering the stage's own step, with its controls absent or disabled
      rather than replaced by a sentence. "Place a tile" still shows the player
      their hand.
- [ ] `pending` ("Sending…") keeps its existing behaviour — that one *is* about
      this player's own action.
- [ ] Test: as a non-actor, the toast names the actor and the panel still shows
      the stage's step; as the actor, no toast.
- [ ] Break: render the toast unconditionally; confirm the actor-sees-no-toast
      test goes red. Restore, report.
