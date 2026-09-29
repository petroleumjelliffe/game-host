# Turn notifications for Acquire, push and email, the word game's way

**Status:** proposed 2026-09-29, revised the same day after an owner review
and a code-checked self-review (see "Revisions" at the end). Nothing below
is built yet.

**Owner rulings (2026-09-29):**

1. **Eviction stays 7 days since the last turn.** No two-policy split.
2. **Invites are in.** They are shared code (`packages/lobby` reserve and
   claim, `packages/notify` invites, contacts and landing), so Acquire
   adopts them rather than waiting for a plan of their own.
3. **No Nudge for now.** The entry list still ships (Phase 3), without the
   Nudge control or the `nudge` field.
4. **The settings panel's logic moves to `packages/notify`**, and each game
   keeps only a presentational panel in its own tokens.

## Where Acquire already is

Less of this is missing than the word game's footprint suggests, because
Acquire was the first game to register with notify and never got a client
for it.

**Already done, server side** (`games/acquire/server/index.ts`):

- `registerGame` with `gameId: 'acquire'`, `roomPath`, `isConnected` and
  `verifySeat`.
- One `turnChanged` in `deliver`'s commit branch, keyed on
  `segmentStart`. That key is the right one: a segment closes exactly when
  the actor changes (`GameSession` commits on `actorChanged`), so it is
  distinct per turn and survives a restart inside the saved state.
- A merger's sell/trade/keep decision by a non-current shareholder is its
  own segment (`getCurrentActor`'s `mergerLiquidation` branch), and so is
  each opening draw, so those players are already reported as the one being
  waited on. Correct, and worth pinning (Phase 1).
- `getCurrentActor` returns `null` at `stage === 'end'`, so the commit that
  ends a game already clears notify's pending turn.
- `apps/host/notifications.test.ts` already exercises Acquire end to end:
  binding needs the seat's real token, and a bound actor gets a turn marker
  at the turn change. Phase 1 extends that file; it does not start one.

**Already done, everywhere else:** the PWA (`@game-host/pwa` plugins,
`registerServiceWorker`, `checkDist` postbuild), so the service worker that
receives pushes is already shipped at `/acquire`. The composed host owns
the service, `/notify` routes and `DATA_DIR/notifications/`. The shared
client in `packages/notify/client/` (api, push, pushSubscription,
useNotifyBind, useNotifyStatus, useEnrollPush, useContacts, landing,
invites) was extracted on 2026-09-05 precisely so a second game could
import it.

**Missing, server side:**

| Word game has | Acquire has | Consequence today |
| --- | --- | --- |
| `getSeatCredentials` | nothing | Turn emails link to the bare room path, never `?key=`; a new device cannot sign in from the email; `/notify/me` cannot restore Acquire seats; `seat-signin` answers `sent` and mails nothing. |
| `restore(now, onEvicted)` bridge to `roomRemoved` | `restore(now)` | Evicted rooms leave notify's per-room records behind forever (the bug the word game found on 2026-09-05). |
| `reportTurns()` after restore | nothing | A room restored a segment behind leaves notify's `currentTurn` marker naming the wrong player. |
| `onSeatVacated` → `seatVacated` | nothing | Needed the moment invites exist. |
| `onRosterChanged: save`, lobby-stage saves | `persist` returns early for a lobby | A reserved seat lives only in memory, so a deploy between invite and claim loses the seat while notify keeps a live invite for it. |
| `reserveSeat` / `claimSeat` | nothing (`revoke` answers false) | No invites. |
| `POST /api/summaries` | nothing | No entry list, so nowhere for `/notify/me` seats or invites to land. |

**Missing, client side:** everything. No `src/notify/`, no bind, no
settings panel, no enrol prompt, no `?key=` / `?invite=` landing, no
preview mode on `useRoom`, no entry list, no `listRooms` export from
`net/identity.ts`.

## Phase 1: server parity for turn notifications

All in `games/acquire/server/`. No UI.

1. **`getSeatCredentials`** on the registration, a pure read, copied from
   the word game. This is what turns the turn email's link into a sign-in
   link and lets `/notify/me` and `seat-signin` see Acquire at all.
2. **Eviction reaches notify.** Give `RoomRegistry.restore` the word
   game's optional `onEvicted(roomId)`, called after `store.remove`, and
   re-bind it in `build`'s return value to `notifier?.roomRemoved`. The
   protocol-skew skip stays silent: a rollback gets the room back, so its
   notify state must survive.
3. **`reportTurns()`** after restore, in `mount`: every non-lobby room's
   `actorId()` and `segmentStart()`. Same-key reports are no-ops inside
   notify; a finished room reports `null`.
4. **Eviction, per ruling 1: no policy change.** `savedAt` is written only
   by `persist`, and `persist` runs only on a commit, so "7 days since the
   last save" already *is* "7 days since the last turn". Two things keep it
   that way and each gets a test: nothing but a commit (or, after Phase 4,
   a lobby roster change) may call `save`; and the `MAX_AGE_MS` comment is
   updated to say "since the last turn" so the next person to add a save
   site sees what it would break. Eviction still runs only at boot, so a
   stalled room outlives 7 days on a process that is never restarted;
   that is today's behaviour and not changed here.
5. **Tests.** Server level, mirroring `games/wordgame/server/recovery.test.ts`
   with a fake `TurnNotifier`: commit reports the new actor; a merger
   decision reports the shareholder; the final commit reports `null`;
   restore re-reports; eviction calls `roomRemoved`; `getSeatCredentials`
   follows a rotated token. Composed level, extend
   `apps/host/notifications.test.ts`: a turn email for Acquire carries
   `?key=`, and an Acquire turn pushes only to `acquire`-scoped
   subscriptions.

Safe to ship alone: nothing binds an Acquire seat until Phase 2, so the
only visible change is the eviction cleanup.

## Phase 2: the client binds, and can be told to

1. **Extract the settings logic** (ruling 4) first, as its own commit:
   the state machine in `games/wordgame/src/notify/NotificationSettings.tsx`
   (load, push toggle, email draft, submit and notes, email pref, sign-out)
   moves to `packages/notify/client/useNotificationSettings.ts`, taking
   `game` and a `clearIdentities()` callback. The word game's
   `NotificationSettings.test.tsx` must pass unchanged against the
   refactored panel before Acquire's panel is written; that is the proof
   the extraction moved logic and changed nothing.
   `packages/notify/client/importBoundary.test.ts` decides what the new
   file may import.
2. **`src/notify/`** with the same thin files as the word game: `gameId.ts`
   (`GAME_ID = 'acquire'`, with the warning about typo'd scope tags),
   re-exports, and `useNotifyBind.ts` over Acquire's `loadIdentity`.
3. **Export `listRooms`** from `src/net/identity.ts`; the lobby store
   already has it. Sign-out and the entry list both need it.
4. **Bind on `RoomPage`**, phase `'lobby'` or `'playing'`, `null` while
   unseated. The lobby bind is what lets the invite picker say "already in
   this room"; the playing bind writes the co-player ledger that
   `useContacts` reads.
5. **The panel and its entry point, online only.** Acquire's `GameScreen`
   also renders pass-and-play (`/pass-and-play/game`), where there is no
   seat and nobody to notify. The bell and panel take their presence from
   the online room, not from `GameScreen` itself.
6. **The enrol prompt**, `useEnrollPush(GAME_ID)`, offered once in the
   lobby after seating. Push subscriptions are scope-tagged per game, so a
   player who enabled push in the word game gets **no** Acquire turn
   pushes until they enable it here too; on iOS each installed app is a
   separate storage anyway. Email is per person and carries over once the
   seat is bound. The prompt's copy should say so plainly rather than
   imply push is already on.
7. **The landing**, `?key=` and `?invite=`, on `RoomPage`, resolved before
   the socket connects, as the word game's outer `RoomPage` does it.
8. **Pre-join and seat sign-in.** Acquire's `useRoom` does not opt into
   `useLobbyRoom`'s `preview` mode, so a device with no identity never sees
   the roster before joining, and there is nothing to hang
   `requestSeatSignin` on. This item is therefore bigger than one call:
   turn on preview mode, and give Acquire a pre-join chooser (take a free
   seat, or "that's me" on a disconnected seat, which mails the sign-in
   link). The word game's `PreJoin.tsx` is the model and is not shared
   code; whether its logic can move into `packages/lobby/client` the way
   the settings panel's does is worth deciding at the start of this item.

Every piece above must degrade to one honest sentence on the standalone
dev server, which 404s `/notify`.

## Phase 3: the entry list, without Nudge

Ruling 3 drops Nudge, but not the list: the list is where `/notify/me`
writes restored seats into local identities (the word game's
`useMyGames`), and where invites addressed to the signed-in person are
offered. Without it, signing in inside an installed Acquire app restores
nothing anyone can see.

1. `POST /acquire/api/summaries`, `express.json()` scoped to the route,
   verifying each seat's token and answering `known: false` otherwise (the
   client then forgets that identity). No `nudge` field. What a summary
   shows is Acquire's to design; it must carry nothing a projection hides,
   which means no tile racks and no drafts.
2. `useMyGames` on `HomePage`, and the invite rows with `acceptInvite`.
   `useMyGames` is the second copy of a nearly generic hook; if Phase 2's
   extraction went well, the same move applies here.

## Phase 4: invites (ruling 2)

1. **Lobby persistence.** `persist` stops returning early for a lobby and
   writes a record with no `state`; `restore` seats such a record as a
   lobby. Wire `onRosterChanged: save` as the word game does.
   **Do not bump `SAVE_VERSION`:** `hasEnvelope` requires an exact version
   match and an unreadable record is quarantined, so a bump would
   quarantine every live Acquire room at deploy. Make the guard accept an
   absent `state` at version 5 instead, as the word game made `pending`
   optional. The cost is on rollback: an older build's guard requires
   `state`, so it quarantines lobby-only records rather than skipping them.
   Acceptable for lobbies, and worth one sentence in the store comment.
2. **Pending seats in the record** (`pending`, absent when empty) and
   through `createGameRoom`, as the word game does.
3. **`reserveSeat`, `claimSeat`** on the registration, each saving and
   rebroadcasting the roster, and `onSeatVacated` to `seatVacated`.
   Drop the "Acquire hosts no invites yet" comment on `revoke`.
4. **`conformance.ts`** already runs its reserved-seat cases whenever the
   target supplies `reserve`; pass it for Acquire and those cases turn on.
5. **The lobby UI**: pending rows in the roster with revoke, and the
   invite picker. `InvitePicker.tsx` is word-game code over shared hooks;
   same extract-or-restyle decision as the panel, same answer.
6. **Eviction and invites** agree without extra work: a lobby's `savedAt`
   is its last roster change, an unclaimed invite's lobby ages out after 7
   days, and eviction's `roomRemoved` marks its invites dead.
7. **Tests**: extend `apps/host/invites.test.ts` with an Acquire case
   (invite, restart, claim), plus the save guard accepting a lobby record
   and still rejecting a malformed one.

## Wishes, not scheduled

- **Copy for merger decisions.** A shareholder asked to sell, trade or
  keep gets "your turn". Accurate enough; a better line needs
  `turnChanged` to carry a reason, which is a contract change for one game.
- **Runtime eviction.** Evicting only at boot means notify can hold a
  dead room's markers until the next deploy. Harmless at current deploy
  cadence.
- **A shared `PreJoin` and `useMyGames`**, if Phases 2 and 3 show they are
  as generic as they look.
- **CLAUDE.md's repo table** should say Acquire has notifications and
  invites once Phase 4 lands.

## Revisions

2026-09-29, after the owner's four rulings and a self-review against the
code:

- Invites moved from "not proposed" to Phase 4, with the lobby-persistence
  work they need and the `SAVE_VERSION` trap.
- The entry list stays despite no Nudge, because `/notify/me` seat
  restore and invite acceptance live there.
- Eviction needs no code change; "since the last turn" is already what
  `savedAt` measures. Now a pinned property instead of a phase.
- Found that `apps/host/notifications.test.ts` already covers Acquire;
  Phase 1 extends it.
- Found that Acquire has no preview mode, which makes seat sign-in a
  pre-join screen rather than one call.
- Added: the bell must be online-only (pass-and-play shares `GameScreen`),
  and push being scope-tagged means enabling it in one game does not
  enable it in another.
