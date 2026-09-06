# Pre-join, dead links, and room-scoped sign-in

**Status:** planned and implemented 2026-09-06.
**Design source:** the "Lobby additions · pre-join, dead links, room-scoped
sign-in" section added to the *Word Game Invite Flow* canvas (screens A1,
A2, A2b, B1, C1). Extends
[2026-09-05-invites-and-friends.md](2026-09-05-invites-and-friends.md);
the invite flow it builds on is live.

## Rulings (owner, 2026-09-05/06)

1. **The name-match reclaim is retired.** Typing a disconnected seat's
   name mid-game no longer takes the seat; the emailed sign-in link is
   the only way onto a new device. This retires the one *unproven* seat
   transfer and the one token rotation — which means a leaked emailed
   link now lives until its room dies. Accepted for casual games, and
   recorded here rather than left silent; an explicit rotate operation is
   the future fix if it ever bites. Applies to every game (the branch was
   shared), and Acquire's tests now pin the refusal.
2. **Sign-in is always scoped to one room.** The dead-invite view stays
   *in the room* so nothing implies "all your games back". Full profile
   login stays deferred per the parent spec.
3. **Every send-shaped response is vague.** "If that seat's email is set
   up, a link is on its way" — identical whether the seat, invite, or
   address exists. The cooldown state counts *attempts*, not successful
   sends, so rate limiting cannot be used to probe which seats have
   email.
4. **A new-device link never logs out the old device** (two devices on a
   bearer pair already coexist); copy must not imply a transfer.
5. **The reserved row takes "That's me" too** (decided over the canvas's
   "no action here" note, which should be updated): it resends the live
   invite to its original target. A forwardee clicking it re-pings the
   real invitee, harmlessly, under the same caps.

## The work

- **Lobby**: the reclaim branch is deleted (mid-game token-less joins
  refuse); a `viewRoom` event lets a visitor's socket receive the roster
  and its live updates *without taking a seat* — the chooser's data.
  `useLobbyRoom` gains an opt-in `preview` mode: with no stored identity
  it views instead of auto-joining, phase `'preview'`, and `join()` is
  the explicit "Sit here". Games that don't pass `preview` keep the old
  auto-join, so only wordgame changes behaviour.
- **Notify**: two endpoints, both answering the vague 200 or a 429
  cooldown (3 attempts per subject per UTC day, counted in memory —
  a soft cap that resets on restart, deliberately not worth a schema).
  - `POST /notify/seat-signin {game, roomId, playerId}` — occupied seat:
    mails each bound profile's confirmed address the seat's derived
    `?key=` link (deduped; `disabled` addresses excluded, but
    `prefs.email` is *not* consulted — sign-in is user-initiated
    account recovery, not a notification). Reserved seat: resends the
    live invite to its original target. Unknown anything: nothing, 200.
  - `POST /notify/invite/refresh {inviteToken}` — the dead-link screen's
    button, keyed by the token the visitor already holds. Live invite:
    resend, same link. Claimed: the seat is taken (possibly by you on
    another device), so mail the *sign-in* link to the invite's original
    target. Revoked: nothing — the host's decision is not resurrectable —
    but still 200. Unknown: nothing, 200. A 429 only ever appears for a
    real record, which is fine: holding the token already proves it was
    real.
  - `EmailSender.sendSeatSignin` — the "someone asked for a sign-in link
    to your seat; if this wasn't you, ignore this" template.
- **Wordgame UI**: the `RoomView` grows a `preview` phase rendering the
  chooser (A1; mid-game variant A2b with no "Sit here"), the "That's me"
  claim sheet (A2) with C1's sent/cooldown states, and the dead-link
  view is rebuilt to B1: "Email me a new link" (refresh, using the dead
  token kept from the landing), "Continue to the room" (lands on the
  chooser, replacing "Join as a new player"), "Go home". The A1 footer's
  "Signed in on another phone?" link points the visitor at the That's-me
  rows rather than opening a flow of its own.

## Out of scope

Full profile login ("all my games"), mid-game seat joining, any rotate
operation for leaked links, Acquire adoption of the chooser (it keeps
auto-join until it opts into `preview`).
