# LobbyView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the lobby an element-level view model, so no consumer re-derives *is this seat me*, *may I begin*, *may I rename this* — and so empty seats become expressible at all, which the roster cannot say today.

**Architecture:** One pure function, `lobbyView(state, limits)`, turning `LobbyRoomState` into a `LobbyView` of seats, capabilities and terminal state. No React, no sockets, no JSX — testable as a fold. Acquire's `RoomPage`/`RoomLobby` then consume it instead of re-deriving, which is the proof it fits.

**Tech Stack:** TypeScript 5, Vitest 4 (`app` project, jsdom — the file lives under `src/`), React 19.

**Spec:** [2026-08-12-lobby-lift-sequencing.md](../specs/2026-08-12-lobby-lift-sequencing.md), step 5. Shapes first sketched in [2026-08-12-lobby-lift-carry-forward.md](../specs/2026-08-12-lobby-lift-carry-forward.md).

## Global Constraints

- **Branch from `fix/seat-id-space`**, not `main` — this needs `MAX_PLAYERS` from [#17](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/17), which is still open. Open the PR with `--base fix/seat-id-space`. Rebase onto `main` once #17 merges.
- **`PROTOCOL_VERSION` does not change.** Capacity is supplied by the game on the client, not sent by the server — see the ruling below. No wire change, no cutover.
- **No new UI.** This is the headless half. `src/lobby/` must still contain **no JSX**, and the boundary test's exact count moves deliberately.
- **The lobby carries no badge.** Seats expose `index`; the game decorates by it. Settled in step 4 and not reopened here.
- **Baseline: 838 tests in 80 files** on `fix/seat-id-space`.
- **Never run bare `tsc`** — use `npm run typecheck`.
- **Prove every new test can fail.**

## The ruling this plan rests on

**Capacity comes from the game on the client, not from the server on the wire.**

The roster sends only occupied seats and carries no capacity. Two ways to fix that: add capacity to `RosterMessage` (a protocol bump), or have each game's own client state its limits. The second is chosen: both halves of a game already know its own rules — Acquire imports `MAX_PLAYERS` from `engine/startups.ts`, which the *server* also uses to build its seat space, so the two cannot drift. Rail Baron will pass the length of its colour list.

A protocol bump would buy nothing here and cost a cutover.

## File Structure

| Path | Change |
|---|---|
| `src/lobby/view.ts` | **New.** `LobbyView`, `LobbySeat`, `LobbyLimits`, `lobbyView()`. Pure. |
| `src/lobby/view.test.ts` | **New.** The fold, exhaustively — no React. |
| `engine/startups.ts` | **New** `MIN_PLAYERS = 2`, beside `MAX_PLAYERS` |
| `src/pages/RoomPage.tsx` | Uses the view instead of re-deriving `me` and `isHost` |
| `src/game/lobby/RoomLobby.tsx` | Takes a `LobbyView` instead of loose props; renders empty seats |
| `lobby/importBoundary.test.ts` | Exact count 10 → 12 |

---

### Task 1: The view model

**Files:**
- Create: `src/lobby/view.ts`, `src/lobby/view.test.ts`
- Modify: `engine/startups.ts`

**Interfaces:**
- Consumes: `LobbyRoomState` from `src/lobby/useLobbyRoom.ts` — `{ phase, status, roster, playerId, message, gone, stale }` plus actions. `ConnectionStatus = 'connecting' | 'open' | 'closed'`. `Lifecycle = 'lobby' | 'playing' | 'over'`.
- Produces:
  ```ts
  export interface LobbySeat {
    /** Server-assigned id, or null when nobody is sitting here. */
    id: string | null;
    /** 0-based position. Always present — games decorate by it. */
    index: number;
    name: string | null;
    isHost: boolean;
    isYou: boolean;
    connected: boolean;
    /** Your own seat, and only while the room is still a lobby. */
    canRename: boolean;
  }

  export interface LobbyView {
    /** Exactly `limits.capacity` entries: the occupied ones, then empties. */
    seats: LobbySeat[];
    you: LobbySeat | null;
    /** The room code. The *game* builds any URL from it — base paths are per-repo. */
    code: string;
    canBegin: boolean;
    beginBlocked: 'notHost' | 'notEnoughPlayers' | 'alreadyBegun' | null;
    connection: 'connecting' | 'live' | 'dropped';
    terminal: 'gone' | 'refused' | 'stale' | null;
  }

  export interface LobbyLimits { capacity: number; minPlayers: number }

  export function lobbyView(state: LobbyRoomState, limits: LobbyLimits): LobbyView;
  ```

- [ ] **Step 1: Add the second rule**

`engine/startups.ts`, beside `MAX_PLAYERS`:

```ts
/** Acquire needs two to start. The other half of the 2–6 range. */
export const MIN_PLAYERS = 2;
```

`RoomLobby` currently hardcodes `players.length >= 2`; that literal is what this replaces.

- [ ] **Step 2: Write the failing tests**

Create `src/lobby/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lobbyView, type LobbyLimits } from './view';
import type { LobbyRoomState } from './useLobbyRoom';

const LIMITS: LobbyLimits = { capacity: 4, minPlayers: 2 };

const noop = () => {};
const base = (over: Partial<LobbyRoomState> = {}): LobbyRoomState => ({
  phase: 'lobby',
  status: 'open',
  roster: {
    roomId: 'ABC123',
    lifecycle: 'lobby',
    players: [
      { id: 'p1', name: 'Ada', isHost: true, connected: true },
      { id: 'p2', name: 'Margo', isHost: false, connected: true },
    ],
  },
  playerId: 'p2',
  message: null,
  gone: false,
  stale: false,
  join: noop, begin: noop, rename: noop, leaveSeat: noop,
  ...over,
});

describe('seats', () => {
  it('pads to capacity, so an empty seat is expressible at all', () => {
    const view = lobbyView(base(), LIMITS);
    expect(view.seats).toHaveLength(4);
    expect(view.seats.map((s) => s.id)).toEqual(['p1', 'p2', null, null]);
    expect(view.seats.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('marks an empty seat as nobody, not as a nameless somebody', () => {
    const empty = lobbyView(base(), LIMITS).seats[3]!;
    expect(empty.name).toBeNull();
    expect(empty.isYou).toBe(false);
    expect(empty.isHost).toBe(false);
    expect(empty.canRename).toBe(false);
  });

  it('knows which seat is yours, so no consumer repeats the find', () => {
    const view = lobbyView(base(), LIMITS);
    expect(view.you?.id).toBe('p2');
    expect(view.seats.filter((s) => s.isYou)).toHaveLength(1);
  });

  it('has no you when the roster does not hold your id', () => {
    expect(lobbyView(base({ playerId: 'p9' }), LIMITS).you).toBeNull();
  });

  it('lets you rename only your own seat, and only in the lobby', () => {
    const inLobby = lobbyView(base(), LIMITS);
    expect(inLobby.seats.filter((s) => s.canRename).map((s) => s.id)).toEqual(['p2']);

    const playing = lobbyView(
      base({ roster: { ...base().roster!, lifecycle: 'playing' } }),
      LIMITS,
    );
    expect(playing.seats.filter((s) => s.canRename)).toHaveLength(0);
  });

  it('reports the room code for the share element, and no URL', () => {
    // Base paths are per-repo, so the game builds the link.
    expect(lobbyView(base(), LIMITS).code).toBe('ABC123');
  });
});

describe('beginning', () => {
  it('lets the host begin once there are enough players', () => {
    const view = lobbyView(base({ playerId: 'p1' }), LIMITS);
    expect(view.canBegin).toBe(true);
    expect(view.beginBlocked).toBeNull();
  });

  it('refuses a non-host, and says why', () => {
    const view = lobbyView(base(), LIMITS);   // playerId p2, not the host
    expect(view.canBegin).toBe(false);
    expect(view.beginBlocked).toBe('notHost');
  });

  it('refuses below the minimum, and says why', () => {
    const solo = base({
      playerId: 'p1',
      roster: {
        roomId: 'ABC123',
        lifecycle: 'lobby',
        players: [{ id: 'p1', name: 'Ada', isHost: true, connected: true }],
      },
    });
    expect(lobbyView(solo, LIMITS).beginBlocked).toBe('notEnoughPlayers');
  });

  it('refuses once the game has already begun', () => {
    const playing = base({ playerId: 'p1', roster: { ...base().roster!, lifecycle: 'playing' } });
    expect(lobbyView(playing, LIMITS).beginBlocked).toBe('alreadyBegun');
  });

  it('reports not-host before not-enough, because it is the more useful answer', () => {
    // A guest sat alone should be told they are not the host, not that the
    // room is short — the second is true but not theirs to fix.
    const soloGuest = base({
      playerId: 'p2',
      roster: {
        roomId: 'ABC123',
        lifecycle: 'lobby',
        players: [
          { id: 'p1', name: 'Ada', isHost: true, connected: true },
          { id: 'p2', name: 'Margo', isHost: false, connected: true },
        ],
      },
    });
    expect(lobbyView(soloGuest, { capacity: 4, minPlayers: 3 }).beginBlocked).toBe('notHost');
  });
});

describe('connection and terminal state', () => {
  it('maps the socket status to something a screen can say', () => {
    expect(lobbyView(base({ status: 'connecting' }), LIMITS).connection).toBe('connecting');
    expect(lobbyView(base({ status: 'open' }), LIMITS).connection).toBe('live');
    expect(lobbyView(base({ status: 'closed' }), LIMITS).connection).toBe('dropped');
  });

  it('has no terminal state in the ordinary case', () => {
    expect(lobbyView(base(), LIMITS).terminal).toBeNull();
  });

  it('ranks stale above gone, because a stale client cannot trust either answer', () => {
    const both = base({ gone: true, stale: true });
    expect(lobbyView(both, LIMITS).terminal).toBe('stale');
  });

  it('reports a refusal from the error phase', () => {
    expect(lobbyView(base({ phase: 'error', roster: null }), LIMITS).terminal).toBe('refused');
  });

  it('survives having no roster yet', () => {
    const early = base({ phase: 'connecting', roster: null, playerId: null });
    const view = lobbyView(early, LIMITS);
    expect(view.seats).toHaveLength(4);
    expect(view.seats.every((s) => s.id === null)).toBe(true);
    expect(view.you).toBeNull();
    expect(view.code).toBe('');
  });
});
```

- [ ] **Step 3: Run them and read the failures**

Run: `npx vitest run src/lobby/view.test.ts`
Expected: FAIL — `Cannot find module './view'`.

- [ ] **Step 4: Implement**

Create `src/lobby/view.ts`:

```ts
import type { LobbyRoomState } from './useLobbyRoom';

export interface LobbySeat {
  id: string | null;
  index: number;
  name: string | null;
  isHost: boolean;
  isYou: boolean;
  connected: boolean;
  canRename: boolean;
}

export interface LobbyView {
  seats: LobbySeat[];
  you: LobbySeat | null;
  code: string;
  canBegin: boolean;
  beginBlocked: 'notHost' | 'notEnoughPlayers' | 'alreadyBegun' | null;
  connection: 'connecting' | 'live' | 'dropped';
  terminal: 'gone' | 'refused' | 'stale' | null;
}

/** What the *game* knows about itself. Not sent by the server: both halves
 *  read the same rule, so they cannot drift, and no protocol bump is spent. */
export interface LobbyLimits {
  capacity: number;
  minPlayers: number;
}

const emptySeat = (index: number): LobbySeat => ({
  id: null, index, name: null, isHost: false, isYou: false,
  connected: false, canRename: false,
});

/**
 * The element inventory a lobby has: seats (occupied *and* empty), who you
 * are, the room code, whether you may begin, and how the connection stands.
 *
 * It exists because every consumer was re-deriving the same four facts —
 * `players.find(p => p.id === playerId)`, `me?.isHost`, `players.length >= 2`,
 * "may I rename this" — and could not derive the fifth at all: the roster
 * carries only occupied seats, so an empty one was inexpressible.
 *
 * Pure, and deliberately so. It is the piece both games share, and neither
 * game's screens can be tested through the other's.
 */
export function lobbyView(state: LobbyRoomState, limits: LobbyLimits): LobbyView {
  const players = state.roster?.players ?? [];
  const lifecycle = state.roster?.lifecycle ?? 'lobby';

  const seats: LobbySeat[] = Array.from({ length: limits.capacity }, (_, index) => {
    const player = players[index];
    if (!player) return emptySeat(index);
    const isYou = player.id === state.playerId;
    return {
      id: player.id,
      index,
      name: player.name,
      isHost: player.isHost,
      isYou,
      connected: player.connected,
      canRename: isYou && lifecycle === 'lobby',
    };
  });

  const you = seats.find((s) => s.isYou) ?? null;

  // notHost before notEnoughPlayers: a guest should be told the thing that is
  // theirs to know, not the thing that is merely also true.
  const beginBlocked: LobbyView['beginBlocked'] =
    lifecycle !== 'lobby' ? 'alreadyBegun'
    : you?.isHost !== true ? 'notHost'
    : players.length < limits.minPlayers ? 'notEnoughPlayers'
    : null;

  return {
    seats,
    you,
    code: state.roster?.roomId ?? '',
    canBegin: beginBlocked === null,
    beginBlocked,
    connection:
      state.status === 'open' ? 'live'
      : state.status === 'closed' ? 'dropped'
      : 'connecting',
    // Stale outranks gone: a client on the wrong protocol cannot trust either
    // answer it was given, so "your client is old" is the honest one.
    terminal:
      state.stale ? 'stale'
      : state.gone ? 'gone'
      : state.phase === 'error' ? 'refused'
      : null,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lobby/view.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Prove the padding test can fail**

Temporarily change the seats builder to `players.map(...)` — dropping the pad.

Run: `npx vitest run src/lobby/view.test.ts`
Expected: FAIL on "pads to capacity" with `expected length 2 to be 4`. **Read it**, then revert.

- [ ] **Step 7: Prove the rename guard can fail**

Temporarily set `canRename: isYou`, dropping the lifecycle check.

Run: `npx vitest run src/lobby/view.test.ts`
Expected: FAIL on "lets you rename only your own seat, and only in the lobby" — `expected length 1 to be 0`. **Read it**, then revert.

- [ ] **Step 8: Commit**

```bash
git add src/lobby/view.ts src/lobby/view.test.ts engine/startups.ts
git commit -m "feat(lobby): a view model of the elements a lobby has

Every consumer was re-deriving the same four facts — which seat is me,
am I host, are there enough players, may I rename this — and could not
derive the fifth at all: the roster carries only occupied seats, so an
empty one was inexpressible.

Pure, so it is testable without either game's screens, which is the
point: it is the half both games share.

Capacity comes from the game rather than the wire. Both halves read the
same rule (MAX_PLAYERS builds the server's seat space and the client's
limits), so they cannot drift, and no protocol bump is spent on it."
```

---

### Task 2: Acquire consumes it

The proof the model fits. If `RoomPage` still needs a `find`, the view is missing something.

**Files:**
- Modify: `src/pages/RoomPage.tsx`, `src/game/lobby/RoomLobby.tsx`

- [ ] **Step 1: Pass the view down**

In `RoomPage.tsx`, replace the `me` lookup at line ~106 with:

```tsx
import { lobbyView } from '../lobby/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/startups';
// …
const view = lobbyView(room, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });
```

…and hand `RoomLobby` the view rather than `players` / `myPlayerId` / `isHost`.

- [ ] **Step 2: Render from the view**

In `RoomLobby.tsx`, replace the `enough` literal and the `players.map`:

```tsx
const canBegin = view.canBegin;
// …
{view.seats.map((seat) => (
  <SeatRow
    key={seat.index}
    emoji={seatEmoji(seat.index)}
    connected={seat.connected}
    isHost={seat.isHost}
    empty={seat.id === null}
  />
))}
```

`SeatRow` gains an `empty` prop. An empty seat renders the emoji dimmed with no name — the first time this screen has been able to show one. Keep the rename affordance gated on `seat.canRename` rather than on `p.id === myPlayerId`.

- [ ] **Step 3: Typecheck and run the whole suite**

```bash
npm run typecheck && npx vitest run
```

Expected: pass. `RoomLobby.test.tsx` will need its props updated to pass a view; that is the migration, not a regression.

- [ ] **Step 4: Confirm nothing re-derives any more**

```bash
grep -n "players.find\|players.length >=\|=== room.playerId\|myPlayerId" src/pages/RoomPage.tsx src/game/lobby/RoomLobby.tsx
```

Expected: no hits. Any that remain are either a fact the view should carry, or a genuine game concern — decide which, and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/pages/RoomPage.tsx src/game/lobby/RoomLobby.tsx src/game/lobby/RoomLobby.test.tsx src/game/lobby/LobbyCard.tsx
git commit -m "refactor(lobby): Acquire's room screen renders from the view

Empty seats render for the first time — the roster could never say one
existed. RoomPage no longer finds itself in the roster and RoomLobby no
longer hardcodes a two-player minimum."
```

---

### Task 3: Boundary count, gates, by-hand, PR

- [ ] **Step 1: Move the exact count**

`src/lobby/` gains `view.ts` and `view.test.ts`, so the lobby's file count goes 10 → 12. Update the number **and** the file list in the comment in `lobby/importBoundary.test.ts`.

Run: `npx vitest run lobby/importBoundary.test.ts`
Expected: pass at 12. It will have failed with `expected 12 to be 10` before the edit — note that failure, it is the tripwire working.

- [ ] **Step 2: Every gate**

```bash
npm run typecheck && npx vitest run && npm run check:bundle && npm run verify:layout
```

- [ ] **Step 3: By hand — the empty seats are the point**

```bash
env VITE_SERVER_URL=http://localhost:3002 npm run build
env PORT=3002 GAMES_DIR=/tmp/acq-view npm run dev:server
npm run preview
```

Create a room. The screen must now show **six seats, four of them empty**, rather than one row. Confirm: the Start button says why it is disabled, renaming still works on your own row and nowhere else, and dropping the server flips the connection strip.

- [ ] **Step 4: Notes, then the PR**

Write `docs/superpowers/specs/2026-08-12-lobby-view-by-hand-notes.md`, then:

```bash
git push -u origin feat/lobby-view
gh pr create --base fix/seat-id-space --title "A view model of the elements a lobby has" --body "…"
```

**`--base fix/seat-id-space`** while #17 is open. Rebase onto `main` and retarget once it merges.

---

## Deferred — not in this plan

- **Rail Baron consuming this.** It has no server yet; that is the lift.
- **Chosen badges.** Settled in step 4: decoration is derived from the seat, so the lobby carries none.
- **`RoomRefused`'s dead end** ([#14](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/14)). `terminal: 'refused'` gives a consumer somewhere to hang the fix, but the fix itself is a UX decision and its own change.
