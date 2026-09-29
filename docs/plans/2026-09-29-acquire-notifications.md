# Turn notifications for Acquire, push and email, the word game's way

**Status:** proposed 2026-09-29, revised the same day after an owner review
and a code-checked self-review (see "Revisions" at the end). **Phase 1 is
built** (2026-09-29, see its "As built" note); Phases 2 to 4 are not.

**Owner rulings (2026-09-29):**

1. **Eviction stays 7 days since the last turn.** No two-policy split.
2. **Invites are in.** They are shared code (`packages/lobby` reserve and
   claim, `packages/notify` invites, contacts and landing), so Acquire
   adopts them rather than waiting for a plan of their own.
3. **No Nudge for now.** The entry list still ships (Phase 3), without the
   Nudge control or the `nudge` field.
4. **The settings panel's logic moves to `packages/notify`**, and each game
   keeps only a presentational panel in its own tokens.
5. **No existing Acquire save is worth keeping.** Save-format changes may
   bump `SAVE_VERSION` and let old records quarantine; no migration, no
   rollback compatibility.
6. **Acquire gets the word game's whole pre-join work** (the 2026-09-06
   plan: chooser, "That's me", sent/cooldown states, the rebuilt dead-link
   view), not just a seat sign-in call.
7. **The local-play exception goes in the shared library.** No
   notification surface exists without an online seat, and that rule lives
   in `packages/notify/client`, not in each game, so Rail Baron's local
   mode inherits it when it adopts notifications.

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

**As built (2026-09-29).** As planned, with these specifics:

- `games/acquire/server/notify.test.ts` is new and boots through `mount`
  (the composed path) against a recording notifier over seeded save files:
  restore re-reports the waited-on player, the shareholder in a merger,
  and `null` for a finished game; eviction reports `roomRemoved` and a
  protocol-skew skip reports nothing; `getSeatCredentials` answers the live
  seat and `null` otherwise; a lobby leaver reports `seatVacated`.
- The "since the last turn" pin lives in `recovery.test.ts`: a restart and
  a rejoin leave `savedAt` exactly where the turn put it.
- `apps/host/notifications.test.ts` gained a block with fake channels: an
  Acquire `seat-signin` mails a `/acquire/room/<id>?key=` link, the key
  redeems to the seat, `/notify/me` lists it, and an Acquire turn pushes
  to the `acquire`-scoped subscription and not the `wordgame` one.
- The rotated-token case the plan listed is gone: since the reclaim was
  retired (2026-09-06) no path rotates a seat token, so there is nothing
  to follow.
- Each new test was broken on purpose to see it fail: dropping
  `reportTurns` and the eviction bridge turns four `notify.test.ts` cases
  red, and dropping `getSeatCredentials` turns the composed sign-in case
  red. The scope-tag push case is notify's behaviour and passes either
  way; it is there to pin that Acquire's turns are tagged `acquire`.

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
5. **The panel and its entry point, online only, enforced in the shared
   library (ruling 7).** Acquire's `GameScreen` also renders pass-and-play
   (`/pass-and-play/game`), where there is no seat and nobody to notify,
   and Rail Baron has a local mode beside `OnlineApp` too. So the rule is
   not "each game remembers to hide the bell": the shared pieces take the
   seat identity as a required argument (`RoomIdentity | null`) and render
   or do nothing when it is `null`. `useNotifyBind` already no-ops on a
   null identity; the new shared bell and `useNotificationSettings` get
   the same shape, with one test in `packages/notify/client` pinning that
   a null seat produces no markup and no request. A game's only duty is to
   pass the seat it actually has, which pass-and-play does not have.
6. **The enrol prompt**, `useEnrollPush(GAME_ID)`, offered once in the
   lobby after seating. Push subscriptions are scope-tagged per game, so a
   player who enabled push in the word game gets **no** Acquire turn
   pushes until they enable it here too; on iOS each installed app is a
   separate storage anyway. Email is per person and carries over once the
   seat is bound. The prompt's copy should say so plainly rather than
   imply push is already on.
7. **The landing**, `?key=` and `?invite=`, on `RoomPage`, resolved before
   the socket connects, as the word game's outer `RoomPage` does it.
8. **Pre-join, ported whole (ruling 6).** Everything the 2026-09-06 plan
   gave the word game's `RoomView`, for Acquire's online room:
   - `useRoom` opts into `useLobbyRoom`'s `preview` mode, so a device with
     no stored identity views the roster (`viewRoom`) instead of
     auto-joining, and "Sit here" is the explicit `join()`.
   - The chooser (A1), and its mid-game variant with no "Sit here" (A2b).
   - "That's me" on an occupied row (A2): `requestSeatSignin`, then the
     vague sent state or the cooldown (C1). The reserved row takes "That's
     me" too, which resends the live invite; this needs Phase 4's
     invites to mean anything, and until then no Acquire row is reserved.
   - The dead-link view rebuilt to B1: "Email me a new link"
     (`refreshInvite`, with the dead token kept from the landing),
     "Continue to the room" (to the chooser), "Go home". Acquire's
     existing `RoomGone` and `RoomRefused` are the screens this replaces.
   - The footer's "Signed in on another phone?" pointing at the That's-me
     rows.

   `PreJoin.tsx` is word-game code. Following ruling 4's pattern, its
   state (which sheet is open, the sent/cooldown outcome, the dead-link
   token) moves to a hook in `packages/lobby/client` or
   `packages/notify/client` (whichever the import boundary allows; it
   calls notify's `requestSeatSignin`, so probably notify), and both games
   keep presentational screens. The word game's `PreJoin` and
   `RoomPage.invite` tests must pass unchanged across the extraction.
   Acquire's `rooms.test.ts` refusal tests stay as they are: the server
   side of the reclaim retirement already applies to Acquire.
   The 2026-09-06 known issue (a push-only player cannot reclaim on a new
   device) comes with the port, unchanged.

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
   Bump `SAVE_VERSION` to 6 with `state` optional and `pending` added
   (ruling 5). `hasEnvelope` requires an exact version match, so every
   version-5 record is quarantined at the first boot of the new build;
   that is the intended outcome, and the quarantine directory can be
   deleted by hand afterwards. Say so in the store comment, so the bump
   does not read as an accident.
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
- **A shared `useMyGames`**, if Phase 3 shows it is as generic as it
  looks. (`PreJoin`'s logic is no longer a wish; ruling 6 schedules it.)
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
- Second owner round: saves are disposable (bump `SAVE_VERSION`, no
  compatibility), the full pre-join port replaces the one-call seat
  sign-in, and the online-only rule moves into the shared notify client.
- Added: the bell must be online-only (pass-and-play shares `GameScreen`),
  and push being scope-tagged means enabling it in one game does not
  enable it in another.
