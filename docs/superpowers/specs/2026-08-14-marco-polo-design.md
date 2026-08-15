# Marco Polo — design spec

*2026-08-14. Approved in brainstorming; this document is the validated design.*

A real-time multiplayer chase game for phones in the same room. One player is
**Marco** and cannot see anyone; the **Polos** see everyone. Information moves
only by sound: calls emit ripples, and every ripple is a position leaked to the
other side. Web-based, nothing to install — players join a room code or QR on
their own phone.

## Context and platform

- **Same-room play, one phone per player, 3–8 players.** The game is a party
  game: phones chirping "marco" / "polo" across a real room is part of the
  design, not a side effect.
- **Stack**: one Node process — socket.io plus statically served client — run
  on the host's machine; phones join over LAN via QR of `http://<ip>:<port>`.
  Deployable to Render later without redesign.
- **Lobby**: rooms, seats, join/rejoin tokens, presence, rename and leave come
  from [`multiplayer-game-lobby`](https://github.com/petroleumjelliffe/multiplayer-game-lobby),
  vendored as a git submodule at `vendor/lobby` and compiled by this repo's
  toolchain, per its README. The game supplies the room factory, the `onBegin`
  and `onSeated` hooks, a `protocolVersion`, the `appId` (`marco-polo`), and
  every pixel of UI.

## Game rules

### Roles and rounds

- One Marco per round; everyone else is a Polo.
- First Marco is chosen at random. The player Marco catches becomes the next
  round's Marco.
- A round ends when Marco catches a Polo, or when the **90-second timer**
  expires. On timeout every Polo scores and the next Marco is the player who
  has gone longest without being Marco (random among ties).
- **Scoring**: +1 per round survived as a Polo. Scoreboard between rounds; the
  host taps "next round". No match end condition in MVP — play until the group
  stops.

### Arena

- A circle (the pool), simulated in normalized units (radius 1.0).
- After a **30-second grace period**, the boundary shrinks linearly to **35 %
  of its starting radius** by the time the timer expires. The boundary is
  hard: players are clamped inside the current ring, so hiding space
  evaporates rather than punishing stragglers with damage.
- No obstacles in MVP.

### Movement

- Hold a finger anywhere on the play area; your avatar swims toward that point
  at a constant base speed, equal for both roles. Release to stop.
- **Turbo**: a meter-backed button. While held (and non-empty) it gives ~2×
  speed; a full meter lasts ~1.5 s and recharges over ~8 s. Both roles have it.

### The call — the core mechanic

- Marco has a **MARCO button on a ~5 s cooldown**. Pressing it:
  1. Emits a ripple and a fading "marco" word at Marco's position, visible
     (and audible, post-MVP) to every player.
  2. One second later, **every Polo automatically emits a "polo" ripple** at
     their current position.
- Polo replies are the *only* way Marco ever learns where Polos are. Marco
  trades information for information: calling reveals Marco too.
- Ripples render as expanding rings that fade over ~2 s, with the word fading
  up at the emission point. The ripple marks the position *at emission time*;
  it does not track the player afterward.

### Catching

- Marco catches a Polo by circle overlap between avatars (server-computed).
  The round ends immediately; the caught player is the next Marco.

## The two screens

The screens differ by information, not just skin — see Networking for the
enforcement.

- **Polo screen** — full information, bright "daytime pool" look: all avatars,
  shrink ring, ripples, round timer, own turbo meter.
- **Marco screen** — dark sonar world: own avatar, arena edge and shrink ring,
  timer, turbo meter, the MARCO button, and ripples only. Polo replies are
  echo-memory: rings that fade in ~2 s. The shrink ring is visible to Marco so
  boundary clamping never feels unfair.

## Architecture

### Simulation

- **Server-authoritative.** The server runs the whole simulation at **20 Hz**
  as a pure function `tick(state, inputs, dt) → state`: movement toward
  targets, turbo drain/recharge, boundary clamp, ring shrink, catch detection,
  call cooldown, and the delayed forced reply.
- Clients send inputs only and interpolate between snapshots for rendering.
  No client prediction in MVP; at LAN latencies interpolation alone is smooth.

### Game protocol (the game half of the wire; lobby half is `vendor/lobby`)

Client → server:

- `input { tx, ty, turbo }` — finger target in normalized arena coordinates
  (absent target = stop) and whether turbo is held.
- `call` — Marco only; ignored for others or during cooldown.

Server → client:

- `state` — role-filtered snapshot at ~20 Hz: ring radius, timer, phase
  (grace/shrinking/between-rounds), scores, and per-player data. **Polos
  receive all positions; Marco's snapshot omits Polo positions entirely.**
  Each client receives its own turbo meter and, for Marco, the call cooldown.
- `event` — one-shot occurrences with positions stamped at emission time:
  `call { x, y }`, `reply { playerId, x, y }` (reply events go to everyone —
  for Marco they are the sighting; for Polos they confirm what leaked),
  `roundStart { round, marcoId }`, and
  `roundEnd { reason, caughtId, nextMarcoId, scores }` — a catch is the
  `roundEnd` with `reason: 'catch'`, not a separate event, since the two
  always travel together.

Cheat-proofing falls out of filtering: Marco's phone cannot render what it was
never sent.

### Lobby integration

- `makeRoom(id, players)` builds a room whose `lifecycle()` maps game phase to
  `'lobby' | 'playing' | 'over'`.
- `onBegin(room)`: validate player count (≥3), pick the first Marco, start the
  round loop, `broadcastRoster`, send initial `state`.
- `onSeated(room, playerId)`: mid-game rejoin — send that socket a full,
  role-filtered snapshot so a reloaded phone resumes seamlessly.
- Disconnected players float in place and remain catchable; the lobby's
  presence marks them away and its token flow handles their return.

### Client

- React (headless lobby hooks from `vendor/lobby/client`), canvas 2D for the
  arena, Vite toolchain.
- Screens: join/lobby (name, roster, share QR, host's begin button) → game
  (Polo or Marco view by role) → between-rounds scoreboard.
- Touch: pointer events on the canvas for movement; separate touch targets
  for turbo and (Marco only) the call button.

## Error handling

- Rejoin: lobby tokens; `onSeated` restores state. Room gone (server restart)
  surfaces the lobby's `noSuchRoom` ending.
- Version skew: `protocolVersion` (starts at 1) on both halves of the wire;
  the lobby's `versionMismatch` tells stale clients to reload.
- Input hygiene: server clamps/ignores malformed inputs (NaN, out-of-range
  targets, `call` from non-Marco).

## Testing

Vitest throughout, TDD.

- **Simulation unit tests** (node): movement, clamping to the shrinking ring,
  turbo drain/recharge, catch detection, call cooldown, forced-reply timing,
  round transitions, timeout Marco rotation.
- **Filtering tests** (node): Marco's snapshot payload contains no Polo
  coordinates; Polos receive everything; per-client meter privacy.
- **Lobby contract**: vitest globs include `vendor/lobby/protocol/**`,
  `vendor/lobby/server/**` (node) and `vendor/lobby/client/**` (jsdom), per
  the submodule's README, so a submodule bump that breaks us is noticed here.
- **Client**: interpolation and view-model logic unit-tested; rendering
  verified by playing.

## Deliberately cut from MVP

- **Audio** — first follow-up after the core loop works (it is a big part of
  the vibe and purely client-side).
- Obstacles in the arena, spectator / big-screen view, remote-play polish
  (client prediction), persistent scores, native app, difficulty settings
  (e.g. ghost afterimages for Marco).
