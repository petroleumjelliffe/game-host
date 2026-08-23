# User fees — rulebook transcription

**Transcribed 2026-08-23**, supplied by the owner. The third of the four
debts the declaring-and-rover transcription left open. Settled per turn, at
the end of the turn — the timing `route.ts` has been designed around since
the turns plan (*"fees are settled at end of turn and depend on exactly
this, so movement records it and charges nothing"*).

## The schedule, per turn

| Track used that turn | Fee | Paid to |
| --- | --- | --- |
| Unowned railroads only | $1,000 | the bank |
| Another player's railroad, **while any railroad remains unowned** | $5,000 | the owner |
| Another player's railroad, **once all railroads are owned** | $10,000 | the owner |

Two derivations this hands the fold:

- **"All railroads owned" is game state** — the fee tier flips on a
  game-wide condition, so replay must derive the count of owned railroads,
  not just each seat's holdings.
- **The fee is the endgame's counterweight.** A declared runner pays fees
  each turn and is un-declared if they dip below $200,000 — at the $10,000
  tier, a long run home through other players' track is genuinely expensive.

## Edges the schedule does not settle — confirm against the rulebook

1. **Several owners' tracks in one turn:** one $5,000/$10,000 fee to *each*
   owner used, or one fee total (and then to whom)? The owner's earlier
   answer ("flat per turn to the owner") reads as one fee per owner; the
   printed text should confirm.
2. **Own track:** riding your own railroad presumably costs nothing and
   presumably does not trigger the unowned-$1,000 either when the whole turn
   is on your own lines — confirm.
3. **Mixed turns:** own + unowned in one turn; owned + unowned in one turn.
   The usual reading is that any *other-owner* usage displaces the bank fee
   (you pay the owner tier, not $1,000 + $5,000) — confirm.

`route.ts` already records, per leg, every company the movement could have
ridden — including shared trackage, where a step names every company on the
section because the player was never asked to choose. **The fee design must
decide what that choice means:** if a shared section carries one owned and
one unowned railroad, does the mover choose which they rode (and thus what
they pay)? The recording deliberately loses nothing so this decision could
be made here.
