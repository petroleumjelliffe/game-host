# Email invites and seat keys: identity without accounts

**Status:** designed 2026-09-01, not yet planned.
**Home:** this repo, because the design cuts across `packages/lobby`,
`packages/notify`, and the host contract — no single game owns it. Written
after a brainstorm on inviting specific people to games; the companion spec
[2026-09-01-shared-pwa.md](2026-09-01-shared-pwa.md) covers the push/PWA
delivery channel and depends on the token this spec introduces.

## The property being bought

**Email possession is identity.** No registration, no password, no login
page anywhere. Two concrete abilities fall out:

1. **Invite a specific person by email address** — before they have ever
   opened the site, before any notification setup exists for them. The
   invite reserves a seat that only their link can claim.
2. **Every email the system sends doubles as a login link.** Open any turn
   notification, reminder, or invite on any device and that device *is* you
   for that seat — which is the whole multi-device story, and the reason no
   "log in on another device" flow needs to exist.

The trust model is the one the notify package already accepted for
unsubscribe links: whoever controls the mailbox controls the thing the link
points at. That was judged acceptable for turning notifications off; this
spec extends the same judgement to controlling a seat in a casual game.
It is a deliberate ceiling — if these games ever carry stakes worth
stealing, this is the spec to revisit.

## Current state (what exists, and the one accident to fix)

Identity today is three disconnected pieces:

- A seat is a `(playerId, token)` bearer pair, minted by the lobby
  (`packages/lobby/server/rooms.ts`) and stored per-room in one browser's
  localStorage (`packages/lobby/client/identity.ts`). The token is already
  a portable credential — it just has no way to travel to another device.
  Notably, **two devices holding the same pair already work simultaneously
  and silently**: the socket→seat `bindings` map is keyed by socket id,
  state pushes go to every socket on the seat, and the seat only reads
  "away" when the last socket drops (`packages/lobby/server/handlers.ts`).
  Multi-device needs no lobby server change at all — only transport for the
  token.
- The notify profile is a per-device secret (`playerKey`, localStorage
  `notify.key`) known to the server only as `profileId = sha256(playerKey)`.
  Email attaches to the profile via double-opt-in; Web Push subscriptions
  hang off it as an array.
- The two meet only in notify's per-room `bindings: seatId → profileId` —
  and that binding is a **single slot, last-writer-wins**
  (`packages/notify/service.ts`, `bindSeat`). Whichever device bound most
  recently is the only one notified for the seat; any other device's
  subscription silently stops mattering. One-device-per-seat today is an
  accident of that assignment, not a design.

There is no invite mechanism of any kind: sharing a game is sharing the
room URL, and joining mid-game without a token falls back to the
honor-system name-match reclaim (which *rotates* the token, logging the
other device out — the opposite of what multi-device wants).

The host contract (`packages/host/contract.ts`) already states the premise
this spec builds on: the lobby's seat token "is the only proof of identity
that exists."

## The design

Six pieces. The seat key (1) is the keystone; everything else either feeds
it (invites), consumes it (reminders, multi-device), or clears the path for
it (bindings as a set).

### 1. The seat key: one durable emailed token per seat

Each seat that notify knows about gets one long-lived **seat key** —
random, URL-safe, stored **hashed** at rest (same discipline as the
`playerKey`). Every email about that seat — invite, turn notification,
reminder — carries it as `?key=<seatKey>` on the room deep link.

Deliberately *one durable key reused in every email*, not a fresh token per
send: it is what makes "open any email you've ever received on any device"
true with no freshness bookkeeping, and rotation is a single operation if a
link ever leaks (forwarded email, shared screenshot). Rotation also happens
automatically if the underlying seat token rotates via the honor-system
reclaim, so a reclaimed seat's old emails stop working.

**Redemption is a POST from the loaded SPA, never a side effect of the
GET.** Mail scanners and prefetchers follow links; they do not run
JavaScript. The page loads normally, the client POSTs the key, the server
answers with the seat's live `(playerId, token)`, the client writes it into
the existing identity store and strips the param from the URL
(`history.replaceState`). From there the ordinary join loop takes over —
including the second-device case, which the lobby already handles.

Handing out the live seat token through notify is the deliberate decision
named in the trust model above. The endpoint must not be a probe: a bad or
unknown key gets the same shaped "no" regardless of whether the room or
seat exists, mirroring how `summaries` answers `known: false`.

### 2. Reserved seats in the lobby

`SeatHolder` grows a pending variant: a seat allocated with an invite-token
*hash* and no occupant. Rules:

- `seatPlayer` never hands a pending seat to an ordinary joiner; only a
  `joinRoom` presenting the matching invite token claims it (minting a
  normal seat token from there).
- The roster broadcast represents "invited, unclaimed" so lobby UIs can
  show the reserved row. The lobby stores **only the hash — never the
  email address**. Room records persist into every game's saves via
  room-store, and an email address in game state is a privacy leak waiting
  to happen; addresses live only in notify's records, which already hold
  them.
- **A pending seat is outside the game.** No tray, no place in the turn
  rotation. This is what makes "claimable until claimed" safe for
  multi-day play: the game runs as if it had one fewer player, no tiles
  are held hostage in an untouched tray, and no end-of-game condition
  (empty bag + empty tray) can be faked by a seat nobody occupies. On
  claim — lobby or mid-game — the seat draws a fresh tray and slots into
  the rotation next-after-current. The late claimer's scoring disadvantage
  is accepted; these are casual games.
- The host can **revoke** an unclaimed invite, deleting the pending seat.
  Nothing returns to the bag because nothing left it.

### 3. Host contract additions

`NotifyGameRegistration` grows two capabilities (names indicative):

- `reserveSeat(roomId) → playerId | null` — allocate a pending seat, or
  refuse (room full, room gone).
- `getSeatCredentials(roomId, playerId) → { playerId, token } | null` —
  the mechanism behind seat-key redemption: notify may hand a seat's live
  credentials to whoever presents a valid emailed key.

Same-process trust, same shape as the existing `verifySeat`. The comment
in `contract.ts` about the seat token being the only identity proof should
be updated to name the seat key as its emailed proxy.

### 4. Invites in notify

A third record kind alongside profiles and rooms:

```
InviteRecord { tokenHash, email, gameId, roomId, playerId, createdAt, claimedAt? }
```

`POST /notify/invite { playerKey, game, roomId, playerId, token, email }`:
the host proves *their own* seat via the existing `verifySeat`, notify asks
the game to `reserveSeat`, mints the invite token, and mails the link —
through the existing sender, under the existing per-address rate limits,
with the existing "unconfigured means off" behaviour. The invite email
**doubles as the double-opt-in** for that address: claiming the seat via
the link is at least as strong a consent signal as clicking a confirm
link, so an invited player is notification-ready from message one.

Claiming converts the invite into the ordinary shape: pending seat becomes
a held seat, a seat key is minted, and the claiming device's profile binds
to the seat.

### 5. Seat bindings become a set

`RoomRecord.bindings[playerId]` changes from `profileId` to `profileId[]`.
Every device that redeems a seat key and runs the existing bind-on-play
flow is *added*; the send loop fans out to every bound profile's channels.
Two consequences handled at send time:

- **Dedupe email by address** — two profiles confirmed at the same address
  get one email per event, not two.
- **Prune dead push endpoints** — a subscription answering 404/410 is
  dropped from its profile.

This also softens the two-addresses-one-person problem this design
otherwise leaves unsolved (see Out of scope): two profiles bound to the
same seat behave identically to one person for everything that matters
per-game, without ever being merged.

### 6. Auto-remind at 24 hours

If the turn has not changed 24 hours after the turn notification, notify
sends one reminder — same `turnKey`, second send, subject line marked as a
reminder, capped at one reminder per turn per day. No manual nudge button
in v1: automatic fits the multi-day rhythm and avoids the social layer
(who nudged me?); a button can layer onto the resend path later if the
auto-remind proves too passive. The reminder carries the seat key like
every other email, so a nudge is also a login link.

The existing once-per-turn machinery (`lastNotified` keyed by `turnKey`,
marker written before send so a crash misses rather than duplicates)
extends with a reminder timestamp under the same crash discipline.

## Testing

- Lobby: pending seats invisible to ordinary seating, claim path (lobby
  and mid-game), revoke, rotation insertion, tray-on-claim, conformance
  additions so every game's lobby behaves alike.
- Notify: invite flow end-to-end with the fake mailer, key redemption
  (valid, invalid, rotated, revoked — all indistinguishable "no"s),
  bindings fan-out, email dedupe, reminder cap.
- Wire tests cannot prove origin or possession properties (socket.io-client
  under Node ignores the same-origin policy — see the CORS notes in
  CLAUDE.md); assert on record state and response shapes instead.
- One artifact-level pass per the repo habit: a built client, a real
  `?key=` URL, the param stripped after redemption.

## Out of scope, deliberately

- **SMS/phone.** A paid provider, a new transport surface, and email
  already has sending, opt-in, and rate limiting built. The design leaves
  room for a second transport; nothing more.
- **Full profile login** ("enter your email anywhere, get all your games
  back"). The seat key delivers the practical benefit per-game; a
  cross-game restore flow is a later spec if it ever earns its keep.
- **Profile merging.** Unifying two addresses into one person is the
  perennial identity mess. This design contains it — everything keys off
  the seat, so merging later is a data migration inside notify, not a
  schema rethink — and otherwise leaves it alone.
