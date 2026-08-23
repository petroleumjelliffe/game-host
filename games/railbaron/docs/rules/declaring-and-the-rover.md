# Declaring, winning, and the Rover Play — rulebook transcription

**Transcribed 2026-08-23** from the table's rulebook, supplied verbatim by the
owner. This pays the debt the money spec named: *"the rule exists nowhere in
this repo... phase 2's first task for it is transcribing the table's actual
rule before designing anything."* The transcription below is the authority;
the notes after it are interpretation and belong to phase 2's design.

## The rulebook text, verbatim

> **"DECLARING" AND WINNING THE GAME**
>
> To win, a player must return to his "home city" (the city where he started
> the game) with $200,000 or more in cash. Before a player can return to his
> "home city" and win, however, he must warn the other players by "declaring"
> to them at the start of the trip, that he has $200,000 and is returning
> home. The other players have the opportunity to try to stop him by using
> the "rover play" (see below). A player cannot win just by moving into his
> "home city" during a normal trip – he must "declare" in advance and then,
> moving normally, move into his home city while he has $200,000 or more in
> cash.
>
> **"Declaring":** To declare, a player must 1) have $200,000 or more in
> cash, 2) be in his latest destination city, and 3) be about to roll for a
> new destination and start a new trip. If he meets all three of the above
> conditions, the player has the choice of "declaring" or not; however, if he
> does "declare", he must announce it before he rolls for his next
> destination. If he rolls for destination without "declaring" then he must
> go to his next destination – he does not have another chance to "declare"
> until he has arrived at that destination and is about to start his next
> trip after that.
>
> If a player is in his "home city" when he "declares" he wins immediately.
>
> **Rolling for an "Alternate" Destination:** When he "declares", the player
> still rolls for a new destination, which is called his "alternate"
> destination. However, instead of going to his "alternate" destination, the
> player must go to his "home city" to try to win. As long as he is still
> able to win by reaching his home city, the player ignores the "alternate"
> destination entirely: he may move right through it without stopping, and he
> does not get any PAYOFF for reaching it.
>
> **The Trip to the "Home City":** Once he has rolled for an "alternate"
> destination, he starts a normal trip, moving normally, except he is heading
> for his "home city". The player must obey all the normal rules of movement:
> he cannot move along the same section of rail line twice during the same
> trip, he must pay all the fines and penalties each turn, and so on.
>
> **Winning the Game:** To win the game, the player must reach his home city
> with $200,000 or more in cash before any of the other pawns catch his pawn.
> The player's pawn stops immediately when it reaches its "home city". He
> does not collect a PAYOFF for reaching his "home city" unless it is also
> his "alternate" destination that trip. If, after paying all his fines and
> penalties that turn, he still has $200,000 or more in cash, he immediately
> wins the game!
>
> **The Rover Play:** Once a player has "declared", the first player to move
> onto or through a dot occupied by the "declared" pawn collects $50,000 from
> the "declared" player. The player who is caught pays only the first pawn
> that catches him – after that he is no longer "declared" and must go to his
> "alternate" destination instead.
>
> A player who has "declared" can move through other pawns without penalty –
> he is "caught" only if another pawn moves onto or through him during its
> turn.
>
> **Going to the "Alternate" Destination:** As soon as a "declared" player
> falls below $200,000 or is caught by another pawn, he is no longer
> "declared": he is no longer headed for his "home city", and must go to his
> "alternate" destination, instead. The interrupted trip to his "home city"
> and the following trip to his "alternate" destination count as parts of the
> same trip. The player may not use the same section of rail line twice
> during this trip, except: if he has no other way of getting to his
> "alternate" destination, he may move along sections of rail lines he used
> while he was heading for his "home city". He may not use the same rail
> sections twice any more than is absolutely necessary.
>
> Once he arrives in his "alternate" destination, the player collects his
> PAYOFF from the city where he "declared" to the "alternative" destination,
> and then if he has $200,000 or more when he starts his next trip, he may
> "declare" and try again.

## What this changes, for phase 2's design to own

- **Declaring is a choice event, not a derived state.** Phase 1 shipped the
  simplification the spec chose knowingly: crossing the target silently stops
  destination rolls and reaching home wins. The published game instead has an
  explicit, announced *declare* — a new event a player appends by choice, at
  a moment with three preconditions. Phase 1's `homeward` derivation becomes
  the *eligibility* test for that choice, not the state itself.
- **The alternate destination is rolled and carried, unpaid unless reached
  after cancellation.** A declared trip has two targets at once: home (the
  real one) and the alternate (the fallback). Cancellation redirects the
  *same trip* to the alternate, with a section-reuse mercy rule ("no more
  than is absolutely necessary" — the one genuinely fuzzy clause; the design
  must decide how strictly the draft enforces it).
- **The rover is a $50,000 transfer on move-through, first catcher only.**
  It needs pawn-position intersection during movement (`moved` paths already
  carry every node), a cash transfer between players (the first in the game —
  phase 1 money only ever came from the bank), and the un-declare.
- **There is no own-a-railroad clause in the win condition.** The money
  spec's phase-2 assumption ("gains the ownership clause") is wrong and is
  retired by this transcription. Winning is declare + home + $200,000 cash,
  after that turn's fines and penalties.
- **"Cash" means after fees.** Fines and penalties settle each turn and can
  un-declare a player mid-run — the fee system and the endgame are coupled,
  which is a reason they share phase 2 rather than splitting.

## Decisions the table has already made (2026-08-23)

- **Railroad purchases: on arrival, after being paid** — complete a trip,
  collect the payout, then optionally buy before rolling the next
  destination.
- **User fees: flat per turn, paid to the owner** whose track was used that
  turn. Amount to be confirmed against the rulebook's fee schedule.

## Still owed from the rulebook before phase 2 designs

- The **railroad price list** (28 railroads; the map data names them, nothing
  prices them).
- The **fee schedule** — the flat amount, and whether several owners' tracks
  in one turn mean several fees.
- **Forced sale and bankruptcy** — the turns-and-movement design quotes
  *"you must sell a rail line… and keep selling until you have enough money"*
  and *"you are out of the game!"*; the full text and the sale price (half
  the purchase price, in most editions) need transcribing.
- **Train upgrades** — Express $4,000 and Superchief $40,000 are recorded in
  `engine/dice.ts`; the *when may you buy one* rule is not.
