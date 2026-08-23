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

## Settlement: after the turn, and the balance may go negative

Confirmed 2026-08-23: **one fee per owner, not per line** — riding three
railroads of one owner in a turn is one fee; riding two owners' lines is two.

**Fees are settled after the turn, not during it.** A player may therefore
go **negative** at settlement and then must raise the money — by selling off
railroads — until the bill is met. Two consequences the design owns:

- **A transiently negative balance is a legal state.** The fold cannot treat
  `banked < 0` as corruption; it is the moment between the bill landing and
  the liquidation covering it. (It still un-declares a runner: below
  $200,000 is below $200,000.)
- **Liquidation is a forced, ordered flow**: fee assessed → short → sell
  until covered → then play continues (or, per the rulebook's "you are out
  of the game!", cannot cover and is eliminated — that text is still owed).

## The auction: STUBBED, by decision (2026-08-23)

How a railroad is sold off to meet a bill — auction to the table, sale to
the bank, at what price — is **not designed**, and the owner has said to
stub it rather than invent it. Phase 2's spec must carry the stub honestly:
the *trigger* (negative at settlement) and the *obligation* (sell until
covered) are modelled; the *mechanism* is a named hole with the simplest
possible placeholder until it gets its own design pass. Whatever the
placeholder is, it must be an event in the log like everything else, so a
later real auction changes the mechanism without rewriting history.

## Edges still open against the rulebook

- **Own track:** riding your own railroad presumably costs nothing and does
  not trigger the unowned $1,000 when the whole turn is on your own lines —
  confirm.
- **Mixed turns:** owned + unowned in one turn — the usual reading is that
  other-owner usage displaces the bank fee (owner tier only, not $1,000 +
  $5,000) — confirm.

`route.ts` already records, per leg, every company the movement could have
ridden — including shared trackage, where a step names every company on the
section because the player was never asked to choose. **The fee design must
decide what that choice means:** if a shared section carries one owned and
one unowned railroad, does the mover choose which they rode (and thus what
they pay)? The recording deliberately loses nothing so this decision could
be made here.
