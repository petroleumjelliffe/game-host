# A person across devices: email is the account, the app signs in

**Status:** designed 2026-09-09, decisions recorded the same day (see
"Decisions" at the end); planned and implemented 2026-09-09 via
[docs/plans/2026-09-09-person-identity-and-app-signin.md](../docs/plans/2026-09-09-person-identity-and-app-signin.md).
See "As built" at the end for deltas. Phase A of three (A: email
is the person; B: paste handoff from Safari; C: emailed sign-in code, only
if B leaves anyone stranded). This document designs A and shapes the person
model so B drops in without reopening it.
**Home:** this repo — the server half lives in `packages/notify`, the client
half lands in the word game first.
**Supersedes** the iOS flow in
[2026-09-01-shared-pwa.md](2026-09-01-shared-pwa.md) ("open one emailed link
from the installed app once"), which turned out to be impossible: see
"The iOS facts" below.
**Prerequisite:** the join-with-code page fix (its own one-file PR): the page
sends a fresh-seat join instead of routing to the room's chooser, so a
started room refuses it before any of this gets a chance to help.

## The use cases

1. I invite friends by email or by room code.
2. A friend opens the link, plays in Safari, and adds the game to their Home
   Screen.
3. They open the installed app and turn on notifications.
4. The app shows the games they are invited to and the games they are in.
5. They can resume any of those games from the app.
6. They can claim an invited seat from inside the app.
7. Invites reach them as push notifications, and tapping one lands in the
   app.

## The iOS facts, and the assumption they broke

Two things Apple does, both verified live on 2026-09-09:

- **A home-screen web app never receives a link from another app.** A link
  tapped in Mail or Messages opens Safari, always, whatever the manifest
  says. Universal Links are native-app only. This is also true of macOS
  Safari web apps. Android Chrome and desktop Chrome do capture in-scope
  links, and the `launch_handler` added on 2026-09-09 makes them reuse the
  open window there; it changes nothing on Apple platforms.
- **The installed app has its own storage bucket.** Safari's localStorage,
  and so its `notify.key` and every seat token, is invisible to the app.
  Android and desktop Chrome share the browser profile with the installed
  app, so none of this applies there.

The shared-PWA spec designed toward "open one emailed link from the installed
app once" so the app's profile could bind to the seat. The first fact makes
that flow unreachable: the only link channel Apple lets the app own is a
push notification tapped inside it, and the app cannot enroll push for a
seat it does not hold. Today an installed app on an iPhone can reach no game
that arrived by email, and every route it tries ends in Safari.

The reframe: this is not "open the app from a link". It is "the app learns
who you are, once, after which the server can restore everything". The
server has no notion of a person, only of a browser: a profile is a
per-browser key, seats are per-browser localStorage, and the home screen
lists rooms from that localStorage. Give the server a person, and every one
of the seven use cases is a query.

## The person, derived rather than stored

**A person is the set of profiles that have confirmed the same email
address.** Comparison is case-folded, as the send loop already does; dots
and plus-suffixes are not stripped. Nothing new is written: no person
record, no link table, no migration. Whenever the server needs "everything
this person holds", it takes the asking profile's confirmed address, finds
every profile confirmed on it, and unions their seats and invites. Existing
data links on its first query. Removing your address from a device unlinks
that device by construction.

Two facts make this the cheap option rather than a compromise:

- **Claiming an emailed invite already marks the address confirmed** on the
  claiming profile (`claimInvite`: "claiming IS the double-opt-in"). So every
  friend who arrived by email is already signed in, in Safari, without having
  opened notification settings. The Safari side of the bridge exists; this
  spec builds the app side.
- **The confirmation click does its work on the server.** Which context
  opens the link is irrelevant, so the one link Apple forces into Safari is
  the one link where that does not matter. The "magic link" the app needs
  already exists; it needs a join behind it.

Why not copy the key into the app: the server holds only the key's hash and
cannot hand it out, and a copy would not keep following Safari. Every future
emailed invite tapped on an iPhone will still land in Safari, so the app must
keep seeing Safari's seats forever, not once. Linking, not copying.

Why the person is derived and not a record: B (paste handoff) will add an
explicit profile-to-profile link for people who never give an address, and
for the shared-mailbox case below. That link is unioned into the same set.
Nothing in A may assume an address is the only way in; the derivation is one
function, `personOf(profileId)`, and B extends that function.

Per device stays per device: each profile keeps its own push subscriptions,
its own prefs, and binds to seats when that device opens the room.

## Server: four additions under the existing `/notify` routes

Restore, accept, and the confirm-page change below, plus `POST
/notify/signout`, which is specified with the client's sign-out control
because its meaning is decided there.

### Restore: `POST /notify/me`

Body `{ playerKey }`. Answer:

```json
{
  "address": "pete@example.com",
  "seats":   [{ "game": "wordgame", "roomId": "ABC123", "playerId": "p2",
                "token": "…", "name": "Pete" }],
  "invites": [{ "game": "wordgame", "roomId": "XYZ789", "playerId": "p3",
                "name": "Pete", "inviterName": "Alice", "gameTitle": "…" }]
}
```

- `address` is the asking profile's confirmed address, or `null`. With no
  address the person is the asking profile alone, so the answer is still
  correct and merely uninteresting.
- `seats`: every room where any profile of the person is bound and the game
  still reports live credentials for that seat (`getSeatCredentials`).
  Departed and revoked seats fall out because the game answers `null`.
  Rooms whose game is not mounted are skipped, never dropped.
- `invites`: every live invite (not claimed, not revoked) whose target is a
  profile of the person, or whose target is the person's address. Address
  matching is case-folded.
- Answers only for the asking key. There is no lookup by profile id or by
  address, and the payload never reaches a log line: it carries every live
  seat token the person holds.

### Accept: `POST /notify/invite/accept`

Body `{ playerKey, game, roomId }`. Finds the live invite for that room whose
target is the person, and claims it by the hash the server already stores.
`claimSeat(roomId, tokenHash)` takes the hash, so no emailed token is
involved. On success the asking profile is bound to the new seat and the
answer is the same credentials shape as `/invite/claim`, with `inviterName`.
Every failure is the single refusal shape, including "already claimed": the
person may have claimed the same invite in Safari a moment earlier, and the
next restore shows the seat anyway because the two profiles are linked. The
client therefore re-runs restore on refusal rather than showing an error.

### Fan-out addresses the person

A contact is the set of profiles the inviter has shared a seat with, which
for a friend on an iPhone is their Safari profile, which has no push. The
invite send loop (and the turn and reminder loops, which already dedupe
email by address) expands each target profile to its person before choosing
channels. Without this, use case 7 fails silently: push goes to a profile
that cannot receive it, the email fallback fires, and the invite lands in
Safari.

One consequence worth pinning with a test: a linked Safari profile that
never opens the room never binds, so a turn produces one email to the
address and one push to the app. That falls out of dedupe-by-address, not
out of anything stated; a change to the send loop must not double-mail
linked people.

### Confirming now signs in a device

The confirmation link's click now grants the asking device every seat the
person holds, and neither the mail nor the page may keep saying "turn
notifications will now reach this address".

- **The confirm page gets a button.** `GET /notify/confirm?token=` renders
  a page that says a device asked to sign in as this address, when, and what
  kind of device; a button POSTs the token, and only the POST confirms.
  This is also what stops mail scanners that prefetch links from confirming
  on the person's behalf, which is a live weakness today and would become
  an account grant.
- **The mail says what the click does.** Subject and body name the device
  kind and the request time, and say to ignore it if it was not you.
- **The client tells the server which kind of device asked.** `POST
  /notify/email` accepts an optional `device: 'app' | 'browser'`, which the
  client fills from the PWA package's `isInstalledApp()`. Stored on the
  pending email record, shown in the mail and on the page, discarded on
  confirm.
- **The confirmed page tells you where to go next.** When the confirming
  profile is an app, the page says to go back to the app; it cannot open it.

## Client: the word game first

The notify client package gains one call, `fetchMine(playerKey)`, and one
call, `acceptInvite(playerKey, game, roomId)`. Following the precedent in
`landing.ts`, the shared package returns credentials and **the caller writes
them**: the identity store is per game.

**Restore runs on launch and on return.** The home page calls restore when
it mounts and again on `visibilitychange` to visible. Not on an interval:
the iOS flow is "leave the app to tap the link in Mail, come back", and a
backgrounded app runs no timers. Every restored seat is written into the
identity store, idempotently, server token winning. The existing
`useMyGames` then lists rooms from the store and summarizes them through the
existing summaries endpoint, unchanged.

**The home screen's three states.**

- Not signed in: one card, "Sign in with your email to see your games on
  this device", which opens the email field that already lives in the
  notification settings sheet. The same card appears in a room's lobby, so
  a friend who arrived by room code meets it before the game starts. The
  card shows whether or not the device already holds rooms; a device can
  hold rooms and still be unlinked.
- Signed in: a line, "Signed in as pete@example.com", next to the existing
  settings control. Sign out, in the settings sheet, is what ends it.
- After submitting an address: "Check your email, then come back here." The
  page re-reads settings on visibility change until the address flips to
  confirmed, then restores.

**Sign out, and turning email off, are two different controls.** Today the
settings sheet offers neither: the server has a remove-address call and an
email preference, but the only thing a person can do about email is the
unsubscribe link in each mail. Both controls arrive with this spec, with
distinct meanings:

- **"Email me when it's my turn"** is the existing email preference,
  surfaced as a toggle. Off stops the mail and nothing else: the address
  stays confirmed, the device stays signed in, restore keeps working. The
  unsubscribe link in each mail does the same thing.
- **"Sign out"** leaves the device as if new, except that it keeps its
  device key. `POST /notify/signout` with the key deletes the address
  record and removes this profile from every room binding, so the device
  stops receiving turn pushes for seats it no longer holds; push
  subscriptions and preferences stay, because they belong to the device and
  signing in again should not re-ask for permission. The client then clears
  every room identity in its store, including seats created or joined on
  this device before sign-in: "clean it up" means no seat survives, not
  only the restored ones. Sign out is per device; it does nothing to the
  Safari profile or to any other phone.

**Invited games are cards.** Each shows the game, who invited you, and a
claim button that calls accept and opens the room. They sit above the
lobby games.

**The room page is unchanged.** Rejoin, bind and push run exactly as they do
for a seat that was claimed on the device.

**The Safari nudge on iOS.** After a seat is claimed in Safari on an iPhone,
the room page shows a hint: add this to your Home Screen to get
notifications, then sign in there with the same email. For a friend who
arrived by room code or share link, whose Safari profile has no address, the
hint has to say "confirm the same email here and in the app". B replaces the
second half of this hint with a paste.

Acquire and Rail Baron get the server half for free and their clients later.

## What the address now grants, and what guards it

This section is the adversarial review, kept.

- **The confirm link is a sign-in link, and people tap confirm links on
  autopilot.** A prankster types your address into their app; you get a
  mail and tap it; their phone holds your seats. The button page, the
  device kind and the request time are the defense in A. If that ever
  proves insufficient, the escalation is a short code shown on the
  requesting device that the confirm page asks for, which the prankster
  cannot supply, and which is typed on a web page rather than in the app,
  so it cannot be mistaken for a room code.
- **The device key is now the account.** Before this, `notify.key` unlocked
  preferences and a contact list; after it, every seat token the person
  holds, through one bearer value in localStorage sent in every notify POST.
  Any script injection on the origin, or a shared computer, is a takeover
  of the person's games. Nothing here mitigates that, and nothing cheap can.
  It is the trade "email is the account" makes, and it is recorded here so
  it is not rediscovered.
- **Sign-out reaches only the device it is pressed on.** It cleans that
  device and stops its notifications, but seats already restored onto
  another device stay there, and seat tokens never rotate since the
  honor-system reclaim was retired. A lost phone keeps playing until the
  room dies. Nothing in the sign-out copy may imply otherwise.
- **A shared mailbox is one person.** Two people who confirm the same
  family address see each other's seats and can play each other's turns. A
  cannot fix this. B can, because a paste links a specific device. This is
  the case where B is a correctness fix and not a convenience.
- **Restore is a broadcast of tokens.** Answered only for the asking key,
  never logged. Both are easy to regress; both get tests.
- **Rate limits carry over.** The confirm expiry and per-UTC-day send caps on
  `/notify/email` are unchanged. Submitting an address that is confirmed on
  someone else's profile is not distinguishable from submitting a fresh one,
  as today.

## Where it works

Email needs `SMTP_URL`, `EMAIL_FROM` and `NOTIFY_ORIGIN`; push needs a secure
context. The LAN deployment has neither, so on the wifi the installed app
has no sign-in and no notifications, exactly as it has no push today. A is a
Render feature. Nothing here should be debugged on the LAN.

## Testing

- Service: `personOf` for a lone profile, two profiles on one address in
  differing case, and a profile whose address is pending (not linked).
  Restore for a person where one profile holds bindings and the other none;
  a departed seat absent; an unmounted game skipped. Invites listed by
  profile target and by address target; a revoked one absent. Accept
  claims by hash, binds the asking profile, refuses a second accept with
  the single shape. Fan-out reaches the app profile's push subscription when
  the contact holds only the Safari profile. A linked, unbound Safari
  profile produces one email and one push per turn.
- Routes: `/me` refuses a missing or malformed key and answers only for the
  key; the response never appears in the log; `GET /confirm` does not
  confirm and `POST /confirm` does; `device` is validated. `/signout`
  deletes the address and every binding for the profile and leaves its push
  subscriptions and prefs alone; a second call is a no-op.
- Client: the three home-screen states against the fake connection; the
  sign-in card in a room lobby; an invite card through accept to
  navigation; restore on visibility change writes the store; a refused
  accept re-runs restore; sign out empties the identity store and keeps the
  device key; the email toggle changes the preference and nothing else.
- One artifact-level pass on the built app: vitest's `BASE_URL` differs
  from the build's, and a green suite once hid a shipped 404 on this very
  home screen (2026-08-31).

## Out of scope, deliberately

- **B, paste handoff from Safari:** a one-time short-lived token on the
  clipboard from the Safari room page, "Paste to sign in" in the app, an
  explicit profile link on the server. Fixes the room-code friend and the
  shared mailbox. Next spec.
- **C, an emailed sign-in code:** only if B leaves someone stranded. If it
  comes, codes are digits only, shown as two groups of three, never on the
  same screen as a room-code box.
- Passkeys. The right answer for a product; a WebAuthn dependency in the
  server bundle and "save a passkey for the word game" are the wrong first
  move for game night. The person model here is what they would attach to.
- Acquire and Rail Baron clients. Sign-in, the all-active-games list, push
  invites and turn notifications are all meant to reach them later; the
  server half here is game-agnostic so that costs each game only its client
  wiring.

## Decisions (2026-09-09)

Four questions were put to the owner with the design; the answers are
folded into the sections above and recorded here so they read as decisions
rather than defaults.

1. **Where sign-in lives.** A card, on the home screen and in a room's
   lobby, opening the email field in the existing settings sheet. Not a
   separate sign-in screen: one place an address is typed.
2. **What it is called.** "Sign in". It is an account now.
3. **What removing the address means.** Two controls, not one. Turning
   email off is the existing preference, surfaced as a toggle, and leaves
   the device signed in. Sign out cleans the device: the address, every
   binding, and every seat in local storage go; the device key and its push
   subscriptions stay. Chosen over "remove address leaves restored seats in
   place", which would have made the same control mean different things to
   someone stopping mail and someone leaving a shared phone.
4. **Which clients in A.** The word game only, with the explicit intent
   that sign-in, the all-active-games list, push invites and turn
   notifications are applied to the other games afterwards.

## As built (2026-09-09)

Implemented as designed, in the plan's thirteen tasks, with these deltas:

- **`disabled` links too.** A person is every profile whose address is
  confirmed *or* confirmed-then-unsubscribed; the spec said "confirmed".
  Unsubscribing is "stop mailing me", and turning it into a sign-out would
  have surprised anyone who used the link in a turn mail. The restore's
  `address` field still reports only a *confirmed* address, so a device
  that unsubscribed reads as signed in on the server and shows the
  "emails are off" line in settings.
- **The restore hook lives in the game** (`useMyGames`), not the shared
  client: the shared package returns credentials and the game writes
  them, the precedent `landing.ts` set. The shared client gained only
  calls (`fetchMine`, `acceptInvite`, `signOut`, `setEmailPref`) and one
  field on the status hook (`emailConfirmed`) — no new file, so
  `importBoundary.test.ts` still counts 13.
- **Email invites to a proven address also push.** The spec's fan-out
  section covered contact invites; an invite *by address* to someone whose
  app is linked is the same use case and got the same treatment.
- **`confirmationDetails`** is a separate read from `confirmEmail`, so the
  GET page and the POST button cannot disagree about a token. `POST
  /notify/confirm` takes a form body; it is the one urlencoded route, and
  the parser is scoped to it.
- **The invite card carries no seat name.** The invite record never held
  one (the lobby holds it on the pending seat); the card says who invited
  you and which room, which is what the person needs to decide.
- **Push to the bound Safari profile still goes out.** Fan-out expands to
  the person and dedupes by profile, so a turn reaches every profile's
  subscriptions once; on an iPhone Safari holds none, so in practice it is
  the app's push and the address's one mail.
- **The home screen's one banner slot** ranks pending-confirmation above
  sign-in above the push nudge; the sign-in card appears only when
  `/notify/me` has answered (never on the standalone dev server) and
  reports no address.
- **A signed-out device keeps its device key.** Sign out clears every seat
  in local storage and asks the server to drop the address and bindings;
  the key and its push subscription stay so signing in again is one step.
