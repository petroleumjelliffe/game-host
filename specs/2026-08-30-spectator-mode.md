# Spectator mode — a watcher is a binding, not a seat

**Status:** designed 2026-08-30, not implemented. Owner rulings recorded
2026-08-29/30 (Marco Polo deferred; Acquire ships spectate-alone; entry is a
WATCH affordance plus a watch-instead offer on refusal).

**Where this comes from.** The lobby's own extraction design sketched the
mechanism and never built it
([`games/acquire/docs/superpowers/specs/2026-08-08-generic-lobby-extraction-design.md:258-267`](../games/acquire/docs/superpowers/specs/2026-08-08-generic-lobby-extraction-design.md)):
*"a spectator is a binding with no `SeatHolder` — a `watchRoom` join, a
watcher count (not roster rows), and an `onWatching(room, socketId)` hook
beside `onSeated`"*. [`docs/roadmap.md:257-263`](../docs/roadmap.md) calls
spectator mode *"the largest cross-cutting feature and genuinely blocked by
nothing"* — and the one dependency it named, wanting phase 1's end rule so
that "watching a finished game" means something, resolved when Rail Baron's
declared endgame landed
([`specs/2026-08-23-money-phase-2.md`](2026-08-23-money-phase-2.md)).
[`docs/backlog.md:60-62`](../docs/backlog.md) lists it as the one
lobby-shaped item among the per-game improvements, and the per-game list at
`docs/backlog.md:415-418` opens its Lobby section with it. This spec is the
design pass all three of those point at.

**The one-sentence design:** watching is a lobby concept — a socket bound to
a room with no seat behind it — and everything game-specific about it is one
hook and one projection question per game.

## Decision 1: a watcher is a first-class lobby concept, not a pseudo-seat

The tempting shortcut is per-game plumbing: each game invents a "spectator
seat" or a sentinel player id and threads it through its own handlers. The
lobby already owns the thing a watcher actually is — the socket↔seat binding
map ([`packages/lobby/server/handlers.ts:49`](../packages/lobby/server/handlers.ts),
`bindings: Map<socketId, SeatBinding>`) — so the watcher lands there, once,
and every game inherits it.

**New client→server event `watchRoom { roomId, protocolVersion }`**, beside
the five in `LOBBY_CLIENT_EVENTS`
([`packages/lobby/protocol/protocol.ts:76-95`](../packages/lobby/protocol/protocol.ts)).
The server answers a missing room with `noSuchRoom` and a version mismatch
with `versionMismatch`, exactly as `joinRoom` does; otherwise it calls
`socket.join(room.id)`, records a watcher binding, rebroadcasts the roster
— the count changed, and the broadcast now reaches the new watcher too,
which is how they get their first one — and calls the new hook. Watching needs no name, no token, and no seat; a watcher
may watch any room that exists, in any lifecycle — a lobby filling up, a
game in play, a game that is over. There is nothing to protect at the lobby
layer, because the lobby broadcasts nothing that is not already
room-public.

**The binding becomes a discriminated union**, and this is the load-bearing
choice:

```ts
type Binding =
  | { kind: 'seat'; roomId: string; playerId: string }
  | { kind: 'watcher'; roomId: string };
```

Today `SeatBinding` is `{ roomId, playerId }`
([`handlers.ts:19-22`](../packages/lobby/server/handlers.ts)), and
`playerId: string` means a sentinel watcher id — `'watcher'`, `''`,
anything — could masquerade as a seat, and every consumer of
`wiring.seatOf` ([`handlers.ts:37`](../packages/lobby/server/handlers.ts))
across three games would silently mishandle it. The union makes the
compiler force each call site to decide, and two latent bugs it would have
prevented are already visible in the tree:

- **Rail Baron's `room.seat ?? 'all'`**
  ([`games/railbaron/src/OnlineApp.tsx:155`](../games/railbaron/src/OnlineApp.tsx)):
  an unseated client falls into `'all'` — pass-and-play — and would be
  offered *every* baron's actions. The comment beside it knows ("`'all'`
  would be wrong — but no game screen is shown then either"): unreachable
  today, reachable the moment a watcher-shaped client renders the game
  screen. See the Rail Baron slice below.
- **Acquire's projection-by-accident**: `project(state, forPlayerId)` with
  an unmatched id happens to redact everything (every hand fails the
  `player.id === forPlayerId` test,
  [`games/acquire/server/projection.ts:72`](../games/acquire/server/projection.ts)) —
  the safe outcome by luck, not by contract, and the client half of the same
  accident renders wrongly (see the Acquire slice). Marco Polo's
  `snapshotFor` has the same accident with the opposite sign, which is
  Decision 4's whole subject.

**New hook `onWatching(room, socketId)` beside `onSeated`** in `LobbyHooks`
([`handlers.ts:24-34`](../packages/lobby/server/handlers.ts)), so each game
sends the watcher its initial view. Required, not optional, for the same
reason the binding is a union: a game must *decide* what a seatless viewer
sees, not inherit a default. Marco Polo's implementation deliberately sends
nothing (Decision 4).

**`RosterMessage` gains a watcher count** — a number
([`protocol.ts:49-53`](../packages/lobby/protocol/protocol.ts)), never
roster rows. Watchers have no seat, no name, no presence; a row would
invite every consumer of `players` to skip a shape it was never written
for. The count is derived from the bindings map at `roster()`
([`handlers.ts:58-69`](../packages/lobby/server/handlers.ts)), not stored —
derive, don't duplicate, as everywhere else in this repo.

**Disconnect learns the watcher branch.** Today the handler deletes the
binding, marks the seat disconnected, and rebroadcasts
([`handlers.ts:301-315`](../packages/lobby/server/handlers.ts)). A watcher
binding: drop it, rebroadcast the roster (the derived count just fell), and
touch no seat. `socketsFor` filters on `playerId` and now matches seat
bindings only — the compiler forces that edit too.

**What a watcher cannot do:** `renamePlayer`, `leaveSeat`, and `beginGame`
all resolve the binding first and refuse a watcher — no seat to rename or
vacate, no hostship to exercise. The game-side action gates are per-game
and covered in the slices.

## Decision 2: `roomFull`, distinct from `seatRefused`

Today a full room and a stale token emit the same code. `registry.join`
returns bare `null` for every refusal — stale token
([`packages/lobby/server/rooms.ts:140`](../packages/lobby/server/rooms.ts)),
failed mid-game reclaim (`rooms.ts:153,157`), and capacity
(`rooms.ts:163`, via `seatPlayer` returning null when every seat is taken,
`rooms.ts:88` — the comment at `rooms.ts:78-80` says so in as many words:
*"`join` already returns null for a refusal, so capacity needs no new path
through the handlers"*) — and the handler turns them all into `seatRefused`
with a message about a seat being "no longer yours"
([`handlers.ts:183-189`](../packages/lobby/server/handlers.ts)). For a
newcomer bounced off a full table that message is simply wrong, and the
client cannot distinguish the case it could do something about.

The fix is the same shape `noSuchRoom`/`seatRefused` already took —
`protocol.ts:16-21` records that split as *"one refusal split in two,
because they have different remedies"* — and this is the third remedy:
**nothing you present will ever seat you here, but watching would work.**
`registry.join` learns to say *which* refusal (a reason alongside the null;
the exact shape is the implementation plan's), and the handler maps the
no-seat-could-ever-be-granted cases — capacity, and a started game with no
reclaimable seat — to a new `roomFull` code. Credential failures (a stale
token, a wrong id) stay `seatRefused`: the remedy there is joining fresh,
which still works.

This is additive on the wire. `RejectedMessage.code` is deliberately
`string`, not a union ([`protocol.ts:36-40`](../packages/lobby/protocol/protocol.ts)),
and the client hook branches on the lobby's own codes and surfaces the rest
as a message ([`packages/lobby/client/useLobbyRoom.ts:109-140`](../packages/lobby/client/useLobbyRoom.ts))
— an old client shown `roomFull` degrades to displaying its message text.
What the new code *enables* is Decision 6's watch-instead offer.

## Decision 3: one protocol version bump, all three games together

The wire grows a client event, a roster field, and a rejection code, and
the version check is exact equality — deliberately, with the reasoning in
place at [`handlers.ts:76-95`](../packages/lobby/server/handlers.ts): a
client can be the *newer* side, and `>=` would wave it through to fail deep
in a handler. So the bump is not optional and not per-slice: Rail Baron's
`RB_PROTOCOL_VERSION` ([`games/railbaron/session/protocol.ts:8`](../games/railbaron/session/protocol.ts),
1→2), Acquire's `PROTOCOL_VERSION`
([`games/acquire/session/protocol.ts:195`](../games/acquire/session/protocol.ts),
3→4), and Marco Polo's ([`games/marcopolo/protocol/game.ts:5`](../games/marcopolo/protocol/game.ts),
1→2) all move in slice 1, when the lobby package's wire changes underneath
all three. Since the cutover, every game's client and server ship from the
same `main` in the same artifact, so a coordinated bump costs one constant
per game and stales nothing but open tabs — which is what `versionMismatch`
exists to tell.

## Decision 4 (owner ruling, 2026-08-29): Marco Polo is deferred

**Marco Polo gets no spectator UI in this design.** Its hidden information
is the game itself: Marco cannot see polo positions, and that blindness is
enforced by omission in `snapshotFor`
([`games/marcopolo/server/snapshot.ts:10`](../games/marcopolo/server/snapshot.ts))
— a coordinate never serialized cannot be rendered. But look at the default:
`marcoViewer` is `viewerId === sim.marcoId` (`snapshot.ts:13`), and every
player a non-Marco viewer asks about comes back **with** `x`/`y`
(`snapshot.ts:24-25`). An unknown viewer id gets full visibility — the
dangerous direction, and exactly the accident Decision 1's union exists to
keep a sentinel watcher id away from. Whether a Marco Polo watcher should
see Marco's view or the god view is a genuine game-design question — the
god view spoils the hiding game for anyone glancing at a watcher's screen —
and it gets its own design pass rather than a ruling smuggled in here. The
lobby's SPECTATE button stays deliberately absent, as
[`games/marcopolo/README.md:52-53`](../games/marcopolo/README.md) already
reserves it.

Marco Polo is still touched three ways, and only three: its protocol
constant bumps with the others (Decision 3); its conformance run
([`games/marcopolo/server/lobbyConformance.test.ts`](../games/marcopolo/server/lobbyConformance.test.ts))
inherits the new watcher contract automatically; and its required
`onWatching` implementation sends nothing, on purpose, with a comment
naming the deferred ruling — `broadcastSnapshots`
([`games/marcopolo/server/gameHandlers.ts:38`](../games/marcopolo/server/gameHandlers.ts))
skips watcher bindings the moment the union forces it to decide, which is
the deferral expressed in types rather than in a TODO.

## Decision 5 (owner ruling, 2026-08-30): Acquire ships spectate-alone

Acquire's docs recorded a pairing:
[`games/acquire/docs/superpowers/specs/2026-08-07-next-round-sequencing.md:186-187`](../games/acquire/docs/superpowers/specs/2026-08-07-next-round-sequencing.md)
— *"The spectator seat and the panel-only phone view. Wanted together,
since the phone view depends on the spectator seat. Their own design
pass."* — and the lobby extraction design noted the pairing ruling as
standing. **This ruling decouples them, deliberately.** The dependency runs
one way: the phone view needs the seatless projection; the seatless
projection needs nothing from the phone view. So the spectator ships alone
— the full board view, read-only — and the panel-only phone view remains
its own later pass that *reuses* the seatless projection built here.
Bundling them was already declined once for making the deliverable too wide
([`games/acquire/docs/superpowers/specs/2026-08-08-pwa-design.md:38`](../games/acquire/docs/superpowers/specs/2026-08-08-pwa-design.md));
this makes the decoupling the recorded state rather than a repeated
exception.

## Decision 6 (owner ruling, 2026-08-30): entry is a WATCH affordance plus a watch-instead offer

Two doors in, both explicit:

1. **A WATCH affordance on the join/room screens** — entering a room code
   and choosing to watch is a first-class path, not a hidden URL.
2. **A watch-instead offer on refusal**: when a join comes back `roomFull`
   (Decision 2), the client offers "watch instead" — the room is full or
   the game is under way, and watching is the thing that still works.

The refusal path is why `roomFull` had to exist: on `seatRefused` the right
offer is "join again to take a new one" (the message already says so), and
a client that cannot tell the two apart would offer watching to someone
whose seat is one fresh join away. Which screens carry the WATCH button in
each game, and what the offer looks like, is each slice's plan detail; the
ruling is that both doors exist.

## The Rail Baron slice — nearly free, so it goes first

Rail Baron has no hidden information. It is a companion for a physical
board; dice outcomes are public events in the log; a seeded game carries
its seed in the house rules ([`games/railbaron/src/state/rules.ts:15`](../games/railbaron/src/state/rules.ts))
stamped into the `started` event
([`games/railbaron/server/rooms.ts:114`](../games/railbaron/server/rooms.ts)),
which is already broadcast to every client. And the server already
broadcasts the whole log room-wide — `broadcastLog` is
`io.to(room.id).emit(...)`
([`games/railbaron/server/handlers.ts:24`](../games/railbaron/server/handlers.ts))
— so a watcher who has done `socket.join(room.id)` hears every append for
free. **`onWatching` sends the current log to that one socket**, and the
mechanism is complete on the server but for the action gate.

That gate: `situate()`
([`handlers.ts:56-69`](../games/railbaron/server/handlers.ts)) resolves the
binding before any append or undo, and the union gives it a watcher branch
that refuses with an honest code and message — `watcherCannotAct`, "you are
watching this game" — instead of the accidental `'no seat bound'` a
sentinel id would have stumbled into at `handlers.ts:65`. Game-side codes
pass through the lobby's rejected channel opaquely, so no protocol change
beyond Decision 3's bump.

**Client: `ActAs` gains `'none'`.** Today it is `SeatId | 'all'`
([`games/railbaron/src/GameShell.ts:57`](../games/railbaron/src/GameShell.ts)):
`'all'` is pass-and-play, a `SeatId` is online. `'none'` is the read-only
board — and adding it retires the latent bug named in Decision 1, because
`OnlineApp.tsx:155`'s `room.seat ?? 'all'` becomes an explicit three-way
choice instead of a fallback into the most permissive mode. The local
action gate already exists in the other direction: `useOnlineGame` checks
every action against `mySeat`
([`games/railbaron/src/net/useOnlineGame.ts:40,57,86,98`](../games/railbaron/src/net/useOnlineGame.ts)),
and with a null seat it offers nothing — the board never *offers* what the
server would refuse, which is the same local-gate philosophy the shell
comment at `GameShell.ts:52-56` records ("this stops the board
*offering*").

The rendering path needs no work, because it is already
viewer-parameterised: the dice's amber ring reads `live && mine`
([`games/railbaron/src/board/screens/play.ts:43-45`](../games/railbaron/src/board/screens/play.ts),
whose comment already says *"a spectator never sees a glow"*), and committed
moves play back for everyone *"like any other spectator"*
([`games/railbaron/src/map/useRoute.ts:33`](../games/railbaron/src/map/useRoute.ts)).
The word was in the code before the feature was.

## The Acquire slice — the careful one, because the secrets are real

Acquire never broadcasts game state. `sendState` is *"the one send site"*
([`games/acquire/server/index.ts:244-270`](../games/acquire/server/index.ts)),
and it emits a per-player projection to that player's sockets only — so
joining the socket.io room gets a watcher exactly nothing, which is the
correct starting point and the reason this slice is second.

**The watcher send path rides `deliver`'s `commit` branch and only that
branch.** `deliver` ([`index.ts:279-297`](../games/acquire/server/index.ts))
carries the invariant in its comment — *"A commit is the only thing the
whole table hears. Corrections and rejections go to one player, which is
what keeps an open segment private: there is no branch here that broadcasts
a draft."* — and the watcher fan-out is added inside the `commit` case,
beside the per-player loop at `index.ts:283-285`, so the invariant and its
comment survive verbatim. An open draft segment stays private to the actor;
a watcher sees the game advance commit by commit, exactly as every
non-actor player does.

**`project` gets an explicit seatless mode: `forPlayerId: string | null`.**
Today ([`games/acquire/server/projection.ts:66-75`](../games/acquire/server/projection.ts))
an unmatched string happens to redact everything, and Decision 1 already
named relying on that accident as a latent bug. `null` states the contract:
no hand is the viewer's own, and the redactions are total. What must never
reach a watcher, and why: **no hand** (every player's, since none is
"yours"), **no bag**, **no seed** — the bag is shuffled once at init and
never re-seeded, so the seed alone reconstructs the entire future draw
order of the game (the rationale already written at
`projection.ts:42-45`) — and the log's hidden tile tokens stay redacted
exactly as `projectLog` does for a seated viewer (`projection.ts:22`). A
pinning test states this leak contract outright (see Testing).

**The watcher's initial send gets its own reason: `'watch'`.** `onSeated`
sends `'resume'` today ([`index.ts:221-224`](../games/acquire/server/index.ts)),
and `resume` is deliberately a separate reason so the privacy rule at
`sendState` can treat a reconnecting actor differently
(`index.ts:246-259`). `'watch'` mirrors that: a distinct reason lets the
client distinguish initial hydration from a live commit — the same
distinction `resume` buys a rejoining player — and keeps `ownsDraft`
trivially false for a watcher by construction rather than by the accident
of an unmatched id. Riding `'commit'` was considered and declined: it would
make the watcher's first message indistinguishable from a table-wide
commit, and reasons are cheap.

**Client.** `useRoom` refuses to build a session without a `playerId`
([`games/acquire/src/net/useRoom.ts:62-68`](../games/acquire/src/net/useRoom.ts)
— `if (id === null) return;`), so it needs a watcher branch that builds the
session from `'watch'`/`'commit'` states with no identity. `GameScreen`'s
`viewerId` axis ([`games/acquire/src/game/GameScreen.tsx:42,70`](../games/acquire/src/game/GameScreen.tsx))
today means: `undefined` is pass-and-play — everyone — and a string is one
player. Passing an unknown string gets a watcher *most* of the way —
`canAct` comes out false (`GameScreen.tsx:81`) — but wrongly: the viewer
lookup finds nobody (`GameScreen.tsx:99-101`), `autoHighlight` flips on as
if a seated player were watching their own tiles (`GameScreen.tsx:213`),
and the turn banner attributes turns against a viewer who does not exist
(`GameScreen.tsx:258-263`). So the axis gains an explicit third case —
watcher — that forces `canAct` false and renders the board, panels, and
log with no "you" anywhere.

## Sequencing: one design, two implementation plans

**Slice 1 — the lobby, proven against Rail Baron.** Everything in Decisions
1–3 and 6, plus the Rail Baron slice: the mechanism lands against the game
with no secrets, where the only projection question is "send the log". Ends
with the full repo gate: `npm run lint && npm run typecheck && npm test`.

**Slice 2 — Acquire.** The seatless projection, the watcher fan-out on
commit, the client watcher branch, and Acquire's WATCH affordances. Same
gate at the end.

Marco Polo's plumbing — a `broadcastSnapshots` watcher branch and the
visibility ruling behind it — is explicitly out of scope for both slices
(Decision 4); it takes only the version bump and the inherited conformance
run.

## Testing

**The contract lands in the shared conformance suite** —
`describeLobbyConformance`
([`packages/lobby/server/conformance.ts:66`](../packages/lobby/server/conformance.ts)).
One correction to the folklore first: that suite is run by **Marco Polo
only** today (`games/marcopolo/server/lobbyConformance.test.ts`). The lobby
pass scoped it that way on evidence — it went green against Marco Polo, so
Rail Baron and Acquire kept their own wire tests and did not adopt it
([`docs/plans/2026-08-20-the-lobby-pass.md`](../docs/plans/2026-08-20-the-lobby-pass.md),
task 5's "As built"). The watcher contract is new surface that none of the
per-game wire tests cover, so the adoption rule's condition is finally met:
**Rail Baron adopts the suite in slice 1 and Acquire in slice 2**, each via
the five-line test file the suite was built to be pointed by. The new
cases, inherited by every consumer:

- `watchRoom` joins the room and the watcher receives the current roster,
  including the watcher count.
- A watcher cannot `renamePlayer`, `leaveSeat`, or `beginGame`.
- A watcher's disconnect decrements the count and touches no seat.
- A join refused for capacity emits `roomFull`, not `seatRefused`; a stale
  token still emits `seatRefused`.

**Rail Baron:** a wire test that a watcher receives the log on watch and on
every subsequent append, and that a watcher's append is refused with
`watcherCannotAct`; a client test that `ActAs` `'none'` renders no action
affordances.

**Acquire:** the projection leak-pinning test — a `null`-viewer projection
contains no hand, no bag, no seed, and no hidden tile token in the log —
and a wire test that a watcher receives committed state (reason `'watch'`
then `'commit'`s) and never a draft: drive an open segment and assert
nothing reaches the watcher until the commit.

Two standing rules apply. A new test must be proven able to fail by
breaking the code and reading real output, never by reading the assertion
(the house convention Rail Baron's CLAUDE.md carries). And
`socket.io-client` under Node implements no same-origin policy — the root
CLAUDE.md records that a test connecting from a "disallowed" origin and
expecting failure *cannot fail* — so every negative test here asserts on
wire messages and refusal codes, never on connection outcomes.

## Open questions

- **Marco Polo's visibility ruling** — Marco's-view or god-view for a
  watcher. Deferred to its own design pass (Decision 4); nothing in the
  lobby mechanism prejudges it.
- **Capping watchers per room.** No cap now — YAGNI. These are LAN and
  small-group games, and the roster's watcher count makes any abuse visible
  before a cap would have mattered. The bindings map is where a cap would
  go if one is ever wanted.
- **Where the WATCH affordance lives** in each game's screens. The ruling
  says both doors exist — the explicit button and the refusal-path offer —
  and the exact placement per game is each slice's implementation-plan
  detail, not a spec commitment.
