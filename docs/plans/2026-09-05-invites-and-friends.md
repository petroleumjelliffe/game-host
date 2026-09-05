# Invites and friends: the wordgame slice, planned

**Status:** planned 2026-09-05; adversarially reviewed against the source
the same day and revised — the review's fifteen findings and their
resolutions are folded in below, the load-bearing ones called out where
they changed the design.
**Implements:**
[specs/2026-09-01-email-invites-and-seat-keys.md](../../specs/2026-09-01-email-invites-and-seat-keys.md)
(all six sections),
[specs/2026-09-02-friends.md](../../specs/2026-09-02-friends.md) (all five
pieces), and the Wordgame column of
[specs/2026-09-02-invites-ui-checklist.md](../../specs/2026-09-02-invites-ui-checklist.md).
**Design source:** the Claude Design canvas "Word Game Invite Flow"
(project *Word Game UI Updates*, `Word Game Invite Flow.dc.html`) — seven
screens: the host's lobby with per-seat Invite buttons, the picker as a
bottom sheet, the reserved seat row with Remind and Revoke, the claim
moment, and the invitee's ping, landing screen, and waiting lobby.

## Scope rulings, made 2026-09-05

Four decisions were put to the owner before planning; their answers are
the shape of this plan.

1. **The whole parent spec ships**, seat keys and the 24-hour auto-remind
   included — not just the pieces the lobby flow strictly needs.
2. **Claims are lobby-only in this slice.** `beginGame` auto-revokes any
   unclaimed reserved seat, so a pending seat never exists inside a
   running game. The parent spec's mid-game claim (pending seat outside
   the rotation, fresh tray, next-after-current insertion) and the UI
   checklist's P6 are **deferred to a later plan** — that is the one
   engine-touching chunk this plan deliberately does not open. The
   parent spec's "a pending seat is outside the game" rule survives
   trivially: no game ever begins with one.
3. **Email invites ship now**, both picker tabs live. On the LAN deploy
   (no SMTP) the email tab shows the `emailUnavailable` state, which is
   "unconfigured means off, not broken" wearing UI.
4. **The notify client is extracted to `packages/notify/client/` first**,
   per the friends spec's prerequisite, so the new hooks are born shared
   and Acquire adopts later with no churn. Wordgame is still the only
   game with a surface in this slice.

## Deltas from the specs and the design, recorded up front

Each of these is a deliberate refinement, not drift; the specs get an
"As built" note for them when this lands.

- **Invite entry point** lives on each empty seat row (the design's
  ruling: "inviting fills *this* seat"), not beside `ShareRoomButton` as
  the checklist sketched. No mechanism changes — the lobby allocates the
  next free seat id either way — but the affordance is per-seat.
- **Claiming is an HTTP POST to notify, not a `joinRoom` variant.** The
  parent spec had `joinRoom` presenting the invite token; this plan
  instead gives the contract a `claimSeat` capability and lets the
  landing page POST the token to notify, which converts the pending seat
  and answers with the live `(playerId, token, name)`. That makes
  `?invite=` and `?key=` land through **one identical client path**
  (POST, save identity, strip param, ordinary join), gives notify the
  claim moment it needs anyway (stamp `claimedAt`, mint the seat key,
  confirm the email, bind the profile), and keeps invite tokens out of
  the lobby protocol entirely. The lobby still enforces the spec's real
  rule: `seatPlayer` never hands a pending seat to an ordinary joiner.
- **`reserveSeat` carries the token hash and a display name:**
  `reserveSeat(roomId, tokenHash, name | null)`. The spec's indicative
  signature had neither, but the pending seat must hold the hash (it is
  what `claimSeat` matches) and the roster must show the contact's name
  (or nothing, for email — the address never enters game state).
- **`GameTurnReporter` grows `seatVacated(roomId, playerId)`** — a
  contract addition neither spec named, forced by two review findings.
  A revoked or auto-revoked pending seat leaves an `InviteRecord`
  behind; without a signal, the plan's "an existing unclaimed invite is
  a resend" rule would mail the **same dead token** on re-invite, with
  no error anywhere. And a lobby leaver's binding otherwise lives
  forever: seat ids are reused, so binding *sets* (below) would union
  unrelated people onto one seat and `alreadySeated` would refuse to
  re-invite someone who left. The game reports every vacated seat —
  revoke, begin's auto-revoke, `leaveSeat` — through the reporter it
  already holds; notify clears that seat's bindings and marks its
  unclaimed invites dead, so a re-invite reserves fresh. Same direction
  and trust as `turnChanged`.
- **No protocol version bump, anywhere.** The roster's new `pending`
  field is **optional and additive** (`pending?:` on `RosterMessage`,
  absent read as empty): an old client ignores it, an old test literal
  still typechecks, and none of the four games' `PROTOCOL_VERSION`s
  move. This matters more than it looks: `RosterMessage` is the
  *shared* lobby protocol emitted for every game, so a "bump for the
  roster change" would have to bump all four — and wordgame's restore
  **skips saves on protocol skew** (`server/rooms.ts:93`), so a bump
  would orphan every in-flight multi-day game and, worse, the client's
  `noSuchRoom` handling would clear the stored identity, making the
  seats unrecoverable even after a rollback. The stale-client machinery
  is for incompatible changes; this is not one.
- **Revoke rides the lobby socket, not a notify endpoint.** Host-ness
  lives in the lobby (`SeatHolder.isHost`); notify's `verifySeat` cannot
  see it. A new host-gated `revokeSeat` client event (same gate shape as
  `beginGame`) deletes the pending seat, rebroadcasts, and reaches
  notify via `seatVacated` above.
- **Server-side, any verified seat can invite; host-only is UI.** The
  design and checklist show invite controls to the host alone, and the
  wordgame UI honours that. The invite endpoint itself accepts any
  caller who proves a seat via `verifySeat`, because notify cannot check
  host-ness without further contract growth and the friends spec's
  structural defense ("by name you can only invite people who sat with
  you") doesn't need it to.
- **Binding happens in the lobby too, but the ledger writes only on
  play-phase binds.** The friends spec assumed bind fires at play phase
  only; the design's picker needs "Lee — already in this room" *in the
  lobby*, and that state is computed from `bindings`. So `useNotifyBind`
  fires on seated (lobby and playing) and the bind request grows a
  `phase: 'lobby' | 'playing'` field; contact-ledger entries are written
  only for `playing` binds, preserving "the ledger records people you
  actually played with". A lobby claim therefore does **not** write
  ledger entries — the claimer's play-phase bind does, minutes later,
  when the game starts. (The friends spec's test list says "claim-path
  binds included"; that line is amended by this ruling for *lobby*
  claims, and comes back with mid-game claims.) The phase field is
  client-reported and only affects the reporter's own ledger timing,
  which is the same trust level as the bind itself. `alreadySeated` is
  **advisory, not a guarantee**: a player whose storage is blocked, or
  who closed the tab before the bind effect ran, never binds and shows
  as invitable; the invite then reserves a seat they won't need, and
  revoke covers it.
- **The conformance target grows an optional server-side hook.** The
  suite is wire-only (`{name, protocolVersion, socketPath, start,
  stop}`), and reserving is a registry call with no wire verb — so the
  pending-seat conformance tests cannot be driven over a socket.
  `LobbyConformanceTarget` gains
  `reserve?(roomId, tokenHash, name) => string | null`; the
  pending-seat tests run only when a target supplies it. Wordgame does;
  Marco Polo (which runs the suite and has no notify registration at
  all) does not and stays green. The one unconditional addition:
  every roster carries `pending` (empty array included) with no hash in
  it.
- **Remind is the invite resend, surfaced.** The design gives the
  reserved row a primary **Remind** action; mechanically it is the
  parent flow's "a repeat within the caps is a resend, never a second
  reservation", re-sent through the same channels, capped at 3 per
  (inviter, target) per UTC day. The parent spec's "no manual nudge in
  v1" ruling was about *turn* reminders and stands untouched.
- **The invite email's footer comes in two variants.** The unsubscribe
  token is minted at confirmation, and for a first-contact email invite
  confirmation *is* the claim — so at send time there is no token to
  link. A first-contact invite mail carries a static "ignore this and
  nothing more will be sent" line (the per-address cap is the real
  enforcement); an invite delivered to an already-confirmed address
  (profile-targeted, email channel) carries the real unsubscribe link
  like every other mail. `sendInvite`'s signature makes the link
  optional.
- **The PWA spec's scope-tagged subscriptions are not built here.** With
  one game enrolled, every subscription is wordgame's, so the friends
  spec's "prefer matching scope, fall back to any" ruling is satisfied
  by construction. The fallback rule is written into the send code
  anyway so scope tags can arrive later without touching invites.

## Current state, in one paragraph

Confirmed by survey 2026-09-05: none of this exists. No pending seat
(`SeatHolder` is `{id, name, token, isHost, connected}` and the roster
knows occupied or nothing), no invite record, no seat key, no profile
display name, no contact ledger, no invite email template, and no
landing states in `RoomPage`. What does exist and is load-bearing:
wordgame's full notify client (`playerKey`, `api`, `useNotifyBind`,
`NotificationSettings` with real Web Push subscribe, `public/sw.js`
displaying `{title, body, url}` pushes generically — invite pushes need
no worker change), the lobby conformance suite, notify's fake channels,
and the `--lobby-accent` custom-property seam in the stock kit. Two
absences the review surfaced are now load-bearing too: **nothing in the
repo calls `roomRemoved`** (wordgame's eviction deletes saves silently),
and **nothing ever removes a notify binding** — both get fixed on the
way through rather than built on.

## The work, in order

Each task leaves `npm test`, `npm run typecheck`, and `npm run lint`
green; nothing user-visible appears before task 7.

### 1. Host contract: three capabilities, one report

`packages/host/contract.ts`. On `NotifyGameRegistration`, all optional
so Marco Polo and Rail Baron's registrations stay valid:

```ts
reserveSeat?(roomId: string, tokenHash: string, name: string | null): string | null;
claimSeat?(roomId: string, tokenHash: string): { playerId: string; token: string; name: string } | null;
getSeatCredentials?(roomId: string, playerId: string): { playerId: string; token: string; name: string } | null;
```

The seat's `name` rides along because the client must write a whole
`RoomIdentity` (`{ playerId, token, name }`) into the identity store at
the landing — without it the redeeming device has credentials but
nothing to call itself. `getSeatCredentials` is a **pure read**: no
save, no broadcast — it runs on every emailed-link click.

On `GameTurnReporter`, optional for the same reason:

```ts
seatVacated?(roomId: string, playerId: string): void;
```

fired by the game whenever a seat empties outside normal disconnect —
revoke, begin's auto-revoke of pending seats, and `leaveSeat`. Notify
uses it to drop the seat's bindings and kill its unclaimed invites (the
delta above explains why both matter). Same-process trust, same shape
as `verifySeat`. Update the contract comment naming the seat token as
the only identity proof to name the seat key as its emailed proxy, per
the parent spec. Notify treats a registration without the capabilities
as a game that cannot host invites (`noSuchGame`-shaped refusal on the
invite endpoint).

### 2. Lobby: pending seats

`packages/lobby/server/rooms.ts` and `handlers.ts`:

- `PendingSeat { id: string; tokenHash: string; name: string | null; invitedAt: number }`.
  `LobbyRoomLike` grows `pending?: PendingSeat[]` — optional, so the
  generic-consumer tripwire (`genericConsumer.test.ts`) keeps compiling
  and games without invites change nothing.
- Registry methods: `reserve(roomId, tokenHash, name)` allocates the
  first seat id free of both `players` and `pending` (null when none),
  `claimByHash(roomId, tokenHash)` converts a matching pending seat into
  a normal `seatPlayer`-shaped holder with a fresh `randomUUID()` token
  (null otherwise, one shape for absent room / absent hash / already
  claimed), `revoke(roomId, playerId)` deletes a pending seat only. A
  null-named pending seat (an email invite) claims under the default
  `Player N` name; the claimer renames in the lobby like anyone else.
- `seatPlayer` grows a fourth, optional parameter:
  `seatPlayer(space, taken, name?, reservedIds?: readonly string[])`.
  Allocation excludes reserved ids; **`isHost` stays
  `taken.length === 0`, players only** — pending seats are not people.
  This is not pedantry: folding pending ids into `taken` would seat the
  next joiner of an emptied-but-reserved room as a non-host, leaving a
  room where nobody can begin *or* revoke. With the rule as written,
  the first person to join such a room is host and can do both.
  Existing callers pass no fourth argument and are untouched.
- The honor-system reclaim cannot match a pending seat (it matches on
  `!connected` *players*, and only when the lifecycle has left the
  lobby, where pending seats no longer exist).
- `beginGame` clears `room.pending` before `onBegin` — the auto-revoke
  ruling — and the roster broadcast that follows shows the seats freed.
- `RosterMessage` grows **optional** `pending?: { id: string; name: string | null }[]`
  (never the hash, never an address; absent reads as empty — see the
  no-bump delta). The shared handlers always emit it, so existing test
  literals typecheck and new assertions can rely on it. New host-gated
  `revokeSeat` client event, gated exactly as `beginGame` is, answering
  `notYourTurn` / `wrongStage` by the same codes; `createLobbyHandlers`'
  registry `Pick` grows `revoke`. `LobbyHooks` grows
  `onSeatVacated?(room, playerId)`, fired on revoke, on each pending
  seat cleared by begin, and on `leaveSeat` — the game's bridge to
  `seatVacated`. Every roster/pending mutation fires `onRosterChanged`
  so games persist it.
- `client/view.ts`: `LobbySeat` grows `pending: boolean` and
  `canRevoke: boolean` (you are host, seat is pending). `lobbyView`
  orders occupied, then pending, then empty padding; pending rows have
  `id`, a `name` that may be null (render "Invited"), no presence, never
  renameable. `canBegin` ignores pending seats — they don't count toward
  `minPlayers`, matching the design's "2 of 4 here · 1 seat reserved"
  with Start still locked. Any "filled" arithmetic must count
  **occupied** rows (`id !== null && !pending`), not non-null ids as
  today. Acquire renders from this same type; its server never
  reserves, so `pending` is always false there and its UI behaves
  exactly as before — but it must keep compiling, which the optional
  roster field and additive `LobbySeat` fields guarantee.
- Conformance suite: `LobbyConformanceTarget` grows the optional
  `reserve` hook (delta above). Hook-gated tests: a reserved seat is
  invisible to ordinary joiners; `claimByHash` mints a token that
  rejoins; revoke is host-only; begin clears pending. Unconditional:
  the roster carries `pending` and never a hash. Marco Polo supplies no
  hook and runs only the unconditional additions.

### 3. Wordgame server: implement the capabilities, persist the state

- `server/room.ts` / `rooms.ts`: `GameRoom` carries `pending`;
  `persist` writes it (`SavedRoom` grows optional `pending`, guarded in
  `isSavedRoom`; old saves lack the field and load fine, so
  `SAVE_VERSION` stays 1 — and **`PROTOCOL_VERSION` stays 1 too**, per
  the no-bump delta); `restore` adopts it back, which threads `pending`
  through `createGameRoom(roomId, players, dictionary, state)` — that
  signature grows the parameter.
- `server/index.ts` registration grows `reserveSeat` / `claimSeat`
  (each followed by `save(room)` and `lobby.broadcastRoster(room)` so
  the reserved row appears live on every phone in the lobby) and
  `getSeatCredentials` (read-only, no save, no broadcast). The lobby
  hooks wire `onSeatVacated` to `notifier?.seatVacated`.
- **Eviction learns to speak.** `restore`'s age-based eviction removes
  the save and now also calls `notifier.roomRemoved(roomId)` — the
  contract method that, per the review, *nothing in the repo has ever
  called*, leaving notify's room records immortal. The protocol-skew
  `continue` stays silent on purpose: a skipped room may come back
  under a rollback, so its notify state must survive. Registration
  precedes `restore` in the boot order; assert that with a test rather
  than a comment.

### 4. Notify records and store

`packages/notify/records.ts` and a third `jsonStore` directory:

- `ProfileRecord` grows `name?: string` (trimmed, capped at 40 chars,
  last-writer-wins) and `contacts?: ContactRecord[]` — the friends
  spec's shape verbatim (`contactId` random per owner, `profileIds`
  internal, `name`, `gameId`, `lastRoom`, `lastPlayedAt`,
  `status: 'played' | 'pending' | 'accepted' | 'blocked'`), capped at
  100, oldest-`lastPlayedAt` evicted.
- `RoomRecord.bindings` becomes `Record<string, string[]>`. The guard
  *widens* to accept the legacy scalar, and — because a type predicate
  has no return channel — **normalization happens at the load site**
  where `service.ts` fills its `rooms` map, converting a scalar to a
  one-element array before anything iterates it. This distinction is
  the difference between working and a silent production-only failure:
  a string put through the fan-out loop iterates as 64 one-character
  "profileIds" and drops every notification for every pre-migration
  room. A test loads a literally legacy-shaped file from disk and
  proves the send still lands. No write-back pass: a record re-saves in
  the new shape the next time something binds into its room, and until
  then the load-site shim keeps it correct.
- `RoomRecord` grows `seatKeys?: Record<playerId, { keyHash, seatTokenHash, mintedAt }>`
  (the parent spec's one durable key per seat, hashed at rest; the seat
  token's hash rides along so a rotated seat token is detectable) and
  `currentTurn?: { playerId, turnKey, notifiedAt, remindedAt? }` — the
  reminder bookkeeping, written under the same marker-before-send
  discipline as `lastNotified`.
- `InviteRecord { tokenHash, target: { kind: 'email'; address } | { kind: 'profile'; profileIds: string[] }, gameId, roomId, playerId, inviterProfileId, createdAt, claimedAt?, revokedAt?, sendDay?, sendCount?, inviterDay?, inviterDayCount? }`
  in `DATA_DIR/notifications/invites/`, keyed by `tokenHash`
  (`SAFE_KEY`-clean by construction). `revokedAt` is stamped by
  `seatVacated`; a revoked record refuses claims and is skipped by the
  resend branch, so re-inviting the same person reserves fresh instead
  of re-mailing a dead token.

### 5. Notify service and routes

The substance. All of it behind the existing "unconfigured means off"
posture.

- **Bind grows `name` and `phase`.** Name stamps the profile; a
  `playing` bind appends the profile to the seat's binding *set* and
  writes reciprocal contact entries per the friends spec's four rules
  (same-seat profiles never pair; merge by `profileIds` overlap;
  re-binds are no-ops unless `profileIds`, `name`, or `lastRoom`
  changed; cap evicts oldest). A `lobby` bind writes the binding set
  only. `seatVacated` clears the seat's binding set, which is what
  keeps a reused seat id from unioning strangers into one set — the
  review's sharpest catch, since today's last-writer-wins scalar was
  accidentally masking exactly that.
- **`POST /notify/contacts { playerKey, game?, roomId? }`** → rows of
  `{ contactId, name, lastPlayedAt, gameTitle, reachable, alreadySeated? }`.
  `reachable` = any enabled channel across the entry's profiles, prefs
  respected; `gameTitle` falls back to the bare `gameId` for an
  unmounted game; `alreadySeated` is computed against the room's binding
  sets when room context is given — advisory, per the delta. Never an
  address, never a `profileId`; a foreign or fabricated `contactId`
  resolves to the same shaped nothing.
- **`POST /notify/invite`** — both target shapes,
  `{ playerKey, game, roomId, playerId, token, email }` or `{ …, contactId }`.
  Order per the friends spec: verify the caller's seat, then refuse
  `unreachable` / `alreadySeated` / `blocked` / `rateLimited` /
  `emailUnavailable` / invalid address **before** reserving, so nothing
  dangles; then an existing **live** (unclaimed, unrevoked) invite for
  (room, target) is a **resend** — never a second reservation; this is
  the Remind button's whole mechanism — while a revoked one is dead
  weight and the flow reserves fresh; otherwise `reserveSeat`, mint the
  token (`newToken()`), store the record, deliver. Caps: 3 per
  (inviter, target) per UTC day, 20 per inviter per UTC day, counted
  the same way the email-confirmation cap is. An address-targeted
  invite also counts per address per UTC day, tallied across that
  address's invite records at send time — the existing per-address
  counter lives on a profile's `EmailRecord`, and an invited address
  has no profile yet, so the invites carry their own count. `roomFull`
  is `reserveSeat` returning null.
- **Delivery.** `InvitePayload` joins `TurnPayload` in `channels.ts`;
  `PushSender.send` widens to take either (the real branch lands in
  `webPush.ts`, where the wire copy actually lives — `channels.ts`
  alone doesn't send anything), and `EmailSender` grows
  `sendInvite(to, payload, roomUrl, unsubscribeUrl?)` — the optional
  link per the two-variant footer delta. The invite mail is its own
  template beside turn and confirmation, carrying who invited you (the
  inviter's profile name) to which game and room, one action; the room
  URL carries `?invite=<token>`. Push says the design's words — "Pete
  invited you to a game in room KTWQ. Your seat is saved — tap to claim
  it." — and needs no worker change. Profile-targeted invites fan out
  across the entry's `profileIds` and their channels **immediately**
  (no debounce, no presence check — the spec's reasoning: an invitee
  has no room to be looking at), email deduped by address. The fake
  channels grow `'invite'` in `RecordedEmail.kind` and the push
  recorder learns the new payload.
- **`POST /notify/invite/claim { inviteToken, playerKey? }`** → look up
  by hash (refusing claimed and revoked records), `claimSeat` on the
  game, stamp `claimedAt`, mint the seat key, answer
  `{ playerId, token, name }`. For an email-targeted invite, claiming
  **is** the double-opt-in: mark the address confirmed on the claiming
  profile and mint its unsubscribe token, per the parent spec. If a
  `playerKey` came along, bind it (`lobby` phase — the ledger waits for
  the game to start, per the ruling above). Every failure — unknown
  token, revoked, already claimed, dead room — is one shaped refusal.
- **`POST /notify/redeem-key { key }`** → hash, find the (room, seat)
  holding it, check the stored `seatTokenHash` still matches the live
  token from `getSeatCredentials` (a rotated seat means the key is
  dead), answer `{ playerId, token, name }`. Same single refusal shape.
- **Seat keys mint *or rotate* at send.** Minted at claim and at the
  first email about a keyless seat — and, the review's correction: at
  every email send the stored `seatTokenHash` is checked against the
  live seat token, and a stale key is **re-minted**, not merely left to
  refuse. Without that, one honor-system reclaim would poison every
  future email for that seat with a permanently dead link; the parent
  spec says *rotation*, old links dead and a new key live, and this
  delivers both halves. Mechanically this means the email URL becomes
  **per-seat**: `fire` (and the reminder) resolve the key before
  building `roomUrl`, and the existing
  `sendTurn(to, payload, roomUrl, unsubscribeUrl)` signature carries it
  — the per-recipient URL was always a parameter, it just never varied
  by seat before.
- **Fan-out.** The send loop iterates the seat's binding set: email
  deduped by address across profiles, dead push endpoints pruned as
  today. This is parent-spec §5 finishing what `bindSeat` started.
- **Auto-remind.** Not a naive 24-hour `setTimeout`: the process
  restarts on every deploy. `fire` records
  `currentTurn = { playerId, turnKey, notifiedAt }`, and **`turnChanged`
  clears any `currentTurn` whose `turnKey` it supersedes** (persisted) —
  without that, a turn whose notification was skipped because the player
  was present would leave the *previous* turn's entry standing and the
  sweep would remind for a turn already taken. The sweep runs hourly
  and once at startup — but **never before the games have mounted**:
  the notify service is created before any game registers, so a sweep
  inside the constructor would find no registration to resolve a title,
  a path, or a presence check against. `apps/host` kicks the first
  sweep after the mounts complete; the sweep **skips** (never deletes)
  rooms whose `gameId` has no live registration, since a game absent
  this boot may be back the next. Any `currentTurn` over 24h old gets
  one reminder (same `turnKey`, subject marked as a reminder,
  `remindedAt` written before the send), capped at one per turn, and
  `roomRemoved` — now actually called, per task 3 — clears the
  bookkeeping so evicted rooms cannot be reminded about.

### 6. The notify client package

`packages/notify/client/`, mirroring the lobby's split and its
`package.json` posture (`react` as a peer dependency, jsdom only in dev,
an import-boundary test proving `client/` never imports `service.ts` or
anything node-only — the lobby's `protocol/importBoundary.test.ts` is
the template). Moves, minus wordgame's styling: `playerKey.ts`,
`api.ts`, `push.ts`, `useNotifyBind.ts` (growing `phase` and `name`),
`useNotifyStatus.ts`, and the subscribe/unsubscribe/re-register logic
currently inlined in `NotificationSettings.tsx`, extracted as hooks.
New, headless: `useContacts(roomCtx?)`, `useInvite()` (send + resend,
returning the refusal reasons as data), `redeemLanding(params)` (the one
function that handles both `?invite=` and `?key=`: it POSTs, resolves to
`{ playerId, token, name }` or the refusal, and strips the param via
`history.replaceState` — the **caller** writes the identity, because
`createIdentityStore(appId)` is per-game and the shared package cannot
know an `appId`), and `useEnrollPush()` (the P4 card's brain: `offer` /
`enabled` / `declined`-and-remembered / `unsupported` / `needsInstall`
on iOS-in-Safari). Wordgame re-imports everything;
`NotificationSettings` refactors onto the shared hooks and keeps its
skin. Notify's vitest config gains the node/jsdom project split
wordgame already models.

### 7. Wordgame UI, to the design

All in the stock kit and `RoomPage`, styled by the canvas:

- **`SeatRow`**: empty rows gain an outlined **Invite** button (host
  only, lobby only); a new reserved variant — dashed amber border, no
  presence dot, "*Name* · invited, not here yet" (or "Invited" for
  email), **Remind** outlined primary, **Revoke** as a text action that
  asks twice (idle → confirming → done, per checklist P1). A
  `justClaimed` flourish: the row that converts from reserved to live
  wears a green ring for six seconds, "just joined". **Rows key and the
  flourish matches by seat *id*, not display index** — the review
  showed that with two pending seats, the later one claiming first
  shifts the earlier one's index, and an index-keyed ring would attach
  to the wrong person. (`seatEmoji(index)` already shifts on any
  roster change today; that pre-existing looseness is not worsened and
  not fixed here.)
- **The picker**: a bottom sheet over the dimmed lobby (the room stays
  visible behind it, per the design), two-mode segmented control —
  "People you've played with" / "By email". Contact rows show name,
  game title, and relative last-played; states per checklist P2:
  reachable (Invite), sending, sent (row's seat goes reserved in the
  roster behind the sheet, which can stay open for a second invite),
  unreachable (visible, unpickable, "hasn't turned on notifications"),
  already in this room. List states: loading, empty ("nobody yet — play
  a game first"), no-profile-reads-as-empty. Email mode: field,
  invalid, sending, sent, `rateLimited`, `emailUnavailable`, `roomFull`.
  The sheet is wordgame's component over the shared hooks; if Acquire's
  adoption later shows it is pixel-identical, extraction through
  `--lobby-accent` is that plan's call, not this one's.
- **`RoomLobby`**: renders pending rows and the seat note in the
  design's voice ("2 of 4 here · 1 seat reserved") — which means the
  `filled` count moves off `seat.id !== null` (a pending row has an id)
  onto the occupied test, and the existing seat-note assertion in
  `RoomPage.test.tsx` updates with it — and wires Invite, Remind
  (resend via `useInvite`), and Revoke (lobby socket event). Acquire's
  duplicate kit is deliberately untouched; the shared-type changes keep
  it compiling and behaviourally identical (no pending rows ever reach
  it).
- **Landing in `RoomPage` — restructured, because a render branch
  cannot stop a hook.** `useRoom` runs at `RoomPage`'s top level and
  `useLobbyRoom` reads identity once at mount, then joins the moment
  the socket opens; an async redemption racing that effect would join
  as a *new* player first, claim second — two seats for one person, and
  the claimed credentials unused until a reload. So `RoomPage` splits:
  a thin wrapper resolves the landing (`?invite=` / `?key=` →
  `redeemLanding` → write identity via the game's store), and only then
  mounts the inner component that owns `useRoom` — which therefore
  reads the just-written identity on *its* mount and joins the claimed
  seat, never a fresh one. No param means the wrapper mounts the inner
  component immediately, today's behaviour. Landing states: a brief
  `redeeming`, then the design's claim screen — "You're in, *Sam* 🎉",
  "*Pete* saved you a seat in room KTWQ. It's yours now — this device
  remembers it", **Go to the room**, with the `useEnrollPush` card
  folded in ("Get a ping when it's your turn?") — then the ordinary
  join. `refused` is one screen for every bad token, offering "join as
  a new player" or home; `alreadyHere` (the stored identity already
  matches) skips straight through without ceremony. Declined enrollment
  is remembered and not re-asked each landing.
- **Home**: nothing. An unclaimed invite has no identity on this device,
  so it cannot appear in "my games" until claimed, at which point the
  existing cards cover it (checklist ruling).

### 8. Composed-host proof

`apps/host` mounts nothing new (`/notify` is already wired before the
games), but the end-to-end test needs a seam the host lacks:
`createHost` builds its notify service from env only, so the fake
channels are unreachable there today. `createHost` gains an optional
test-only `notifyChannels` override threaded into service creation;
`startTestHost` passes the fakes. Then one test beside
`notifications.test.ts`: real room, invite by email through the fake
mailer, claim through the real HTTP endpoint, assert the pending seat
appeared in a roster broadcast and the claimed seat's token joins — and
that the on-disk `InviteRecord` and binding set look right, in the
file-reading style that test already uses.

## Testing

The specs' own test lists are the checklist — with the one amendment
the lobby-claim ruling forces ("claim-path binds enter the ledger"
becomes a mid-game-plan test) — and they land with their tasks rather
than at the end. Beyond them, the habits this repo holds and the cases
this review bought:

- Wire shapes proved on serialized output, not intent: the contacts
  response provably contains no address and no `profileId`; the roster
  broadcast provably contains no token hash.
- Every refusal path asserted to be one shape (claim, redeem, foreign
  `contactId`) — the non-probe rule is a test, not a comment.
- **A legacy scalar-`bindings` file on disk** loads, normalizes, and
  still receives notifications — asserted through a real send, not the
  guard.
- **Revoke, then re-invite the same contact**: the second invite
  reserves fresh and the old token still refuses — the exact sequence
  that silently mailed a dead link before `seatVacated` existed.
- **The landing race**: with an artificially slow redemption, the room
  socket must not have joined as a new player before the claim
  resolves.
- A leaver's seat, re-taken by someone else, notifies only the new
  occupant — the binding-set cleanup, observed from the send side.
- Restart tests: an invite and a half-elapsed reminder both survive a
  service restart against the same data dir, in the style of
  `service.test.ts`'s restart-without-duplicate case; the boot sweep
  fires nothing for unregistered games.
- An old save (no `pending` field, `PROTOCOL_VERSION` 1) restores — the
  no-bump delta, pinned by a test so the next protocol change re-fights
  this consciously.
- UI through `RoomPage.test.tsx`'s existing fake-connection pattern plus
  a dedicated picker test; `NotificationSettings.test.tsx`'s
  fetch-stubbing pattern covers the new hooks.
- One artifact-level pass: a built client, a real `?invite=` URL, the
  param stripped after redemption, the seat live.

## Out of scope, deliberately

- **Mid-game invites and claims** (checklist P6, the parent spec's
  rotation insertion and tray-on-claim) — the ruling above. Owner's
  note, 2026-09-05: mid-game joining matters least for the board games
  and most for real-time play — Marco Polo's pool, where a claim is a
  swimmer diving in with no rotation to disturb — so the deferred plan
  should probably arrive with Marco Polo's adoption rather than ahead
  of it.
- **Acquire adoption** and the kit-extraction decision the checklist
  flags; Rail Baron and Marco Polo remain deferred with their specs.
- **PWA scope tags, per-game workers, install prompts** beyond the
  `needsInstall` copy — the PWA spec's own plan.
- **Friend requests, accept/reject, blocking UI** — the `status` enum
  ships with `'blocked'` enforced at the invite check and no way to
  reach it, exactly as the friends spec's stub prescribes.
- Everything both specs already rule out: forget-me, profile merging,
  channel disclosure, presence, SMS.
