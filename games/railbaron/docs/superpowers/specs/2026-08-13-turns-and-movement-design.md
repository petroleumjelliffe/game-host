# Turns and movement — design

**Date:** 2026-08-13
**Status:** Agreed
**Covers:** the first spec of Phase 4 in [ROADMAP.md](../../../ROADMAP.md)
**Source of rules:** the Avalon Hill rulebook. Every number and rule below is quoted
from it, not recalled — which matters, because a referee that is subtly wrong ruins games
in ways a companion never could.

The PDF is deliberately **not committed**: this repository is public, and the rulebook is
Avalon Hill's. Keep a copy locally (it is git-ignored as `rail_baron.pdf`) and quote what
you need into specs, as this one does.

## What this is

v1.0.0 shipped a *companion*: it rolls each baron's destination, works out the payout,
and draws the network. The game itself happens on the table.

This spec begins Phase 4, where the app models the game rather than assisting it. It
covers the first half of that: **turn order and movement**. A baron rolls, walks their
pawn along the map by tapping, and the app enforces the rules of movement while they do.

**Scope ruling.** Phase 4 is four subsystems — turns, movement, money, winning — and
designing them as one document would produce something too vague to build. This spec is
turns and movement only.

## What it deliberately leaves out

- **Cash, purchases and the auction.** The next spec. One thing found while checking the
  rulebook belongs there rather than here, and is recorded now so it isn't re-derived: the
  book has no "can't afford it, so don't" rule. *"You **must** pay all your penalties. If
  you do not have enough money, you **must sell a rail line**… and keep selling until you
  have enough money."* Still short after that, and *"you are out of the game!"* The forced
  sale is one of the game's real pressures, so the money spec should model it rather than
  guard against reaching it.
- **User fees.** Also the next spec — but fees are settled at end of turn and depend on
  *which companies a turn used*, so this spec records exactly that and charges nothing.
  The seam is deliberate: movement produces the fact, money prices it.
- **The win condition.** It needs cash.
- **Anything online.** Phase 3 is unchanged and unblocked by this.

## The rules, as the book states them

| Rule | The book |
|---|---|
| Movement | Two white dice, summed. |
| Bonus die | One coloured die, rolled **once**. Earned when: no train and you rolled double six; an **EXPRESS** and you rolled any double; a **SUPERCHIEF** — every turn. "A player can get no more than one Bonus Roll per turn." If entitled, he **must** take it. |
| Trains | Freight to start. EXPRESS $4,000, SUPERCHIEF $40,000. There is no Fast Freight. |
| Must move | "A player must always move the full number of dots that he rolls, whether he wants to or not, until he arrives at his destination city." |
| Arrival | "As soon as his pawn reaches its destination city, it must stop immediately — any extra movement is just lost." |
| Reuse | "Each section of rail can be used only once per trip." The pawn may pass through the same dots again, and even move between the same two dots again, **as long as it uses a different rail line**. Everything is released on arrival. |
| Changing line | "A player may change rail lines any number of times, but he can change rail lines **only at a dot**." At an intersection that is not a dot, a token may stay on the same company's line but "may never switch from a rail line of one company to the rail line of another company except at a dot." |
| Stranding | If moving to a particular dot would mean the pawn could not reach its destination without going over the same section twice, "the pawn cannot move to that particular dot — it must move to some other dot." |
| Cost | "Cities (black squares) count as dots; each pair of twin cities (Oakland–San Francisco, Minneapolis–St. Paul) count as one dot for the pair." |
| Turn order | "The players roll to see who goes first, the high roll" — then to the left, clockwise. |
| Home city | Rolled from the destination table before play. "If two players roll the same home city, the second player must roll again — no players can have the same home city." |
| Bonus after arrival | If the pawn arrived during the normal turn, the player rolls a **new destination** and uses the Bonus Roll to start the next trip. |

### A bug this surfaces in the shipped app

`rollDestination` knows nothing about other seats, so v1.0.1 will hand two barons the
same home city. The rules forbid it. Fixing it is in scope here because home cities are
where pawns start.

## The shape of a turn

```
roll ──► tap out a route ──► commit ──► watch it play back
             ▲      │
             └ undo ┘   (screen state, unlimited, within the turn)
```

**The log records the turn. The screen edits a draft. The map animates the reveal.**
Three different questions that look like one, and separating them is what lets all three
be answered well:

- The **draft route** is an array of node ids in screen state. Undo is `pop()`. It never
  touches the log, so per-step undo costs nothing to design.
- **Commit** appends one event carrying the whole path. Fees are settled at end of turn
  by the rules, so the turn is already the unit the rules reckon in.
- **The reveal** walks the pawn along the committed path. Presentation derived from
  state, exactly as the flaps are.

This is also strictly better for Phase 3 than streaming a step per tap: one message
instead of twenty, no ordering hazards, and opponents see a decisive move rather than
watching someone dither.

**Commit is offered only when the route is complete** — exactly the full roll, or ending
on the destination. There is no half-committed turn.

**Reloading mid-turn loses the draft.** On a single pass-and-play tablet that is an
annoyance, not a lost game. If it grates, persisting the draft as screen state is a small
addition that does not disturb the log.

## Rolling, and what the board shows

There is no dice UI at all today — tapping a baron's row rolls their *destination*. Under
these rules that is the wrong verb for most turns: you roll a destination only when a
trip begins, and movement dice every turn in between.

**A destination is rolled once per trip, and only at its start.** Re-rolling mid-trip is
not a thing the rules allow, and the app must refuse it rather than rely on nobody
tapping. The guard belongs in the engine, not the screen: a baron with a destination and
no arrival yet cannot be given another. This is the same shape as the existing rule that a
seat already awaiting a region choice cannot roll again.

**The dice are shown on the board, once, shared.** Not per row — there is one pair of
white dice on the table and everyone uses them. The board grows a dice readout with:

- two white dice, always
- **a third slot for the bonus die**, which stays empty on the turns it is not earned and
  fills on the turns it is — but only **after the white movement has been walked**, when
  the Bonus Roll is actually taken (see "The Bonus Roll is taken after the white
  movement")

The empty slot is the point: it shows a Freight player what a Superchief gets every turn,
and it makes the upgrade legible before you buy it rather than after.

Both are flap fields, like everything else on this board, and land under the same rules
the roll reveal already follows — the value is not readable until the flaps stop, and the
gate that holds a roll out of the log until it has been announced applies unchanged.

## Setup, before anyone moves

The rulebook has an order to this and strict turns make it matter:

1. Barons join seats — unchanged from today.
2. **Each seated baron rolls a home city**, in seat order, no two the same. Their pawn
   starts there and they must return there to win.
3. **The players roll for who goes first**, high roll, and play proceeds clockwise from
   them. The app rolls this once and records the resulting order, so a replayed game
   deals the same turns.
4. The first player rolls their first destination and the game is under way.

`GameState.phase` is `setup | playing` today. Steps 2 and 3 need a phase of their own
between them, so it becomes `setup | homes | playing`. Seating order stays the existing
`SEATS` order; the roll decides only who starts within it.

## State

Four changes to the event log. Everything else derives by replay, as it does today.

- **`turnRolled`** — the white dice for a turn. Recorded rather than re-rolled, so a
  replayed game is the same game. This is the existing house rule that events record what
  happened, not what was rolled. *(It carried the bonus die too when this was written;
  the amendment below moved the Bonus Roll to its own event. The field stays, and replay
  still honours a face in it, so logs written before the amendment load unchanged.)*
- **`bonusRolled`** — the Bonus Roll, thrown and announced on its own after the white leg.
  See "The Bonus Roll is taken after the white movement, not with it".
- **`moved`** — one per leg, so two in a turn that took a Bonus Roll: the path as node
  ids, and whether it ended on the destination.
- **A home city may not collide.** There is no `homeAssigned` event and this spec does
  not add one: a baron's home city is today the first `arrived` they record, the one that
  pays nothing. What changes is that rolling it must avoid cities already taken, so
  `rollDestination` gains the set of home cities already taken and rerolls when it hits
  one. Note the book says to roll again "for region and city" — the whole destination
  roll, not another city within the same region.

Derived at replay:

- **whose turn it is** — seating order and a turn counter
- **each pawn's position** — the last node of the last `moved`, or the home city
- **sections used this trip** — accumulated from `moved` paths since the last arrival,
  and released on arrival

Positions are node ids, not city ids. A baron between cities is the normal case; the
companion could get away with "which city are you heading for", and this cannot.

### The board and the map must follow the log across tabs

Not captured by the previous draft, and it stops being a nicety here.

Today each tab holds its own `useGame`, reads the stored log once at mount, and never
looks again. Two tabs — the board on the tablet, the map on a second screen — therefore
drift apart the moment either acts, and the stale one overwrites the other's work when it
next writes. It is already a trap in v1.0.1; with committed moves and strict turns it
becomes a way to lose a game.

The fix is small and belongs in this spec because this spec is what makes it load-bearing:
listen for the `storage` event, which fires in *other* tabs when a key changes, and
re-derive state from the reloaded log. Both views already render from replayed state, so
neither needs to know it happened.

Two consequences worth stating:

- **A follower tab must not act out of turn.** With strict turn order this mostly falls
  out — only the current baron's controls are live, in whichever tab is showing them.
- **A draft route is not in the log**, so it does not cross tabs. Route-building happens
  in the tab that is playing; the other tab watches the committed move play back like any
  other spectator. That is the right split, and it is the same one Phase 3 will need.

## The movement engine

Pure, in `engine/`, no React — following the split the project already holds. Its whole
job is one question: **from here, with this much movement left, which taps are legal?**

The cost model falls out of the graph rather than being enforced on top of it: `dot` and
`city` cost one, `junction` costs nothing *because it is not a dot*, and the two twin
pairs collapse to a single dot for the pair. Company-switching legality falls out the
same way — you may change company only at a dot, and a junction is precisely the
not-a-dot case the rulebook is describing.

### Two questions, not one — and only the cheap one runs per tap

The first draft of this spec treated every tap as needing a full look-ahead: *can the
remaining movement still be spent legally from here?* That is exact-length trail-finding,
it gets rapidly worse with depth, and rolling all the dice up front makes the depth 18
rather than 12. It would have been the hardest thing in the spec.

It is also not what the rulebook asks for. There are two separate requirements:

- **Stranding is a rule about reachability.** "If moving to a particular dot would mean
  that a pawn could not get to its destination city without going over the same rail
  section twice, then the pawn cannot move to that particular dot." That is: *is the
  destination still reachable at all, over sections not yet used this trip?* A breadth-
  first search on the graph minus the used sections answers it, and its cost does not
  depend on how much movement is left. **This runs on every tap.**
- **Spending the whole roll is a rule about the finished route.** "A player must always
  move the full number of dots that he rolls." That is a property of the route the player
  commits, not of each step along it. **This is enforced at commit** — the commit control
  stays unavailable until the draft is exactly the full roll or ends on the destination.

So the expensive search does not need to exist. A player can still tap themselves into a
corner — a terminus with movement left and no unused way out — and when they do, they
undo, which costs nothing and is exactly what a player at the table does on discovering
the same thing. Undo is already unlimited within the turn.

**This is why 18 is not a problem.** The per-tap check is depth-independent, so it makes
no difference whether the dice on the table total 12 or 18.

### The Bonus Roll is taken after the white movement, not with it

*(Amended after playtest. The first draft rolled every die up front and argued the two
stagings were equivalent while the pawn did not arrive. They are not equivalent to
**play**: a player who knows the bonus face plans an 18-dot route; a player at the table
does not know it until the die is thrown, after the normal move. The staging is part of
the rule.)*

A turn with an entitlement is always two legs, in the book's own order:

1. The white dice are rolled and announced. **Entitlement is fixed at that moment** by the
   doubles rules — but only the entitlement, not the face.
2. The pawn walks the full white roll (or arrives and stops dead).
3. If entitled, the player **must** then take the Bonus Roll — a separate roll, separately
   announced on the third slot. If the first leg arrived, the new destination is rolled
   first, and the bonus starts the new trip with used sections released; otherwise the
   bonus leg continues the same trip over the same used sections.
4. The pawn walks the bonus face. The turn ends after it (or immediately after the white
   leg when nothing was earned).

The engine records the bonus die as its own event, appended only after its announcement —
the same gate as every other roll. A turn cannot advance past an untaken entitlement: "if
entitled, he must take it" is enforced, not offered.

## Interface

**The map becomes the play surface during a turn.** You cannot tap dots on a departures
board. Legal next dots are lit; the pawn walks the committed path at 80–120ms a dot; a
tap finishes the animation early — the same rule the board already applies to a flap
mid-turn.

**The board keeps the roster** — who is up, destinations, payouts, and later cash. The
two views already exist and already share state; what changes is which one is primary
during a turn.

**Turn order is strict.** Only the baron whose turn it is can act; other rows are inert
and the app advances the turn itself. Fees are settled per turn, so "whose turn" has to
be unambiguous. Undo takes back the last turn if someone acts for the wrong baron.

## Testing

`engine/` is pure, so it tests directly, and the dice are injected exactly as they are
today — a whole turn can be scripted.

### Golden games — the rules spec, stored as data

Borrowed from `acquire-startups-m1`, which holds seventeen of them in `engine/golden/`
and calls them the executable rules spec. The shape there is worth copying closely: a
`setup` fixture, then a list of steps, each carrying an intent plus the state it must
produce — **or the rejection code it must produce**, with the state unchanged. A runner
replays them against the engine.

It fits Rail Baron's Phase 4 better than it fits Acquire, because these rules are mostly
edge cases and every one of them is awkward to reach by playing normally:

| Golden game | What it pins |
|---|---|
| a trip that re-crosses its own dots by a different line | no-reuse is per *section*, not per dot |
| a trip that spans several turns | used sections survive turns and release on arrival |
| a route through a junction | company may not change except at a dot |
| a route through each twin pair | the pair costs one dot, both pairs |
| a step that would strand the pawn | offered as illegal, state unchanged |
| a roll that arrives with movement to spare | stops dead, remainder lost |
| double six on Freight, any double on Express, every turn on Superchief | the bonus die, and never twice |
| arriving on the white dice, then a bonus leg | a *new* destination and released sections |
| two barons rolling the same home city | the reroll, and no duplicates |

**The set above is movement only, and it is expected to change.** Scenarios that turn on
money — a fee that forces a sale, a route a player cannot afford, a bankruptcy — belong
with the money spec and are not written yet. When they arrive they will make some of
these games wrong rather than merely incomplete: a game asserting a legal route says
nothing about whether that player could pay for it.

The rule for that is to **delete a golden game a later rule invalidates, not patch around
it**. Their value is that each one states a rule exactly; a game kept alive by
qualifications no longer does. The set is a living spec, so it shrinks as well as grows.

Acquire also seeds dev-only routes from its golden games so any state is two clicks away
in a browser, and guards the data out of the production bundle with a `check:bundle`
script. Both are worth having here for the same reason — these states are otherwise
twenty minutes of tapping away — but they are a follow-on, not part of this spec.

### The rest

- the cost model, including a junction costing nothing
- "must spend the whole roll" — a route short of the roll is not committable
- a destination cannot be re-rolled mid-trip
- the `storage` event bringing a second tab into line, which jsdom can fire

The house rule stands: prove a new test can fail by breaking the code and reading real
output, never by reading the assertion.

## What must not break

- **The `$0` constraint.** Minneapolis↔St. Paul and San Francisco↔Oakland pay nothing and
  are real destinations. They are also the two twin pairs whose movement cost is special.
  Both facts, same two pairs, different code paths.
- **The event log as the single source of truth**, with state derived by replay.
- **A roll is not told until the board has finished announcing it** — the gate built into
  `useGame.roll`/`commitRoll`. Movement adds a second thing worth announcing and must not
  reintroduce the leak.
- **The map's own invariants**: one lamp per real dot at its real place, and the two
  separated twin pairs staying two lamps. Movement makes them tappable; it must not make
  them move.
