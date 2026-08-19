# Generic lobby extraction — design

**Date:** 2026-08-08
**Status:** Built on this branch — implementation plan
(`docs/superpowers/plans/2026-08-08-generic-lobby-extraction.md`) executed 2026-08-09; by-hand pass
run
**Depends on:** `revamp/turn-order-draw` merging and its v3 cutover deploying first
— **satisfied** (v3 live on prod, 2026-08-08)

## What and why

Extract the lobby — rooms, seats, join/rejoin tokens, presence, rename/leave, and the
screens around them — into a game-agnostic piece, so the owner's future multiplayer
games reuse it instead of rebuilding it. The consumer is future games by the same
owner on the same stack (React, socket.io, Express, Vite); this is not a published
library, and none of the polish one would need (transport-agnosticism, API stability,
docs) is in scope.

**Scope ruling: lobby only.** The authoritative game loop — intents, per-player
projection, segments, drafts/undo, corrections — stays per-game. It is nearly generic
too, but generalizing it would bake this game's segment/draft model in as the required
shape for every future game, and no second game exists to check that against.

**A consequence worth stating as a guarantee: the lobby is turn-agnostic.** It knows
seats, tokens, lifecycle, presence, and "the host pressed begin" — never turns,
actors, or timing; all of that lives on the game side of the seam. A real-time game
sits on this lobby unchanged. The stub-consumer test (below) is the proof: its room
has no turn concept at all. The one leak is cosmetic and on the re-ask list — the
historically-named `notYourTurn` code for "you're not the host".

**Packaging ruling: extract in place, lift at the join point.** The lobby lives in
this repo behind a test-enforced import boundary. No npm package, no monorepo, no
second repo until game #2 actually consumes it — see "Game #2 and the lift" below.
The severing work (the couplings below) is identical under every packaging option;
only the overhead differs.

**UI ruling: headless contract plus a themeable default kit.** The headless layer
(`useLobbyRoom`, connection, identity, protocol types) is the contract. The existing
components move too, as a default lobby UI a future game uses as-is, themes, or forks.

## Where things live

Three sibling pieces, mirroring the repo's existing shared/client/server convention:

| Path | Contents |
|---|---|
| `lobby/` | Shared wire types: `CreateRoomMessage`, `JoinRoomMessage`, `RenamePlayerMessage`, `JoinedMessage`, `RosterMessage`, lobby event names, lobby rejection codes. Node-safe, no React. Joins the `node` vitest project. |
| `server/lobby/` | Seating, tokens, join/rejoin, rename, leave, presence marking, roster broadcast, "Player N" naming. Mostly today's `server/rooms.ts` minus its game knowledge. |
| `src/lobby/` | Headless client: `useLobbyRoom`, the lobby half of `connection.ts`, `identity.ts`. |
| `src/lobby/ui/` | Default components: `LobbyCard`, `RoomLobby`, `JoinRoomCard`, `RoomGone`, `RoomRefused`, `StaleClient`, `ConnectionStrip`. `TurnToast` stays game-side — it is about turns, not rooms. |

The boundary is enforced the way this repo already enforces boundaries: a test in the
node project asserts that every *relative* import under the three lobby directories
resolves back **inside** those directories — an allowlist, not a blocklist. (The
first draft forbade `engine/`, `session/` and `src/game/` by name, which left
`server/room.ts` and `src/net/` importable: a `GameRoom` import in the lobby's
handlers would have passed the gate while breaking exactly what the gate guards.)
Bare module imports — react, socket.io — are fine. Per the hollow-gate rule, the
test is proven by temporarily adding a forbidden import and watching it fail.

## The protocol split

`session/protocol.ts` currently owns both wires. It splits:

- **`lobby/protocol.ts`** gets the room-management messages and the lobby's own
  rejection codes: `noSuchRoom`, `seatRefused`, `versionMismatch`, `notConnected`.
  The `rejected` channel is typed generically — `{ code: string; message: string }` —
  because the lobby only ever *branches* on its own codes; everything else (engine
  refusals, `undoOutOfSegment`) it forwards opaquely for the game to interpret. That
  is already how `useRoom` behaves today; this names the behavior rather than
  changing it.
- **`session/protocol.ts`** keeps the game wire: `WireIntent`, `StateMessage`,
  `intent` / `undo` / `state` events, `DRAWS`.
- **`PROTOCOL_VERSION` stays owned by the game** and is passed into the lobby's
  join/create calls. Lobby and game deploy together per game, so one number covering
  both wires is correct; a lobby-shape change means the host game bumps. A
  lobby-owned version arrives only if the lobby becomes a real package.

**The refactor is wire-neutral**: no message shape changes, no version bump.
`goldenSocket`, `clientOverWire` and `versioning` passing untouched is the main
correctness gate.

## The server seam

`server/lobby/rooms.ts` becomes generic by making the room's game payload opaque and
inverting the three places it reaches into the game today:

- **Lifecycle.** The canonical `'lobby' | 'playing' | 'over'` type moves to
  `lobby/protocol.ts`, and the lobby's room contract *requires* a `lifecycle()`
  method it reads — for the roster broadcast and its own guards. It does not own a
  lifecycle field: `GameRoom` already derives `over` from its own state
  (`stage === 'end'`), and a lobby API call for something the room knows first-hand
  would be ceremony. (Corrected 2026-08-08 — the first draft said "the game flips
  `playing → over` through a lobby API call", written from memory of the code rather
  than the code.) `beginGame` stays a lobby event — the host check and the lifecycle
  check are lobby rules — but what beginning *does* is injected: the game supplies an
  `onBegin(room)` callback that builds initial game state (today: entering the
  turn-order draw).
- **Seat bindings.** The lobby owns the socket↔seat binding — it is what tokens and
  rejoin produce. The game's `intent`/`undo` handlers ask the lobby "whose seat is
  this socket" instead of sharing a map. `server/index.ts` stays the composition
  root, wiring both halves onto one socket.io instance.
- **Persistence stays a game concern.** `store.ts` does not move. The game's store
  keeps writing one record per room (roster + tokens + game state) exactly where it
  does today; `players` is on the lobby's room contract, so the copy-in and
  copy-out are the one-line maps already living in `persist` and `restore`. No
  storage interface is invented for a single implementer. (The first draft proposed
  `snapshotRoster`/`restoreSeats` helpers — cut 2026-08-08 by this spec's own rule:
  an interface with one caller each.)
- **Two behaviors cross the boundary as-is, flagged rather than redesigned.**
  The honor-system name reclaim (same name takes an abandoned mid-game seat) is an
  owner ruling for *this* game's trust model; as a generic default it means knowing
  a room code and a display name captures a seat in any future game. And the lobby
  will emit some rejection codes with game-flavored names — `beginGame`'s host
  refusal is `notYourTurn` — because the codes are wire contract and this refactor
  is wire-neutral. Both are correct today and both go on the lift's re-ask list
  below, not into config surface nobody uses yet.

## The client seam

- **`useLobbyRoom`** is today's `useRoom` minus the session: it owns
  `connecting → joining → lobby` plus `error`, `gone`, `stale`, and exposes `roster`,
  `playerId`, and `join` / `begin` / `rename` / `leaveSeat`. It does not know what
  "playing" means, and it does not expose the game transport — the game already
  holds the shared connection and reaches its transport there.
- **The game keeps a thin `useRoom`** wrapping it: it listens on `onState` to build
  the `NetworkSession`, and computes the final phase with `stale` / `gone` ranked
  *above* `playing` — so even before the wrapper's effect disposes the session, a
  gone room renders `RoomGone`, never a live-looking dead board. That ordering is
  the ghost of the Phase 4 bug; the plan pins it with a test.
- **`connection.ts`** splits along the seam it already half-has: the lobby connection
  owns the socket plus the lobby sends; the game's `transport` (intent, undo,
  onState) hangs off it, as today.
- **`identity.ts`** moves as-is with one addition: a **key namespace**. Multiple
  games would sit on the same GitHub Pages origin, and `localStorage` is
  origin-scoped, so identity keys carry an app prefix or game #2's room `ABC123`
  collides with this game's.

## The UI kit and theming

Corrected against the actual files (2026-08-08; the first draft assumed `tokens.ts`
imports that do not exist). The components' real game couplings are exactly two:
`PLAYER_EMOJI` from `engine/startups` in `LobbyCard.tsx`, and the Tailwind accent
blues (`bg-blue-600`/`hover:bg-blue-700`) on the primary buttons. So:

- **The emoji set is injected**: `RoomLobby` takes a `seatEmoji(seat)` function as a
  prop; the game passes one built on `PLAYER_EMOJI`, a future game passes its own.
- **Theming goes through CSS custom properties, not a theme prop** — but only the
  variables with a consumer today: `--lobby-accent`, `--lobby-accent-strong`,
  `--lobby-on-accent`, each with the current blue as its working fallback, read via
  Tailwind arbitrary values. An un-themed consumer renders today's UI pixel for
  pixel; a future game themes with one CSS block, or forks the UI and keeps the
  headless layer. The set grows when a variable gains a consumer, not before.
- **No copy parameter.** Verified: no string in any moving component names the game.
  A `gameName` parameter arrives with the first string that needs it.

**Known debts ship with the kit, as findings against it:** the away dot rides a
roster row designed to clip, and final scoring has no presence at all (both open
Stage 0 findings). Extraction does not fix them and must not wait for them — but the
kit's first consumer inherits them, so they stay on the books as the kit's, not the
game's.

## Testing and migration

- **Sequencing:** after `revamp/turn-order-draw` merges and its v3 cutover deploys.
  That branch touches `protocol.ts` and the join path; rebasing a boundary refactor
  across a protocol cutover is pain for nothing.
- **The gate is the existing suite**, unchanged: `goldenSocket`, `clientOverWire`,
  `recovery`, `lobbySeat`, the page tests — green with no assertion edits. Tests move
  with their files.
- **Three new tests:** the import-boundary test (proven by breaking it); the
  phase-ranking test on the game's thin `useRoom` (`gone`/`stale` outrank `playing`
  before the session is disposed); and a **stub-consumer test** — the registry and
  the hook types driven by a dummy room that is not `GameRoom`. The boundary test
  proves *decoupled*; only a second consumer proves *generic*, and thirty lines of
  stub is the cheapest way to have one before the lift instead of discovering an
  accidentally Acquire-shaped abstraction during it.
- **`lobby/README.md` is written at extraction time, not lift time** — one page
  addressed to game #2's author: the room contract, the two hooks, the three theme
  variables, the identity `appId` rule, and the reclaim caveat. The knowledge is at
  its freshest during the extraction and decays from there; the file doubles as the
  genericity checklist.
- **Migration order inside the branch:** protocol split first (types only, everything
  still compiles) → server (`rooms.ts` → `server/lobby/` + the `onBegin` inversion)
  → client (`useLobbyRoom` + wrapper) → UI move + theming → boundary test last, since
  it can only pass once everything above it is done.
- **A by-hand pass at the end** — create, join, rename, leave, refresh-rejoin, kill
  the server, two browsers, **and the token-lost reclaim**: clear one browser's
  stored identity mid-game and rejoin by retyping the same name. That path is the
  least-tested behavior crossing the boundary and the one the honor reclaim exists
  for; the rest of the pass only ever exercises the token-present rejoin. By-hand
  passes are what find bugs here, and this refactor walks straight through Phase 4's
  territory.

## Game #2 and the lift

A second game repo exists (2026-08-08): pure JS, pass-and-play only, due a React
update next. That makes it the lobby's first real second consumer — but not soon,
and not as its first step. Two independent tracks:

- **Track A (this repo):** turn-order-draw merges and deploys, then the extraction
  above. Unchanged by game #2's existence — the seam gets severed here, where the
  test suite and the by-hand discipline can prove nothing broke.
- **Track B (game #2's repo):** the React/Vite port, **pass-and-play first, no
  online**, with its own brainstorm and spec in that repo. The port's one obligation
  to the lobby is mirroring this repo's layering — a pure `engine/` with no React,
  components under `src/game/`, everything derived from replayed state — because
  that shape is what the lobby plugs into. Same growth path Acquire itself took.

**The join point:** when game #2 is ready for online, the three lobby directories
move out of this repo into their shared home and both games point at it. Leading
candidate: **shared TypeScript source via git** (submodule or git dependency) rather
than a published npm package — both repos are Vite+TS and compile the lobby source
directly, so a two-consumer, one-owner library needs no build/publish pipeline. The
final call is made at the lift, with game #2's real needs in hand; the in-place
extraction keeps the lift cheap by keeping the lobby dirs self-contained, which the
import-boundary test already forces.

**Deferred until the lift — the re-ask list.** Each of these is a decision that
gets better with game #2's real needs in hand, and worse if rediscovered mid-lift:

- **Hosting.** A second Render service is a second paid `starter` instance; the
  alternative — both games' servers in one process — creeps toward the
  hosted-lobby-service model this design rejected.
- **The identity namespace is required, not precautionary** (and lands now, in the
  extraction): both games will share the GitHub Pages origin's `localStorage`.
- **The honor-reclaim policy.** Generic default today; game #2 decides whether
  same-name seat capture fits its trust model, and a flag arrives then if not.
- **The game-flavored rejection codes** (`notYourTurn` from the lobby's `beginGame`,
  `wrongStage`, `unknownIntent`). Renaming them is a wire change, so it costs a
  protocol bump — the lift, which already forces each game to re-pin its version,
  is the natural moment.
- **Reconnect/backoff configurability.** The socket options are hardcoded with this
  game's deploy-survival rationale; exposing them on `LobbyConnectionOptions` is
  cheap if game #2 wants different behavior, and clutter before then.

## Future directions the extraction must not foreclose — and doesn't

Owner-named (2026-08-08), none built here; each is pinned to the seam it will land
on so the extraction's choices stay compatible with it. All three change the wire,
so each costs its game a protocol bump when it arrives — normal, per-game, and
exactly what the version handshake exists for.

- **Teams.** A team is seat state chosen in the lobby: `SeatHolder` grows a field,
  the roster row carries it, and a lobby event sets it — the same shape `rename`
  already has (identity from the socket binding, lobby-only, roster broadcast as
  the answer). What the game does with teams is the game's business; the lobby
  only seats them. Nothing in the current `SeatHolder`/roster design resists an
  added optional field.
- **A chosen emoji per player.** Today the seat emoji is *derived* — the game
  assigns it by seat index, which is why the extraction makes it an injected
  `seatEmoji(seat)` function rather than lobby state. A picker flips it to
  *chosen*: the emoji moves onto `SeatHolder` beside `name`, rides the roster, and
  is set the way `rename` is (probably the same event, carrying both). The
  injected function is the migration point: it stops reading a constant table and
  starts reading the roster. This pairs with the existing lobby-design memory that
  emoji + name both belong to the player's own row.
- **Spectators.** Watching the committed game without holding a seat. The lobby
  half is already shaped for it: the lobby owns socket↔seat bindings, so a
  spectator is a binding with no `SeatHolder` — a `watchRoom` join, a watcher
  count (not roster rows), and an `onWatching(room, socketId)` hook beside
  `onSeated`. The game half is the real work and stays per-game: deciding what a
  seatless viewer may see is a projection question (today's `project` requires a
  playerId and hides hands by it). Note the existing Stage 3 finding wants
  spectating designed together with the panel-only phone view — that pairing
  ruling stands; this entry only records the lobby seam for it.

## Out of scope

- Generalizing the game transport (intents, projection, corrections, segments).
- Any storage interface at all — persistence stays the game's. (The first draft's
  two roster snapshot functions were cut; see the server seam.)
- Publishing, monorepo conversion, or a second repo (until the lift).
- Game #2's React port itself — its own brainstorm and spec, in its own repo.
- Any wire or behavior change visible to a player.
