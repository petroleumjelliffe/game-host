# A person across devices: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installed app on an iPhone can sign in with an email address and then see, resume, and claim every game that address is seated in or invited to, and receive push invites there.

**Architecture:** The notify service derives a *person* from a confirmed address (no new record), and gains `me` (restore), `acceptInvite` (claim by stored hash), `signOut`, a device-aware confirmation with a button page, and person expansion in every fan-out. The shared notify client gains the matching calls; the word game's home page restores seats into its identity store before listing, shows sign-in and invite cards, and its settings sheet gains an email toggle and sign out.

**Tech Stack:** TypeScript, Express, vitest (node for the service and routes, jsdom for the client), React 18 with react-router 7, testing-library.

**Spec:** [specs/2026-09-09-person-identity-and-app-signin.md](../../specs/2026-09-09-person-identity-and-app-signin.md) — read it first; every task below cites it.

## Global Constraints

- Address comparison is case-folded (`toLowerCase()`); dots and plus-suffixes are never stripped.
- A person is the asking profile plus every profile whose email record is `confirmed` **or `disabled`** on the same address. `disabled` is an address that was confirmed and then unsubscribed; unsubscribing must not sign a device out. `pending` never links.
- `POST /notify/me` answers only for the asking key; no lookup by profile id or address; nothing in its payload may be logged.
- Every fire-and-forget send goes through `track()` so `close()` drains it.
- The notify client package's `importBoundary.test.ts` pins an exact count of 13 files under `packages/notify/client/`. **Add no files there**; add functions to existing files.
- The word game's `src/**/*.test.{ts,tsx}` run under jsdom with `src/test/setup.ts`, which stubs `BASE_URL` to `/wordgame`. Node-side tests in `packages/notify` use vitest globals (no `import { test } from 'vitest'`).
- Copy rules from the spec: the control is called **"Sign in"**; sign out cleans the device; email-off is a toggle that leaves the device signed in.
- Run per-package tests with `npx vitest run --root <package>`; the whole suite with `npm test`; types with `npm run typecheck`; lint with `npm run lint`.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work happens on a branch, finished as a PR, never merged locally to `main`.

---

### Task 1: The join-with-code page routes to the chooser (its own PR)

The prerequisite from the spec. Land this on its own branch and PR before starting Task 2.

**Files:**
- Modify: `games/wordgame/src/pages/JoinRoomPage.tsx`
- Modify: `games/wordgame/src/game/lobby/JoinRoomCard.tsx`
- Test: `games/wordgame/src/pages/JoinRoomPage.test.tsx`

**Interfaces:**
- Produces: `JoinRoomCard` props lose `name`, `onNameChange`, `busy`, `error`. `JoinRoomPage` no longer takes `connect`.

- [ ] **Step 1: Write the failing test**

Replace the file's contents:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { JoinRoomPage } from './JoinRoomPage';

function RoomMarker() {
  const { roomId } = useParams();
  return <div>room:{roomId}</div>;
}

function renderJoin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/online/join" element={<JoinRoomPage />} />
        <Route path="/room/:roomId" element={<RoomMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JoinRoomPage', () => {
  it('prefills the code from the query string', () => {
    renderJoin('/online/join?code=ktwq');
    expect(screen.getByLabelText('Room code')).toHaveValue('KTWQ');
  });

  it('leaves the code blank when the query string has none', () => {
    renderJoin('/online/join');
    expect(screen.getByLabelText('Room code')).toHaveValue('');
  });

  // The page never joins. A started room refuses a fresh join with "that
  // seat is no longer yours", which is what an installed app with no
  // stored seat used to see (2026-09-09). The room page's chooser owns
  // both "Sit here" and "That's me"; this page only gets you there.
  it('submitting a code navigates to the room rather than joining', () => {
    renderJoin('/online/join');
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'abc123' } });
    fireEvent.submit(screen.getByLabelText('Room code').closest('form')!);
    expect(screen.getByText('room:ABC123')).toBeInTheDocument();
  });

  it('has no name field — the lobby asks after you sit', () => {
    renderJoin('/online/join');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root games/wordgame src/pages/JoinRoomPage.test.tsx`
Expected: the last two tests fail (`room:ABC123` not found; `Your name` present).

- [ ] **Step 3: Rewrite the page**

`games/wordgame/src/pages/JoinRoomPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JoinRoomCard } from '../game/lobby/JoinRoomCard';

/**
 * A code box and a button. It never joins: the room page's chooser
 * (PreJoin) is where a seat is taken or reclaimed, and it needs the
 * roster to offer either. Sending a fresh join from here refused every
 * started room — the "seat taken" an installed app saw on 2026-09-09.
 */
export function JoinRoomPage() {
  const navigate = useNavigate();
  // A room link (`?code=`) prefills the box. Uppercased immediately: the
  // code is generated from an uppercase alphabet, so a lowercase link
  // should look exactly like typing it in.
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());

  return (
    <JoinRoomCard
      code={code}
      onCodeChange={setCode}
      onLeave={() => navigate('/')}
      onSubmit={() => { navigate(`/room/${code.trim().toUpperCase()}`); }}
    />
  );
}
```

`games/wordgame/src/game/lobby/JoinRoomCard.tsx`:

```tsx
// src/game/lobby/JoinRoomCard.tsx
// The Join Room state of the lobby card: you type the code into the same block
// the host reads it from. Submitting goes to the room, whose chooser shows
// who is there and offers "Sit here" or "That's me" — so no name is asked
// here; the lobby asks after you sit.

import { LobbyCard } from './LobbyCard';

export interface JoinRoomCardProps {
  code: string;
  onCodeChange: (next: string) => void;
  onSubmit: () => void;
  onLeave: () => void;
}

export function JoinRoomCard({ code, onCodeChange, onSubmit, onLeave }: JoinRoomCardProps) {
  const ready = code.trim() !== '';

  return (
    <LobbyCard
      title="Join room"
      subtitle="Enter or paste the room code"
      code={code}
      onCodeChange={onCodeChange}
      seatNote={(
        <p className="text-center text-xs text-ink-ghost">
          Already sat here before? The code takes you straight back in.
        </p>
      )}
      onLeave={onLeave}
      onSubmit={() => { if (ready) onSubmit(); }}
      primary={
        <button
          type="submit"
          disabled={!ready}
          className="m-0 w-full rounded-xl bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-bold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)] disabled:cursor-not-allowed disabled:bg-chipbg disabled:text-ink-ghost"
        >
          {ready ? 'Open room' : 'Join'}
        </button>
      }
    />
  );
}
```

If `LobbyCard` requires `children`, pass `{null}`; check `games/wordgame/src/game/lobby/LobbyCard.tsx` for the prop's optionality and its `note` prop (now unused here). Check `App.tsx` still compiles (`<JoinRoomPage />` takes no props).

- [ ] **Step 4: Run the game's tests and typecheck**

Run: `npx vitest run --root games/wordgame && npx tsc --noEmit -p games/wordgame`
Expected: all pass. If a LobbyCard test referenced the name row through JoinRoomCard, update it.

- [ ] **Step 5: Commit, push, PR**

```bash
git checkout -b claude/join-page-routes-to-chooser main
git add games/wordgame/src/pages/JoinRoomPage.tsx games/wordgame/src/pages/JoinRoomPage.test.tsx games/wordgame/src/game/lobby/JoinRoomCard.tsx
git commit -m "wordgame: join-with-code routes to the room's chooser instead of joining"
git push -u origin claude/join-page-routes-to-chooser
gh pr create --title "wordgame: join-with-code routes to the room's chooser" --body "The join-with-code page sent a fresh-seat join, which every started room refuses; an installed app with no stored seat saw that as 'seat taken' (2026-09-09). The page now only navigates to the room, whose chooser offers Sit here and That's me. The name field goes: the lobby asks after you sit. Prerequisite for specs/2026-09-09-person-identity-and-app-signin.md."
```

Then start the main branch for the rest: `git checkout -b claude/person-identity main` (the remaining tasks assume the Task 1 PR merges first; if it has not, branch from it instead).

---

### Task 2: The person, and `me()` restore

**Files:**
- Modify: `packages/notify/service.ts` (interface ~line 172; implementation near `redeemSeatKey` ~line 1405; helpers near `confirmedAddresses` ~line 653)
- Test: `packages/notify/person.test.ts` (new; node)

**Interfaces:**
- Produces on `NotifyService`:
  ```ts
  interface MineSeat { game: string; roomId: string; playerId: string; token: string; name: string }
  interface MineInvite { game: string; roomId: string; playerId: string; inviterName: string | null; gameTitle: string }
  interface MineView { address: string | null; seats: MineSeat[]; invites: MineInvite[] }
  me(playerKey: string): MineView;
  ```
- Produces inside the service closure: `personProfileIds(profileId: string): string[]` and `personAddress(profileId): string | null` (Tasks 3, 4, 5 use them).

- [ ] **Step 1: Write the failing tests**

Create `packages/notify/person.test.ts`. The fixture is the one from `invites.test.ts` (copy `fakeGame`, `makeFixture`, `drain`, `seatAndBind` verbatim from that file's lines 1–158; do not import them — it exports nothing), with three changes:

- `makeFixture(dir?: string, log?: (line: string) => void)` passes `log ?? (() => {})` to `createNotifyService`.
- `seatAndBind` **returns** the seat it made (`return seat;` at the end, typed `{ playerId: string; token: string }`), because the fake game's `seat()` appends a *second* seat entry if called twice for one player id, and the tests below need the host's token for `invite()`.
- Add `function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }`.

Then:

```ts
const SAFARI = 'safari-key-0123456789abcdef';
const APP = 'app-key-0123456789abcdefghi';
const OTHER = 'other-key-0123456789abcdef';

/** Confirm `address` on `key`'s profile through the real flow. */
async function confirm(f: Fixture, key: string, address: string): Promise<void> {
  expect(await f.service.submitEmail(key, address)).toBe('confirmationSent');
  const mail = [...f.email.sent].reverse().find((m) => m.kind === 'confirmation' && m.to === address)!;
  const token = new URL(mail.url).searchParams.get('token')!;
  expect(f.service.confirmEmail(token)).toBe('confirmed');
}

describe('me: the person derived from a confirmed address', () => {
  test('a lone profile with no address is its own person: its bindings, null address', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    const mine = f.service.me(SAFARI);
    expect(mine.address).toBeNull();
    expect(mine.seats).toEqual([
      { game: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: 'token-p1-ROOM1', name: 'Seat p1' },
    ]);
    expect(mine.invites).toEqual([]);
  });

  test('two profiles confirmed on one address, in differing case, are one person', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'Pete@Example.com');
    await confirm(f, APP, 'pete@example.com');
    // The app profile holds no bindings of its own and still sees the seat.
    const mine = f.service.me(APP);
    expect(mine.address).toBe('pete@example.com');
    expect(mine.seats.map((s) => s.roomId)).toEqual(['ROOM1']);
  });

  test('a pending address links nothing', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    expect(await f.service.submitEmail(APP, 'pete@example.com')).toBe('confirmationSent');
    expect(f.service.me(APP).seats).toEqual([]);
  });

  test('an unsubscribed address still links: "stop mailing me" is not "sign me out"', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    // The unsubscribe token rides every turn mail; drive one turn to get it.
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    const turn = f.email.sent.find((m) => m.kind === 'turn')!;
    const token = new URL(turn.unsubscribeUrl!).searchParams.get('token')!;
    expect(f.service.unsubscribeEmail(token)).toBe(true);
    expect(f.service.settings(SAFARI).email?.status).toBe('disabled');
    expect(f.service.me(APP).seats.map((s) => s.roomId)).toEqual(['ROOM1']);
  });

  test('a departed seat falls out; an unmounted game is skipped', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    f.reporter.seatVacated?.('ROOM1', 'p1');
    expect(f.service.me(SAFARI).seats).toEqual([]);
  });

  test('invites addressed to a profile of the person, or to the address, are listed; revoked ones are not', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    const host1 = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    const host2 = seatAndBind(f, OTHER, 'ROOM2', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host1.token,
      email: 'Pete@example.com',
    });
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM2', playerId: 'p1', token: host2.token,
      email: 'pete@example.com',
    });
    await drain();
    f.reporter.seatVacated?.('ROOM2', 'p2');
    const mine = f.service.me(APP);
    expect(mine.invites).toEqual([
      { game: 'testgame', roomId: 'ROOM1', playerId: 'p2', inviterName: 'Alice', gameTitle: 'Test Game' },
    ]);
  });

  test('the payload never reaches the log', async () => {
    const lines: string[] = [];
    const f = await makeFixture(undefined, (line) => lines.push(line));
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    const mine = f.service.me(SAFARI);
    for (const seat of mine.seats) {
      expect(lines.some((l) => l.includes(seat.token))).toBe(false);
    }
  });
});
```

The unsubscribe test relies on the fixture's `debounceMs: 5` and `isConnected: () => false`, both already in the copied `makeFixture`, so one turn produces one turn mail within the 30ms wait.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/notify person.test.ts`
Expected: type error / `me is not a function`.

- [ ] **Step 3: Implement**

In `service.ts`, add the types after `SettingsView`:

```ts
/** One seat the person holds, with the credentials the client writes to its store. */
export interface MineSeat {
  game: string;
  roomId: string;
  playerId: string;
  token: string;
  name: string;
}

/** One live invite addressed to the person, claimable without its token. */
export interface MineInvite {
  game: string;
  roomId: string;
  playerId: string;
  inviterName: string | null;
  gameTitle: string;
}

export interface MineView {
  /** The asking profile's confirmed address, or null: the person is then the profile alone. */
  address: string | null;
  seats: MineSeat[];
  invites: MineInvite[];
}
```

Add to the `NotifyService` interface, before `settings`:

```ts
  /**
   * Restore: everything the person behind this key holds. The person is
   * derived, never stored — this profile plus every profile confirmed (or
   * once confirmed, now unsubscribed) on the same address. Answers only
   * for the asking key: there is no lookup by profile id or by address.
   * The payload carries every live seat token the person holds, so it is
   * never logged.
   */
  me(playerKey: string): MineView;
```

Add the helpers in the closure, next to `confirmedAddresses`:

```ts
  /** An address that has proven itself once: confirmed, or confirmed then unsubscribed. */
  function proven(record: EmailRecord | undefined): record is EmailRecord {
    return record !== undefined && (record.status === 'confirmed' || record.status === 'disabled');
  }

  /** The person's address key, or null when this profile has no proven address. */
  function personAddress(profileId: string): string | null {
    const record = profiles.get(profileId)?.email;
    return proven(record) ? record.address.toLowerCase() : null;
  }

  /**
   * The person (spec §"The person, derived rather than stored"): this
   * profile plus every profile proven on the same address. Phase B adds an
   * explicit device link to this union; nothing else may assume an
   * address is the only way in.
   */
  function personProfileIds(profileId: string): string[] {
    const out = [profileId];
    const wanted = personAddress(profileId);
    if (wanted === null) return out;
    for (const other of profiles.values()) {
      if (other.profileId === profileId) continue;
      if (proven(other.email) && other.email.address.toLowerCase() === wanted) out.push(other.profileId);
    }
    return out;
  }
```

`EmailRecord` needs importing from `./records.js` as a type if it is not already. Then the method, next to `redeemSeatKey`:

```ts
    me(playerKey): MineView {
      const profileId = profileIdFor(playerKey);
      const person = new Set(personProfileIds(profileId));
      const self = profiles.get(profileId);
      const address = self?.email?.status === 'confirmed' ? self.email.address : null;

      const seats: MineSeat[] = [];
      for (const room of rooms.values()) {
        const reg = games.get(room.gameId);
        // Unmounted this boot is not gone: skipped, never dropped.
        if (!reg?.getSeatCredentials) continue;
        for (const [playerId, bound] of Object.entries(room.bindings)) {
          if (!bound.some((id) => person.has(id))) continue;
          const creds = reg.getSeatCredentials(room.roomId, playerId);
          if (!creds) continue; // departed or revoked: the game says so
          seats.push({ game: room.gameId, roomId: room.roomId, ...creds });
        }
      }

      const wanted = personAddress(profileId);
      const invites: MineInvite[] = [];
      for (const record of invitesLive()) {
        const reg = games.get(record.gameId);
        if (!reg) continue;
        const mine =
          record.target.kind === 'profile'
            ? record.target.profileIds.some((id) => person.has(id))
            : wanted !== null && record.target.address.toLowerCase() === wanted;
        if (!mine) continue;
        invites.push({
          game: record.gameId,
          roomId: record.roomId,
          playerId: record.playerId,
          inviterName: profiles.get(record.inviterProfileId)?.name ?? null,
          gameTitle: reg.title,
        });
      }
      return { address, seats, invites };
    },
```

with one small helper near `saveInvite`:

```ts
  /** Invites that can still be claimed. */
  function* invitesLive(): Iterable<InviteRecord> {
    for (const record of invites.values()) {
      if (record.claimedAt === undefined && record.revokedAt === undefined) yield record;
    }
  }
```

- [ ] **Step 4: Run the notify suite**

Run: `npx vitest run --root packages/notify`
Expected: all pass, including the new file.

- [ ] **Step 5: Commit**

```bash
git add packages/notify/service.ts packages/notify/person.test.ts
git commit -m "notify: the person derived from a proven address, and me() restore"
```

---

### Task 3: `acceptInvite` claims by stored hash

**Files:**
- Modify: `packages/notify/service.ts` (`claimInvite` ~line 1273)
- Test: `packages/notify/person.test.ts`

**Interfaces:**
- Produces: `acceptInvite(playerKey: string, gameId: string, roomId: string): (SeatCredentials & { inviterName: string | null }) | null` on `NotifyService`.

- [ ] **Step 1: Write the failing tests**

Append to `person.test.ts`:

```ts
describe('acceptInvite: claim by the hash the server holds', () => {
  async function invitedRoom(f: Fixture): Promise<void> {
    f.game.addRoom('ROOM1');
    const host = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host.token,
      email: 'pete@example.com',
    });
    await drain();
  }

  test('claims the pending seat, binds the asking profile, and answers credentials', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    const creds = f.service.acceptInvite(APP, 'testgame', 'ROOM1');
    expect(creds).toMatchObject({ playerId: 'p2', inviterName: 'Alice' });
    expect(f.game.pendingIn('ROOM1')).toEqual([]);
    // Bound: restore now lists it as a seat, and the invite is gone.
    const mine = f.service.me(APP);
    expect(mine.seats.map((s) => s.playerId)).toEqual(['p2']);
    expect(mine.invites).toEqual([]);
  });

  test('a second accept, and an accept by someone it was not for, are one shaped null', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    expect(f.service.acceptInvite(SAFARI, 'testgame', 'ROOM1')).toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).not.toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).toBeNull();
  });

  test('an invite claimed by link in Safari first refuses the app, whose restore then shows the seat', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    const mail = f.email.sent.find((m) => m.kind === 'invite')!;
    const token = mail.url.split('invite=')[1]!;
    expect(f.service.claimInvite(token, SAFARI)).not.toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).toBeNull();
    // Safari's claim confirmed the address on its profile, so the app is linked.
    expect(f.service.me(APP).seats.map((s) => s.playerId)).toEqual(['p2']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/notify person.test.ts`
Expected: `acceptInvite is not a function`.

- [ ] **Step 3: Implement**

Extract the tail of `claimInvite` into a closure helper so both paths share it. Replace `claimInvite` with:

```ts
    claimInvite(inviteToken, playerKey) {
      if (typeof inviteToken !== 'string' || inviteToken.length < 16) return null;
      const record = invites.get(sha256hex(inviteToken));
      // One shaped null: unknown, revoked, already claimed, dead room.
      if (!record || record.claimedAt !== undefined || record.revokedAt !== undefined) return null;
      return finishClaim(record, playerKey !== undefined && isPlayerKey(playerKey) ? playerKey : null);
    },

    acceptInvite(playerKey, gameId, roomId) {
      if (!GAME_ID.test(gameId) || !ROOM_ID.test(roomId)) return null;
      const person = new Set(personProfileIds(profileIdFor(playerKey)));
      const wanted = personAddress(profileIdFor(playerKey));
      for (const record of invitesLive()) {
        if (record.gameId !== gameId || record.roomId !== roomId) continue;
        const mine =
          record.target.kind === 'profile'
            ? record.target.profileIds.some((id) => person.has(id))
            : wanted !== null && record.target.address.toLowerCase() === wanted;
        if (mine) return finishClaim(record, playerKey);
      }
      return null;
    },
```

and add, near `addBinding`:

```ts
  /**
   * The claim itself, shared by the emailed link (`claimInvite`) and the
   * in-app accept: convert the pending seat, stamp the record, and — with
   * a key — confirm an emailed address and bind the claiming device.
   */
  function finishClaim(
    record: InviteRecord,
    playerKey: string | null,
  ): (SeatCredentials & { inviterName: string | null }) | null {
    const reg = games.get(record.gameId);
    const creds = reg?.claimSeat?.(record.roomId, record.tokenHash) ?? null;
    if (!creds) return null;
    record.claimedAt = now();
    saveInvite(record);
    if (playerKey !== null) {
      const profile = profileFor(playerKey);
      // For an email invite, claiming IS the double-opt-in: at least as
      // strong a consent signal as a confirm click. Never clobbers an
      // address the profile already carries.
      if (
        record.target.kind === 'email' &&
        (profile.email === undefined || profile.email.address === record.target.address)
      ) {
        profile.email = {
          address: record.target.address,
          status: 'confirmed',
          unsubscribeToken: profile.email?.unsubscribeToken ?? newToken(),
        };
      }
      saveProfile(profile);
      // Bind the claiming device — lobby phase: the ledger waits for the
      // game to start.
      const key = roomKey(record.gameId, record.roomId);
      let room = rooms.get(key);
      if (!room) {
        room = { key, gameId: record.gameId, roomId: record.roomId, savedAt: now(), bindings: {}, lastNotified: {} };
        rooms.set(key, room);
      }
      if (addBinding(room, creds.playerId, profile.profileId)) saveRoom(room);
    }
    return { ...creds, inviterName: profiles.get(record.inviterProfileId)?.name ?? null };
  }
```

Add to the interface after `claimInvite`:

```ts
  /**
   * The in-app accept (spec §Accept): claim one of the person's live
   * invites for this room by the hash the server already stores. Same
   * shaped null for every failure, including "someone linked to you
   * claimed it by link a moment ago" — the client re-runs `me` on null.
   */
  acceptInvite(
    playerKey: string,
    gameId: string,
    roomId: string,
  ): (SeatCredentials & { inviterName: string | null }) | null;
```

- [ ] **Step 4: Run the notify suite**

Run: `npx vitest run --root packages/notify`
Expected: all pass (`invites.test.ts` still passes: `claimInvite` behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/notify/service.ts packages/notify/person.test.ts
git commit -m "notify: acceptInvite claims a person's invite by stored hash"
```

---

### Task 4: Fan-out addresses the person

**Files:**
- Modify: `packages/notify/service.ts` (`seatTargets` ~line 544, `deliverInvite` ~line 730)
- Test: `packages/notify/person.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe('fan-out reaches the person, not only the bound profile', () => {
  test('a turn: one push to the linked app profile, one email to the address — never two mails', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    // Safari holds the seat and the address; the app is linked and holds push.
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    f.email.sent.length = 0;
    f.push.sent.length = 0;
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/app']);
    expect(f.email.sent.filter((m) => m.kind === 'turn')).toHaveLength(1);
  });

  test('an invite to a contact holding only the Safari profile pushes to the app profile', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    // A shared game makes Pete a contact of Alice's, via the Safari profile.
    // The ledger writes on a playing-phase bind and records the OTHER
    // profiles bound at that moment, so Pete binds first and Alice second;
    // if `contacts(OTHER)` comes back empty, look at `writeLedger` in
    // service.ts and bind Alice again after Pete.
    seatAndBind(f, SAFARI, 'ROOM1', 'p2', 'Pete');
    seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    const contact = f.service.contacts(OTHER).find((c) => c.name === 'Pete')!;
    const host = seatAndBind(f, OTHER, 'ROOM2', 'p1', 'Alice');
    f.push.sent.length = 0;
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM2', playerId: 'p1', token: host.token,
      contactId: contact.contactId,
    });
    await drain();
    expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/app']);
    expect(f.push.sent[0]?.payload).toMatchObject({ kind: 'invite', roomId: 'ROOM2' });
  });

  test('an invite by email to a proven address also pushes to its profiles', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    f.push.sent.length = 0;
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host.token,
      email: 'pete@example.com',
    });
    await drain();
    expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/app']);
    expect(f.email.sent.filter((m) => m.kind === 'invite')).toHaveLength(1);
  });
});
```

Check how `contacts()` shapes a `ContactView` (grep `interface ContactView` in service.ts) and adjust the `find` if the name field differs.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/notify person.test.ts`
Expected: the three new tests fail (no push to the app endpoint).

- [ ] **Step 3: Implement**

Add a helper next to `personProfileIds`:

```ts
  /** The profiles behind a set of profile ids, expanded to their persons, each once. */
  function personProfiles(profileIds: readonly string[]): ProfileRecord[] {
    const seen = new Set<string>();
    const out: ProfileRecord[] = [];
    for (const id of profileIds) {
      for (const member of personProfileIds(id)) {
        if (seen.has(member)) continue;
        seen.add(member);
        const profile = profiles.get(member);
        if (profile) out.push(profile);
      }
    }
    return out;
  }
```

Replace `seatTargets`:

```ts
  /**
   * Everyone bound to the seat, expanded to their persons: a seat bound
   * only in Safari still pushes to the installed app linked to the same
   * address. Email is deduped by address downstream, so the linked,
   * unbound profile costs one push and no second mail.
   */
  function seatTargets(room: RoomRecord, playerId: string): ProfileRecord[] {
    return personProfiles(room.bindings[playerId] ?? []);
  }
```

In `deliverInvite`, the `email` branch becomes:

```ts
    if (record.target.kind === 'email') {
      if (!email || !emailUsable) return;
      const jobs: Promise<void>[] = [];
      // A proven address has profiles behind it, and the installed app
      // among them can only be reached by push (spec §Fan-out).
      for (const profile of profilesProvenOn(record.target.address)) {
        jobs.push(sendPush(profile, payload, { gameId: reg.gameId, fallbackToAnyScope: true }));
      }
      jobs.push(
        email.sendInvite(record.target.address, payload, roomUrl).catch((error: unknown) => {
          log(`! Invite email failed: ${String(error)}`);
        }),
      );
      await Promise.allSettled(jobs);
      return;
    }
```

with:

```ts
  function profilesProvenOn(address: string): ProfileRecord[] {
    const wanted = address.toLowerCase();
    return [...profiles.values()].filter(
      (p) => proven(p.email) && p.email.address.toLowerCase() === wanted,
    );
  }
```

and the profile branch's loop header becomes `for (const profile of personProfiles(record.target.profileIds)) {` (drop the `profiles.get` / `if (!profile) continue;` pair).

Note `emailEligible` still gates the mail leg; keep the first-contact comment about the unsubscribe link.

- [ ] **Step 4: Run the notify suite**

Run: `npx vitest run --root packages/notify`
Expected: all pass. If `service.test.ts` counts pushes per seat, confirm none of its fixtures confirm the same address on two profiles (they use one `KEY`), so counts are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/notify/service.ts packages/notify/person.test.ts
git commit -m "notify: every fan-out expands bound profiles to their person"
```

---

### Task 5: `signOut`

**Files:**
- Modify: `packages/notify/service.ts`
- Test: `packages/notify/person.test.ts`

**Interfaces:**
- Produces: `signOut(playerKey: string): void` on `NotifyService`.

- [ ] **Step 1: Write the failing test**

```ts
describe('signOut', () => {
  test('drops the address and every binding, keeps push and prefs; a second call is a no-op', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    seatAndBind(f, APP, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, APP, 'ROOM2', 'p1', 'Pete');
    seatAndBind(f, OTHER, 'ROOM1', 'p2', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    f.service.setPrefs(APP, { email: false });

    f.service.signOut(APP);
    const settings = f.service.settings(APP);
    expect(settings.email).toBeNull();
    expect(settings.prefs).toEqual({ push: true, email: false });
    expect(settings.pushEndpoints).toEqual([`https://push.test/${APP}`]);
    expect(f.service.me(APP).seats).toEqual([]);
    // The other person's binding on the same room is untouched.
    expect(f.service.me(OTHER).seats.map((s) => s.playerId)).toEqual(['p2']);
    // No turn reaches the signed-out device.
    f.push.sent.length = 0;
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    expect(f.push.sent).toEqual([]);

    expect(() => f.service.signOut(APP)).not.toThrow();
    expect(() => f.service.signOut('never-seen-key-0123456789')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/notify person.test.ts`
Expected: `signOut is not a function`.

- [ ] **Step 3: Implement**

Interface, after `removeEmail`:

```ts
  /**
   * Sign out (spec §Sign out): the address goes and so does every seat
   * binding, so the device stops receiving turns for seats it no longer
   * holds. Push subscriptions and prefs stay — they are the device's, and
   * signing in again must not re-ask for permission. Per device only.
   */
  signOut(playerKey: string): void;
```

Implementation, after `removeEmail`:

```ts
    signOut(playerKey): void {
      const profileId = profileIdFor(playerKey);
      const profile = profiles.get(profileId);
      if (!profile) return;
      if (profile.email) {
        delete profile.email;
        saveProfile(profile);
      }
      for (const room of rooms.values()) {
        let changed = false;
        for (const [playerId, bound] of Object.entries(room.bindings)) {
          if (!bound.includes(profileId)) continue;
          const rest = bound.filter((id) => id !== profileId);
          if (rest.length === 0) delete room.bindings[playerId];
          else room.bindings[playerId] = rest;
          changed = true;
        }
        if (changed) saveRoom(room);
      }
    },
```

- [ ] **Step 4: Run the notify suite**

Run: `npx vitest run --root packages/notify`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/notify/service.ts packages/notify/person.test.ts
git commit -m "notify: signOut drops the address and every binding, keeps the device's push"
```

---

### Task 6: Confirming signs in a device — record, mail, and the button page

**Files:**
- Modify: `packages/notify/records.ts` (`EmailRecord` line 33)
- Modify: `packages/notify/channels.ts` (`EmailSender.sendConfirmation` line 51)
- Modify: `packages/notify/email.ts` (`sendConfirmation` line 35)
- Modify: `packages/notify/testChannels.ts` (`RecordedEmail`, `sendConfirmation`)
- Modify: `packages/notify/service.ts` (`submitEmail` ~line 1031, `confirmEmail` ~line 1075)
- Modify: `packages/notify/routes.ts` (`POST /email` line 302, `GET /confirm` line 335)
- Test: `packages/notify/emailFlow.test.ts`, `packages/notify/routes.test.ts`

**Interfaces:**
- Produces: `type ConfirmDevice = 'app' | 'browser'` (records.ts); `submitEmail(playerKey, address, device?: ConfirmDevice)`; `confirmationDetails(token): { address: string; device: ConfirmDevice | null; requestedAt: number } | 'expired' | 'invalid'`; `EmailSender.sendConfirmation(to, confirmUrl, context: { device: ConfirmDevice | null; requestedAt: number })`; `POST /notify/confirm` (form-encoded `token`) confirms, `GET` only shows the page.

- [ ] **Step 1: Write the failing tests**

In `emailFlow.test.ts` add:

```ts
test('the confirmation carries which device asked, and the page can read it back before confirming', async () => {
  expect(await service.submitEmail(KEY, 'pete@example.com', 'app')).toBe('confirmationSent');
  const mail = email.sent[0]!;
  expect(mail.kind).toBe('confirmation');
  expect(mail.device).toBe('app');
  expect(mail.requestedAt).toBe(clock.now);
  const token = tokenFromLink(mail.url);
  expect(service.confirmationDetails(token)).toEqual({
    address: 'pete@example.com', device: 'app', requestedAt: clock.now,
  });
  expect(service.confirmEmail(token)).toBe('confirmed');
  expect(service.confirmationDetails(token)).toBe('invalid');
});

test('no device given reads as null, not browser', async () => {
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(email.sent[0]?.device).toBeNull();
});
```

In `routes.test.ts`, replace the body of `'the email flow works over the wire, links included'` from the `const confirm = …` line on:

```ts
  // GET shows the page and confirms nothing: the click now signs in a
  // device, and a mail scanner that prefetches links must not do that.
  const shown = await fetch(`${base}/confirm?token=${token}`);
  expect(shown.status).toBe(200);
  const html = await shown.text();
  expect(html).toContain('Sign in this device');
  expect(html).toContain('pete@example.com');
  expect(html).toContain('a browser');
  expect((await post('/settings', { playerKey: KEY })).ok).toBe(true);
  expect(((await (await post('/settings', { playerKey: KEY })).json()) as { email: { status: string } }).email.status).toBe('pending');
  // POST confirms.
  const confirm = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(token)}`,
  });
  expect(confirm.status).toBe(200);
  expect(await confirm.text()).toContain('Signed in');
  // Single use.
  const again = await fetch(`${base}/confirm?token=${token}`);
  expect(again.status).toBe(404);
```

and add:

```ts
test('an app asking to sign in gets an app-flavoured mail and a go-back-to-the-app page', async () => {
  expect((await post('/email', { playerKey: KEY, email: 'pete@example.com', device: 'app' })).status).toBe(200);
  expect(email.sent[0]?.device).toBe('app');
  const token = new URL(email.sent[0]?.url ?? '').searchParams.get('token') ?? '';
  expect(await (await fetch(`${base}/confirm?token=${token}`)).text()).toContain('the installed app');
  const confirm = await fetch(`${base}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(token)}`,
  });
  expect(await confirm.text()).toContain('Go back to the app');
});

test('a device value that is neither app nor browser is a bad request', async () => {
  expect((await post('/email', { playerKey: KEY, email: 'pete@example.com', device: 'toaster' })).status).toBe(400);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root packages/notify emailFlow.test.ts routes.test.ts`
Expected: type errors on `device`, `confirmationDetails`; the wire test fails at `Sign in this device`.

- [ ] **Step 3: Implement the record and channel**

`records.ts`, in `EmailRecord`:

```ts
export type ConfirmDevice = 'app' | 'browser';

export interface EmailRecord {
  address: string;
  status: EmailStatus;
  /** Single-use confirmation token; present only while `pending`. */
  confirmToken?: string;
  confirmExpiry?: number;
  /**
   * What asked, and when — shown in the mail and on the confirm page,
   * because confirming now signs that device in. Present only while
   * `pending`; discarded on confirm.
   */
  device?: ConfirmDevice;
  requestedAt?: number;
  /** Minted at confirmation; the one-click unsubscribe link, no login required. */
  unsubscribeToken?: string;
  /** Confirmation-send rate limit: at most 3 per address per UTC day. */
  sendDay?: string;
  sendCount?: number;
}
```

`channels.ts`:

```ts
import type { ConfirmDevice, PushSubscriptionRecord } from './records.js';

export interface ConfirmationContext {
  device: ConfirmDevice | null;
  requestedAt: number;
}

export interface EmailSender {
  /**
   * The confirmation mail. Confirming signs the asking device in (spec
   * §Confirming now signs in a device), so the mail must say what asked
   * and when, and tell the reader to ignore it if that was not them.
   */
  sendConfirmation(to: string, confirmUrl: string, context: ConfirmationContext): Promise<void>;
  …
```

`email.ts` `sendConfirmation`:

```ts
    async sendConfirmation(to: string, confirmUrl: string, context: ConfirmationContext): Promise<void> {
      const what = describeDevice(context.device);
      const when = new Date(context.requestedAt).toUTCString();
      await transport.sendMail({
        from,
        to,
        subject: 'Confirm your email to sign in',
        text:
          `${what} asked to sign in as this address at ${when}.\n\n` +
          `Confirming signs that device in: it will see every game this address is seated in, ` +
          `and it's-your-turn emails will come here.\n\n` +
          `Confirm within 24 hours:\n${confirmUrl}\n\n` +
          `If this wasn't you, ignore this email — nothing is signed in and nothing further will be sent.`,
        html:
          `<p>${what} asked to sign in as this address at ${escapeHtml(when)}.</p>` +
          `<p>Confirming signs that device in: it will see every game this address is seated in, ` +
          `and it's-your-turn emails will come here.</p>` +
          `<p><a href="${escapeHtml(confirmUrl)}">Confirm and sign in</a> (link lasts 24 hours).</p>` +
          `<p>If this wasn't you, ignore this email — nothing is signed in and nothing further will be sent.</p>`,
      });
    },
```

with, at module level in `email.ts` and **exported** (the router reuses it):

```ts
/** The device kind, as a sentence subject. */
export function describeDevice(device: ConfirmDevice | null): string {
  return device === 'app' ? 'The installed app on a phone' : device === 'browser' ? 'A browser' : 'A device';
}
```

`testChannels.ts`: add `device?: ConfirmDevice | null; requestedAt?: number;` to `RecordedEmail` and make the fake's `sendConfirmation(to, confirmUrl, context)` push `{ kind: 'confirmation', to, url: confirmUrl, device: context.device, requestedAt: context.requestedAt }`.

Wait: `describeDevice` in `email.ts` sits beside `nodemailer`'s dynamic import; the router importing it is fine (the import is dynamic and inside `emailSenderFromEnv`). If eslint or the bundle complains, move `describeDevice` to `records.ts` instead.

- [ ] **Step 4: Implement the service**

`submitEmail(playerKey, rawAddress, device)`: the record write becomes

```ts
      profile.email = {
        address,
        status: 'pending',
        confirmToken,
        confirmExpiry: now() + CONFIRM_TTL_MS,
        ...(device === undefined ? {} : { device }),
        requestedAt: now(),
        sendDay: day,
        sendCount: sendCount + 1,
      };
      saveProfile(profile);
      const confirmUrl = `${origin}/notify/confirm?token=${confirmToken}`;
      try {
        await email.sendConfirmation(address, confirmUrl, { device: device ?? null, requestedAt: now() });
```

(use one `const at = now()` for both). Interface: `submitEmail(playerKey: string, address: string, device?: ConfirmDevice): Promise<EmailSubmitResult>;`.

`confirmEmail`: after `delete record.confirmExpiry;` add `delete record.device; delete record.requestedAt;`.

Add `confirmationDetails`:

```ts
  /**
   * What the confirm page shows before the button: the address and what
   * asked. Same answers as `confirmEmail` for a dead token, so the page
   * and the button never disagree.
   */
  confirmationDetails(
    token: string,
  ): { address: string; device: ConfirmDevice | null; requestedAt: number } | 'expired' | 'invalid';
```

```ts
    confirmationDetails(token) {
      if (typeof token !== 'string' || token.length < 16) return 'invalid';
      for (const profile of profiles.values()) {
        const record = profile.email;
        if (!record || record.status !== 'pending' || record.confirmToken !== token) continue;
        if (record.confirmExpiry !== undefined && now() > record.confirmExpiry) return 'expired';
        return { address: record.address, device: record.device ?? null, requestedAt: record.requestedAt ?? 0 };
      }
      return 'invalid';
    },
```

- [ ] **Step 5: Implement the routes**

`POST /email`:

```ts
  router.post('/email', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const address = asString(b.email);
    const device = b.device;
    if (!playerKey || address === null || (device !== undefined && device !== 'app' && device !== 'browser')) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service
      .submitEmail(playerKey, address, device)
      …
```

Replace `GET /confirm` with a GET that shows and a POST that confirms:

```ts
  // Confirming signs a device in (spec §Confirming now signs in a device),
  // so the emailed link only SHOWS; a button POSTs. A mail scanner that
  // prefetches links can no longer confirm on the person's behalf.
  router.get('/confirm', (req, res) => {
    const token = asString(req.query.token);
    const details = token === null ? 'invalid' : service.confirmationDetails(token);
    if (details === 'expired') {
      page(res, 410, 'Link expired', 'Sign-in links last 24 hours. Ask for a fresh one from the game.');
      return;
    }
    if (details === 'invalid') {
      page(res, 404, 'Link not recognised', 'This link is invalid or was already used.');
      return;
    }
    const what = describeDevice(details.device);
    const when = escapeHtml(new Date(details.requestedAt).toUTCString());
    page(
      res,
      200,
      'Sign in this device?',
      `${what} asked to sign in as <strong>${escapeHtml(details.address)}</strong> at ${when}. ` +
        `Confirming signs that device in: it will see every game this address is seated in, ` +
        `and turn emails will come here.</p>` +
        `<form method="post" action="/notify/confirm">` +
        `<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">` +
        `<button type="submit" style="font:inherit;padding:.6rem 1.2rem">Sign in this device</button>` +
        `</form><p>Not you? Close this page and nothing happens.`,
    );
  });

  router.post('/confirm', express.urlencoded({ extended: false }), (req, res) => {
    const token = asString(body(req).token);
    const details = token === null ? 'invalid' : service.confirmationDetails(token);
    const result = token === null ? 'invalid' : service.confirmEmail(token);
    if (result === 'confirmed') {
      const back = typeof details === 'object' && details.device === 'app'
        ? 'Go back to the app — your games are there now.'
        : 'Go back to the game — your games are there now.';
      page(res, 200, 'Signed in', back);
    } else if (result === 'expired') {
      page(res, 410, 'Link expired', 'Sign-in links last 24 hours. Ask for a fresh one from the game.');
    } else {
      page(res, 404, 'Link not recognised', 'This link is invalid or was already used.');
    }
  });
```

Add a local `escapeHtml` to `routes.ts` (same four replacements as `email.ts`'s) and import `describeDevice`. The `page()` helper wraps `detail` in `<p>…</p>`; the form closes and reopens that paragraph, which is why the string above ends without `</p>`. Keep the "no assets, no scripts" property.

- [ ] **Step 6: Run the notify suite and typecheck**

Run: `npx vitest run --root packages/notify && npx tsc --noEmit -p packages/notify`
Expected: all pass. `apps/host` has an end-to-end test that may confirm an address by `GET` — grep `confirm?token` under `apps/host` and switch any such call to the POST form.

- [ ] **Step 7: Commit**

```bash
git add packages/notify
git commit -m "notify: confirming signs in a device — device on the record, honest mail, button page"
```

---

### Task 7: Routes for `me`, `accept`, `signout`

**Files:**
- Modify: `packages/notify/routes.ts`
- Test: `packages/notify/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('me answers only for a well-formed key, and carries seats and invites', async () => {
  expect((await post('/me', {})).status).toBe(400);
  const res = await post('/me', { playerKey: KEY });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ address: null, seats: [], invites: [] });
});

test('invite/accept refuses malformed input and answers one shape for nothing to accept', async () => {
  expect((await post('/invite/accept', { playerKey: KEY })).status).toBe(400);
  const res = await post('/invite/accept', { playerKey: KEY, game: 'testgame', roomId: 'ROOM1' });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'unavailable' });
});

test('signout is idempotent and answers ok', async () => {
  expect(await (await post('/signout', { playerKey: KEY })).json()).toEqual({ ok: true });
  expect(await (await post('/signout', { playerKey: KEY })).json()).toEqual({ ok: true });
});
```

and extend the malformed-key list: `['/settings', '/subscriptions', '/prefs', '/email', '/email/remove', '/me', '/invite/accept', '/signout']`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root packages/notify routes.test.ts`
Expected: 404s from express for the missing routes.

- [ ] **Step 3: Implement**

After `/redeem-key`:

```ts
  // Restore (spec §Restore). The answer carries every live seat token the
  // person holds: nothing here logs, and nothing else may.
  router.post('/me', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    res.json(service.me(playerKey));
  });

  router.post('/invite/accept', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    if (!playerKey || game === null || roomId === null) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const creds = service.acceptInvite(playerKey, game, roomId);
    if (creds === null) res.status(404).json({ error: 'unavailable' });
    else res.json(creds);
  });

  router.post('/signout', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.signOut(playerKey);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run the notify suite**

Run: `npx vitest run --root packages/notify`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/notify/routes.ts packages/notify/routes.test.ts
git commit -m "notify: /me, /invite/accept and /signout routes"
```

---

### Task 8: The shared client calls

**Files:**
- Modify: `packages/notify/client/api.ts`
- Modify: `packages/notify/client/landing.ts`
- Modify: `packages/notify/client/useNotifyStatus.ts`
- Test: `packages/notify/client/api.test.ts`, `packages/notify/client/useNotifyStatus.test.ts`

**Interfaces:**
- Produces (`api.ts`): `MineSeat`, `MineInvite`, `Mine` types; `fetchMine(playerKey): Promise<Mine | null>`; `signOut(playerKey): Promise<boolean>`; `setEmailPref(playerKey, email: boolean): Promise<boolean>`.
- Produces (`landing.ts`): `acceptInvite(game, roomId): Promise<LandingCredentials | null>` (reads the key itself, like `redeemLanding`).
- Produces (`useNotifyStatus`): the returned object gains `emailConfirmed: boolean`.

- [ ] **Step 1: Write the failing tests**

Look at `api.test.ts` for how it stubs `fetch` and pins URLs, then add in the same style:

```ts
it('fetchMine posts the key to /notify/me and validates the shape', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { address: 'a@b.c', seats: [], invites: [] }));
  expect(await fetchMine('k'.repeat(24))).toEqual({ address: 'a@b.c', seats: [], invites: [] });
  expect(fetchMock).toHaveBeenCalledWith('/notify/me', expect.objectContaining({ method: 'POST' }));
  fetchMock.mockResolvedValueOnce(json(200, { nope: true }));
  expect(await fetchMine('k'.repeat(24))).toBeNull();
});

it('signOut and setEmailPref answer ok as a boolean', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await signOut('k'.repeat(24))).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('/notify/signout', expect.anything());
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
  expect(await setEmailPref('k'.repeat(24), false)).toBe(true);
  expect(fetchMock).toHaveBeenLastCalledWith('/notify/prefs', expect.objectContaining({
    body: JSON.stringify({ playerKey: 'k'.repeat(24), email: false }),
  }));
});
```

(`json(status, body)` mirrors whatever helper `api.test.ts` already has; if none, add `const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });`.)

In `useNotifyStatus.test.ts`, extend the `off / pending / on` test: after the confirmed step add `expect(result.current.emailConfirmed).toBe(true);` and after the pending step `expect(result.current.emailConfirmed).toBe(false);`.

Check `POST /prefs` in `routes.ts` (line 288) for the body it expects (`{ playerKey, push?, email? }`) before pinning the body string.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root packages/notify client/`
Expected: missing exports.

- [ ] **Step 3: Implement**

`api.ts`, append:

```ts
export interface MineSeat { game: string; roomId: string; playerId: string; token: string; name: string }
export interface MineInvite { game: string; roomId: string; playerId: string; inviterName: string | null; gameTitle: string }
export interface Mine { address: string | null; seats: MineSeat[]; invites: MineInvite[] }

function isMine(value: unknown): value is Mine {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.address === null || typeof v.address === 'string') &&
    Array.isArray(v.seats) &&
    v.seats.every((s: unknown) => typeof s === 'object' && s !== null && typeof (s as MineSeat).token === 'string') &&
    Array.isArray(v.invites)
  );
}

/**
 * Restore: the person's seats and invites (spec §Restore). Null means the
 * service is absent or the answer was not the shape — the caller keeps
 * whatever its own store already holds.
 */
export async function fetchMine(playerKey: string): Promise<Mine | null> {
  try {
    const res = await notifyPost('/me', { playerKey });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isMine(body) ? body : null;
  } catch {
    return null;
  }
}

async function okPost(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await notifyPost(path, body);
    return res.ok;
  } catch {
    return false;
  }
}

/** Sign out this device (spec §Sign out). The caller clears its own store afterwards. */
export function signOut(playerKey: string): Promise<boolean> {
  return okPost('/signout', { playerKey });
}

/** The "Email me when it's my turn" toggle: a preference, not a sign-out. */
export function setEmailPref(playerKey: string, email: boolean): Promise<boolean> {
  return okPost('/prefs', { playerKey, email });
}
```

`landing.ts`, append:

```ts
/**
 * The in-app accept (spec §Accept): claim one of the person's invites
 * without its token. Null for every refusal, including "already claimed
 * by a linked device" — re-run restore rather than showing an error.
 */
export async function acceptInvite(game: string, roomId: string): Promise<LandingCredentials | null> {
  try {
    const playerKey = getPlayerKey();
    if (playerKey === null) return null;
    const res = await notifyPost('/invite/accept', { playerKey, game, roomId });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isCredentials(body) ? body : null;
  } catch {
    return null;
  }
}
```

`useNotifyStatus.ts`: add `const [emailConfirmed, setEmailConfirmed] = useState(false);`, set it right after `setEmailAddress(...)` to `settings.email?.status === 'confirmed'`, reset to `false` on the unavailable/null-key paths, and return it.

- [ ] **Step 4: Run the client tests, the boundary test, and typecheck**

Run: `npx vitest run --root packages/notify && npx tsc --noEmit -p packages/notify`
Expected: all pass; `importBoundary.test.ts` still counts 13.

- [ ] **Step 5: Commit**

```bash
git add packages/notify/client
git commit -m "notify client: fetchMine, acceptInvite, signOut, setEmailPref, emailConfirmed"
```

---

### Task 9: The word game restores before it lists

**Files:**
- Modify: `games/wordgame/src/pages/useMyGames.ts`
- Test: `games/wordgame/src/pages/useMyGames.test.ts` (new)

**Interfaces:**
- Produces: `useMyGames(): { games: MyGame[] | null; invites: MineInvite[]; address: string | null; signedInKnown: boolean; refresh(): void }`. `signedInKnown` is true once `/notify/me` has answered at all (false on the standalone dev server), so the home page can tell "not signed in" from "no service".

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const listRoomsMock = vi.fn();
const saveIdentityMock = vi.fn();
const clearIdentityMock = vi.fn();
vi.mock('../net/identity', () => ({
  listRooms: (...a: unknown[]) => listRoomsMock(...a),
  saveIdentity: (...a: unknown[]) => saveIdentityMock(...a),
  clearIdentity: (...a: unknown[]) => clearIdentityMock(...a),
}));
vi.mock('../notify/playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));

import { useMyGames } from './useMyGames';

const fetchMock = vi.fn();

function answer(url: string, body: unknown) {
  fetchMock.mockImplementation((input: string) =>
    Promise.resolve(input === url
      ? ({ ok: true, json: async () => body } as Response)
      : ({ ok: true, json: async () => ({ summaries: [] }) } as Response)),
  );
}

beforeEach(() => {
  listRoomsMock.mockReset().mockReturnValue([]);
  saveIdentityMock.mockReset();
  clearIdentityMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('useMyGames restores before it lists', () => {
  it('writes every restored word-game seat to the store, ignores other games, then lists', async () => {
    answer('/notify/me', {
      address: 'pete@example.com',
      seats: [
        { game: 'wordgame', roomId: 'ABC123', playerId: 'p2', token: 't2', name: 'Pete' },
        { game: 'acquire', roomId: 'ZZZ999', playerId: 'p1', token: 't1', name: 'Pete' },
      ],
      invites: [
        { game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: 'Alice', gameTitle: 'Word Game' },
        { game: 'acquire', roomId: 'INV222', playerId: 'p3', inviterName: 'Bob', gameTitle: 'Acquire' },
      ],
    });
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.signedInKnown).toBe(true); });
    expect(saveIdentityMock).toHaveBeenCalledTimes(1);
    expect(saveIdentityMock).toHaveBeenCalledWith('ABC123', { playerId: 'p2', token: 't2', name: 'Pete' });
    expect(result.current.address).toBe('pete@example.com');
    expect(result.current.invites.map((i) => i.roomId)).toEqual(['INV111']);
    // The summaries call ran after the restore, so listRooms saw the write.
    const order = fetchMock.mock.calls.map((c) => c[0]);
    expect(order.indexOf('/notify/me')).toBeLessThan(order.indexOf('/wordgame/api/summaries'));
  });

  it('with no service, lists from the store and reports sign-in as unknown', async () => {
    fetchMock.mockImplementation((input: string) =>
      Promise.resolve(input === '/notify/me'
        ? ({ ok: false, json: async () => ({}) } as Response)
        : ({ ok: true, json: async () => ({ summaries: [] }) } as Response)));
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.games).toEqual([]); });
    expect(result.current.signedInKnown).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it('restores again when the page becomes visible — the come-back-from-Mail moment', async () => {
    answer('/notify/me', { address: null, seats: [], invites: [] });
    const { result } = renderHook(() => useMyGames());
    await waitFor(() => { expect(result.current.signedInKnown).toBe(true); });
    const before = fetchMock.mock.calls.filter((c) => c[0] === '/notify/me').length;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => c[0] === '/notify/me').length).toBe(before + 1);
    });
  });
});
```

Note `listRooms` returning `[]` short-circuits the summaries fetch today; in the first test make `listRoomsMock` return the restored room after the first `saveIdentity` call: `saveIdentityMock.mockImplementation((roomId, identity) => { listRoomsMock.mockReturnValue([{ roomId, identity }]); });`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root games/wordgame src/pages/useMyGames.test.ts`
Expected: `signedInKnown` undefined; ordering assertion fails.

- [ ] **Step 3: Implement**

```ts
// The entry list: restore first, then list. Restore (spec §Restore) asks
// the notify service for every seat the person behind this device's key
// holds and writes each into the identity store — so a freshly installed
// app that has signed in lists the same games Safari does. Then the
// summaries call runs exactly as before over whatever the store holds.
// Re-run on visibility: the iOS sign-in flow is "leave for Mail, tap the
// link, come back", and a backgrounded app runs no timers.

import { useCallback, useEffect, useState } from 'react';
import { fetchMine, type MineInvite } from '@game-host/notify/client/api';
import { listRooms, clearIdentity, saveIdentity } from '../net/identity';
import { getPlayerKey } from '../notify/playerKey';
import { GAME_ID } from '../notify/gameId';
import type { RoomSummary } from '../../session/protocol';

export interface MyGame {
  roomId: string;
  summary: Extract<RoomSummary, { known: true }>;
}

const summariesUrl = () =>
  `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}api/summaries`;

export function useMyGames(): {
  games: MyGame[] | null;
  invites: MineInvite[];
  address: string | null;
  /** True once /notify/me answered at all; false on the standalone dev server. */
  signedInKnown: boolean;
  refresh(): void;
} {
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [invites, setInvites] = useState<MineInvite[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [signedInKnown, setSignedInKnown] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => { setEpoch((e) => e + 1); }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const playerKey = getPlayerKey();
      const mine = playerKey === null ? null : await fetchMine(playerKey);
      if (cancelled) return;
      if (mine !== null) {
        for (const seat of mine.seats) {
          if (seat.game !== GAME_ID) continue;
          saveIdentity(seat.roomId, { playerId: seat.playerId, token: seat.token, name: seat.name });
        }
        setAddress(mine.address);
        setInvites(mine.invites.filter((i) => i.game === GAME_ID));
        setSignedInKnown(true);
      }

      const rooms = listRooms();
      if (rooms.length === 0) { setGames([]); return; }
      try {
        const res = await fetch(summariesUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rooms: rooms.map((r) => ({
              roomId: r.roomId,
              playerId: r.identity.playerId,
              token: r.identity.token,
            })),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { summaries: RoomSummary[] };
        if (cancelled) return;
        const known: MyGame[] = [];
        for (const s of body.summaries) {
          if (s.known) known.push({ roomId: s.roomId, summary: s });
          else clearIdentity(s.roomId);
        }
        setGames(known);
      } catch (error) {
        console.warn(`[wordgame] game list unavailable (${summariesUrl()}):`, error);
        if (!cancelled) setGames([]);
      }
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  return { games, invites, address, signedInKnown, refresh };
}
```

Keep the original file's two long comments (the `/wordgameapi/summaries` history on `summariesUrl`, and the 404-fallback warning) — they are load-bearing history; the listing above elides them for length only.

- [ ] **Step 4: Run the game's suite**

Run: `npx vitest run --root games/wordgame`
Expected: `useMyGames.test.ts` passes; `HomePage.test.tsx` may now fail because its `fetchMock` answers every URL with summaries. Fix `mockRooms` there to answer by URL:

```ts
function mockRooms(summaries: KnownSummary[], mine: Mine | null = null) {
  listRoomsMock.mockReturnValue(
    summaries.map((s) => ({
      roomId: s.roomId,
      identity: { playerId: `p-${s.roomId}`, token: `t-${s.roomId}`, name: 'You' },
    })),
  );
  fetchMock.mockImplementation((input: string) =>
    Promise.resolve(input === '/notify/me'
      ? ({ ok: mine !== null, json: async () => mine ?? {} } as Response)
      : ({ ok: true, json: async () => ({ summaries }) } as Response)));
}
```

with `import type { Mine } from '@game-host/notify/client/api';` and a `vi.mock('../notify/playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));`. The "fetches summaries under the game base path" test's `toHaveBeenCalledWith` still holds.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/pages/useMyGames.ts games/wordgame/src/pages/useMyGames.test.ts games/wordgame/src/pages/HomePage.test.tsx
git commit -m "wordgame: restore the person's seats into the store before listing"
```

---

### Task 10: The home screen — sign-in card, signed-in line, invite cards

**Files:**
- Modify: `games/wordgame/src/pages/HomePage.tsx`
- Test: `games/wordgame/src/pages/HomePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a `describe('HomePage — sign-in and invites')`:

```tsx
  it('offers sign-in when the service knows this device holds no address', async () => {
    mockRooms([], { address: null, seats: [], invites: [] });
    notifyStatusValue = 'off';
    renderHome();
    expect(await screen.findByText(/Sign in with your email/)).toBeInTheDocument();
    // The plain nudge yields to the sign-in card.
    expect(screen.queryByText(/get a nudge when it’s yours/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('dialog', { name: 'Notification settings' })).toBeInTheDocument();
  });

  it('shows no sign-in card when there is no service to sign in to', async () => {
    mockRooms([], null);
    renderHome();
    await screen.findByText('New room');
    expect(screen.queryByText(/Sign in with your email/)).not.toBeInTheDocument();
  });

  it('says who is signed in', async () => {
    mockRooms([], { address: 'pete@example.com', seats: [], invites: [] });
    renderHome();
    expect(await screen.findByText('Signed in as pete@example.com')).toBeInTheDocument();
  });

  it('lists invites as cards; claiming one writes the seat and opens the room', async () => {
    mockRooms([], {
      address: 'pete@example.com', seats: [],
      invites: [{ game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: 'Alice', gameTitle: 'Word Game' }],
    });
    acceptInviteMock.mockResolvedValue({ playerId: 'p3', token: 't3', name: 'Pete', inviterName: 'Alice' });
    renderHome();
    expect(await screen.findByText(/Alice saved you a seat/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await screen.findByText('room:INV111');
    expect(saveIdentityMock).toHaveBeenCalledWith('INV111', { playerId: 'p3', token: 't3', name: 'Pete' });
  });

  it('a refused claim re-runs restore instead of showing an error', async () => {
    mockRooms([], {
      address: 'pete@example.com', seats: [],
      invites: [{ game: 'wordgame', roomId: 'INV111', playerId: 'p3', inviterName: null, gameTitle: 'Word Game' }],
    });
    acceptInviteMock.mockResolvedValue(null);
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => c[0] === '/notify/me').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
```

with, at the top of the test file:

```ts
const acceptInviteMock = vi.fn();
vi.mock('@game-host/notify/client/landing', async (importActual) => ({
  ...(await importActual<typeof import('@game-host/notify/client/landing')>()),
  acceptInvite: (...a: unknown[]) => acceptInviteMock(...a),
}));
```

and `acceptInviteMock.mockReset()` in `beforeEach`. The settings-dialog assertion relies on `NotificationSettings` rendering with `fetch` stubbed; its own load call hits `/notify/settings`, which `mockRooms`'s implementation answers with `{ summaries }` — harmless, the sheet shows "unavailable". If that assertion is brittle, assert on the sheet's heading `🔔 Notifications` instead.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root games/wordgame src/pages/HomePage.test.tsx`
Expected: the five new tests fail.

- [ ] **Step 3: Implement**

In `HomePage.tsx`:

```tsx
import { acceptInvite } from '@game-host/notify/client/landing';
import type { MineInvite } from '@game-host/notify/client/api';
```

Add a card:

```tsx
function InviteCard({ invite, onClaim }: { invite: MineInvite; onClaim: () => void }) {
  const who = invite.inviterName ?? 'A friend';
  return (
    <div
      data-testid={`invite-${invite.roomId}`}
      className="m-0 mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#c9a86a] bg-[#fbf9f3] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">Room {invite.roomId}</div>
        <div className="text-[12px] text-[#8a6d2f]">{who} saved you a seat</div>
      </div>
      <button
        type="button"
        onClick={onClaim}
        className="m-0 flex-none rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
      >
        Claim
      </button>
    </div>
  );
}
```

In the component: `const { games, invites, address, signedInKnown, refresh } = useMyGames();` and

```tsx
  const claim = (invite: MineInvite) => {
    void acceptInvite(invite.game, invite.roomId).then((creds) => {
      if (creds === null) { refresh(); return; }
      saveIdentity(invite.roomId, { playerId: creds.playerId, token: creds.token, name: creds.name });
      navigate(`/room/${invite.roomId}`);
    });
  };
```

Header: under the `<h1>`, when `address !== null`, render `<p className="px-4 pb-2 text-[12px] text-ink-faint">Signed in as {address}</p>` (place it as a sibling after the `<header>`).

Replace the nudge banner block with the three-way choice from the spec:

```tsx
      {notifyStatus === 'pending' ? (
        <Banner tone="warn" text={`✉️ Confirm your email — we sent a link to ${maskEmail(emailAddress)}. Tap it, then come back here.`} action="Resend" onAction={() => { setNotifyOpen(true); }} />
      ) : signedInKnown && address === null ? (
        <Banner tone="accent" text="Sign in with your email to see your games on this device" action="Sign in" onAction={() => { setNotifyOpen(true); }} />
      ) : notifyStatus === 'off' ? (
        <Banner tone="accent" text="🔔 Turns can be days apart — get a nudge when it’s yours" action="Set up" onAction={() => { setNotifyOpen(true); }} />
      ) : null}
```

with `Banner` extracted from the existing banner JSX (same classes; `tone` picks the two class pairs). Then above `lobbyGames`:

```tsx
      {invites.length > 0 && (
        <>
          <SectionHeader>INVITED</SectionHeader>
          {invites.map((i) => (
            <InviteCard key={i.roomId} invite={i} onClaim={() => { claim(i); }} />
          ))}
        </>
      )}
```

`NotificationSettings`'s `onClose` should also call `refresh()` so a sign-out or a confirmation reflects immediately: `onClose={() => { setNotifyOpen(false); refreshNotify(); refresh(); }}`.

- [ ] **Step 4: Run the game's suite and typecheck**

Run: `npx vitest run --root games/wordgame && npx tsc --noEmit -p games/wordgame`
Expected: all pass. The existing `'nudges when notifications are off'` test still passes because `mockRooms([])` defaults `mine` to null, so `signedInKnown` is false.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/pages/HomePage.tsx games/wordgame/src/pages/HomePage.test.tsx
git commit -m "wordgame: sign-in card, signed-in line, and invite cards on the home screen"
```

---

### Task 11: The settings sheet — device on submit, email toggle, sign out

**Files:**
- Modify: `games/wordgame/src/notify/NotificationSettings.tsx`
- Test: `games/wordgame/src/notify/NotificationSettings.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
  it('tells the server which kind of device is asking', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings()))
      .mockResolvedValueOnce(jsonResponse(200, { result: 'confirmationSent' }));
    render(<NotificationSettings onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'pete@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[0] === '/notify/email')!;
      expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ device: 'browser' });
    });
    expect(await screen.findByText(/then come back here/)).toBeInTheDocument();
  });

  it('a confirmed address shows the email toggle and a sign-out; the toggle only changes the pref', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings({ email: { address: 'pete@example.com', status: 'confirmed' } })))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    render(<NotificationSettings onClose={() => {}} />);
    const toggle = await screen.findByRole('checkbox', { name: 'Email me when it’s my turn' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[0] === '/notify/prefs')!;
      expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ email: false });
    });
    expect(screen.getByText('pete@example.com')).toBeInTheDocument(); // still signed in
  });

  it('sign out asks twice, then clears every seat on this device and closes', async () => {
    localStorage.setItem('wordgame.room.ABC123', JSON.stringify({ playerId: 'p1', token: 't', name: 'Pete' }));
    localStorage.setItem('wordgame.room.XYZ789', JSON.stringify({ playerId: 'p2', token: 't', name: 'Pete' }));
    const onClose = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings({ email: { address: 'pete@example.com', status: 'confirmed' } })))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    render(<NotificationSettings onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out this device' }));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(fetchMock).toHaveBeenCalledWith('/notify/signout', expect.anything());
    expect(localStorage.getItem('wordgame.room.ABC123')).toBeNull();
    expect(localStorage.getItem('wordgame.room.XYZ789')).toBeNull();
    expect(localStorage.getItem('notify.key')).not.toBeNull();
  });
```

`isInstalledApp()` is false under jsdom (no `matchMedia`, no `navigator.standalone`), which is why the first test expects `'browser'`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root games/wordgame src/notify/NotificationSettings.test.tsx`
Expected: the three new tests fail.

- [ ] **Step 3: Implement**

Imports:

```ts
import { setEmailPref, signOut } from '@game-host/notify/client/api';
import { isInstalledApp } from '@game-host/pwa/client/installed';
import { clearIdentity, listRooms } from '../net/identity';
```

In `submitEmail`, the POST body becomes `{ playerKey, email: address, device: isInstalledApp() ? 'app' : 'browser' }`.

State: `const [emailPref, setEmailPrefState] = useState<boolean | null>(null);` (null until settings load; initialize from `load.settings.prefs.email` in the load effect), `const [signingOut, setSigningOut] = useState<'idle' | 'confirm' | 'busy'>('idle');`.

Copy changes: the `'sent'` note becomes `'Check your inbox — tap the link, then come back here.'`; the pending status line becomes ``Waiting for you to confirm ${emailStatus.address} — check your inbox, tap the link, then come back here.``.

In the Email section, when `emailStatus?.status === 'confirmed'` and not editing, render after the address row:

```tsx
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={emailPref ?? true}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setEmailPrefState(next);
                        if (playerKey !== null) void setEmailPref(playerKey, next);
                      }}
                    />
                    Email me when it’s my turn
                  </label>
                  {/* Sign out cleans this device (spec §Sign out): the address,
                      every binding, every seat in local storage. The device key
                      and its push subscription stay so signing in again does
                      not re-ask for permission. Other devices are untouched. */}
                  {signingOut === 'confirm' ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex-1 text-ink-mute">This device forgets every game. Other devices stay signed in.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSigningOut('busy');
                          void (async () => {
                            if (playerKey !== null) await signOut(playerKey);
                            for (const room of listRooms()) clearIdentity(room.roomId);
                            onClose();
                          })();
                        }}
                        className="m-0 rounded-lg border border-danger-ink px-3 py-1.5 font-semibold text-danger-ink"
                      >
                        Sign out this device
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={signingOut === 'busy'}
                      onClick={() => { setSigningOut('confirm'); }}
                      className="m-0 self-start text-sm font-semibold text-ink-mute"
                    >
                      Sign out
                    </button>
                  )}
```

Also change the sheet's confirmed status line from `Turn emails go to …` to `Signed in as ${emailStatus.address}.` so the sheet and the home line agree.

- [ ] **Step 4: Run the game's suite and typecheck**

Run: `npx vitest run --root games/wordgame && npx tsc --noEmit -p games/wordgame`
Expected: all pass. If `@game-host/pwa` is not in the word game's `package.json` dependencies, it already imports `UpdateReadyButton` from it, so it is.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/notify
git commit -m "wordgame settings: device on submit, email toggle, and sign out that cleans the device"
```

---

### Task 12: Sign-in in the room lobby, and the iOS nudge after a claim

**Files:**
- Modify: `games/wordgame/src/game/lobby/RoomLobby.tsx`
- Modify: `games/wordgame/src/pages/RoomPage.tsx`
- Test: `games/wordgame/src/pages/RoomPage.test.tsx` (or `RoomPage.invite.test.tsx`, whichever already drives the lobby phase)

**Interfaces:**
- Produces: `RoomLobbyProps.onSignIn?: () => void` — when present, the lobby shows the sign-in card.

- [ ] **Step 1: Write the failing tests**

In the RoomPage test that renders a lobby (follow its `fakeConnection` and `sendRoster` helpers), add:

```tsx
  it('a lobby on a device with no address offers sign-in, which opens the settings sheet', async () => {
    notifyStatusValue = { status: 'off', emailAddress: null, emailConfirmed: false };
    const { connection } = renderRoom();
    act(() => { connection.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 't' }); });
    act(() => { connection.sendRoster(lobbyRoster()); });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('dialog', { name: 'Notification settings' })).toBeInTheDocument();
  });

  it('a lobby on a signed-in device shows no sign-in card', async () => {
    notifyStatusValue = { status: 'on', emailAddress: 'pete@example.com', emailConfirmed: true };
    const { connection } = renderRoom();
    act(() => { connection.sendJoined({ roomId: 'ABC123', playerId: 'p1', token: 't' }); });
    act(() => { connection.sendRoster(lobbyRoster()); });
    await screen.findByText(/Share this code|You’re in/);
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
```

with a module mock of `../notify/useNotifyStatus` returning `{ ...notifyStatusValue, refresh: vi.fn() }`, and `lobbyRoster()` built the way that file already builds rosters. For the claim nudge, in the test that covers `ClaimLanding`'s `needsInstall` state (grep `needsInstall` in the RoomPage tests; add one if absent by mocking `useEnrollPush` to return `{ state: 'needsInstall', enroll: vi.fn(), decline: vi.fn() }`):

```tsx
    expect(screen.getByText(/then open it and sign in with the same email/)).toBeInTheDocument();
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root games/wordgame src/pages/`
Expected: the new tests fail.

- [ ] **Step 3: Implement**

`RoomLobby.tsx`: add to props

```ts
  /**
   * Offer sign-in (spec §Client, decision 1): shown when the device holds
   * no confirmed address, so a friend who arrived by room code meets it
   * before the game starts. Absent means signed in, or no service.
   */
  onSignIn?: () => void;
```

and render, inside the `seatNote` slot, before the existing note:

```tsx
      seatNote={(
        <>
          {onSignIn !== undefined && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border-[1.5px] border-[var(--lobby-accent,#2563eb)] bg-[#f0f5ff] px-3 py-2">
              <span className="flex-1 text-[12.5px] text-accent-strong">
                Sign in with your email to keep this seat on your other devices
              </span>
              <button
                type="button"
                onClick={onSignIn}
                className="m-0 flex-none rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3 py-1.5 text-[12.5px] font-semibold text-white"
              >
                Sign in
              </button>
            </div>
          )}
          <p className="text-center text-[12px] text-ink-faint">{seatNote}</p>
        </>
      )}
```

`RoomPage.tsx`, in `RoomView`: `const notify = useNotifyStatus();` (import from `'../notify/useNotifyStatus'`), `const [settingsOpen, setSettingsOpen] = useState(false);`, and in the lobby branch pass `{...(notify.status !== 'unavailable' && notify.status !== 'loading' && !notify.emailConfirmed ? { onSignIn: () => { setSettingsOpen(true); } } : {})}` to `RoomLobby`, and render `{settingsOpen && <NotificationSettings onClose={() => { setSettingsOpen(false); notify.refresh(); }} />}` beside the picker (import `NotificationSettings` from `'../notify/NotificationSettings'`).

`ClaimLanding`'s `needsInstall` copy becomes:

```
'Add this game to your Home Screen (Share → Add to Home Screen) — iPhones only push to installed apps — then open it and sign in with the same email to find this game there.'
```

- [ ] **Step 4: Run the game's suite and typecheck**

Run: `npx vitest run --root games/wordgame && npx tsc --noEmit -p games/wordgame`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/lobby/RoomLobby.tsx games/wordgame/src/pages
git commit -m "wordgame: sign-in card in the room lobby; the claim nudge says to sign in from the app"
```

---

### Task 13: The whole suite, the artifact, and the docs

**Files:**
- Modify: `specs/2026-09-09-person-identity-and-app-signin.md` (append "As built")
- Modify: `CLAUDE.md` (the `packages/notify` row)

- [ ] **Step 1: Everything green**

Run: `npm test && npm run typecheck && npm run lint`
Expected: every package passes; lint clean (watch the two promise rules on the new `void` calls).

- [ ] **Step 2: The artifact-level pass**

Run: `npm run build && grep -c "/notify/me" games/wordgame/dist/assets/*.js && grep -c "/notify/me" apps/host/dist/main.mjs`
Expected: both counts non-zero: the client bundle carries the restore call and the server bundle carries the route. Then boot it: `DATA_DIR=$(mktemp -d) npm run start:host:compiled &` (note the PID), `curl -s -X POST localhost:4000/notify/me -H 'content-type: application/json' -d '{"playerKey":"player-key-0123456789abcdef"}'` expecting `{"address":null,"seats":[],"invites":[]}`, `curl -s "localhost:4000/notify/confirm?token=nope"` expecting a 404 page, then kill the server **by PID** (never `pkill -f`).

- [ ] **Step 3: Docs**

Append to the spec:

```markdown
## As built (2026-09-09)

Implemented as designed, with these deltas:

- **`disabled` links too.** A person is every profile whose address is
  confirmed *or* confirmed-then-unsubscribed; the spec said "confirmed".
  Unsubscribing is "stop mailing me", and turning it into a sign-out
  would have surprised anyone who used the link in a turn mail.
- **The restore hook lives in the game** (`useMyGames`), not the shared
  client: the shared package returns credentials and the game writes
  them, the precedent `landing.ts` set. The shared client gained only
  calls (`fetchMine`, `acceptInvite`, `signOut`, `setEmailPref`) — no new
  file, so `importBoundary.test.ts` still counts 13.
- **Email invites to a proven address also push.** The spec's fan-out
  section covered contact invites; an invite *by address* to someone
  whose app is linked is the same use case and got the same treatment.
- **`confirmationDetails`** is a separate read from `confirmEmail`, so the
  GET page and the POST button cannot disagree about a token.
- **The invite card carries no seat name.** The invite record never held
  one (the lobby holds it on the pending seat); the card says who invited
  you and which room, which is what the person needs to decide.
```

In `CLAUDE.md`, extend the `packages/notify` row with one sentence: "Since 2026-09-09 it also knows a *person*: every profile confirmed on one address, derived at query time; `/notify/me` restores that person's seats and invites into an installed app, and confirming an address is a sign-in, which is why the confirm page has a button ([spec](specs/2026-09-09-person-identity-and-app-signin.md))."

- [ ] **Step 4: Commit, push, PR**

```bash
git add specs/2026-09-09-person-identity-and-app-signin.md CLAUDE.md
git commit -m "docs: as-built for the person spec; CLAUDE.md notify row"
git push -u origin claude/person-identity
gh pr create --title "A person across devices: email is the account, the app signs in" --body "..."
```

The PR body lists the seven use cases from the spec and states what was verified: full suite, typecheck, lint, the bundle grep, and the compiled boot with the two curls. It does not claim a live iPhone run; that is the owner's to do after deploy, and the spec's "Where it works" says it needs Render.
