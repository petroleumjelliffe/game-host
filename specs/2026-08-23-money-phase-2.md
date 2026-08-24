# Rail Baron money, phase 2 — the economy, and the endgame the rulebook actually has

**Status:** designed 2026-08-23, not implemented. The design's inputs are the
three rulebook transcriptions in
[`games/railbaron/docs/rules/`](../games/railbaron/docs/rules/) — declaring
and the rover, the railroad prices, the user fees — plus the table's
decisions recorded there. Four debts remain open and are carried as named
holes, not blockers: see *Still owed* at the end.

**What phase 1 left:** a game that can be won, by a simplification this
phase retires. Money is earned (`banked`, derived at replay), the win was
cash-plus-reach-home with destination rolls silently stopping — and the
transcription showed the published game is richer: winning is an announced
**declare**, the table gets the **rover** as counterplay, and the fee system
is the endgame's counterweight. Phase 2 builds ownership, fees, trains, and
that real endgame, on the same architecture: every change is an event or a
derivation, `legal.ts` is the whole authority, and the log replays into the
same game on any machine.

## Decision 1: ownership — railroads as state, bought in the arrival window

**The price list becomes engine data with a digest test**, exactly as
`PAYOUT_TABLE` and `CODES` are pinned: `engine/railroads.ts` carrying the 28
prices from [the transcription](../games/railbaron/docs/rules/railroad-prices.md)
(dollars ×1000 at runtime, `payoutBetween`'s convention), an FNV-1a digest
in its test, and the SLSF-was-119 story as the comment explaining why.

**One new event:**

```ts
| { type: 'bought'; seat: SeatId; railroad: RailroadId; price: number }
```

`price` travels in the event for the same reason `payout` does — the log is
self-contained — and `legal.ts` verifies it against the table the same way
it audits payouts. The fold derives `owners: ReadonlyMap<RailroadId, SeatId>`
and each seat's holdings; `banked` debits at the event.

**The window (table's decision, 2026-08-23): on arrival, after being paid,
before rolling the next destination.** In fold terms: `bought` is legal for
the actor while `needsDestination` is true — the same standing-at-your-stop
state that already gates the destination roll — and for a *declared* player
never (their window closed when they declared; see Decision 3). Multiple
purchases in one window are multiple `bought` events; nothing limits the
count but the balance. Buying an already-owned railroad is refused; there is
no resale between players in this phase.

**UI:** the arrival moment gains a purchase affordance — the board's row
flow, not a new screen: the actor's row action becomes "buy or roll", listing
unowned railroads and prices, skippable. The exact board treatment follows
the departures idiom at implementation; the spec's requirement is only that
buying never blocks rolling and that every purchase is visible to the table
(the MoneyStrip shows holdings counts per baron).

## Decision 2: fees — derived, never appended

Fees are **pure derivation, no event**. Every `moved` already records its
path; the fold knows the ownership map and the tier; so each turn's bill is
computable at replay from what the log already holds. Appending a
`feesPaid` event would be a second copy of derivable truth that could
disagree with the first. This is the promise `route.ts` made — *"movement
records it and charges nothing — the money spec prices it"* — kept literally.

**The schedule** ([transcription](../games/railbaron/docs/rules/user-fees.md)):
per turn — $1,000 to the bank when only unowned track was used; $5,000 to
each *other* owner whose track was used while any railroad remains unowned;
$10,000 to each once all 28 are owned. **One fee per owner, not per line.**
The all-owned tier flip is a game-wide derivation of the ownership map.

**Attribution on shared trackage:** a recorded step may name several
companies. The fold attributes each section to the company that produces
the **cheapest legal bill for the mover** (own line over any other; unowned
over other-owned; deterministic tie-break by railroad id). Deterministic,
replayable, player-favourable — and revisitable, since the log keeps the
full sets. *(Held as an assumption pending the rulebook's own word — see
Still owed.)*

**Settlement is after the turn, and the balance may go negative** (table's
decision): the bill lands when the turn closes, `banked` may cross zero, and
a negative balance is a legal, *blocking* state — see Decision 4. Fees paid
to an owner credit that owner's `banked` in the same derivation: the game's
first player-to-player money, alongside the rover's $50,000.

## Decision 3: the endgame — declare, the alternate, the rover

Phase 1's silent `homeward` is retired as a state and survives as an
**eligibility derivation**: at your latest destination, about to roll, with
`banked >= winTarget` *(cash after fees — the derivation already nets the
settled bills)*. Eligibility lights the choice; it no longer changes the
rules by itself.

**One new event:**

```ts
| { type: 'declared'; seat: SeatId;
    alternate: { city: CityId; region: RegionId; payout: number } }
```

Declaring is announced before the destination roll, and the alternate
destination is rolled *at* declaration and carried in the event (its payout
is the declared-city→alternate figure, verified by `legal.ts` like every
payout; it banks nothing unless the player is later un-declared and reaches
it). If the declarer is already standing at home, the fold yields the winner
immediately — the rulebook's own clause.

**While declared,** the fold derives the seat's destination as home (the
`destinationOf` seam from phase 1, now keyed on declared status), the
alternate is ignored — passed through without stopping or payout — and
`regionRequested`/`arrived` are refused, as they were for phase-1 homeward.

**The rover is a derivation, not an event.** Every `moved` path is in the
log, and so is every pawn's position: when any other pawn's path moves onto
or *through* the declared pawn's node, the fold transfers $50,000 from the
declared player to the first such catcher and clears the declaration. No
new message can disagree with the movement that caused it. Likewise
**un-declaring by poverty**: the moment the declared player's derived cash
drops below the target (a fee settlement, the rover payment itself), the
declaration clears.

**After cancellation** the same trip continues to the alternate: destination
derivation falls back to `alternate.city`, arrival there pays the carried
payout, and re-declaring next trip is the ordinary eligibility rule again.
The rulebook's section-reuse mercy ("no more than absolutely necessary") is
enforced as phase 1 enforced routes: the draft UI constrains, the server
does not re-derive path optimality — the honor level the movement system
already runs at.

**The win:** a declared player's `moved` ending at the home node, with
derived cash still at or over the target after that turn's fees. `phase:
'over'`, appends refused, exactly phase 1's closing behaviour.

**Fixture policy consequence, named now:** phase 1's golden games that
encode silent-homeward behaviour — the homeward run, the win, the overtaken
leader — are **invalidated by these rules and will be deleted, not
patched**, replaced by declared-era equivalents. The policy in
`engine/golden/games.ts` was written for exactly this moment, and phase 1's
As-built predicted no retirements "in phase 1"; phase 2 is the phase that
collects them.

## Decision 4: liquidation — the stub, honestly

Negative at settlement blocks everything else: `legal.ts` refuses every
event from a short player except the sale that raises money. **The
mechanism is stubbed by decision** ([the fees
transcription](../games/railbaron/docs/rules/user-fees.md)): until an
auction gets its own design pass, the placeholder is

```ts
| { type: 'sold'; seat: SeatId; railroad: RailroadId; price: number }
```

— a forced sale **to the bank**, at a placeholder price of **half the
purchase price** (the customary figure; held against the still-owed forced
sale text), railroad returning to unowned (which can flip the fee tier back
down — the derivation handles it, since ownership is a map the fold owns).
Selling is legal *only* while short or as the rulebook's forced-sale text
directs once transcribed. Because the stub is an ordinary log event, a
future auction replaces the mechanism without touching history: old `sold`
events replay as bank sales forever.

**Elimination** ("you are out of the game!") is *not implemented* until its
text arrives — a short player with nothing left to sell is, for now, a
stalled game the table resolves by house rule, and the spec says so rather
than inventing the rule.

## Decision 5: trains — data ready, rule gated

Express $4,000 and Superchief $40,000 are already recorded
(`engine/dice.ts`), `startingTrain` is already a house rule, `earnsBonus`
already discriminates, and the golden shelf already pins all three trains.
The upgrade event is designed —

```ts
| { type: 'trainBought'; seat: SeatId; train: 'express' | 'superchief'; price: number }
```

— but **gated on the still-owed timing rule**. If the rulebook puts train
purchases in the same arrival window as railroads, this is a one-line
legality clause; the spec does not guess.

## Compatibility

- **Old saves replay unchanged** — every phase 2 rule activates on events or
  ownership that pre-phase-2 logs cannot contain; a log with no `bought` has
  no owners, an all-unowned game charges only the $1,000 bank fee, and a log
  with no `declared` can produce no winner under the new rule.
- **The one deliberate break:** an *in-flight* phase-1 game whose leader was
  silently homeward loses that status — under phase 2 rules they simply
  become eligible to declare. Games *finished* under phase 1 keep their
  winner? **No** — winner derivation changes, and a finished phase-1 log
  would replay as unfinished. This is accepted: these are game-night saves,
  not archives, and the alternative (dual win rules keyed on log era)
  carries permanent complexity for a handful of rooms. The plan must say so
  in its deploy note.
- The **fees derivation applies to old logs** but bills nothing: no
  ownership, so $1,000-to-bank turns only — which does change `banked` for
  old in-flight games (each past turn now costs $1,000). Also accepted, same
  reasoning, same deploy note.

## Testing

House style: fold and legality unit tests; golden games at the event level
for every mechanism (a purchase window used and skipped; fee bills at all
three tiers including the flip when the 28th railroad sells *and back* when
one is sold to the bank; a declare → rover catch → alternate arrival →
re-declare cycle; a declare cancelled by fees; the immediate win when
declaring at home; liquidation forced and cleared); the seeded-dice
machinery from phase 1 for reproducing any of it over the wire; and the
phase-1 fixture retirements named in their deletion commit.

## Still owed, and what each gates

| Debt | Gates |
| --- | --- |
| Forced sale / elimination text | The stub's price (half is a placeholder); elimination existing at all |
| Train purchase timing | `trainBought` legality clause |
| Own-track / mixed-turn fee confirms | Two lines of the fee derivation |
| Shared-trackage attribution confirm | Whether cheapest-legal stands or the mover chooses |

None blocks the plan; each is a marked line the plan quotes as assumption.
