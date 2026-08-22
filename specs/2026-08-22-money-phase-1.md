# Rail Baron money, phase 1 — the game becomes finishable

**Status:** designed 2026-08-22, not implemented. Decisions below were made in
conversation on 2026-08-21/22 and are recorded with their reasons; the
implementation plan derives from this document. Phase 2 (ownership, fees,
auctions, trains, forced sale) is deliberately not in it.

**Why this exists:** Rail Baron cannot be won. `server/rooms.ts` says it
plainly — *"'over' is unreachable: the game has no end rule yet"* — and the
repo's [roadmap](../docs/roadmap.md) ordered everything else around fixing
that. Sixteen comments across the codebase call the missing half "the money
spec" and left seams for it. This is that spec's first slice, cut deliberately
small: the smallest change after which a game of Rail Baron ends and someone
has won it.

## What is already built, measured rather than assumed

The seams turned out to be further along than the comments admit. Checked
2026-08-22 against `main` at `63af9d0`:

| Piece | State |
| --- | --- |
| Payout computation | **Done.** `payoutBetween(a, b)` in `engine/payouts.ts`, correct against the published table. |
| Payout on the wire | **Done.** The `arrived` event carries `payout: number \| null` (`src/state/events.ts:27`), `null` meaning a home town, `0` a real zero-paying journey (Minneapolis↔St. Paul). |
| The balance | **Done, with a timing caveat found while planning.** `Seat.earned` — *"Derived at replay, never stored"* — but the `arrived` event is really *"next destination assigned"*, and the fold banks its payout at assignment, **before the trip is walked**. Correct for the running total; the end rule must use `banked` (earned minus the in-flight trip's payout) or a player goes homeward one trip early. |
| The rng seam | **Done.** Every roll function takes an injected `Rng`; `useGame` and `useOnlineGame` default it to `Math.random` at exactly one seam each. |
| An end rule | **Missing.** `'over'` unreachable; `appendLegality` never refuses on game-over; nothing derives a winner. |
| Rules configuration | **Missing.** The win target and starting train exist only as comments and hardcoded constants. |
| Money in the UI | **Missing.** `Seat.earned` is rendered nowhere. |

So phase 1 is three things — an end rule, a rules file, a money display —
on plumbing that already works. The design below is mostly about where each
one lives.

## Decision 1: rules enter the game as data in the log

`DATA_DIR/railbaron/rules.json`, read once when Rail Baron mounts. When the
server appends `started` — the one event that is *"the server's alone"*
(`server/handlers.ts`) — it stamps the rules into that event:

```jsonc
// DATA_DIR/railbaron/rules.json — all fields optional
{
  "winTarget": 200000,        // dollars; published rule's default
  "startingTrain": "freight", // 'freight' | 'express' | 'superchief'
  "seed": "any string"        // deterministic dice; see Decision 3
}
```

```ts
// The event, after this spec (rules optional for old saves):
| { type: 'started'; rules?: GameRules }
```

From that append onward the **log is the authority**; the file is never
consulted again for that room. This buys three properties at once:

- **Replay determinism.** A fold never reads a file. An existing saved room
  replays into the same game on any machine, rules included.
- **Mid-game immunity.** Editing `rules.json` during a running game changes
  nothing for that game — the next *created* room picks it up. There is no
  remedy for "I set the target too high and we are mid-game" except finishing
  or abandoning the room, and that is a feature: a win condition that moves
  during play is worse than one that was wrong at the start.
- **Old saves keep working.** A `started` without `rules` folds as the
  published defaults. No migration, no version bump beyond the event union.

**File handling follows the room store's honesty precedent.** Absent file:
published defaults, silently — the file is optional equipment. Malformed
file (unparseable JSON, unknown train name, non-positive target): **Rail
Baron refuses to mount, loudly naming the file and the field.** A half-read
rules file is a wrong game, not a degraded one, and the room-store plan
already established that this repo quarantines what it cannot read rather
than guessing.

**Why `DATA_DIR` and not the repo:** a checked-in file edited on the host
machine leaves a dirty tree, and `git pull` *is* the LAN deploy — the
post-merge hook runs `deploy.sh`, and a dirty tree makes the next deploy
fail. Beside the saves, the file is editable in place, survives deploys
untouched, and is exactly as machine-local as the saves themselves. (The
parked branch `feat/host-env-local` reached the same conclusion for
`DATA_DIR` itself, including the lesson that such a file is *not a shell* —
no relative paths, no interpolation, values validated on read.)

This is deliberately **not** a general settings system. The
[roadmap's house-rules item](../docs/roadmap.md) wants one eventually, for
all three games; this file is its first consumer and the generalisation
happens after there are two.

## Decision 2: the end rule is a fold, enforced at the same gate as everything else

The published win condition is: reach the cash target, own at least one
railroad, and return to your home city. Phase 1 has no ownership, so the
middle clause cannot exist yet. **Phase 1's rule is cash + return home**, and
phase 2 adds the ownership clause without changing the rule's shape — decided
2026-08-22, in preference to "first to the target ends it", because the race
home is most of what makes real endings exciting and because phase 2 should
*add a clause*, not change what winning means.

Mechanically, nothing new travels on the wire. The fold in `src/state/game.ts`
derives two things it does not derive today:

- **Homeward.** A seat whose **`banked` `>= winTarget`** is homeward — a
  derived flag, never an event, where `banked` is `earned` minus the payout of
  a trip still being walked. (Assignment-time banking would otherwise flip a
  seat homeward a trip early — found while planning, see the table above.)
  The home city is already in the log: the seat's first `Stop`.
- **Winner.** A homeward seat appends no `arrived` events — its destination is
  implicit — so the win derives from **the `moved` event that ends at the home
  city's node**: banked at or over target, pawn standing at home, game over.
  The fold banks the completing leg *before* testing, so a trip that both
  crosses the target and ends at home wins on that same event.

**Homeward changes what `legal.ts` permits, and this is the one place the
flow itself changes:** a homeward seat rolls **no further destinations** —
`regionRequested` is refused for it — and its destination *is* its home city,
so its `moved`/`arrived` legality is judged against home rather than against
a rolled destination. The client flow follows: the destination-roll UI is
skipped for a homeward seat and the board shows "racing home to <city>"
instead. This is the published game's own endgame — announce, then run for
home — not an invention of this spec.

`appendLegality` in `src/state/legal.ts` — already the single authority
(*"everything they decide is decided by legal.ts"*) — refuses every append
once the log contains a winning arrival. `rooms.ts` derives
`lifecycle() === 'over'` from the log exactly where its comment has promised
since before the monorepo. No new event types; one optional field on
`started`; zero new socket messages.

**Edge the tests must pin:** a leader reaches the target but is overtaken —
another seat reaches *its* target and home first. Cash alone must not end the
game; the second seat wins. And `payout: 0` journeys (they exist) must count
toward nothing while still being legal arrivals.

## Decision 3: an optional seed, and seeded games verify themselves

`rules.json` may carry a `seed`. Absent, play is `Math.random` — exactly
today's game, honor-system dice, `legal.ts` unable to check randomness by
construction. Present:

- **The nth roll is a pure function of `(seed, n)`**, where n is the count of
  roll events already in the log. Each roll event derives a fresh stream from
  `hash(seed, n)` rather than sharing one stream — sharing would force every
  client to count *draws* identically (a turn roll consumes a different
  number than a destination roll), which is fragile; counting *events* is
  derivable from the log every client already holds.
- **Every client agrees on the dice** without coordination, because the seed
  arrives in `started.rules` via the log and the log is shared and ordered.
- **`appendLegality` verifies conformance.** In a seeded game a roll event
  whose values are not the seed's nth output is refused. The honor system
  becomes a checked system, at the cost of an equality test.
- **The UI marks the game as seeded** — a small indicator, so a fixed-dice
  playtest cannot masquerade as a real game night's result.

The purpose is playtesting — set a seed, create a room, reproduce the exact
scenario, remove the seed — and the golden-game suite gains the same power:
a roll sequence that exposes a bug becomes a named, reproducible fixture
rather than an anecdote.

## The UI, deliberately minimal

`Seat.earned` renders in the existing board furniture. The old turns plan
left exactly this gap on purpose: *"the Train column and the Baron/Total
tiles in Departures Board are not built. The train is a money concept and the
total is cash; both belong with the money spec."* Phase 1 builds the **Total**
tile (the balance) and leaves the Train column for phase 2, when trains can
actually change. One warning from that plan carries forward verbatim: the
design mock's train list includes "Fast Freight", which this rulebook does
not have — do not copy it.

Homeward status shows on the seat (the tension is only real if the table can
see it), and `'over'` shows a winner banner over the ordinary board, with the
log as receipts. Anything prettier belongs to the roadmap's phase 3 map work.

## Testing

House style throughout — the fold and `legal.ts` get unit tests, the wire
gets golden games, and anything a save touches gets a store test.

- **Golden games.** The suite gains a standards shelf, not just the two
  end-rule games — the turns-and-movement design deferred every money-shaped
  scenario to this spec, so this is where they land. Two layers, named
  because they drive different machinery:

  *Engine goldens* (`engine/golden/`, scripted faces, movement intents):
  - **Train types and the Bonus Roll** — the same faces rolled as freight,
    express and superchief, pinning who earns the bonus and what it moves.
    The runner already carries `state.train` and `earnsBonus`; nothing has
    ever varied it.

  *Event-level goldens* (the fold over `src/state/events.ts` — the shape this
  spec introduces, since arrivals and destinations do not exist below it):
  - **A standard turn cycle** — destination rolled by region and city,
    travelled to, paid on arrival, next destination rolled.
  - **The $0 neighbours** — Minneapolis→St. Paul and Oakland→San Francisco
    rolled as destinations and arrived: `payout: 0`, banked as nothing,
    legal throughout, and `earned` unchanged. (Unit tests pin the first pair
    already — `roll.test.ts`, `movement.test.ts` — but a golden game is the
    record that the *whole cycle* treats a $0 trip as a real trip.)
  - **A win** — target reached, home reached, every append refused after.
  - **The homeward run itself** — a seat crosses the target mid-game and
    plays several more turns: `regionRequested` refused for it throughout,
    ordinary turn rolls and movement still legal, other seats' destination
    cycles unaffected, and the run ending in the winning arrival. Distinct
    from "a win", which pins the ending; this pins the *journey* — the
    stretch of game where one seat is under different rules than the rest.
  - **The overtaken leader** — one seat crosses the target first, another
    reaches target-and-home first and wins; cash alone ends nothing.

  Goldens script their dice directly and need no seed; the seed exists so a
  *live* game can be reproduced, after which the interesting sequence gets
  transcribed into a fixture. Per the policy in `engine/golden/games.ts`, any
  existing golden this spec invalidates is **deleted, not patched**, with the
  retiring rule named in the commit — though phase 1 only ends games that
  previously ran forever, so none is expected to retire.
- **Fold:** homeward at exactly the target (`>=`, not `>`); home city
  identified from the first stop; `payout: 0` counts nothing; winner derived
  on the winning arrival and not before.
- **legal.ts:** every event type refused after a winning arrival; in seeded
  games, a nonconforming roll refused; in unseeded games, rolls unchecked.
- **Rules file:** absent → defaults; valid → stamped into `started`;
  malformed → mount refuses with the file and field named (mount-level test,
  same shape as Rail Baron's dataDir guard).
- **Saves:** a pre-rules saved room replays with defaults applied; a seeded
  room replays identically twice.

## Out of scope, named so nobody re-litigates silently

Ownership, user fees, auctions, train upgrades (Express $4,000, Superchief
$40,000 — prices already recorded in `engine/dice.ts` for phase 2), forced
sale, bankruptcy, and the shared-trackage question (`route.ts` keeps
recording every company a leg could have ridden, unpriced — *"recording the
set loses nothing it could need"*). **The rover play** is phase 2's too
(decided 2026-08-22), with a debt attached: the rule exists nowhere in this
repo — no comment, no doc, no fixture — and published editions vary, so
phase 2's first task for it is transcribing the table's actual rule before
designing anything. It interacts with the homeward run (an exact-count
landing on a racing leader is the endgame's biggest swing), which is exactly
why it must be written down rather than remembered. Also out: any settings UI, per the
config-file decision, and any general house-rules system, per the roadmap.

**One inherited gate, resolved:** Rail Baron's own pre-monorepo roadmap put
"finish online mode" before the money spec so the wire would be proven while
the event surface was small. Its by-hand pass ran (five bugs, fixed); its
remaining item — a full LAN game — is circular, since no game can be played
to completion until this spec lands an end rule. Decided 2026-08-22: design
and build now, long LAN session in parallel, and note that this spec adds
**no new wire messages** for that session to shake out.
