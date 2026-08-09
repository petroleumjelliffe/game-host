# The lobby

Rooms, seats, join/rejoin tokens, presence, rename/leave — game-agnostic, shared
by every game in this family. Three pieces: `lobby/` (wire types, node-safe),
`server/lobby/` (seating registry + socket handlers), `src/lobby/` (headless
React client + default UI under `ui/`).

**The lobby is turn-agnostic.** It knows seats, presence, lifecycle, and "the
host pressed begin" — never turns, actors, or timing. Turn-based, real-time,
simultaneous: all equally at home; whatever happens after `onBegin` is yours.

## What your game provides

- **A room**: anything with `id`, `players: SeatHolder[]`, and `lifecycle()`
  returning `'lobby' | 'playing' | 'over'`. Pass a `makeRoom(id, players)`
  factory to `createLobbyRegistry`.
- **Two hooks** for `createLobbyHandlers`: `onBegin(room)` — host pressed start,
  lobby has validated host + lifecycle; begin your game, call
  `wiring.broadcastRoster(room)`, send your own state. `onSeated(room, playerId)`
  — a socket was seated (join or rejoin); send them your game's state if one is
  running.
- **Your protocol version** (`protocolVersion` on the hooks and on
  `createLobbyConnection`) — the lobby has no version of its own; your game's
  number covers both halves of the wire.
- **An `appId`** for `createIdentityStore` — the `localStorage` namespace. Games
  share the origin; a duplicated appId lets one game's seat tokens shadow
  another's.
- **A seat-emoji function** for `RoomLobby` (`seatEmoji(seat) => string | null`),
  and optionally a theme: `--lobby-accent`, `--lobby-accent-strong`,
  `--lobby-on-accent` (defaults render the reference blue).

## What the lobby decides for you (re-ask at the lift if it doesn't fit)

- **The honor reclaim**: mid-game, a join with a disconnected seat's exact name
  takes that seat (token rotated). Right for a trusted table; a trust model
  where name + room code must not capture a seat needs a flag that does not
  exist yet.
- Some rejection codes carry game-flavored names (`notYourTurn` for "not the
  host") — wire legacy; renaming costs a protocol bump.
- Reconnect/backoff socket options are fixed (infinite retries, 500ms–5s).
