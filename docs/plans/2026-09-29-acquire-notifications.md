# Turn notifications for Acquire, push and email, the word game's way

**Status:** proposed 2026-09-29. Nothing below is built yet. Four owner
questions at the end; the phases are ordered so that Phase 1 can land
before any of them is answered.

## Where Acquire already is

Less of this is missing than the word game's footprint suggests, because
Acquire was the first game to register with notify and simply never got a
client for it.

**Already done, server side** (`games/acquire/server/index.ts`):

- `registerGame` with `gameId: 'acquire'`, `roomPath`, `isConnected` and
  `verifySeat`.
- One `turnChanged` in `deliver`'s commit branch, keyed on
  `segmentStart`. That key is the right one: a segment closes exactly when
  the actor changes (`GameSession` commits on `actorChanged`), so it is
  distinct per turn and survives a restart inside the saved state.
- A merger's sell/trade/keep decision by a non-current shareholder is its
  own segment, so those players are already reported as "the player being
  waited on". That is correct behaviour, and worth a test (Phase 1).

**Already done, everywhere else:** the PWA (`@game-host/pwa` plugins,
`registerServiceWorker`, `checkDist` postbuild), so the service worker
that receives pushes is already shipped at `/acquire`. The composed host
already owns the service, `/notify` routes and `DATA_DIR/notifications/`.
The shared client in `packages/notify/client/` (api, push,
pushSubscription, useNotifyBind, useNotifyStatus, useEnrollPush, landing,
invites) was extracted on 2026-09-05 precisely so a second game could
import it.

**Missing, server side:**

| Word game has | Acquire has | Consequence today |
| --- | --- | --- |
| `getSeatCredentials` | nothing | Turn emails link to the bare room path, never `?key=`; a new device cannot sign in from the email; `/notify/me` cannot restore Acquire seats; `seat-signin` always answers `sent` and mails nothing. |
| `restore(now, onEvicted)` bridge to `roomRemoved` | `restore(now)` | Evicted rooms leave notify's per-room records behind forever (the bug the word game found on 2026-09-05). |
| `reportTurns()` after restore | nothing | A room restored a segment behind leaves notify's `currentTurn` marker naming the wrong player, so a nudge would remind the wrong person. |
| `onSeatVacated` → `seatVacated` | nothing | Only matters once Acquire has invites or lobby leavers bind profiles; harmless to add now. |
| `POST /api/summaries` with `nudge` | nothing | No entry list, so nowhere to put Nudge. |
| `reserveSeat` / `claimSeat` | nothing (`revoke` answers false) | No invites. Out of scope, see Q2. |

**Missing, client side:** everything. No `src/notify/`, no bind, no
settings panel, no enrol prompt, no `?key=` landing, no `listRooms` export
from `net/identity.ts`.

## Phase 1: server parity (no UI, no owner decisions needed)

All in `games/acquire/server/`.

1. **`getSeatCredentials`** on the registration, a pure read, copied from
   the word game (`seat → { playerId, token, name }`). This one line is what
   turns the turn email's link into a sign-in link and lets `/notify/me`
   and `seat-signin` see Acquire at all.
2. **Eviction reaches notify.** Give `RoomRegistry.restore` the same
   optional `onEvicted(roomId)` the word game's has, called after
   `store.remove`, and re-bind it in `build`'s return value to
   `notifier?.roomRemoved`. The protocol-skew skip stays silent, for the
   same reason the word game gives: a rollback gets the room back, so its
   notify state must survive.
3. **`reportTurns()`** after restore, in `mount`, re-reporting every
   non-lobby room's `actorId()` and `segmentStart()`. A same-key report is a
   no-op inside notify; a finished room reports `null` and clears its
   marker. Check that `getCurrentActor` returns `null` at `stage === 'end'`
   before relying on that, and pin it in a test.
4. **`onSeatVacated`** passed through to `createLobbyHandlers`. Cheap, and it
   means Phase 5 (invites) does not have to remember it.
5. **Tests**, mirroring `games/wordgame/server/recovery.test.ts` and the
   notify-facing cases in its `wire.test.ts`: a fake `TurnNotifier` that
   records calls; commit reports the new actor; a merger decision reports
   the shareholder, not the current player; restore re-reports; eviction
   calls `roomRemoved`; `getSeatCredentials` returns the live token after a
   rejoin rotates it. `apps/host` gets one composed test that an Acquire
   commit produces a push to a scope-tagged `acquire` subscription and not
   to a `wordgame` one.

This phase changes what users get even with no client work: anyone who has
already bound an email address from the word game (a *person*, per the
2026-09-09 spec) still receives nothing for Acquire, because nothing binds
their Acquire seat. So Phase 1 is invisible until Phase 2, and safe to ship
alone.

## Phase 2: the client binds, and can be told to

The word game's footprint, minus the parts that are word-game styling.

1. **`src/notify/`** with the same thin files: `gameId.ts`
   (`GAME_ID = 'acquire'`, with the word game's warning about typo'd scope
   tags), and re-exports of `api`, `push`, `playerKey`, `useNotifyStatus`.
   `useNotifyBind.ts` wraps the shared hook with Acquire's `loadIdentity`.
2. **Export `listRooms`** from `src/net/identity.ts` (the lobby store
   already has it; Acquire just never destructured it). Sign-out needs it
   to clear every Acquire identity on this device.
3. **Bind on `RoomPage`**, `phase` = `'lobby'` or `'playing'` from the room
   lifecycle, `null` while not seated. This is the call that actually
   attaches a device's profile to an Acquire seat.
4. **The settings panel.** `games/wordgame/src/notify/NotificationSettings.tsx`
   is 388 lines, of which most is state and wire logic and the rest is
   word-game Tailwind. Acquire is the second consumer, so this is the
   moment to split it: move the state machine (load, push toggle, email
   draft/submit/notes, email pref, sign-out) into
   `packages/notify/client/useNotificationSettings.ts`, taking `game` and a
   `clearIdentities()` callback, and leave each game a presentational
   panel in its own tokens. The word game's existing
   `NotificationSettings.test.tsx` must pass unchanged against the
   refactored panel before Acquire's copy is written; that is the proof the
   extraction moved logic and changed nothing. (Recommendation, see Q4.)
5. **An entry point in the game screen**: a bell in `GameScreen`'s header
   (or the panel's overflow, wherever Acquire's layout has room at phone
   width), showing `useNotifyStatus` state, opening the panel.
6. **The enrol prompt**: `useEnrollPush(GAME_ID)` offered once, at the
   moment it is honest, which for Acquire is the lobby after seating (the
   word game's "You'll get a nudge when the first turn is yours"). iOS gets
   the install-first sentence the panel already has; a Safari tab has no
   `PushManager`.
7. **The `?key=` / `?invite=` landing** on `RoomPage`: `landingParam`,
   `redeemLanding`, `saveIdentity`, `stripLandingParam`, as the word game's
   outer `RoomPage` does it, resolving before the socket connects. Without
   it the Phase 1 sign-in links arrive at a page that ignores them. Only
   the `key` kind matters until invites exist.
8. **`PreJoin`-style seat sign-in**, for the player who opens the room on a
   new device with no identity: `requestSeatSignin` against a disconnected
   seat, mailing them their link. Acquire's `JoinRoomPage` currently
   refuses that player outright (rooms.test.ts pins the refusal after the
   2026-09-06 retirement of name-matching); this gives them the way back
   in that the refusal's comment promises.

Tests: the word game's `NotificationSettings.test.tsx`,
`RoomPage.test.tsx` landing cases and `PreJoin` cases, ported. The
standalone dev server 404s `/notify`, and every one of these must degrade
to the single honest "unavailable" sentence rather than an error.

## Phase 3: the entry list and Nudge (depends on Q3)

Nudge lives on the entry screen's per-room card and nowhere else
(2026-09-10 plan), so it needs an entry list Acquire does not have:

1. `POST /acquire/api/summaries`, `express.json()` scoped to the route,
   returning a summary per room the caller holds a seat in, with
   `nudge: notifier?.nudgeState?.(roomId) ?? null` while playing. What a
   summary *shows* (cash? net worth? whose turn and what they are deciding?)
   is Acquire's to design; it must carry nothing a projection would hide,
   which for Acquire means no tile racks and no drafts.
2. `useMyGames` on `HomePage`, merging local identities with `/notify/me`
   seats filtered to `GAME_ID`, and the `NudgeControl` from the word game's
   `HomePage`.

## Phase 4: eviction policy (depends on Q1)

Acquire evicts at 7 days since the last save. That was right for a game
played in one sitting, and notifications are what make an Acquire game
spread over days possible. With email, a game that stalls over a long
weekend and resumes on day eight comes back as "room gone". If the owner
wants async Acquire, adopt the word game's two policies
(`FINISHED_MAX_AGE_MS` / `ACTIVE_MAX_AGE_MS`) in `server/rooms.ts`, and
update its comment.

## Phase 5 (not proposed here): invites

`reserveSeat` / `claimSeat`, `InvitePicker`, lobby persistence
(`onRosterChanged: save`, which Acquire lacks because it never writes a
lobby-stage room), pending seats in the roster. That is the 2026-09-05
invites-and-friends work, not notifications, and it is its own plan.

## Owner questions

1. **Eviction.** Keep 7 days, or move Acquire to the word game's
   30-day finished / 60-day active split now that notifications invite
   async play? *Recommendation: move it, in the same PR as Phase 2.*
2. **Invites.** In or out of this piece of work? *Recommendation: out.*
3. **Entry list with Nudge.** Does Acquire get a "your games" home screen
   like the word game's, or is it a one-sitting game where push and email
   are enough? *Recommendation: push and email first (Phases 1 and 2);
   decide the entry list once people are actually playing Acquire across
   days.*
4. **Extracting the settings panel's logic to `packages/notify`**, versus
   copying `NotificationSettings.tsx` and restyling it.
   *Recommendation: extract. Two copies of an email-confirm state machine
   is how the next fix lands in only one of them.*

One smaller copy question: a merger decision is reported as a turn, so the
push reads "Acquire, your turn" to a shareholder who is being asked to
sell, trade or keep. Accurate enough; changing it would mean widening
`turnChanged` in the contract for one game, which this plan does not
propose.
