# Seat-ID Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the game supply the lobby's seat-id space, so seat ids stop being derived from a shrinking array's length — killing [#13](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/13) by construction and yielding room capacity, which the lobby has no notion of today.

**Architecture:** `createLobbyRegistry` gains a `SeatSpace`: an ordered list of every seat id the game has. Seating picks the first id nobody holds. An id is either free or taken, so a duplicate is unrepresentable; the list's length is the capacity, so a full room refuses rather than growing forever.

**Tech Stack:** TypeScript 5, Vitest 4 (`node` project — this is all server code), Socket.io 4.

**Spec:** [2026-08-12-lobby-lift-sequencing.md](../specs/2026-08-12-lobby-lift-sequencing.md), step 4.

## Global Constraints

- **Branch from `main`** as `fix/seat-id-space`. Requires [#15](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/15) and [#16](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/16) merged — both are, as of 2026-08-12.
- **Acquire's seat ids must stay `p1`…`p6`.** `server/store.ts` persists rosters and `rooms.restore()` seats them at boot; changing the strings orphans every saved room. This plan changes *how* ids are chosen, never *what* they are.
- **`PROTOCOL_VERSION` does not change.** Seat ids already travel on the wire as opaque strings; no shape changes.
- **This is behaviour-adjacent on the join path.** Every new test must be proven to fail first.
- **Baseline: 830 tests in 79 files** on `main`. Expect this branch to *add* tests, not change existing counts — except `lobby/importBoundary.test.ts`, whose exact count moves (see Task 3).
- **Never run bare `tsc`** — use `npm run typecheck`.

## Two rulings that shaped this (2026-08-12)

**A seat's badge is derived, not chosen.** The lobby carries no emoji, no colour and no badge
field. Acquire computes its emoji from the seat index; Rail Baron's seat id *is* its colour
(`red`, `green`, …), so the decoration and the identity are the same string. Nothing goes on the
wire, nothing needs uniqueness enforcement — a seat is unique already.

If players are ever allowed to *pick* a badge, that is a choice rather than a derivation: it would
need an opaque `badge` on `SeatHolder`, a `chooseBadge` action beside `rename`, and uniqueness.
Deferred deliberately, and it can be added later without undoing any of this.

**Capacity is a game rule, stated as one.** An earlier draft of this plan derived it from
`PLAYER_EMOJI.length`, which conflates a decoration list with a rule: the emoji were always meant
to become a larger, selectable set, and growing them would silently have moved the player cap.
`MAX_PLAYERS` now lives in `engine/startups.ts` beside the other rules.

That also closes a latent bug at the other end — `PlayerRoster` caps pass-and-play at
`PLAYER_EMOJI.length`, so a longer emoji list would have offered more seats than the game allows.

## The two bugs, one of which does not exist yet

**The known one.** `server/lobby/rooms.ts` seats a join as `seatPlayer(room.players.length, name)` → `p${seat + 1}`, while `leaveSeat` in `handlers.ts` splices the array. p1,p2,p3 → p2 leaves → the next join mints a **second p3**.

**The one this change would introduce if written naively.** `seatPlayer` sets `isHost: seat === 0`. Once ids are reused, a newcomer taking a freed `p1` would arrive at index 0 and be made host — while `leaveSeat` has already promoted `players[0]` to host. **Two hosts.** `isHost` must become "this room has no players yet", not "index zero".

## File Structure

| Path | Change |
|---|---|
| `engine/startups.ts` | **New** `MAX_PLAYERS = 6`, beside the other game rules |
| `src/game/setup/PlayerRoster.tsx` | Caps on `MAX_PLAYERS`, not on the emoji list's length |
| `server/lobby/rooms.ts` | `SeatSpace` type; `seatPlayer` takes the space; `createLobbyRegistry` takes it; `join` seats the first free id and refuses a full room |
| `server/lobby/rooms.test.ts` | **New.** The leave-then-join replay, capacity, host promotion |
| `server/rooms.ts` | Passes Acquire's space, sized by `MAX_PLAYERS` |
| `server/lobby/genericConsumer.test.ts` | Its stub consumer passes a space |
| `lobby/importBoundary.test.ts` | Exact count 9 → 10 |

---

### Task 1: The seat space

**Files:**
- Modify: `server/lobby/rooms.ts`
- Test: `server/lobby/rooms.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface SeatSpace {
    /** Every seat this game has, in order. Its length is the room's capacity. */
    readonly ids: readonly string[];
    /** Display name for an unnamed player seated at `index`. Defaults to `Player ${index + 1}`. */
    defaultName?(index: number): string;
  }
  export function seatPlayer(space: SeatSpace, taken: readonly SeatHolder[], name?: string): SeatHolder | null;
  export function createLobbyRegistry<R extends LobbyRoomLike>(
    makeRoom: (id: string, players: SeatHolder[]) => R,
    space: SeatSpace,
  ): LobbyRegistry<R>;
  ```
  `seatPlayer` returns `null` when every id is taken. `join` returning `null` is already how the handlers signal a refusal, so capacity needs no new code path.

- [ ] **Step 1: Write the failing tests**

Create `server/lobby/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLobbyRegistry, type LobbyRoomLike, type SeatHolder } from './rooms.js';
import type { Lifecycle } from '../../lobby/protocol.js';

interface StubRoom extends LobbyRoomLike { stage: Lifecycle }
const makeStub = (id: string, players: SeatHolder[]): StubRoom =>
  ({ id, players, stage: 'lobby', lifecycle() { return this.stage; } });

const SPACE = { ids: ['p1', 'p2', 'p3'] };
const registry = () => createLobbyRegistry<StubRoom>(makeStub, SPACE);

describe('seating from a fixed id space', () => {
  it('gives the host the first id', () => {
    const { player } = registry().create('Ada');
    expect(player.id).toBe('p1');
    expect(player.isHost).toBe(true);
  });

  it('hands each new arrival the next free id', () => {
    const r = registry();
    const { room } = r.create('Ada');
    expect(r.join(room.id, 'Margo')?.player.id).toBe('p2');
    expect(r.join(room.id, 'Dev')?.player.id).toBe('p3');
  });

  it('reuses a vacated id instead of minting a duplicate', () => {
    // The bug this whole change exists for: ids used to come from
    // players.length, which shrinks when leaveSeat splices.
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    r.join(room.id, 'Dev');

    room.players.splice(1, 1);            // p2 leaves, exactly as leaveSeat does
    const rejoined = r.join(room.id, 'Kit');

    expect(rejoined?.player.id).toBe('p2');
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(new Set(room.players.map((p) => p.id)).size).toBe(room.players.length);
  });

  it('does not make a second host when the first seat is retaken', () => {
    // leaveSeat promotes players[0]; a newcomer taking the freed p1 must not
    // arrive believing it is host too.
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');

    room.players.splice(0, 1);            // the host leaves
    room.players[0].isHost = true;        // ...and handlers promote the next
    r.join(room.id, 'Dev');               // who then takes the freed p1

    expect(room.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(room.players.find((p) => p.isHost)?.name).toBe('Margo');
  });

  it('refuses a join once every seat is taken', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    r.join(room.id, 'Dev');
    expect(r.join(room.id, 'Kit')).toBeNull();
  });

  it('names an unnamed arrival after the seat they actually got', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    room.players.splice(1, 1);
    expect(r.join(room.id)?.player.name).toBe('Player 2');
  });

  it('lets a game supply its own default names', () => {
    const space = { ids: ['red', 'green'], defaultName: (i: number) => `Baron ${i + 1}` };
    const r = createLobbyRegistry<StubRoom>(makeStub, space);
    const { room, player } = r.create();
    expect(player.id).toBe('red');
    expect(player.name).toBe('Baron 1');
    expect(r.join(room.id)?.player.id).toBe('green');
  });
});
```

- [ ] **Step 2: Run them and read the failures**

Run: `npx vitest run server/lobby/rooms.test.ts`
Expected: FAIL. `createLobbyRegistry` takes one argument today, so the calls are a type error and the id assertions fail on the old `p${length+1}` behaviour.

- [ ] **Step 3: Implement**

In `server/lobby/rooms.ts`, replace `seatPlayer` and thread the space through:

```ts
/**
 * The seats a game has, supplied by the game. Its length is the room's
 * capacity, and an id is either free or taken — so a duplicate seat id is
 * unrepresentable rather than merely unlikely.
 *
 * Ids used to be derived from `players.length`, which shrinks when a seat is
 * given up: p1,p2,p3 → p2 leaves → the next join minted a *second* p3, and
 * rename, rejoin and socket-binding lookups all resolved to the wrong seat.
 */
export interface SeatSpace {
  readonly ids: readonly string[];
  defaultName?(index: number): string;
}

/**
 * The one place both `create` and `join` seat somebody, and therefore the only
 * place that can name an unnamed player.
 *
 * `isHost` is "this room has no players yet", not "index zero". Once ids are
 * reused those differ: `leaveSeat` promotes `players[0]` when the host goes,
 * and a newcomer taking the freed first id would otherwise arrive believing it
 * is host as well — two hosts, one room.
 *
 * Returns null when every seat is taken. `join` already returns null for a
 * refusal, so capacity needs no new path through the handlers.
 */
export function seatPlayer(
  space: SeatSpace,
  taken: readonly SeatHolder[],
  name?: string,
): SeatHolder | null {
  const held = new Set(taken.map((p) => p.id));
  const index = space.ids.findIndex((id) => !held.has(id));
  if (index === -1) return null;

  const given = name?.trim();
  return {
    id: space.ids[index]!,
    name: given ? given : (space.defaultName?.(index) ?? `Player ${index + 1}`),
    token: randomUUID(),
    isHost: taken.length === 0,
    connected: true,
  };
}
```

Then in `createLobbyRegistry(makeRoom, space)`:

```ts
    create(hostName) {
      let id = roomCode();
      while (rooms.has(id)) id = roomCode();

      const host = seatPlayer(space, [], hostName);
      // An empty room always has a free seat unless the game supplied none.
      if (!host) throw new Error('SeatSpace has no ids: a room could seat nobody');
      const room = makeRoom(id, [host]);
      rooms.set(id, room);
      return { room, player: host };
    },
```

…and at the end of `join`, replacing the `seatPlayer(room.players.length, name)` line:

```ts
      const player = seatPlayer(space, room.players, name);
      if (!player) return null;   // the room is full
      room.players.push(player);
      return { room, player };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/lobby/rooms.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the duplicate-id test can fail**

Temporarily restore the old behaviour — in `seatPlayer`, replace the free-id search with `const index = taken.length;`.

Run: `npx vitest run server/lobby/rooms.test.ts`
Expected: FAIL on "reuses a vacated id instead of minting a duplicate", with the roster reading `['p1','p3','p3']`. **Read the output**, then revert.

- [ ] **Step 6: Prove the two-host test can fail**

Temporarily set `isHost: index === 0`.

Run: `npx vitest run server/lobby/rooms.test.ts`
Expected: FAIL on "does not make a second host", `expected length 2 to be 1`. **Read it**, then revert.

- [ ] **Step 7: Commit**

```bash
git add server/lobby/rooms.ts server/lobby/rooms.test.ts
git commit -m "fix(lobby): the game supplies the seat-id space

Seat ids came from players.length, which shrinks when leaveSeat splices:
p1,p2,p3 -> p2 leaves -> the next join minted a second p3, and rename,
rejoin and socket-binding lookups resolved to the wrong seat.

Now the game supplies an ordered list of every seat it has, and seating
takes the first id nobody holds. A duplicate is unrepresentable rather
than unlikely, and the list's length gives the room a capacity the lobby
never had.

isHost becomes 'no players yet' rather than 'index zero'. Under id reuse
those differ: leaveSeat promotes players[0], and a newcomer taking the
freed first id would otherwise arrive as a second host."
```

---

### Task 2: Acquire supplies its own space

**Files:**
- Modify: `server/rooms.ts`, `server/lobby/genericConsumer.test.ts`

**Interfaces:**
- Consumes: `SeatSpace`, the two-argument `createLobbyRegistry`, the three-argument `seatPlayer`.
- Produces: no new exports. Acquire's ids stay `p1`…`p6`.

- [ ] **Step 1: Give Acquire its space**

In `server/rooms.ts`, above the `createLobbyRegistry` call:

First add the rule itself, in `engine/startups.ts` beside `MAX_BUYS_PER_TURN`:

```ts
/**
 * Acquire seats 2–6. A game rule, so it lives with the rules — not derived
 * from `PLAYER_EMOJI.length`, which is a decoration list meant to grow into
 * a larger selectable set. Deriving the cap from it would mean adding an
 * emoji silently changed how many people can play.
 */
export const MAX_PLAYERS = 6;
```

Then in `server/rooms.ts`, above the `createLobbyRegistry` call:

```ts
import { MAX_PLAYERS } from '../engine/startups.js';

/**
 * `p1`…`p6`, and the strings matter: `server/store.ts` persists rosters and
 * `rooms.restore()` seats them at boot, so changing them orphans every saved
 * room. Only *how* they are chosen changed.
 */
const ACQUIRE_SEATS = {
  ids: Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i + 1}`),
};
```

Then pass it: `createLobbyRegistry<GameRoom>((id, players) => createGameRoom(id, players), ACQUIRE_SEATS)`.

- [ ] **Step 1b: Cap pass-and-play on the rule, not on the emoji**

`src/game/setup/PlayerRoster.tsx` defaults `maxSeats = PLAYER_EMOJI.length`. That is the same
conflation at the other end: a longer emoji list would offer more pass-and-play seats than the
game allows. Point it at the rule:

```tsx
import { MAX_PLAYERS } from '../../../engine/startups';
// …
  maxSeats = MAX_PLAYERS,
```

Keep the `PLAYER_EMOJI` import if `emojiFor` still uses it — only the cap moves.

`PlayerRoster.test.tsx` builds its six-seat fixture as `PLAYER_EMOJI.map(...)`; that still yields
six today, but it should say what it means: `Array.from({ length: MAX_PLAYERS }, ...)`.

- [ ] **Step 2: Fix the dev-seeding call**

`server/rooms.ts` line ~60 reads `names.map((name, i) => seatPlayer(i, name))`. `seatPlayer` now takes the space and the seats already taken, and it builds them cumulatively:

```ts
      const players: SeatHolder[] = [];
      for (const name of names) {
        const seated = seatPlayer(ACQUIRE_SEATS, players, name);
        if (!seated) throw new Error(`dev seed asked for ${names.length} seats; the space has ${ACQUIRE_SEATS.ids.length}`);
        players.push(seated);
      }
```

- [ ] **Step 3: Update the generic-consumer test's stub**

`server/lobby/genericConsumer.test.ts` calls `createLobbyRegistry<StubRoom>(makeStub)` three times and `seatPlayer(0, 'Bee')` once. Give it a space of its own — that test exists to prove the lobby is generic, so its space should look nothing like Acquire's:

```ts
const STUB_SEATS = { ids: ['seat-a', 'seat-b', 'seat-c'] };
```

Pass `STUB_SEATS` to each `createLobbyRegistry`, and change the lone `seatPlayer(0, 'Bee')` to `seatPlayer(STUB_SEATS, [], 'Bee')!`.

- [ ] **Step 4: Typecheck and run the whole suite**

```bash
npm run typecheck
npx vitest run
```

Expected: pass. Any remaining `seatPlayer(` or `createLobbyRegistry(` call with the old arity is a type error and will name itself.

- [ ] **Step 5: Confirm saved rooms still restore**

The ids are unchanged, but confirm rather than assume — this is the one thing that would break silently in production:

```bash
npx vitest run server/recovery.test.ts
```

Expected: pass. That suite kills a server and reboots it against the same store.

- [ ] **Step 6: Commit**

```bash
git add server/rooms.ts server/lobby/genericConsumer.test.ts
git commit -m "feat(lobby): Acquire supplies p1..p6 as its seat space

The strings are unchanged — store.ts persists rosters and restore()
seats them at boot, so changing them would orphan every saved room. Only
how they are chosen changed.

Capacity derives from PLAYER_EMOJI rather than a literal 6: the engine
assigns emoji by seat index, so a seventh seat would have none. The
client already caps itself the same way."
```

---

### Task 3: The room is now finite — say so on the wire

Capacity is new. Before this branch **the server had no player limit at all**: a seventh client could join a room and the engine would hand it a seat with no emoji. That was a real, unnoticed hole, and closing it is a behaviour change worth its own test and its own line in the notes.

**Files:**
- Modify: `lobby/importBoundary.test.ts`
- Test: `server/lobby/handlers.test.ts` if one exists, else extend `server/lobby/rooms.test.ts`

- [ ] **Step 1: Bump the boundary count**

`server/lobby/rooms.test.ts` is new, so the lobby's file count goes 9 → 10. In `lobby/importBoundary.test.ts` update both the number and the list in its comment:

```ts
  // Ten files: lobby/{protocol,importBoundary.test},
  // server/lobby/{handlers,rooms,rooms.test,genericConsumer.test},
  // src/lobby/{connection,identity,identity.test,useLobbyRoom}.
  expect(files.length).toBe(10);
```

- [ ] **Step 2: Verify a full room refuses over a real socket**

The registry-level refusal is covered in Task 1. Confirm it reaches a client as a rejection rather than a silent no-op — `join` returning null is the same path an unknown room takes, so this should already work, and the test is to prove it rather than to change anything.

Run: `npx vitest run server/lobby/`
Expected: pass.

- [ ] **Step 3: Full suite and typecheck**

```bash
npm run typecheck && npx vitest run
```

Expected: 830 + the new tests, and `importBoundary` green at 10.

- [ ] **Step 4: Commit**

```bash
git add lobby/importBoundary.test.ts
git commit -m "test: the lobby's file count moves to ten

server/lobby/rooms.test.ts is new. The exact count is the tripwire that
catches a file quietly leaving the lobby, so it moves deliberately."
```

---

### Task 4: By hand, then review and PR

- [ ] **Step 1: Drive the leave-then-join sequence in a browser**

The unit test replays it through the registry; this drives it through real sockets, which is where the binding lookups live.

```bash
env VITE_SERVER_URL=http://localhost:3002 npm run build
env PORT=3002 GAMES_DIR=/tmp/acq-seats npm run dev:server
npm run preview
```

Create a room, join from a second profile so there are three seats, have the middle one press **Leave**, then join again. The new arrival must take the vacated id, and the roster must show three distinct seats. Read the roster rather than trusting the screen: seat ids are not rendered, so check `GAMES_DIR`'s room file once a game has begun, or log the roster from the client.

- [ ] **Step 2: Fill the room**

Seat six players, then attempt a seventh. It must be refused rather than seated. Before this branch it would have been seated with no emoji.

- [ ] **Step 3: Write the notes**

`docs/superpowers/specs/2026-08-12-seat-id-space-by-hand-notes.md`. Record the seat ids actually observed after the leave-then-join, as ids, not as "looked right".

- [ ] **Step 4: Review the whole branch**

```bash
git diff main...fix/seat-id-space
```

Both of Phase 4's worst bugs spanned two tasks and survived ten clean per-task reviews. Read it end to end.

- [ ] **Step 5: Every gate, then the PR**

```bash
npm run typecheck && npx vitest run && npm run check:bundle && npm run verify:layout
git push -u origin fix/seat-id-space
gh pr create --title "The game supplies the lobby's seat-id space" --body "Closes #13 …"
```

The PR body should say what the by-hand pass observed, name the two-host bug this change would have introduced if written naively, and state plainly that **capacity is new behaviour** — the server previously had no player limit.

---

## Deferred — not in this plan

- **`LobbyView`** is step 5. Capacity lands here because the seat space defines it; exposing empty seats to a consumer is that step's job.
- **Rail Baron's colour seats.** This makes them possible; it does not add them. Rail Baron has no server yet.
- **The `RoomRefused` dead end** ([#14](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/14)) is untouched, though a full room now joins "unknown room" as a way to reach that screen.
