# Invites and friends: the per-game UI checklist

**Status:** handoff checklist, 2026-09-02. The Wordgame column is
planned 2026-09-05 in
[docs/plans/2026-09-05-invites-and-friends.md](../docs/plans/2026-09-05-invites-and-friends.md)
(P6 deferred with mid-game claims). Companion to
[2026-09-01-email-invites-and-seat-keys.md](2026-09-01-email-invites-and-seat-keys.md)
and [2026-09-02-friends.md](2026-09-02-friends.md), covering the UI both
owe together, because a friend picker cannot ship without the reserved
seat row the parent spec introduces. Written for design first and the
implementer second: the patterns are the same in every game regardless of
visual treatment, so each pattern is described once, and each game gets a
checklist of where it lands and what already exists there.

**Scope, ruled 2026-09-02: the stock lobby kit only.** Acquire and
Wordgame are the deliverable. Rail Baron and Marco Polo are surveyed
below so the map is not lost, and marked deferred; nothing in them is
owed until they are brought into scope. **Pass & play is excluded**
(Acquire's `PassAndPlayPage` and `PassAndPlayGamePage`). There are no
seats to invite anyone to.

## Four UI families

The games render the lobby four ways, and the checklist is organised by
that rather than by game, because two games share one.

| Family | Games | Where |
| --- | --- | --- |
| **The stock lobby kit** | Acquire, Wordgame | `games/<game>/src/game/lobby/`: `LobbyCard`, `SeatRow`, `RoomLobby`, `JoinRoomCard`, `ShareRoomButton`, `RoomGone`, `RoomRefused`, `StaleClient`, `ConnectionStrip`. **The same files, duplicated in both games.** |
| **Rail Baron's board screens** *(deferred)* | Rail Baron | `ScreenDef`s in `src/board/screens/online.ts` (`onlineLobby`, `joinRoom`, `roomGone`, `roomRefused`, `staleClient`), drawn by the board renderer from `OnlineApp.tsx`. |
| **Marco Polo's pool** *(deferred)* | Marco Polo | `client/src/screens/`: `LobbyPanel`, `HomeScreen`, `JoinScreen`, `RoomScreen`, `GameScreen`. Real-time, no turns. |
| **Wordgame's home** | Wordgame only | `HomePage` with the "my games" cards (`useMyGames`) and the only `NotificationSettings` panel in the repo. |

**A decision to make before the kit work starts:** every stock-kit change
below is made twice, or the kit is extracted to a shared package once.
The PWA spec already pulls `StaleClient` out; the reserved seat row and
the picker are the second and third reason to pull the rest. This
checklist writes each kit item once and marks it *(x2)*; if the kit is
extracted first, the x2 disappears.

## Built once, with no per-game UI

Listed so nobody designs or builds them per game.

- **Lobby server:** pending seats, claim by invite token, revoke, the
  roster broadcast carrying "invited, unclaimed", the conformance tests
  every game's lobby runs (parent spec, section 2).
- **Lobby client view model:** `LobbySeat` in
  `packages/lobby/client/view.ts` grows a `pending` variant and a
  `canRevoke` flag (host, unclaimed seat, lobby or game). Every game
  renders from this type, so the state exists once.
- **Notify client package** (friends spec prerequisite): `playerKey`,
  the API client, `useNotifyBind`, plus new hooks for contacts, invite,
  and key redemption, and the push-enrollment logic the PWA spec wants at
  the key landing. Headless; each game supplies the surface.
- **The invite as received:** push copy and the invite email template
  live in `packages/notify`. The only per-game input is the game title
  already registered with notify.

## The pattern catalogue

Seven patterns. Each one lists its components, its states, and where it
appears. Games differ only in *which* surface hosts it.

### P1. The reserved seat row

A seat that is held for someone who has not arrived.

- **Components:** the seat row in its third state (beside occupied and
  empty), and a **revoke** affordance on it for the host.
- **States:** `occupied` (existing), `empty` (existing), `reserved`:
  name shown when the invite was by contact; a neutral "Invited" when it
  was by email, because the address must never appear. Reserved rows
  draw no presence dot (nothing is connected) and are never renameable.
  Revoke: idle, confirming (one tap is easy to misfire on a phone),
  done (row returns to empty).
- **Appears:** lobby roster; in-game roster (P6).

### P2. The invite control and picker

How a seat gets reserved.

- **Entry point:** one control, host-only, shown while the room has an
  open seat. In the lobby it sits with the existing share action, which
  is the current "invite" and stays. Mid-game it needs a home of its
  own (P6).
- **Picker, two ways in:** a list of past co-players by name, and an
  email field. Design one control with two modes rather than two
  controls.
- **Contact row states:** `reachable` (pickable); `unreachable` (visible,
  not pickable, with an actionable reason such as "hasn't turned on
  notifications"); `alreadySeated` (in this room already). Each row
  shows name, when you last played, and which game.
- **List states:** loading; empty ("nobody yet, play a game first");
  populated; the caller has no notify profile at all (storage blocked),
  which reads the same as empty.
- **Send states, contact mode:** sending; sent (row becomes P1 reserved
  in the roster, the picker can close or stay for a second invite);
  refused with reason: `unreachable`, `alreadySeated`, `rateLimited`
  (daily cap), `roomFull` (the seat went while the picker was open).
- **Send states, email mode:** typing; invalid address; sending; sent;
  refused: `rateLimited` (per-address cap), `emailUnavailable` (channel
  not configured on this deployment, which is the LAN machine today),
  `roomFull`.
- **Appears:** lobby; in-game while a seat is open.

### P3. Landing on a link

The moment a `?key=` or invite link opens the room. Parent spec, section
1: the page loads, the client POSTs, then the ordinary join runs.

- **States:** `redeeming` (brief, but real on a phone); `redeemed`, which
  hands off to the normal join and, for an invite, should say a seat was
  held and is now yours; `refused`, one shape for invalid, revoked,
  rotated, and unknown, deliberately indistinguishable, with the way
  forward being "join as a new player" or "go home"; `alreadyHere`, the
  link was for a seat this device already holds (a no-op that should
  not look like an error).
- **Mid-game arrival:** the claimer is slotting into a running game with
  a fresh tray, next after the current player. The first thing they see
  is the board, so the arrival needs a moment of orientation ("you're in,
  you play after Sam") that the lobby arrival does not.
- **Then P4**, on every platform: this is where push enrollment is
  offered.
- **Appears:** the room page, before either lobby or game renders.

### P4. Push enrollment at the landing

Owed by the PWA spec, listed here because it shares P3's moment.

- **States:** `offer` ("get these as notifications on this device?");
  `enabled`; `declined` (remembered, not re-asked every landing);
  `unsupported`; `needsInstall` (iOS in Safari: push needs the home-
  screen app, so the offer becomes an "add to home screen" explainer
  and the ask repeats once inside the installed app).
- **Appears:** the room page, after P3 redeems; also reachable from P5.

### P5. Notification settings

Where a person becomes reachable, which under the friends spec is what
makes them invitable by name.

- **Components:** an entry point (home and in-game, so a player can turn
  on notifications without leaving a game) and the panel.
- **States:** push `unsupported` / `denied` / `off` / `on`; email `none`
  / `pending confirmation` (with resend and its 3-a-day cap) /
  `confirmed` / `disabled by unsubscribe`; the two prefs toggles; the
  whole panel in its `channels not configured` state, which is the LAN
  deployment and must not read as broken.
- **Appears:** home; in-game.
- **Exists today:** Wordgame only (`NotificationSettings`, mounted in
  `HomePage` and `GameScreen`).

### P6. The in-game roster with a reserved seat

A pending seat is outside the game (no tray, not in the rotation), but
it is still a fact about the room.

- **Components:** wherever the game already lists players in play
  (chips, score panel, turn order), a way to show a reserved seat that
  is clearly not a turn; the host's revoke; the P2 entry point while a
  seat is open.
- **States:** as P1, plus `justClaimed` (the roster gains a live player
  mid-game, which every other player should notice).
- **Appears:** the game screen.

### P7. The invite as received

Not a screen in any game, but design owns the words.

- **Push:** title, body, one action, opening the room link. Names the
  inviter (their last-played name) and the game.
- **Email:** a new template beside the turn and confirmation mails. Same
  content, plus the unsubscribe footer the others carry.
- **Exists today:** the turn mail and the confirmation mail, as
  precedent for tone.

## Per-game checklists

Each list is what that game must do, over and above the shared work.
"Exists" names the component the pattern lands in.

### The stock lobby kit (Acquire and Wordgame)

Prerequisite for Acquire: adopt the notify client (one `useNotifyBind`
call in `RoomPage`, as Wordgame has). Wordgame has it.

- [ ] P1 `SeatRow` gains the reserved state and the revoke affordance
      *(x2)*. Exists: `LobbyCard.tsx`, `SeatRow`.
- [ ] P1 `RoomLobby` renders reserved rows from `LobbySeat.pending` and
      wires revoke *(x2)*. Exists: `RoomLobby.tsx`.
- [ ] P2 invite entry point beside `ShareRoomButton` under the code
      block; the picker itself *(x2, or once if the picker is a shared
      notify-client component styled through `--lobby-accent`)*.
      Exists: `RoomLobby.tsx`, `ShareRoomButton.tsx`.
- [ ] P3 landing states in `RoomPage`, before the phase switch that
      picks lobby, game, gone, stale, or refused *(x2)*. Exists:
      `pages/RoomPage.tsx`.
- [ ] P4 enrollment prompt after landing *(x2)*.
- [ ] P5 Acquire: settings entry on `HomePage` and in `GameScreen`, and
      the panel (shared code, game styling). Wordgame: done, restyle only
      if the shared panel replaces it.
- [ ] P6 in-game roster. Wordgame: the roster chips in `GameScreen`
      (`view.players`). Acquire: the player panel in `game/panel/`.
      Plus the mid-game P2 entry point in each.
- [ ] Wordgame home: nothing new. An unclaimed invite has no identity on
      this device, so it cannot appear in "my games" until claimed, at
      which point the existing cards cover it.

### Rail Baron (deferred)

Not in scope. Kept as the survey for when it is.

Prerequisites: adopt the notify client (no bind call exists today), and
a settings surface (none exists).

- [ ] P1 reserved seat and revoke in the `onlineLobby` `ScreenDef`.
      Exists: `board/screens/online.ts`.
- [ ] P2 invite entry point and picker as board screens, or as a React
      overlay over the board. The picker is a list with text input,
      which the `ScreenDef` vocabulary may not have; this is the one
      place the treatment decision changes the build. Exists: the
      `joinRoom` screen as the nearest precedent for text entry.
- [ ] P3 landing states in `RoomApp` before `RoomBoard` renders.
      Exists: `OnlineApp.tsx`.
- [ ] P4 enrollment prompt after landing.
- [ ] P5 settings entry on the home screen and in-game, and the panel.
      Nothing exists.
- [ ] P6 in-game: the reserved seat in the turn-order and standings
      display, the mid-game P2 entry point, the just-claimed moment.

### Marco Polo (deferred)

Not in scope. Kept as the survey for when it is.

Two prerequisites, one more than the others. Marco Polo does **not
register with notify at all** (the other three servers do). Registering
needs only `verifySeat`, `isConnected`, and `roomPath`; a real-time game
simply never calls `turnChanged`, and that is fine: registration is what
unlocks invites and the co-player ledger, and turn reporting is
optional. Then the notify client, as for Rail Baron.

- [ ] P1 a reserved swimmer in `LobbyPanel`. The redesign removed the
      seat list in favour of swimmers in the water, so "reserved" is a
      swimmer that is not there yet, plus the host's revoke. Exists:
      `screens/LobbyPanel.tsx`.
- [ ] P2 invite entry beside the existing share button in `LobbyPanel`,
      and the picker.
- [ ] P3 landing states in `RoomScreen` before the lobby/game split.
      Exists: `screens/RoomScreen.tsx`.
- [ ] P4 enrollment prompt after landing. Push here is invite-only
      (there are no turns), and the copy should say so.
- [ ] P5 settings entry on `HomeScreen` and the panel, in the pool's
      voice.
- [ ] P6 in-game: a claim mid-game is a swimmer diving in, not a rotation
      slot. Simpler than the turn-based games; needs the arrival moment
      and, if a seat is open, the P2 entry.

## Order of work, suggested

1. Shared: lobby pending seats and `LobbySeat`, notify client package,
   invite email template. Nothing visible yet.
2. Wordgame end to end (it has the settings panel and the bind already):
   P1, P2, P3, P4, P6 on the kit, proving the patterns.
3. Acquire: the same kit changes (or the kit extraction, then adoption),
   plus P5.

Rail Baron and Marco Polo follow when they are brought into scope, each
with its prerequisites first; the deferred sections above are their
starting point.
